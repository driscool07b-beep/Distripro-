-- Migration : produits concurrents + suivi de présence en rayon (taux de présence)
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists produits_concurrents (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  nom            text not null,
  marque         text,
  actif          boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists idx_produits_concurrents_entreprise on produits_concurrents(entreprise_id);

alter table produits_concurrents enable row level security;

drop policy if exists produits_concurrents_select on produits_concurrents;
create policy produits_concurrents_select on produits_concurrents
  for select using (entreprise_id = current_entreprise_id());

drop policy if exists produits_concurrents_insert_admin on produits_concurrents;
create policy produits_concurrents_insert_admin on produits_concurrents
  for insert with check (
    entreprise_id = current_entreprise_id()
    and exists (select 1 from profils where id = auth.uid() and role = 'admin')
  );

drop policy if exists produits_concurrents_update_admin on produits_concurrents;
create policy produits_concurrents_update_admin on produits_concurrents
  for update using (
    entreprise_id = current_entreprise_id()
    and exists (select 1 from profils where id = auth.uid() and role = 'admin')
  );

create table if not exists rapport_visite_concurrents (
  id                     uuid primary key default gen_random_uuid(),
  entreprise_id          uuid not null references entreprises(id) on delete cascade,
  rapport_id             uuid not null references rapports_visite(id) on delete cascade,
  produit_concurrent_id  uuid not null references produits_concurrents(id),
  present                boolean not null default false,
  created_at             timestamptz not null default now()
);

create index if not exists idx_rvc_entreprise on rapport_visite_concurrents(entreprise_id);
create index if not exists idx_rvc_rapport on rapport_visite_concurrents(rapport_id);
create index if not exists idx_rvc_produit on rapport_visite_concurrents(produit_concurrent_id);

alter table rapport_visite_concurrents enable row level security;

drop policy if exists rvc_select on rapport_visite_concurrents;
create policy rvc_select on rapport_visite_concurrents
  for select using (entreprise_id = current_entreprise_id());

drop policy if exists rvc_insert on rapport_visite_concurrents;
create policy rvc_insert on rapport_visite_concurrents
  for insert with check (entreprise_id = current_entreprise_id());
