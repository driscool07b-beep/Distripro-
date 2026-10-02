-- Migration : faire respecter les abonnements.
-- 1. Quota de commerciaux de la formule vérifié À LA BASE (changement de rôle,
--    réactivation, acceptation d'invitation), et plus seulement à l'invitation.
-- 2. Impayés et essais expirés : après un délai de grâce, l'entreprise passe
--    en LECTURE SEULE, puis peut être SUSPENDUE (règles réglables, désactivées
--    par défaut dans la console du promoteur). Levée automatique dès le paiement.
-- 3. Rappels automatiques par email (fin d'essai, échéance, impayé, solde
--    d'unités IA bas ou épuisé), envoyés une seule fois chacun.
-- À exécuter dans l'éditeur SQL de Supabase (après migration_console_plateforme.sql).

-- ===========================================================================
-- 1. Quota de commerciaux
-- ===========================================================================
create or replace function verifier_quota_commerciaux()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_max integer;
  v_plan text;
  v_nb integer;
begin
  if new.role <> 'commercial' or new.actif is false then return new; end if;
  if tg_op = 'UPDATE' and old.role = 'commercial' and old.actif is not false then return new; end if;
  select e.plan, p.max_commerciaux into v_plan, v_max from entreprises e left join plans p on p.code = e.plan where e.id = new.entreprise_id;
  if v_max is null then return new; end if;
  select count(*) into v_nb from profils
  where entreprise_id = new.entreprise_id and role = 'commercial' and actif is not false and id <> new.id;
  if v_nb >= v_max then
    raise exception 'quota_commerciaux_atteint: votre formule (%) est limitée à % commercial(aux) — passez à la formule supérieure (Mon abonnement) pour en ajouter davantage', v_plan, v_max;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_verifier_quota_commerciaux on profils;
create trigger trg_verifier_quota_commerciaux before insert or update of role, actif on profils
  for each row execute function verifier_quota_commerciaux();

-- ===========================================================================
-- 2. Impayés : lecture seule puis suspension
-- ===========================================================================
alter table entreprises add column if not exists lecture_seule_abonnement boolean not null default false;

insert into plateforme_parametres (cle, valeur, description) values
  ('lecture_seule_auto', 0, '1 = passer automatiquement en lecture seule les entreprises en impayé ou en fin d''essai, après le délai de grâce'),
  ('jours_grace', 7, 'Jours de grâce après la fin d''essai ou l''échéance avant la lecture seule'),
  ('suspension_auto', 0, '1 = suspendre automatiquement après le délai de suspension'),
  ('jours_avant_suspension', 30, 'Jours après la fin d''essai ou l''échéance avant la suspension'),
  ('rappels_auto', 1, '1 = envoyer les rappels par email (fin d''essai, échéance, impayé, solde IA)')
on conflict (cle) do nothing;

-- Seuls la plateforme (règles automatiques) et le promoteur changent ce
-- drapeau : l'administrateur d'une entreprise ne peut pas se débloquer seul.
create or replace function proteger_lecture_seule_abonnement()
returns trigger
language plpgsql
as $$
begin
  if new.lecture_seule_abonnement is distinct from old.lecture_seule_abonnement
     and current_user in ('authenticated', 'anon') then
    raise exception 'modification non autorisée : seul le support DistribPro peut lever la lecture seule';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_proteger_lecture_seule_abonnement on entreprises;
create trigger trg_proteger_lecture_seule_abonnement before update of lecture_seule_abonnement on entreprises
  for each row execute function proteger_lecture_seule_abonnement();

-- Une entreprise en lecture seule ne peut plus rien modifier : la règle
-- existante « compte en lecture seule » s'applique à tous ses membres.
create or replace function mon_compte_lecture_seule()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(p.lecture_seule, false) or coalesce(e.lecture_seule_abonnement, false)
  from profils p left join entreprises e on e.id = p.entreprise_id
  where p.id = auth.uid();
$$;

-- Levée immédiate de la lecture seule dès que l'abonnement est régularisé
-- (paiement en ligne, paiement enregistré ou action du promoteur).
create or replace function lever_lecture_seule_abonnement()
returns trigger
language plpgsql
as $$
begin
  if new.lecture_seule_abonnement and (
       (new.statut = 'actif' and (new.date_prochaine_echeance is null or new.date_prochaine_echeance >= current_date))
    or (new.statut = 'essai' and (new.date_fin_essai is null or new.date_fin_essai >= current_date))) then
    new.lecture_seule_abonnement := false;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_lever_lecture_seule_abonnement on entreprises;
create trigger trg_lever_lecture_seule_abonnement before update on entreprises
  for each row execute function lever_lecture_seule_abonnement();

-- Le promoteur peut aussi lever ou imposer la lecture seule à la main.
create or replace function plateforme_lecture_seule(p_entreprise_id uuid, p_active boolean, p_motif text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  if coalesce(length(trim(p_motif)), 0) < 3 then raise exception 'le motif est obligatoire'; end if;
  update entreprises set lecture_seule_abonnement = p_active where id = p_entreprise_id;
  perform journaliser_plateforme(case when p_active then 'lecture_seule_activee' else 'lecture_seule_levee' end, p_entreprise_id, jsonb_build_object('motif', trim(p_motif)));
end;
$$;

-- Règles appliquées chaque jour (appelée par la fonction serveur planifiée).
create or replace function appliquer_regles_abonnement()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_grace integer := coalesce(parametre_plateforme('jours_grace'), 7);
  v_susp integer := coalesce(parametre_plateforme('jours_avant_suspension'), 30);
  v_lecture integer := 0;
  v_suspendues integer := 0;
  v_e record;
  v_reference date;
begin
  for v_e in select * from entreprises where statut in ('essai', 'actif') loop
    v_reference := case when v_e.statut = 'essai' then v_e.date_fin_essai else v_e.date_prochaine_echeance end;
    continue when v_reference is null;
    if coalesce(parametre_plateforme('suspension_auto'), 0) = 1 and v_reference + v_susp < current_date then
      update entreprises set statut = 'suspendu' where id = v_e.id;
      insert into plateforme_journal (action, entreprise_id, details)
      values ('suspension_automatique', v_e.id, jsonb_build_object('motif', 'impayé ou essai expiré depuis plus de ' || v_susp || ' jours', 'date_reference', v_reference));
      v_suspendues := v_suspendues + 1;
    elsif coalesce(parametre_plateforme('lecture_seule_auto'), 0) = 1 and v_reference + v_grace < current_date and not v_e.lecture_seule_abonnement then
      update entreprises set lecture_seule_abonnement = true where id = v_e.id;
      insert into plateforme_journal (action, entreprise_id, details)
      values ('lecture_seule_automatique', v_e.id, jsonb_build_object('motif', 'impayé ou essai expiré depuis plus de ' || v_grace || ' jours', 'date_reference', v_reference));
      v_lecture := v_lecture + 1;
    end if;
  end loop;
  return jsonb_build_object('lecture_seule', v_lecture, 'suspendues', v_suspendues);
end;
$$;
revoke all on function appliquer_regles_abonnement() from public, anon, authenticated;
grant execute on function appliquer_regles_abonnement() to service_role;

-- ===========================================================================
-- 3. Rappels automatiques (chacun envoyé une seule fois)
-- ===========================================================================
create table if not exists rappels_envoyes (
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  cle text not null,                 -- ex. essai_j7_2026-10-15, ia_bas_<date du dernier achat>
  envoye_at timestamptz not null default now(),
  primary key (entreprise_id, cle)
);
alter table rappels_envoyes enable row level security;

create or replace function rappels_a_envoyer()
returns table (entreprise_id uuid, nom text, type text, cle text, date_reference date, solde numeric)
language sql
security definer
stable
set search_path to 'public'
as $$
  with r as (
    -- Fin d'essai : J-7, J-3, J-1, et le jour même
    select e.id, e.nom, 'essai_j' || (e.date_fin_essai - current_date) as type,
           'essai_j' || (e.date_fin_essai - current_date) || '_' || e.date_fin_essai as cle, e.date_fin_essai as ref, null::numeric as solde
    from entreprises e where e.statut = 'essai' and e.date_fin_essai - current_date in (7, 3, 1, 0)
    union all
    -- Échéance : J-7, J-3, J-1
    select e.id, e.nom, 'echeance_j' || (e.date_prochaine_echeance - current_date),
           'echeance_j' || (e.date_prochaine_echeance - current_date) || '_' || e.date_prochaine_echeance, e.date_prochaine_echeance, null
    from entreprises e where e.statut = 'actif' and e.date_prochaine_echeance - current_date in (7, 3, 1)
    union all
    -- Impayé ou essai expiré : 1, 7 et 14 jours après
    select e.id, e.nom, 'impaye',
           'impaye_' || (current_date - coalesce(case when e.statut = 'essai' then e.date_fin_essai else e.date_prochaine_echeance end, current_date)) || '_' ||
             coalesce(case when e.statut = 'essai' then e.date_fin_essai else e.date_prochaine_echeance end, current_date),
           case when e.statut = 'essai' then e.date_fin_essai else e.date_prochaine_echeance end, null
    from entreprises e
    where e.statut in ('essai', 'actif')
      and current_date - case when e.statut = 'essai' then e.date_fin_essai else e.date_prochaine_echeance end in (1, 7, 14)
    union all
    -- Unités IA : solde bas, puis épuisé (une fois par recharge)
    select e.id, e.nom, case when w.solde <= 0 then 'ia_epuise' else 'ia_bas' end,
           case when w.solde <= 0 then 'ia_epuise_' else 'ia_bas_' end ||
             coalesce((select max(created_at)::date::text from ia_mouvements m where m.entreprise_id = e.id and m.unites > 0), 'debut'),
           null, w.solde
    from entreprises e join ia_portefeuilles w on w.entreprise_id = e.id
    where e.statut <> 'suspendu' and w.solde < coalesce(parametre_plateforme('seuil_alerte_unites'), 1000)
  )
  select r.id, r.nom::text, r.type, r.cle, r.ref, r.solde from r
  where not exists (select 1 from rappels_envoyes x where x.entreprise_id = r.id and x.cle = r.cle);
$$;
revoke all on function rappels_a_envoyer() from public, anon, authenticated;
grant execute on function rappels_a_envoyer() to service_role;

-- Tous les jours à 8 h (heure d'Abidjan = UTC).
select cron.unschedule('rappels-abonnement-distribpro')
where exists (select 1 from cron.job where jobname = 'rappels-abonnement-distribpro');
select cron.schedule(
  'rappels-abonnement-distribpro',
  '0 8 * * *',
  $cron$
    select net.http_post(
      url := 'https://eikazcqkimnaguwzlahd.supabase.co/functions/v1/rappels-abonnement',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'apikey', (select valeur from public.plateforme_secrets where cle = 'cle_publique'),
        'x-rapport-secret', (select valeur from public.plateforme_secrets where cle = 'rapport_mensuel')),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cron$
);

notify pgrst, 'reload schema';

-- État de lecture seule d'une entreprise (console du promoteur).
create or replace function plateforme_lecture_seule_etat(p_entreprise_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  return (select lecture_seule_abonnement from entreprises where id = p_entreprise_id);
end;
$$;

notify pgrst, 'reload schema';
