-- Migration : planification des tournées assistée par IA.
-- - Un commercial peut désormais programmer SA PROPRE tournée (et seulement
--   la sienne) ; admin/manager/responsables tournées programment pour
--   n'importe quel commercial, comme avant.
-- - Réglage entreprise optionnel : les tournées qu'un commercial programme
--   lui-même doivent être validées par un responsable avant de pouvoir être
--   effectuées (aucune visite ne peut être validée tant que ce n'est pas fait).
-- - Chaque client proposé par l'IA garde la raison de son choix.
-- - Accès aux fonctions IA activable/désactivable individuellement par
--   l'administrateur (contrôlé côté serveur dans les Edge Functions IA).
-- À exécuter dans l'éditeur SQL de Supabase.

alter table entreprises add column if not exists validation_tournee_commercial boolean not null default false;

alter table profils add column if not exists ia_active boolean not null default true;

alter table tournees add column if not exists en_attente_validation boolean not null default false;
alter table tournees add column if not exists proposee_par_ia boolean not null default false;
alter table tournees add column if not exists creee_par uuid references profils(id);
alter table tournees add column if not exists validee_par uuid references profils(id);
alter table tournees add column if not exists validee_at timestamptz;

alter table tournee_lignes add column if not exists raison_ia text;

-- ---------------------------------------------------------------------------
-- Création de tournée (remplace la version précédente à 3 paramètres)
-- ---------------------------------------------------------------------------
drop function if exists creer_tournee_optimisee(uuid, date, uuid[]);

create or replace function creer_tournee_optimisee(
  p_commercial_id uuid,
  p_date_tournee date,
  p_client_ids uuid[],
  p_raisons jsonb default null,       -- { "<client_id>": "raison du choix" }
  p_proposee_par_ia boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_est_responsable boolean;
  v_validation_requise boolean := false;
  v_tournee_id uuid;
  v_lat_actuelle double precision;
  v_lon_actuelle double precision;
  v_client_restant record;
  v_plus_proche_id uuid;
  v_plus_proche_lat double precision;
  v_plus_proche_lon double precision;
  v_min_distance double precision;
  v_ordre integer := 1;
  v_distance_totale double precision := 0;
  v_ids_restants uuid[] := p_client_ids;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;

  v_est_responsable := v_role in ('admin', 'manager') or mon_compte_responsable_tournees();

  if not v_est_responsable then
    if v_role <> 'commercial' then
      raise exception 'accès refusé : votre rôle ne permet pas de programmer une tournée';
    end if;
    if p_commercial_id <> auth.uid() then
      raise exception 'accès refusé : un commercial ne peut programmer que sa propre tournée';
    end if;
    select coalesce(validation_tournee_commercial, false) into v_validation_requise
    from entreprises where id = v_entreprise_id;
  end if;

  perform 1 from profils
  where id = p_commercial_id and entreprise_id = v_entreprise_id and coalesce(actif, true);
  if not found then
    raise exception 'commercial introuvable ou désactivé';
  end if;

  if array_length(p_client_ids, 1) is null or array_length(p_client_ids, 1) = 0 then
    raise exception 'aucun client fourni pour la tournée';
  end if;

  if exists (select 1 from tournees where commercial_id = p_commercial_id and date_tournee = p_date_tournee) then
    raise exception 'une tournée existe déjà pour ce commercial à cette date — modifiez-la plutôt que d''en créer une nouvelle';
  end if;

  insert into tournees (entreprise_id, commercial_id, date_tournee, statut, en_attente_validation, proposee_par_ia, creee_par)
  values (v_entreprise_id, p_commercial_id, p_date_tournee, 'planifiee', v_validation_requise, coalesce(p_proposee_par_ia, false), auth.uid())
  returning id into v_tournee_id;

  select latitude, longitude into v_lat_actuelle, v_lon_actuelle
  from clients
  where id = v_ids_restants[1] and entreprise_id = v_entreprise_id;

  if v_lat_actuelle is null then
    v_lat_actuelle := 0;
    v_lon_actuelle := 0;
  end if;

  while array_length(v_ids_restants, 1) > 0 loop
    v_min_distance := null;
    v_plus_proche_id := null;

    for v_client_restant in
      select c.id, c.latitude, c.longitude
      from clients c
      where c.id = any(v_ids_restants) and c.entreprise_id = v_entreprise_id
    loop
      declare
        v_d double precision;
      begin
        if v_client_restant.latitude is null or v_client_restant.longitude is null then
          v_d := 999999999;
        else
          v_d := distance_metres(v_lat_actuelle, v_lon_actuelle, v_client_restant.latitude, v_client_restant.longitude);
        end if;

        if v_min_distance is null or v_d < v_min_distance then
          v_min_distance := v_d;
          v_plus_proche_id := v_client_restant.id;
          v_plus_proche_lat := v_client_restant.latitude;
          v_plus_proche_lon := v_client_restant.longitude;
        end if;
      end;
    end loop;

    -- Identifiant qui n'appartient pas à l'entreprise : on l'écarte.
    if v_plus_proche_id is null then
      exit;
    end if;

    insert into tournee_lignes (tournee_id, client_id, ordre, statut, raison_ia)
    values (v_tournee_id, v_plus_proche_id, v_ordre, 'a_visiter', p_raisons ->> v_plus_proche_id::text);

    if v_min_distance < 999999999 then
      v_distance_totale := v_distance_totale + v_min_distance;
    end if;

    v_lat_actuelle := coalesce(v_plus_proche_lat, v_lat_actuelle);
    v_lon_actuelle := coalesce(v_plus_proche_lon, v_lon_actuelle);

    v_ids_restants := array_remove(v_ids_restants, v_plus_proche_id);
    v_ordre := v_ordre + 1;
  end loop;

  update tournees
  set distance_totale_km = round((v_distance_totale / 1000)::numeric, 2)
  where id = v_tournee_id;

  return v_tournee_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Validation / refus d'une tournée programmée par un commercial
-- Refus = la tournée (jamais commencée) est supprimée, pour que le
-- commercial puisse en proposer une autre à la même date.
-- ---------------------------------------------------------------------------
create or replace function valider_tournee(p_tournee_id uuid, p_approuver boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_tournee record;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager') and not mon_compte_responsable_tournees() then
    raise exception 'accès refusé : seul un responsable peut valider une tournée';
  end if;

  select * into v_tournee from tournees where id = p_tournee_id and entreprise_id = v_entreprise_id for update;
  if not found then
    raise exception 'tournée introuvable pour cette entreprise';
  end if;
  if not v_tournee.en_attente_validation then
    raise exception 'cette tournée n''est pas en attente de validation';
  end if;
  if v_tournee.commercial_id = auth.uid() then
    raise exception 'vous ne pouvez pas valider votre propre tournée';
  end if;

  if p_approuver then
    update tournees
    set en_attente_validation = false, validee_par = auth.uid(), validee_at = now()
    where id = p_tournee_id;
  else
    delete from tournee_lignes where tournee_id = p_tournee_id;
    delete from tournees where id = p_tournee_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Garde-fou serveur : aucune visite ne peut être validée sur une tournée
-- encore en attente de validation (quelle que soit la façon d'y accéder).
-- ---------------------------------------------------------------------------
create or replace function bloquer_visite_tournee_non_validee()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.statut is distinct from old.statut and new.statut = 'visite' then
    if exists (select 1 from tournees where id = new.tournee_id and en_attente_validation) then
      raise exception 'cette tournée attend la validation d''un responsable — les visites ne peuvent pas encore être validées';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bloquer_visite_tournee_non_validee on tournee_lignes;
create trigger trg_bloquer_visite_tournee_non_validee
  before update on tournee_lignes
  for each row execute function bloquer_visite_tournee_non_validee();

-- ---------------------------------------------------------------------------
-- Accès IA individuel (admin uniquement, tracé dans le journal)
-- ---------------------------------------------------------------------------
create or replace function definir_acces_ia(p_profil_id uuid, p_actif boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if current_role_utilisateur() <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut modifier l''accès à l''IA';
  end if;

  update profils set ia_active = p_actif
  where id = p_profil_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'membre introuvable pour cette entreprise';
  end if;

  insert into journal_administration (entreprise_id, effectue_par, cible_profil_id, action, details)
  values (v_entreprise_id, auth.uid(), p_profil_id, 'modification_membre',
          case when p_actif then 'accès IA : activé' else 'accès IA : désactivé' end);
end;
$$;
