-- Migration : gestion des créances clients (échéances, paiements, historique)
-- À exécuter dans l'éditeur SQL de Supabase.

-- 1. Date d'échéance sur les ventes à crédit
alter table ventes add column if not exists date_echeance date;

-- 2. creer_vente accepte désormais une échéance optionnelle (rétrocompatible :
-- les appels existants sans ce paramètre continuent de fonctionner)
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

  if v_role not in ('admin', 'manager', 'commercial') then
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

-- 3. Historique des paiements reçus sur les ventes à crédit
create table if not exists paiements_credit (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  vente_id       uuid not null references ventes(id) on delete cascade,
  montant        numeric(14,2) not null check (montant > 0),
  mode_paiement  text default 'cash',
  note           text,
  effectue_par   uuid references profils(id),
  created_at     timestamptz not null default now()
);

create index if not exists idx_paiements_credit_entreprise on paiements_credit(entreprise_id);
create index if not exists idx_paiements_credit_vente on paiements_credit(vente_id);

alter table paiements_credit enable row level security;

drop policy if exists paiements_credit_select on paiements_credit;
create policy paiements_credit_select on paiements_credit
  for select using (entreprise_id = current_entreprise_id());

-- 4. RPC pour enregistrer un paiement (met à jour montant_regle et statut atomiquement)
create or replace function enregistrer_paiement(
  p_vente_id uuid,
  p_montant numeric,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_total numeric(14,2);
  v_regle_actuel numeric(14,2);
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if p_montant <= 0 then
    raise exception 'le montant doit être positif';
  end if;

  select total, montant_regle into v_total, v_regle_actuel
  from ventes
  where id = p_vente_id and entreprise_id = v_entreprise_id
  for update;

  if v_total is null then
    raise exception 'vente introuvable pour cette entreprise';
  end if;
  if v_regle_actuel + p_montant > v_total then
    raise exception 'le montant dépasse le solde restant dû';
  end if;

  insert into paiements_credit (entreprise_id, vente_id, montant, note, effectue_par)
  values (v_entreprise_id, p_vente_id, p_montant, p_note, auth.uid());

  update ventes
  set montant_regle = montant_regle + p_montant,
      statut = case when montant_regle + p_montant >= total then 'validee' else statut end
  where id = p_vente_id;
end;
$$;
