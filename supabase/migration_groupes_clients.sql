-- Migration : groupes de clients (ex. chaîne de magasins facturée
-- globalement après un récap mensuel des livraisons par magasin)
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists groupes_clients (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  nom            text not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_groupes_clients_entreprise on groupes_clients(entreprise_id);

alter table groupes_clients enable row level security;

drop policy if exists groupes_clients_select on groupes_clients;
create policy groupes_clients_select on groupes_clients
  for select using (entreprise_id = current_entreprise_id());

drop policy if exists groupes_clients_insert on groupes_clients;
create policy groupes_clients_insert on groupes_clients
  for insert with check (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager')
  );

drop policy if exists groupes_clients_delete on groupes_clients;
create policy groupes_clients_delete on groupes_clients
  for delete using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager')
  );

alter table clients add column if not exists groupe_id uuid references groupes_clients(id);
