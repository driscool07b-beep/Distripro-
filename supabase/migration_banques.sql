-- Migration : module Banques — comptes bancaires, réglements par
-- chèque/virement liés à une banque, transferts banque ↔ caisse,
-- rapprochement bancaire (import du relevé Excel + comparaison), et
-- inventaire périodique de caisse (contrôle physique).
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Comptes bancaires
-- ---------------------------------------------------------------------
create table if not exists banques (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  nom text not null,
  numero_compte text,
  intitule_compte text,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

alter table banques enable row level security;
drop policy if exists banques_select on banques;
create policy banques_select on banques for select using (entreprise_id = current_entreprise_id());

create or replace function creer_banque(p_nom text, p_numero_compte text default null, p_intitule_compte text default null)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_id uuid;
begin
  if current_role_utilisateur() not in ('admin', 'manager') then raise exception 'accès refusé'; end if;
  if p_nom is null or trim(p_nom) = '' then raise exception 'le nom de la banque est requis'; end if;

  insert into banques (entreprise_id, nom, numero_compte, intitule_compte)
  values (v_entreprise_id, trim(p_nom), nullif(trim(p_numero_compte), ''), nullif(trim(p_intitule_compte), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function modifier_banque(p_banque_id uuid, p_nom text, p_numero_compte text default null, p_intitule_compte text default null, p_actif boolean default true)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
begin
  if current_role_utilisateur() not in ('admin', 'manager') then raise exception 'accès refusé'; end if;
  if p_nom is null or trim(p_nom) = '' then raise exception 'le nom de la banque est requis'; end if;

  update banques
  set nom = trim(p_nom), numero_compte = nullif(trim(p_numero_compte), ''),
      intitule_compte = nullif(trim(p_intitule_compte), ''), actif = p_actif
  where id = p_banque_id and entreprise_id = v_entreprise_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Réglements (paiements clients) par chèque/virement — lien vers
--    la banque qui reçoit le montant.
-- ---------------------------------------------------------------------
alter table reglements add column if not exists banque_id uuid references banques(id);

-- ---------------------------------------------------------------------
-- 3. Transferts caisse → banque : la table caisse_transferts existante
--    stockait la banque de destination en texte libre. On ajoute un
--    vrai lien vers la table banques, sans casser les transferts déjà
--    créés (qui gardent leur libellé texte).
-- ---------------------------------------------------------------------
alter table caisse_transferts add column if not exists banque_destination_id uuid references banques(id);

create or replace function creer_transfert_caisse(
  p_caisse_source_id uuid,
  p_caisse_destination_id uuid default null,
  p_destination_banque text default null,
  p_montant numeric default null,
  p_libelle text default null,
  p_reference_bancaire text default null,
  p_banque_destination_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_id uuid;
  v_statut text;
  v_nom_banque text;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé';
  end if;
  if p_montant is null or p_montant <= 0 then raise exception 'montant invalide'; end if;

  if p_banque_destination_id is not null then
    select nom into v_nom_banque from banques where id = p_banque_destination_id and entreprise_id = v_entreprise_id;
    if v_nom_banque is null then raise exception 'banque introuvable'; end if;
  end if;

  if p_caisse_destination_id is null and p_banque_destination_id is null and (p_destination_banque is null or trim(p_destination_banque) = '') then
    raise exception 'précisez une caisse de destination ou une banque de destination';
  end if;
  if p_caisse_destination_id is not null and (p_banque_destination_id is not null or p_destination_banque is not null) then
    raise exception 'choisissez soit une caisse de destination, soit une banque, pas les deux';
  end if;
  if p_caisse_destination_id = p_caisse_source_id then
    raise exception 'la caisse source et la caisse destination doivent être différentes';
  end if;
  perform 1 from caisses where id = p_caisse_source_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'caisse source introuvable'; end if;
  if p_caisse_destination_id is not null then
    perform 1 from caisses where id = p_caisse_destination_id and entreprise_id = v_entreprise_id;
    if not found then raise exception 'caisse destination introuvable'; end if;
  end if;

  v_statut := case when p_caisse_destination_id is null then 'receptionnee' else 'en_attente' end;

  insert into caisse_transferts (
    entreprise_id, caisse_source_id, caisse_destination_id, destination_banque, banque_destination_id,
    montant, libelle, reference_bancaire, statut, created_by,
    receptionne_par, receptionne_at
  )
  values (
    v_entreprise_id, p_caisse_source_id, p_caisse_destination_id,
    coalesce(v_nom_banque, nullif(trim(p_destination_banque), '')), p_banque_destination_id,
    p_montant, nullif(trim(p_libelle), ''), nullif(trim(p_reference_bancaire), ''), v_statut, auth.uid(),
    case when v_statut = 'receptionnee' then auth.uid() else null end,
    case when v_statut = 'receptionnee' then now() else null end
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Transferts banque → caisse (sens inverse) — même logique en 2
--    temps que les transferts entre caisses : le montant sort
--    immédiatement de la banque, ne crédite la caisse qu'après
--    confirmation de réception.
-- ---------------------------------------------------------------------
create table if not exists transferts_banque_caisse (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  numero text,
  banque_source_id uuid not null references banques(id),
  caisse_destination_id uuid not null references caisses(id),
  montant numeric(14,2) not null check (montant > 0),
  libelle text,
  reference_bancaire text,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'receptionnee')),
  created_by uuid not null references profils(id),
  created_at timestamptz not null default now(),
  receptionne_par uuid references profils(id),
  receptionne_at timestamptz
);

create or replace function generer_numero_transfert_banque_caisse()
returns trigger language plpgsql as $$
declare v_compteur int;
begin
  select count(*) + 1 into v_compteur from transferts_banque_caisse
  where entreprise_id = new.entreprise_id and extract(year from created_at) = extract(year from now());
  new.numero := 'TBC-' || extract(year from now()) || '-' || lpad(v_compteur::text, 5, '0');
  return new;
end;
$$;
drop trigger if exists trg_numero_transfert_banque_caisse on transferts_banque_caisse;
create trigger trg_numero_transfert_banque_caisse before insert on transferts_banque_caisse
for each row execute function generer_numero_transfert_banque_caisse();

alter table transferts_banque_caisse enable row level security;
drop policy if exists transferts_banque_caisse_select on transferts_banque_caisse;
create policy transferts_banque_caisse_select on transferts_banque_caisse
  for select using (entreprise_id = current_entreprise_id());

create or replace function creer_transfert_banque_caisse(p_banque_source_id uuid, p_caisse_destination_id uuid, p_montant numeric, p_libelle text default null, p_reference_bancaire text default null)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_id uuid;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;
  if p_montant is null or p_montant <= 0 then raise exception 'montant invalide'; end if;
  perform 1 from banques where id = p_banque_source_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'banque introuvable'; end if;
  perform 1 from caisses where id = p_caisse_destination_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'caisse introuvable'; end if;

  insert into transferts_banque_caisse (entreprise_id, banque_source_id, caisse_destination_id, montant, libelle, reference_bancaire, created_by)
  values (v_entreprise_id, p_banque_source_id, p_caisse_destination_id, p_montant, nullif(trim(p_libelle), ''), nullif(trim(p_reference_bancaire), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function receptionner_transfert_banque_caisse(p_transfert_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_transfert record;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;
  select * into v_transfert from transferts_banque_caisse where id = p_transfert_id and entreprise_id = v_entreprise_id for update;
  if not found then raise exception 'transfert introuvable'; end if;
  if v_transfert.statut <> 'en_attente' then raise exception 'ce transfert a déjà été réceptionné'; end if;

  update transferts_banque_caisse set statut = 'receptionnee', receptionne_par = auth.uid(), receptionne_at = now()
  where id = p_transfert_id;
end;
$$;

-- Le pendant côté caisse_transferts : réceptionner un virement
-- caisse→banque n'a pas de sens (la banque n'a personne pour
-- "confirmer réception" dans l'app) — ces transferts sont donc déjà
-- 'receptionnee' immédiatement à la création (voir creer_transfert_caisse
-- plus haut, comportement inchangé).

-- ---------------------------------------------------------------------
-- 5. Solde et grand livre d'une banque.
-- ---------------------------------------------------------------------
create or replace function solde_banque(p_banque_id uuid)
returns numeric
language sql security definer stable set search_path to 'public'
as $$
  select
    coalesce((select sum(r.montant) from reglements r where r.banque_id = p_banque_id), 0)
    + coalesce((select sum(ct.montant) from caisse_transferts ct where ct.banque_destination_id = p_banque_id), 0)
    - coalesce((select sum(tbc.montant) from transferts_banque_caisse tbc where tbc.banque_source_id = p_banque_id), 0);
$$;

create or replace function journal_banque(p_banque_id uuid, p_date_debut date default null, p_date_fin date default null)
returns table (date_mouvement timestamptz, numero text, type_mouvement text, libelle text, debit numeric, credit numeric, solde numeric)
language sql security definer stable set search_path to 'public'
as $$
  with mouvements as (
    select r.created_at as date_mouvement, r.numero, 'reglement'::text as type_mouvement,
           'Règlement (' || r.mode || ') — ' || coalesce(v.numero_vente, '') as libelle, 0::numeric as debit, r.montant as credit
    from reglements r
    left join ventes v on v.id = r.vente_id
    where r.banque_id = p_banque_id

    union all
    select ct.created_at, ct.numero, 'transfert_entrant',
           'Transfert depuis caisse — ' || coalesce(ct.libelle, ''), 0, ct.montant
    from caisse_transferts ct
    where ct.banque_destination_id = p_banque_id

    union all
    select tbc.created_at, tbc.numero, 'transfert_sortant',
           'Transfert vers caisse — ' || coalesce(tbc.libelle, ''), tbc.montant, 0
    from transferts_banque_caisse tbc
    where tbc.banque_source_id = p_banque_id
  )
  select date_mouvement, numero, type_mouvement, libelle, debit, credit,
         sum(credit - debit) over (order by date_mouvement, numero rows between unbounded preceding and current row) as solde
  from mouvements
  where date_mouvement is not null
    and (p_date_debut is null or date_mouvement::date >= p_date_debut)
    and (p_date_fin is null or date_mouvement::date <= p_date_fin)
  order by date_mouvement, numero;
$$;

-- ---------------------------------------------------------------------
-- 6. Rapprochement bancaire — import du relevé (Excel, parsé côté
--    client) et comparaison avec nos propres mouvements.
-- ---------------------------------------------------------------------
create table if not exists rapprochements_bancaires (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  banque_id uuid not null references banques(id),
  periode_debut date not null,
  periode_fin date not null,
  created_by uuid not null references profils(id),
  created_at timestamptz not null default now()
);

alter table rapprochements_bancaires enable row level security;
drop policy if exists rapprochements_bancaires_select on rapprochements_bancaires;
create policy rapprochements_bancaires_select on rapprochements_bancaires
  for select using (entreprise_id = current_entreprise_id());

create table if not exists rapprochement_lignes_releve (
  id uuid primary key default gen_random_uuid(),
  rapprochement_id uuid not null references rapprochements_bancaires(id) on delete cascade,
  date_mouvement date,
  libelle text,
  montant numeric(14,2) not null
);

alter table rapprochement_lignes_releve enable row level security;
drop policy if exists rapprochement_lignes_releve_select on rapprochement_lignes_releve;
create policy rapprochement_lignes_releve_select on rapprochement_lignes_releve
  for select using (
    rapprochement_id in (select id from rapprochements_bancaires where entreprise_id = current_entreprise_id())
  );

create or replace function creer_rapprochement(p_banque_id uuid, p_periode_debut date, p_periode_fin date, p_lignes jsonb)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_id uuid;
  v_ligne jsonb;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;
  perform 1 from banques where id = p_banque_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'banque introuvable'; end if;
  if p_periode_debut > p_periode_fin then raise exception 'la date de début doit précéder la date de fin'; end if;

  insert into rapprochements_bancaires (entreprise_id, banque_id, periode_debut, periode_fin, created_by)
  values (v_entreprise_id, p_banque_id, p_periode_debut, p_periode_fin, auth.uid())
  returning id into v_id;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    insert into rapprochement_lignes_releve (rapprochement_id, date_mouvement, libelle, montant)
    values (
      v_id,
      nullif(v_ligne->>'date', '')::date,
      v_ligne->>'libelle',
      (v_ligne->>'montant')::numeric
    );
  end loop;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Inventaire périodique de caisse — contrôle physique par un
--    responsable, comparé au solde théorique.
-- ---------------------------------------------------------------------
create table if not exists inventaires_caisse (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  numero text,
  caisse_id uuid not null references caisses(id),
  solde_theorique numeric(14,2) not null,
  solde_compte numeric(14,2) not null,
  ecart numeric(14,2) generated always as (solde_compte - solde_theorique) stored,
  controle_par uuid not null references profils(id),
  notes text,
  created_at timestamptz not null default now()
);

create or replace function generer_numero_inventaire_caisse()
returns trigger language plpgsql as $$
declare v_compteur int;
begin
  select count(*) + 1 into v_compteur from inventaires_caisse
  where entreprise_id = new.entreprise_id and extract(year from created_at) = extract(year from now());
  new.numero := 'INV-' || extract(year from now()) || '-' || lpad(v_compteur::text, 5, '0');
  return new;
end;
$$;
drop trigger if exists trg_numero_inventaire_caisse on inventaires_caisse;
create trigger trg_numero_inventaire_caisse before insert on inventaires_caisse
for each row execute function generer_numero_inventaire_caisse();

alter table inventaires_caisse enable row level security;
drop policy if exists inventaires_caisse_select on inventaires_caisse;
create policy inventaires_caisse_select on inventaires_caisse
  for select using (entreprise_id = current_entreprise_id());

create or replace function creer_inventaire_caisse(p_caisse_id uuid, p_solde_compte numeric, p_notes text default null)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_solde_theorique numeric;
  v_id uuid;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé : réservé au responsable comptable';
  end if;
  perform 1 from caisses where id = p_caisse_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'caisse introuvable'; end if;
  if p_solde_compte is null or p_solde_compte < 0 then raise exception 'montant compté invalide'; end if;

  v_solde_theorique := solde_caisse(p_caisse_id);

  insert into inventaires_caisse (entreprise_id, caisse_id, solde_theorique, solde_compte, controle_par, notes)
  values (v_entreprise_id, p_caisse_id, v_solde_theorique, p_solde_compte, auth.uid(), nullif(trim(p_notes), ''))
  returning id into v_id;

  return v_id;
end;
$$;
