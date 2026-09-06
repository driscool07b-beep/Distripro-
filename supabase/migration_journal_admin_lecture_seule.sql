-- Migration : journal d'administration (qui a fait quelle modification
-- sensible sur un membre de l'équipe, et quand) + colonne lecture_seule
-- (compte bloqué en écriture, activable par l'admin).
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists journal_administration (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  effectue_par uuid references profils(id),
  cible_profil_id uuid references profils(id),
  action text not null,
  details text,
  created_at timestamptz not null default now()
);

create index if not exists idx_journal_administration_entreprise on journal_administration(entreprise_id);

alter table journal_administration enable row level security;

drop policy if exists journal_administration_select on journal_administration;
create policy journal_administration_select on journal_administration
  for select using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() = 'admin'
  );

alter table profils add column if not exists lecture_seule boolean not null default false;

create or replace function mon_compte_lecture_seule()
returns boolean
language sql
stable
security definer
as $$
  select coalesce(lecture_seule, false) from profils where id = auth.uid();
$$;

-- Remplace les mises à jour directes de profils dans Utilisateurs.jsx :
-- une seule opération atomique (modification + journalisation), pour que la
-- trace ne puisse jamais être écrite sans que la modification ait eu lieu,
-- ni l'inverse.
create or replace function modifier_membre_equipe(
  p_profil_id uuid,
  p_nom_complet text,
  p_telephone text,
  p_role text,
  p_zone text,
  p_acces_etendu boolean,
  p_actif boolean,
  p_lecture_seule boolean
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role_appelant text := current_role_utilisateur();
  v_avant record;
  v_details text := '';
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role_appelant <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut modifier un membre de l''équipe';
  end if;

  select * into v_avant from profils where id = p_profil_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'membre introuvable pour cette entreprise';
  end if;

  if v_avant.role <> p_role then
    v_details := v_details || format('rôle : %s → %s. ', v_avant.role, p_role);
  end if;
  if coalesce(v_avant.actif, true) <> coalesce(p_actif, true) then
    v_details := v_details || format('actif : %s → %s. ', v_avant.actif, p_actif);
  end if;
  if coalesce(v_avant.acces_etendu, false) <> coalesce(p_acces_etendu, false) then
    v_details := v_details || format('accès élargi : %s → %s. ', v_avant.acces_etendu, p_acces_etendu);
  end if;
  if coalesce(v_avant.lecture_seule, false) <> coalesce(p_lecture_seule, false) then
    v_details := v_details || format('lecture seule : %s → %s. ', v_avant.lecture_seule, p_lecture_seule);
  end if;

  update profils
  set nom_complet = p_nom_complet,
      nom = p_nom_complet,
      telephone = p_telephone,
      role = p_role,
      zone = p_zone,
      acces_etendu = p_acces_etendu,
      actif = p_actif,
      lecture_seule = p_lecture_seule
  where id = p_profil_id and entreprise_id = v_entreprise_id;

  if v_details <> '' then
    insert into journal_administration (entreprise_id, effectue_par, cible_profil_id, action, details)
    values (v_entreprise_id, auth.uid(), p_profil_id, 'modification_membre', trim(v_details));
  end if;
end;
$$;
