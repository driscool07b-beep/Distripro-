-- Migration : socle de la facturation SaaS (formules, paiements,
-- essai gratuit, quota de commerciaux qui force le palier supérieur).
--
-- Paiement CinetPay (Mobile Money + cartes) : cette migration prépare
-- uniquement la base de données. L'appel réel à l'API CinetPay se fait
-- via une Edge Function à part (secrets API non stockables ici) —
-- voir le message d'accompagnement pour les prochaines étapes.
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Table des formules — remplace les valeurs codées en dur du CHECK
--    sur entreprises.plan par une vraie table, pour pouvoir ajuster
--    prix/quotas sans migration à chaque fois.
-- ---------------------------------------------------------------------
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('starter', 'pro', 'entreprise')),
  nom text not null,
  prix_mensuel numeric(14,2) not null,
  prix_annuel numeric(14,2) not null,
  max_commerciaux integer,  -- null = illimité
  ordre integer not null,
  actif boolean not null default true
);

insert into plans (code, nom, prix_mensuel, prix_annuel, max_commerciaux, ordre)
values
  ('starter', 'Starter', 25000, 240000, 3, 1),
  ('pro', 'Pro', 45000, 432000, 10, 2),
  ('entreprise', 'Entreprise', 85000, 816000, null, 3)
on conflict (code) do update set
  prix_mensuel = excluded.prix_mensuel,
  prix_annuel = excluded.prix_annuel,
  max_commerciaux = excluded.max_commerciaux,
  ordre = excluded.ordre;

alter table plans enable row level security;

drop policy if exists plans_select_public on plans;
create policy plans_select_public on plans for select using (true);

-- ---------------------------------------------------------------------
-- 2. entreprises : nouveaux champs de facturation. Le CHECK existant sur
--    plan ('starter','business','enterprise') est remplacé — 'business'
--    devient 'pro' pour matcher les codes ci-dessus.
-- ---------------------------------------------------------------------
update entreprises set plan = 'pro' where plan = 'business';
update entreprises set plan = 'entreprise' where plan = 'enterprise';

alter table entreprises drop constraint if exists entreprises_plan_check;
alter table entreprises add constraint entreprises_plan_check
  check (plan in ('starter', 'pro', 'entreprise'));

alter table entreprises add column if not exists cycle_facturation text not null default 'mensuel'
  check (cycle_facturation in ('mensuel', 'annuel'));
alter table entreprises add column if not exists date_fin_essai date;
alter table entreprises add column if not exists date_prochaine_echeance date;

-- ---------------------------------------------------------------------
-- 3. Historique des paiements d'abonnement.
-- ---------------------------------------------------------------------
create table if not exists paiements_abonnement (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  plan_code text not null,
  cycle text not null check (cycle in ('mensuel', 'annuel')),
  montant numeric(14,2) not null,
  transaction_id text,
  moyen_paiement text,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'reussi', 'echoue')),
  periode_debut date,
  periode_fin date,
  created_at timestamptz not null default now(),
  confirme_at timestamptz
);

create index if not exists idx_paiements_abonnement_entreprise on paiements_abonnement(entreprise_id);
create unique index if not exists idx_paiements_abonnement_transaction on paiements_abonnement(transaction_id) where transaction_id is not null;

alter table paiements_abonnement enable row level security;

drop policy if exists paiements_abonnement_select on paiements_abonnement;
create policy paiements_abonnement_select on paiements_abonnement
  for select using (entreprise_id = current_entreprise_id());

-- ---------------------------------------------------------------------
-- 4. inscrire_entreprise : période d'essai de 21 jours, sans carte.
-- ---------------------------------------------------------------------
create or replace function inscrire_entreprise(
  p_nom_entreprise text,
  p_nom_admin text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entreprise_id uuid;
begin
  if exists (select 1 from profils where id = auth.uid()) then
    raise exception 'un profil existe déjà pour cet utilisateur';
  end if;

  insert into entreprises (nom, plan, statut, date_fin_essai)
  values (p_nom_entreprise, 'starter', 'essai', (current_date + interval '21 days')::date)
  returning id into v_entreprise_id;

  insert into profils (id, entreprise_id, nom, role)
  values (auth.uid(), v_entreprise_id, p_nom_admin, 'admin');

  return v_entreprise_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. creer_invitation : quota de commerciaux forcé au palier supérieur
--    (pas de facturation à l'unité — on bloque et on renvoie vers la
--    formule suivante).
-- ---------------------------------------------------------------------
create or replace function creer_invitation(
  p_email text,
  p_nom_complet text,
  p_role text,
  p_zone text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role_appelant text := current_role_utilisateur();
  v_invitation_id uuid;
  v_plan_code text;
  v_max_commerciaux integer;
  v_nb_commerciaux_actuels integer;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role_appelant <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut inviter un collaborateur';
  end if;
  if p_role not in ('admin', 'manager', 'commercial', 'comptable', 'gestionnaire_stock', 'agent_recouvrement') then
    raise exception 'rôle invalide';
  end if;
  if p_email is null or trim(p_email) = '' then
    raise exception 'email requis';
  end if;

  if p_role = 'commercial' then
    select plan into v_plan_code from entreprises where id = v_entreprise_id;
    select max_commerciaux into v_max_commerciaux from plans where code = v_plan_code;

    if v_max_commerciaux is not null then
      select
        (select count(*) from profils where entreprise_id = v_entreprise_id and role = 'commercial' and actif is not false)
        + (select count(*) from invitations where entreprise_id = v_entreprise_id and role = 'commercial' and statut = 'en_attente')
      into v_nb_commerciaux_actuels;

      if v_nb_commerciaux_actuels >= v_max_commerciaux then
        raise exception 'quota_commerciaux_atteint: votre formule (%) est limitée à % commercial(aux) — passez à la formule supérieure pour en ajouter davantage', v_plan_code, v_max_commerciaux;
      end if;
    end if;
  end if;

  perform 1 from profils pr
    join auth.users u on u.id = pr.id
    where lower(u.email) = lower(p_email) and pr.entreprise_id = v_entreprise_id;
  if found then
    raise exception 'cet email correspond déjà à un membre de l''équipe';
  end if;

  update invitations
  set statut = 'annulee'
  where lower(email) = lower(p_email) and entreprise_id = v_entreprise_id and statut = 'en_attente';

  insert into invitations (entreprise_id, email, nom_complet, role, zone, invited_by, statut)
  values (v_entreprise_id, lower(trim(p_email)), p_nom_complet, p_role, p_zone, auth.uid(), 'en_attente')
  returning id into v_invitation_id;

  return v_invitation_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Initier un paiement d'abonnement (crée la ligne "en_attente" ;
--    l'Edge Function appelle ensuite l'API CinetPay avec cet id comme
--    référence de transaction, puis confirme via la fonction 7).
-- ---------------------------------------------------------------------
create or replace function initier_paiement_abonnement(p_plan_code text, p_cycle text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_montant numeric(14,2);
  v_paiement_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut gérer l''abonnement';
  end if;
  if p_cycle not in ('mensuel', 'annuel') then
    raise exception 'cycle invalide';
  end if;

  select case when p_cycle = 'annuel' then prix_annuel else prix_mensuel end
  into v_montant
  from plans where code = p_plan_code and actif = true;

  if v_montant is null then
    raise exception 'formule invalide';
  end if;

  insert into paiements_abonnement (entreprise_id, plan_code, cycle, montant, statut)
  values (v_entreprise_id, p_plan_code, p_cycle, v_montant, 'en_attente')
  returning id into v_paiement_id;

  return v_paiement_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Confirmer un paiement (appelée uniquement par l'Edge Function du
--    webhook CinetPay, via la clé service_role qui contourne la RLS).
-- ---------------------------------------------------------------------
create or replace function confirmer_paiement_abonnement(p_paiement_id uuid, p_transaction_id text, p_reussi boolean, p_moyen_paiement text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_paiement record;
  v_periode_debut date;
  v_periode_fin date;
begin
  select * into v_paiement from paiements_abonnement where id = p_paiement_id and statut = 'en_attente' for update;
  if not found then
    raise exception 'paiement introuvable ou déjà traité';
  end if;

  if not p_reussi then
    update paiements_abonnement set statut = 'echoue', transaction_id = p_transaction_id, moyen_paiement = p_moyen_paiement, confirme_at = now()
    where id = p_paiement_id;
    return;
  end if;

  v_periode_debut := current_date;
  v_periode_fin := case when v_paiement.cycle = 'annuel' then (current_date + interval '1 year')::date else (current_date + interval '1 month')::date end;

  update paiements_abonnement
  set statut = 'reussi', transaction_id = p_transaction_id, moyen_paiement = p_moyen_paiement,
      periode_debut = v_periode_debut, periode_fin = v_periode_fin, confirme_at = now()
  where id = p_paiement_id;

  update entreprises
  set plan = v_paiement.plan_code, statut = 'actif', cycle_facturation = v_paiement.cycle,
      date_prochaine_echeance = v_periode_fin, date_fin_essai = null
  where id = v_paiement.entreprise_id;
end;
$$;

-- Sécurité : cette fonction ne doit être appelable QUE par l'Edge
-- Function du webhook (via la clé service_role), jamais par un
-- utilisateur connecté normal — sinon n'importe qui pourrait
-- s'auto-activer un abonnement sans payer en l'appelant directement
-- avec p_reussi = true.
revoke execute on function confirmer_paiement_abonnement(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function confirmer_paiement_abonnement(uuid, text, boolean, text) to service_role;

-- ---------------------------------------------------------------------
-- 8. Vérification d'expiration (essai ou échéance dépassée) — appelée
--    depuis le frontend à la connexion, faute de tâche planifiée native
--    simple à ce stade. Suspend si dépassé et rien n'a été payé depuis.
-- ---------------------------------------------------------------------
create or replace function verifier_expiration_abonnement()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_entreprise record;
begin
  if v_entreprise_id is null then
    return;
  end if;

  select * into v_entreprise from entreprises where id = v_entreprise_id;

  if v_entreprise.statut = 'essai' and v_entreprise.date_fin_essai is not null and v_entreprise.date_fin_essai < current_date then
    update entreprises set statut = 'suspendu' where id = v_entreprise_id;
  elsif v_entreprise.statut = 'actif' and v_entreprise.date_prochaine_echeance is not null and v_entreprise.date_prochaine_echeance < current_date then
    update entreprises set statut = 'suspendu' where id = v_entreprise_id;
  end if;
end;
$$;
