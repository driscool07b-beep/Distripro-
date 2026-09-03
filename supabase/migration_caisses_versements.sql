-- Migration : caisses nommées, versements des commerciaux avec accusé de
-- réception, modes de paiement étendus (chèque, mobile money, virement)
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists caisses (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  nom            text not null,
  actif          boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists idx_caisses_entreprise on caisses(entreprise_id);

alter table caisses enable row level security;

drop policy if exists caisses_select on caisses;
create policy caisses_select on caisses
  for select using (entreprise_id = current_entreprise_id());

drop policy if exists caisses_insert on caisses;
create policy caisses_insert on caisses
  for insert with check (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager')
  );

drop policy if exists caisses_update on caisses;
create policy caisses_update on caisses
  for update using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager')
  );

create table if not exists versements_caisse (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references entreprises(id) on delete cascade,
  numero         text,
  commercial_id  uuid not null references profils(id),
  caisse_id      uuid not null references caisses(id),
  montant        numeric(14,2) not null check (montant > 0),
  date_versement date not null default current_date,
  recu_par       uuid references profils(id),
  created_at     timestamptz not null default now()
);

create index if not exists idx_versements_caisse_entreprise on versements_caisse(entreprise_id);
create index if not exists idx_versements_caisse_commercial on versements_caisse(commercial_id);

alter table versements_caisse enable row level security;

drop policy if exists versements_caisse_select on versements_caisse;
create policy versements_caisse_select on versements_caisse
  for select using (entreprise_id = current_entreprise_id());

create or replace function generer_numero_versement()
returns trigger
language plpgsql
as $$
declare
  compteur int;
begin
  select count(*) + 1 into compteur
  from versements_caisse
  where entreprise_id = new.entreprise_id
    and extract(year from created_at) = extract(year from now());
  new.numero := 'VRS-' || extract(year from now()) || '-' || lpad(compteur::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists trg_generer_numero_versement on versements_caisse;
create trigger trg_generer_numero_versement
before insert on versements_caisse
for each row execute function generer_numero_versement();

create or replace function enregistrer_versement_caisse(
  p_commercial_id uuid,
  p_caisse_id uuid,
  p_montant numeric,
  p_date_versement date default current_date
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_versement_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé : votre rôle ne permet pas d''enregistrer un versement';
  end if;
  if p_montant is null or p_montant <= 0 then
    raise exception 'montant invalide';
  end if;

  perform 1 from caisses where id = p_caisse_id and entreprise_id = v_entreprise_id and actif = true;
  if not found then
    raise exception 'caisse introuvable ou inactive pour cette entreprise';
  end if;

  perform 1 from profils where id = p_commercial_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'commercial introuvable pour cette entreprise';
  end if;

  insert into versements_caisse (entreprise_id, commercial_id, caisse_id, montant, date_versement, recu_par)
  values (v_entreprise_id, p_commercial_id, p_caisse_id, p_montant, p_date_versement, auth.uid())
  returning id into v_versement_id;

  return v_versement_id;
end;
$$;

alter table ventes add column if not exists mode_reglement text;

create or replace function creer_vente(
  p_client_id uuid,
  p_lignes jsonb,
  p_mode_paiement text default 'cash',
  p_date_echeance date default null,
  p_commercial_id uuid default null,
  p_montant_paye numeric default null,
  p_mode_reglement text default 'espece'
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
  v_montant_regle numeric(14,2);
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

  v_montant_regle := coalesce(
    least(p_montant_paye, v_total),
    case when p_mode_paiement = 'cash' then v_total else 0 end
  );
  if v_montant_regle < 0 then
    v_montant_regle := 0;
  end if;

  insert into ventes (entreprise_id, client_id, total, created_by, mode_paiement, statut, montant_regle, date_echeance, commercial_id, mode_reglement)
  values (
    v_entreprise_id, p_client_id, v_total, auth.uid(),
    case when v_montant_regle >= v_total then 'cash' else 'credit' end,
    'validee',
    v_montant_regle,
    case when v_montant_regle < v_total then p_date_echeance else null end,
    p_commercial_id,
    case when v_montant_regle > 0 then p_mode_reglement else null end
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
      update stock_commercial
      set quantite = quantite - v_quantite, updated_at = now()
      where commercial_id = p_commercial_id and produit_id = v_produit_id and entreprise_id = v_entreprise_id;
    else
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
