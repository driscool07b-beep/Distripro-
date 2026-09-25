-- Migration : stock enrichi (lot 2).
-- 1. État de chaque lot (bon / endommagé), modifiable avec motif tracé.
-- 2. Prix d'achat (prix de revient) FACULTATIF :
--    - saisi à l'entrée en stock (prix unitaire du lot), ou fixé à la main ;
--    - le prix de revient du produit est tenu au coût moyen unitaire pondéré
--      (CMUP, admis en SYSCOHADA) ;
--    - stocké dans des tables séparées, INVISIBLES pour les commerciaux
--      (un commercial ne doit pas voir les prix d'achat ni les marges).
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------------
-- 1. État des lots
-- ---------------------------------------------------------------------------
alter table lots add column if not exists etat text not null default 'bon';
alter table lots drop constraint if exists lots_etat_check;
alter table lots add constraint lots_etat_check check (etat in ('bon', 'endommage'));
alter table lots add column if not exists etat_motif text;
alter table lots add column if not exists etat_modifie_par uuid references profils(id);
alter table lots add column if not exists etat_modifie_at timestamptz;

-- Les ventes et sorties consomment d'abord les lots en bon état.
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
    order by (etat = 'endommage'), date_peremption nulls last, created_at
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

create or replace function changer_etat_lot(p_lot_id uuid, p_etat text, p_motif text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_lot record;
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé';
  end if;
  if p_etat not in ('bon', 'endommage') then raise exception 'état invalide'; end if;
  if coalesce(length(trim(p_motif)), 0) < 3 then raise exception 'le motif est obligatoire'; end if;

  select * into v_lot from lots where id = p_lot_id and entreprise_id = v_entreprise_id for update;
  if not found then raise exception 'lot introuvable'; end if;
  if not mon_depot_autorise(v_lot.depot_id) then raise exception 'accès refusé : ce dépôt ne vous est pas attribué'; end if;

  update lots
  set etat = p_etat, etat_motif = trim(p_motif), etat_modifie_par = auth.uid(), etat_modifie_at = now()
  where id = p_lot_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Prix d'achat / prix de revient (accès restreint)
-- ---------------------------------------------------------------------------
create table if not exists produits_couts (
  produit_id uuid primary key references produits(id) on delete cascade,
  entreprise_id uuid not null references entreprises(id),
  prix_achat_moyen numeric(14, 2) not null check (prix_achat_moyen >= 0),
  maj_par uuid references profils(id),
  maj_at timestamptz not null default now()
);

create table if not exists historique_couts_achat (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id),
  produit_id uuid not null references produits(id) on delete cascade,
  lot_id uuid references lots(id),
  depot_id uuid references depots(id),
  quantite numeric,
  prix_unitaire numeric(14, 2) not null check (prix_unitaire >= 0),
  prix_moyen_apres numeric(14, 2) not null,
  source text not null check (source in ('entree', 'manuel')),
  created_by uuid references profils(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_historique_couts_produit on historique_couts_achat (produit_id, created_at);

alter table produits_couts enable row level security;
alter table historique_couts_achat enable row level security;

drop policy if exists produits_couts_select on produits_couts;
create policy produits_couts_select on produits_couts
  for select using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager', 'comptable', 'gestionnaire_stock')
  );
drop policy if exists historique_couts_select on historique_couts_achat;
create policy historique_couts_select on historique_couts_achat
  for select using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager', 'comptable', 'gestionnaire_stock')
  );
-- Aucune écriture directe : uniquement via les fonctions ci-dessous.

-- Fixer (ou corriger) le prix de revient d'un produit à la main.
create or replace function definir_prix_achat(p_produit_id uuid, p_prix numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'manager') then
    raise exception 'seul un administrateur ou un manager peut fixer le prix d''achat';
  end if;
  if p_prix is null or p_prix < 0 then raise exception 'prix invalide'; end if;
  perform 1 from produits where id = p_produit_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'produit introuvable'; end if;

  insert into produits_couts (produit_id, entreprise_id, prix_achat_moyen, maj_par, maj_at)
  values (p_produit_id, v_entreprise_id, p_prix, auth.uid(), now())
  on conflict (produit_id) do update set prix_achat_moyen = excluded.prix_achat_moyen, maj_par = auth.uid(), maj_at = now();

  insert into historique_couts_achat (entreprise_id, produit_id, prix_unitaire, prix_moyen_apres, source, created_by)
  values (v_entreprise_id, p_produit_id, p_prix, p_prix, 'manuel', auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Ajustement de stock : + état de la marchandise reçue et prix d'achat
--    (la signature change : on remplace l'ancienne version).
-- ---------------------------------------------------------------------------
drop function if exists ajuster_stock_manuel(uuid, text, integer, text, uuid, text, date, text, text, bigint, text);

create or replace function ajuster_stock_manuel(
  p_produit_id uuid,
  p_type text,
  p_quantite integer,
  p_motif text,
  p_depot_id uuid default null,
  p_numero_lot text default null,
  p_date_peremption date default null,
  p_justificatif_chemin text default null,
  p_justificatif_nom text default null,
  p_justificatif_taille bigint default null,
  p_justificatif_type text default null,
  p_etat text default 'bon',
  p_prix_achat numeric default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_obligatoire boolean;
  v_mouvement_id uuid;
  v_numero_lot text := nullif(trim(coalesce(p_numero_lot, '')), '');
  v_lot_id uuid;
  v_depot_id uuid;
  v_stock_total numeric;
  v_ancien_prix numeric;
  v_nouveau_prix numeric;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if p_quantite is null or p_quantite <= 0 then
    raise exception 'la quantité doit être supérieure à zéro';
  end if;
  if coalesce(length(trim(p_motif)), 0) < 3 then
    raise exception 'le motif de l''ajustement est obligatoire';
  end if;
  if p_etat not in ('bon', 'endommage') then
    raise exception 'état de la marchandise invalide';
  end if;
  if p_prix_achat is not null and p_prix_achat < 0 then
    raise exception 'prix d''achat invalide';
  end if;

  select coalesce(justificatif_stock_obligatoire, true) into v_obligatoire
  from entreprises where id = v_entreprise_id;

  if p_justificatif_chemin is null then
    if v_obligatoire then
      raise exception 'justificatif obligatoire : joignez une photo ou un PDF avant de valider';
    end if;
  else
    if split_part(p_justificatif_chemin, '/', 1) <> v_entreprise_id::text then
      raise exception 'chemin de justificatif invalide';
    end if;
    perform 1 from storage.objects
    where bucket_id = 'justificatifs-stock' and name = p_justificatif_chemin;
    if not found then
      raise exception 'justificatif introuvable : le fichier n''a pas été reçu, réessayez';
    end if;
    if exists (select 1 from justificatifs_mouvements where chemin = p_justificatif_chemin) then
      raise exception 'ce fichier est déjà rattaché à un autre mouvement';
    end if;
  end if;

  -- Marchandise reçue endommagée sans numéro de lot : on crée un lot dédié,
  -- pour qu'elle reste identifiable et ne soit pas vendue en priorité.
  if p_type = 'entree' and p_etat = 'endommage' and v_numero_lot is null then
    v_numero_lot := 'ENDOMMAGE-' || to_char(now() at time zone 'Africa/Abidjan', 'YYYYMMDD-HH24MISS');
  end if;

  perform ajuster_stock(p_produit_id, p_type, p_quantite, trim(p_motif), p_depot_id,
                        case when p_type = 'entree' then v_numero_lot else null end, p_date_peremption);

  select id, depot_id into v_mouvement_id, v_depot_id
  from mouvements_stock
  where entreprise_id = v_entreprise_id and produit_id = p_produit_id and effectue_par = auth.uid()
  order by created_at desc
  limit 1;

  if p_justificatif_chemin is not null then
    insert into justificatifs_mouvements (entreprise_id, mouvement_id, chemin, nom_fichier, taille_octets, type_mime, ajoute_par)
    values (v_entreprise_id, v_mouvement_id, p_justificatif_chemin, p_justificatif_nom, p_justificatif_taille, p_justificatif_type, auth.uid());
    update mouvements_stock set reference_doc = p_justificatif_chemin where id = v_mouvement_id;
  end if;

  if p_type = 'entree' and v_numero_lot is not null then
    select id into v_lot_id from lots
    where entreprise_id = v_entreprise_id and produit_id = p_produit_id and depot_id = v_depot_id and numero_lot = v_numero_lot;
    if p_etat = 'endommage' and v_lot_id is not null then
      update lots set etat = 'endommage', etat_motif = 'reçu endommagé', etat_modifie_par = auth.uid(), etat_modifie_at = now()
      where id = v_lot_id;
    end if;
  end if;

  -- Prix de revient au coût moyen unitaire pondéré (CMUP).
  if p_type = 'entree' and p_prix_achat is not null then
    select coalesce(sum(quantite), 0) into v_stock_total from stocks
    where entreprise_id = v_entreprise_id and produit_id = p_produit_id;
    select prix_achat_moyen into v_ancien_prix from produits_couts where produit_id = p_produit_id;
    if v_ancien_prix is null or v_stock_total - p_quantite <= 0 then
      v_nouveau_prix := p_prix_achat;
    else
      v_nouveau_prix := round(((v_stock_total - p_quantite) * v_ancien_prix + p_quantite * p_prix_achat) / v_stock_total, 2);
    end if;

    insert into produits_couts (produit_id, entreprise_id, prix_achat_moyen, maj_par, maj_at)
    values (p_produit_id, v_entreprise_id, v_nouveau_prix, auth.uid(), now())
    on conflict (produit_id) do update set prix_achat_moyen = excluded.prix_achat_moyen, maj_par = auth.uid(), maj_at = now();

    insert into historique_couts_achat (entreprise_id, produit_id, lot_id, depot_id, quantite, prix_unitaire, prix_moyen_apres, source, created_by)
    values (v_entreprise_id, p_produit_id, v_lot_id, v_depot_id, p_quantite, p_prix_achat, v_nouveau_prix, 'entree', auth.uid());
  end if;

  return v_mouvement_id;
end;
$$;

notify pgrst, 'reload schema';
