-- Migration : rapport de visite commerciale (stock rayon/réserve + photos)
-- À exécuter dans l'éditeur SQL de Supabase.

-- 1. Réglage entreprise : la prise de photo est-elle obligatoire pour valider un rapport ?
alter table entreprises add column if not exists photo_rapport_obligatoire boolean not null default false;

-- Policy UPDATE manquante sur entreprises, nécessaire pour que l'admin
-- puisse modifier ce réglage depuis l'écran Paramètres.
drop policy if exists entreprises_update_admin on entreprises;
create policy entreprises_update_admin on entreprises
  for update using (
    id = current_entreprise_id()
    and exists (select 1 from profils where id = auth.uid() and role = 'admin')
  );

-- 2. Table des rapports de visite
create table if not exists rapports_visite (
  id                 uuid primary key default gen_random_uuid(),
  entreprise_id      uuid not null references entreprises(id) on delete cascade,
  tournee_ligne_id   uuid references tournee_lignes(id) on delete set null,
  client_id          uuid not null references clients(id) on delete cascade,
  commercial_id      uuid references profils(id),
  notes_rayon        text,
  notes_reserve      text,
  photos_paths       text[] not null default '{}',
  created_at         timestamptz not null default now()
);

create index if not exists idx_rapports_visite_entreprise on rapports_visite(entreprise_id);
create index if not exists idx_rapports_visite_client on rapports_visite(client_id);

alter table rapports_visite enable row level security;

drop policy if exists rapports_visite_select on rapports_visite;
create policy rapports_visite_select on rapports_visite
  for select using (entreprise_id = current_entreprise_id());

drop policy if exists rapports_visite_insert on rapports_visite;
create policy rapports_visite_insert on rapports_visite
  for insert with check (entreprise_id = current_entreprise_id());

-- 3. Photos de rapport : réutilise le bucket client-photos existant (déjà isolé
-- par entreprise_id via les policies storage créées dans migration_photo_client.sql)
-- Convention de chemin : {entreprise_id}/rapports/{tournee_ligne_id}/{n}.{ext}
-- Aucune policy storage supplémentaire nécessaire : le premier segment du
-- chemin reste entreprise_id, donc les policies existantes couvrent déjà ce cas.
