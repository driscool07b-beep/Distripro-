-- Migration : le transfert entre dépôts devient un workflow en deux temps
-- au lieu d'un mouvement instantané :
--   1. Envoi : débite le dépôt source immédiatement (la marchandise a
--      physiquement quitté le dépôt), crée un transfert au statut
--      'en_transit'. Le dépôt destination n'est PAS encore crédité.
--   2. Réception : le gestionnaire du dépôt destination contrôle les
--      quantités reçues et valide — c'est à ce moment que le stock
--      destination est crédité, avec la quantité réellement reçue (qui
--      peut différer de la quantité envoyée : casse en transport, écart
--      de comptage…).
--
-- Autorisation : envoyer un transfert ne nécessite d'être habilité que
-- sur le dépôt SOURCE (pas la destination — quelqu'un d'autre, à
-- l'arrivée, contrôle et valide). Réceptionner nécessite d'être habilité
-- sur le dépôt DESTINATION.
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Table des transferts en cours / historique.
-- ---------------------------------------------------------------------
create table if not exists transferts_stock (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  produit_id uuid not null references produits(id) on delete cascade,
  depot_source_id uuid not null references depots(id),
  depot_destination_id uuid not null references depots(id),
  quantite_envoyee integer not null check (quantite_envoyee > 0),
  quantite_recue integer check (quantite_recue >= 0),
  statut text not null default 'en_transit' check (statut in ('en_transit', 'receptionne')),
  motif text,
  mouvement_sortie_id uuid references mouvements_stock(id),
  mouvement_entree_id uuid references mouvements_stock(id),
  envoye_par uuid references profils(id),
  envoye_at timestamptz not null default now(),
  receptionne_par uuid references profils(id),
  receptionne_at timestamptz
);

create index if not exists idx_transferts_stock_entreprise on transferts_stock(entreprise_id);
create index if not exists idx_transferts_stock_destination_statut on transferts_stock(depot_destination_id, statut);

alter table transferts_stock enable row level security;

drop policy if exists transferts_stock_select on transferts_stock;
create policy transferts_stock_select on transferts_stock
  for select using (
    entreprise_id = current_entreprise_id()
    and (
      current_role_utilisateur() in ('admin', 'manager')
      or exists (
        select 1 from gestionnaire_depots gd
        where gd.profil_id = auth.uid() and gd.depot_id in (depot_source_id, depot_destination_id)
      )
    )
  );

-- ---------------------------------------------------------------------
-- 2. Envoi : débite le dépôt source, crée le transfert 'en_transit'.
--    Signature inchangée par rapport à la version précédente (même type
--    de retour jsonb) : CREATE OR REPLACE la remplace en place.
-- ---------------------------------------------------------------------
create or replace function transferer_stock(
  p_produit_id uuid,
  p_depot_source_id uuid,
  p_depot_destination_id uuid,
  p_quantite integer,
  p_motif text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_nom_destination text;
  v_stock_source integer;
  v_mouvement_sortie_id uuid;
  v_transfert_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de transférer du stock';
  end if;
  if p_quantite is null or p_quantite <= 0 then
    raise exception 'la quantité doit être supérieure à zéro';
  end if;
  if p_depot_source_id = p_depot_destination_id then
    raise exception 'le dépôt source et le dépôt destination doivent être différents';
  end if;
  if not mon_depot_autorise(p_depot_source_id) then
    raise exception 'accès refusé : le dépôt source ne vous est pas attribué';
  end if;

  perform 1 from depots where id = p_depot_source_id and entreprise_id = v_entreprise_id and actif = true;
  if not found then
    raise exception 'dépôt source introuvable ou inactif pour cette entreprise';
  end if;
  select nom into v_nom_destination from depots where id = p_depot_destination_id and entreprise_id = v_entreprise_id and actif = true;
  if v_nom_destination is null then
    raise exception 'dépôt destination introuvable ou inactif pour cette entreprise';
  end if;

  select quantite into v_stock_source
  from stocks
  where produit_id = p_produit_id and depot_id = p_depot_source_id and entreprise_id = v_entreprise_id
  for update;

  if v_stock_source is null then
    raise exception 'produit introuvable dans le dépôt source';
  end if;
  if v_stock_source < p_quantite then
    raise exception 'stock insuffisant dans le dépôt source';
  end if;

  update stocks
  set quantite = quantite - p_quantite, updated_at = now()
  where produit_id = p_produit_id and depot_id = p_depot_source_id and entreprise_id = v_entreprise_id;

  insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
  values (
    v_entreprise_id, p_produit_id, p_depot_source_id, 'sortie', p_quantite,
    'Transfert vers ' || v_nom_destination || ' (en transit)' || case when p_motif is not null and trim(p_motif) <> '' then ' — ' || trim(p_motif) else '' end,
    auth.uid()
  )
  returning id into v_mouvement_sortie_id;

  insert into transferts_stock (
    entreprise_id, produit_id, depot_source_id, depot_destination_id,
    quantite_envoyee, motif, mouvement_sortie_id, envoye_par
  )
  values (
    v_entreprise_id, p_produit_id, p_depot_source_id, p_depot_destination_id,
    p_quantite, p_motif, v_mouvement_sortie_id, auth.uid()
  )
  returning id into v_transfert_id;

  return jsonb_build_object('transfert_id', v_transfert_id, 'mouvement_sortie_id', v_mouvement_sortie_id);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Réception : contrôle des quantités reçues, crédite le dépôt
--    destination avec la quantité réellement reçue (pas forcément
--    identique à celle envoyée).
-- ---------------------------------------------------------------------
create or replace function receptionner_transfert(
  p_transfert_id uuid,
  p_quantite_recue integer,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_transfert record;
  v_nom_source text;
  v_motif text;
  v_mouvement_entree_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de réceptionner un transfert';
  end if;
  if p_quantite_recue is null or p_quantite_recue < 0 then
    raise exception 'la quantité reçue doit être positive ou nulle';
  end if;

  select * into v_transfert
  from transferts_stock
  where id = p_transfert_id and entreprise_id = v_entreprise_id
  for update;

  if not found then
    raise exception 'transfert introuvable pour cette entreprise';
  end if;
  if v_transfert.statut = 'receptionne' then
    raise exception 'ce transfert a déjà été réceptionné';
  end if;
  if not mon_depot_autorise(v_transfert.depot_destination_id) then
    raise exception 'accès refusé : le dépôt destination ne vous est pas attribué';
  end if;

  select nom into v_nom_source from depots where id = v_transfert.depot_source_id;

  v_motif := 'Réception transfert depuis ' || coalesce(v_nom_source, 'dépôt inconnu');
  if p_quantite_recue <> v_transfert.quantite_envoyee then
    v_motif := v_motif || format(' — écart : envoyé %s, reçu %s', v_transfert.quantite_envoyee, p_quantite_recue);
  end if;
  if p_note is not null and trim(p_note) <> '' then
    v_motif := v_motif || ' — ' || trim(p_note);
  end if;

  if p_quantite_recue > 0 then
    insert into stocks (entreprise_id, produit_id, depot_id, quantite)
    values (v_entreprise_id, v_transfert.produit_id, v_transfert.depot_destination_id, p_quantite_recue)
    on conflict (produit_id, depot_id)
    do update set quantite = stocks.quantite + excluded.quantite, updated_at = now();

    insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
    values (v_entreprise_id, v_transfert.produit_id, v_transfert.depot_destination_id, 'entree', p_quantite_recue, v_motif, auth.uid())
    returning id into v_mouvement_entree_id;
  end if;
  -- Si p_quantite_recue = 0 (perte totale en transit), aucun mouvement de
  -- stock n'est créé (la contrainte quantite > 0 l'interdit de toute
  -- façon) : la perte reste tracée dans transferts_stock.quantite_recue
  -- et le motif calculé plus haut, consultable sur le transfert lui-même.

  update transferts_stock
  set statut = 'receptionne',
      quantite_recue = p_quantite_recue,
      receptionne_par = auth.uid(),
      receptionne_at = now(),
      mouvement_entree_id = v_mouvement_entree_id
  where id = p_transfert_id;

  return v_mouvement_entree_id;
end;
$$;
