-- Migration : table types_client (paramétrage libre par entreprise cliente du SaaS)
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists types_client (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  libelle        text not null,
  actif          boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (entreprise_id, libelle)
);

create index if not exists idx_types_client_entreprise on types_client(entreprise_id);

alter table types_client enable row level security;

drop policy if exists types_client_select on types_client;
create policy types_client_select on types_client
  for select using (entreprise_id = current_entreprise_id());

drop policy if exists types_client_insert on types_client;
create policy types_client_insert on types_client
  for insert with check (entreprise_id = current_entreprise_id());

-- Pré-remplissage pour Rama Cereal (entreprise de test) avec les catégories
-- déjà en usage — les autres entreprises du SaaS démarreront avec une liste
-- vide et la construiront elles-mêmes via "+ Ajouter un type" dans l'appli.
insert into types_client (entreprise_id, libelle)
select id, libelle
from entreprises, unnest(array[
  'Diaspora', 'Prosuma', 'Prosuma Port', 'Sococe CI', 'S2P', 'Auchan', 'Clinique'
]) as libelle
where nom = 'Rama Cereal'
on conflict (entreprise_id, libelle) do nothing;
