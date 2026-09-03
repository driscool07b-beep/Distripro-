-- Migration : gestion des utilisateurs de l'équipe — invitation par l'admin,
-- inscription publique, activation automatique du profil.
-- À exécuter dans l'éditeur SQL de Supabase.

alter table invitations enable row level security;

drop policy if exists invitations_select on invitations;
create policy invitations_select on invitations
  for select using (entreprise_id = current_entreprise_id());

drop policy if exists invitations_delete on invitations;
create policy invitations_delete on invitations
  for delete using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() = 'admin'
  );

create or replace function creer_invitation(
  p_email text,
  p_nom_complet text,
  p_role text,
  p_zone text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role_appelant text := current_role_utilisateur();
  v_invitation_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role_appelant <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut inviter un collaborateur';
  end if;
  if p_role not in ('admin', 'manager', 'commercial', 'comptable', 'gestionnaire_stock') then
    raise exception 'rôle invalide';
  end if;
  if p_email is null or trim(p_email) = '' then
    raise exception 'email requis';
  end if;

  perform 1 from profils pr
    join auth.users u on u.id = pr.id
    where lower(u.email) = lower(p_email) and pr.entreprise_id = v_entreprise_id;
  if found then
    raise exception 'cet email correspond déjà à un membre de l''équipe';
  end if;

  update invitations
  set statut = 'annulee'
  where lower(email) = lower(p_email) and entreprise_id = v_entreprise_id and statut = 'en_attente';

  insert into invitations (entreprise_id, email, nom_complet, role, zone, invited_by, statut)
  values (v_entreprise_id, lower(trim(p_email)), p_nom_complet, p_role, p_zone, auth.uid(), 'en_attente')
  returning id into v_invitation_id;

  return v_invitation_id;
end;
$$;

create or replace function finaliser_inscription()
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
  v_invitation record;
begin
  if v_email is null then
    raise exception 'utilisateur non authentifié';
  end if;

  perform 1 from profils where id = auth.uid();
  if found then
    raise exception 'profil déjà existant pour cet utilisateur';
  end if;

  select * into v_invitation
  from invitations
  where lower(email) = v_email and statut = 'en_attente'
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'aucune invitation en attente pour cet email — contactez votre administrateur';
  end if;

  insert into profils (id, entreprise_id, nom, nom_complet, role, zone, actif)
  values (
    auth.uid(), v_invitation.entreprise_id,
    coalesce(v_invitation.nom_complet, 'Utilisateur'), coalesce(v_invitation.nom_complet, 'Utilisateur'),
    v_invitation.role, v_invitation.zone, true
  );

  update invitations set statut = 'acceptee' where id = v_invitation.id;

  return json_build_object('entreprise_id', v_invitation.entreprise_id, 'role', v_invitation.role);
end;
$$;

drop policy if exists profils_update_admin on profils;
create policy profils_update_admin on profils
  for update using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() = 'admin'
  );
