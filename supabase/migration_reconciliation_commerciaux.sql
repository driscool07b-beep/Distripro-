-- Migration : lot 4 — stock des commerciaux, réconciliation, dettes, écritures.
--
-- 1. Paramètres (entreprise) : racine du compte de tiers des commerciaux
--    (471 par défaut), valorisation des manquants (prix de vente / de revient),
--    comptes de ventes, stock, pertes, caisse, clients.
-- 2. Sous-compte comptable par commercial (ex. 471001 — Débiteur KONE).
-- 3. Journal automatique de chaque mouvement du stock d'un commercial
--    (sortie, vente, retour, échange, ajustement) : base de la réconciliation.
-- 4. Échange de produits défectueux entre le commercial et le magasin.
-- 5. Fiche de réconciliation (stock + argent), justification par le
--    commercial, double validation : responsable de caisse puis comptable.
-- 6. Dettes des commerciaux (historique : dette, remboursement, annulation).
-- 7. Écritures comptables enregistrées automatiquement aux validations.
-- À exécuter dans l'éditeur SQL de Supabase.

-- ===========================================================================
-- 1. Paramètres
-- ===========================================================================
alter table entreprises add column if not exists compte_racine_commerciaux text not null default '471';
alter table entreprises add column if not exists valorisation_manquant text not null default 'prix_vente';
alter table entreprises drop constraint if exists entreprises_valorisation_manquant_check;
alter table entreprises add constraint entreprises_valorisation_manquant_check
  check (valorisation_manquant in ('prix_vente', 'prix_revient'));
alter table entreprises add column if not exists compte_ventes_numero text not null default '701';
alter table entreprises add column if not exists compte_stock_numero text not null default '31';
alter table entreprises add column if not exists compte_pertes_numero text not null default '658';
alter table entreprises add column if not exists compte_caisse_defaut_numero text not null default '571';
alter table entreprises add column if not exists compte_clients_numero text not null default '411';

create or replace function modifier_parametres_reconciliation(
  p_racine text, p_valorisation text, p_ventes text, p_stock text, p_pertes text, p_caisse text, p_clients text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_entreprise_id() is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if current_role_utilisateur() <> 'admin' then raise exception 'seul un administrateur peut modifier ces paramètres'; end if;
  if p_valorisation not in ('prix_vente', 'prix_revient') then raise exception 'valorisation invalide'; end if;
  if coalesce(trim(p_racine), '') !~ '^[0-9]{2,8}$' then raise exception 'racine de compte invalide (chiffres uniquement)'; end if;
  update entreprises set
    compte_racine_commerciaux = trim(p_racine),
    valorisation_manquant = p_valorisation,
    compte_ventes_numero = coalesce(nullif(trim(p_ventes), ''), '701'),
    compte_stock_numero = coalesce(nullif(trim(p_stock), ''), '31'),
    compte_pertes_numero = coalesce(nullif(trim(p_pertes), ''), '658'),
    compte_caisse_defaut_numero = coalesce(nullif(trim(p_caisse), ''), '571'),
    compte_clients_numero = coalesce(nullif(trim(p_clients), ''), '411')
  where id = current_entreprise_id();
end;
$$;

-- ===========================================================================
-- 2. Sous-compte comptable de chaque commercial
-- ===========================================================================
alter table profils add column if not exists compte_tiers_numero text;

create or replace function assurer_compte_commercial(p_commercial_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid;
  v_numero text;
  v_nom text;
  v_racine text;
  v_rang integer := 1;
begin
  select entreprise_id, compte_tiers_numero, nom into v_entreprise_id, v_numero, v_nom
  from profils where id = p_commercial_id;
  if v_entreprise_id is null then raise exception 'commercial introuvable'; end if;
  if v_numero is not null then return v_numero; end if;

  select compte_racine_commerciaux into v_racine from entreprises where id = v_entreprise_id;
  loop
    v_numero := v_racine || lpad(v_rang::text, 3, '0');
    exit when not exists (select 1 from plan_comptable where entreprise_id = v_entreprise_id and numero_compte = v_numero)
          and not exists (select 1 from profils where entreprise_id = v_entreprise_id and compte_tiers_numero = v_numero);
    v_rang := v_rang + 1;
  end loop;

  insert into plan_comptable (entreprise_id, numero_compte, libelle)
  values (v_entreprise_id, v_numero, 'Débiteur — ' || coalesce(v_nom, 'commercial'))
  on conflict (entreprise_id, numero_compte) do nothing;
  update profils set compte_tiers_numero = v_numero where id = p_commercial_id;
  return v_numero;
end;
$$;

-- ===========================================================================
-- 3. Journal des mouvements du stock des commerciaux
-- ===========================================================================
create table if not exists mouvements_stock_commercial (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id),
  commercial_id uuid not null references profils(id),
  produit_id uuid not null references produits(id),
  type text not null check (type in ('sortie', 'vente', 'retour', 'echange', 'ajustement', 'autre')),
  delta integer not null,
  quantite_apres integer not null,
  effectue_par uuid references profils(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_msc_commercial_date on mouvements_stock_commercial (commercial_id, created_at);

alter table mouvements_stock_commercial enable row level security;
drop policy if exists msc_select on mouvements_stock_commercial;
create policy msc_select on mouvements_stock_commercial
  for select using (
    entreprise_id = current_entreprise_id()
    and (current_role_utilisateur() in ('admin', 'manager', 'comptable', 'gestionnaire_stock') or commercial_id = auth.uid())
  );

-- Les opérations qui précèdent la mise à jour du stock du commercial dans la
-- même transaction annoncent leur nature (vente, retour).
create or replace function signaler_operation_vente()
returns trigger language plpgsql as $$
begin
  perform set_config('distribpro.op_sc', 'vente', true);
  return new;
end;
$$;
drop trigger if exists trg_signaler_operation_vente on ventes_lignes;
create trigger trg_signaler_operation_vente after insert on ventes_lignes
  for each row execute function signaler_operation_vente();

create or replace function signaler_operation_retour()
returns trigger language plpgsql as $$
begin
  if new.quantite_retournee is distinct from old.quantite_retournee then
    perform set_config('distribpro.op_sc', 'retour', true);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_signaler_operation_retour on sortie_stock_lignes;
create trigger trg_signaler_operation_retour after update on sortie_stock_lignes
  for each row execute function signaler_operation_retour();

create or replace function journaliser_stock_commercial()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_delta integer := new.quantite - coalesce(case when tg_op = 'UPDATE' then old.quantite end, 0);
  v_op text := nullif(current_setting('distribpro.op_sc', true), '');
begin
  if v_delta = 0 then return new; end if;
  insert into mouvements_stock_commercial (entreprise_id, commercial_id, produit_id, type, delta, quantite_apres, effectue_par)
  values (new.entreprise_id, new.commercial_id, new.produit_id,
          coalesce(v_op, case when v_delta > 0 then 'sortie' else 'autre' end),
          v_delta, new.quantite, auth.uid());
  return new;
end;
$$;
drop trigger if exists trg_journaliser_stock_commercial on stock_commercial;
create trigger trg_journaliser_stock_commercial after insert or update on stock_commercial
  for each row execute function journaliser_stock_commercial();

-- ===========================================================================
-- 4. Échange de produits défectueux (au guichet du magasin)
-- ===========================================================================
create table if not exists echanges_defectueux (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id),
  commercial_id uuid not null references profils(id),
  depot_id uuid not null references depots(id),
  produit_id uuid not null references produits(id),
  quantite integer not null check (quantite > 0),
  motif text not null,
  lot_defectueux_id uuid references lots(id),
  justificatif_chemin text,
  effectue_par uuid references profils(id),
  created_at timestamptz not null default now()
);
alter table echanges_defectueux enable row level security;
drop policy if exists echanges_defectueux_select on echanges_defectueux;
create policy echanges_defectueux_select on echanges_defectueux
  for select using (
    entreprise_id = current_entreprise_id()
    and (current_role_utilisateur() in ('admin', 'manager', 'comptable', 'gestionnaire_stock') or commercial_id = auth.uid())
  );

create or replace function echanger_produits_defectueux(
  p_commercial_id uuid, p_depot_id uuid, p_produit_id uuid, p_quantite integer, p_motif text, p_justificatif_chemin text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_en_main integer;
  v_stock_depot integer;
  v_lot_id uuid;
  v_echange_id uuid;
  v_nom text;
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : l''échange se fait au magasin';
  end if;
  if not mon_depot_autorise(p_depot_id) then raise exception 'accès refusé : ce dépôt ne vous est pas attribué'; end if;
  if p_quantite is null or p_quantite <= 0 then raise exception 'quantité invalide'; end if;
  if coalesce(length(trim(p_motif)), 0) < 3 then raise exception 'le motif est obligatoire'; end if;

  select quantite into v_en_main from stock_commercial
  where commercial_id = p_commercial_id and produit_id = p_produit_id and entreprise_id = v_entreprise_id;
  if coalesce(v_en_main, 0) < p_quantite then
    raise exception 'le commercial n''a que % unité(s) de ce produit en main', coalesce(v_en_main, 0);
  end if;
  select quantite into v_stock_depot from stocks
  where produit_id = p_produit_id and depot_id = p_depot_id and entreprise_id = v_entreprise_id for update;
  if coalesce(v_stock_depot, 0) < p_quantite then
    raise exception 'stock en bon état insuffisant au magasin pour l''échange (% disponible)', coalesce(v_stock_depot, 0);
  end if;
  select nom into v_nom from profils where id = p_commercial_id;

  -- Le magasin donne des produits sains (lots en bon état consommés en
  -- premier) et reçoit les défectueux dans un lot « endommagé » : la
  -- quantité totale du magasin ne change pas, celle du commercial non plus.
  perform consommer_lots_fifo(p_produit_id, p_depot_id, p_quantite);
  insert into lots (entreprise_id, produit_id, depot_id, numero_lot, quantite_initiale, quantite_restante, created_by, etat, etat_motif, etat_modifie_par, etat_modifie_at)
  values (v_entreprise_id, p_produit_id, p_depot_id,
          'DEFECTUEUX-' || to_char(now() at time zone 'Africa/Abidjan', 'YYYYMMDD-HH24MISS'),
          p_quantite, p_quantite, auth.uid(), 'endommage', 'Échange commercial : ' || trim(p_motif), auth.uid(), now())
  returning id into v_lot_id;

  insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par, reference_doc)
  values (v_entreprise_id, p_produit_id, p_depot_id, 'sortie', p_quantite, 'Échange défectueux — produits sains remis à ' || coalesce(v_nom, 'commercial'), auth.uid(), p_justificatif_chemin),
         (v_entreprise_id, p_produit_id, p_depot_id, 'entree', p_quantite, 'Échange défectueux — produits abîmés repris de ' || coalesce(v_nom, 'commercial') || ' : ' || trim(p_motif), auth.uid(), p_justificatif_chemin);

  insert into echanges_defectueux (entreprise_id, commercial_id, depot_id, produit_id, quantite, motif, lot_defectueux_id, justificatif_chemin, effectue_par)
  values (v_entreprise_id, p_commercial_id, p_depot_id, p_produit_id, p_quantite, trim(p_motif), v_lot_id, p_justificatif_chemin, auth.uid())
  returning id into v_echange_id;
  return v_echange_id;
end;
$$;

-- ===========================================================================
-- 5. Écritures comptables enregistrées
-- ===========================================================================
create table if not exists ecritures_comptables (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id),
  date_ecriture date not null,
  journal text not null,
  piece text,
  compte text not null,
  libelle text not null,
  debit numeric(14, 2) not null default 0,
  credit numeric(14, 2) not null default 0,
  source_type text not null,
  source_id uuid,
  created_by uuid references profils(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_ecritures_entreprise_date on ecritures_comptables (entreprise_id, date_ecriture);
alter table ecritures_comptables enable row level security;
drop policy if exists ecritures_select on ecritures_comptables;
create policy ecritures_select on ecritures_comptables
  for select using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager', 'comptable')
  );

create or replace function passer_ecriture(
  p_entreprise_id uuid, p_date date, p_journal text, p_piece text,
  p_compte_debit text, p_compte_credit text, p_libelle text, p_montant numeric,
  p_source_type text, p_source_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(p_montant, 0) <= 0 then return; end if;
  insert into ecritures_comptables (entreprise_id, date_ecriture, journal, piece, compte, libelle, debit, credit, source_type, source_id, created_by)
  values (p_entreprise_id, p_date, p_journal, p_piece, p_compte_debit, p_libelle, round(p_montant, 2), 0, p_source_type, p_source_id, auth.uid()),
         (p_entreprise_id, p_date, p_journal, p_piece, p_compte_credit, p_libelle, 0, round(p_montant, 2), p_source_type, p_source_id, auth.uid());
end;
$$;
revoke execute on function passer_ecriture(uuid, date, text, text, text, text, text, numeric, text, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 6. Dettes des commerciaux
-- ===========================================================================
alter table versements_caisse add column if not exists nature text not null default 'recette';
alter table versements_caisse drop constraint if exists versements_caisse_nature_check;
alter table versements_caisse add constraint versements_caisse_nature_check check (nature in ('recette', 'remboursement_dette'));

create table if not exists dettes_commerciaux (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id),
  commercial_id uuid not null references profils(id),
  type text not null check (type in ('dette', 'remboursement', 'annulation')),
  montant numeric(14, 2) not null check (montant > 0),
  motif text,
  reconciliation_id uuid,
  versement_id uuid references versements_caisse(id),
  effectue_par uuid references profils(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_dettes_commercial on dettes_commerciaux (commercial_id, created_at);
alter table dettes_commerciaux enable row level security;
drop policy if exists dettes_select on dettes_commerciaux;
create policy dettes_select on dettes_commerciaux
  for select using (
    entreprise_id = current_entreprise_id()
    and (current_role_utilisateur() in ('admin', 'manager', 'comptable') or commercial_id = auth.uid())
  );

create or replace function solde_dette_commercial(p_commercial_id uuid)
returns numeric
language sql
security definer
stable
set search_path to 'public'
as $$
  select coalesce(sum(case when type = 'dette' then montant else -montant end), 0)
  from dettes_commerciaux
  where commercial_id = p_commercial_id and entreprise_id = current_entreprise_id();
$$;

create or replace function enregistrer_remboursement_dette(p_commercial_id uuid, p_caisse_id uuid, p_montant numeric, p_motif text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_solde numeric;
  v_versement_id uuid;
  v_compte_tiers text;
  v_compte_caisse text;
  v_nom text;
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;
  if p_montant is null or p_montant <= 0 then raise exception 'montant invalide'; end if;
  v_solde := solde_dette_commercial(p_commercial_id);
  if p_montant > v_solde then raise exception 'le remboursement (%) dépasse la dette restante (%)', p_montant, v_solde; end if;

  perform 1 from caisses where id = p_caisse_id and entreprise_id = v_entreprise_id and actif = true;
  if not found then raise exception 'caisse introuvable ou inactive'; end if;

  insert into versements_caisse (entreprise_id, commercial_id, caisse_id, montant, date_versement, recu_par, nature)
  values (v_entreprise_id, p_commercial_id, p_caisse_id, p_montant, current_date, auth.uid(), 'remboursement_dette')
  returning id into v_versement_id;

  insert into dettes_commerciaux (entreprise_id, commercial_id, type, montant, motif, versement_id, effectue_par)
  values (v_entreprise_id, p_commercial_id, 'remboursement', p_montant, coalesce(nullif(trim(p_motif), ''), 'Remboursement en caisse'), v_versement_id, auth.uid());

  v_compte_tiers := assurer_compte_commercial(p_commercial_id);
  select coalesce(pc.numero_compte, e.compte_caisse_defaut_numero) into v_compte_caisse
  from caisses c join entreprises e on e.id = c.entreprise_id left join plan_comptable pc on pc.id = c.compte_comptable_id
  where c.id = p_caisse_id;
  select nom into v_nom from profils where id = p_commercial_id;
  perform passer_ecriture(v_entreprise_id, current_date, 'CA', null, v_compte_caisse, v_compte_tiers,
                          'Remboursement dette — ' || coalesce(v_nom, ''), p_montant, 'remboursement_dette', v_versement_id);
  return v_versement_id;
end;
$$;

create or replace function annuler_dette_commercial(p_commercial_id uuid, p_montant numeric, p_motif text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_nom text;
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if current_role_utilisateur() <> 'admin' then raise exception 'seul un administrateur peut annuler une dette'; end if;
  if coalesce(length(trim(p_motif)), 0) < 3 then raise exception 'le motif est obligatoire'; end if;
  if p_montant is null or p_montant <= 0 or p_montant > solde_dette_commercial(p_commercial_id) then
    raise exception 'montant invalide';
  end if;
  insert into dettes_commerciaux (entreprise_id, commercial_id, type, montant, motif, effectue_par)
  values (v_entreprise_id, p_commercial_id, 'annulation', p_montant, trim(p_motif), auth.uid());
  select nom into v_nom from profils where id = p_commercial_id;
  perform passer_ecriture(v_entreprise_id, current_date, 'OD', null,
                          (select compte_pertes_numero from entreprises where id = v_entreprise_id),
                          assurer_compte_commercial(p_commercial_id),
                          'Abandon de dette — ' || coalesce(v_nom, '') || ' : ' || trim(p_motif), p_montant, 'annulation_dette', null);
end;
$$;

-- ===========================================================================
-- 7. Fiches de réconciliation
-- ===========================================================================
create table if not exists reconciliations_commercial (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id),
  numero text not null,
  commercial_id uuid not null references profils(id),
  date_debut date not null,
  date_fin date not null,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'validee_caisse', 'validee', 'annulee')),
  ventes_comptant numeric(14, 2) not null default 0,
  recouvrements numeric(14, 2) not null default 0,
  montant_du numeric(14, 2) not null default 0,
  montant_verse numeric(14, 2) not null default 0,
  ecart_argent numeric(14, 2) not null default 0,
  valeur_manquant numeric(14, 2) not null default 0,
  valorisation text not null,
  justification text,
  justification_chemin text,
  justifie_par uuid references profils(id),
  justifie_at timestamptz,
  decision_argent text check (decision_argent in ('dette', 'perte')),
  decision_manquant text check (decision_manquant in ('dette', 'perte')),
  montant_dette numeric(14, 2),
  commentaire_comptable text,
  cree_par uuid references profils(id),
  created_at timestamptz not null default now(),
  valide_caisse_par uuid references profils(id),
  valide_caisse_at timestamptz,
  valide_comptable_par uuid references profils(id),
  valide_comptable_at timestamptz,
  check (date_fin >= date_debut)
);
create index if not exists idx_reconciliations_commercial on reconciliations_commercial (commercial_id, date_debut);

create table if not exists reconciliation_lignes (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references reconciliations_commercial(id) on delete cascade,
  produit_id uuid not null references produits(id),
  stock_debut integer not null,
  sorties integer not null default 0,
  ventes integer not null default 0,
  retours integer not null default 0,
  autres integer not null default 0,
  stock_theorique integer not null,
  stock_compte integer not null,
  ecart integer not null default 0,
  prix_valorisation numeric(14, 2) not null default 0,
  valeur_ecart numeric(14, 2) not null default 0
);

alter table reconciliations_commercial enable row level security;
alter table reconciliation_lignes enable row level security;
drop policy if exists reconciliations_select on reconciliations_commercial;
create policy reconciliations_select on reconciliations_commercial
  for select using (
    entreprise_id = current_entreprise_id()
    and (current_role_utilisateur() in ('admin', 'manager', 'comptable')
         or commercial_id = auth.uid()
         or exists (select 1 from caisses c where c.entreprise_id = current_entreprise_id() and c.responsable_id = auth.uid()))
  );
drop policy if exists reconciliation_lignes_select on reconciliation_lignes;
create policy reconciliation_lignes_select on reconciliation_lignes
  for select using (exists (select 1 from reconciliations_commercial r where r.id = reconciliation_id));

-- Qui peut préparer / valider côté caisse : direction, comptable, ou
-- responsable d'une caisse.
create or replace function peut_valider_caisse()
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $$
  select current_role_utilisateur() in ('admin', 'manager', 'comptable')
      or exists (select 1 from caisses where entreprise_id = current_entreprise_id() and responsable_id = auth.uid() and actif);
$$;

-- Calcule (ou recalcule) les totaux et l'écart d'une fiche.
create or replace function recalculer_reconciliation(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update reconciliation_lignes set
    ecart = stock_theorique - stock_compte,
    valeur_ecart = round((stock_theorique - stock_compte) * prix_valorisation, 2)
  where reconciliation_id = p_id;
  update reconciliations_commercial r set
    ecart_argent = r.montant_du - r.montant_verse,
    valeur_manquant = coalesce((select sum(greatest(valeur_ecart, 0)) from reconciliation_lignes where reconciliation_id = p_id), 0)
  where r.id = p_id;
end;
$$;

create or replace function preparer_reconciliation(p_commercial_id uuid, p_date_debut date, p_date_fin date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_valorisation text;
  v_id uuid;
  v_numero text;
  v_debut timestamptz := (p_date_debut::timestamp at time zone 'Africa/Abidjan');
  v_fin timestamptz := ((p_date_fin + 1)::timestamp at time zone 'Africa/Abidjan');
  v_ventes numeric;
  v_recouvrements numeric;
  v_verse numeric;
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if not peut_valider_caisse() then raise exception 'accès refusé : seuls la caisse, le comptable et la direction préparent une réconciliation'; end if;
  if p_date_fin < p_date_debut then raise exception 'la date de fin doit suivre la date de début'; end if;
  if p_date_fin > (now() at time zone 'Africa/Abidjan')::date then raise exception 'la période ne peut pas finir dans le futur'; end if;
  perform 1 from profils where id = p_commercial_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'commercial introuvable'; end if;
  if exists (
    select 1 from reconciliations_commercial
    where commercial_id = p_commercial_id and statut <> 'annulee'
      and daterange(date_debut, date_fin, '[]') && daterange(p_date_debut, p_date_fin, '[]')
  ) then
    raise exception 'une réconciliation existe déjà pour ce commercial sur une partie de cette période';
  end if;

  select valorisation_manquant into v_valorisation from entreprises where id = v_entreprise_id;

  select coalesce(sum(montant_regle), 0) into v_ventes from ventes
  where entreprise_id = v_entreprise_id and commercial_id = p_commercial_id and mode_paiement = 'cash'
    and coalesce(statut, '') <> 'annulee' and created_at >= v_debut and created_at < v_fin;
  select coalesce(sum(montant), 0) into v_recouvrements from reglements
  where entreprise_id = v_entreprise_id and commercial_id = p_commercial_id and created_at >= v_debut and created_at < v_fin;
  select coalesce(sum(montant), 0) into v_verse from versements_caisse
  where entreprise_id = v_entreprise_id and commercial_id = p_commercial_id and nature = 'recette'
    and date_versement between p_date_debut and p_date_fin;

  select 'REC-' || to_char(p_date_fin, 'YYYY') || '-' || lpad((count(*) + 1)::text, 5, '0') into v_numero
  from reconciliations_commercial where entreprise_id = v_entreprise_id and to_char(date_fin, 'YYYY') = to_char(p_date_fin, 'YYYY');

  insert into reconciliations_commercial (entreprise_id, numero, commercial_id, date_debut, date_fin, valorisation,
    ventes_comptant, recouvrements, montant_du, montant_verse, cree_par)
  values (v_entreprise_id, v_numero, p_commercial_id, p_date_debut, p_date_fin, v_valorisation,
    v_ventes, v_recouvrements, v_ventes + v_recouvrements, v_verse, auth.uid())
  returning id into v_id;

  -- Stock : pour chaque produit détenu ou mouvementé, stock au début (stock
  -- actuel moins les mouvements survenus depuis), mouvements de la période,
  -- stock théorique à la fin. Le stock compté vaut au départ le théorique,
  -- puis est saisi après comptage.
  insert into reconciliation_lignes (reconciliation_id, produit_id, stock_debut, sorties, ventes, retours, autres, stock_theorique, stock_compte, prix_valorisation)
  select v_id, p.produit_id,
    p.actuel - p.depuis_debut,
    p.sorties, p.ventes, p.retours, p.autres,
    p.actuel - p.depuis_debut + p.periode,
    p.actuel - p.depuis_debut + p.periode,
    case when v_valorisation = 'prix_revient' then coalesce(pc.prix_achat_moyen, pr.prix_vente, 0) else coalesce(pr.prix_vente, 0) end
  from (
    select x.produit_id,
      coalesce((select quantite from stock_commercial sc where sc.commercial_id = p_commercial_id and sc.produit_id = x.produit_id), 0) as actuel,
      coalesce(sum(m.delta) filter (where m.created_at >= v_debut), 0) as depuis_debut,
      coalesce(sum(m.delta) filter (where m.created_at >= v_debut and m.created_at < v_fin), 0) as periode,
      coalesce(sum(m.delta) filter (where m.type = 'sortie' and m.created_at >= v_debut and m.created_at < v_fin), 0) as sorties,
      coalesce(-sum(m.delta) filter (where m.type = 'vente' and m.created_at >= v_debut and m.created_at < v_fin), 0) as ventes,
      coalesce(-sum(m.delta) filter (where m.type = 'retour' and m.created_at >= v_debut and m.created_at < v_fin), 0) as retours,
      coalesce(sum(m.delta) filter (where m.type not in ('sortie', 'vente', 'retour') and m.created_at >= v_debut and m.created_at < v_fin), 0) as autres
    from (
      select produit_id from stock_commercial where commercial_id = p_commercial_id and quantite <> 0
      union
      select produit_id from mouvements_stock_commercial where commercial_id = p_commercial_id and created_at >= v_debut
    ) x
    left join mouvements_stock_commercial m on m.commercial_id = p_commercial_id and m.produit_id = x.produit_id
    group by x.produit_id
  ) p
  join produits pr on pr.id = p.produit_id
  left join produits_couts pc on pc.produit_id = p.produit_id;

  perform recalculer_reconciliation(v_id);
  return v_id;
end;
$$;

create or replace function saisir_comptage_reconciliation(p_id uuid, p_lignes jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ligne jsonb;
begin
  if not peut_valider_caisse() then raise exception 'accès refusé'; end if;
  perform 1 from reconciliations_commercial where id = p_id and entreprise_id = current_entreprise_id() and statut = 'brouillon';
  if not found then raise exception 'fiche introuvable ou déjà validée'; end if;
  for v_ligne in select * from jsonb_array_elements(p_lignes) loop
    if (v_ligne->>'stock_compte')::integer < 0 then raise exception 'quantité comptée invalide'; end if;
    update reconciliation_lignes set stock_compte = (v_ligne->>'stock_compte')::integer
    where reconciliation_id = p_id and produit_id = (v_ligne->>'produit_id')::uuid;
  end loop;
  perform recalculer_reconciliation(p_id);
end;
$$;

-- Le commercial (ou la direction) explique les écarts avant validation.
create or replace function justifier_reconciliation(p_id uuid, p_texte text, p_chemin text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_r record;
begin
  select * into v_r from reconciliations_commercial where id = p_id and entreprise_id = current_entreprise_id();
  if not found then raise exception 'fiche introuvable'; end if;
  if v_r.statut not in ('brouillon', 'validee_caisse') then raise exception 'fiche déjà clôturée'; end if;
  if auth.uid() <> v_r.commercial_id and current_role_utilisateur() not in ('admin', 'manager') then
    raise exception 'seul le commercial concerné peut justifier sa fiche';
  end if;
  if coalesce(length(trim(p_texte)), 0) < 3 then raise exception 'la justification est vide'; end if;
  update reconciliations_commercial
  set justification = trim(p_texte), justification_chemin = coalesce(p_chemin, justification_chemin),
      justifie_par = auth.uid(), justifie_at = now()
  where id = p_id;
end;
$$;

-- Étape 1 : la caisse valide l'encaissement → écritures de la période.
create or replace function valider_reconciliation_caisse(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_r record;
  v_e record;
  v_compte text;
  v_nom text;
  v_v record;
begin
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if not peut_valider_caisse() then raise exception 'accès refusé : validation réservée à la caisse'; end if;
  select * into v_r from reconciliations_commercial where id = p_id and entreprise_id = current_entreprise_id() for update;
  if not found or v_r.statut <> 'brouillon' then raise exception 'fiche introuvable ou déjà validée par la caisse'; end if;
  if v_r.commercial_id = auth.uid() then raise exception 'vous ne pouvez pas valider votre propre fiche'; end if;

  perform recalculer_reconciliation(p_id);
  select * into v_r from reconciliations_commercial where id = p_id;
  select * into v_e from entreprises where id = v_r.entreprise_id;
  v_compte := assurer_compte_commercial(v_r.commercial_id);
  select nom into v_nom from profils where id = v_r.commercial_id;

  perform passer_ecriture(v_r.entreprise_id, v_r.date_fin, 'OD', v_r.numero, v_compte, v_e.compte_ventes_numero,
                          'Ventes comptant encaissées par ' || coalesce(v_nom, ''), v_r.ventes_comptant, 'reconciliation', p_id);
  perform passer_ecriture(v_r.entreprise_id, v_r.date_fin, 'OD', v_r.numero, v_compte, v_e.compte_clients_numero,
                          'Recouvrements encaissés par ' || coalesce(v_nom, ''), v_r.recouvrements, 'reconciliation', p_id);
  for v_v in
    select vc.id, vc.numero, vc.montant, vc.date_versement, coalesce(pc.numero_compte, v_e.compte_caisse_defaut_numero) as compte_caisse
    from versements_caisse vc
    join caisses c on c.id = vc.caisse_id
    left join plan_comptable pc on pc.id = c.compte_comptable_id
    where vc.entreprise_id = v_r.entreprise_id and vc.commercial_id = v_r.commercial_id and vc.nature = 'recette'
      and vc.date_versement between v_r.date_debut and v_r.date_fin
  loop
    perform passer_ecriture(v_r.entreprise_id, v_v.date_versement, 'CA', coalesce(v_v.numero, v_r.numero), v_v.compte_caisse, v_compte,
                            'Versement de ' || coalesce(v_nom, ''), v_v.montant, 'reconciliation', p_id);
  end loop;

  update reconciliations_commercial set statut = 'validee_caisse', valide_caisse_par = auth.uid(), valide_caisse_at = now() where id = p_id;
end;
$$;

-- Étape 2 : le comptable décide du sort des écarts et clôture.
create or replace function valider_reconciliation_comptable(p_id uuid, p_decision_argent text, p_decision_manquant text, p_commentaire text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_r record;
  v_e record;
  v_compte text;
  v_nom text;
  v_dette numeric := 0;
  v_l record;
begin
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'comptable') then raise exception 'validation réservée au comptable'; end if;
  select * into v_r from reconciliations_commercial where id = p_id and entreprise_id = current_entreprise_id() for update;
  if not found or v_r.statut <> 'validee_caisse' then raise exception 'la fiche doit d''abord être validée par la caisse'; end if;
  if v_r.commercial_id = auth.uid() then raise exception 'vous ne pouvez pas valider votre propre fiche'; end if;
  if v_r.valide_caisse_par = auth.uid() and current_role_utilisateur() <> 'admin' then
    raise exception 'séparation des tâches : la validation comptable doit être faite par une autre personne que la caisse';
  end if;
  if v_r.ecart_argent > 0 and p_decision_argent not in ('dette', 'perte') then raise exception 'choisissez le traitement de l''écart d''argent'; end if;
  if v_r.valeur_manquant > 0 and p_decision_manquant not in ('dette', 'perte') then raise exception 'choisissez le traitement du manquant de stock'; end if;
  if (p_decision_argent = 'perte' or p_decision_manquant = 'perte') and coalesce(length(trim(p_commentaire)), 0) < 3 then
    raise exception 'passer un écart en perte demande un commentaire';
  end if;

  select * into v_e from entreprises where id = v_r.entreprise_id;
  v_compte := assurer_compte_commercial(v_r.commercial_id);
  select nom into v_nom from profils where id = v_r.commercial_id;

  -- Écart d'argent : déjà porté par le compte du commercial (ventes et
  -- recouvrements au débit, versements au crédit). En perte, on le solde.
  if v_r.ecart_argent > 0 then
    if p_decision_argent = 'dette' then
      v_dette := v_dette + v_r.ecart_argent;
    else
      perform passer_ecriture(v_r.entreprise_id, v_r.date_fin, 'OD', v_r.numero, v_e.compte_pertes_numero, v_compte,
                              'Écart de versement passé en perte — ' || coalesce(v_nom, ''), v_r.ecart_argent, 'reconciliation', p_id);
    end if;
  end if;

  -- Manquant de stock : à la charge du commercial (dette) ou en perte.
  if v_r.valeur_manquant > 0 then
    perform passer_ecriture(v_r.entreprise_id, v_r.date_fin, 'OD', v_r.numero,
                            case when p_decision_manquant = 'dette' then v_compte else v_e.compte_pertes_numero end,
                            v_e.compte_stock_numero,
                            'Manquant de stock — ' || coalesce(v_nom, ''), v_r.valeur_manquant, 'reconciliation', p_id);
    if p_decision_manquant = 'dette' then v_dette := v_dette + v_r.valeur_manquant; end if;
  end if;

  if v_dette > 0 then
    insert into dettes_commerciaux (entreprise_id, commercial_id, type, montant, motif, reconciliation_id, effectue_par)
    values (v_r.entreprise_id, v_r.commercial_id, 'dette', v_dette, 'Réconciliation ' || v_r.numero, p_id, auth.uid());
  end if;

  -- Le stock du commercial est aligné sur le stock compté.
  perform set_config('distribpro.op_sc', 'ajustement', true);
  for v_l in select produit_id, ecart from reconciliation_lignes where reconciliation_id = p_id and ecart <> 0 loop
    update stock_commercial set quantite = greatest(quantite - v_l.ecart, 0), updated_at = now()
    where commercial_id = v_r.commercial_id and produit_id = v_l.produit_id;
  end loop;
  perform set_config('distribpro.op_sc', '', true);

  update reconciliations_commercial set
    statut = 'validee', decision_argent = case when v_r.ecart_argent > 0 then p_decision_argent end,
    decision_manquant = case when v_r.valeur_manquant > 0 then p_decision_manquant end,
    montant_dette = v_dette, commentaire_comptable = nullif(trim(coalesce(p_commentaire, '')), ''),
    valide_comptable_par = auth.uid(), valide_comptable_at = now()
  where id = p_id;
end;
$$;

create or replace function annuler_reconciliation(p_id uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not peut_valider_caisse() then raise exception 'accès refusé'; end if;
  if coalesce(length(trim(p_motif)), 0) < 3 then raise exception 'le motif est obligatoire'; end if;
  update reconciliations_commercial
  set statut = 'annulee', commentaire_comptable = 'Annulée : ' || trim(p_motif)
  where id = p_id and entreprise_id = current_entreprise_id() and statut = 'brouillon';
  if not found then raise exception 'seule une fiche non encore validée peut être annulée'; end if;
end;
$$;

-- Les remboursements de dette ne doivent pas diminuer le « reste à verser »
-- du jour affiché sur le tableau de bord : on ne compte que les recettes.
create or replace function versements_en_cours()
returns table (
  ventes_cash_commerciaux numeric,
  recouvrement_commerciaux numeric,
  ventes_cash_bureau numeric,
  recouvrement_bureau numeric,
  deja_verse numeric,
  reste_a_verser numeric
)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_aujourdhui date := current_date;
  v_ventes_cash_commerciaux numeric;
  v_ventes_cash_bureau numeric;
  v_recouvrement_commerciaux numeric;
  v_recouvrement_bureau numeric;
  v_deja_verse numeric;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé';
  end if;

  select coalesce(sum(montant_regle), 0) into v_ventes_cash_commerciaux
  from ventes
  where entreprise_id = v_entreprise_id
    and mode_paiement = 'cash'
    and statut <> 'annulee'
    and commercial_id is not null
    and created_at::date = v_aujourdhui;

  select coalesce(sum(montant_regle), 0) into v_ventes_cash_bureau
  from ventes
  where entreprise_id = v_entreprise_id
    and mode_paiement = 'cash'
    and statut <> 'annulee'
    and commercial_id is null
    and created_at::date = v_aujourdhui;

  select coalesce(sum(montant), 0) into v_recouvrement_commerciaux
  from reglements
  where entreprise_id = v_entreprise_id
    and commercial_id is not null
    and created_at::date = v_aujourdhui;

  select coalesce(sum(montant), 0) into v_recouvrement_bureau
  from reglements
  where entreprise_id = v_entreprise_id
    and commercial_id is null
    and created_at::date = v_aujourdhui;

  select coalesce(sum(montant), 0) into v_deja_verse
  from versements_caisse
  where entreprise_id = v_entreprise_id
    and nature = 'recette'
    and date_versement = v_aujourdhui;

  return query select
    v_ventes_cash_commerciaux,
    v_recouvrement_commerciaux,
    v_ventes_cash_bureau,
    v_recouvrement_bureau,
    v_deja_verse,
    (v_ventes_cash_commerciaux + v_recouvrement_commerciaux + v_ventes_cash_bureau + v_recouvrement_bureau) - v_deja_verse;
end;
$$;

notify pgrst, 'reload schema';
