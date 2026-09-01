-- Migration : module Commandes reconstruit sur la structure réelle existante
-- (commandes / lignes_commande, issues d'une première application jamais
-- mise en service, mais dont la structure est conservée car plus aboutie).
-- À exécuter dans l'éditeur SQL de Supabase.

-- 1. Colonnes manquantes pour couvrir les besoins exprimés (livraison
-- partielle, notes, date souhaitée, lien vers la vente générée à la livraison)
alter table lignes_commande add column if not exists quantite_livree integer;
alter table commandes add column if not exists vente_id uuid references ventes(id);
alter table commandes add column if not exists date_livraison_souhaitee date;
alter table commandes add column if not exists notes text;

-- 2. Historique des changements de statut (n'existait pas dans la v1)
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
  for select using (entreprise_id = mon_entreprise_id());

-- 3. RPC : créer une commande (statut initial 'brouillon', comme le défaut
-- déjà en place sur la table ; TVA non gérée pour l'instant, montant_tva = 0)
create or replace function creer_commande(
  p_client_id uuid,
  p_lignes jsonb,
  p_commercial_id uuid default null,
  p_depot_id uuid default null,
  p_mode_paiement text default 'cash',
  p_montant_paye numeric default null,
  p_date_livraison_souhaitee date default null,
  p_notes text default null,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := mon_entreprise_id();
  v_role text := current_role_utilisateur();
  v_commande_id uuid;
  v_ligne jsonb;
  v_montant_ht numeric(14,2) := 0;
  v_montant_paye numeric(14,2);
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

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_montant_ht := v_montant_ht + ((v_ligne->>'quantite')::integer * (v_ligne->>'prix_unitaire')::numeric);
  end loop;

  v_montant_paye := coalesce(least(p_montant_paye, v_montant_ht), 0);
  if v_montant_paye < 0 then
    v_montant_paye := 0;
  end if;

  insert into commandes (
    entreprise_id, client_id, commercial_id, depot_id, statut,
    montant_ht, montant_tva, montant_ttc, mode_paiement, montant_paye,
    date_livraison_souhaitee, notes, latitude_saisie, longitude_saisie
  )
  values (
    v_entreprise_id, p_client_id, p_commercial_id, p_depot_id, 'brouillon',
    v_montant_ht, 0, v_montant_ht, p_mode_paiement, v_montant_paye,
    p_date_livraison_souhaitee, p_notes, p_latitude, p_longitude
  )
  returning id into v_commande_id;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    insert into lignes_commande (commande_id, produit_id, quantite, prix_unitaire, montant_ligne)
    values (
      v_commande_id,
      (v_ligne->>'produit_id')::uuid,
      (v_ligne->>'quantite')::integer,
      (v_ligne->>'prix_unitaire')::numeric,
      (v_ligne->>'quantite')::integer * (v_ligne->>'prix_unitaire')::numeric
    );
  end loop;

  insert into commande_historique (entreprise_id, commande_id, ancien_statut, nouveau_statut, effectue_par)
  values (v_entreprise_id, v_commande_id, null, 'brouillon', auth.uid());

  return v_commande_id;
end;
$$;

-- 4. RPC : faire avancer le statut (hors livraison, qui a sa propre RPC)
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
  v_entreprise_id uuid := mon_entreprise_id();
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

  update commandes set statut = p_nouveau_statut, updated_at = now() where id = p_commande_id;

  insert into commande_historique (entreprise_id, commande_id, ancien_statut, nouveau_statut, note, effectue_par)
  values (v_entreprise_id, p_commande_id, v_statut_actuel, p_nouveau_statut, p_note, auth.uid());
end;
$$;

-- 5. RPC : livrer une commande (quantités livrées possiblement < commandées),
-- déclenche la vraie vente (déduction de stock) via creer_vente. L'avance
-- éventuellement payée à la commande (montant_paye) est reportée comme
-- montant déjà réglé sur la vente générée.
create or replace function livrer_commande(
  p_commande_id uuid,
  p_lignes_livrees jsonb,
  p_montant_supplementaire_paye numeric default 0,
  p_mode_paiement text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := mon_entreprise_id();
  v_role text := current_role_utilisateur();
  v_client_id uuid;
  v_commercial_id uuid;
  v_statut_actuel text;
  v_mode_paiement text;
  v_montant_paye_commande numeric(14,2);
  v_ligne jsonb;
  v_produit_id uuid;
  v_qte_livree integer;
  v_prix_unitaire numeric(14,2);
  v_lignes_vente jsonb := '[]'::jsonb;
  v_montant_paye_total numeric(14,2);
  v_vente_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role not in ('admin', 'manager', 'commercial', 'comptable') then
    raise exception 'accès refusé';
  end if;

  select client_id, commercial_id, statut, mode_paiement, montant_paye
  into v_client_id, v_commercial_id, v_statut_actuel, v_mode_paiement, v_montant_paye_commande
  from commandes
  where id = p_commande_id and entreprise_id = v_entreprise_id
  for update;

  if v_client_id is null then
    raise exception 'commande introuvable pour cette entreprise';
  end if;
  if v_statut_actuel in ('livree', 'annulee') then
    raise exception 'cette commande est déjà % et ne peut plus être livrée', v_statut_actuel;
  end if;

  v_mode_paiement := coalesce(p_mode_paiement, v_mode_paiement, 'cash');

  for v_ligne in select * from jsonb_array_elements(p_lignes_livrees)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_qte_livree := (v_ligne->>'quantite_livree')::integer;

    update lignes_commande
    set quantite_livree = v_qte_livree
    where commande_id = p_commande_id and produit_id = v_produit_id;

    if v_qte_livree > 0 then
      select prix_unitaire into v_prix_unitaire
      from lignes_commande
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

  v_montant_paye_total := coalesce(v_montant_paye_commande, 0) + coalesce(p_montant_supplementaire_paye, 0);

  v_vente_id := creer_vente(v_client_id, v_lignes_vente, v_mode_paiement, null, v_commercial_id, v_montant_paye_total);

  update commandes
  set statut = 'livree', vente_id = v_vente_id, mode_paiement = v_mode_paiement, updated_at = now()
  where id = p_commande_id;

  insert into commande_historique (entreprise_id, commande_id, ancien_statut, nouveau_statut, note, effectue_par)
  values (v_entreprise_id, p_commande_id, v_statut_actuel, 'livree', 'Convertie en vente ' || v_vente_id, auth.uid());

  return v_vente_id;
end;
$$;
