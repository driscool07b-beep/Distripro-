-- Migration : suite de l'audit de sécurité des fonctions RPC
-- 1) creer_tournee_optimisee et valider_visite n'avaient aucune vérification
--    de rôle.
-- 2) enregistrer_paiement est une fonction abandonnée (remplacée par
--    enregistrer_reglement) qui écrit encore dans la table orpheline
--    paiements_credit, sans vérification de rôle — si elle était appelée,
--    ça modifierait le montant réglé d'une vente sans que ça apparaisse
--    nulle part dans l'interface (qui lit désormais 'reglements'). Supprimée.
-- À exécuter dans l'éditeur SQL de Supabase.

drop function if exists enregistrer_paiement(uuid, numeric, text);

create or replace function creer_tournee_optimisee(
  p_commercial_id uuid,
  p_date_tournee date,
  p_client_ids uuid[]
)
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
  if v_role not in ('admin', 'manager', 'commercial') then
    raise exception 'accès refusé : votre rôle ne permet pas de créer une tournée';
  end if;

  if array_length(p_client_ids, 1) is null or array_length(p_client_ids, 1) = 0 then
    raise exception 'aucun client fourni pour la tournée';
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

create or replace function valider_visite(
  p_tournee_ligne_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_tolerance_metres integer default 150
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_client_id uuid;
  v_tournee_id uuid;
  v_client_lat double precision;
  v_client_lon double precision;
  v_distance double precision;
  v_visite_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role not in ('admin', 'manager', 'commercial') then
    raise exception 'accès refusé : votre rôle ne permet pas de valider une visite';
  end if;

  select tl.client_id, tl.tournee_id into v_client_id, v_tournee_id
  from tournee_lignes tl
  join tournees t on t.id = tl.tournee_id
  where tl.id = p_tournee_ligne_id and t.entreprise_id = v_entreprise_id;

  if v_client_id is null then
    raise exception 'étape de tournée introuvable pour cette entreprise';
  end if;

  select latitude, longitude into v_client_lat, v_client_lon
  from clients where id = v_client_id;

  if v_client_lat is null or v_client_lon is null then
    raise exception 'ce client n''a pas de position GPS enregistrée';
  end if;

  v_distance := distance_metres(p_latitude, p_longitude, v_client_lat, v_client_lon);

  if v_distance > p_tolerance_metres then
    return jsonb_build_object(
      'succes', false,
      'distance_metres', round(v_distance::numeric, 0),
      'message', 'Vous êtes trop loin du client pour valider cette visite.'
    );
  end if;

  insert into visites (tournee_id, client_id, ordre_prevu, heure_arrivee, statut, latitude_reelle, longitude_reelle)
  values (v_tournee_id, v_client_id, null, now(), 'visite', p_latitude, p_longitude)
  returning id into v_visite_id;

  update tournee_lignes
  set statut = 'visite', visite_id = v_visite_id
  where id = p_tournee_ligne_id;

  return jsonb_build_object(
    'succes', true,
    'distance_metres', round(v_distance::numeric, 0),
    'visite_id', v_visite_id
  );
end;
$$;
