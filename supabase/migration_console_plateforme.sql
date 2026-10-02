-- Migration : console du promoteur de la plateforme DistribPro.
-- - Rôle SUPER-ADMIN (promoteur), distinct des administrateurs d'entreprise.
-- - Pilotage : tableau de bord, entreprises clientes, abonnements (formule,
--   statut, essai, échéance, paiements manuels en attendant CinetPay),
--   formules et tarifs, annonces à tous les utilisateurs, journal d'audit.
-- - Porte-monnaie d'UNITÉS IA par entreprise : 1 unité = 1 F CFA de valeur.
--   Chaque appel d'IA est décompté automatiquement (coût réel × taux de
--   change × coefficient de marge) ; à zéro, l'IA est bloquée.
-- À exécuter dans l'éditeur SQL de Supabase.

-- ===========================================================================
-- 1. Super-administrateurs (promoteur)
-- ===========================================================================
create table if not exists plateforme_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table plateforme_admins enable row level security; -- aucune lecture directe

insert into plateforme_admins (user_id)
select id from auth.users where lower(email) = 'driscool07b@gmail.com'
on conflict (user_id) do nothing;

create or replace function est_super_admin()
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $$
  select exists (select 1 from plateforme_admins where user_id = auth.uid());
$$;

create or replace function exiger_super_admin()
returns void
language plpgsql
security definer
stable
set search_path to 'public'
as $$
begin
  if not est_super_admin() then raise exception 'accès réservé au promoteur de la plateforme'; end if;
end;
$$;

-- Journal d'audit de toutes les actions du promoteur.
create table if not exists plateforme_journal (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entreprise_id uuid references entreprises(id) on delete set null,
  details jsonb,
  auteur uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table plateforme_journal enable row level security;

create or replace function journaliser_plateforme(p_action text, p_entreprise_id uuid, p_details jsonb)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into plateforme_journal (action, entreprise_id, details, auteur) values (p_action, p_entreprise_id, p_details, auth.uid());
$$;

-- ===========================================================================
-- 2. Paramètres de la plateforme
-- ===========================================================================
create table if not exists plateforme_parametres (
  cle text primary key,
  valeur numeric not null,
  description text
);
alter table plateforme_parametres enable row level security;
insert into plateforme_parametres (cle, valeur, description) values
  ('taux_usd_fcfa', 620, 'Taux de change utilisé pour convertir le coût réel de l''IA (USD) en F CFA'),
  ('coefficient_marge_ia', 3, 'Coefficient appliqué au coût réel de l''IA (3 = prix facturé trois fois le coût)'),
  ('unites_offertes_inscription', 5000, 'Unités IA offertes à chaque nouvelle entreprise'),
  ('seuil_alerte_unites', 1000, 'En dessous de ce solde, l''entreprise est alertée')
on conflict (cle) do nothing;

create or replace function parametre_plateforme(p_cle text)
returns numeric
language sql
security definer
stable
set search_path to 'public'
as $$
  select valeur from plateforme_parametres where cle = p_cle;
$$;

-- ===========================================================================
-- 3. Porte-monnaie d'unités IA
-- ===========================================================================
create table if not exists ia_portefeuilles (
  entreprise_id uuid primary key references entreprises(id) on delete cascade,
  solde numeric(14, 2) not null default 0,
  maj_at timestamptz not null default now()
);
create table if not exists ia_mouvements (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  type text not null check (type in ('achat', 'offert', 'consommation', 'ajustement', 'remboursement')),
  unites numeric(14, 2) not null,           -- positif = crédit, négatif = débit
  montant_fcfa numeric(14, 2),              -- prix payé (achats)
  fonction text,                            -- consommation : fonction IA utilisée
  consommation_id uuid,
  motif text,
  cree_par uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_ia_mouvements_entreprise on ia_mouvements (entreprise_id, created_at desc);

alter table ia_portefeuilles enable row level security;
alter table ia_mouvements enable row level security;
drop policy if exists ia_portefeuilles_select on ia_portefeuilles;
create policy ia_portefeuilles_select on ia_portefeuilles for select using (
  est_super_admin() or (entreprise_id = current_entreprise_id() and current_role_utilisateur() in ('admin', 'manager', 'comptable')));
drop policy if exists ia_mouvements_select on ia_mouvements;
create policy ia_mouvements_select on ia_mouvements for select using (
  est_super_admin() or (entreprise_id = current_entreprise_id() and current_role_utilisateur() in ('admin', 'manager', 'comptable')));

-- Crédit / débit du porte-monnaie (interne).
create or replace function mouvement_ia(p_entreprise_id uuid, p_type text, p_unites numeric, p_montant numeric, p_fonction text, p_consommation_id uuid, p_motif text)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_solde numeric;
begin
  insert into ia_portefeuilles (entreprise_id, solde) values (p_entreprise_id, 0) on conflict (entreprise_id) do nothing;
  update ia_portefeuilles set solde = solde + p_unites, maj_at = now() where entreprise_id = p_entreprise_id returning solde into v_solde;
  insert into ia_mouvements (entreprise_id, type, unites, montant_fcfa, fonction, consommation_id, motif, cree_par)
  values (p_entreprise_id, p_type, p_unites, p_montant, p_fonction, p_consommation_id, p_motif, auth.uid());
  return v_solde;
end;
$$;
revoke all on function mouvement_ia(uuid, text, numeric, numeric, text, uuid, text) from public, anon, authenticated;

-- Solde disponible (utilisé par les fonctions serveur avant tout appel d'IA).
create or replace function ia_solde_disponible(p_entreprise_id uuid)
returns numeric
language sql
security definer
stable
set search_path to 'public'
as $$
  select coalesce((select solde from ia_portefeuilles where entreprise_id = p_entreprise_id), 0);
$$;

-- Décompte automatique : chaque consommation enregistrée débite le porte-monnaie.
create or replace function debiter_consommation_ia()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_unites numeric;
begin
  v_unites := ceil(coalesce(new.cout_usd, 0) * coalesce(parametre_plateforme('taux_usd_fcfa'), 620)
                   * coalesce(parametre_plateforme('coefficient_marge_ia'), 3));
  if v_unites > 0 then
    perform mouvement_ia(new.entreprise_id, 'consommation', -v_unites, null, new.fonction, new.id, null);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_debiter_consommation_ia on consommation_ia;
create trigger trg_debiter_consommation_ia after insert on consommation_ia
  for each row execute function debiter_consommation_ia();

-- Unités offertes à chaque nouvelle entreprise.
create or replace function offrir_unites_inscription()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform mouvement_ia(new.id, 'offert', coalesce(parametre_plateforme('unites_offertes_inscription'), 0), null, null, null, 'Bienvenue sur DistribPro');
  return new;
end;
$$;
drop trigger if exists trg_offrir_unites_inscription on entreprises;
create trigger trg_offrir_unites_inscription after insert on entreprises
  for each row execute function offrir_unites_inscription();

-- Entreprises existantes : porte-monnaie ouvert avec les unités de bienvenue.
do $$
declare
  v_id uuid;
begin
  for v_id in select e.id from entreprises e where not exists (select 1 from ia_portefeuilles p where p.entreprise_id = e.id) loop
    perform mouvement_ia(v_id, 'offert', coalesce(parametre_plateforme('unites_offertes_inscription'), 0), null, null, null, 'Ouverture du porte-monnaie IA');
  end loop;
end;
$$;

-- ===========================================================================
-- 4. Annonces à tous les utilisateurs
-- ===========================================================================
create table if not exists annonces_plateforme (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  message text not null,
  niveau text not null default 'info' check (niveau in ('info', 'attention', 'important')),
  debut timestamptz not null default now(),
  fin timestamptz,
  actif boolean not null default true,
  cree_par uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table annonces_plateforme enable row level security;
drop policy if exists annonces_select on annonces_plateforme;
create policy annonces_select on annonces_plateforme for select using (
  est_super_admin() or (auth.uid() is not null and actif and debut <= now() and (fin is null or fin > now())));

-- ===========================================================================
-- 5. Fonctions de la console (toutes réservées au promoteur)
-- ===========================================================================
create or replace function plateforme_tableau_de_bord()
returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_aujourdhui date := (now() at time zone 'Africa/Abidjan')::date;
begin
  perform exiger_super_admin();
  return jsonb_build_object(
    'entreprises', (select count(*) from entreprises),
    'actives', (select count(*) from entreprises where statut = 'actif'),
    'essais', (select count(*) from entreprises where statut = 'essai'),
    'essais_expires', (select count(*) from entreprises where statut = 'essai' and date_fin_essai < v_aujourdhui),
    'suspendues', (select count(*) from entreprises where statut = 'suspendu'),
    'echeances_7j', (select count(*) from entreprises where statut = 'actif' and date_prochaine_echeance between v_aujourdhui and v_aujourdhui + 7),
    'echeances_depassees', (select count(*) from entreprises where statut = 'actif' and date_prochaine_echeance < v_aujourdhui),
    'revenu_mensuel', coalesce((select sum(case when e.cycle_facturation = 'annuel' then p.prix_annuel / 12 else p.prix_mensuel end)
                                from entreprises e join plans p on p.code = e.plan where e.statut = 'actif'), 0),
    'encaisse_mois', coalesce((select sum(montant) from paiements_abonnement where statut = 'reussi'
                               and date_trunc('month', confirme_at) = date_trunc('month', now())), 0),
    'utilisateurs', (select count(*) from profils where coalesce(actif, true)),
    'utilisateurs_actifs_30j', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
    'nouvelles_30j', (select count(*) from entreprises where created_at > now() - interval '30 days'),
    'ia_cout_usd_mois', coalesce((select sum(cout_usd) from consommation_ia where date_trunc('month', created_at) = date_trunc('month', now())), 0),
    'ia_unites_consommees_mois', coalesce((select -sum(unites) from ia_mouvements where type = 'consommation' and date_trunc('month', created_at) = date_trunc('month', now())), 0),
    'ia_unites_vendues_mois', coalesce((select sum(unites) from ia_mouvements where type = 'achat' and date_trunc('month', created_at) = date_trunc('month', now())), 0),
    'ia_ventes_fcfa_mois', coalesce((select sum(montant_fcfa) from ia_mouvements where type = 'achat' and date_trunc('month', created_at) = date_trunc('month', now())), 0),
    'ia_soldes_bas', (select count(*) from ia_portefeuilles where solde < coalesce(parametre_plateforme('seuil_alerte_unites'), 1000)),
    'taux_usd_fcfa', parametre_plateforme('taux_usd_fcfa')
  );
end;
$$;

create or replace function plateforme_entreprises()
returns table (
  id uuid, nom text, created_at timestamptz, plan text, statut text, cycle text,
  date_fin_essai date, date_prochaine_echeance date, nb_utilisateurs integer, nb_commerciaux integer,
  max_commerciaux integer, ventes_30j integer, ca_30j numeric, derniere_connexion timestamptz,
  solde_ia numeric, cout_ia_mois_usd numeric, admin_email text
)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  return query
    select e.id, e.nom::text, e.created_at, e.plan::text, e.statut::text, e.cycle_facturation::text,
           e.date_fin_essai, e.date_prochaine_echeance,
           (select count(*)::integer from profils p where p.entreprise_id = e.id and coalesce(p.actif, true)),
           (select count(*)::integer from profils p where p.entreprise_id = e.id and coalesce(p.actif, true) and p.role = 'commercial'),
           (select pl.max_commerciaux from plans pl where pl.code = e.plan),
           (select count(*)::integer from ventes v where v.entreprise_id = e.id and v.created_at > now() - interval '30 days'),
           coalesce((select sum(v.total) from ventes v where v.entreprise_id = e.id and v.created_at > now() - interval '30 days' and coalesce(v.statut, '') <> 'annulee'), 0),
           (select max(u.last_sign_in_at) from auth.users u join profils p on p.id = u.id where p.entreprise_id = e.id),
           coalesce((select w.solde from ia_portefeuilles w where w.entreprise_id = e.id), 0),
           coalesce((select sum(c.cout_usd) from consommation_ia c where c.entreprise_id = e.id and date_trunc('month', c.created_at) = date_trunc('month', now())), 0),
           (select u.email::text from auth.users u join profils p on p.id = u.id
             where p.entreprise_id = e.id and p.role = 'admin' and coalesce(p.actif, true) order by p.created_at limit 1)
    from entreprises e
    order by e.created_at desc;
end;
$$;

create or replace function plateforme_fiche_entreprise(p_entreprise_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  return jsonb_build_object(
    'utilisateurs', coalesce((select jsonb_agg(jsonb_build_object('nom', p.nom, 'role', p.role, 'actif', coalesce(p.actif, true),
                                'email', u.email, 'derniere_connexion', u.last_sign_in_at) order by p.role, p.nom)
                              from profils p left join auth.users u on u.id = p.id where p.entreprise_id = p_entreprise_id), '[]'::jsonb),
    'paiements', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
                             select * from paiements_abonnement where entreprise_id = p_entreprise_id order by created_at desc limit 20) x), '[]'::jsonb),
    'mouvements_ia', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
                                 select type, unites, montant_fcfa, fonction, motif, created_at from ia_mouvements
                                 where entreprise_id = p_entreprise_id order by created_at desc limit 30) x), '[]'::jsonb),
    'conso_ia_par_fonction', coalesce((select jsonb_agg(jsonb_build_object('fonction', fonction, 'appels', n, 'cout_usd', c))
                                       from (select fonction, count(*) n, sum(cout_usd) c from consommation_ia
                                             where entreprise_id = p_entreprise_id and created_at > now() - interval '30 days' group by fonction) t), '[]'::jsonb),
    'journal', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
                           select action, details, created_at from plateforme_journal where entreprise_id = p_entreprise_id order by created_at desc limit 20) x), '[]'::jsonb)
  );
end;
$$;

create or replace function plateforme_modifier_abonnement(
  p_entreprise_id uuid, p_plan text, p_statut text, p_cycle text, p_date_fin_essai date, p_date_echeance date, p_motif text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_avant jsonb;
begin
  perform exiger_super_admin();
  if coalesce(length(trim(p_motif)), 0) < 3 then raise exception 'le motif est obligatoire'; end if;
  if p_statut not in ('actif', 'essai', 'suspendu') then raise exception 'statut invalide'; end if;
  if p_cycle not in ('mensuel', 'annuel') then raise exception 'cycle invalide'; end if;
  if not exists (select 1 from plans where code = p_plan) then raise exception 'formule inconnue'; end if;
  select jsonb_build_object('plan', plan, 'statut', statut, 'cycle', cycle_facturation, 'fin_essai', date_fin_essai, 'echeance', date_prochaine_echeance)
    into v_avant from entreprises where id = p_entreprise_id;
  if v_avant is null then raise exception 'entreprise introuvable'; end if;
  update entreprises set plan = p_plan, statut = p_statut, cycle_facturation = p_cycle,
         date_fin_essai = p_date_fin_essai, date_prochaine_echeance = p_date_echeance
  where id = p_entreprise_id;
  perform journaliser_plateforme('modification_abonnement', p_entreprise_id, jsonb_build_object(
    'avant', v_avant, 'apres', jsonb_build_object('plan', p_plan, 'statut', p_statut, 'cycle', p_cycle, 'fin_essai', p_date_fin_essai, 'echeance', p_date_echeance),
    'motif', trim(p_motif)));
end;
$$;

-- Paiement reçu hors ligne (virement, espèces, Mobile Money manuel) en
-- attendant le paiement en ligne : active l'abonnement jusqu'à la fin de période.
create or replace function plateforme_enregistrer_paiement(
  p_entreprise_id uuid, p_plan text, p_cycle text, p_montant numeric, p_moyen text, p_reference text, p_debut date, p_fin date
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  perform exiger_super_admin();
  if p_montant is null or p_montant <= 0 then raise exception 'montant invalide'; end if;
  if p_fin is null or p_debut is null or p_fin < p_debut then raise exception 'période invalide'; end if;
  if not exists (select 1 from plans where code = p_plan) then raise exception 'formule inconnue'; end if;
  insert into paiements_abonnement (entreprise_id, plan_code, cycle, montant, transaction_id, moyen_paiement, statut, periode_debut, periode_fin, confirme_at)
  values (p_entreprise_id, p_plan, p_cycle, p_montant, nullif(trim(coalesce(p_reference, '')), ''), p_moyen, 'reussi', p_debut, p_fin, now())
  returning id into v_id;
  update entreprises set plan = p_plan, cycle_facturation = p_cycle, statut = 'actif', date_prochaine_echeance = p_fin
  where id = p_entreprise_id;
  perform journaliser_plateforme('paiement_abonnement', p_entreprise_id, jsonb_build_object(
    'montant', p_montant, 'plan', p_plan, 'cycle', p_cycle, 'moyen', p_moyen, 'reference', p_reference, 'periode', jsonb_build_array(p_debut, p_fin)));
  return v_id;
end;
$$;

create or replace function plateforme_crediter_ia(p_entreprise_id uuid, p_unites numeric, p_type text, p_montant numeric, p_motif text)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_solde numeric;
begin
  perform exiger_super_admin();
  if p_type not in ('achat', 'offert', 'ajustement', 'remboursement') then raise exception 'type invalide'; end if;
  if p_unites is null or p_unites = 0 then raise exception 'nombre d''unités invalide'; end if;
  if p_type in ('achat', 'offert') and p_unites < 0 then raise exception 'un achat ou un cadeau ajoute des unités'; end if;
  if coalesce(length(trim(p_motif)), 0) < 3 then raise exception 'le motif est obligatoire'; end if;
  v_solde := mouvement_ia(p_entreprise_id, p_type, p_unites, nullif(p_montant, 0), null, null, trim(p_motif));
  perform journaliser_plateforme('unites_ia', p_entreprise_id, jsonb_build_object('type', p_type, 'unites', p_unites, 'montant', p_montant, 'motif', trim(p_motif), 'nouveau_solde', v_solde));
  return v_solde;
end;
$$;

create or replace function plateforme_modifier_formule(p_code text, p_nom text, p_prix_mensuel numeric, p_prix_annuel numeric, p_max_commerciaux integer, p_actif boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  if p_prix_mensuel < 0 or p_prix_annuel < 0 then raise exception 'prix invalide'; end if;
  update plans set nom = trim(p_nom), prix_mensuel = p_prix_mensuel, prix_annuel = p_prix_annuel,
         max_commerciaux = p_max_commerciaux, actif = p_actif
  where code = p_code;
  if not found then raise exception 'formule inconnue'; end if;
  perform journaliser_plateforme('modification_formule', null, jsonb_build_object('code', p_code, 'nom', p_nom, 'prix_mensuel', p_prix_mensuel,
    'prix_annuel', p_prix_annuel, 'max_commerciaux', p_max_commerciaux, 'actif', p_actif));
end;
$$;

create or replace function plateforme_parametres_liste()
returns setof plateforme_parametres
language plpgsql
security definer
stable
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  return query select * from plateforme_parametres order by cle;
end;
$$;

create or replace function plateforme_modifier_parametre(p_cle text, p_valeur numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  if p_valeur is null or p_valeur < 0 then raise exception 'valeur invalide'; end if;
  update plateforme_parametres set valeur = p_valeur where cle = p_cle;
  if not found then raise exception 'paramètre inconnu'; end if;
  perform journaliser_plateforme('modification_parametre', null, jsonb_build_object('cle', p_cle, 'valeur', p_valeur));
end;
$$;

create or replace function plateforme_publier_annonce(p_titre text, p_message text, p_niveau text, p_fin timestamptz)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  perform exiger_super_admin();
  if coalesce(length(trim(p_titre)), 0) < 3 or coalesce(length(trim(p_message)), 0) < 3 then raise exception 'titre et message obligatoires'; end if;
  insert into annonces_plateforme (titre, message, niveau, fin, cree_par)
  values (trim(p_titre), trim(p_message), coalesce(p_niveau, 'info'), p_fin, auth.uid()) returning id into v_id;
  perform journaliser_plateforme('annonce', null, jsonb_build_object('titre', p_titre, 'niveau', p_niveau));
  return v_id;
end;
$$;

create or replace function plateforme_retirer_annonce(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  update annonces_plateforme set actif = false where id = p_id;
end;
$$;

create or replace function plateforme_journal_liste(p_limite integer default 100)
returns table (action text, entreprise text, details jsonb, auteur text, created_at timestamptz)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  return query
    select j.action, e.nom::text, j.details, u.email::text, j.created_at
    from plateforme_journal j left join entreprises e on e.id = j.entreprise_id left join auth.users u on u.id = j.auteur
    order by j.created_at desc limit least(greatest(p_limite, 1), 500);
end;
$$;

-- ===========================================================================
-- 6. Côté entreprise : « Mon abonnement »
-- ===========================================================================
create or replace function mon_abonnement()
returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_e record;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès réservé à la direction et au comptable'; end if;
  select * into v_e from entreprises where id = current_entreprise_id();
  return jsonb_build_object(
    'plan', v_e.plan, 'statut', v_e.statut, 'cycle', v_e.cycle_facturation,
    'date_fin_essai', v_e.date_fin_essai, 'date_prochaine_echeance', v_e.date_prochaine_echeance,
    'formule', (select to_jsonb(p) from plans p where p.code = v_e.plan),
    'formules', (select jsonb_agg(to_jsonb(p) order by p.ordre) from plans p where p.actif),
    'nb_commerciaux', (select count(*) from profils where entreprise_id = v_e.id and coalesce(actif, true) and role = 'commercial'),
    'solde_ia', ia_solde_disponible(v_e.id),
    'seuil_alerte_ia', parametre_plateforme('seuil_alerte_unites'),
    'conso_ia_30j', coalesce((select jsonb_agg(jsonb_build_object('fonction', fonction, 'unites', u)) from (
        select fonction, -sum(unites) u from ia_mouvements where entreprise_id = v_e.id and type = 'consommation'
          and created_at > now() - interval '30 days' group by fonction) t), '[]'::jsonb),
    'mouvements_ia', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select type, unites, montant_fcfa, fonction, motif, created_at from ia_mouvements where entreprise_id = v_e.id
        order by created_at desc limit 20) x), '[]'::jsonb),
    'paiements', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select plan_code, cycle, montant, moyen_paiement, statut, periode_debut, periode_fin, created_at
        from paiements_abonnement where entreprise_id = v_e.id order by created_at desc limit 12) x), '[]'::jsonb)
  );
end;
$$;

notify pgrst, 'reload schema';
