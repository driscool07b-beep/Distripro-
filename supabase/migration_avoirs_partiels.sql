-- =====================================================================
-- Avoirs partiels sur une vente
--   • Retour de marchandise ligne par ligne (quantités au choix, plusieurs
--     avoirs successifs possibles, jamais plus que la quantité vendue).
--   • Destination du stock modifiable : un magasin, ou le stock d'un
--     commercial (celui qui récupère la marchandise chez le client).
--   • Marchandise abîmée : selon le réglage de l'entreprise, enregistrée
--     en perte (ne revient pas en stock) ou remise en stock dans un
--     magasin comme lot « endommagé ».
--   • Correction de prix (vente non certifiée FNE) : avoir de valeur,
--     sans mouvement de stock.
--   • Argent : l'avoir réduit d'abord ce que le client doit encore ; la
--     part déjà payée passe au crédit du client (remboursable depuis sa
--     fiche) — ou, sans client enregistré, est notée « à rembourser ».
--   • Le total de la vente devient le montant NET (après avoirs) : chiffre
--     d'affaires, créances et rapports en tiennent compte automatiquement.
--     Le montant facturé à l'origine reste dans ventes.total_initial.
--   • Réservé à l'administrateur, au manager et au comptable.
-- À exécuter une fois dans le SQL Editor (ré-exécutable sans risque).
-- =====================================================================

-- ---------------------------------------------------------------- réglage
alter table entreprises add column if not exists avoir_marchandise_abimee text not null default 'perte';
alter table entreprises drop constraint if exists entreprises_avoir_marchandise_abimee_check;
alter table entreprises add constraint entreprises_avoir_marchandise_abimee_check
  check (avoir_marchandise_abimee in ('perte', 'stock_endommage'));

-- ---------------------------------------------------------------- ventes
-- Montant facturé à l'origine, figé au premier avoir (null tant qu'aucun avoir).
alter table ventes add column if not exists total_initial numeric(14, 2);

-- ---------------------------------------------------------------- avoirs
alter table avoirs add column if not exists numero text;
alter table avoirs add column if not exists type_avoir text not null default 'annulation';
alter table avoirs add column if not exists destination text;          -- depot | commercial | aucune
alter table avoirs add column if not exists depot_id uuid references depots(id);
alter table avoirs add column if not exists commercial_id uuid references profils(id);
alter table avoirs add column if not exists reduction_du numeric(14, 2) not null default 0;
alter table avoirs add column if not exists trop_percu numeric(14, 2) not null default 0;
alter table avoirs add column if not exists trop_percu_traitement text;  -- credit_client | a_rembourser
alter table avoirs add column if not exists fne_reference text;
alter table avoirs add column if not exists fne_token text;
alter table avoirs add column if not exists fne_statut text;
alter table avoirs add column if not exists fne_erreur text;
alter table avoirs drop constraint if exists avoirs_type_avoir_check;
alter table avoirs add constraint avoirs_type_avoir_check check (type_avoir in ('annulation', 'retour', 'prix'));
create index if not exists idx_avoirs_vente on avoirs(vente_id);

create table if not exists avoirs_lignes (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  avoir_id uuid not null references avoirs(id) on delete cascade,
  vente_ligne_id uuid not null references ventes_lignes(id),
  produit_id uuid not null references produits(id),
  quantite integer not null check (quantite > 0),
  prix_unitaire numeric(14, 2) not null,            -- prix de la vente
  prix_corrige numeric(14, 2),                      -- correction de prix uniquement
  etat text not null default 'bon' check (etat in ('bon', 'abime')),
  traitement text not null check (traitement in ('stock', 'stock_commercial', 'stock_endommage', 'perte', 'aucun')),
  montant numeric(14, 2) not null,                  -- part TTC de l'avoir pour cette ligne
  created_at timestamptz not null default now()
);
create index if not exists idx_avoirs_lignes_avoir on avoirs_lignes(avoir_id);
create index if not exists idx_avoirs_lignes_vente_ligne on avoirs_lignes(vente_ligne_id);
alter table avoirs_lignes enable row level security;
drop policy if exists avoirs_lignes_select on avoirs_lignes;
create policy avoirs_lignes_select on avoirs_lignes
  for select to authenticated using (entreprise_id = current_entreprise_id());

-- Quantités de lots déjà rendues (pour ne pas rendre deux fois le même lot).
alter table ventes_lignes_lots add column if not exists quantite_retournee integer not null default 0;

-- ---------------------------------------------------------------- calcul
-- Montant TTC d'un avoir, ligne par ligne. La part de chaque ligne suit sa
-- valeur dans la vente (remise, TVA et autres taxes réparties au prorata),
-- de sorte que rendre toute la marchandise rend exactement le total.
-- p_lignes : [{ "vente_ligne_id": uuid, "quantite": n, "prix_corrige": n? }]
create or replace function calculer_avoir_vente(p_vente_id uuid, p_type text, p_lignes jsonb)
returns table (vente_ligne_id uuid, produit_id uuid, quantite integer, prix_unitaire numeric,
               prix_corrige numeric, montant numeric, quantite_rendable integer, source_stock text)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_vente record;
  v_brut numeric;
  v_remise numeric;
  v_somme_ttc numeric;
  v_facteur numeric;
  v_decimales integer;
begin
  select v.*, coalesce(v.total_initial, v.total) as total_facture, e.devise
    into v_vente
  from ventes v join entreprises e on e.id = v.entreprise_id
  where v.id = p_vente_id and v.entreprise_id = v_entreprise_id;
  if not found then raise exception 'vente introuvable pour cette entreprise'; end if;
  if p_type not in ('retour', 'prix') then raise exception 'type d''avoir inconnu'; end if;

  v_decimales := case when coalesce(v_vente.devise, 'XOF') = 'XOF' then 0 else 2 end;
  select coalesce(sum(vl.sous_total), 0) into v_brut from ventes_lignes vl where vl.vente_id = p_vente_id;
  v_remise := case when v_brut > 0 then least(coalesce(v_vente.remise_montant, 0) / v_brut, 1) else 0 end;
  select coalesce(sum(vl.sous_total * (1 - v_remise) * (1 + coalesce(vl.taux_tva, 0) / 100)), 0)
    into v_somme_ttc from ventes_lignes vl where vl.vente_id = p_vente_id;
  v_facteur := case when v_somme_ttc > 0 then v_vente.total_facture / v_somme_ttc else 0 end;

  return query
  with demande as (
    select (x->>'vente_ligne_id')::uuid as id,
           coalesce((x->>'quantite')::numeric, 0) as q,
           nullif(x->>'prix_corrige', '')::numeric as pc
    from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) x
  ),
  deja as (
    select al.vente_ligne_id as id, sum(al.quantite) as q
    from avoirs_lignes al join avoirs a on a.id = al.avoir_id
    where a.vente_id = p_vente_id and a.type_avoir in ('retour', 'annulation')
    group by al.vente_ligne_id
  )
  select vl.id, vl.produit_id, d.q::integer, vl.prix_unitaire, d.pc,
         round(case
           when p_type = 'retour' then (d.q / nullif(vl.quantite, 0)) * vl.sous_total * (1 - v_remise) * (1 + coalesce(vl.taux_tva, 0) / 100) * v_facteur
           else d.q * greatest(vl.prix_unitaire - coalesce(d.pc, vl.prix_unitaire), 0) * (1 - v_remise) * (1 + coalesce(vl.taux_tva, 0) / 100) * v_facteur
         end, v_decimales),
         (vl.quantite - coalesce(dj.q, 0))::integer,
         coalesce(vl.source_stock, case when v_vente.depot_id is null then 'commercial' else 'depot' end)
  from demande d
  join ventes_lignes vl on vl.id = d.id and vl.vente_id = p_vente_id
  left join deja dj on dj.id = vl.id
  where d.q > 0;
end;
$$;
revoke execute on function calculer_avoir_vente(uuid, text, jsonb) from public, anon;
grant execute on function calculer_avoir_vente(uuid, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- création
-- p_lignes : [{ "vente_ligne_id", "quantite", "etat": "bon"|"abime", "prix_corrige"? }]
-- p_destination : 'depot' | 'commercial' | 'aucune' (marchandise restée chez le client)
create or replace function creer_avoir_vente(
  p_vente_id uuid,
  p_type text,
  p_lignes jsonb,
  p_motif text,
  p_destination text default null,
  p_depot_id uuid default null,
  p_commercial_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_vente record;
  v_mode_abime text;
  v_destination text;
  v_depot_id uuid;
  v_nb_depots integer;
  v_avoir_id uuid;
  v_numero text;
  v_montant numeric := 0;
  v_reste_du numeric;
  v_reduction numeric;
  v_trop_percu numeric;
  v_traitement_trop text;
  v_total_net numeric;
  v_tout_rendu boolean;
  v_type_final text;
  v_ligne record;
  v_etat text;
  v_traitement text;
  v_restant integer;
  v_part integer;
  v_lot record;
  v_numero_vente text;
  v_somme numeric;
  v_decimales integer;
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if v_role not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé : seuls l''administrateur, le manager et le comptable peuvent émettre un avoir';
  end if;
  if p_motif is null or length(trim(p_motif)) < 3 then raise exception 'un motif est requis pour émettre un avoir'; end if;
  if p_type not in ('retour', 'prix') then raise exception 'type d''avoir inconnu'; end if;
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'choisissez au moins une ligne et une quantité';
  end if;
  if (select count(*) <> count(distinct x->>'vente_ligne_id') from jsonb_array_elements(p_lignes) x) then
    raise exception 'une même ligne ne peut figurer qu''une fois dans l''avoir';
  end if;

  select * into v_vente from ventes where id = p_vente_id and entreprise_id = v_entreprise_id for update;
  if not found then raise exception 'vente introuvable pour cette entreprise'; end if;
  if v_vente.statut = 'annulee' then raise exception 'cette vente a déjà été entièrement annulée par avoir'; end if;
  if p_type = 'prix' and v_vente.fne_statut = 'certifiee' then
    raise exception 'vente certifiée FNE : la DGI n''accepte pas d''avoir sur le prix. Faites un avoir de la ligne (marchandise restée chez le client) puis une nouvelle vente au bon prix';
  end if;
  v_numero_vente := coalesce(v_vente.numero_vente, left(p_vente_id::text, 8));
  select avoir_marchandise_abimee into v_mode_abime from entreprises where id = v_entreprise_id;

  -- Destination de la marchandise en bon état.
  v_destination := case when p_type = 'prix' then 'aucune' else coalesce(p_destination, 'depot') end;
  if v_destination not in ('depot', 'commercial', 'aucune') then raise exception 'destination inconnue'; end if;
  if v_destination = 'commercial' then
    if p_commercial_id is null then raise exception 'choisissez le commercial qui récupère la marchandise'; end if;
    perform 1 from profils where id = p_commercial_id and entreprise_id = v_entreprise_id and role = 'commercial';
    if not found then raise exception 'commercial introuvable'; end if;
  end if;
  -- Magasin : celui indiqué, sinon celui de la vente, sinon le seul magasin actif.
  v_depot_id := coalesce(p_depot_id, v_vente.depot_id);
  if v_depot_id is null then
    select count(*) into v_nb_depots from depots where entreprise_id = v_entreprise_id and actif = true;
    if v_nb_depots = 1 then
      select id into v_depot_id from depots where entreprise_id = v_entreprise_id and actif = true limit 1;
    end if;
  end if;
  if v_depot_id is not null then
    perform 1 from depots where id = v_depot_id and entreprise_id = v_entreprise_id;
    if not found then raise exception 'magasin introuvable'; end if;
  end if;

  -- Contrôle des lignes et calcul du montant.
  create temporary table if not exists tmp_avoir (
    vente_ligne_id uuid, produit_id uuid, quantite integer, prix_unitaire numeric,
    prix_corrige numeric, montant numeric, quantite_rendable integer, source_stock text, etat text
  ) on commit drop;
  delete from tmp_avoir where true; -- « where » exigé par la protection de Supabase (safeupdate)
  insert into tmp_avoir
  select c.*, coalesce(nullif(x->>'etat', ''), 'bon')
  from calculer_avoir_vente(p_vente_id, p_type, p_lignes) c
  join jsonb_array_elements(p_lignes) x on (x->>'vente_ligne_id')::uuid = c.vente_ligne_id;

  if not exists (select 1 from tmp_avoir) then raise exception 'choisissez au moins une ligne et une quantité'; end if;
  if exists (select 1 from tmp_avoir where etat not in ('bon', 'abime')) then raise exception 'état de marchandise inconnu'; end if;
  if exists (select 1 from tmp_avoir t join ventes_lignes vl on vl.id = t.vente_ligne_id where t.quantite <> (
      select (x->>'quantite')::numeric from jsonb_array_elements(p_lignes) x where (x->>'vente_ligne_id')::uuid = t.vente_ligne_id limit 1)) then
    raise exception 'les quantités doivent être des nombres entiers';
  end if;
  if exists (select 1 from tmp_avoir where quantite > quantite_rendable) then
    raise exception 'quantité supérieure à ce qui reste à rendre sur cette vente';
  end if;
  if p_type = 'prix' and exists (select 1 from tmp_avoir where prix_corrige is null or prix_corrige < 0 or prix_corrige >= prix_unitaire) then
    raise exception 'le prix corrigé doit être inférieur au prix de la vente';
  end if;
  if p_type = 'retour' and v_destination = 'depot' and v_depot_id is null and exists (select 1 from tmp_avoir where etat = 'bon') then
    raise exception 'précisez le magasin où la marchandise est rendue';
  end if;
  if p_type = 'retour' and v_mode_abime = 'stock_endommage' and v_depot_id is null and exists (select 1 from tmp_avoir where etat = 'abime') then
    raise exception 'précisez le magasin qui reçoit la marchandise abîmée';
  end if;

  select coalesce(sum(montant), 0) into v_montant from tmp_avoir;

  -- Tout est-il rendu après cet avoir ? (retours uniquement)
  v_tout_rendu := p_type = 'retour' and not exists (
    select 1 from ventes_lignes vl
    left join tmp_avoir t on t.vente_ligne_id = vl.id
    where vl.vente_id = p_vente_id
      and vl.quantite - coalesce((select sum(al.quantite) from avoirs_lignes al join avoirs a on a.id = al.avoir_id
                                  where al.vente_ligne_id = vl.id and a.type_avoir in ('retour', 'annulation')), 0)
          - coalesce(t.quantite, 0) > 0
  );
  -- Tout rendu : l'avoir solde exactement le montant net restant (pas d'écart d'arrondi).
  if v_tout_rendu then v_montant := v_vente.total; end if;
  v_montant := least(v_montant, v_vente.total);
  if v_montant <= 0 then raise exception 'le montant de cet avoir est nul'; end if;
  -- Les montants par ligne doivent totaliser exactement l'avoir (après
  -- ajustement « tout rendu » ou plafonnement au montant net restant).
  select coalesce(sum(montant), 0) into v_somme from tmp_avoir;
  if v_somme > 0 and v_somme <> v_montant then
    select case when coalesce(devise, 'XOF') = 'XOF' then 0 else 2 end into v_decimales from entreprises where id = v_entreprise_id;
    update tmp_avoir set montant = round(montant * v_montant / v_somme, v_decimales) where true;
    update tmp_avoir set montant = montant + (v_montant - (select sum(montant) from tmp_avoir))
    where vente_ligne_id = (select vente_ligne_id from tmp_avoir order by montant desc limit 1);
  end if;

  -- Argent : d'abord ce que le client doit encore, le reste a déjà été payé.
  v_reste_du := greatest(v_vente.total - coalesce(v_vente.montant_regle, 0), 0);
  v_reduction := least(v_montant, v_reste_du);
  v_trop_percu := v_montant - v_reduction;
  v_total_net := v_vente.total - v_montant;
  v_traitement_trop := case when v_trop_percu > 0 then (case when v_vente.client_id is not null then 'credit_client' else 'a_rembourser' end) end;
  v_type_final := case when v_tout_rendu then 'annulation' else p_type end;

  -- Numéro d'avoir : AV-AAAA-nnnnn, séquentiel par entreprise.
  perform pg_advisory_xact_lock(hashtext('avoir-' || v_entreprise_id::text));
  select 'AV-' || to_char(now(), 'YYYY') || '-' || lpad((count(*) + 1)::text, 5, '0') into v_numero
  from avoirs where entreprise_id = v_entreprise_id and numero like 'AV-' || to_char(now(), 'YYYY') || '-%';

  insert into avoirs (entreprise_id, vente_id, motif, montant, created_by, numero, type_avoir, destination,
                      depot_id, commercial_id, reduction_du, trop_percu, trop_percu_traitement)
  values (v_entreprise_id, p_vente_id, trim(p_motif), v_montant, auth.uid(), v_numero, v_type_final, v_destination,
          v_depot_id, case when v_destination = 'commercial' then p_commercial_id end, v_reduction, v_trop_percu, v_traitement_trop)
  returning id into v_avoir_id;

  -- Lignes et mouvements de stock.
  for v_ligne in select * from tmp_avoir loop
    v_traitement := case
      when p_type = 'prix' or v_destination = 'aucune' then 'aucun'
      when v_ligne.etat = 'abime' then (case when v_mode_abime = 'stock_endommage' then 'stock_endommage' else 'perte' end)
      when v_destination = 'commercial' then 'stock_commercial'
      else 'stock' end;

    insert into avoirs_lignes (entreprise_id, avoir_id, vente_ligne_id, produit_id, quantite, prix_unitaire, prix_corrige, etat, traitement, montant)
    values (v_entreprise_id, v_avoir_id, v_ligne.vente_ligne_id, v_ligne.produit_id, v_ligne.quantite, v_ligne.prix_unitaire,
            v_ligne.prix_corrige, v_ligne.etat, v_traitement, v_ligne.montant);

    if v_traitement = 'stock' then
      insert into stocks (entreprise_id, produit_id, depot_id, quantite)
      values (v_entreprise_id, v_ligne.produit_id, v_depot_id, v_ligne.quantite)
      on conflict (produit_id, depot_id) do update set quantite = stocks.quantite + excluded.quantite, updated_at = now();
      insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
      values (v_entreprise_id, v_ligne.produit_id, v_depot_id, 'entree', v_ligne.quantite,
              'Avoir ' || v_numero || ' sur vente ' || v_numero_vente || ' — ' || trim(p_motif), auth.uid());

      -- Lots : on rend les lots consommés par cette ligne (même numéro de lot,
      -- dans le magasin de retour). Lignes vendues depuis le stock d'un
      -- commercial : pas de lot rattaché à la vente, rien à rendre.
      v_restant := v_ligne.quantite;
      for v_lot in
        select vll.id as vll_id, vll.quantite - vll.quantite_retournee as dispo, l.*
        from ventes_lignes_lots vll join lots l on l.id = vll.lot_id
        where vll.vente_ligne_id = v_ligne.vente_ligne_id and vll.quantite > vll.quantite_retournee
        order by l.date_peremption desc nulls first, l.created_at desc
      loop
        exit when v_restant <= 0;
        v_part := least(v_restant, v_lot.dispo);
        update ventes_lignes_lots set quantite_retournee = quantite_retournee + v_part where id = v_lot.vll_id;
        if v_lot.depot_id = v_depot_id then
          update lots set quantite_restante = quantite_restante + v_part where id = v_lot.id;
        else
          insert into lots (entreprise_id, produit_id, depot_id, numero_lot, date_production, date_peremption,
                            quantite_initiale, quantite_restante, created_by)
          values (v_entreprise_id, v_lot.produit_id, v_depot_id, v_lot.numero_lot, v_lot.date_production, v_lot.date_peremption,
                  v_part, v_part, auth.uid())
          on conflict (entreprise_id, produit_id, depot_id, numero_lot) do update
            set quantite_restante = lots.quantite_restante + excluded.quantite_restante,
                quantite_initiale = lots.quantite_initiale + excluded.quantite_initiale;
        end if;
        v_restant := v_restant - v_part;
      end loop;

    elsif v_traitement = 'stock_commercial' then
      -- Journal du stock du commercial : enregistré comme « vente » négative
      -- (la vente nette du commercial diminue), cohérent avec la réconciliation.
      perform set_config('distribpro.op_sc', 'vente', true);
      insert into stock_commercial (entreprise_id, commercial_id, produit_id, depot_origine, quantite)
      values (v_entreprise_id, p_commercial_id, v_ligne.produit_id, v_vente.depot_id, v_ligne.quantite)
      on conflict (commercial_id, produit_id) do update set quantite = stock_commercial.quantite + excluded.quantite, updated_at = now();

    elsif v_traitement = 'stock_endommage' then
      insert into stocks (entreprise_id, produit_id, depot_id, quantite)
      values (v_entreprise_id, v_ligne.produit_id, v_depot_id, v_ligne.quantite)
      on conflict (produit_id, depot_id) do update set quantite = stocks.quantite + excluded.quantite, updated_at = now();
      insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
      values (v_entreprise_id, v_ligne.produit_id, v_depot_id, 'entree', v_ligne.quantite,
              'Avoir ' || v_numero || ' — marchandise abîmée — ' || trim(p_motif), auth.uid());
      insert into lots (entreprise_id, produit_id, depot_id, numero_lot, quantite_initiale, quantite_restante, created_by, etat, etat_motif)
      values (v_entreprise_id, v_ligne.produit_id, v_depot_id, 'ABIME-' || v_numero, v_ligne.quantite, v_ligne.quantite, auth.uid(),
              'endommage', 'Retour client abîmé — avoir ' || v_numero)
      on conflict (entreprise_id, produit_id, depot_id, numero_lot) do update
        set quantite_restante = lots.quantite_restante + excluded.quantite_restante,
            quantite_initiale = lots.quantite_initiale + excluded.quantite_initiale;
    end if;
    -- 'perte' et 'aucun' : pas de mouvement de stock (la marchandise ne revient pas).
  end loop;

  -- Vente : total net, montant réglé plafonné, statut.
  update ventes set
    total_initial = coalesce(total_initial, total),
    total = v_total_net,
    montant_regle = coalesce(montant_regle, 0) - v_trop_percu,
    statut = case when v_tout_rendu then 'annulee' else statut end
  where id = p_vente_id;

  -- Part déjà payée : au crédit du client.
  if v_trop_percu > 0 and v_vente.client_id is not null then
    update clients set solde_credit = coalesce(solde_credit, 0) + v_trop_percu
    where id = v_vente.client_id and entreprise_id = v_entreprise_id;
    insert into mouvements_credit_client (entreprise_id, client_id, montant, type_mouvement, vente_id, motif, effectue_par)
    values (v_entreprise_id, v_vente.client_id, v_trop_percu, 'credit_annulation', p_vente_id,
            'Avoir ' || v_numero || ' — ' || trim(p_motif), auth.uid());
  end if;

  return jsonb_build_object(
    'avoir_id', v_avoir_id, 'numero', v_numero, 'montant', v_montant, 'reduction_du', v_reduction,
    'trop_percu', v_trop_percu, 'traitement_trop_percu', v_traitement_trop, 'tout_rendu', v_tout_rendu,
    'certifier_fne', coalesce(v_vente.fne_statut = 'certifiee', false) and p_type = 'retour'
  );
end;
$$;
revoke execute on function creer_avoir_vente(uuid, text, jsonb, text, text, uuid, uuid) from public, anon;
grant execute on function creer_avoir_vente(uuid, text, jsonb, text, text, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- caisse
-- Argent physiquement encaissé sur une vente : un avoir ne « désencaisse »
-- pas l'argent déjà perçu (il passe au crédit du client ou reste à
-- rembourser) ; on le rajoute donc au montant réglé, qui a été réduit.
create or replace function encaisse_physique_vente(p_vente_id uuid)
returns numeric
language sql
security definer
stable
set search_path to 'public'
as $$
  select case when coalesce(v.mode_reglement, 'espece') in ('espece', 'cheque')
    then greatest(
      v.montant_regle
      + coalesce((select sum(a.trop_percu) from avoirs a where a.vente_id = v.id), 0)
      - coalesce((select sum(m.montant) from mouvements_credit_client m
                  where m.vente_id = v.id and m.type_mouvement = 'utilisation_vente'), 0), 0)
    else 0 end
  from ventes v where v.id = p_vente_id;
$$;

-- ---------------------------------------------------------------- réglage
create or replace function modifier_parametrage_avoirs(p_marchandise_abimee text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_entreprise_id() is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'manager') then raise exception 'accès refusé : réservé à l''administrateur et au manager'; end if;
  if p_marchandise_abimee not in ('perte', 'stock_endommage') then raise exception 'choix inconnu'; end if;
  update entreprises set avoir_marchandise_abimee = p_marchandise_abimee where id = current_entreprise_id();
end;
$$;
revoke execute on function modifier_parametrage_avoirs(text) from public, anon;
grant execute on function modifier_parametrage_avoirs(text) to authenticated, service_role;

-- Enregistrement de la certification FNE d'un avoir (appelé par la fonction serveur).
grant select, update on avoirs to service_role;

notify pgrst, 'reload schema';

-- Contrôle : doit renvoyer 3 lignes (les trois fonctions créées).
select proname from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('calculer_avoir_vente', 'creer_avoir_vente', 'modifier_parametrage_avoirs');
