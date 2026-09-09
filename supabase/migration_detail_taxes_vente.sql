-- Migration : le reçu doit afficher le nom et le taux de chaque taxe
-- appliquée (obligation légale), pas juste un total "Autres taxes"
-- global. Comme les autres taxes (AIRSI...) sont calculées sur un
-- agrégat (HT ou TTC) et non ligne par ligne, il faut les enregistrer
-- explicitement au moment de la vente pour pouvoir les réafficher
-- fidèlement plus tard (les taux peuvent changer avec le temps).
--
-- La TVA, elle, n'a pas besoin d'une table dédiée : ventes_lignes
-- stocke déjà taux_tva/montant_tva par ligne (migration précédente),
-- on peut les regrouper par taux au moment d'afficher le reçu.
--
-- À exécuter dans l'éditeur SQL de Supabase (après
-- migration_configuration_tva.sql).

create table if not exists ventes_taxes (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  vente_id uuid not null references ventes(id) on delete cascade,
  nom text not null,
  taux numeric(5,2) not null,
  montant numeric(14,2) not null,
  base_calcul text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ventes_taxes_vente on ventes_taxes(vente_id);

alter table ventes_taxes enable row level security;

drop policy if exists ventes_taxes_select on ventes_taxes;
create policy ventes_taxes_select on ventes_taxes
  for select using (entreprise_id = current_entreprise_id());

-- creer_vente : signature inchangée, seule la boucle des autres taxes
-- change pour mémoriser le détail (nom, taux, montant) et l'enregistrer
-- dans ventes_taxes une fois la vente créée.
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
  v_detail_taxes jsonb := '[]'::jsonb;
  v_detail_taxe jsonb;
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
