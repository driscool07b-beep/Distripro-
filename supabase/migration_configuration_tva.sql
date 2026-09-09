-- Migration : configuration de la TVA et des autres taxes (type AIRSI).
--
-- IMPORTANT — à faire vérifier par un comptable avant usage réel : le
-- calcul ci-dessous applique la remise proportionnellement à la TVA (une
-- remise de X% sur le HT réduit la TVA de X% aussi), et les « autres
-- taxes » (AIRSI...) se calculent soit sur le HT net soit sur le TTC
-- selon ce qui est configuré par taxe. C'est une implémentation
-- raisonnable mais je ne suis pas comptable — vérifie ces règles avec le
-- tien avant de t'appuyer dessus pour de vraies factures.
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Schéma
-- ---------------------------------------------------------------------

-- L'entreprise doit explicitement se déclarer assujettie (régime réel
-- normal ou simplifié en Côte d'Ivoire, par exemple) — par défaut non,
-- pour ne rien changer au comportement existant des entreprises qui ne
-- facturent pas la TVA.
alter table entreprises add column if not exists assujetti_tva boolean not null default false;

-- Chaque produit déclare individuellement s'il est soumis à la TVA et à
-- quel taux (le taux varie selon la nature de la marchandise).
alter table produits add column if not exists tva_applicable boolean not null default false;
alter table produits add column if not exists taux_tva numeric(5,2);

-- Autres taxes (AIRSI, etc.) : liste configurable par entreprise plutôt
-- que codée en dur, puisque ça varie selon le pays et le régime fiscal.
-- base_calcul détermine si la taxe se calcule sur le HT net (après
-- remise) ou sur le TTC (HT + TVA) — AIRSI se calcule typiquement sur le
-- montant + la TVA, donc 'ttc'.
create table if not exists taxes_entreprise (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  nom text not null,
  taux numeric(5,2) not null,
  base_calcul text not null default 'ttc' check (base_calcul in ('ht', 'ttc')),
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_taxes_entreprise_entreprise on taxes_entreprise(entreprise_id);

alter table taxes_entreprise enable row level security;

drop policy if exists taxes_entreprise_select on taxes_entreprise;
create policy taxes_entreprise_select on taxes_entreprise
  for select using (entreprise_id = current_entreprise_id());

-- Détail de la facturation sur les ventes (montant_regle et statut,
-- déjà existants, ne bougent pas — total reste le montant TTC + autres
-- taxes réellement dû par le client, comme avant).
alter table ventes add column if not exists montant_ht numeric(14,2) not null default 0;
alter table ventes add column if not exists montant_tva numeric(14,2) not null default 0;
alter table ventes add column if not exists montant_autres_taxes numeric(14,2) not null default 0;

alter table ventes_lignes add column if not exists taux_tva numeric(5,2) not null default 0;
alter table ventes_lignes add column if not exists montant_tva numeric(14,2) not null default 0;

-- ---------------------------------------------------------------------
-- 2. Configuration : assujettissement entreprise, taxes personnalisées
-- ---------------------------------------------------------------------
create or replace function configurer_assujettissement_tva(p_assujetti boolean)
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
  if v_role <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut configurer la TVA';
  end if;

  update entreprises set assujetti_tva = p_assujetti where id = v_entreprise_id;
end;
$$;

create or replace function creer_taxe_entreprise(p_nom text, p_taux numeric, p_base_calcul text default 'ttc')
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut configurer les taxes';
  end if;
  if p_nom is null or trim(p_nom) = '' then
    raise exception 'le nom de la taxe est requis';
  end if;
  if p_taux is null or p_taux < 0 then
    raise exception 'taux invalide';
  end if;
  if p_base_calcul not in ('ht', 'ttc') then
    raise exception 'base de calcul invalide';
  end if;

  insert into taxes_entreprise (entreprise_id, nom, taux, base_calcul)
  values (v_entreprise_id, trim(p_nom), p_taux, p_base_calcul)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function modifier_taxe_entreprise(p_taxe_id uuid, p_nom text, p_taux numeric, p_base_calcul text, p_actif boolean)
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
  if v_role <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut configurer les taxes';
  end if;
  if p_base_calcul not in ('ht', 'ttc') then
    raise exception 'base de calcul invalide';
  end if;

  update taxes_entreprise
  set nom = trim(p_nom), taux = p_taux, base_calcul = p_base_calcul, actif = p_actif
  where id = p_taxe_id and entreprise_id = v_entreprise_id;

  if not found then
    raise exception 'taxe introuvable pour cette entreprise';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. creer_produit / modifier_produit : ajout tva_applicable + taux_tva.
--    Nouveaux paramètres => nouvelle signature => on supprime l'ancienne
--    version d'abord (même piège que d'habitude si on ne le fait pas).
-- ---------------------------------------------------------------------
drop function if exists creer_produit(text, text, numeric, integer, integer, uuid);

create or replace function creer_produit(
  p_nom text,
  p_categorie text,
  p_prix_vente numeric,
  p_seuil_alerte integer,
  p_quantite_initiale integer,
  p_depot_id uuid default null,
  p_tva_applicable boolean default false,
  p_taux_tva numeric default null
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

  insert into produits (entreprise_id, nom, categorie, prix_vente, seuil_alerte, tva_applicable, taux_tva)
  values (v_entreprise_id, p_nom, p_categorie, p_prix_vente, p_seuil_alerte, coalesce(p_tva_applicable, false), case when p_tva_applicable then p_taux_tva else null end)
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

drop function if exists modifier_produit(uuid, text, text, numeric, integer);

create or replace function modifier_produit(
  p_produit_id uuid,
  p_nom text,
  p_categorie text,
  p_prix_vente numeric,
  p_seuil_alerte integer,
  p_tva_applicable boolean default false,
  p_taux_tva numeric default null
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
      taux_tva = case when p_tva_applicable then p_taux_tva else null end
  where id = p_produit_id and entreprise_id = v_entreprise_id;

  if v_ancien_prix is distinct from p_prix_vente then
    insert into produits_historique_prix (entreprise_id, produit_id, ancien_prix, nouveau_prix, modifie_par)
    values (v_entreprise_id, p_produit_id, v_ancien_prix, p_prix_vente, auth.uid());
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. creer_vente : calcule maintenant HT / TVA / autres taxes. Signature
--    inchangée (aucun nouveau paramètre — la TVA se déduit des produits
--    vendus et de la configuration de l'entreprise) : CREATE OR REPLACE
--    la remplace en place.
--
--    Quand l'entreprise n'est pas assujettie (cas par défaut, comportement
--    de toutes les entreprises existantes) : montant_tva = 0,
--    montant_autres_taxes = 0, total = HT - remise, EXACTEMENT comme
--    avant cette migration. Rien ne change pour qui ne configure rien.
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
  p_depot_id uuid default null,
  p_credit_utilise numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_assujetti_tva boolean;
  v_vente_id uuid;
  v_sous_total numeric(14,2) := 0;
  v_sous_total_tva numeric(14,2) := 0;
  v_facteur_remise numeric;
  v_montant_ht numeric(14,2);
  v_montant_tva numeric(14,2);
  v_montant_autres_taxes numeric(14,2) := 0;
  v_ttc numeric(14,2);
  v_remise numeric(14,2);
  v_remise_pct numeric;
  v_seuil_remise numeric;
  v_remise_pct_txt text;
  v_seuil_txt text;
  v_total numeric(14,2);
  v_montant_regle numeric(14,2);
  v_credit_client numeric(14,2);
  v_credit_effectif numeric(14,2);
  v_ligne jsonb;
  v_produit_id uuid;
  v_quantite integer;
  v_prix_unitaire numeric(14,2);
  v_produit_tva_applicable boolean;
  v_produit_taux_tva numeric;
  v_stock_actuel numeric;
  v_stock_commercial_actuel integer;
  v_depot_id uuid;
  v_nb_depots integer;
  v_besoin_depot boolean := false;
  v_taxe record;
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

  select coalesce(assujetti_tva, false) into v_assujetti_tva from entreprises where id = v_entreprise_id;

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

    if v_assujetti_tva then
      select tva_applicable, taux_tva into v_produit_tva_applicable, v_produit_taux_tva
      from produits where id = v_produit_id;
      if v_produit_tva_applicable and v_produit_taux_tva is not null then
        v_sous_total_tva := v_sous_total_tva + (v_quantite * v_prix_unitaire * v_produit_taux_tva / 100);
      end if;
    end if;
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

  -- HT net après remise, TVA réduite dans la même proportion que le HT
  -- (une remise de X% réduit le HT et la TVA de X% chacun).
  v_montant_ht := v_sous_total - v_remise;
  v_facteur_remise := case when v_sous_total > 0 then v_montant_ht / v_sous_total else 1 end;
  v_montant_tva := round(v_sous_total_tva * v_facteur_remise, 2);
  v_ttc := v_montant_ht + v_montant_tva;

  -- Autres taxes actives (AIRSI...), chacune sur sa propre base (HT net
  -- ou TTC selon sa configuration).
  for v_taxe in select taux, base_calcul from taxes_entreprise where entreprise_id = v_entreprise_id and actif = true
  loop
    v_montant_autres_taxes := v_montant_autres_taxes +
      round((case when v_taxe.base_calcul = 'ht' then v_montant_ht else v_ttc end) * v_taxe.taux / 100, 2);
  end loop;

  v_total := v_ttc + v_montant_autres_taxes;

  -- Crédit client : ne peut pas dépasser ni le solde disponible du
  -- client, ni le total de la vente.
  select coalesce(solde_credit, 0) into v_credit_client from clients where id = p_client_id and entreprise_id = v_entreprise_id for update;
  v_credit_effectif := least(greatest(coalesce(p_credit_utilise, 0), 0), coalesce(v_credit_client, 0), v_total);

  v_montant_regle := v_credit_effectif + coalesce(
    least(p_montant_paye, v_total - v_credit_effectif),
    case when p_mode_paiement = 'cash' then v_total - v_credit_effectif else 0 end
  );
  if v_montant_regle < 0 then
    v_montant_regle := 0;
  end if;
  if v_montant_regle > v_total then
    v_montant_regle := v_total;
  end if;

  insert into ventes (
    entreprise_id, client_id, total, created_by, mode_paiement, statut, montant_regle, date_echeance,
    commercial_id, mode_reglement, remise_montant, notes, depot_id, montant_ht, montant_tva, montant_autres_taxes
  )
  values (
    v_entreprise_id, p_client_id, v_total, auth.uid(),
    case when v_montant_regle >= v_total then 'cash' else 'credit' end,
    'validee',
    v_montant_regle,
    case when v_montant_regle < v_total then p_date_echeance else null end,
    p_commercial_id,
    case when v_montant_regle - v_credit_effectif > 0 then p_mode_reglement else null end,
    v_remise,
    case when v_remise > 0 then 'Remise : ' || p_motif_remise else null end,
    case when v_besoin_depot then v_depot_id else null end,
    v_montant_ht, v_montant_tva, v_montant_autres_taxes
  )
  returning id into v_vente_id;

  if v_credit_effectif > 0 then
    update clients set solde_credit = solde_credit - v_credit_effectif where id = p_client_id and entreprise_id = v_entreprise_id;
    insert into mouvements_credit_client (entreprise_id, client_id, montant, type_mouvement, vente_id, motif, effectue_par)
    values (v_entreprise_id, p_client_id, v_credit_effectif, 'utilisation_vente', v_vente_id, 'Appliqué sur vente ' || v_vente_id, auth.uid());
  end if;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_quantite := (v_ligne->>'quantite')::integer;
    v_prix_unitaire := (v_ligne->>'prix_unitaire')::numeric;

    v_produit_tva_applicable := false;
    v_produit_taux_tva := null;
    if v_assujetti_tva then
      select tva_applicable, taux_tva into v_produit_tva_applicable, v_produit_taux_tva
      from produits where id = v_produit_id;
    end if;

    v_stock_commercial_actuel := null;
    if p_commercial_id is not null then
      select quantite into v_stock_commercial_actuel
      from stock_commercial
      where commercial_id = p_commercial_id and produit_id = v_produit_id and entreprise_id = v_entreprise_id;
    end if;

    insert into ventes_lignes (vente_id, produit_id, quantite, prix_unitaire, sous_total, taux_tva, montant_tva)
    values (
      v_vente_id, v_produit_id, v_quantite, v_prix_unitaire, v_quantite * v_prix_unitaire,
      coalesce(case when v_produit_tva_applicable then v_produit_taux_tva else 0 end, 0),
      case when v_produit_tva_applicable and v_produit_taux_tva is not null
        then round(v_quantite * v_prix_unitaire * v_produit_taux_tva / 100, 2) else 0 end
    );

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
