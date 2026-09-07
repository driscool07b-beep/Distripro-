-- Migration : gouvernance des tournées commerciales.
-- - Seuls admin/manager/gérant, ou une personne désignée (chef des ventes,
--   responsable commercial) via une case à cocher dans sa fiche équipe,
--   peuvent programmer une tournée pour un commercial — plus le commercial
--   lui-même.
-- - Une seule tournée par commercial et par jour (contrainte en base).
-- - Possibilité d'ajouter/retirer un client d'une tournée déjà planifiée
--   (modification en cours de journée), réservée aux mêmes responsables.
-- À exécuter dans l'éditeur SQL de Supabase.

alter table profils add column if not exists responsable_tournees boolean not null default false;

create or replace function mon_compte_responsable_tournees()
returns boolean
language sql
stable
security definer
as $$
  select coalesce(responsable_tournees, false) from profils where id = auth.uid();
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'tournees'::regclass and conname = 'tournees_commercial_date_unique'
  ) then
    alter table tournees add constraint tournees_commercial_date_unique unique (commercial_id, date_tournee);
  end if;
end $$;

create or replace function modifier_membre_equipe(
  p_profil_id uuid,
  p_nom_complet text,
  p_telephone text,
  p_role text,
  p_zone text,
  p_acces_etendu boolean,
  p_actif boolean,
  p_lecture_seule boolean,
  p_responsable_tournees boolean default false
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
  if coalesce(v_avant.responsable_tournees, false) <> coalesce(p_responsable_tournees, false) then
    v_details := v_details || format('responsable des tournées : %s → %s. ', v_avant.responsable_tournees, p_responsable_tournees);
  end if;

  update profils
  set nom_complet = p_nom_complet,
      nom = p_nom_complet,
      telephone = p_telephone,
      role = p_role,
      zone = p_zone,
      acces_etendu = p_acces_etendu,
      actif = p_actif,
      lecture_seule = p_lecture_seule,
      responsable_tournees = p_responsable_tournees
  where id = p_profil_id and entreprise_id = v_entreprise_id;

  if v_details <> '' then
    insert into journal_administration (entreprise_id, effectue_par, cible_profil_id, action, details)
    values (v_entreprise_id, auth.uid(), p_profil_id, 'modification_membre', trim(v_details));
  end if;
end;
$$;

create or replace function creer_tournee_optimisee(p_commercial_id uuid, p_date_tournee date, p_client_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
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
  if v_role not in ('admin', 'manager') and not mon_compte_responsable_tournees() then
    raise exception 'accès refusé : seul un responsable désigné (chef des ventes, responsable commercial, manager ou administrateur) peut programmer une tournée';
  end if;

  if array_length(p_client_ids, 1) is null or array_length(p_client_ids, 1) = 0 then
    raise exception 'aucun client fourni pour la tournée';
  end if;

  if exists (select 1 from tournees where commercial_id = p_commercial_id and date_tournee = p_date_tournee) then
    raise exception 'une tournée existe déjà pour ce commercial à cette date — modifiez-la plutôt que d''en créer une nouvelle';
  end if;

  insert into tournees (entreprise_id, commercial_id, date_tournee, statut)
  values (v_entreprise_id, p_commercial_id, p_date_tournee, 'planifiee')
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
    insert into tournee_lignes (tournee_id, client_id, ordre, statut)
    values (v_tournee_id, v_plus_proche_id, v_ordre, 'a_visiter');

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

create or replace function ajouter_client_tournee(p_tournee_id uuid, p_client_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_statut text;
  v_ordre_max integer;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager') and not mon_compte_responsable_tournees() then
    raise exception 'accès refusé : seul un responsable désigné peut modifier une tournée';
  end if;

  select statut into v_statut from tournees where id = p_tournee_id and entreprise_id = v_entreprise_id;
  if v_statut is null then
    raise exception 'tournée introuvable pour cette entreprise';
  end if;
  if v_statut = 'terminee' then
    raise exception 'cette tournée est déjà terminée et ne peut plus être modifiée';
  end if;

  if exists (select 1 from tournee_lignes where tournee_id = p_tournee_id and client_id = p_client_id) then
    raise exception 'ce client fait déjà partie de la tournée';
  end if;

  select coalesce(max(ordre), 0) into v_ordre_max from tournee_lignes where tournee_id = p_tournee_id;

  insert into tournee_lignes (tournee_id, client_id, ordre, statut)
  values (p_tournee_id, p_client_id, v_ordre_max + 1, 'a_visiter');
end;
$$;

create or replace function retirer_client_tournee(p_tournee_ligne_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_statut_ligne text;
  v_tournee_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager') and not mon_compte_responsable_tournees() then
    raise exception 'accès refusé : seul un responsable désigné peut modifier une tournée';
  end if;

  select tl.statut, tl.tournee_id into v_statut_ligne, v_tournee_id
  from tournee_lignes tl
  join tournees t on t.id = tl.tournee_id
  where tl.id = p_tournee_ligne_id and t.entreprise_id = v_entreprise_id;

  if v_tournee_id is null then
    raise exception 'étape de tournée introuvable pour cette entreprise';
  end if;
  if v_statut_ligne = 'visite' then
    raise exception 'cette étape a déjà été visitée et ne peut plus être retirée';
  end if;

  delete from tournee_lignes where id = p_tournee_ligne_id;
end;
$$;
