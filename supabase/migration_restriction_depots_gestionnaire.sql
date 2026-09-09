-- Migration : un gestionnaire de stock ne doit pouvoir agir que sur les
-- dépôts qui lui sont attribués (s'il y a plusieurs magasins, chacun a
-- probablement son propre gestionnaire). admin/manager gardent un accès
-- total à tous les dépôts, comme partout ailleurs dans l'app.
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Table de liaison gestionnaire ↔ dépôts (plusieurs dépôts possibles
--    par gestionnaire, ex. quelqu'un qui supervise deux petits magasins).
-- ---------------------------------------------------------------------
create table if not exists gestionnaire_depots (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  profil_id uuid not null references profils(id) on delete cascade,
  depot_id uuid not null references depots(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profil_id, depot_id)
);

create index if not exists idx_gestionnaire_depots_profil on gestionnaire_depots(profil_id);

alter table gestionnaire_depots enable row level security;

drop policy if exists gestionnaire_depots_select on gestionnaire_depots;
create policy gestionnaire_depots_select on gestionnaire_depots
  for select using (entreprise_id = current_entreprise_id());

-- ---------------------------------------------------------------------
-- 2. Fonction de vérification, réutilisée par toutes les fonctions de
--    mouvement de stock. admin/manager : toujours autorisés. gestionnaire
--    de stock : seulement les dépôts attribués. Tout autre rôle : refusé
--    (les fonctions appelantes vérifient déjà le rôle avant d'en arriver
--    là, ceci est une sécurité supplémentaire).
-- ---------------------------------------------------------------------
create or replace function mon_depot_autorise(p_depot_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role text := current_role_utilisateur();
begin
  if v_role in ('admin', 'manager') then
    return true;
  end if;
  if v_role = 'gestionnaire_stock' then
    return exists (
      select 1 from gestionnaire_depots
      where profil_id = auth.uid() and depot_id = p_depot_id
    );
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. RPC d'attribution (admin uniquement), même pattern que
--    modifier_membre_equipe : remplace l'ensemble des dépôts attribués,
--    trace le changement dans le journal d'administration.
-- ---------------------------------------------------------------------
create or replace function assigner_depots_gestionnaire(p_profil_id uuid, p_depot_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role_appelant text := current_role_utilisateur();
  v_noms_avant text;
  v_noms_apres text;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role_appelant <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut attribuer des dépôts';
  end if;

  perform 1 from profils where id = p_profil_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'membre introuvable pour cette entreprise';
  end if;

  select string_agg(d.nom, ', ' order by d.nom) into v_noms_avant
  from gestionnaire_depots gd join depots d on d.id = gd.depot_id
  where gd.profil_id = p_profil_id;

  delete from gestionnaire_depots where profil_id = p_profil_id and entreprise_id = v_entreprise_id;

  if p_depot_ids is not null and array_length(p_depot_ids, 1) > 0 then
    insert into gestionnaire_depots (entreprise_id, profil_id, depot_id)
    select v_entreprise_id, p_profil_id, d.id
    from depots d
    where d.id = any(p_depot_ids) and d.entreprise_id = v_entreprise_id;
  end if;

  select string_agg(d.nom, ', ' order by d.nom) into v_noms_apres
  from gestionnaire_depots gd join depots d on d.id = gd.depot_id
  where gd.profil_id = p_profil_id;

  if coalesce(v_noms_avant, '') <> coalesce(v_noms_apres, '') then
    insert into journal_administration (entreprise_id, effectue_par, cible_profil_id, action, details)
    values (
      v_entreprise_id, auth.uid(), p_profil_id, 'attribution_depots',
      format('dépôts : %s → %s.', coalesce(v_noms_avant, 'aucun'), coalesce(v_noms_apres, 'aucun'))
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Ajout du contrôle dans les fonctions de mouvement de stock
--    existantes (mêmes signatures qu'avant : CREATE OR REPLACE les
--    remplace en place, pas de doublon).
-- ---------------------------------------------------------------------

create or replace function ajuster_stock(
  p_produit_id uuid,
  p_type text,
  p_quantite integer,
  p_motif text,
  p_depot_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_quantite_actuelle integer;
  v_depot_id uuid;
  v_nb_depots integer;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattache a une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas d''ajuster le stock magasin';
  end if;
  if p_type not in ('entree', 'sortie') then
    raise exception 'type de mouvement invalide';
  end if;

  if p_depot_id is not null then
    v_depot_id := p_depot_id;
  else
    select count(*) into v_nb_depots from depots where entreprise_id = v_entreprise_id and actif = true;
    if v_nb_depots > 1 then
      raise exception 'plusieurs dépôts existent — précisez le dépôt à ajuster';
    end if;
    select id into v_depot_id from depots where entreprise_id = v_entreprise_id and actif = true limit 1;
  end if;

  if not mon_depot_autorise(v_depot_id) then
    raise exception 'accès refusé : ce dépôt ne vous est pas attribué';
  end if;

  select quantite into v_quantite_actuelle
  from stocks
  where produit_id = p_produit_id and depot_id = v_depot_id and entreprise_id = v_entreprise_id
  for update;

  if v_quantite_actuelle is null then
    raise exception 'produit introuvable dans ce dépôt pour cette entreprise';
  end if;

  if p_type = 'sortie' and v_quantite_actuelle < p_quantite then
    raise exception 'stock insuffisant';
  end if;

  update stocks
  set quantite = quantite + (case when p_type = 'entree' then p_quantite else -p_quantite end),
      updated_at = now()
  where produit_id = p_produit_id and depot_id = v_depot_id and entreprise_id = v_entreprise_id;

  insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
  values (v_entreprise_id, p_produit_id, v_depot_id, p_type, p_quantite, p_motif, auth.uid());
end;
$$;

create or replace function creer_produit(
  p_nom text,
  p_categorie text,
  p_prix_vente numeric,
  p_seuil_alerte integer,
  p_quantite_initiale integer,
  p_depot_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_produit_id uuid;
  v_depot_principal uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de créer un produit';
  end if;

  if v_role = 'gestionnaire_stock' and p_depot_id is null then
    raise exception 'précisez le dépôt de stockage initial';
  end if;

  if p_depot_id is not null then
    perform 1 from depots where id = p_depot_id and entreprise_id = v_entreprise_id and actif = true;
    if not found then
      raise exception 'dépôt introuvable ou inactif pour cette entreprise';
    end if;
    if not mon_depot_autorise(p_depot_id) then
      raise exception 'accès refusé : ce dépôt ne vous est pas attribué';
    end if;
    v_depot_principal := p_depot_id;
  else
    select id into v_depot_principal
    from depots
    where entreprise_id = v_entreprise_id and actif = true
    order by nom
    limit 1;
  end if;

  if v_depot_principal is null then
    raise exception 'aucun depot actif trouve pour cette entreprise';
  end if;

  insert into produits (entreprise_id, nom, categorie, prix_vente, seuil_alerte)
  values (v_entreprise_id, p_nom, p_categorie, p_prix_vente, p_seuil_alerte)
  returning id into v_produit_id;

  insert into stocks (entreprise_id, produit_id, depot_id, quantite)
  select v_entreprise_id, v_produit_id, d.id,
    case when d.id = v_depot_principal then coalesce(p_quantite_initiale, 0) else 0 end
  from depots d
  where d.entreprise_id = v_entreprise_id and d.actif = true;

  if coalesce(p_quantite_initiale, 0) > 0 then
    insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
    values (v_entreprise_id, v_produit_id, v_depot_principal, 'entree', p_quantite_initiale, 'Stock initial', auth.uid());
  end if;

  return v_produit_id;
end;
$$;

create or replace function creer_sortie_stock(p_commercial_id uuid, p_depot_id uuid, p_lignes jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_sortie_id uuid;
  v_ligne jsonb;
  v_produit_id uuid;
  v_quantite integer;
  v_prix numeric(14,2);
  v_stock_actuel integer;
  v_nom_commercial text;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas d''émettre une sortie de stock';
  end if;
  if not mon_depot_autorise(p_depot_id) then
    raise exception 'accès refusé : ce dépôt ne vous est pas attribué';
  end if;
  if jsonb_array_length(p_lignes) = 0 then
    raise exception 'la sortie doit contenir au moins un article';
  end if;

  select nom into v_nom_commercial from profils where id = p_commercial_id and entreprise_id = v_entreprise_id;
  if v_nom_commercial is null then
    raise exception 'commercial introuvable pour cette entreprise';
  end if;

  insert into sorties_stock (entreprise_id, commercial_id, depot_id, cree_par)
  values (v_entreprise_id, p_commercial_id, p_depot_id, auth.uid())
  returning id into v_sortie_id;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_quantite := (v_ligne->>'quantite')::integer;

    select quantite, prix_vente into v_stock_actuel, v_prix
    from stocks
    join produits on produits.id = stocks.produit_id
    where stocks.produit_id = v_produit_id and stocks.depot_id = p_depot_id and stocks.entreprise_id = v_entreprise_id
    for update;

    if v_stock_actuel is null then
      raise exception 'produit introuvable dans ce dépôt';
    end if;
    if v_stock_actuel < v_quantite then
      raise exception 'stock magasin insuffisant pour ce produit';
    end if;

    insert into sortie_stock_lignes (entreprise_id, sortie_id, produit_id, quantite_sortie, prix_unitaire)
    values (v_entreprise_id, v_sortie_id, v_produit_id, v_quantite, v_prix);

    update stocks
    set quantite = quantite - v_quantite, updated_at = now()
    where produit_id = v_produit_id and depot_id = p_depot_id and entreprise_id = v_entreprise_id;

    insert into stock_commercial (entreprise_id, commercial_id, produit_id, depot_origine, quantite)
    values (v_entreprise_id, p_commercial_id, v_produit_id, p_depot_id, v_quantite)
    on conflict (commercial_id, produit_id)
    do update set quantite = stock_commercial.quantite + excluded.quantite, updated_at = now();

    insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
    values (v_entreprise_id, v_produit_id, p_depot_id, 'sortie', v_quantite, 'Sortie vers commercial ' || v_nom_commercial, auth.uid());
  end loop;

  return v_sortie_id;
end;
$$;

create or replace function retourner_stock(p_sortie_id uuid, p_lignes_retour jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_commercial_id uuid;
  v_nom_commercial text;
  v_depot_id uuid;
  v_statut text;
  v_ligne jsonb;
  v_produit_id uuid;
  v_qte_retour integer;
  v_qte_en_main integer;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas d''enregistrer un retour de stock';
  end if;

  select commercial_id, depot_id, statut into v_commercial_id, v_depot_id, v_statut
  from sorties_stock
  where id = p_sortie_id and entreprise_id = v_entreprise_id
  for update;

  if v_commercial_id is null then
    raise exception 'sortie introuvable pour cette entreprise';
  end if;
  if v_statut = 'cloturee' then
    raise exception 'cette sortie a déjà été clôturée';
  end if;
  if not mon_depot_autorise(v_depot_id) then
    raise exception 'accès refusé : ce dépôt ne vous est pas attribué';
  end if;

  select nom into v_nom_commercial from profils where id = v_commercial_id;

  for v_ligne in select * from jsonb_array_elements(p_lignes_retour)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_qte_retour := (v_ligne->>'quantite_retournee')::integer;

    select quantite into v_qte_en_main
    from stock_commercial
    where commercial_id = v_commercial_id and produit_id = v_produit_id and entreprise_id = v_entreprise_id
    for update;

    if v_qte_en_main is null then
      v_qte_en_main := 0;
    end if;
    if v_qte_retour > v_qte_en_main then
      raise exception 'quantité retournée (%) supérieure au stock actuellement en possession du commercial (%)', v_qte_retour, v_qte_en_main;
    end if;

    update sortie_stock_lignes
    set quantite_retournee = v_qte_retour
    where sortie_id = p_sortie_id and produit_id = v_produit_id;

    update stock_commercial
    set quantite = quantite - v_qte_retour, updated_at = now()
    where commercial_id = v_commercial_id and produit_id = v_produit_id and entreprise_id = v_entreprise_id;

    if v_qte_retour > 0 then
      update stocks
      set quantite = quantite + v_qte_retour, updated_at = now()
      where produit_id = v_produit_id and depot_id = v_depot_id and entreprise_id = v_entreprise_id;

      insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
      values (v_entreprise_id, v_produit_id, v_depot_id, 'entree', v_qte_retour, 'Retour de tournée — commercial ' || coalesce(v_nom_commercial, v_commercial_id::text), auth.uid());
    end if;
  end loop;

  update sorties_stock
  set statut = 'cloturee', cloture_par = auth.uid(), cloture_at = now()
  where id = p_sortie_id;
end;
$$;

-- Sécurité : si transferer_stock existe encore avec l'ancienne signature
-- (retournait du texte au lieu de jsonb), on la supprime avant de la
-- recréer, sinon CREATE OR REPLACE refuse le changement de type de retour.
drop function if exists transferer_stock(uuid, uuid, uuid, integer, text);

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
  v_nom_source text;
  v_nom_destination text;
  v_stock_source integer;
  v_mouvement_sortie_id uuid;
  v_mouvement_entree_id uuid;
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
  if not mon_depot_autorise(p_depot_source_id) or not mon_depot_autorise(p_depot_destination_id) then
    raise exception 'accès refusé : l''un de ces dépôts ne vous est pas attribué';
  end if;

  select nom into v_nom_source from depots where id = p_depot_source_id and entreprise_id = v_entreprise_id and actif = true;
  select nom into v_nom_destination from depots where id = p_depot_destination_id and entreprise_id = v_entreprise_id and actif = true;
  if v_nom_source is null or v_nom_destination is null then
    raise exception 'dépôt introuvable ou inactif pour cette entreprise';
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

  perform 1 from stocks
  where produit_id = p_produit_id and depot_id = p_depot_destination_id and entreprise_id = v_entreprise_id
  for update;

  update stocks
  set quantite = quantite - p_quantite, updated_at = now()
  where produit_id = p_produit_id and depot_id = p_depot_source_id and entreprise_id = v_entreprise_id;

  insert into stocks (entreprise_id, produit_id, depot_id, quantite)
  values (v_entreprise_id, p_produit_id, p_depot_destination_id, p_quantite)
  on conflict (produit_id, depot_id)
  do update set quantite = stocks.quantite + excluded.quantite, updated_at = now();

  insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
  values (
    v_entreprise_id, p_produit_id, p_depot_source_id, 'sortie', p_quantite,
    'Transfert vers ' || v_nom_destination || case when p_motif is not null and trim(p_motif) <> '' then ' — ' || trim(p_motif) else '' end,
    auth.uid()
  )
  returning id into v_mouvement_sortie_id;

  insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
  values (
    v_entreprise_id, p_produit_id, p_depot_destination_id, 'entree', p_quantite,
    'Transfert depuis ' || v_nom_source || case when p_motif is not null and trim(p_motif) <> '' then ' — ' || trim(p_motif) else '' end,
    auth.uid()
  )
  returning id into v_mouvement_entree_id;

  return jsonb_build_object('mouvement_sortie_id', v_mouvement_sortie_id, 'mouvement_entree_id', v_mouvement_entree_id);
end;
$$;
