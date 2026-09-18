-- Migration : sécurité renforcée pour la validation des décaissements
-- + politique générale de mots de passe.
--
-- Important : rien de tout ceci n'est activé automatiquement sur les
-- comptes existants — c'est purement opt-in (un PIN n'existe et ne
-- bloque qu'une fois défini ; une réinitialisation de mot de passe ne
-- se déclenche que si un admin l'initie explicitement). Les comptes
-- actuels, y compris ceux en cours de test, ne sont donc pas
-- affectés tant que personne n'active ces dispositifs pour eux.
--
-- À exécuter dans l'éditeur SQL de Supabase.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. PIN de validation des décaissements — distinct du mot de passe
--    de connexion. Stocké hashé (bcrypt via pgcrypto) : personne,
--    admin compris, ne peut le relire, seulement le vérifier ou le
--    régénérer.
-- ---------------------------------------------------------------------
alter table profils add column if not exists pin_validation text;
alter table profils add column if not exists pin_doit_changer boolean not null default false;

create or replace function definir_pin_validation(p_pin text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_pin is null or length(trim(p_pin)) < 4 then
    raise exception 'le code doit contenir au moins 4 chiffres';
  end if;
  update profils
  set pin_validation = crypt(trim(p_pin), gen_salt('bf')), pin_doit_changer = false
  where id = auth.uid();
end;
$$;

create or replace function verifier_pin_validation(p_pin text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hash text;
begin
  select pin_validation into v_hash from profils where id = auth.uid();
  if v_hash is null then
    return true; -- aucun PIN configuré pour cet utilisateur = pas de verrou (rétrocompatible)
  end if;
  return v_hash = crypt(trim(p_pin), v_hash);
end;
$$;

-- Indique si l'utilisateur courant a un PIN configuré, et s'il doit
-- en choisir un nouveau avant de pouvoir valider quoi que ce soit
-- (après une réinitialisation par un admin, par exemple).
create or replace function statut_pin_validation()
returns table (pin_configure boolean, doit_changer boolean)
language sql
security definer
stable
set search_path to 'public'
as $$
  select pin_validation is not null, coalesce(pin_doit_changer, false)
  from profils where id = auth.uid();
$$;

-- Un admin régénère le PIN d'un membre (oubli) — il ne voit jamais
-- l'ancien, et le nouveau n'est retourné qu'une seule fois, à
-- communiquer à la personne de vive voix ou par un canal séparé.
-- La personne devra en choisir un nouveau avant sa prochaine
-- validation (pin_doit_changer = true).
create or replace function regenerer_pin_validation(p_profil_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_nouveau_pin text;
begin
  if current_role_utilisateur() <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut régénérer un PIN';
  end if;
  perform 1 from profils where id = p_profil_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'utilisateur introuvable';
  end if;

  v_nouveau_pin := lpad(floor(random() * 1000000)::text, 6, '0');
  update profils
  set pin_validation = crypt(v_nouveau_pin, gen_salt('bf')), pin_doit_changer = true
  where id = p_profil_id;

  return v_nouveau_pin;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Politique générale de mots de passe : un admin peut déclencher
--    une réinitialisation (mot de passe temporaire généré) sans
--    jamais voir le mot de passe actuel ni le nouveau — l'appel
--    Supabase Auth Admin nécessaire passe par une Edge Function
--    (clé service_role, jamais exposée au client). Voir
--    supabase/functions/reinitialiser-mot-de-passe/.
-- ---------------------------------------------------------------------
alter table profils add column if not exists doit_changer_mot_de_passe boolean not null default false;

-- Appelée par l'Edge Function après avoir réinitialisé le mot de
-- passe côté Supabase Auth, pour marquer que l'utilisateur devra en
-- choisir un nouveau à sa prochaine connexion.
create or replace function marquer_changement_mdp_requis(p_profil_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update profils set doit_changer_mot_de_passe = true where id = p_profil_id;
end;
$$;

-- Appelée par le client une fois que l'utilisateur a lui-même changé
-- son mot de passe (supabase.auth.updateUser), pour lever l'obligation.
create or replace function confirmer_changement_mot_de_passe()
returns void
language sql
security definer
set search_path to 'public'
as $$
  update profils set doit_changer_mot_de_passe = false where id = auth.uid();
$$;
