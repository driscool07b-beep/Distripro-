-- Migration : traçabilité complète des références de paiement
-- (numéro de chèque, référence de virement) — sur les règlements
-- reçus des clients, sur les retraits banque→caisse (le champ
-- existait déjà en base mais n'était jamais rempli, le formulaire ne
-- le proposait pas), et nouveau : décaissement bancaire direct
-- (chèque ou virement émis pour un fournisseur, sans passer par une
-- caisse).
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Référence de paiement sur les règlements reçus des clients.
-- ---------------------------------------------------------------------
alter table reglements add column if not exists reference_paiement text;

create or replace function enregistrer_reglement(p_vente_id uuid, p_montant numeric, p_mode text default 'espece', p_commercial_id uuid default null, p_banque_id uuid default null, p_reference_paiement text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_vente record;
  v_reglement_id uuid;
begin
  select * into v_vente from ventes where id = p_vente_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'vente introuvable';
  end if;

  if v_vente.statut = 'annulee' then
    raise exception 'impossible de régler une vente annulée';
  end if;

  if v_vente.mode_paiement <> 'credit' then
    raise exception 'cette vente n''est pas à crédit';
  end if;

  if v_vente.montant_regle + p_montant > v_vente.total then
    raise exception 'le montant dépasse le solde restant dû';
  end if;

  if p_banque_id is not null then
    perform 1 from banques where id = p_banque_id and entreprise_id = v_entreprise_id;
    if not found then raise exception 'banque introuvable'; end if;
  end if;

  update ventes
  set montant_regle = montant_regle + p_montant
  where id = p_vente_id;

  insert into reglements (entreprise_id, vente_id, montant, mode, created_by, commercial_id, banque_id, reference_paiement)
  values (v_entreprise_id, p_vente_id, p_montant, p_mode, auth.uid(), p_commercial_id, p_banque_id, nullif(trim(p_reference_paiement), ''))
  returning id into v_reglement_id;

  return v_reglement_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Décaissement bancaire direct — chèque ou virement émis vers un
--    bénéficiaire externe (fournisseur, etc.), sans passer par une
--    caisse. Enregistrement direct par un rôle habilité, avec pièce
--    justificative optionnelle (photo de la souche du chèque, par
--    exemple) — pas de workflow de validation séparé pour l'instant,
--    contrairement aux décaissements de caisse.
-- ---------------------------------------------------------------------
create table if not exists decaissements_banque (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  numero text,
  banque_id uuid not null references banques(id),
  beneficiaire text not null,
  montant numeric(14,2) not null check (montant > 0),
  mode text not null default 'cheque' check (mode in ('cheque', 'virement')),
  reference_paiement text,
  libelle text,
  piece_justificative_path text,
  piece_justificative_nom text,
  created_by uuid not null references profils(id),
  created_at timestamptz not null default now()
);

create or replace function generer_numero_decaissement_banque()
returns trigger language plpgsql as $$
declare v_compteur int;
begin
  select count(*) + 1 into v_compteur from decaissements_banque
  where entreprise_id = new.entreprise_id and extract(year from created_at) = extract(year from now());
  new.numero := 'DB-' || extract(year from now()) || '-' || lpad(v_compteur::text, 5, '0');
  return new;
end;
$$;
drop trigger if exists trg_numero_decaissement_banque on decaissements_banque;
create trigger trg_numero_decaissement_banque before insert on decaissements_banque
for each row execute function generer_numero_decaissement_banque();

alter table decaissements_banque enable row level security;
drop policy if exists decaissements_banque_select on decaissements_banque;
create policy decaissements_banque_select on decaissements_banque
  for select using (entreprise_id = current_entreprise_id());

create or replace function creer_decaissement_banque(
  p_banque_id uuid,
  p_beneficiaire text,
  p_montant numeric,
  p_mode text default 'cheque',
  p_reference_paiement text default null,
  p_libelle text default null,
  p_piece_path text default null,
  p_piece_nom text default null
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
  if p_beneficiaire is null or trim(p_beneficiaire) = '' then raise exception 'le bénéficiaire est requis'; end if;
  if p_montant is null or p_montant <= 0 then raise exception 'montant invalide'; end if;
  if p_mode not in ('cheque', 'virement') then raise exception 'mode invalide'; end if;
  perform 1 from banques where id = p_banque_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'banque introuvable'; end if;

  insert into decaissements_banque (entreprise_id, banque_id, beneficiaire, montant, mode, reference_paiement, libelle, piece_justificative_path, piece_justificative_nom, created_by)
  values (v_entreprise_id, p_banque_id, trim(p_beneficiaire), p_montant, p_mode, nullif(trim(p_reference_paiement), ''), nullif(trim(p_libelle), ''), p_piece_path, p_piece_nom, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. solde_banque / journal_banque : intègrent désormais les
--    décaissements bancaires directs (débit), et affichent la
--    référence de paiement/chèque sur chaque ligne concernée.
-- ---------------------------------------------------------------------
create or replace function solde_banque(p_banque_id uuid)
returns numeric
language sql security definer stable set search_path to 'public'
as $$
  select
    coalesce((select sum(r.montant) from reglements r where r.banque_id = p_banque_id), 0)
    + coalesce((select sum(ct.montant) from caisse_transferts ct where ct.banque_destination_id = p_banque_id and ct.statut = 'receptionnee'), 0)
    - coalesce((select sum(tbc.montant) from transferts_banque_caisse tbc where tbc.banque_source_id = p_banque_id), 0)
    - coalesce((select sum(db.montant) from decaissements_banque db where db.banque_id = p_banque_id), 0);
$$;

-- Le nombre de colonnes retournées change par rapport à la version
-- précédente (ajout de 'reference') — Postgres exige de supprimer la
-- fonction avant de la recréer dans ce cas (un simple CREATE OR
-- REPLACE ne suffit pas quand la 'forme' du retour change).
drop function if exists journal_banque(uuid, date, date);

create or replace function journal_banque(p_banque_id uuid, p_date_debut date default null, p_date_fin date default null)
returns table (date_mouvement timestamptz, numero text, type_mouvement text, libelle text, reference text, debit numeric, credit numeric, solde numeric)
language sql security definer stable set search_path to 'public'
as $$
  with mouvements as (
    select r.created_at as date_mouvement, r.numero, 'reglement'::text as type_mouvement,
           'Règlement (' || r.mode || ') — ' || coalesce(v.numero_vente, '') as libelle, r.reference_paiement as reference,
           0::numeric as debit, r.montant as credit
    from reglements r
    left join ventes v on v.id = r.vente_id
    where r.banque_id = p_banque_id

    union all
    select ct.receptionne_at, ct.numero, 'transfert_entrant',
           'Transfert depuis caisse — ' || coalesce(ct.libelle, ''), ct.reference_bancaire, 0, ct.montant
    from caisse_transferts ct
    where ct.banque_destination_id = p_banque_id and ct.statut = 'receptionnee'

    union all
    select tbc.created_at, tbc.numero, 'transfert_sortant',
           'Transfert vers caisse — ' || coalesce(tbc.libelle, ''), tbc.reference_bancaire, tbc.montant, 0
    from transferts_banque_caisse tbc
    where tbc.banque_source_id = p_banque_id

    union all
    select db.created_at, db.numero, 'decaissement',
           'Décaissement (' || db.mode || ') — ' || db.beneficiaire || coalesce(' — ' || db.libelle, ''), db.reference_paiement, db.montant, 0
    from decaissements_banque db
    where db.banque_id = p_banque_id
  )
  select date_mouvement, numero, type_mouvement, libelle, reference, debit, credit,
         sum(credit - debit) over (order by date_mouvement, numero rows between unbounded preceding and current row) as solde
  from mouvements
  where date_mouvement is not null
    and (p_date_debut is null or date_mouvement::date >= p_date_debut)
    and (p_date_fin is null or date_mouvement::date <= p_date_fin)
  order by date_mouvement, numero;
$$;
