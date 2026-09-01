-- Migration : tarifs négociés par client/produit (remises contractuelles chaînes de magasins)
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists tarifs_client (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  client_id      uuid not null references clients(id) on delete cascade,
  produit_id     uuid not null references produits(id) on delete cascade,
  prix_negocie   numeric(14,2) not null check (prix_negocie >= 0),
  created_at     timestamptz not null default now(),
  unique (client_id, produit_id)
);

create index if not exists idx_tarifs_client_entreprise on tarifs_client(entreprise_id);
create index if not exists idx_tarifs_client_client on tarifs_client(client_id);

alter table tarifs_client enable row level security;

drop policy if exists tarifs_client_select on tarifs_client;
create policy tarifs_client_select on tarifs_client
  for select using (entreprise_id = current_entreprise_id());

drop policy if exists tarifs_client_insert on tarifs_client;
create policy tarifs_client_insert on tarifs_client
  for insert with check (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager')
  );

drop policy if exists tarifs_client_update on tarifs_client;
create policy tarifs_client_update on tarifs_client
  for update using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager')
  );

drop policy if exists tarifs_client_delete on tarifs_client;
create policy tarifs_client_delete on tarifs_client
  for delete using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager')
  );
