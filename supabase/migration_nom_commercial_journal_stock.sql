-- Migration : le journal des mouvements de stock affichait l'UUID brut du
-- commercial ("Sortie vers commercial 71d464b3-...") au lieu de son nom,
-- car creer_sortie_stock et retourner_stock concaténaient p_commercial_id
-- directement dans le texte du motif au moment de l'enregistrement.
--
-- Corrige les deux fonctions pour résoudre le nom une fois, puis met à jour
-- les lignes déjà enregistrées dans l'historique avec le même format.
--
-- À exécuter dans l'éditeur SQL de Supabase.

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
  v_nom_commercial text;
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

  select nom into v_nom_commercial from profils where id = p_commercial_id and entreprise_id = v_entreprise_id;
  if v_nom_commercial is null then
    raise exception 'commercial introuvable pour cette entreprise';
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
    values (v_entreprise_id, v_produit_id, p_depot_id, 'sortie', v_quantite, 'Sortie vers commercial ' || v_nom_commercial, auth.uid());
  end loop;

  return v_sortie_id;
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
  v_nom_commercial text;
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

  select nom into v_nom_commercial from profils where id = v_commercial_id;

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
      values (v_entreprise_id, v_produit_id, v_depot_id, 'entree', v_qte_retour, 'Retour de tournée — commercial ' || coalesce(v_nom_commercial, v_commercial_id::text), auth.uid());
    end if;
  end loop;

  update sorties_stock
  set statut = 'cloturee', cloture_par = auth.uid(), cloture_at = now()
  where id = p_sortie_id;
end;
$$;

-- Corrige l'historique déjà enregistré : remplace l'UUID par le nom dans
-- les motifs existants, pour les deux tournures de phrase utilisées.
update mouvements_stock m
set motif = 'Sortie vers commercial ' || p.nom
from profils p
where m.motif ~ ('^Sortie vers commercial ' || p.id::text || '$');

update mouvements_stock m
set motif = 'Retour de tournée — commercial ' || p.nom
from profils p
where m.motif ~ ('^Retour de tournée — commercial ' || p.id::text || '$');
