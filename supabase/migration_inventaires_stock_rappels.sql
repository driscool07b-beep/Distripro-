-- Migration : inventaire de stock (comptage physique des produits,
-- avec ajustement automatique du stock théorique vers le compté) +
-- paramétrage de la fréquence de rappel des inventaires — stock ET
-- caisse.
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Paramétrage des fréquences de rappel.
-- ---------------------------------------------------------------------
alter table entreprises add column if not exists frequence_inventaire_stock text
  check (frequence_inventaire_stock in ('hebdomadaire', 'mensuel', 'trimestriel'));
alter table entreprises add column if not exists frequence_inventaire_caisse text
  check (frequence_inventaire_caisse in ('hebdomadaire', 'mensuel', 'trimestriel'));
-- NULL = rappel désactivé pour ce type d'inventaire.

create or replace function modifier_parametrage_inventaires(p_frequence_stock text default null, p_frequence_caisse text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if current_role_utilisateur() <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut modifier ce réglage';
  end if;
  if p_frequence_stock is not null and p_frequence_stock not in ('hebdomadaire', 'mensuel', 'trimestriel') then
    raise exception 'fréquence stock invalide';
  end if;
  if p_frequence_caisse is not null and p_frequence_caisse not in ('hebdomadaire', 'mensuel', 'trimestriel') then
    raise exception 'fréquence caisse invalide';
  end if;

  update entreprises
  set frequence_inventaire_stock = p_frequence_stock, frequence_inventaire_caisse = p_frequence_caisse
  where id = current_entreprise_id();
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Inventaire de stock — comptage physique des produits d'un dépôt,
--    avec ajustement automatique vers la quantité réellement comptée.
-- ---------------------------------------------------------------------
create table if not exists inventaires_stock (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  numero text,
  depot_id uuid references depots(id),
  controle_par uuid not null references profils(id),
  notes text,
  created_at timestamptz not null default now()
);

create or replace function generer_numero_inventaire_stock()
returns trigger language plpgsql as $$
declare v_compteur int;
begin
  select count(*) + 1 into v_compteur from inventaires_stock
  where entreprise_id = new.entreprise_id and extract(year from created_at) = extract(year from now());
  new.numero := 'INVS-' || extract(year from now()) || '-' || lpad(v_compteur::text, 5, '0');
  return new;
end;
$$;
drop trigger if exists trg_numero_inventaire_stock on inventaires_stock;
create trigger trg_numero_inventaire_stock before insert on inventaires_stock
for each row execute function generer_numero_inventaire_stock();

alter table inventaires_stock enable row level security;
drop policy if exists inventaires_stock_select on inventaires_stock;
create policy inventaires_stock_select on inventaires_stock
  for select using (entreprise_id = current_entreprise_id());

create table if not exists inventaire_stock_lignes (
  id uuid primary key default gen_random_uuid(),
  inventaire_id uuid not null references inventaires_stock(id) on delete cascade,
  produit_id uuid not null references produits(id),
  quantite_theorique numeric not null,
  quantite_comptee numeric not null,
  ecart numeric generated always as (quantite_comptee - quantite_theorique) stored
);

alter table inventaire_stock_lignes enable row level security;
drop policy if exists inventaire_stock_lignes_select on inventaire_stock_lignes;
create policy inventaire_stock_lignes_select on inventaire_stock_lignes
  for select using (
    inventaire_id in (select id from inventaires_stock where entreprise_id = current_entreprise_id())
  );

create or replace function creer_inventaire_stock(p_depot_id uuid, p_lignes jsonb, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_inventaire_id uuid;
  v_ligne jsonb;
  v_produit_id uuid;
  v_quantite_comptee numeric;
  v_quantite_theorique numeric;
  v_ecart numeric;
  v_numero text;
begin
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de réaliser un inventaire de stock';
  end if;
  perform 1 from depots where id = p_depot_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'dépôt introuvable'; end if;
  if p_lignes is null or jsonb_array_length(p_lignes) = 0 then
    raise exception 'aucune ligne à enregistrer';
  end if;

  insert into inventaires_stock (entreprise_id, depot_id, controle_par, notes)
  values (v_entreprise_id, p_depot_id, auth.uid(), nullif(trim(p_notes), ''))
  returning id, numero into v_inventaire_id, v_numero;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_quantite_comptee := (v_ligne->>'quantite_comptee')::numeric;

    select quantite into v_quantite_theorique from stocks
    where produit_id = v_produit_id and depot_id = p_depot_id;
    v_quantite_theorique := coalesce(v_quantite_theorique, 0);

    insert into inventaire_stock_lignes (inventaire_id, produit_id, quantite_theorique, quantite_comptee)
    values (v_inventaire_id, v_produit_id, v_quantite_theorique, v_quantite_comptee);

    v_ecart := v_quantite_comptee - v_quantite_theorique;
    if v_ecart <> 0 then
      perform ajuster_stock(
        v_produit_id,
        case when v_ecart > 0 then 'entree' else 'sortie' end,
        abs(v_ecart)::integer,
        'Ajustement suite à inventaire ' || v_numero,
        p_depot_id
      );
    end if;
  end loop;

  return v_inventaire_id;
end;
$$;
