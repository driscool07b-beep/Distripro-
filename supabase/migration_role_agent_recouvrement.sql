-- Migration : nouveau rôle 'agent_recouvrement', dédié au suivi des
-- créances clients (en cours, échues, encaissées) et à l'enregistrement
-- des recouvrements — sans accès aux autres fonctions de l'app (ventes,
-- stock, clients...).
--
-- Rien à changer côté RLS pour ventes/reglements : les policies
-- existantes (migration_rls_commercial.sql) restreignent seulement le
-- rôle 'commercial' — tout autre rôle, dont celui-ci, voit déjà
-- l'ensemble des créances de l'entreprise.
--
-- À exécuter dans l'éditeur SQL de Supabase.

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
  if p_role not in ('admin', 'manager', 'commercial', 'comptable', 'gestionnaire_stock', 'agent_recouvrement') then
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

create or replace function enregistrer_reglement(p_vente_id uuid, p_montant numeric, p_mode text default 'espece', p_commercial_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_vente record;
  v_reglement_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;

  if v_role not in ('admin', 'manager', 'commercial', 'comptable', 'agent_recouvrement') then
    raise exception 'accès refusé : votre rôle ne permet pas d''enregistrer un règlement';
  end if;

  if p_montant is null or p_montant <= 0 then
    raise exception 'montant invalide';
  end if;

  select * into v_vente from ventes
  where id = p_vente_id and entreprise_id = v_entreprise_id
  for update;

  if not found then
    raise exception 'vente introuvable pour cette entreprise';
  end if;

  if v_vente.statut = 'annulee' then
    raise exception 'impossible de régler une vente annulée';
  end if;

  if v_vente.mode_paiement <> 'credit' then
    raise exception 'cette vente n''est pas à crédit';
  end if;

  if v_vente.montant_regle + p_montant > v_vente.total then
    raise exception 'le montant dépasse le solde restant dû';
  end if;

  update ventes
  set montant_regle = montant_regle + p_montant
  where id = p_vente_id;

  insert into reglements (entreprise_id, vente_id, montant, mode, created_by, commercial_id)
  values (v_entreprise_id, p_vente_id, p_montant, p_mode, auth.uid(), p_commercial_id)
  returning id into v_reglement_id;

  return v_reglement_id;
end;
$$;
