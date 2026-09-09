-- Migration : trois fonctions présentes dans le repo mais jamais
-- réellement appliquées en base (même schéma que creer_produit/
-- ajuster_stock avant leur propre correction plus tôt dans cette série
-- de migrations) : creer_depot, modifier_depot, et
-- attacher_justificatif_mouvement (utilisée pour tous les uploads de
-- justificatifs sur les mouvements de stock — ajustements, transferts,
-- réceptions).
--
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function creer_depot(
  p_nom text,
  p_type text default null,
  p_responsable_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_depot_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager') then
    raise exception 'accès refusé : seul un administrateur ou un manager peut créer un dépôt';
  end if;
  if p_nom is null or trim(p_nom) = '' then
    raise exception 'le nom du dépôt est requis';
  end if;

  insert into depots (entreprise_id, nom, type, responsable_id, actif)
  values (v_entreprise_id, trim(p_nom), p_type, p_responsable_id, true)
  returning id into v_depot_id;

  -- Un produit doit avoir une ligne de stock (à 0) dans chaque dépôt actif,
  -- pour qu'une vente ou un ajustement puisse s'y faire sans erreur.
  insert into stocks (entreprise_id, produit_id, depot_id, quantite)
  select v_entreprise_id, id, v_depot_id, 0
  from produits
  where entreprise_id = v_entreprise_id
  on conflict (produit_id, depot_id) do nothing;

  return v_depot_id;
end;
$$;

create or replace function modifier_depot(
  p_depot_id uuid,
  p_nom text,
  p_type text,
  p_responsable_id uuid,
  p_actif boolean
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager') then
    raise exception 'accès refusé : seul un administrateur ou un manager peut modifier un dépôt';
  end if;
  if p_nom is null or trim(p_nom) = '' then
    raise exception 'le nom du dépôt est requis';
  end if;

  update depots
  set nom = trim(p_nom), type = p_type, responsable_id = p_responsable_id, actif = p_actif
  where id = p_depot_id and entreprise_id = v_entreprise_id;

  if not found then
    raise exception 'dépôt introuvable pour cette entreprise';
  end if;
end;
$$;

create or replace function attacher_justificatif_mouvement(p_mouvement_id uuid, p_chemin text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé';
  end if;

  update mouvements_stock
  set reference_doc = p_chemin
  where id = p_mouvement_id and entreprise_id = v_entreprise_id;

  if not found then
    raise exception 'mouvement introuvable pour cette entreprise';
  end if;
end;
$$;
