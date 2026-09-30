-- Migration : les lots suivent la marchandise (sorties vers les commerciaux,
-- retours, transferts entre magasins).
-- Jusqu'ici, seuls les ventes et les ajustements tenaient les lots à jour :
-- une sortie ou un transfert laissait les lots comptés dans le magasin
-- d'origine (détail par lot faux, « premier périmé, premier sorti » faussé).
--  - Sortie vers un commercial : les lots quittent le magasin (bons lots,
--    premier périmé d'abord) et on garde la trace de quels lots il a reçus.
--  - Retour de tournée : les invendus retrouvent leurs lots d'origine.
--  - Transfert : les lots partent en transit, puis sont recréés au magasin
--    de destination (même numéro, péremption et état) à la réception.
-- Les versions actuelles des fonctions sont reprises à l'identique, avec
-- seulement la gestion des lots en plus.
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists sortie_lignes_lots (
  id uuid primary key default gen_random_uuid(),
  sortie_ligne_id uuid not null references sortie_stock_lignes(id) on delete cascade,
  lot_id uuid not null references lots(id),
  quantite integer not null check (quantite > 0),
  quantite_retournee integer not null default 0 check (quantite_retournee >= 0)
);
create index if not exists idx_sortie_lignes_lots on sortie_lignes_lots (sortie_ligne_id);

create table if not exists transfert_lots (
  id uuid primary key default gen_random_uuid(),
  transfert_id uuid not null references transferts_stock(id) on delete cascade,
  lot_id uuid references lots(id),
  numero_lot text not null,
  date_peremption date,
  etat text not null default 'bon',
  quantite integer not null check (quantite > 0),
  quantite_recue integer
);
create index if not exists idx_transfert_lots on transfert_lots (transfert_id);

alter table sortie_lignes_lots enable row level security;
alter table transfert_lots enable row level security;
drop policy if exists sortie_lignes_lots_select on sortie_lignes_lots;
create policy sortie_lignes_lots_select on sortie_lignes_lots
  for select using (exists (select 1 from sortie_stock_lignes l where l.id = sortie_ligne_id));
drop policy if exists transfert_lots_select on transfert_lots;
create policy transfert_lots_select on transfert_lots
  for select using (exists (select 1 from transferts_stock t where t.id = transfert_id));

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
  v_ligne_id uuid;
  v_lot record;
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
  if not mon_depot_autorise(p_depot_id) then
    raise exception 'accès refusé : ce dépôt ne vous est pas attribué';
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
    values (v_entreprise_id, v_sortie_id, v_produit_id, v_quantite, v_prix)
    returning id into v_ligne_id;

    -- Les lots suivent la marchandise : bons lots, premier périmé en premier.
    for v_lot in select * from consommer_lots_fifo(v_produit_id, p_depot_id, v_quantite) loop
      insert into sortie_lignes_lots (sortie_ligne_id, lot_id, quantite)
      values (v_ligne_id, v_lot.lot_id, v_lot.quantite_consommee);
    end loop;

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
  v_reste integer;
  v_sl record;
  v_prendre integer;
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
  if not mon_depot_autorise(v_depot_id) then
    raise exception 'accès refusé : ce dépôt ne vous est pas attribué';
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

      -- Les invendus rapportés retrouvent les lots dont ils étaient sortis
      -- (les plus récents d'abord : les plus anciens sont supposés vendus).
      v_reste := v_qte_retour;
      for v_sl in
        select sll.* from sortie_lignes_lots sll
        join sortie_stock_lignes l on l.id = sll.sortie_ligne_id
        join lots lo on lo.id = sll.lot_id
        where l.sortie_id = p_sortie_id and l.produit_id = v_produit_id and lo.depot_id = v_depot_id
        order by lo.date_peremption desc nulls first, lo.created_at desc
        for update of sll
      loop
        exit when v_reste <= 0;
        v_prendre := least(v_reste, v_sl.quantite - v_sl.quantite_retournee);
        if v_prendre > 0 then
          update lots set quantite_restante = quantite_restante + v_prendre where id = v_sl.lot_id;
          update sortie_lignes_lots set quantite_retournee = quantite_retournee + v_prendre where id = v_sl.id;
          v_reste := v_reste - v_prendre;
        end if;
      end loop;
    end if;
  end loop;

  update sorties_stock
  set statut = 'cloturee', cloture_par = auth.uid(), cloture_at = now()
  where id = p_sortie_id;
end;
$$;


create or replace function transferer_stock(
  p_produit_id uuid,
  p_depot_source_id uuid,
  p_depot_destination_id uuid,
  p_quantite integer,
  p_motif text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_nom_destination text;
  v_stock_source integer;
  v_mouvement_sortie_id uuid;
  v_transfert_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de transférer du stock';
  end if;
  if p_quantite is null or p_quantite <= 0 then
    raise exception 'la quantité doit être supérieure à zéro';
  end if;
  if p_depot_source_id = p_depot_destination_id then
    raise exception 'le dépôt source et le dépôt destination doivent être différents';
  end if;
  if not mon_depot_autorise(p_depot_source_id) then
    raise exception 'accès refusé : le dépôt source ne vous est pas attribué';
  end if;

  perform 1 from depots where id = p_depot_source_id and entreprise_id = v_entreprise_id and actif = true;
  if not found then
    raise exception 'dépôt source introuvable ou inactif pour cette entreprise';
  end if;
  select nom into v_nom_destination from depots where id = p_depot_destination_id and entreprise_id = v_entreprise_id and actif = true;
  if v_nom_destination is null then
    raise exception 'dépôt destination introuvable ou inactif pour cette entreprise';
  end if;

  select quantite into v_stock_source
  from stocks
  where produit_id = p_produit_id and depot_id = p_depot_source_id and entreprise_id = v_entreprise_id
  for update;

  if v_stock_source is null then
    raise exception 'produit introuvable dans le dépôt source';
  end if;
  if v_stock_source < p_quantite then
    raise exception 'stock insuffisant dans le dépôt source';
  end if;

  update stocks
  set quantite = quantite - p_quantite, updated_at = now()
  where produit_id = p_produit_id and depot_id = p_depot_source_id and entreprise_id = v_entreprise_id;

  insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
  values (
    v_entreprise_id, p_produit_id, p_depot_source_id, 'sortie', p_quantite,
    'Transfert vers ' || v_nom_destination || ' (en transit)' || case when p_motif is not null and trim(p_motif) <> '' then ' — ' || trim(p_motif) else '' end,
    auth.uid()
  )
  returning id into v_mouvement_sortie_id;

  insert into transferts_stock (
    entreprise_id, produit_id, depot_source_id, depot_destination_id,
    quantite_envoyee, motif, mouvement_sortie_id, envoye_par
  )
  values (
    v_entreprise_id, p_produit_id, p_depot_source_id, p_depot_destination_id,
    p_quantite, p_motif, v_mouvement_sortie_id, auth.uid()
  )
  returning id into v_transfert_id;

  -- Les lots partent avec la marchandise (en transit jusqu'à la réception).
  insert into transfert_lots (transfert_id, lot_id, numero_lot, date_peremption, etat, quantite)
  select v_transfert_id, c.lot_id, lo.numero_lot, lo.date_peremption, lo.etat, c.quantite_consommee
  from consommer_lots_fifo(p_produit_id, p_depot_source_id, p_quantite) c
  join lots lo on lo.id = c.lot_id;

  return jsonb_build_object('transfert_id', v_transfert_id, 'mouvement_sortie_id', v_mouvement_sortie_id);
end;
$$;


create or replace function receptionner_transfert(
  p_transfert_id uuid,
  p_quantite_recue integer,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_transfert record;
  v_nom_source text;
  v_motif text;
  v_mouvement_entree_id uuid;
  v_reste integer;
  v_tl record;
  v_prendre integer;
  v_lot_dest uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de réceptionner un transfert';
  end if;
  if p_quantite_recue is null or p_quantite_recue < 0 then
    raise exception 'la quantité reçue doit être positive ou nulle';
  end if;

  select * into v_transfert
  from transferts_stock
  where id = p_transfert_id and entreprise_id = v_entreprise_id
  for update;

  if not found then
    raise exception 'transfert introuvable pour cette entreprise';
  end if;
  if v_transfert.statut = 'receptionne' then
    raise exception 'ce transfert a déjà été réceptionné';
  end if;
  if not mon_depot_autorise(v_transfert.depot_destination_id) then
    raise exception 'accès refusé : le dépôt destination ne vous est pas attribué';
  end if;

  select nom into v_nom_source from depots where id = v_transfert.depot_source_id;

  v_motif := 'Réception transfert depuis ' || coalesce(v_nom_source, 'dépôt inconnu');
  if p_quantite_recue <> v_transfert.quantite_envoyee then
    v_motif := v_motif || format(' — écart : envoyé %s, reçu %s', v_transfert.quantite_envoyee, p_quantite_recue);
  end if;
  if p_note is not null and trim(p_note) <> '' then
    v_motif := v_motif || ' — ' || trim(p_note);
  end if;

  if p_quantite_recue > 0 then
    insert into stocks (entreprise_id, produit_id, depot_id, quantite)
    values (v_entreprise_id, v_transfert.produit_id, v_transfert.depot_destination_id, p_quantite_recue)
    on conflict (produit_id, depot_id)
    do update set quantite = stocks.quantite + excluded.quantite, updated_at = now();

    insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
    values (v_entreprise_id, v_transfert.produit_id, v_transfert.depot_destination_id, 'entree', p_quantite_recue, v_motif, auth.uid())
    returning id into v_mouvement_entree_id;

    -- Les lots transférés sont recréés au magasin de destination (même
    -- numéro, même péremption, même état). En cas de perte en transit, les
    -- premiers lots envoyés sont reçus en priorité.
    v_reste := p_quantite_recue;
    for v_tl in select * from transfert_lots where transfert_id = p_transfert_id order by date_peremption nulls last, id loop
      exit when v_reste <= 0;
      v_prendre := least(v_reste, v_tl.quantite);
      select id into v_lot_dest from lots
      where entreprise_id = v_entreprise_id and produit_id = v_transfert.produit_id
        and depot_id = v_transfert.depot_destination_id and numero_lot = v_tl.numero_lot
      for update;
      if v_lot_dest is null then
        insert into lots (entreprise_id, produit_id, depot_id, numero_lot, date_peremption, quantite_initiale, quantite_restante, created_by, etat)
        values (v_entreprise_id, v_transfert.produit_id, v_transfert.depot_destination_id, v_tl.numero_lot, v_tl.date_peremption,
                v_prendre, v_prendre, auth.uid(), v_tl.etat);
      else
        update lots set quantite_initiale = quantite_initiale + v_prendre, quantite_restante = quantite_restante + v_prendre
        where id = v_lot_dest;
      end if;
      update transfert_lots set quantite_recue = v_prendre where id = v_tl.id;
      v_reste := v_reste - v_prendre;
    end loop;
  end if;
  -- Si p_quantite_recue = 0 (perte totale en transit), aucun mouvement de
  -- stock n'est créé (la contrainte quantite > 0 l'interdit de toute
  -- façon) : la perte reste tracée dans transferts_stock.quantite_recue
  -- et le motif calculé plus haut, consultable sur le transfert lui-même.

  update transferts_stock
  set statut = 'receptionne',
      quantite_recue = p_quantite_recue,
      receptionne_par = auth.uid(),
      receptionne_at = now(),
      mouvement_entree_id = v_mouvement_entree_id
  where id = p_transfert_id;

  return v_mouvement_entree_id;
end;
$$;


notify pgrst, 'reload schema';
