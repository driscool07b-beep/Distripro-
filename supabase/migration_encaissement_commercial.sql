-- Migration : qui détient l'argent d'une vente ?
-- Une vente peut être ATTRIBUÉE à un commercial tout en étant saisie et
-- encaissée au bureau (marchandise prise au magasin). L'argent n'est chez le
-- commercial que s'il a saisi la vente lui-même (vente terrain) ou si la
-- marchandise vient de son stock terrain (il livre et encaisse).
-- Corrige la réconciliation et le « reste à verser » du tableau de bord.
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function encaisse_par_commercial(p_vente_id uuid)
returns numeric
language sql
security definer
stable
set search_path to 'public'
as $$
  select case
    when v.commercial_id is not null
     and (v.created_by = v.commercial_id
          or exists (select 1 from ventes_lignes l where l.vente_id = v.id and l.source_stock = 'commercial'))
    then encaisse_physique_vente(v.id)
    else 0 end
  from ventes v where v.id = p_vente_id;
$$;

create or replace function preparer_reconciliation(p_commercial_id uuid, p_date_debut date, p_date_fin date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_valorisation text;
  v_id uuid;
  v_numero text;
  v_debut timestamptz := (p_date_debut::timestamp at time zone 'Africa/Abidjan');
  v_fin timestamptz := ((p_date_fin + 1)::timestamp at time zone 'Africa/Abidjan');
  v_ventes numeric;
  v_recouvrements numeric;
  v_verse numeric;
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if not peut_valider_caisse() then raise exception 'accès refusé : seuls la caisse, le comptable et la direction préparent une réconciliation'; end if;
  if p_date_fin < p_date_debut then raise exception 'la date de fin doit suivre la date de début'; end if;
  if p_date_fin > (now() at time zone 'Africa/Abidjan')::date then raise exception 'la période ne peut pas finir dans le futur'; end if;
  perform 1 from profils where id = p_commercial_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'commercial introuvable'; end if;
  if exists (
    select 1 from reconciliations_commercial
    where commercial_id = p_commercial_id and statut <> 'annulee'
      and daterange(date_debut, date_fin, '[]') && daterange(p_date_debut, p_date_fin, '[]')
  ) then
    raise exception 'une réconciliation existe déjà pour ce commercial sur une partie de cette période';
  end if;

  select valorisation_manquant into v_valorisation from entreprises where id = v_entreprise_id;

  -- Argent physiquement encaissé par le commercial (espèces, chèques) :
  -- ventes comptant ET acomptes des ventes à crédit, hors avoir client
  -- utilisé, y compris les ventes annulées ensuite (l'argent a été encaissé).
  select coalesce(sum(encaisse_par_commercial(v.id)), 0) into v_ventes from ventes v
  where v.entreprise_id = v_entreprise_id and v.commercial_id = p_commercial_id
    and v.created_at >= v_debut and v.created_at < v_fin;
  select coalesce(sum(montant), 0) into v_recouvrements from reglements
  where entreprise_id = v_entreprise_id and commercial_id = p_commercial_id
    and coalesce(mode, 'espece') in ('espece', 'cheque')
    and created_at >= v_debut and created_at < v_fin;
  select coalesce(sum(montant), 0) into v_verse from versements_caisse
  where entreprise_id = v_entreprise_id and commercial_id = p_commercial_id and nature = 'recette'
    and date_versement between p_date_debut and p_date_fin;

  select 'REC-' || to_char(p_date_fin, 'YYYY') || '-' || lpad((count(*) + 1)::text, 5, '0') into v_numero
  from reconciliations_commercial where entreprise_id = v_entreprise_id and to_char(date_fin, 'YYYY') = to_char(p_date_fin, 'YYYY');

  insert into reconciliations_commercial (entreprise_id, numero, commercial_id, date_debut, date_fin, valorisation,
    ventes_comptant, recouvrements, montant_du, montant_verse, cree_par)
  values (v_entreprise_id, v_numero, p_commercial_id, p_date_debut, p_date_fin, v_valorisation,
    v_ventes, v_recouvrements, v_ventes + v_recouvrements, v_verse, auth.uid())
  returning id into v_id;

  -- Stock : pour chaque produit détenu ou mouvementé, stock au début (stock
  -- actuel moins les mouvements survenus depuis), mouvements de la période,
  -- stock théorique à la fin. Le stock compté vaut au départ le théorique,
  -- puis est saisi après comptage.
  insert into reconciliation_lignes (reconciliation_id, produit_id, stock_debut, sorties, ventes, retours, autres, stock_theorique, stock_compte, prix_valorisation)
  select v_id, p.produit_id,
    p.actuel - p.depuis_debut,
    p.sorties, p.ventes, p.retours, p.autres,
    p.actuel - p.depuis_debut + p.periode,
    p.actuel - p.depuis_debut + p.periode,
    case when v_valorisation = 'prix_revient' then coalesce(pc.prix_achat_moyen, pr.prix_vente, 0) else coalesce(pr.prix_vente, 0) end
  from (
    select x.produit_id,
      coalesce((select quantite from stock_commercial sc where sc.commercial_id = p_commercial_id and sc.produit_id = x.produit_id), 0) as actuel,
      coalesce(sum(m.delta) filter (where m.created_at >= v_debut), 0) as depuis_debut,
      coalesce(sum(m.delta) filter (where m.created_at >= v_debut and m.created_at < v_fin), 0) as periode,
      coalesce(sum(m.delta) filter (where m.type = 'sortie' and m.created_at >= v_debut and m.created_at < v_fin), 0) as sorties,
      coalesce(-sum(m.delta) filter (where m.type = 'vente' and m.created_at >= v_debut and m.created_at < v_fin), 0) as ventes,
      coalesce(-sum(m.delta) filter (where m.type = 'retour' and m.created_at >= v_debut and m.created_at < v_fin), 0) as retours,
      coalesce(sum(m.delta) filter (where m.type not in ('sortie', 'vente', 'retour') and m.created_at >= v_debut and m.created_at < v_fin), 0) as autres
    from (
      select produit_id from stock_commercial where commercial_id = p_commercial_id and quantite <> 0
      union
      select produit_id from mouvements_stock_commercial where commercial_id = p_commercial_id and created_at >= v_debut
    ) x
    left join mouvements_stock_commercial m on m.commercial_id = p_commercial_id and m.produit_id = x.produit_id
    group by x.produit_id
  ) p
  join produits pr on pr.id = p.produit_id
  left join produits_couts pc on pc.produit_id = p.produit_id;

  perform recalculer_reconciliation(v_id);
  return v_id;
end;
$$;

create or replace function versements_en_cours()
returns table (
  ventes_cash_commerciaux numeric,
  recouvrement_commerciaux numeric,
  ventes_cash_bureau numeric,
  recouvrement_bureau numeric,
  deja_verse numeric,
  reste_a_verser numeric
)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_aujourdhui date := current_date;
  v_ventes_cash_commerciaux numeric;
  v_ventes_cash_bureau numeric;
  v_recouvrement_commerciaux numeric;
  v_recouvrement_bureau numeric;
  v_deja_verse numeric;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé';
  end if;

  -- Argent détenu par les commerciaux : ventes qu'ils ont saisies eux-mêmes
  -- ou livrées depuis leur stock terrain. Le reste est encaissé au bureau.
  select coalesce(sum(encaisse_par_commercial(id)), 0) into v_ventes_cash_commerciaux
  from ventes
  where entreprise_id = v_entreprise_id
    and commercial_id is not null
    and created_at::date = v_aujourdhui;

  select coalesce(sum(encaisse_physique_vente(id) - encaisse_par_commercial(id)), 0) into v_ventes_cash_bureau
  from ventes
  where entreprise_id = v_entreprise_id
    and created_at::date = v_aujourdhui;

  select coalesce(sum(montant), 0) into v_recouvrement_commerciaux
  from reglements
  where entreprise_id = v_entreprise_id
    and commercial_id is not null
    and coalesce(mode, 'espece') in ('espece', 'cheque')
    and created_at::date = v_aujourdhui;

  select coalesce(sum(montant), 0) into v_recouvrement_bureau
  from reglements
  where entreprise_id = v_entreprise_id
    and commercial_id is null
    and coalesce(mode, 'espece') in ('espece', 'cheque')
    and created_at::date = v_aujourdhui;

  select coalesce(sum(montant), 0) into v_deja_verse
  from versements_caisse
  where entreprise_id = v_entreprise_id
    and nature = 'recette'
    and date_versement = v_aujourdhui;

  return query select
    v_ventes_cash_commerciaux,
    v_recouvrement_commerciaux,
    v_ventes_cash_bureau,
    v_recouvrement_bureau,
    v_deja_verse,
    (v_ventes_cash_commerciaux + v_recouvrement_commerciaux + v_ventes_cash_bureau + v_recouvrement_bureau) - v_deja_verse;
end;
$$;

notify pgrst, 'reload schema';
