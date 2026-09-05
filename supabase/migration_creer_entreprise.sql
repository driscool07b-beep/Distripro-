-- Migration : circuit d'inscription pour une NOUVELLE entreprise (distinct
-- de l'inscription par invitation à une équipe existante). inscrire_entreprise
-- existe déjà et fonctionne pour le cas où la session est immédiate après
-- l'inscription ; cette fonction complémentaire gère le cas où une
-- confirmation par email est requise avant la première connexion (même
-- mécanisme que finaliser_inscription pour les invitations, mais basé sur
-- les métadonnées du compte plutôt que sur une invitation).
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function finaliser_creation_entreprise()
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_nom_entreprise text := auth.jwt() -> 'user_metadata' ->> 'nom_entreprise';
  v_nom_admin text := auth.jwt() -> 'user_metadata' ->> 'nom_admin';
  v_entreprise_id uuid;
begin
  if v_nom_entreprise is null or trim(v_nom_entreprise) = '' then
    raise exception 'aucune information d''entreprise trouvée pour cet utilisateur';
  end if;

  if exists (select 1 from profils where id = auth.uid()) then
    raise exception 'profil déjà existant pour cet utilisateur';
  end if;

  insert into entreprises (nom, plan, statut)
  values (v_nom_entreprise, 'starter', 'essai')
  returning id into v_entreprise_id;

  insert into profils (id, entreprise_id, nom, nom_complet, role, actif)
  values (auth.uid(), v_entreprise_id, coalesce(v_nom_admin, 'Administrateur'), coalesce(v_nom_admin, 'Administrateur'), 'admin', true);

  return json_build_object('entreprise_id', v_entreprise_id);
end;
$$;
