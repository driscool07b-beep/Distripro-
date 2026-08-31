-- Migration : lignes de stock par produit sur le rapport de visite,
-- et système de champs personnalisés configurables par l'entreprise.
-- À exécuter dans l'éditeur SQL de Supabase.

-- 1. Lignes produits du rapport (stock rayon/réserve par produit)
create table if not exists rapport_visite_produits (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  rapport_id     uuid not null references rapports_visite(id) on delete cascade,
  produit_id     uuid not null references produits(id),
  quantite_rayon    integer,
  quantite_reserve  integer,
  created_at     timestamptz not null default now()
);

create index if not exists idx_rvp_entreprise on rapport_visite_produits(entreprise_id);
create index if not exists idx_rvp_rapport on rapport_visite_produits(rapport_id);
create index if not exists idx_rvp_produit on rapport_visite_produits(produit_id);

alter table rapport_visite_produits enable row level security;

drop policy if exists rvp_select on rapport_visite_produits;
create policy rvp_select on rapport_visite_produits
  for select using (entreprise_id = current_entreprise_id());

drop policy if exists rvp_insert on rapport_visite_produits;
create policy rvp_insert on rapport_visite_produits
  for insert with check (entreprise_id = current_entreprise_id());

-- 2. Champs personnalisés définis par l'entreprise (configurables par l'admin,
-- sans intervention développeur)
create table if not exists champs_personnalises_rapport (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  libelle        text not null,
  type_champ     text not null check (type_champ in ('texte', 'nombre', 'oui_non', 'choix_multiple')),
  options        text[],
  actif          boolean not null default true,
  ordre          integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists idx_champs_perso_entreprise on champs_personnalises_rapport(entreprise_id);

alter table champs_personnalises_rapport enable row level security;

drop policy if exists champs_perso_select on champs_personnalises_rapport;
create policy champs_perso_select on champs_personnalises_rapport
  for select using (entreprise_id = current_entreprise_id());

drop policy if exists champs_perso_insert_admin on champs_personnalises_rapport;
create policy champs_perso_insert_admin on champs_personnalises_rapport
  for insert with check (
    entreprise_id = current_entreprise_id()
    and exists (select 1 from profils where id = auth.uid() and role = 'admin')
  );

drop policy if exists champs_perso_update_admin on champs_personnalises_rapport;
create policy champs_perso_update_admin on champs_personnalises_rapport
  for update using (
    entreprise_id = current_entreprise_id()
    and exists (select 1 from profils where id = auth.uid() and role = 'admin')
  );

-- 3. Valeurs saisies par les commerciaux pour ces champs personnalisés, par rapport
create table if not exists rapport_visite_champs_valeurs (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  rapport_id     uuid not null references rapports_visite(id) on delete cascade,
  champ_id       uuid not null references champs_personnalises_rapport(id),
  valeur         text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_rvcv_entreprise on rapport_visite_champs_valeurs(entreprise_id);
create index if not exists idx_rvcv_rapport on rapport_visite_champs_valeurs(rapport_id);

alter table rapport_visite_champs_valeurs enable row level security;

drop policy if exists rvcv_select on rapport_visite_champs_valeurs;
create policy rvcv_select on rapport_visite_champs_valeurs
  for select using (entreprise_id = current_entreprise_id());

drop policy if exists rvcv_insert on rapport_visite_champs_valeurs;
create policy rvcv_insert on rapport_visite_champs_valeurs
  for insert with check (entreprise_id = current_entreprise_id());
