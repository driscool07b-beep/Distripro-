-- Migration : journal de caisse façon logiciel comptable —
-- numérotation automatique, bénéficiaire, annulation/correction par
-- la caissière, approvisionnements (banque/prêt/autre),
-- transferts entre caisses et vers la banque (inspiré du mouvement
-- entre magasins de stock), retours de fonds, et grand livre
-- débit/crédit/solde progressif combinant tous ces mouvements.
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. demandes_decaissement : numérotation, bénéficiaire, annulation
-- ---------------------------------------------------------------------
alter table demandes_decaissement add column if not exists numero text;
alter table demandes_decaissement add column if not exists beneficiaire text;

alter table demandes_decaissement drop constraint if exists demandes_decaissement_statut_check;
alter table demandes_decaissement add constraint demandes_decaissement_statut_check
  check (statut in ('en_attente', 'validee', 'refusee', 'payee', 'annulee'));

create or replace function generer_numero_decaissement()
returns trigger
language plpgsql
as $$
declare
  compteur int;
begin
  select count(*) + 1 into compteur
  from demandes_decaissement
  where entreprise_id = new.entreprise_id
    and extract(year from created_at) = extract(year from now());
  new.numero := 'DEC-' || extract(year from now()) || '-' || lpad(compteur::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists trg_generer_numero_decaissement on demandes_decaissement;
create trigger trg_generer_numero_decaissement
before insert on demandes_decaissement
for each row execute function generer_numero_decaissement();

-- ---------------------------------------------------------------------
-- 2. Approvisionnements de caisse (banque, prêt, autre) — entrées de
--    fonds qui ne viennent pas d'un versement commercial.
-- ---------------------------------------------------------------------
create table if not exists caisse_approvisionnements (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  caisse_id uuid not null references caisses(id),
  numero text,
  source text not null check (source in ('banque', 'pret', 'autre')),
  libelle text not null,
  montant numeric(14,2) not null check (montant > 0),
  reference text,
  created_by uuid not null references profils(id),
  created_at timestamptz not null default now()
);

create or replace function generer_numero_approvisionnement()
returns trigger
language plpgsql
as $$
declare
  compteur int;
begin
  select count(*) + 1 into compteur
  from caisse_approvisionnements
  where entreprise_id = new.entreprise_id
    and extract(year from created_at) = extract(year from now());
  new.numero := 'APP-' || extract(year from now()) || '-' || lpad(compteur::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists trg_generer_numero_approvisionnement on caisse_approvisionnements;
create trigger trg_generer_numero_approvisionnement
before insert on caisse_approvisionnements
for each row execute function generer_numero_approvisionnement();

alter table caisse_approvisionnements enable row level security;
drop policy if exists caisse_approvisionnements_select on caisse_approvisionnements;
create policy caisse_approvisionnements_select on caisse_approvisionnements
  for select using (entreprise_id = current_entreprise_id());

-- ---------------------------------------------------------------------
-- 3. Transferts de fonds — entre deux caisses, ou d'une caisse vers
--    la banque. Même logique que les transferts de stock entre
--    dépôts : le montant sort immédiatement de la caisse source ; s'il
--    va vers une autre caisse, il ne crédite celle-ci qu'après
--    confirmation de réception. S'il va vers la banque (pas de caisse
--    de destination dans le système), il n'y a rien à réceptionner.
-- ---------------------------------------------------------------------
create table if not exists caisse_transferts (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  numero text,
  caisse_source_id uuid not null references caisses(id),
  caisse_destination_id uuid references caisses(id),
  destination_banque text,
  montant numeric(14,2) not null check (montant > 0),
  libelle text,
  reference_bancaire text,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'receptionnee')),
  created_by uuid not null references profils(id),
  created_at timestamptz not null default now(),
  receptionne_par uuid references profils(id),
  receptionne_at timestamptz,
  constraint chk_destination check (
    (caisse_destination_id is not null and destination_banque is null)
    or (caisse_destination_id is null and destination_banque is not null)
  )
);

create or replace function generer_numero_transfert_caisse()
returns trigger
language plpgsql
as $$
declare
  compteur int;
begin
  select count(*) + 1 into compteur
  from caisse_transferts
  where entreprise_id = new.entreprise_id
    and extract(year from created_at) = extract(year from now());
  new.numero := 'TRF-' || extract(year from now()) || '-' || lpad(compteur::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists trg_generer_numero_transfert_caisse on caisse_transferts;
create trigger trg_generer_numero_transfert_caisse
before insert on caisse_transferts
for each row execute function generer_numero_transfert_caisse();

alter table caisse_transferts enable row level security;
drop policy if exists caisse_transferts_select on caisse_transferts;
create policy caisse_transferts_select on caisse_transferts
  for select using (entreprise_id = current_entreprise_id());

-- ---------------------------------------------------------------------
-- 4. Retours de fonds — argent qui revient à la caisse après un
--    décaissement déjà payé (trop perçu, achat annulé après paiement).
-- ---------------------------------------------------------------------
create table if not exists caisse_retours_fonds (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  caisse_id uuid not null references caisses(id),
  numero text,
  demande_id uuid references demandes_decaissement(id),
  montant numeric(14,2) not null check (montant > 0),
  motif text not null,
  created_by uuid not null references profils(id),
  created_at timestamptz not null default now()
);

create or replace function generer_numero_retour_fonds()
returns trigger
language plpgsql
as $$
declare
  compteur int;
begin
  select count(*) + 1 into compteur
  from caisse_retours_fonds
  where entreprise_id = new.entreprise_id
    and extract(year from created_at) = extract(year from now());
  new.numero := 'RET-' || extract(year from now()) || '-' || lpad(compteur::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists trg_generer_numero_retour_fonds on caisse_retours_fonds;
create trigger trg_generer_numero_retour_fonds
before insert on caisse_retours_fonds
for each row execute function generer_numero_retour_fonds();

alter table caisse_retours_fonds enable row level security;
drop policy if exists caisse_retours_fonds_select on caisse_retours_fonds;
create policy caisse_retours_fonds_select on caisse_retours_fonds
  for select using (entreprise_id = current_entreprise_id());

-- ---------------------------------------------------------------------
-- 5. creer_demande_decaissement : ajout du bénéficiaire.
-- ---------------------------------------------------------------------
create or replace function creer_demande_decaissement(
  p_caisse_id uuid,
  p_libelle text,
  p_montant numeric,
  p_piece_path text default null,
  p_piece_nom text default null,
  p_beneficiaire text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_seuil numeric;
  v_demande_id uuid;
  v_statut text := 'en_attente';
  v_montant_valide numeric := null;
  v_valide_at timestamptz := null;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé';
  end if;
  if p_libelle is null or trim(p_libelle) = '' then
    raise exception 'le libellé est requis';
  end if;
  if p_montant is null or p_montant <= 0 then
    raise exception 'montant invalide';
  end if;
  perform 1 from caisses where id = p_caisse_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'caisse introuvable';
  end if;

  select caisse_seuil_validation into v_seuil from entreprises where id = v_entreprise_id;

  if v_seuil is not null and p_montant <= v_seuil then
    v_statut := 'validee';
    v_montant_valide := p_montant;
    v_valide_at := now();
  end if;

  insert into demandes_decaissement (
    entreprise_id, caisse_id, libelle, montant_demande,
    piece_justificative_path, piece_justificative_nom, demande_par,
    statut, montant_valide, valide_at, beneficiaire
  )
  values (
    v_entreprise_id, p_caisse_id, trim(p_libelle), p_montant,
    p_piece_path, p_piece_nom, auth.uid(),
    v_statut, v_montant_valide, v_valide_at, nullif(trim(p_beneficiaire), '')
  )
  returning id into v_demande_id;

  return v_demande_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. La caissière annule ou corrige sa propre demande, tant qu'elle
--    n'a pas encore été traitée (en_attente uniquement).
-- ---------------------------------------------------------------------
create or replace function annuler_demande_decaissement(p_demande_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_demande record;
begin
  select * into v_demande from demandes_decaissement
  where id = p_demande_id and entreprise_id = v_entreprise_id
  for update;
  if not found then raise exception 'demande introuvable'; end if;
  if v_demande.statut <> 'en_attente' then
    raise exception 'seule une demande en attente peut être annulée';
  end if;
  if v_demande.demande_par <> auth.uid() and current_role_utilisateur() not in ('admin', 'manager') then
    raise exception 'accès refusé';
  end if;

  update demandes_decaissement set statut = 'annulee' where id = p_demande_id;
end;
$$;

create or replace function modifier_demande_decaissement(
  p_demande_id uuid,
  p_libelle text,
  p_montant numeric,
  p_beneficiaire text default null,
  p_piece_path text default null,
  p_piece_nom text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_demande record;
begin
  select * into v_demande from demandes_decaissement
  where id = p_demande_id and entreprise_id = v_entreprise_id
  for update;
  if not found then raise exception 'demande introuvable'; end if;
  if v_demande.statut <> 'en_attente' then
    raise exception 'seule une demande en attente peut être corrigée';
  end if;
  if v_demande.demande_par <> auth.uid() then
    raise exception 'accès refusé : seule la personne à l''origine de la demande peut la corriger';
  end if;
  if p_libelle is null or trim(p_libelle) = '' then raise exception 'le libellé est requis'; end if;
  if p_montant is null or p_montant <= 0 then raise exception 'montant invalide'; end if;

  update demandes_decaissement
  set libelle = trim(p_libelle),
      montant_demande = p_montant,
      beneficiaire = nullif(trim(p_beneficiaire), ''),
      piece_justificative_path = coalesce(p_piece_path, piece_justificative_path),
      piece_justificative_nom = coalesce(p_piece_nom, piece_justificative_nom)
  where id = p_demande_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Approvisionnement (banque / prêt / autre).
-- ---------------------------------------------------------------------
create or replace function creer_approvisionnement(
  p_caisse_id uuid,
  p_source text,
  p_libelle text,
  p_montant numeric,
  p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_id uuid;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé';
  end if;
  if p_source not in ('banque', 'pret', 'autre') then raise exception 'source invalide'; end if;
  if p_libelle is null or trim(p_libelle) = '' then raise exception 'le libellé est requis'; end if;
  if p_montant is null or p_montant <= 0 then raise exception 'montant invalide'; end if;
  perform 1 from caisses where id = p_caisse_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'caisse introuvable'; end if;

  insert into caisse_approvisionnements (entreprise_id, caisse_id, source, libelle, montant, reference, created_by)
  values (v_entreprise_id, p_caisse_id, p_source, trim(p_libelle), p_montant, nullif(trim(p_reference), ''), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Transfert de fonds — vers une autre caisse (2 temps, comme les
--    transferts de stock) ou vers la banque (1 temps).
-- ---------------------------------------------------------------------
create or replace function creer_transfert_caisse(
  p_caisse_source_id uuid,
  p_caisse_destination_id uuid default null,
  p_destination_banque text default null,
  p_montant numeric default null,
  p_libelle text default null,
  p_reference_bancaire text default null
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
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé';
  end if;
  if p_montant is null or p_montant <= 0 then raise exception 'montant invalide'; end if;
  if p_caisse_destination_id is null and (p_destination_banque is null or trim(p_destination_banque) = '') then
    raise exception 'précisez une caisse de destination ou une banque de destination';
  end if;
  if p_caisse_destination_id is not null and p_destination_banque is not null then
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
    entreprise_id, caisse_source_id, caisse_destination_id, destination_banque,
    montant, libelle, reference_bancaire, statut, created_by,
    receptionne_par, receptionne_at
  )
  values (
    v_entreprise_id, p_caisse_source_id, p_caisse_destination_id, nullif(trim(p_destination_banque), ''),
    p_montant, nullif(trim(p_libelle), ''), nullif(trim(p_reference_bancaire), ''), v_statut, auth.uid(),
    case when v_statut = 'receptionnee' then auth.uid() else null end,
    case when v_statut = 'receptionnee' then now() else null end
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function receptionner_transfert_caisse(p_transfert_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_transfert record;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé';
  end if;

  select * into v_transfert from caisse_transferts
  where id = p_transfert_id and entreprise_id = v_entreprise_id
  for update;
  if not found then raise exception 'transfert introuvable'; end if;
  if v_transfert.statut <> 'en_attente' then raise exception 'ce transfert a déjà été réceptionné'; end if;

  update caisse_transferts
  set statut = 'receptionnee', receptionne_par = auth.uid(), receptionne_at = now()
  where id = p_transfert_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Retour de fonds.
-- ---------------------------------------------------------------------
create or replace function creer_retour_fonds(
  p_caisse_id uuid,
  p_montant numeric,
  p_motif text,
  p_demande_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_id uuid;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé';
  end if;
  if p_montant is null or p_montant <= 0 then raise exception 'montant invalide'; end if;
  if p_motif is null or trim(p_motif) = '' then raise exception 'le motif est requis'; end if;
  perform 1 from caisses where id = p_caisse_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'caisse introuvable'; end if;
  if p_demande_id is not null then
    perform 1 from demandes_decaissement where id = p_demande_id and entreprise_id = v_entreprise_id;
    if not found then raise exception 'demande de décaissement introuvable'; end if;
  end if;

  insert into caisse_retours_fonds (entreprise_id, caisse_id, demande_id, montant, motif, created_by)
  values (v_entreprise_id, p_caisse_id, p_demande_id, p_montant, trim(p_motif), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Solde de caisse — tient compte de TOUS les types de mouvements.
-- ---------------------------------------------------------------------
create or replace function solde_caisse(p_caisse_id uuid)
returns numeric
language sql
security definer
stable
set search_path to 'public'
as $$
  select
    coalesce((select sum(montant) from versements_caisse where caisse_id = p_caisse_id), 0)
    + coalesce((select sum(montant) from caisse_approvisionnements where caisse_id = p_caisse_id), 0)
    + coalesce((select sum(montant) from caisse_retours_fonds where caisse_id = p_caisse_id), 0)
    + coalesce((select sum(montant) from caisse_transferts where caisse_destination_id = p_caisse_id and statut = 'receptionnee'), 0)
    - coalesce((select sum(montant_valide) from demandes_decaissement where caisse_id = p_caisse_id and statut = 'payee'), 0)
    - coalesce((select sum(montant) from caisse_transferts where caisse_source_id = p_caisse_id), 0);
$$;

-- ---------------------------------------------------------------------
-- 11. Grand livre de la caisse — débit / crédit / solde progressif,
--     combinant tous les types de mouvements, façon logiciel comptable.
-- ---------------------------------------------------------------------
create or replace function journal_caisse(p_caisse_id uuid, p_date_debut date default null, p_date_fin date default null)
returns table (
  date_mouvement timestamptz,
  numero text,
  type_mouvement text,
  libelle text,
  debit numeric,
  credit numeric,
  solde numeric
)
language sql
security definer
stable
set search_path to 'public'
as $$
  with mouvements as (
    select v.created_at as date_mouvement, v.numero, 'versement'::text as type_mouvement,
           'Versement — ' || coalesce(p.nom, '?') as libelle, 0::numeric as debit, v.montant as credit
    from versements_caisse v
    left join profils p on p.id = v.commercial_id
    where v.caisse_id = p_caisse_id

    union all
    select a.created_at, a.numero, 'approvisionnement',
           'Approvisionnement (' || a.source || ') — ' || a.libelle, 0, a.montant
    from caisse_approvisionnements a
    where a.caisse_id = p_caisse_id

    union all
    select r.created_at, r.numero, 'retour_fonds',
           'Retour de fonds — ' || r.motif, 0, r.montant
    from caisse_retours_fonds r
    where r.caisse_id = p_caisse_id

    union all
    select d.payee_at, d.numero, 'decaissement',
           'Décaissement — ' || d.libelle, d.montant_valide, 0
    from demandes_decaissement d
    where d.caisse_id = p_caisse_id and d.statut = 'payee'

    union all
    select t.created_at, t.numero, 'transfert_sortant',
           'Transfert sortant — ' || coalesce(t.libelle, coalesce(t.destination_banque, 'vers autre caisse')), t.montant, 0
    from caisse_transferts t
    where t.caisse_source_id = p_caisse_id

    union all
    select t.receptionne_at, t.numero, 'transfert_entrant',
           'Transfert entrant — ' || coalesce(t.libelle, 'depuis autre caisse'), 0, t.montant
    from caisse_transferts t
    where t.caisse_destination_id = p_caisse_id and t.statut = 'receptionnee'
  )
  select
    date_mouvement, numero, type_mouvement, libelle, debit, credit,
    sum(credit - debit) over (order by date_mouvement, numero rows between unbounded preceding and current row) as solde
  from mouvements
  where date_mouvement is not null
    and (p_date_debut is null or date_mouvement::date >= p_date_debut)
    and (p_date_fin is null or date_mouvement::date <= p_date_fin)
  order by date_mouvement, numero;
$$;
