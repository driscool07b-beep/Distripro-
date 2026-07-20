-- =========================================================================
-- DISTRIBPRO — SCHEMA MULTI-TENANT (v1)
-- À exécuter dans l'éditeur SQL de votre projet Supabase.
-- Couvre : entreprises (tenants), profils, clients, produits, stock,
-- mouvements de stock, ventes. RLS activé partout, isolation stricte
-- par entreprise_id.
-- =========================================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. ENTREPRISES (tenants)
-- -------------------------------------------------------------------------
create table if not exists entreprises (
  id           uuid primary key default gen_random_uuid(),
  nom          text not null,
  plan         text not null default 'starter' check (plan in ('starter', 'business', 'enterprise')),
  statut       text not null default 'actif' check (statut in ('actif', 'essai', 'suspendu')),
  created_at   timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- 2. PROFILS (1 profil = 1 utilisateur Supabase Auth, rattaché à 1 entreprise)
-- -------------------------------------------------------------------------
create table if not exists profils (
  id             uuid primary key references auth.users(id) on delete cascade,
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  nom            text not null,
  role           text not null default 'commercial'
                 check (role in ('admin', 'manager', 'commercial', 'gestionnaire_stock', 'comptable')),
  created_at     timestamptz not null default now()
);

create index if not exists idx_profils_entreprise on profils(entreprise_id);

-- Fonction utilitaire : renvoie l'entreprise_id de l'utilisateur connecté.
-- SECURITY DEFINER pour éviter la récursion RLS sur la table profils.
create or replace function current_entreprise_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select entreprise_id from profils where id = auth.uid();
$$;

create or replace function current_role_utilisateur()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profils where id = auth.uid();
$$;

-- -------------------------------------------------------------------------
-- 3. CLIENTS
-- -------------------------------------------------------------------------
create table if not exists clients (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  nom            text not null,
  telephone      text,
  adresse        text,
  latitude       double precision,
  longitude      double precision,
  created_by     uuid references profils(id),
  created_at     timestamptz not null default now()
);

create index if not exists idx_clients_entreprise on clients(entreprise_id);

-- -------------------------------------------------------------------------
-- 4. PRODUITS
-- -------------------------------------------------------------------------
create table if not exists produits (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  nom            text not null,
  categorie      text,
  prix_unitaire  numeric(14,2) not null default 0,
  seuil_alerte   integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists idx_produits_entreprise on produits(entreprise_id);

-- -------------------------------------------------------------------------
-- 5. STOCKS (1 ligne par produit — évolutif vers multi-dépôt plus tard)
-- -------------------------------------------------------------------------
create table if not exists stocks (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  produit_id     uuid not null references produits(id) on delete cascade unique,
  quantite       integer not null default 0,
  updated_at     timestamptz not null default now()
);

create index if not exists idx_stocks_entreprise on stocks(entreprise_id);

-- -------------------------------------------------------------------------
-- 6. MOUVEMENTS DE STOCK (journal, traçabilité)
-- -------------------------------------------------------------------------
create table if not exists mouvements_stock (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  produit_id     uuid not null references produits(id) on delete cascade,
  type           text not null check (type in ('entree', 'sortie')),
  quantite       integer not null check (quantite > 0),
  motif          text,
  created_by     uuid references profils(id),
  created_at     timestamptz not null default now()
);

create index if not exists idx_mouvements_entreprise on mouvements_stock(entreprise_id);
create index if not exists idx_mouvements_produit on mouvements_stock(produit_id);

-- -------------------------------------------------------------------------
-- 7. VENTES + LIGNES DE VENTE
-- -------------------------------------------------------------------------
create table if not exists ventes (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  client_id      uuid not null references clients(id),
  total          numeric(14,2) not null default 0,
  created_by     uuid references profils(id),
  created_at     timestamptz not null default now()
);

create index if not exists idx_ventes_entreprise on ventes(entreprise_id);
create index if not exists idx_ventes_client on ventes(client_id);

create table if not exists ventes_lignes (
  id             uuid primary key default gen_random_uuid(),
  vente_id       uuid not null references ventes(id) on delete cascade,
  produit_id     uuid not null references produits(id),
  quantite       integer not null check (quantite > 0),
  prix_unitaire  numeric(14,2) not null,
  sous_total     numeric(14,2) not null
);

create index if not exists idx_ventes_lignes_vente on ventes_lignes(vente_id);

-- =========================================================================
-- ROW LEVEL SECURITY — isolation stricte par entreprise
-- =========================================================================

alter table entreprises        enable row level security;
alter table profils            enable row level security;
alter table clients            enable row level security;
alter table produits           enable row level security;
alter table stocks             enable row level security;
alter table mouvements_stock   enable row level security;
alter table ventes             enable row level security;
alter table ventes_lignes      enable row level security;

-- ENTREPRISES : un utilisateur ne voit que sa propre entreprise
drop policy if exists entreprises_select on entreprises;
create policy entreprises_select on entreprises
  for select using (id = current_entreprise_id());

-- PROFILS : un utilisateur voit uniquement les profils de sa propre entreprise
drop policy if exists profils_select on profils;
create policy profils_select on profils
  for select using (entreprise_id = current_entreprise_id());

drop policy if exists profils_select_self on profils;
create policy profils_select_self on profils
  for select using (id = auth.uid());

-- CLIENTS
drop policy if exists clients_select on clients;
create policy clients_select on clients
  for select using (entreprise_id = current_entreprise_id());
drop policy if exists clients_insert on clients;
create policy clients_insert on clients
  for insert with check (entreprise_id = current_entreprise_id());
drop policy if exists clients_update on clients;
create policy clients_update on clients
  for update using (entreprise_id = current_entreprise_id());

-- PRODUITS
drop policy if exists produits_select on produits;
create policy produits_select on produits
  for select using (entreprise_id = current_entreprise_id());

-- STOCKS
drop policy if exists stocks_select on stocks;
create policy stocks_select on stocks
  for select using (entreprise_id = current_entreprise_id());

-- MOUVEMENTS DE STOCK
drop policy if exists mouvements_select on mouvements_stock;
create policy mouvements_select on mouvements_stock
  for select using (entreprise_id = current_entreprise_id());

-- VENTES
drop policy if exists ventes_select on ventes;
create policy ventes_select on ventes
  for select using (entreprise_id = current_entreprise_id());

-- VENTES LIGNES (isolation via la vente parente)
drop policy if exists ventes_lignes_select on ventes_lignes;
create policy ventes_lignes_select on ventes_lignes
  for select using (
    vente_id in (select id from ventes where entreprise_id = current_entreprise_id())
  );

-- Note : les opérations d'écriture sur produits, stocks, mouvements_stock,
-- ventes et ventes_lignes passent exclusivement par les fonctions RPC
-- SECURITY DEFINER ci-dessous, qui vérifient elles-mêmes le tenant.
-- Cela évite les incohérences (ex. vente créée sans décrémenter le stock).

-- =========================================================================
-- FONCTIONS RPC MÉTIER (SECURITY DEFINER)
-- =========================================================================

-- ---- creer_produit ------------------------------------------------------
create or replace function creer_produit(
  p_nom text,
  p_categorie text,
  p_prix_unitaire numeric,
  p_seuil_alerte integer,
  p_quantite_initiale integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_produit_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;

  insert into produits (entreprise_id, nom, categorie, prix_unitaire, seuil_alerte)
  values (v_entreprise_id, p_nom, p_categorie, p_prix_unitaire, p_seuil_alerte)
  returning id into v_produit_id;

  insert into stocks (entreprise_id, produit_id, quantite)
  values (v_entreprise_id, v_produit_id, coalesce(p_quantite_initiale, 0));

  if coalesce(p_quantite_initiale, 0) > 0 then
    insert into mouvements_stock (entreprise_id, produit_id, type, quantite, motif, created_by)
    values (v_entreprise_id, v_produit_id, 'entree', p_quantite_initiale, 'Stock initial', auth.uid());
  end if;

  return v_produit_id;
end;
$$;

-- ---- ajuster_stock (entrée / sortie manuelle) ----------------------------
create or replace function ajuster_stock(
  p_produit_id uuid,
  p_type text,
  p_quantite integer,
  p_motif text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_quantite_actuelle integer;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if p_type not in ('entree', 'sortie') then
    raise exception 'type de mouvement invalide';
  end if;

  select quantite into v_quantite_actuelle
  from stocks
  where produit_id = p_produit_id and entreprise_id = v_entreprise_id
  for update;

  if v_quantite_actuelle is null then
    raise exception 'produit introuvable pour cette entreprise';
  end if;

  if p_type = 'sortie' and v_quantite_actuelle < p_quantite then
    raise exception 'stock insuffisant';
  end if;

  update stocks
  set quantite = quantite + (case when p_type = 'entree' then p_quantite else -p_quantite end),
      updated_at = now()
  where produit_id = p_produit_id and entreprise_id = v_entreprise_id;

  insert into mouvements_stock (entreprise_id, produit_id, type, quantite, motif, created_by)
  values (v_entreprise_id, p_produit_id, p_type, p_quantite, p_motif, auth.uid());
end;
$$;

-- ---- creer_vente (transaction atomique : vente + lignes + stock) --------
create or replace function creer_vente(
  p_client_id uuid,
  p_lignes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_vente_id uuid;
  v_total numeric(14,2) := 0;
  v_ligne jsonb;
  v_produit_id uuid;
  v_quantite integer;
  v_prix_unitaire numeric(14,2);
  v_stock_actuel integer;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;

  -- Vérifie que le client appartient bien à l'entreprise
  perform 1 from clients where id = p_client_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'client introuvable pour cette entreprise';
  end if;

  -- Calcule le total et vérifie le stock disponible pour chaque ligne
  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_quantite := (v_ligne->>'quantite')::integer;
    v_prix_unitaire := (v_ligne->>'prix_unitaire')::numeric;

    select quantite into v_stock_actuel
    from stocks
    where produit_id = v_produit_id and entreprise_id = v_entreprise_id
    for update;

    if v_stock_actuel is null then
      raise exception 'produit introuvable pour cette entreprise';
    end if;
    if v_stock_actuel < v_quantite then
      raise exception 'stock insuffisant';
    end if;

    v_total := v_total + (v_quantite * v_prix_unitaire);
  end loop;

  insert into ventes (entreprise_id, client_id, total, created_by)
  values (v_entreprise_id, p_client_id, v_total, auth.uid())
  returning id into v_vente_id;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_quantite := (v_ligne->>'quantite')::integer;
    v_prix_unitaire := (v_ligne->>'prix_unitaire')::numeric;

    insert into ventes_lignes (vente_id, produit_id, quantite, prix_unitaire, sous_total)
    values (v_vente_id, v_produit_id, v_quantite, v_prix_unitaire, v_quantite * v_prix_unitaire);

    update stocks
    set quantite = quantite - v_quantite, updated_at = now()
    where produit_id = v_produit_id and entreprise_id = v_entreprise_id;

    insert into mouvements_stock (entreprise_id, produit_id, type, quantite, motif, created_by)
    values (v_entreprise_id, v_produit_id, 'sortie', v_quantite, 'Vente ' || v_vente_id, auth.uid());
  end loop;

  return v_vente_id;
end;
$$;

-- ---- inscrire_entreprise (onboarding self-service) -----------------------
-- À appeler juste après supabase.auth.signUp(), une fois l'utilisateur
-- authentifié, pour créer son entreprise (tenant) et son profil admin.
create or replace function inscrire_entreprise(
  p_nom_entreprise text,
  p_nom_admin text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entreprise_id uuid;
begin
  if exists (select 1 from profils where id = auth.uid()) then
    raise exception 'un profil existe déjà pour cet utilisateur';
  end if;

  insert into entreprises (nom, plan, statut)
  values (p_nom_entreprise, 'starter', 'essai')
  returning id into v_entreprise_id;

  insert into profils (id, entreprise_id, nom, role)
  values (auth.uid(), v_entreprise_id, p_nom_admin, 'admin');

  return v_entreprise_id;
end;
$$;

-- =========================================================================
-- FIN DU SCHEMA v1
-- =========================================================================
