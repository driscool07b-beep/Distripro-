-- Migration : journal de caisse (entrées/sorties) avec workflow de
-- validation des décaissements.
--
-- Entrées : réutilise versements_caisse (déjà existant — dépôts des
-- commerciaux). Sorties : nouvelle table demandes_decaissement, avec
-- un cycle de vie : en_attente → validée/refusée (par un rôle
-- autorisé, avec possibilité de réduire le montant) → payée
-- (écriture de caisse effective + bon de caisse imprimable).
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Paramétrage par entreprise
-- ---------------------------------------------------------------------
alter table entreprises add column if not exists caisse_seuil_validation numeric(14,2);
-- NULL = tout décaissement doit être validé, quel que soit le montant.
-- Une valeur = seuil au-dessus duquel une validation humaine est requise
-- (en dessous, la demande est auto-validée à la création).

alter table entreprises add column if not exists caisse_roles_validateurs text[] not null default array['admin', 'manager'];
-- Rôles autorisés à valider une demande de décaissement.

-- ---------------------------------------------------------------------
-- 2. Table des demandes de décaissement
-- ---------------------------------------------------------------------
create table if not exists demandes_decaissement (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  caisse_id uuid not null references caisses(id),
  libelle text not null,
  montant_demande numeric(14,2) not null check (montant_demande > 0),
  piece_justificative_path text,
  piece_justificative_nom text,
  demande_par uuid not null references profils(id),
  statut text not null default 'en_attente' check (statut in ('en_attente', 'validee', 'refusee', 'payee')),
  montant_valide numeric(14,2),
  valide_par uuid references profils(id),
  valide_at timestamptz,
  motif_refus text,
  payee_par uuid references profils(id),
  payee_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_demandes_decaissement_entreprise on demandes_decaissement(entreprise_id);
create index if not exists idx_demandes_decaissement_caisse on demandes_decaissement(caisse_id);
create index if not exists idx_demandes_decaissement_statut on demandes_decaissement(statut);

alter table demandes_decaissement enable row level security;

drop policy if exists demandes_decaissement_select on demandes_decaissement;
create policy demandes_decaissement_select on demandes_decaissement
  for select using (entreprise_id = current_entreprise_id());

-- Les écritures passent par les fonctions ci-dessous (contrôle des
-- rôles/seuils centralisé, pas de policy d'écriture directe).

-- ---------------------------------------------------------------------
-- 3. Solde de caisse : entrées (versements) − sorties payées.
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
    - coalesce((select sum(montant_valide) from demandes_decaissement where caisse_id = p_caisse_id and statut = 'payee'), 0);
$$;

-- ---------------------------------------------------------------------
-- 4. Créer une demande de décaissement — auto-validée si sous le seuil
--    configuré (sinon reste en_attente jusqu'à validation humaine).
-- ---------------------------------------------------------------------
create or replace function creer_demande_decaissement(
  p_caisse_id uuid,
  p_libelle text,
  p_montant numeric,
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
    -- valide_par reste NULL : auto-validée sous le seuil, aucun
    -- validateur humain n'est intervenu — distingue clairement ce cas
    -- d'une vraie validation manuelle dans l'historique.
  end if;

  insert into demandes_decaissement (
    entreprise_id, caisse_id, libelle, montant_demande,
    piece_justificative_path, piece_justificative_nom, demande_par,
    statut, montant_valide, valide_at
  )
  values (
    v_entreprise_id, p_caisse_id, trim(p_libelle), p_montant,
    p_piece_path, p_piece_nom, auth.uid(),
    v_statut, v_montant_valide, v_valide_at
  )
  returning id into v_demande_id;

  return v_demande_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Valider (ou refuser) une demande — ligne par ligne, avec
--    possibilité de réduire le montant accordé.
-- ---------------------------------------------------------------------
create or replace function valider_demande_decaissement(
  p_demande_id uuid,
  p_montant_valide numeric,
  p_motif_refus text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_roles_valideurs text[];
  v_demande record;
begin
  select caisse_roles_validateurs into v_roles_valideurs from entreprises where id = v_entreprise_id;
  if not (v_role = any(v_roles_valideurs)) then
    raise exception 'accès refusé : votre rôle n''est pas autorisé à valider des décaissements';
  end if;

  select * into v_demande from demandes_decaissement
  where id = p_demande_id and entreprise_id = v_entreprise_id
  for update;
  if not found then
    raise exception 'demande introuvable';
  end if;
  if v_demande.statut <> 'en_attente' then
    raise exception 'cette demande a déjà été traitée';
  end if;
  if v_demande.demande_par = auth.uid() then
    raise exception 'vous ne pouvez pas valider votre propre demande';
  end if;
  if p_montant_valide is null or p_montant_valide < 0 or p_montant_valide > v_demande.montant_demande then
    raise exception 'le montant validé doit être compris entre 0 et le montant demandé';
  end if;

  update demandes_decaissement
  set statut = case when p_montant_valide = 0 then 'refusee' else 'validee' end,
      montant_valide = p_montant_valide,
      valide_par = auth.uid(),
      valide_at = now(),
      motif_refus = case when p_montant_valide = 0 then p_motif_refus else null end
  where id = p_demande_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Paiement effectif — génère l'écriture de sortie de caisse (le
--    statut 'payee' EST l'écriture comptable, pas de table séparée).
-- ---------------------------------------------------------------------
create or replace function payer_demande_decaissement(p_demande_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_demande record;
begin
  if v_role not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé';
  end if;

  select * into v_demande from demandes_decaissement
  where id = p_demande_id and entreprise_id = v_entreprise_id
  for update;
  if not found then
    raise exception 'demande introuvable';
  end if;
  if v_demande.statut <> 'validee' then
    raise exception 'cette demande doit être validée avant paiement';
  end if;

  update demandes_decaissement
  set statut = 'payee', payee_par = auth.uid(), payee_at = now()
  where id = p_demande_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Pièces justificatives — réutilise le bucket privé existant
--    'pieces-jointes' (déjà isolé par entreprise_id), nouveau
--    sous-dossier "decaissements/".
-- ---------------------------------------------------------------------
drop policy if exists decaissements_pj_select on storage.objects;
create policy decaissements_pj_select on storage.objects
  for select using (
    bucket_id = 'pieces-jointes'
    and (storage.foldername(name))[1] = current_entreprise_id()::text
    and (storage.foldername(name))[2] = 'decaissements'
  );

drop policy if exists decaissements_pj_insert on storage.objects;
create policy decaissements_pj_insert on storage.objects
  for insert with check (
    bucket_id = 'pieces-jointes'
    and (storage.foldername(name))[1] = current_entreprise_id()::text
    and (storage.foldername(name))[2] = 'decaissements'
  );

-- ---------------------------------------------------------------------
-- 7. Réglage du seuil et des rôles validateurs (Paramètres).
-- ---------------------------------------------------------------------
create or replace function modifier_parametrage_caisse(p_seuil numeric, p_roles_validateurs text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
begin
  if current_role_utilisateur() <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut modifier ce réglage';
  end if;
  if p_roles_validateurs is null or array_length(p_roles_validateurs, 1) is null then
    raise exception 'au moins un rôle validateur est requis';
  end if;

  update entreprises
  set caisse_seuil_validation = p_seuil, caisse_roles_validateurs = p_roles_validateurs
  where id = v_entreprise_id;
end;
$$;
