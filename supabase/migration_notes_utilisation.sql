-- Migration : note mensuelle d'utilisation de l'application par les
-- commerciaux (assiduité terrain, rapports de visite complets,
-- discipline de versement), calculée automatiquement à partir de
-- données déjà enregistrées (pas d'IA, formule transparente et
-- explicable — utilisée pour une prime, donc doit rester justifiable).
--
-- Pondération réglable par les dirigeants (Paramètres).
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Pondération — réglable, doit totaliser 100.
-- ---------------------------------------------------------------------
alter table entreprises add column if not exists note_poids_assiduite integer not null default 40;
alter table entreprises add column if not exists note_poids_rapports integer not null default 35;
alter table entreprises add column if not exists note_poids_versements integer not null default 25;

create or replace function modifier_ponderation_notation(p_poids_assiduite integer, p_poids_rapports integer, p_poids_versements integer)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if current_role_utilisateur() <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut modifier ce réglage';
  end if;
  if p_poids_assiduite < 0 or p_poids_rapports < 0 or p_poids_versements < 0 then
    raise exception 'les pondérations doivent être positives';
  end if;
  if p_poids_assiduite + p_poids_rapports + p_poids_versements <> 100 then
    raise exception 'les 3 pondérations doivent totaliser 100';
  end if;
  update entreprises
  set note_poids_assiduite = p_poids_assiduite, note_poids_rapports = p_poids_rapports, note_poids_versements = p_poids_versements
  where id = current_entreprise_id();
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Résultat du calcul, stocké mensuellement par commercial —
--    recalculable à tout moment pour le mois en cours (écrase le
--    précédent calcul du même mois), figé une fois le mois passé.
-- ---------------------------------------------------------------------
create table if not exists notes_utilisation (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  profil_id uuid not null references profils(id),
  mois date not null,
  jours_ouvres integer not null,
  jours_actifs integer not null,
  score_assiduite numeric not null,
  visites_prevues integer not null,
  visites_avec_rapport integer not null,
  score_rapports numeric not null,
  jours_avec_vente_cash integer not null,
  jours_avec_versement integer not null,
  score_versements numeric not null,
  score_total numeric not null,
  calcule_par uuid references profils(id),
  calcule_at timestamptz not null default now(),
  unique (entreprise_id, profil_id, mois)
);

alter table notes_utilisation enable row level security;
drop policy if exists notes_utilisation_select on notes_utilisation;
create policy notes_utilisation_select on notes_utilisation
  for select using (
    entreprise_id = current_entreprise_id()
    and (current_role_utilisateur() in ('admin', 'manager') or profil_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- 3. Calcul — un commercial, un mois donné (p_mois = n'importe quel
--    jour du mois concerné, seul le mois/année comptent).
-- ---------------------------------------------------------------------
create or replace function calculer_note_utilisation(p_profil_id uuid, p_mois date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin date := (date_trunc('month', p_mois) + interval '1 month - 1 day')::date;
  v_poids_assiduite integer;
  v_poids_rapports integer;
  v_poids_versements integer;
  v_jours_ouvres integer;
  v_jours_actifs integer;
  v_score_assiduite numeric;
  v_visites_prevues integer;
  v_visites_avec_rapport integer;
  v_score_rapports numeric;
  v_jours_vente_cash integer;
  v_jours_versement integer;
  v_score_versements numeric;
  v_id uuid;
begin
  if current_role_utilisateur() not in ('admin', 'manager') then
    raise exception 'accès refusé';
  end if;
  perform 1 from profils where id = p_profil_id and entreprise_id = v_entreprise_id and role = 'commercial';
  if not found then raise exception 'commercial introuvable pour cette entreprise'; end if;

  select note_poids_assiduite, note_poids_rapports, note_poids_versements
  into v_poids_assiduite, v_poids_rapports, v_poids_versements
  from entreprises where id = v_entreprise_id;

  -- Jours ouvrés du mois : lundi à samedi (6 jours/semaine, usage
  -- courant du secteur). Si l'entreprise travaille sur une autre
  -- base, ce calcul est à ajuster.
  select count(*) into v_jours_ouvres
  from generate_series(v_debut, v_fin, interval '1 day') d
  where extract(dow from d) <> 0;

  -- Jours actifs : au moins une activité enregistrée par ce
  -- commercial (vente, rapport de visite, versement ou recouvrement).
  select count(distinct jour) into v_jours_actifs from (
    select date(created_at) as jour from ventes where commercial_id = p_profil_id and created_at::date between v_debut and v_fin
    union
    select date(created_at) from rapports_visite where commercial_id = p_profil_id and created_at::date between v_debut and v_fin
    union
    select date(created_at) from versements_caisse where commercial_id = p_profil_id and created_at::date between v_debut and v_fin
    union
    select date(created_at) from reglements where commercial_id = p_profil_id and created_at::date between v_debut and v_fin
  ) jours;

  v_score_assiduite := least(1.0, v_jours_actifs::numeric / nullif(v_jours_ouvres, 0)) * v_poids_assiduite;

  -- Rapports de visite : visites prévues dans une tournée du mois vs
  -- effectivement suivies d'un rapport.
  select count(*) into v_visites_prevues
  from tournee_lignes tl
  join tournees t on t.id = tl.tournee_id
  where t.commercial_id = p_profil_id and t.entreprise_id = v_entreprise_id and t.date_tournee between v_debut and v_fin;

  select count(*) into v_visites_avec_rapport
  from tournee_lignes tl
  join tournees t on t.id = tl.tournee_id
  where t.commercial_id = p_profil_id and t.entreprise_id = v_entreprise_id and t.date_tournee between v_debut and v_fin
    and exists (select 1 from rapports_visite rv where rv.tournee_ligne_id = tl.id);

  if v_visites_prevues = 0 then
    v_score_rapports := v_poids_rapports; -- rien de prévu, pas pénalisé
  else
    v_score_rapports := least(1.0, v_visites_avec_rapport::numeric / v_visites_prevues) * v_poids_rapports;
  end if;

  -- Discipline de versement : jours avec vente en espèces vs jours
  -- avec un versement de caisse effectivement fait.
  select count(distinct date(created_at)) into v_jours_vente_cash
  from ventes where commercial_id = p_profil_id and mode_paiement = 'cash' and created_at::date between v_debut and v_fin;

  select count(distinct date(created_at)) into v_jours_versement
  from versements_caisse where commercial_id = p_profil_id and created_at::date between v_debut and v_fin;

  if v_jours_vente_cash = 0 then
    v_score_versements := v_poids_versements; -- rien à verser, pas pénalisé
  else
    v_score_versements := least(1.0, v_jours_versement::numeric / v_jours_vente_cash) * v_poids_versements;
  end if;

  insert into notes_utilisation (
    entreprise_id, profil_id, mois, jours_ouvres, jours_actifs, score_assiduite,
    visites_prevues, visites_avec_rapport, score_rapports,
    jours_avec_vente_cash, jours_avec_versement, score_versements,
    score_total, calcule_par
  )
  values (
    v_entreprise_id, p_profil_id, v_debut, v_jours_ouvres, v_jours_actifs, round(v_score_assiduite, 1),
    v_visites_prevues, v_visites_avec_rapport, round(v_score_rapports, 1),
    v_jours_vente_cash, v_jours_versement, round(v_score_versements, 1),
    round(v_score_assiduite + v_score_rapports + v_score_versements, 1), auth.uid()
  )
  on conflict (entreprise_id, profil_id, mois) do update set
    jours_ouvres = excluded.jours_ouvres, jours_actifs = excluded.jours_actifs, score_assiduite = excluded.score_assiduite,
    visites_prevues = excluded.visites_prevues, visites_avec_rapport = excluded.visites_avec_rapport, score_rapports = excluded.score_rapports,
    jours_avec_vente_cash = excluded.jours_avec_vente_cash, jours_avec_versement = excluded.jours_avec_versement, score_versements = excluded.score_versements,
    score_total = excluded.score_total, calcule_par = excluded.calcule_par, calcule_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Calcule pour tous les commerciaux actifs de l'entreprise, un mois
-- donné — pratique pour le bouton "Calculer les notes du mois".
create or replace function calculer_notes_utilisation_mois(p_mois date)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_commercial record;
  v_total integer := 0;
begin
  if current_role_utilisateur() not in ('admin', 'manager') then raise exception 'accès refusé'; end if;

  for v_commercial in select id from profils where entreprise_id = v_entreprise_id and role = 'commercial' and actif is not false
  loop
    perform calculer_note_utilisation(v_commercial.id, p_mois);
    v_total := v_total + 1;
  end loop;

  return v_total;
end;
$$;
