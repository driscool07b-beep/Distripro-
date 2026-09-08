-- Migration : dernier morceau du multi-dépôts — les ventes et les avoirs
-- ignoraient jusqu'ici le dépôt. Sans filtre depot_id, creer_vente
-- décrémentait TOUTES les lignes de stock d'un produit (tous dépôts
-- confondus) au lieu d'une seule, et creer_avoir remettait la quantité
-- dans un dépôt choisi au hasard (premier trouvé par la requête).
--
-- Corrige aussi au passage : ajuster_stock et creer_produit avaient reçu
-- un paramètre p_depot_id dans migration_multi_depots.sql, mais la
-- reconstruction du 06/09 (migration_lecture_seule_toutes_fonctions.sql)
-- reflétait l'état réel de la base à ce moment-là SANS ce paramètre — la
-- sélection de dépôt sur ces deux fonctions ne s'était donc jamais
-- retrouvée appliquée en base. On la restaure ici avant de s'appuyer
-- dessus pour les ventes.
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Colonne depot_id sur ventes (nullable : une vente entièrement
--    servie depuis le stock personnel d'un commercial ne débite aucun
--    dépôt magasin).
-- ---------------------------------------------------------------------
alter table ventes add column if not exists depot_id uuid references depots(id);

-- ---------------------------------------------------------------------
-- 2. ajuster_stock : restaure p_depot_id (défaut null = comportement
--    précédent si un seul dépôt actif existe, exception explicite sinon).
-- ---------------------------------------------------------------------
create or replace function ajuster_stock(
  p_produit_id uuid,
  p_type text,
  p_quantite integer,
  p_motif text,
  p_depot_id uuid default null
)
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
  v_nb_depots integer;
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

  if p_depot_id is not null then
    v_depot_id := p_depot_id;
  else
    select count(*) into v_nb_depots from depots where entreprise_id = v_entreprise_id and actif = true;
    if v_nb_depots > 1 then
      raise exception 'plusieurs dépôts existent — précisez le dépôt à ajuster';
    end if;
    select id into v_depot_id from depots where entreprise_id = v_entreprise_id and actif = true limit 1;
  end if;

  select quantite into v_quantite_actuelle
  from stocks
  where produit_id = p_produit_id and depot_id = v_depot_id and entreprise_id = v_entreprise_id
  for update;

  if v_quantite_actuelle is null then
    raise exception 'produit introuvable dans ce dépôt pour cette entreprise';
  end if;

  if p_type = 'sortie' and v_quantite_actuelle < p_quantite then
    raise exception 'stock insuffisant';
  end if;

  update stocks
  set quantite = quantite + (case when p_type = 'entree' then p_quantite else -p_quantite end),
      updated_at = now()
  where produit_id = p_produit_id and depot_id = v_depot_id and entreprise_id = v_entreprise_id;

  insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
  values (v_entreprise_id, p_produit_id, v_depot_id, p_type, p_quantite, p_motif, auth.uid());
end;
$$;

-- ---------------------------------------------------------------------
-- 3. creer_produit : restaure p_depot_id (défaut null = premier dépôt
--    actif par ordre alphabétique, comportement précédent).
-- ---------------------------------------------------------------------
create or replace function creer_produit(
  p_nom text,
  p_categorie text,
  p_prix_vente numeric,
  p_seuil_alerte integer,
  p_quantite_initiale integer,
  p_depot_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_produit_id uuid;
  v_depot_principal uuid;
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

  if p_depot_id is not null then
    perform 1 from depots where id = p_depot_id and entreprise_id = v_entreprise_id and actif = true;
    if not found then
      raise exception 'dépôt introuvable ou inactif pour cette entreprise';
    end if;
    v_depot_principal := p_depot_id;
  else
    select id into v_depot_principal
    from depots
    where entreprise_id = v_entreprise_id and actif = true
    order by nom
    limit 1;
  end if;

  if v_depot_principal is null then
    raise exception 'aucun depot actif trouve pour cette entreprise';
  end if;

  insert into produits (entreprise_id, nom, categorie, prix_vente, seuil_alerte)
  values (v_entreprise_id, p_nom, p_categorie, p_prix_vente, p_seuil_alerte)
  returning id into v_produit_id;

  -- Une ligne de stock (à 0) dans chaque dépôt actif de l'entreprise, avec
  -- la quantité initiale placée dans le dépôt choisi.
  insert into stocks (entreprise_id, produit_id, depot_id, quantite)
  select v_entreprise_id, v_produit_id, d.id,
    case when d.id = v_depot_principal then coalesce(p_quantite_initiale, 0) else 0 end
  from depots d
  where d.entreprise_id = v_entreprise_id and d.actif = true;

  if coalesce(p_quantite_initiale, 0) > 0 then
    insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
    values (v_entreprise_id, v_produit_id, v_depot_principal, 'entree', p_quantite_initiale, 'Stock initial', auth.uid());
  end if;

  return v_produit_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. creer_vente : ajoute p_depot_id. Une vente peut mélanger des lignes
--    servies depuis le stock personnel du commercial (inchangé) et des
--    lignes servies depuis le stock magasin — ces dernières doivent
--    toutes sortir du MÊME dépôt, choisi une fois pour la vente entière
--    (même principe que creer_commande et creer_sortie_stock).
-- ---------------------------------------------------------------------
create or replace function creer_vente(
  p_client_id uuid,
  p_lignes jsonb,
  p_mode_paiement text default 'cash',
  p_date_echeance date default null,
  p_commercial_id uuid default null,
  p_montant_paye numeric default null,
  p_mode_reglement text default 'espece',
  p_remise_montant numeric default 0,
  p_motif_remise text default null,
  p_depot_id uuid default null
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
  v_nb_depots integer;
  v_besoin_depot boolean := false;
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

  -- Détermine le dépôt : explicite si fourni, sinon dépôt unique si un
  -- seul dépôt actif existe. Ne devient obligatoire que si une ligne a
  -- effectivement besoin du stock magasin (pas seulement du stock
  -- personnel du commercial).
  if p_depot_id is not null then
    perform 1 from depots where id = p_depot_id and entreprise_id = v_entreprise_id and actif = true;
    if not found then
      raise exception 'dépôt introuvable ou inactif pour cette entreprise';
    end if;
    v_depot_id := p_depot_id;
  else
    select count(*) into v_nb_depots from depots where entreprise_id = v_entreprise_id and actif = true;
    if v_nb_depots = 1 then
      select id into v_depot_id from depots where entreprise_id = v_entreprise_id and actif = true limit 1;
    end if;
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
      v_besoin_depot := true;
      if v_depot_id is null then
        raise exception 'plusieurs dépôts existent — précisez le dépôt de vente';
      end if;

      select quantite into v_stock_actuel
      from stocks
      where produit_id = v_produit_id and depot_id = v_depot_id and entreprise_id = v_entreprise_id
      for update;

      if v_stock_actuel is null then
        raise exception 'produit introuvable dans ce dépôt pour cette entreprise';
      end if;
      if v_stock_actuel < v_quantite then
        raise exception 'stock insuffisant dans ce dépôt';
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

  insert into ventes (entreprise_id, client_id, total, created_by, mode_paiement, statut, montant_regle, date_echeance, commercial_id, mode_reglement, remise_montant, notes, depot_id)
  values (
    v_entreprise_id, p_client_id, v_total, auth.uid(),
    case when v_montant_regle >= v_total then 'cash' else 'credit' end,
    'validee',
    v_montant_regle,
    case when v_montant_regle < v_total then p_date_echeance else null end,
    p_commercial_id,
    case when v_montant_regle > 0 then p_mode_reglement else null end,
    v_remise,
    case when v_remise > 0 then 'Remise : ' || p_motif_remise else null end,
    case when v_besoin_depot then v_depot_id else null end
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
      update stocks
      set quantite = quantite - v_quantite, updated_at = now()
      where produit_id = v_produit_id and depot_id = v_depot_id and entreprise_id = v_entreprise_id;

      insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
      values (v_entreprise_id, v_produit_id, v_depot_id, 'sortie', v_quantite, 'Vente ' || v_vente_id, auth.uid());
    end if;
  end loop;

  return v_vente_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. creer_avoir : remet la quantité dans le dépôt réellement débité par
--    la vente d'origine (ventes.depot_id), au lieu d'un dépôt choisi au
--    hasard. Si la vente n'avait débité aucun dépôt (entièrement servie
--    depuis le stock personnel du commercial) ou date d'avant cette
--    migration, on retombe sur le dépôt unique s'il n'y en a qu'un, sinon
--    on demande une action explicite plutôt que de deviner.
-- ---------------------------------------------------------------------
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
  v_nb_depots integer;
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

  v_depot_id := v_vente.depot_id;
  if v_depot_id is null then
    select count(*) into v_nb_depots from depots where entreprise_id = v_entreprise_id and actif = true;
    if v_nb_depots = 1 then
      select id into v_depot_id from depots where entreprise_id = v_entreprise_id and actif = true limit 1;
    else
      raise exception 'dépôt d''origine inconnu pour cette vente — remettez le stock manuellement puis annulez la vente';
    end if;
  end if;

  for v_ligne in select * from ventes_lignes where vente_id = p_vente_id
  loop
    update stocks
    set quantite = quantite + v_ligne.quantite, updated_at = now()
    where produit_id = v_ligne.produit_id and depot_id = v_depot_id and entreprise_id = v_entreprise_id;

    if not found then
      raise exception 'produit introuvable dans le dépôt d''origine pour cette entreprise';
    end if;

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

-- ---------------------------------------------------------------------
-- 6. Faille d'isolation multi-tenant trouvée au passage : la table
--    depots n'a jamais eu la RLS activée (contrairement à produits,
--    stocks, ventes…). Ventes.jsx va maintenant l'interroger directement
--    pour peupler le sélecteur de dépôt — sans ceci, un utilisateur de
--    n'importe quelle entreprise cliente peut lister les dépôts de
--    toutes les autres entreprises du SaaS.
-- ---------------------------------------------------------------------
alter table depots enable row level security;

drop policy if exists depots_select on depots;
create policy depots_select on depots
  for select using (entreprise_id = current_entreprise_id());
