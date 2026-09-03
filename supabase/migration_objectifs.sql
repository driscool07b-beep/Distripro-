-- Migration : objectifs commerciaux — par commercial et/ou zone, montant
-- et/ou quantité d'un produit précis, sur une période donnée.
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists objectifs (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  commercial_id  uuid references profils(id),
  zone           text,
  produit_id     uuid references produits(id),
  periode_debut  date not null,
  periode_fin    date not null,
  montant_cible  numeric(14,2),
  quantite_cible integer,
  notes          text,
  created_by     uuid references profils(id),
  created_at     timestamptz not null default now(),
  check (commercial_id is not null or zone is not null),
  check (montant_cible is not null or quantite_cible is not null),
  check (periode_fin >= periode_debut)
);

create index if not exists idx_objectifs_entreprise on objectifs(entreprise_id);
create index if not exists idx_objectifs_commercial on objectifs(commercial_id);

alter table objectifs enable row level security;

drop policy if exists objectifs_select on objectifs;
create policy objectifs_select on objectifs
  for select using (entreprise_id = current_entreprise_id());

drop policy if exists objectifs_insert on objectifs;
create policy objectifs_insert on objectifs
  for insert with check (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager')
  );

drop policy if exists objectifs_delete on objectifs;
create policy objectifs_delete on objectifs
  for delete using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager')
  );
