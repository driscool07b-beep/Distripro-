-- Migration : transferts internes (caisse↔caisse, caisse↔banque,
-- banque↔caisse) — correctif + paramétrage de la preuve exigée.
--
-- Correctif : un transfert caisse→banque était jusqu'ici confirmé
-- INSTANTANÉMENT à la création (l'argent était considéré "arrivé à
-- la banque" avant même que quelqu'un soit allé physiquement le
-- déposer). Corrigé : passe désormais par le même cycle en 2 temps
-- que les autres transferts (en_attente → confirmé), la confirmation
-- représentant le moment où le dépôt/retrait a été réellement
-- effectué au guichet — pas une confirmation "de la banque"
-- (personne côté banque n'utilise l'app), mais de la personne chez
-- nous qui est allée faire l'opération.
--
-- Paramétrage : chaque entreprise choisit si cette confirmation doit
-- être appuyée d'une pièce justificative (photo du bordereau de
-- versement/retrait) ou si une simple confirmation suffit.
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Réglage.
-- ---------------------------------------------------------------------
alter table entreprises add column if not exists justificatif_transfert_requis boolean not null default false;

create or replace function modifier_parametrage_transferts(p_justificatif_requis boolean)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if current_role_utilisateur() <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut modifier ce réglage';
  end if;
  update entreprises set justificatif_transfert_requis = p_justificatif_requis where id = current_entreprise_id();
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Pièce justificative à la confirmation — colonnes sur les deux
--    tables de transfert.
-- ---------------------------------------------------------------------
alter table caisse_transferts add column if not exists piece_justificative_path text;
alter table caisse_transferts add column if not exists piece_justificative_nom text;
alter table transferts_banque_caisse add column if not exists piece_justificative_path text;
alter table transferts_banque_caisse add column if not exists piece_justificative_nom text;

-- ---------------------------------------------------------------------
-- 3. creer_transfert_caisse : un transfert vers une banque n'est plus
--    confirmé instantanément — même cycle en 2 temps que vers une
--    autre caisse.
-- ---------------------------------------------------------------------
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

  insert into caisse_transferts (
    entreprise_id, caisse_source_id, caisse_destination_id, destination_banque, banque_destination_id,
    montant, libelle, reference_bancaire, statut, created_by
  )
  values (
    v_entreprise_id, p_caisse_source_id, p_caisse_destination_id,
    coalesce(v_nom_banque, nullif(trim(p_destination_banque), '')), p_banque_destination_id,
    p_montant, nullif(trim(p_libelle), ''), nullif(trim(p_reference_bancaire), ''), 'en_attente', auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Confirmation — exige la pièce justificative si le réglage de
--    l'entreprise l'impose.
-- ---------------------------------------------------------------------
create or replace function receptionner_transfert_caisse(p_transfert_id uuid, p_piece_justificative_path text default null, p_piece_justificative_nom text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_transfert record;
  v_justificatif_requis boolean;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé';
  end if;

  select * into v_transfert from caisse_transferts
  where id = p_transfert_id and entreprise_id = v_entreprise_id
  for update;
  if not found then raise exception 'transfert introuvable'; end if;
  if v_transfert.statut <> 'en_attente' then raise exception 'ce transfert a déjà été réceptionné'; end if;

  select justificatif_transfert_requis into v_justificatif_requis from entreprises where id = v_entreprise_id;
  if v_justificatif_requis and (p_piece_justificative_path is null or trim(p_piece_justificative_path) = '') then
    raise exception 'une pièce justificative (bordereau) est requise pour confirmer ce transfert';
  end if;

  update caisse_transferts
  set statut = 'receptionnee', receptionne_par = auth.uid(), receptionne_at = now(),
      piece_justificative_path = p_piece_justificative_path, piece_justificative_nom = p_piece_justificative_nom
  where id = p_transfert_id;
end;
$$;

create or replace function receptionner_transfert_banque_caisse(p_transfert_id uuid, p_piece_justificative_path text default null, p_piece_justificative_nom text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_transfert record;
  v_justificatif_requis boolean;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;
  select * into v_transfert from transferts_banque_caisse where id = p_transfert_id and entreprise_id = v_entreprise_id for update;
  if not found then raise exception 'transfert introuvable'; end if;
  if v_transfert.statut <> 'en_attente' then raise exception 'ce transfert a déjà été réceptionné'; end if;

  select justificatif_transfert_requis into v_justificatif_requis from entreprises where id = v_entreprise_id;
  if v_justificatif_requis and (p_piece_justificative_path is null or trim(p_piece_justificative_path) = '') then
    raise exception 'une pièce justificative (bordereau) est requise pour confirmer ce transfert';
  end if;

  update transferts_banque_caisse
  set statut = 'receptionnee', receptionne_par = auth.uid(), receptionne_at = now(),
      piece_justificative_path = p_piece_justificative_path, piece_justificative_nom = p_piece_justificative_nom
  where id = p_transfert_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. solde_banque / journal_banque : un transfert caisse→banque ne
--    crédite plus la banque qu'une fois confirmé (statut
--    'receptionnee'), comme c'était déjà le cas pour le solde de la
--    caisse destination.
-- ---------------------------------------------------------------------
create or replace function solde_banque(p_banque_id uuid)
returns numeric
language sql security definer stable set search_path to 'public'
as $$
  select
    coalesce((select sum(r.montant) from reglements r where r.banque_id = p_banque_id), 0)
    + coalesce((select sum(ct.montant) from caisse_transferts ct where ct.banque_destination_id = p_banque_id and ct.statut = 'receptionnee'), 0)
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
    select ct.receptionne_at, ct.numero, 'transfert_entrant',
           'Transfert depuis caisse — ' || coalesce(ct.libelle, ''), 0, ct.montant
    from caisse_transferts ct
    where ct.banque_destination_id = p_banque_id and ct.statut = 'receptionnee'

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
