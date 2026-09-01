-- Migration : historique des analyses générées par IA
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists analyses_ia (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  contenu        text not null,
  genere_par     uuid references profils(id),
  created_at     timestamptz not null default now()
);

create index if not exists idx_analyses_ia_entreprise on analyses_ia(entreprise_id);

alter table analyses_ia enable row level security;

drop policy if exists analyses_ia_select on analyses_ia;
create policy analyses_ia_select on analyses_ia
  for select using (entreprise_id = current_entreprise_id());

-- Pas de policy INSERT pour les utilisateurs authentifiés : l'écriture se fait
-- uniquement via l'Edge Function (clé service_role, qui contourne la RLS).
