-- Migration : réconciliation par tournées + corrections.
-- 1. Réconciliation par TOURNÉES : on coche les fiches de sortie (ouvertes ou
--    clôturées, pas encore réconciliées) d'un commercial ; la période en est
--    déduite ; pour des tournées clôturées dont tout devait être rapporté, le
--    « compté » est prérempli à 0 (ce qui n'est ni vendu ni rapporté manque),
--    comme le contrôle rapide de la sortie.
-- 2. RENVOI À LA CAISSE : une fiche validée par la caisse peut être renvoyée
--    pour correction (motif obligatoire) ; ses écritures sont contre-passées.
-- 3. FICHE RECTIFICATIVE : une fiche clôturée n'est jamais modifiée ; une
--    rectification tracée corrige le comptage, la dette, le stock et les
--    écritures.
-- À exécuter dans l'éditeur SQL de Supabase (après migration_encaissement_commercial.sql).

-- ---------------------------------------------------------------------------
-- 1. Tournées rattachées à une fiche
-- ---------------------------------------------------------------------------
create table if not exists reconciliation_sorties (
  reconciliation_id uuid not null references reconciliations_commercial(id) on delete cascade,
  sortie_id uuid not null references sorties_stock(id),
  primary key (reconciliation_id, sortie_id)
);
alter table reconciliation_sorties enable row level security;
drop policy if exists reconciliation_sorties_select on reconciliation_sorties;
create policy reconciliation_sorties_select on reconciliation_sorties
  for select using (exists (select 1 from reconciliations_commercial r where r.id = reconciliation_id));

create or replace function preparer_reconciliation_tournees(
  p_commercial_id uuid, p_sortie_ids uuid[], p_tout_rapporte boolean default true
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_nb integer;
  v_debut date;
  v_fin date;
  v_toutes_cloturees boolean;
  v_id uuid;
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if not peut_valider_caisse() then raise exception 'accès refusé'; end if;
  if p_sortie_ids is null or array_length(p_sortie_ids, 1) is null then
    raise exception 'cochez au moins une tournée';
  end if;

  select count(*), min(date_sortie), bool_and(statut = 'cloturee'),
         max(coalesce((cloture_at at time zone 'Africa/Abidjan')::date, (now() at time zone 'Africa/Abidjan')::date))
  into v_nb, v_debut, v_toutes_cloturees, v_fin
  from sorties_stock
  where id = any(p_sortie_ids) and entreprise_id = v_entreprise_id and commercial_id = p_commercial_id;
  if v_nb <> array_length(p_sortie_ids, 1) then
    raise exception 'une des tournées cochées n''appartient pas à ce commercial';
  end if;
  if exists (
    select 1 from reconciliation_sorties rs join reconciliations_commercial r on r.id = rs.reconciliation_id
    where rs.sortie_id = any(p_sortie_ids) and r.statut <> 'annulee'
  ) then
    raise exception 'une des tournées cochées est déjà réconciliée';
  end if;

  v_id := preparer_reconciliation(p_commercial_id, v_debut, v_fin);
  insert into reconciliation_sorties (reconciliation_id, sortie_id) select v_id, unnest(p_sortie_ids);

  -- Tournées clôturées et tout devait être rapporté : ce qui reste en main
  -- (ni vendu, ni rapporté) est un manquant → compté prérempli à 0.
  if p_tout_rapporte and v_toutes_cloturees then
    update reconciliation_lignes set stock_compte = 0 where reconciliation_id = v_id;
    perform recalculer_reconciliation(v_id);
  end if;
  return v_id;
end;
$$;

-- Tournées d'un commercial pas encore réconciliées (pour la case à cocher).
create or replace function tournees_a_reconcilier(p_commercial_id uuid)
returns table (id uuid, date_sortie date, statut text, cloture_at timestamptz, nb_produits integer, quantite_sortie integer)
language sql
security definer
stable
set search_path to 'public'
as $$
  select s.id, s.date_sortie, s.statut, s.cloture_at,
         count(l.id)::integer, coalesce(sum(l.quantite_sortie), 0)::integer
  from sorties_stock s
  left join sortie_stock_lignes l on l.sortie_id = s.id
  where s.entreprise_id = current_entreprise_id() and s.commercial_id = p_commercial_id
    and not exists (
      select 1 from reconciliation_sorties rs join reconciliations_commercial r on r.id = rs.reconciliation_id
      where rs.sortie_id = s.id and r.statut <> 'annulee')
  group by s.id
  order by s.date_sortie;
$$;

-- ---------------------------------------------------------------------------
-- 2. Renvoi à la caisse (avant clôture) : contre-passation des écritures
-- ---------------------------------------------------------------------------
create or replace function renvoyer_reconciliation_caisse(p_id uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_r record;
begin
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'comptable') then raise exception 'renvoi réservé au comptable ou à l''administrateur'; end if;
  if coalesce(length(trim(p_motif)), 0) < 3 then raise exception 'le motif est obligatoire'; end if;
  select * into v_r from reconciliations_commercial where id = p_id and entreprise_id = current_entreprise_id() for update;
  if not found or v_r.statut <> 'validee_caisse' then raise exception 'seule une fiche validée par la caisse (non clôturée) peut être renvoyée'; end if;

  -- Contre-passation : chaque écriture de la fiche est inversée (jamais effacée).
  insert into ecritures_comptables (entreprise_id, date_ecriture, journal, piece, compte, libelle, debit, credit, source_type, source_id, created_by)
  select entreprise_id, (now() at time zone 'Africa/Abidjan')::date, journal, piece, compte,
         'Annulation — ' || libelle || ' (' || trim(p_motif) || ')', credit, debit, 'reconciliation_annulation', source_id, auth.uid()
  from ecritures_comptables
  where source_type = 'reconciliation' and source_id = p_id;

  update reconciliations_commercial
  set statut = 'brouillon', valide_caisse_par = null, valide_caisse_at = null,
      commentaire_comptable = coalesce(commentaire_comptable || ' | ', '') || 'Renvoyée à la caisse : ' || trim(p_motif)
  where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Fiche rectificative (après clôture)
-- ---------------------------------------------------------------------------
create table if not exists reconciliation_rectifications (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id),
  reconciliation_id uuid not null references reconciliations_commercial(id),
  produit_id uuid not null references produits(id),
  ancien_compte integer not null,
  nouveau_compte integer not null,
  delta_valeur numeric(14, 2) not null,
  traitement text not null check (traitement in ('dette', 'perte')),
  motif text not null,
  effectue_par uuid references profils(id),
  created_at timestamptz not null default now()
);
alter table reconciliation_rectifications enable row level security;
drop policy if exists rectifications_select on reconciliation_rectifications;
create policy rectifications_select on reconciliation_rectifications
  for select using (exists (select 1 from reconciliations_commercial r where r.id = reconciliation_id));

create or replace function rectifier_reconciliation(p_id uuid, p_lignes jsonb, p_traitement text, p_motif text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_r record;
  v_e record;
  v_l record;
  v_ligne jsonb;
  v_nouveau integer;
  v_delta_qte integer;
  v_delta_valeur numeric;
  v_total numeric := 0;
  v_compte text;
  v_nom text;
begin
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'comptable') then raise exception 'rectification réservée au comptable ou à l''administrateur'; end if;
  if coalesce(length(trim(p_motif)), 0) < 3 then raise exception 'le motif est obligatoire'; end if;
  if p_traitement not in ('dette', 'perte') then raise exception 'traitement invalide'; end if;
  select * into v_r from reconciliations_commercial where id = p_id and entreprise_id = current_entreprise_id() for update;
  if not found or v_r.statut <> 'validee' then raise exception 'seule une fiche clôturée se rectifie (sinon, modifiez-la ou renvoyez-la à la caisse)'; end if;

  select * into v_e from entreprises where id = v_r.entreprise_id;
  v_compte := assurer_compte_commercial(v_r.commercial_id);
  select nom into v_nom from profils where id = v_r.commercial_id;
  perform set_config('distribpro.op_sc', 'ajustement', true);

  for v_ligne in select * from jsonb_array_elements(p_lignes) loop
    select * into v_l from reconciliation_lignes
    where reconciliation_id = p_id and produit_id = (v_ligne->>'produit_id')::uuid for update;
    if not found then continue; end if;
    v_nouveau := (v_ligne->>'stock_compte')::integer;
    if v_nouveau is null or v_nouveau < 0 then raise exception 'quantité comptée invalide'; end if;
    if v_nouveau = v_l.stock_compte then continue; end if;

    -- Compté plus bas qu'enregistré → manquant supplémentaire (delta > 0).
    v_delta_qte := v_l.stock_compte - v_nouveau;
    v_delta_valeur := round(v_delta_qte * v_l.prix_valorisation, 2);

    insert into reconciliation_rectifications (entreprise_id, reconciliation_id, produit_id, ancien_compte, nouveau_compte, delta_valeur, traitement, motif, effectue_par)
    values (v_r.entreprise_id, p_id, v_l.produit_id, v_l.stock_compte, v_nouveau, v_delta_valeur, p_traitement, trim(p_motif), auth.uid());

    update reconciliation_lignes
    set stock_compte = v_nouveau, ecart = stock_theorique - v_nouveau,
        valeur_ecart = round((stock_theorique - v_nouveau) * prix_valorisation, 2)
    where id = v_l.id;

    -- Le stock en main du commercial suit le nouveau comptage.
    update stock_commercial set quantite = greatest(quantite - v_delta_qte, 0), updated_at = now()
    where commercial_id = v_r.commercial_id and produit_id = v_l.produit_id;

    v_total := v_total + v_delta_valeur;
  end loop;
  perform set_config('distribpro.op_sc', '', true);

  if v_total > 0 then
    perform passer_ecriture(v_r.entreprise_id, (now() at time zone 'Africa/Abidjan')::date, 'OD', v_r.numero || '-R',
      case when p_traitement = 'dette' then v_compte else v_e.compte_pertes_numero end, v_e.compte_stock_numero,
      'Rectification — manquant supplémentaire — ' || coalesce(v_nom, '') || ' : ' || trim(p_motif), v_total, 'reconciliation_rectification', p_id);
    if p_traitement = 'dette' then
      insert into dettes_commerciaux (entreprise_id, commercial_id, type, montant, motif, reconciliation_id, effectue_par)
      values (v_r.entreprise_id, v_r.commercial_id, 'dette', v_total, 'Rectification ' || v_r.numero || ' : ' || trim(p_motif), p_id, auth.uid());
    end if;
  elsif v_total < 0 then
    perform passer_ecriture(v_r.entreprise_id, (now() at time zone 'Africa/Abidjan')::date, 'OD', v_r.numero || '-R',
      v_e.compte_stock_numero, case when p_traitement = 'dette' then v_compte else v_e.compte_pertes_numero end,
      'Rectification — manquant réduit — ' || coalesce(v_nom, '') || ' : ' || trim(p_motif), -v_total, 'reconciliation_rectification', p_id);
    -- La dette diminue d'autant (sans passer sous zéro).
    if p_traitement = 'dette' and solde_dette_commercial(v_r.commercial_id) > 0 then
      insert into dettes_commerciaux (entreprise_id, commercial_id, type, montant, motif, reconciliation_id, effectue_par)
      values (v_r.entreprise_id, v_r.commercial_id, 'annulation', least(-v_total, solde_dette_commercial(v_r.commercial_id)),
              'Rectification ' || v_r.numero || ' : ' || trim(p_motif), p_id, auth.uid());
    end if;
  end if;

  update reconciliations_commercial r set
    valeur_manquant = coalesce((select sum(greatest(valeur_ecart, 0)) from reconciliation_lignes where reconciliation_id = p_id), 0),
    montant_dette = coalesce(montant_dette, 0) + case when p_traitement = 'dette' then v_total else 0 end,
    commentaire_comptable = coalesce(commentaire_comptable || ' | ', '') || 'Rectifiée : ' || trim(p_motif)
  where r.id = p_id;
end;
$$;

notify pgrst, 'reload schema';
