-- Migration : traçabilité produits (sécurité alimentaire/qualité) —
-- code-barres, numéros de lot avec péremption, consommation FIFO
-- automatique à la vente, traçabilité des livraisons par lot, alerte
-- de péremption pour le gestionnaire de stock.
--
-- Tout est optionnel par défaut — n'affecte aucune autre entreprise
-- tant que ce n'est pas activé explicitement (Paramètres → Traçabilité
-- des lots).
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Réglage — obligation du numéro de lot à chaque entrée de stock.
-- ---------------------------------------------------------------------
alter table entreprises add column if not exists tracabilite_lots_obligatoire boolean not null default false;

create or replace function modifier_parametrage_tracabilite(p_obligatoire boolean)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if current_role_utilisateur() <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut modifier ce réglage';
  end if;
  update entreprises set tracabilite_lots_obligatoire = p_obligatoire where id = current_entreprise_id();
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Code-barres produit — pour utilisation avec un lecteur physique.
-- ---------------------------------------------------------------------
alter table produits add column if not exists code_barre text;
create index if not exists idx_produits_code_barre on produits(entreprise_id, code_barre) where code_barre is not null;

-- ---------------------------------------------------------------------
-- 3. Lots — un lot par produit/dépôt/numéro, avec péremption.
-- ---------------------------------------------------------------------
create table if not exists lots (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  produit_id uuid not null references produits(id),
  depot_id uuid not null references depots(id),
  numero_lot text not null,
  date_production date,
  date_peremption date,
  quantite_initiale numeric not null check (quantite_initiale > 0),
  quantite_restante numeric not null check (quantite_restante >= 0),
  created_by uuid not null references profils(id),
  created_at timestamptz not null default now(),
  unique (entreprise_id, produit_id, depot_id, numero_lot)
);

create index if not exists idx_lots_produit_depot on lots(produit_id, depot_id) where quantite_restante > 0;
create index if not exists idx_lots_peremption on lots(entreprise_id, date_peremption) where quantite_restante > 0;

alter table lots enable row level security;
drop policy if exists lots_select on lots;
create policy lots_select on lots
  for select using (entreprise_id = current_entreprise_id());

-- ---------------------------------------------------------------------
-- 4. Trace, sur chaque ligne de vente, quel(s) lot(s) et quelle
--    quantité ont été consommés — permet de retrouver tous les
--    clients livrés à partir d'un lot donné en cas de rappel produit.
-- ---------------------------------------------------------------------
create table if not exists ventes_lignes_lots (
  id uuid primary key default gen_random_uuid(),
  vente_ligne_id uuid not null references ventes_lignes(id) on delete cascade,
  lot_id uuid not null references lots(id),
  quantite numeric not null check (quantite > 0)
);

alter table ventes_lignes_lots enable row level security;
drop policy if exists ventes_lignes_lots_select on ventes_lignes_lots;
create policy ventes_lignes_lots_select on ventes_lignes_lots
  for select using (
    lot_id in (select id from lots where entreprise_id = current_entreprise_id())
  );

-- ---------------------------------------------------------------------
-- 5. Consommation FIFO — péremption la plus proche en premier (les
--    lots sans date de péremption passent en dernier), puis le plus
--    ancien reçu. Fonction interne réutilisée par la vente et par un
--    ajustement de stock manuel.
-- ---------------------------------------------------------------------
create or replace function consommer_lots_fifo(p_produit_id uuid, p_depot_id uuid, p_quantite numeric)
returns table(lot_id uuid, quantite_consommee numeric)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_reste numeric := p_quantite;
  v_lot record;
  v_prendre numeric;
begin
  for v_lot in
    select id, quantite_restante from lots
    where produit_id = p_produit_id and depot_id = p_depot_id and quantite_restante > 0
    order by date_peremption nulls last, created_at
    for update
  loop
    exit when v_reste <= 0;
    v_prendre := least(v_lot.quantite_restante, v_reste);
    update lots set quantite_restante = quantite_restante - v_prendre where id = v_lot.id;
    v_reste := v_reste - v_prendre;
    lot_id := v_lot.id;
    quantite_consommee := v_prendre;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. ajuster_stock — capture le numéro de lot à l'entrée ; consomme
--    FIFO à la sortie manuelle (ajustement, casse...).
-- ---------------------------------------------------------------------
create or replace function ajuster_stock(
  p_produit_id uuid,
  p_type text,
  p_quantite integer,
  p_motif text,
  p_depot_id uuid default null,
  p_numero_lot text default null,
  p_date_peremption date default null
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
  v_tracabilite_obligatoire boolean;
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

  if not mon_depot_autorise(v_depot_id) then
    raise exception 'accès refusé : ce dépôt ne vous est pas attribué';
  end if;

  select tracabilite_lots_obligatoire into v_tracabilite_obligatoire from entreprises where id = v_entreprise_id;
  if p_type = 'entree' and v_tracabilite_obligatoire and (p_numero_lot is null or trim(p_numero_lot) = '') then
    raise exception 'le numéro de lot est obligatoire pour cette entreprise';
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

  if p_type = 'entree' and p_numero_lot is not null and trim(p_numero_lot) <> '' then
    insert into lots (entreprise_id, produit_id, depot_id, numero_lot, date_peremption, quantite_initiale, quantite_restante, created_by)
    values (v_entreprise_id, p_produit_id, v_depot_id, trim(p_numero_lot), p_date_peremption, p_quantite, p_quantite, auth.uid())
    on conflict (entreprise_id, produit_id, depot_id, numero_lot)
    do update set quantite_initiale = lots.quantite_initiale + p_quantite,
                  quantite_restante = lots.quantite_restante + p_quantite,
                  date_peremption = coalesce(excluded.date_peremption, lots.date_peremption);
  elsif p_type = 'sortie' then
    perform consommer_lots_fifo(p_produit_id, v_depot_id, p_quantite);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. creer_vente — consomme les lots FIFO à chaque ligne débitant le
--    dépôt (transparent pour le commercial, aucune saisie requise),
--    et trace le lien vente ↔ lot pour la traçabilité.
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
  v_ligne_id uuid;
  v_lot_consomme record;
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
    values (v_vente_id, v_produit_id, v_quantite, v_prix_unitaire, v_quantite * v_prix_unitaire)
    returning id into v_ligne_id;

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

      for v_lot_consomme in select * from consommer_lots_fifo(v_produit_id, v_depot_id, v_quantite)
      loop
        insert into ventes_lignes_lots (vente_ligne_id, lot_id, quantite)
        values (v_ligne_id, v_lot_consomme.lot_id, v_lot_consomme.quantite_consommee);
      end loop;
    end if;
  end loop;

  return v_vente_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Lots à écouler en priorité — signalé au gestionnaire de stock
--    (péremption proche, triés du plus urgent au moins urgent).
-- ---------------------------------------------------------------------
create or replace function lots_a_destocker(p_jours_alerte integer default 30)
returns table (
  lot_id uuid, numero_lot text, produit_id uuid, produit_nom text,
  depot_id uuid, depot_nom text, quantite_restante numeric,
  date_peremption date, jours_restants integer
)
language sql
security definer
stable
set search_path to 'public'
as $$
  select l.id, l.numero_lot, l.produit_id, p.nom, l.depot_id, d.nom, l.quantite_restante,
         l.date_peremption, (l.date_peremption - current_date)::integer
  from lots l
  join produits p on p.id = l.produit_id
  join depots d on d.id = l.depot_id
  where l.entreprise_id = current_entreprise_id()
    and l.quantite_restante > 0
    and l.date_peremption is not null
    and l.date_peremption <= current_date + p_jours_alerte
  order by l.date_peremption asc;
$$;

-- ---------------------------------------------------------------------
-- 9. creer_produit / modifier_produit — ajout du code-barres.
-- ---------------------------------------------------------------------
create or replace function creer_produit(
  p_nom text,
  p_categorie text,
  p_prix_vente numeric,
  p_seuil_alerte integer,
  p_quantite_initiale integer,
  p_depot_id uuid default null,
  p_tva_applicable boolean default false,
  p_taux_tva numeric default null,
  p_code_barre text default null
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
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de créer un produit';
  end if;

  if v_role = 'gestionnaire_stock' and p_depot_id is null then
    raise exception 'précisez le dépôt de stockage initial';
  end if;

  if p_depot_id is not null then
    perform 1 from depots where id = p_depot_id and entreprise_id = v_entreprise_id and actif = true;
    if not found then
      raise exception 'dépôt introuvable ou inactif pour cette entreprise';
    end if;
    if not mon_depot_autorise(p_depot_id) then
      raise exception 'accès refusé : ce dépôt ne vous est pas attribué';
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

  if p_tva_applicable and (p_taux_tva is null or p_taux_tva < 0) then
    raise exception 'un taux de TVA valide est requis quand la TVA est applicable';
  end if;

  insert into produits (entreprise_id, nom, categorie, prix_vente, seuil_alerte, tva_applicable, taux_tva, code_barre)
  values (v_entreprise_id, p_nom, p_categorie, p_prix_vente, p_seuil_alerte, coalesce(p_tva_applicable, false), case when p_tva_applicable then p_taux_tva else null end, nullif(trim(p_code_barre), ''))
  returning id into v_produit_id;

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

drop function if exists modifier_produit(uuid, text, text, numeric, integer, boolean, numeric);

create or replace function modifier_produit(
  p_produit_id uuid,
  p_nom text,
  p_categorie text,
  p_prix_vente numeric,
  p_seuil_alerte integer,
  p_tva_applicable boolean default false,
  p_taux_tva numeric default null,
  p_code_barre text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_ancien_prix numeric;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de modifier un produit';
  end if;
  if p_nom is null or trim(p_nom) = '' then
    raise exception 'le nom du produit est requis';
  end if;
  if p_prix_vente is null or p_prix_vente <= 0 then
    raise exception 'prix invalide';
  end if;
  if p_tva_applicable and (p_taux_tva is null or p_taux_tva < 0) then
    raise exception 'un taux de TVA valide est requis quand la TVA est applicable';
  end if;

  select prix_vente into v_ancien_prix
  from produits
  where id = p_produit_id and entreprise_id = v_entreprise_id;

  if not found then
    raise exception 'produit introuvable pour cette entreprise';
  end if;

  update produits
  set nom = trim(p_nom), categorie = p_categorie, prix_vente = p_prix_vente, seuil_alerte = p_seuil_alerte,
      tva_applicable = coalesce(p_tva_applicable, false),
      taux_tva = case when p_tva_applicable then p_taux_tva else null end,
      code_barre = nullif(trim(p_code_barre), '')
  where id = p_produit_id and entreprise_id = v_entreprise_id;

  if v_ancien_prix is distinct from p_prix_vente then
    insert into produits_historique_prix (entreprise_id, produit_id, ancien_prix, nouveau_prix, modifie_par)
    values (v_entreprise_id, p_produit_id, v_ancien_prix, p_prix_vente, auth.uid());
  end if;
end;
$$;
