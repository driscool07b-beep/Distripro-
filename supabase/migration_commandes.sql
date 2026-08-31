-- Migration : module Commandes (suivi des commandes reçues par téléphone)
-- À exécuter dans l'éditeur SQL de Supabase.

-- 0. creer_vente doit aussi accepter le rôle comptable (les commandes peuvent
-- être finalisées/livrées par un comptable, qui déclenche alors la vente)
create or replace function creer_vente(
  p_client_id uuid,
  p_lignes jsonb,
  p_mode_paiement text default 'cash',
  p_date_echeance date default null
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

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_quantite := (v_ligne->>'quantite')::integer;
    v_prix_unitaire := (v_ligne->>'prix_unitaire')::numeric;

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

    v_total := v_total + (v_quantite * v_prix_unitaire);
  end loop;

  insert into ventes (entreprise_id, client_id, total, created_by, mode_paiement, statut, montant_regle, date_echeance)
  values (
    v_entreprise_id, p_client_id, v_total, auth.uid(), p_mode_paiement, 'validee',
    case when p_mode_paiement = 'cash' then v_total else 0 end,
    case when p_mode_paiement = 'credit' then p_date_echeance else null end
  )
  returning id into v_vente_id;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_quantite := (v_ligne->>'quantite')::integer;
    v_prix_unitaire := (v_ligne->>'prix_unitaire')::numeric;

    select depot_id into v_depot_id
    from stocks
    where produit_id = v_produit_id and entreprise_id = v_entreprise_id;

    insert into ventes_lignes (vente_id, produit_id, quantite, prix_unitaire, sous_total)
    values (v_vente_id, v_produit_id, v_quantite, v_prix_unitaire, v_quantite * v_prix_unitaire);

    update stocks
    set quantite = quantite - v_quantite, updated_at = now()
    where produit_id = v_produit_id and entreprise_id = v_entreprise_id;

    insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
    values (v_entreprise_id, v_produit_id, v_depot_id, 'sortie', v_quantite, 'Vente ' || v_vente_id, auth.uid());
  end loop;

  return v_vente_id;
end;
$$;

-- 1. Table des commandes
create table if not exists commandes (
  id                      uuid primary key default gen_random_uuid(),
  entreprise_id           uuid not null references entreprises(id) on delete cascade,
  client_id               uuid not null references clients(id),
  commercial_id           uuid references profils(id),
  cree_par                uuid references profils(id),
  statut                  text not null default 'recue'
                          check (statut in ('recue', 'confirmee', 'en_preparation', 'livree', 'annulee')),
  mode_paiement           text not null default 'cash' check (mode_paiement in ('cash', 'credit')),
  date_livraison_souhaitee date,
  notes                   text,
  vente_id                uuid references ventes(id),
  created_at              timestamptz not null default now()
);

create index if not exists idx_commandes_entreprise on commandes(entreprise_id);
create index if not exists idx_commandes_client on commandes(client_id);
create index if not exists idx_commandes_statut on commandes(statut);

alter table commandes enable row level security;

drop policy if exists commandes_select on commandes;
create policy commandes_select on commandes
  for select using (entreprise_id = current_entreprise_id());

-- 2. Lignes de commande (quantité commandée vs livrée, gère les ruptures partielles)
create table if not exists commande_lignes (
  id                  uuid primary key default gen_random_uuid(),
  entreprise_id       uuid not null references entreprises(id) on delete cascade,
  commande_id         uuid not null references commandes(id) on delete cascade,
  produit_id          uuid not null references produits(id),
  quantite_commandee  integer not null check (quantite_commandee > 0),
  quantite_livree     integer,
  prix_unitaire       numeric(14,2) not null,
  created_at          timestamptz not null default now()
);

create index if not exists idx_commande_lignes_entreprise on commande_lignes(entreprise_id);
create index if not exists idx_commande_lignes_commande on commande_lignes(commande_id);

alter table commande_lignes enable row level security;

drop policy if exists commande_lignes_select on commande_lignes;
create policy commande_lignes_select on commande_lignes
  for select using (entreprise_id = current_entreprise_id());

-- 3. Historique des changements de statut
create table if not exists commande_historique (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  commande_id    uuid not null references commandes(id) on delete cascade,
  ancien_statut  text,
  nouveau_statut text not null,
  note           text,
  effectue_par   uuid references profils(id),
  created_at     timestamptz not null default now()
);

create index if not exists idx_commande_historique_commande on commande_historique(commande_id);

alter table commande_historique enable row level security;

drop policy if exists commande_historique_select on commande_historique;
create policy commande_historique_select on commande_historique
  for select using (entreprise_id = current_entreprise_id());

-- 4. RPC : créer une commande
create or replace function creer_commande(
  p_client_id uuid,
  p_lignes jsonb,
  p_commercial_id uuid default null,
  p_mode_paiement text default 'cash',
  p_date_livraison_souhaitee date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_commande_id uuid;
  v_ligne jsonb;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
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

  insert into commandes (entreprise_id, client_id, commercial_id, cree_par, mode_paiement, date_livraison_souhaitee, notes)
  values (v_entreprise_id, p_client_id, p_commercial_id, auth.uid(), p_mode_paiement, p_date_livraison_souhaitee, p_notes)
  returning id into v_commande_id;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    insert into commande_lignes (entreprise_id, commande_id, produit_id, quantite_commandee, prix_unitaire)
    values (
      v_entreprise_id,
      v_commande_id,
      (v_ligne->>'produit_id')::uuid,
      (v_ligne->>'quantite')::integer,
      (v_ligne->>'prix_unitaire')::numeric
    );
  end loop;

  insert into commande_historique (entreprise_id, commande_id, ancien_statut, nouveau_statut, effectue_par)
  values (v_entreprise_id, v_commande_id, null, 'recue', auth.uid());

  return v_commande_id;
end;
$$;

-- 5. RPC : faire avancer le statut (hors livraison, qui a sa propre RPC)
create or replace function changer_statut_commande(
  p_commande_id uuid,
  p_nouveau_statut text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_statut_actuel text;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
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

  update commandes set statut = p_nouveau_statut where id = p_commande_id;

  insert into commande_historique (entreprise_id, commande_id, ancien_statut, nouveau_statut, note, effectue_par)
  values (v_entreprise_id, p_commande_id, v_statut_actuel, p_nouveau_statut, p_note, auth.uid());
end;
$$;

-- 6. RPC : livrer une commande (quantités livrées possiblement < commandées),
-- déclenche la vente réelle (déduction de stock) via creer_vente
create or replace function livrer_commande(
  p_commande_id uuid,
  p_lignes_livrees jsonb, -- [{produit_id, quantite_livree}]
  p_mode_paiement text default null -- si null, reprend le mode de paiement de la commande
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_client_id uuid;
  v_statut_actuel text;
  v_mode_paiement text;
  v_ligne jsonb;
  v_produit_id uuid;
  v_qte_livree integer;
  v_prix_unitaire numeric(14,2);
  v_lignes_vente jsonb := '[]'::jsonb;
  v_vente_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role not in ('admin', 'manager', 'commercial', 'comptable') then
    raise exception 'accès refusé';
  end if;

  select client_id, statut, mode_paiement into v_client_id, v_statut_actuel, v_mode_paiement
  from commandes
  where id = p_commande_id and entreprise_id = v_entreprise_id
  for update;

  if v_client_id is null then
    raise exception 'commande introuvable pour cette entreprise';
  end if;
  if v_statut_actuel in ('livree', 'annulee') then
    raise exception 'cette commande est déjà % et ne peut plus être livrée', v_statut_actuel;
  end if;

  v_mode_paiement := coalesce(p_mode_paiement, v_mode_paiement);

  for v_ligne in select * from jsonb_array_elements(p_lignes_livrees)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_qte_livree := (v_ligne->>'quantite_livree')::integer;

    update commande_lignes
    set quantite_livree = v_qte_livree
    where commande_id = p_commande_id and produit_id = v_produit_id;

    if v_qte_livree > 0 then
      select prix_unitaire into v_prix_unitaire
      from commande_lignes
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

  v_vente_id := creer_vente(v_client_id, v_lignes_vente, v_mode_paiement, null);

  update commandes
  set statut = 'livree', vente_id = v_vente_id, mode_paiement = v_mode_paiement
  where id = p_commande_id;

  insert into commande_historique (entreprise_id, commande_id, ancien_statut, nouveau_statut, note, effectue_par)
  values (v_entreprise_id, p_commande_id, v_statut_actuel, 'livree', 'Convertie en vente ' || v_vente_id, auth.uid());

  return v_vente_id;
end;
$$;
