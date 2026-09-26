-- Migration : audit des mouvements — corrections (vente, avoir, échanges,
-- argent à remettre par les commerciaux).
--
-- 1. VENTE — une seule fonction creer_vente (les anciennes versions sont
--    supprimées) qui réunit : taxes (TVA, AIRSI…), avoir client, contrôle des
--    remises ET traçabilité des lots (la version utilisée jusqu'ici ne
--    déduisait pas les lots).
--    + choix EXPLICITE de la source de la marchandise : magasin ou stock
--      terrain du commercial (auparavant choisie automatiquement, sans le dire).
--    + un commercial ne peut vendre qu'en son propre nom.
--    + fonction d'aperçu des totaux (HT, TVA, autres taxes, TTC) pour que
--      l'écran affiche exactement le montant que le serveur enregistrera.
-- 2. AVOIR — possible pour une vente faite depuis le stock d'un commercial
--    (choix du magasin de retour) ; les lots d'origine sont reconstitués.
-- 3. ÉCHANGES DÉFECTUEUX — plafond : pas plus d'unités échangées que d'unités
--    en main depuis la dernière sortie reçue du magasin.
-- 4. ARGENT À REMETTRE (réconciliation et « reste à verser ») — seuls les
--    encaissements physiques comptent (espèces, chèques), acomptes des ventes
--    à crédit compris, avoir client utilisé exclu, ventes annulées ensuite
--    comprises (l'argent a bien été encaissé).
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------------
-- Anciennes versions de creer_vente (surcharges accumulées au fil des
-- migrations) : supprimées pour qu'une seule version, contrôlée, subsiste.
-- ---------------------------------------------------------------------------
drop function if exists creer_vente(uuid, jsonb);
drop function if exists creer_vente(uuid, jsonb, text, date);
drop function if exists creer_vente(uuid, jsonb, text, date, uuid);
drop function if exists creer_vente(uuid, jsonb, text, date, uuid, numeric);
drop function if exists creer_vente(uuid, jsonb, text, date, uuid, numeric, text);
drop function if exists creer_vente(uuid, jsonb, text, date, uuid, numeric, text, numeric, text);
drop function if exists creer_vente(uuid, jsonb, text, date, uuid, numeric, text, numeric, text, uuid);
drop function if exists creer_vente(uuid, jsonb, text, date, uuid, numeric, text, numeric, text, uuid, numeric);

alter table ventes_lignes add column if not exists source_stock text;

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
  p_credit_utilise numeric default 0,
  p_source_stock text default null
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
  v_detail_taxes jsonb := '[]'::jsonb;
  v_detail_taxe jsonb;
  v_depuis_commercial boolean;
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

  -- Source de la marchandise : 'depot' (magasin), 'commercial' (stock terrain
  -- du commercial) ; null = comportement historique (stock du commercial
  -- s'il suffit, sinon magasin), conservé pour les ventes hors ligne.
  if p_source_stock is not null and p_source_stock not in ('depot', 'commercial') then
    raise exception 'source de stock invalide';
  end if;
  if v_role = 'commercial' and p_commercial_id is not null and p_commercial_id <> auth.uid() then
    raise exception 'un commercial ne peut enregistrer une vente qu''en son propre nom';
  end if;
  if p_source_stock = 'commercial' and p_commercial_id is null then
    raise exception 'choisissez le commercial dont le stock est utilisé';
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

    if p_source_stock = 'commercial' and coalesce(v_stock_commercial_actuel, 0) < v_quantite then
      raise exception 'stock du commercial insuffisant pour ce produit (% en main)', coalesce(v_stock_commercial_actuel, 0);
    end if;
    v_depuis_commercial := p_commercial_id is not null and coalesce(p_source_stock, 'auto') <> 'depot'
      and coalesce(v_stock_commercial_actuel, 0) >= v_quantite;

    if v_depuis_commercial then
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

  v_montant_ht := v_sous_total - v_remise;
  v_facteur_remise := case when v_sous_total > 0 then v_montant_ht / v_sous_total else 1 end;
  v_montant_tva := round(v_sous_total_tva * v_facteur_remise, 2);
  v_ttc := v_montant_ht + v_montant_tva;

  -- Autres taxes actives (AIRSI...) : on mémorise le détail (nom, taux,
  -- montant) dans v_detail_taxes pour l'enregistrer dans ventes_taxes une
  -- fois la vente créée (on a besoin de v_vente_id pour la clé étrangère).
  for v_taxe in select nom, taux, base_calcul from taxes_entreprise where entreprise_id = v_entreprise_id and actif = true
  loop
    v_detail_taxe := jsonb_build_object(
      'nom', v_taxe.nom,
      'taux', v_taxe.taux,
      'base_calcul', v_taxe.base_calcul,
      'montant', round((case when v_taxe.base_calcul = 'ht' then v_montant_ht else v_ttc end) * v_taxe.taux / 100, 2)
    );
    v_detail_taxes := v_detail_taxes || v_detail_taxe;
    v_montant_autres_taxes := v_montant_autres_taxes + (v_detail_taxe->>'montant')::numeric;
  end loop;

  v_total := v_ttc + v_montant_autres_taxes;

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

  -- Enregistre maintenant le détail des autres taxes, vente_id connu.
  for v_detail_taxe in select * from jsonb_array_elements(v_detail_taxes)
  loop
    insert into ventes_taxes (entreprise_id, vente_id, nom, taux, montant, base_calcul)
    values (
      v_entreprise_id, v_vente_id,
      v_detail_taxe->>'nom',
      (v_detail_taxe->>'taux')::numeric,
      (v_detail_taxe->>'montant')::numeric,
      v_detail_taxe->>'base_calcul'
    );
  end loop;

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

    v_depuis_commercial := p_commercial_id is not null and coalesce(p_source_stock, 'auto') <> 'depot'
      and coalesce(v_stock_commercial_actuel, 0) >= v_quantite;

    insert into ventes_lignes (vente_id, produit_id, quantite, prix_unitaire, sous_total, taux_tva, montant_tva, source_stock)
    values (
      v_vente_id, v_produit_id, v_quantite, v_prix_unitaire, v_quantite * v_prix_unitaire,
      coalesce(case when v_produit_tva_applicable then v_produit_taux_tva else 0 end, 0),
      case when v_produit_tva_applicable and v_produit_taux_tva is not null
        then round(v_quantite * v_prix_unitaire * v_produit_taux_tva / 100, 2) else 0 end,
      case when v_depuis_commercial then 'commercial' else 'depot' end
    )
    returning id into v_ligne_id;

    if v_depuis_commercial then
      update stock_commercial
      set quantite = quantite - v_quantite, updated_at = now()
      where commercial_id = p_commercial_id and produit_id = v_produit_id and entreprise_id = v_entreprise_id;
    else
      update stocks
      set quantite = quantite - v_quantite, updated_at = now()
      where produit_id = v_produit_id and depot_id = v_depot_id and entreprise_id = v_entreprise_id;

      insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
      values (v_entreprise_id, v_produit_id, v_depot_id, 'sortie', v_quantite, 'Vente ' || v_vente_id, auth.uid());

      -- Traçabilité : la vente consomme les lots du magasin (bons lots,
      -- premier périmé en premier) et mémorise lesquels.
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

-- ---------------------------------------------------------------------------
-- Aperçu des totaux d'une vente (mêmes règles que creer_vente).
-- ---------------------------------------------------------------------------
create or replace function calculer_totaux_vente(p_lignes jsonb, p_remise_montant numeric default 0)
returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_assujetti boolean;
  v_ligne jsonb;
  v_sous_total numeric := 0;
  v_tva_brute numeric := 0;
  v_tva_applicable boolean;
  v_taux numeric;
  v_remise numeric := greatest(coalesce(p_remise_montant, 0), 0);
  v_ht numeric;
  v_tva numeric;
  v_ttc numeric;
  v_taxe record;
  v_autres jsonb := '[]'::jsonb;
  v_total_autres numeric := 0;
  v_montant numeric;
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  select coalesce(assujetti_tva, false) into v_assujetti from entreprises where id = v_entreprise_id;
  for v_ligne in select * from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) loop
    v_sous_total := v_sous_total + coalesce((v_ligne->>'quantite')::numeric, 0) * coalesce((v_ligne->>'prix_unitaire')::numeric, 0);
    if v_assujetti then
      select tva_applicable, taux_tva into v_tva_applicable, v_taux from produits
      where id = (v_ligne->>'produit_id')::uuid and entreprise_id = v_entreprise_id;
      if v_tva_applicable and v_taux is not null then
        v_tva_brute := v_tva_brute + coalesce((v_ligne->>'quantite')::numeric, 0) * coalesce((v_ligne->>'prix_unitaire')::numeric, 0) * v_taux / 100;
      end if;
    end if;
  end loop;
  v_remise := least(v_remise, v_sous_total);
  v_ht := v_sous_total - v_remise;
  v_tva := round(v_tva_brute * case when v_sous_total > 0 then v_ht / v_sous_total else 1 end, 2);
  v_ttc := v_ht + v_tva;
  for v_taxe in select nom, taux, base_calcul from taxes_entreprise where entreprise_id = v_entreprise_id and actif = true loop
    v_montant := round((case when v_taxe.base_calcul = 'ht' then v_ht else v_ttc end) * v_taxe.taux / 100, 2);
    v_autres := v_autres || jsonb_build_object('nom', v_taxe.nom, 'taux', v_taxe.taux, 'montant', v_montant);
    v_total_autres := v_total_autres + v_montant;
  end loop;
  return jsonb_build_object('sous_total', v_sous_total, 'remise', v_remise, 'ht', v_ht, 'tva', v_tva,
                            'autres_taxes', v_autres, 'total', v_ttc + v_total_autres);
end;
$$;

-- ---------------------------------------------------------------------------
-- Argent physiquement encaissé sur une vente (espèces / chèque), hors avoir
-- client utilisé. Sert à la réconciliation et au « reste à verser ».
-- ---------------------------------------------------------------------------
create or replace function encaisse_physique_vente(p_vente_id uuid)
returns numeric
language sql
security definer
stable
set search_path to 'public'
as $$
  select case when coalesce(v.mode_reglement, 'espece') in ('espece', 'cheque')
    then greatest(v.montant_regle - coalesce((
      select sum(m.montant) from mouvements_credit_client m
      where m.vente_id = v.id and m.type_mouvement = 'utilisation_vente'), 0), 0)
    else 0 end
  from ventes v where v.id = p_vente_id;
$$;

-- ---------------------------------------------------------------------------
drop function if exists creer_avoir(uuid, text);
create or replace function creer_avoir(p_vente_id uuid, p_motif text, p_depot_id uuid default null)
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

  -- Dépôt de retour : celui de la vente ; pour une vente faite depuis le
  -- stock d'un commercial (pas de dépôt), celui indiqué à l'avoir.
  v_depot_id := coalesce(v_vente.depot_id, p_depot_id);
  if v_depot_id is not null then
    perform 1 from depots where id = v_depot_id and entreprise_id = v_entreprise_id;
    if not found then raise exception 'dépôt de retour introuvable'; end if;
  end if;
  if v_depot_id is null then
    select count(*) into v_nb_depots from depots where entreprise_id = v_entreprise_id and actif = true;
    if v_nb_depots = 1 then
      select id into v_depot_id from depots where entreprise_id = v_entreprise_id and actif = true limit 1;
    else
      raise exception 'précisez le magasin où la marchandise est rendue';
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

    -- Les lots d'origine retrouvent leurs quantités (même magasin).
    update lots l set quantite_restante = l.quantite_restante + vll.quantite
    from ventes_lignes_lots vll
    where vll.vente_ligne_id = v_ligne.id and l.id = vll.lot_id and l.depot_id = v_depot_id;
  end loop;

  update ventes set statut = 'annulee' where id = p_vente_id;

  insert into avoirs (entreprise_id, vente_id, motif, montant, created_by)
  values (v_entreprise_id, p_vente_id, p_motif, v_vente.total, auth.uid())
  returning id into v_avoir_id;

  -- Le montant déjà encaissé sur cette vente devient un crédit en
  -- faveur du client, plutôt que de simplement disparaître.
  if v_vente.client_id is not null and coalesce(v_vente.montant_regle, 0) > 0 then
    update clients
    set solde_credit = coalesce(solde_credit, 0) + v_vente.montant_regle
    where id = v_vente.client_id and entreprise_id = v_entreprise_id;

    insert into mouvements_credit_client (entreprise_id, client_id, montant, type_mouvement, vente_id, motif, effectue_par)
    values (
      v_entreprise_id, v_vente.client_id, v_vente.montant_regle, 'credit_annulation', p_vente_id,
      'Annulation vente — ' || p_motif, auth.uid()
    );
  end if;

  return v_avoir_id;
end;
$$;

-- ---------------------------------------------------------------------------
create or replace function echanger_produits_defectueux(
  p_commercial_id uuid, p_depot_id uuid, p_produit_id uuid, p_quantite integer, p_motif text, p_justificatif_chemin text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_en_main integer;
  v_stock_depot integer;
  v_lot_id uuid;
  v_echange_id uuid;
  v_nom text;
  v_deja integer;
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : l''échange se fait au magasin';
  end if;
  if not mon_depot_autorise(p_depot_id) then raise exception 'accès refusé : ce dépôt ne vous est pas attribué'; end if;
  if p_quantite is null or p_quantite <= 0 then raise exception 'quantité invalide'; end if;
  if coalesce(length(trim(p_motif)), 0) < 3 then raise exception 'le motif est obligatoire'; end if;

  select quantite into v_en_main from stock_commercial
  where commercial_id = p_commercial_id and produit_id = p_produit_id and entreprise_id = v_entreprise_id;
  if coalesce(v_en_main, 0) < p_quantite then
    raise exception 'le commercial n''a que % unité(s) de ce produit en main', coalesce(v_en_main, 0);
  end if;
  -- Un même produit ne peut pas être échangé plus de fois qu'il n'y en a en
  -- main depuis la dernière sortie reçue du magasin (sinon : échanges
  -- répétés sur les mêmes unités).
  select coalesce(sum(e.quantite), 0) into v_deja
  from echanges_defectueux e
  where e.commercial_id = p_commercial_id and e.produit_id = p_produit_id
    and e.created_at > coalesce((
      select max(m.created_at) from mouvements_stock_commercial m
      where m.commercial_id = p_commercial_id and m.produit_id = p_produit_id and m.type = 'sortie'
    ), '-infinity'::timestamptz);
  if v_deja + p_quantite > v_en_main then
    raise exception 'échange refusé : % unité(s) déjà échangée(s) depuis la dernière sortie du magasin ; au plus % encore échangeable(s)', v_deja, greatest(v_en_main - v_deja, 0);
  end if;

  select quantite into v_stock_depot from stocks
  where produit_id = p_produit_id and depot_id = p_depot_id and entreprise_id = v_entreprise_id for update;
  if coalesce(v_stock_depot, 0) < p_quantite then
    raise exception 'stock en bon état insuffisant au magasin pour l''échange (% disponible)', coalesce(v_stock_depot, 0);
  end if;
  select nom into v_nom from profils where id = p_commercial_id;

  -- Le magasin donne des produits sains (lots en bon état consommés en
  -- premier) et reçoit les défectueux dans un lot « endommagé » : la
  -- quantité totale du magasin ne change pas, celle du commercial non plus.
  perform consommer_lots_fifo(p_produit_id, p_depot_id, p_quantite);
  insert into lots (entreprise_id, produit_id, depot_id, numero_lot, quantite_initiale, quantite_restante, created_by, etat, etat_motif, etat_modifie_par, etat_modifie_at)
  values (v_entreprise_id, p_produit_id, p_depot_id,
          'DEFECTUEUX-' || to_char(now() at time zone 'Africa/Abidjan', 'YYYYMMDD-HH24MISS'),
          p_quantite, p_quantite, auth.uid(), 'endommage', 'Échange commercial : ' || trim(p_motif), auth.uid(), now())
  returning id into v_lot_id;

  insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par, reference_doc)
  values (v_entreprise_id, p_produit_id, p_depot_id, 'sortie', p_quantite, 'Échange défectueux — produits sains remis à ' || coalesce(v_nom, 'commercial'), auth.uid(), p_justificatif_chemin),
         (v_entreprise_id, p_produit_id, p_depot_id, 'entree', p_quantite, 'Échange défectueux — produits abîmés repris de ' || coalesce(v_nom, 'commercial') || ' : ' || trim(p_motif), auth.uid(), p_justificatif_chemin);

  insert into echanges_defectueux (entreprise_id, commercial_id, depot_id, produit_id, quantite, motif, lot_defectueux_id, justificatif_chemin, effectue_par)
  values (v_entreprise_id, p_commercial_id, p_depot_id, p_produit_id, p_quantite, trim(p_motif), v_lot_id, p_justificatif_chemin, auth.uid())
  returning id into v_echange_id;
  return v_echange_id;
end;
$$;

-- ---------------------------------------------------------------------------
create or replace function preparer_reconciliation(p_commercial_id uuid, p_date_debut date, p_date_fin date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_valorisation text;
  v_id uuid;
  v_numero text;
  v_debut timestamptz := (p_date_debut::timestamp at time zone 'Africa/Abidjan');
  v_fin timestamptz := ((p_date_fin + 1)::timestamp at time zone 'Africa/Abidjan');
  v_ventes numeric;
  v_recouvrements numeric;
  v_verse numeric;
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if not peut_valider_caisse() then raise exception 'accès refusé : seuls la caisse, le comptable et la direction préparent une réconciliation'; end if;
  if p_date_fin < p_date_debut then raise exception 'la date de fin doit suivre la date de début'; end if;
  if p_date_fin > (now() at time zone 'Africa/Abidjan')::date then raise exception 'la période ne peut pas finir dans le futur'; end if;
  perform 1 from profils where id = p_commercial_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'commercial introuvable'; end if;
  if exists (
    select 1 from reconciliations_commercial
    where commercial_id = p_commercial_id and statut <> 'annulee'
      and daterange(date_debut, date_fin, '[]') && daterange(p_date_debut, p_date_fin, '[]')
  ) then
    raise exception 'une réconciliation existe déjà pour ce commercial sur une partie de cette période';
  end if;

  select valorisation_manquant into v_valorisation from entreprises where id = v_entreprise_id;

  -- Argent physiquement encaissé par le commercial (espèces, chèques) :
  -- ventes comptant ET acomptes des ventes à crédit, hors avoir client
  -- utilisé, y compris les ventes annulées ensuite (l'argent a été encaissé).
  select coalesce(sum(encaisse_physique_vente(v.id)), 0) into v_ventes from ventes v
  where v.entreprise_id = v_entreprise_id and v.commercial_id = p_commercial_id
    and v.created_at >= v_debut and v.created_at < v_fin;
  select coalesce(sum(montant), 0) into v_recouvrements from reglements
  where entreprise_id = v_entreprise_id and commercial_id = p_commercial_id
    and coalesce(mode, 'espece') in ('espece', 'cheque')
    and created_at >= v_debut and created_at < v_fin;
  select coalesce(sum(montant), 0) into v_verse from versements_caisse
  where entreprise_id = v_entreprise_id and commercial_id = p_commercial_id and nature = 'recette'
    and date_versement between p_date_debut and p_date_fin;

  select 'REC-' || to_char(p_date_fin, 'YYYY') || '-' || lpad((count(*) + 1)::text, 5, '0') into v_numero
  from reconciliations_commercial where entreprise_id = v_entreprise_id and to_char(date_fin, 'YYYY') = to_char(p_date_fin, 'YYYY');

  insert into reconciliations_commercial (entreprise_id, numero, commercial_id, date_debut, date_fin, valorisation,
    ventes_comptant, recouvrements, montant_du, montant_verse, cree_par)
  values (v_entreprise_id, v_numero, p_commercial_id, p_date_debut, p_date_fin, v_valorisation,
    v_ventes, v_recouvrements, v_ventes + v_recouvrements, v_verse, auth.uid())
  returning id into v_id;

  -- Stock : pour chaque produit détenu ou mouvementé, stock au début (stock
  -- actuel moins les mouvements survenus depuis), mouvements de la période,
  -- stock théorique à la fin. Le stock compté vaut au départ le théorique,
  -- puis est saisi après comptage.
  insert into reconciliation_lignes (reconciliation_id, produit_id, stock_debut, sorties, ventes, retours, autres, stock_theorique, stock_compte, prix_valorisation)
  select v_id, p.produit_id,
    p.actuel - p.depuis_debut,
    p.sorties, p.ventes, p.retours, p.autres,
    p.actuel - p.depuis_debut + p.periode,
    p.actuel - p.depuis_debut + p.periode,
    case when v_valorisation = 'prix_revient' then coalesce(pc.prix_achat_moyen, pr.prix_vente, 0) else coalesce(pr.prix_vente, 0) end
  from (
    select x.produit_id,
      coalesce((select quantite from stock_commercial sc where sc.commercial_id = p_commercial_id and sc.produit_id = x.produit_id), 0) as actuel,
      coalesce(sum(m.delta) filter (where m.created_at >= v_debut), 0) as depuis_debut,
      coalesce(sum(m.delta) filter (where m.created_at >= v_debut and m.created_at < v_fin), 0) as periode,
      coalesce(sum(m.delta) filter (where m.type = 'sortie' and m.created_at >= v_debut and m.created_at < v_fin), 0) as sorties,
      coalesce(-sum(m.delta) filter (where m.type = 'vente' and m.created_at >= v_debut and m.created_at < v_fin), 0) as ventes,
      coalesce(-sum(m.delta) filter (where m.type = 'retour' and m.created_at >= v_debut and m.created_at < v_fin), 0) as retours,
      coalesce(sum(m.delta) filter (where m.type not in ('sortie', 'vente', 'retour') and m.created_at >= v_debut and m.created_at < v_fin), 0) as autres
    from (
      select produit_id from stock_commercial where commercial_id = p_commercial_id and quantite <> 0
      union
      select produit_id from mouvements_stock_commercial where commercial_id = p_commercial_id and created_at >= v_debut
    ) x
    left join mouvements_stock_commercial m on m.commercial_id = p_commercial_id and m.produit_id = x.produit_id
    group by x.produit_id
  ) p
  join produits pr on pr.id = p.produit_id
  left join produits_couts pc on pc.produit_id = p.produit_id;

  perform recalculer_reconciliation(v_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
create or replace function valider_reconciliation_caisse(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_r record;
  v_e record;
  v_compte text;
  v_nom text;
  v_v record;
begin
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if not peut_valider_caisse() then raise exception 'accès refusé : validation réservée à la caisse'; end if;
  select * into v_r from reconciliations_commercial where id = p_id and entreprise_id = current_entreprise_id() for update;
  if not found or v_r.statut <> 'brouillon' then raise exception 'fiche introuvable ou déjà validée par la caisse'; end if;
  if v_r.commercial_id = auth.uid() then raise exception 'vous ne pouvez pas valider votre propre fiche'; end if;

  perform recalculer_reconciliation(p_id);
  select * into v_r from reconciliations_commercial where id = p_id;
  select * into v_e from entreprises where id = v_r.entreprise_id;
  v_compte := assurer_compte_commercial(v_r.commercial_id);
  select nom into v_nom from profils where id = v_r.commercial_id;

  -- La vente elle-même (411 / 701 / 443) est comptabilisée à la facturation ;
  -- ici on constate seulement que le commercial détient l'argent encaissé.
  perform passer_ecriture(v_r.entreprise_id, v_r.date_fin, 'OD', v_r.numero, v_compte, v_e.compte_clients_numero,
                          'Ventes encaissées par ' || coalesce(v_nom, ''), v_r.ventes_comptant, 'reconciliation', p_id);
  perform passer_ecriture(v_r.entreprise_id, v_r.date_fin, 'OD', v_r.numero, v_compte, v_e.compte_clients_numero,
                          'Recouvrements encaissés par ' || coalesce(v_nom, ''), v_r.recouvrements, 'reconciliation', p_id);
  for v_v in
    select vc.id, vc.numero, vc.montant, vc.date_versement, coalesce(pc.numero_compte, v_e.compte_caisse_defaut_numero) as compte_caisse
    from versements_caisse vc
    join caisses c on c.id = vc.caisse_id
    left join plan_comptable pc on pc.id = c.compte_comptable_id
    where vc.entreprise_id = v_r.entreprise_id and vc.commercial_id = v_r.commercial_id and vc.nature = 'recette'
      and vc.date_versement between v_r.date_debut and v_r.date_fin
  loop
    perform passer_ecriture(v_r.entreprise_id, v_v.date_versement, 'CA', coalesce(v_v.numero, v_r.numero), v_v.compte_caisse, v_compte,
                            'Versement de ' || coalesce(v_nom, ''), v_v.montant, 'reconciliation', p_id);
  end loop;

  update reconciliations_commercial set statut = 'validee_caisse', valide_caisse_par = auth.uid(), valide_caisse_at = now() where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
create or replace function versements_en_cours()
returns table (
  ventes_cash_commerciaux numeric,
  recouvrement_commerciaux numeric,
  ventes_cash_bureau numeric,
  recouvrement_bureau numeric,
  deja_verse numeric,
  reste_a_verser numeric
)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_aujourdhui date := current_date;
  v_ventes_cash_commerciaux numeric;
  v_ventes_cash_bureau numeric;
  v_recouvrement_commerciaux numeric;
  v_recouvrement_bureau numeric;
  v_deja_verse numeric;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé';
  end if;

  select coalesce(sum(encaisse_physique_vente(id)), 0) into v_ventes_cash_commerciaux
  from ventes
  where entreprise_id = v_entreprise_id
    and commercial_id is not null
    and created_at::date = v_aujourdhui;

  select coalesce(sum(encaisse_physique_vente(id)), 0) into v_ventes_cash_bureau
  from ventes
  where entreprise_id = v_entreprise_id
    and commercial_id is null
    and created_at::date = v_aujourdhui;

  select coalesce(sum(montant), 0) into v_recouvrement_commerciaux
  from reglements
  where entreprise_id = v_entreprise_id
    and commercial_id is not null
    and coalesce(mode, 'espece') in ('espece', 'cheque')
    and created_at::date = v_aujourdhui;

  select coalesce(sum(montant), 0) into v_recouvrement_bureau
  from reglements
  where entreprise_id = v_entreprise_id
    and commercial_id is null
    and coalesce(mode, 'espece') in ('espece', 'cheque')
    and created_at::date = v_aujourdhui;

  select coalesce(sum(montant), 0) into v_deja_verse
  from versements_caisse
  where entreprise_id = v_entreprise_id
    and nature = 'recette'
    and date_versement = v_aujourdhui;

  return query select
    v_ventes_cash_commerciaux,
    v_recouvrement_commerciaux,
    v_ventes_cash_bureau,
    v_recouvrement_bureau,
    v_deja_verse,
    (v_ventes_cash_commerciaux + v_recouvrement_commerciaux + v_ventes_cash_bureau + v_recouvrement_bureau) - v_deja_verse;
end;
$$;

notify pgrst, 'reload schema';
