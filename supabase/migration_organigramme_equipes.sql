-- Migration : organigramme commercial configurable (équipes + chef
-- d'équipe), pour que l'objectif d'un manager soit calculé comme la
-- somme des ventes réalisées par les commerciaux de son équipe —
-- chaque entreprise ayant sa propre organisation, ceci est paramétré
-- dans Paramètres, pas codé en dur.
--
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists equipes (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  nom text not null,
  manager_id uuid references profils(id),
  created_at timestamptz not null default now()
);

alter table profils add column if not exists equipe_id uuid references equipes(id);

create index if not exists idx_equipes_entreprise on equipes(entreprise_id);
create index if not exists idx_profils_equipe on profils(equipe_id);

alter table equipes enable row level security;

drop policy if exists equipes_select on equipes;
create policy equipes_select on equipes
  for select using (entreprise_id = current_entreprise_id());

-- Les écritures passent par les fonctions ci-dessous (contrôle du
-- rôle appelant centralisé, plutôt que dupliqué dans des policies).

create or replace function creer_equipe(p_nom text, p_manager_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_equipe_id uuid;
begin
  if current_role_utilisateur() not in ('admin', 'manager') then
    raise exception 'accès refusé';
  end if;
  if p_nom is null or trim(p_nom) = '' then
    raise exception 'le nom de l''équipe est requis';
  end if;
  if p_manager_id is not null then
    perform 1 from profils where id = p_manager_id and entreprise_id = v_entreprise_id and role in ('manager', 'admin');
    if not found then
      raise exception 'le chef d''équipe doit être un manager ou un admin de votre entreprise';
    end if;
  end if;

  insert into equipes (entreprise_id, nom, manager_id)
  values (v_entreprise_id, trim(p_nom), p_manager_id)
  returning id into v_equipe_id;

  return v_equipe_id;
end;
$$;

create or replace function modifier_equipe(p_equipe_id uuid, p_nom text, p_manager_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
begin
  if current_role_utilisateur() not in ('admin', 'manager') then
    raise exception 'accès refusé';
  end if;
  if p_manager_id is not null then
    perform 1 from profils where id = p_manager_id and entreprise_id = v_entreprise_id and role in ('manager', 'admin');
    if not found then
      raise exception 'le chef d''équipe doit être un manager ou un admin de votre entreprise';
    end if;
  end if;

  update equipes
  set nom = trim(p_nom), manager_id = p_manager_id
  where id = p_equipe_id and entreprise_id = v_entreprise_id;
end;
$$;

create or replace function supprimer_equipe(p_equipe_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_role_utilisateur() not in ('admin', 'manager') then
    raise exception 'accès refusé';
  end if;

  update profils set equipe_id = null where equipe_id = p_equipe_id and entreprise_id = current_entreprise_id();
  delete from equipes where id = p_equipe_id and entreprise_id = current_entreprise_id();
end;
$$;

create or replace function affilier_commercial_equipe(p_profil_id uuid, p_equipe_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
begin
  if current_role_utilisateur() not in ('admin', 'manager') then
    raise exception 'accès refusé';
  end if;
  perform 1 from profils where id = p_profil_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'membre introuvable dans votre entreprise';
  end if;
  if p_equipe_id is not null then
    perform 1 from equipes where id = p_equipe_id and entreprise_id = v_entreprise_id;
    if not found then
      raise exception 'équipe introuvable';
    end if;
  end if;

  update profils set equipe_id = p_equipe_id where id = p_profil_id and entreprise_id = v_entreprise_id;
end;
$$;
