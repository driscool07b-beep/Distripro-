-- Migration : ajoute le contrôle "compte en lecture seule" à toutes les
-- fonctions d'écriture sensibles (bloque intégralement un utilisateur dont
-- profils.lecture_seule = true, quel que soit son rôle). Reconstruit à
-- partir des définitions réellement en base au moment de l'audit, sans
-- rien changer d'autre à leur logique existante.
--
-- Corrige au passage : creer_tournee_optimisee et valider_visite n'avaient
-- toujours aucune vérification de rôle malgré une tentative de correction
-- précédente (jamais appliquée avec succès).
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function ajuster_stock(p_produit_id uuid, p_type text, p_quantite integer, p_motif text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_quantite_actuelle integer;
  v_depot_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattache a une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas d''ajuster le stock magasin';
  end if;
  if p_type not in ('entree', 'sortie') then
    raise exception 'type de mouvement invalide';
  end if;

  select quantite, depot_id into v_quantite_actuelle, v_depot_id
  from stocks
  where produit_id = p_produit_id and entreprise_id = v_entreprise_id
  for update;

  if v_quantite_actuelle is null then
    raise exception 'produit introuvable pour cette entreprise';
  end if;

  if p_type = 'sortie' and v_quantite_actuelle < p_quantite then
    raise exception 'stock insuffisant';
  end if;

  update stocks
  set quantite = quantite + (case when p_type = 'entree' then p_quantite else -p_quantite end),
      updated_at = now()
  where produit_id = p_produit_id and entreprise_id = v_entreprise_id;

  insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
  values (v_entreprise_id, p_produit_id, v_depot_id, p_type, p_quantite, p_motif, auth.uid());
end;
$$;

create or replace function changer_statut_commande(p_commande_id uuid, p_nouveau_statut text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := mon_entreprise_id();
  v_role text := current_role_utilisateur();
  v_statut_actuel text;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'commercial', 'comptable') then
    raise exception 'accès refusé';
  end if;
  if p_nouveau_statut not in ('confirmee', 'en_preparation', 'annulee') then
    raise exception 'transition de statut invalide via cette fonction';
  end if;

  select statut into v_statut_actuel
  from commandes
  where id = p_commande_id and entreprise_id = v_entreprise_id
  for update;

  if v_statut_actuel is null then
    raise exception 'commande introuvable pour cette entreprise';
  end if;
  if v_statut_actuel in ('livree', 'annulee') then
    raise exception 'cette commande est déjà % et ne peut plus être modifiée', v_statut_actuel;
  end if;

  update commandes set statut = p_nouveau_statut, updated_at = now() where id = p_commande_id;

  insert into commande_historique (entreprise_id, commande_id, ancien_statut, nouveau_statut, note, effectue_par)
  values (v_entreprise_id, p_commande_id, v_statut_actuel, p_nouveau_statut, p_note, auth.uid());
end;
$$;

create or replace function creer_avoir(p_vente_id uuid, p_motif text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_vente record;
  v_ligne record;
  v_avoir_id uuid;
  v_depot_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;

  if v_role not in ('admin', 'manager') then
    raise exception 'accès refusé : seul un administrateur ou un manager peut émettre un avoir';
  end if;

  if p_motif is null or trim(p_motif) = '' then
    raise exception 'un motif est requis pour émettre un avoir';
  end if;

  select * into v_vente from ventes
  where id = p_vente_id and entreprise_id = v_entreprise_id
  for update;

  if not found then
    raise exception 'vente introuvable pour cette entreprise';
  end if;

  if v_vente.statut = 'annulee' then
    raise exception 'cette vente a déjà été annulée par avoir';
  end if;

  for v_ligne in select * from ventes_lignes where vente_id = p_vente_id
  loop
    select depot_id into v_depot_id
    from stocks
    where produit_id = v_ligne.produit_id and entreprise_id = v_entreprise_id;

    update stocks
    set quantite = quantite + v_ligne.quantite, updated_at = now()
    where produit_id = v_ligne.produit_id and entreprise_id = v_entreprise_id;

    insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
    values (
      v_entreprise_id, v_ligne.produit_id, v_depot_id, 'entree', v_ligne.quantite,
      'Avoir sur vente ' || p_vente_id || ' — ' || p_motif, auth.uid()
    );
  end loop;

  update ventes set statut = 'annulee' where id = p_vente_id;

  insert into avoirs (entreprise_id, vente_id, motif, montant, created_by)
  values (v_entreprise_id, p_vente_id, p_motif, v_vente.total, auth.uid())
  returning id into v_avoir_id;

  return v_avoir_id;
end;
$$;

create or replace function creer_commande(
  p_client_id uuid,
  p_lignes jsonb,
  p_commercial_id uuid default null,
  p_depot_id uuid default null,
  p_mode_paiement text default 'cash',
  p_montant_paye numeric default null,
  p_date_livraison_souhaitee date default null,
  p_notes text default null,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := mon_entreprise_id();
  v_role text := current_role_utilisateur();
  v_commande_id uuid;
  v_ligne jsonb;
  v_montant_ht numeric(14,2) := 0;
  v_montant_paye numeric(14,2);
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'commercial', 'comptable') then
    raise exception 'accès refusé : votre rôle ne permet pas de créer une commande';
  end if;
  if p_mode_paiement not in ('cash', 'credit') then
    raise exception 'mode de paiement invalide';
  end if;

  perform 1 from clients where id = p_client_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'client introuvable pour cette entreprise';
  end if;

  if jsonb_array_length(p_lignes) = 0 then
    raise exception 'la commande doit contenir au moins un article';
  end if;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_montant_ht := v_montant_ht + ((v_ligne->>'quantite')::integer * (v_ligne->>'prix_unitaire')::numeric);
  end loop;

  v_montant_paye := coalesce(least(p_montant_paye, v_montant_ht), 0);
  if v_montant_paye < 0 then
    v_montant_paye := 0;
  end if;

  insert into commandes (
    entreprise_id, client_id, commercial_id, depot_id, statut,
    montant_ht, montant_tva, montant_ttc, mode_paiement, montant_paye,
    date_livraison_souhaitee, notes, latitude_saisie, longitude_saisie
  )
  values (
    v_entreprise_id, p_client_id, p_commercial_id, p_depot_id, 'brouillon',
    v_montant_ht, 0, v_montant_ht, p_mode_paiement, v_montant_paye,
    p_date_livraison_souhaitee, p_notes, p_latitude, p_longitude
  )
  returning id into v_commande_id;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    insert into lignes_commande (commande_id, produit_id, quantite, prix_unitaire)
    values (
      v_commande_id,
      (v_ligne->>'produit_id')::uuid,
      (v_ligne->>'quantite')::integer,
      (v_ligne->>'prix_unitaire')::numeric
    );
  end loop;

  insert into commande_historique (entreprise_id, commande_id, ancien_statut, nouveau_statut, effectue_par)
  values (v_entreprise_id, v_commande_id, null, 'brouillon', auth.uid());

  return v_commande_id;
end;
$$;

create or replace function creer_produit(p_nom text, p_categorie text, p_prix_vente numeric, p_seuil_alerte integer, p_quantite_initiale integer)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_produit_id uuid;
  v_depot_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattache a une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de créer un produit';
  end if;

  select id into v_depot_id
  from depots
  where entreprise_id = v_entreprise_id and actif = true
  order by nom
  limit 1;

  if v_depot_id is null then
    raise exception 'aucun depot actif trouve pour cette entreprise';
  end if;

  insert into produits (entreprise_id, nom, categorie, prix_vente, seuil_alerte)
  values (v_entreprise_id, p_nom, p_categorie, p_prix_vente, p_seuil_alerte)
  returning id into v_produit_id;

  insert into stocks (entreprise_id, produit_id, depot_id, quantite)
  values (v_entreprise_id, v_produit_id, v_depot_id, coalesce(p_quantite_initiale, 0));

  if coalesce(p_quantite_initiale, 0) > 0 then
    insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
    values (v_entreprise_id, v_produit_id, v_depot_id, 'entree', p_quantite_initiale, 'Stock initial', auth.uid());
  end if;

  return v_produit_id;
end;
$$;

create or replace function creer_sortie_stock(p_commercial_id uuid, p_depot_id uuid, p_lignes jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_sortie_id uuid;
  v_ligne jsonb;
  v_produit_id uuid;
  v_quantite integer;
  v_prix numeric(14,2);
  v_stock_actuel integer;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas d''émettre une sortie de stock';
  end if;
  if jsonb_array_length(p_lignes) = 0 then
    raise exception 'la sortie doit contenir au moins un article';
  end if;

  insert into sorties_stock (entreprise_id, commercial_id, depot_id, cree_par)
  values (v_entreprise_id, p_commercial_id, p_depot_id, auth.uid())
  returning id into v_sortie_id;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_quantite := (v_ligne->>'quantite')::integer;

    select quantite, prix_vente into v_stock_actuel, v_prix
    from stocks
    join produits on produits.id = stocks.produit_id
    where stocks.produit_id = v_produit_id and stocks.depot_id = p_depot_id and stocks.entreprise_id = v_entreprise_id
    for update;

    if v_stock_actuel is null then
      raise exception 'produit introuvable dans ce dépôt';
    end if;
    if v_stock_actuel < v_quantite then
      raise exception 'stock magasin insuffisant pour ce produit';
    end if;

    insert into sortie_stock_lignes (entreprise_id, sortie_id, produit_id, quantite_sortie, prix_unitaire)
    values (v_entreprise_id, v_sortie_id, v_produit_id, v_quantite, v_prix);

    update stocks
    set quantite = quantite - v_quantite, updated_at = now()
    where produit_id = v_produit_id and depot_id = p_depot_id and entreprise_id = v_entreprise_id;

    insert into stock_commercial (entreprise_id, commercial_id, produit_id, depot_origine, quantite)
    values (v_entreprise_id, p_commercial_id, v_produit_id, p_depot_id, v_quantite)
    on conflict (commercial_id, produit_id)
    do update set quantite = stock_commercial.quantite + excluded.quantite, updated_at = now();

    insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
    values (v_entreprise_id, v_produit_id, p_depot_id, 'sortie', v_quantite, 'Sortie vers commercial ' || p_commercial_id, auth.uid());
  end loop;

  return v_sortie_id;
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

create or replace function creer_vente(
  p_client_id uuid,
  p_lignes jsonb,
  p_mode_paiement text default 'cash',
  p_date_echeance date default null,
  p_commercial_id uuid default null,
  p_montant_paye numeric default null,
  p_mode_reglement text default 'espece',
  p_remise_montant numeric default 0,
  p_motif_remise text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_vente_id uuid;
  v_sous_total numeric(14,2) := 0;
  v_remise numeric(14,2);
  v_remise_pct numeric;
  v_seuil_remise numeric;
  v_remise_pct_txt text;
  v_seuil_txt text;
  v_total numeric(14,2);
  v_montant_regle numeric(14,2);
  v_ligne jsonb;
  v_produit_id uuid;
  v_quantite integer;
  v_prix_unitaire numeric(14,2);
  v_stock_actuel numeric;
  v_stock_commercial_actuel integer;
  v_depot_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;

  if v_role not in ('admin', 'manager', 'commercial', 'comptable') then
    raise exception 'accès refusé : votre rôle ne permet pas d''enregistrer une vente';
  end if;

  if p_mode_paiement not in ('cash', 'credit') then
    raise exception 'mode de paiement invalide';
  end if;

  perform 1 from clients where id = p_client_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'client introuvable pour cette entreprise';
  end if;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_quantite := (v_ligne->>'quantite')::integer;
    v_prix_unitaire := (v_ligne->>'prix_unitaire')::numeric;

    v_stock_commercial_actuel := null;
    if p_commercial_id is not null then
      select quantite into v_stock_commercial_actuel
      from stock_commercial
      where commercial_id = p_commercial_id and produit_id = v_produit_id and entreprise_id = v_entreprise_id
      for update;
    end if;

    if p_commercial_id is not null and coalesce(v_stock_commercial_actuel, 0) >= v_quantite then
      null;
    else
      select quantite into v_stock_actuel
      from stocks
      where produit_id = v_produit_id and entreprise_id = v_entreprise_id
      for update;

      if v_stock_actuel is null then
        raise exception 'produit introuvable pour cette entreprise';
      end if;
      if v_stock_actuel < v_quantite then
        raise exception 'stock insuffisant';
      end if;
    end if;

    v_sous_total := v_sous_total + (v_quantite * v_prix_unitaire);
  end loop;

  v_remise := coalesce(p_remise_montant, 0);
  if v_remise < 0 then
    v_remise := 0;
  end if;
  if v_remise > v_sous_total then
    raise exception 'la remise ne peut pas dépasser le sous-total';
  end if;
  if v_remise > 0 and (p_motif_remise is null or trim(p_motif_remise) = '') then
    raise exception 'un motif est requis pour appliquer une remise';
  end if;

  if v_remise > 0 and v_sous_total > 0 then
    v_remise_pct := (v_remise / v_sous_total) * 100;
    select seuil_remise_pourcentage into v_seuil_remise from entreprises where id = v_entreprise_id;
    v_seuil_remise := coalesce(v_seuil_remise, 15);

    if v_remise_pct > v_seuil_remise and v_role not in ('admin', 'manager') then
      v_remise_pct_txt := round(v_remise_pct, 1)::text || '%';
      v_seuil_txt := round(v_seuil_remise, 1)::text || '%';
      raise exception 'cette remise (%) dépasse le seuil autorisé (%) — seul un manager ou administrateur peut l''appliquer',
        v_remise_pct_txt, v_seuil_txt;
    end if;
  end if;

  v_total := v_sous_total - v_remise;

  v_montant_regle := coalesce(
    least(p_montant_paye, v_total),
    case when p_mode_paiement = 'cash' then v_total else 0 end
  );
  if v_montant_regle < 0 then
    v_montant_regle := 0;
  end if;

  insert into ventes (entreprise_id, client_id, total, created_by, mode_paiement, statut, montant_regle, date_echeance, commercial_id, mode_reglement, remise_montant, notes)
  values (
    v_entreprise_id, p_client_id, v_total, auth.uid(),
    case when v_montant_regle >= v_total then 'cash' else 'credit' end,
    'validee',
    v_montant_regle,
    case when v_montant_regle < v_total then p_date_echeance else null end,
    p_commercial_id,
    case when v_montant_regle > 0 then p_mode_reglement else null end,
    v_remise,
    case when v_remise > 0 then 'Remise : ' || p_motif_remise else null end
  )
  returning id into v_vente_id;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_quantite := (v_ligne->>'quantite')::integer;
    v_prix_unitaire := (v_ligne->>'prix_unitaire')::numeric;

    v_stock_commercial_actuel := null;
    if p_commercial_id is not null then
      select quantite into v_stock_commercial_actuel
      from stock_commercial
      where commercial_id = p_commercial_id and produit_id = v_produit_id and entreprise_id = v_entreprise_id;
    end if;

    insert into ventes_lignes (vente_id, produit_id, quantite, prix_unitaire, sous_total)
    values (v_vente_id, v_produit_id, v_quantite, v_prix_unitaire, v_quantite * v_prix_unitaire);

    if p_commercial_id is not null and coalesce(v_stock_commercial_actuel, 0) >= v_quantite then
      update stock_commercial
      set quantite = quantite - v_quantite, updated_at = now()
      where commercial_id = p_commercial_id and produit_id = v_produit_id and entreprise_id = v_entreprise_id;
    else
      select depot_id into v_depot_id
      from stocks
      where produit_id = v_produit_id and entreprise_id = v_entreprise_id;

      update stocks
      set quantite = quantite - v_quantite, updated_at = now()
      where produit_id = v_produit_id and entreprise_id = v_entreprise_id;

      insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
      values (v_entreprise_id, v_produit_id, v_depot_id, 'sortie', v_quantite, 'Vente ' || v_vente_id, auth.uid());
    end if;
  end loop;

  return v_vente_id;
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

  if v_role not in ('admin', 'manager', 'commercial', 'comptable') then
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

create or replace function enregistrer_versement_caisse(p_commercial_id uuid, p_caisse_id uuid, p_montant numeric, p_date_versement date default current_date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_versement_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé : votre rôle ne permet pas d''enregistrer un versement';
  end if;
  if p_montant is null or p_montant <= 0 then
    raise exception 'montant invalide';
  end if;

  perform 1 from caisses where id = p_caisse_id and entreprise_id = v_entreprise_id and actif = true;
  if not found then
    raise exception 'caisse introuvable ou inactive pour cette entreprise';
  end if;

  perform 1 from profils where id = p_commercial_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'commercial introuvable pour cette entreprise';
  end if;

  insert into versements_caisse (entreprise_id, commercial_id, caisse_id, montant, date_versement, recu_par)
  values (v_entreprise_id, p_commercial_id, p_caisse_id, p_montant, p_date_versement, auth.uid())
  returning id into v_versement_id;

  return v_versement_id;
end;
$$;

create or replace function importer_solde_creance(p_client_id uuid, p_montant numeric, p_date_echeance date default null, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := mon_entreprise_id();
  v_role text := current_role_utilisateur();
  v_vente_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager') then
    raise exception 'accès refusé : seul un administrateur ou un manager peut importer un solde';
  end if;
  if p_montant is null or p_montant <= 0 then
    raise exception 'montant invalide';
  end if;

  perform 1 from clients where id = p_client_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'client introuvable pour cette entreprise';
  end if;

  insert into ventes (
    entreprise_id, client_id, total, created_by, mode_paiement, statut,
    montant_regle, date_echeance, solde_report, notes
  )
  values (
    v_entreprise_id, p_client_id, p_montant, auth.uid(), 'credit', 'validee',
    0, p_date_echeance, true, coalesce(p_notes, 'Solde reporté (import)')
  )
  returning id into v_vente_id;

  return v_vente_id;
end;
$$;

create or replace function livrer_commande(p_commande_id uuid, p_lignes_livrees jsonb, p_montant_supplementaire_paye numeric default 0, p_mode_paiement text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := mon_entreprise_id();
  v_role text := current_role_utilisateur();
  v_client_id uuid;
  v_commercial_id uuid;
  v_statut_actuel text;
  v_mode_paiement text;
  v_montant_paye_commande numeric(14,2);
  v_ligne jsonb;
  v_produit_id uuid;
  v_qte_livree integer;
  v_prix_unitaire numeric(14,2);
  v_lignes_vente jsonb := '[]'::jsonb;
  v_montant_paye_total numeric(14,2);
  v_vente_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'commercial', 'comptable') then
    raise exception 'accès refusé';
  end if;

  select client_id, commercial_id, statut, mode_paiement, montant_paye
  into v_client_id, v_commercial_id, v_statut_actuel, v_mode_paiement, v_montant_paye_commande
  from commandes
  where id = p_commande_id and entreprise_id = v_entreprise_id
  for update;

  if v_client_id is null then
    raise exception 'commande introuvable pour cette entreprise';
  end if;
  if v_statut_actuel in ('livree', 'annulee') then
    raise exception 'cette commande est déjà % et ne peut plus être livrée', v_statut_actuel;
  end if;

  v_mode_paiement := coalesce(p_mode_paiement, v_mode_paiement, 'cash');

  for v_ligne in select * from jsonb_array_elements(p_lignes_livrees)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_qte_livree := (v_ligne->>'quantite_livree')::integer;

    update lignes_commande
    set quantite_livree = v_qte_livree
    where commande_id = p_commande_id and produit_id = v_produit_id;

    if v_qte_livree > 0 then
      select prix_unitaire into v_prix_unitaire
      from lignes_commande
      where commande_id = p_commande_id and produit_id = v_produit_id;

      v_lignes_vente := v_lignes_vente || jsonb_build_object(
        'produit_id', v_produit_id,
        'quantite', v_qte_livree,
        'prix_unitaire', v_prix_unitaire
      );
    end if;
  end loop;

  if jsonb_array_length(v_lignes_vente) = 0 then
    raise exception 'aucun article à livrer (toutes les quantités sont à zéro)';
  end if;

  v_montant_paye_total := coalesce(v_montant_paye_commande, 0) + coalesce(p_montant_supplementaire_paye, 0);

  v_vente_id := creer_vente(v_client_id, v_lignes_vente, v_mode_paiement, null, v_commercial_id, v_montant_paye_total);

  update commandes
  set statut = 'livree', vente_id = v_vente_id, mode_paiement = v_mode_paiement, updated_at = now()
  where id = p_commande_id;

  insert into commande_historique (entreprise_id, commande_id, ancien_statut, nouveau_statut, note, effectue_par)
  values (v_entreprise_id, p_commande_id, v_statut_actuel, 'livree', 'Convertie en vente ' || v_vente_id, auth.uid());

  return v_vente_id;
end;
$$;

create or replace function retourner_stock(p_sortie_id uuid, p_lignes_retour jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_commercial_id uuid;
  v_depot_id uuid;
  v_statut text;
  v_ligne jsonb;
  v_produit_id uuid;
  v_qte_retour integer;
  v_qte_en_main integer;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas d''enregistrer un retour de stock';
  end if;

  select commercial_id, depot_id, statut into v_commercial_id, v_depot_id, v_statut
  from sorties_stock
  where id = p_sortie_id and entreprise_id = v_entreprise_id
  for update;

  if v_commercial_id is null then
    raise exception 'sortie introuvable pour cette entreprise';
  end if;
  if v_statut = 'cloturee' then
    raise exception 'cette sortie a déjà été clôturée';
  end if;

  for v_ligne in select * from jsonb_array_elements(p_lignes_retour)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_qte_retour := (v_ligne->>'quantite_retournee')::integer;

    select quantite into v_qte_en_main
    from stock_commercial
    where commercial_id = v_commercial_id and produit_id = v_produit_id and entreprise_id = v_entreprise_id
    for update;

    if v_qte_en_main is null then
      v_qte_en_main := 0;
    end if;
    if v_qte_retour > v_qte_en_main then
      raise exception 'quantité retournée (%) supérieure au stock actuellement en possession du commercial (%)', v_qte_retour, v_qte_en_main;
    end if;

    update sortie_stock_lignes
    set quantite_retournee = v_qte_retour
    where sortie_id = p_sortie_id and produit_id = v_produit_id;

    update stock_commercial
    set quantite = quantite - v_qte_retour, updated_at = now()
    where commercial_id = v_commercial_id and produit_id = v_produit_id and entreprise_id = v_entreprise_id;

    if v_qte_retour > 0 then
      update stocks
      set quantite = quantite + v_qte_retour, updated_at = now()
      where produit_id = v_produit_id and depot_id = v_depot_id and entreprise_id = v_entreprise_id;

      insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
      values (v_entreprise_id, v_produit_id, v_depot_id, 'entree', v_qte_retour, 'Retour de tournée — commercial ' || v_commercial_id, auth.uid());
    end if;
  end loop;

  update sorties_stock
  set statut = 'cloturee', cloture_par = auth.uid(), cloture_at = now()
  where id = p_sortie_id;
end;
$$;

create or replace function valider_visite(p_tournee_ligne_id uuid, p_latitude double precision, p_longitude double precision, p_tolerance_metres integer default 150)
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
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
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
