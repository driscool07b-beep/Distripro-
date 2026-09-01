-- Migration : traçabilité stock magasin <-> commerciaux (sorties, retours, anti-fraude)
-- À exécuter dans l'éditeur SQL de Supabase.

-- 0. Colonne pour rattacher explicitement une vente au commercial dont le
-- stock en main a été débité (distinct de created_by, qui est la personne
-- ayant saisi la vente — utile pour la réconciliation sortie/retour/ventes)
alter table ventes add column if not exists commercial_id uuid references profils(id);

-- 1. Stock actuellement en possession de chaque commercial (comme "stocks" mais par personne)
create table if not exists stock_commercial (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  commercial_id  uuid not null references profils(id),
  produit_id     uuid not null references produits(id),
  depot_origine  uuid references depots(id),
  quantite       integer not null default 0,
  updated_at     timestamptz not null default now(),
  unique (commercial_id, produit_id)
);

create index if not exists idx_stock_commercial_entreprise on stock_commercial(entreprise_id);
create index if not exists idx_stock_commercial_commercial on stock_commercial(commercial_id);

alter table stock_commercial enable row level security;

drop policy if exists stock_commercial_select on stock_commercial;
create policy stock_commercial_select on stock_commercial
  for select using (entreprise_id = current_entreprise_id());

-- 2. Fiches de sortie (une par jour/commercial en général)
create table if not exists sorties_stock (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  commercial_id  uuid not null references profils(id),
  depot_id       uuid not null references depots(id),
  statut         text not null default 'ouverte' check (statut in ('ouverte', 'cloturee')),
  date_sortie    date not null default current_date,
  cree_par       uuid references profils(id),
  cloture_par    uuid references profils(id),
  cloture_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_sorties_stock_entreprise on sorties_stock(entreprise_id);
create index if not exists idx_sorties_stock_commercial on sorties_stock(commercial_id);

alter table sorties_stock enable row level security;

drop policy if exists sorties_stock_select on sorties_stock;
create policy sorties_stock_select on sorties_stock
  for select using (entreprise_id = current_entreprise_id());

-- 3. Lignes de la fiche de sortie
create table if not exists sortie_stock_lignes (
  id                 uuid primary key default gen_random_uuid(),
  entreprise_id      uuid not null references entreprises(id) on delete cascade,
  sortie_id          uuid not null references sorties_stock(id) on delete cascade,
  produit_id         uuid not null references produits(id),
  quantite_sortie    integer not null check (quantite_sortie > 0),
  prix_unitaire      numeric(14,2) not null,
  quantite_retournee integer,
  created_at         timestamptz not null default now()
);

create index if not exists idx_sortie_lignes_entreprise on sortie_stock_lignes(entreprise_id);
create index if not exists idx_sortie_lignes_sortie on sortie_stock_lignes(sortie_id);

alter table sortie_stock_lignes enable row level security;

drop policy if exists sortie_lignes_select on sortie_stock_lignes;
create policy sortie_lignes_select on sortie_stock_lignes
  for select using (entreprise_id = current_entreprise_id());

-- 4. RPC : créer une sortie de stock vers un commercial
create or replace function creer_sortie_stock(
  p_commercial_id uuid,
  p_depot_id uuid,
  p_lignes jsonb -- [{produit_id, quantite}]
)
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

-- 5. RPC : enregistrer le retour (clôture la sortie, remet le non-vendu en magasin)
create or replace function retourner_stock(
  p_sortie_id uuid,
  p_lignes_retour jsonb -- [{produit_id, quantite_retournee}]
)
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

-- 6. creer_vente : les ventes d'un commercial débitent désormais son stock en
-- main (issu d'une sortie), pas directement le magasin — évite le double
-- comptage puisque le magasin a déjà été débité à la sortie.
-- Rétrocompatible : si le vendeur n'a pas de stock en main pour un produit
-- (vente de bureau, hors tournée), le comportement d'origine s'applique
-- (débit direct du magasin).
create or replace function creer_vente(
  p_client_id uuid,
  p_lignes jsonb,
  p_mode_paiement text default 'cash',
  p_date_echeance date default null,
  p_commercial_id uuid default null
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
  v_total numeric(14,2) := 0;
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

  -- Vérification de disponibilité (magasin ou stock du commercial selon le cas)
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
      -- suffisamment de stock en main : sera débité plus bas, pas de contrôle magasin ici
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

    v_total := v_total + (v_quantite * v_prix_unitaire);
  end loop;

  insert into ventes (entreprise_id, client_id, total, created_by, mode_paiement, statut, montant_regle, date_echeance, commercial_id)
  values (
    v_entreprise_id, p_client_id, v_total, auth.uid(), p_mode_paiement, 'validee',
    case when p_mode_paiement = 'cash' then v_total else 0 end,
    case when p_mode_paiement = 'credit' then p_date_echeance else null end,
    p_commercial_id
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
      -- Débit du stock en main du commercial (le magasin a déjà été débité à la sortie)
      update stock_commercial
      set quantite = quantite - v_quantite, updated_at = now()
      where commercial_id = p_commercial_id and produit_id = v_produit_id and entreprise_id = v_entreprise_id;
    else
      -- Vente hors tournée (bureau) ou stock en main insuffisant : débit direct du magasin
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
