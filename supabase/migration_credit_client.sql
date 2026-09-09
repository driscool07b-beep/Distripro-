-- Migration : quand une vente déjà encaissée (totalement ou en partie)
-- est annulée par avoir, l'argent déjà payé par le client ne doit pas
-- disparaître — il doit devenir un crédit en sa faveur (solde_credit,
-- colonne déjà présente sur clients mais jamais utilisée jusqu'ici),
-- utilisable sur une prochaine vente ou remboursable en espèces.
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Table d'historique des mouvements de crédit client (traçabilité :
--    d'où vient chaque crédit, comment il a été utilisé ou remboursé).
-- ---------------------------------------------------------------------
create table if not exists mouvements_credit_client (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  montant numeric(14,2) not null,
  type_mouvement text not null check (type_mouvement in ('credit_annulation', 'utilisation_vente', 'remboursement')),
  vente_id uuid references ventes(id),
  motif text,
  effectue_par uuid references profils(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_mouvements_credit_client_client on mouvements_credit_client(client_id);

alter table mouvements_credit_client enable row level security;

drop policy if exists mouvements_credit_client_select on mouvements_credit_client;
create policy mouvements_credit_client_select on mouvements_credit_client
  for select using (entreprise_id = current_entreprise_id());

-- ---------------------------------------------------------------------
-- 2. creer_avoir : crédite le client du montant déjà encaissé sur la
--    vente annulée. Signature inchangée (p_vente_id, p_motif) : CREATE
--    OR REPLACE la remplace en place.
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

-- ---------------------------------------------------------------------
-- 3. creer_vente : accepte désormais p_credit_utilise, pour appliquer
--    le crédit disponible du client sur une nouvelle vente (réduit le
--    montant à payer, exactement comme un mode de paiement supplémentaire).
--    Nouveau paramètre => nouvelle signature => on supprime l'ancienne
--    version d'abord, sinon CREATE OR REPLACE créerait un doublon
--    (même piège que celui déjà rencontré et corrigé plus tôt).
-- ---------------------------------------------------------------------
drop function if exists creer_vente(uuid, jsonb, text, date, uuid, numeric, text, numeric, text, uuid);

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
  v_vente_id uuid;
  v_sous_total numeric(14,2) := 0;
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

  insert into ventes (entreprise_id, client_id, total, created_by, mode_paiement, statut, montant_regle, date_echeance, commercial_id, mode_reglement, remise_montant, notes, depot_id)
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
    case when v_besoin_depot then v_depot_id else null end
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
-- 4. Remboursement en espèces (ou autre mode) du crédit client, quand il
--    ne sera pas utilisé sur une prochaine vente.
-- ---------------------------------------------------------------------
create or replace function rembourser_credit_client(p_client_id uuid, p_montant numeric, p_mode text default 'espece', p_motif text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_solde numeric(14,2);
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé : votre rôle ne permet pas de rembourser un crédit client';
  end if;
  if p_montant is null or p_montant <= 0 then
    raise exception 'montant invalide';
  end if;

  select coalesce(solde_credit, 0) into v_solde from clients where id = p_client_id and entreprise_id = v_entreprise_id for update;
  if not found then
    raise exception 'client introuvable pour cette entreprise';
  end if;
  if p_montant > v_solde then
    raise exception 'le montant dépasse le crédit disponible du client (%)', v_solde;
  end if;

  update clients set solde_credit = solde_credit - p_montant where id = p_client_id and entreprise_id = v_entreprise_id;

  insert into mouvements_credit_client (entreprise_id, client_id, montant, type_mouvement, motif, effectue_par)
  values (v_entreprise_id, p_client_id, p_montant, 'remboursement', coalesce(p_motif, 'Remboursement (' || p_mode || ')'), auth.uid());
end;
$$;
