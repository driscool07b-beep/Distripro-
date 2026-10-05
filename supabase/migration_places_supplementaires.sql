-- Migration : utilisateurs inclus par rôle et places supplémentaires.
-- Les commerciaux restent limités par la formule (max_commerciaux). Pour les
-- autres rôles (admin, manager, comptable, gestionnaire de stock, agent de
-- recouvrement) :
--  - chaque formule inclut N utilisateurs PAR RÔLE (réglable ; null = illimité) ;
--  - au-delà, l'entreprise achète des PLACES SUPPLÉMENTAIRES : une réserve
--    commune à tous les rôles, au prix mensuel fixé par formule ;
--  - contrôle dans la base à l'invitation, au changement de rôle et à la
--    réactivation ; aucune limite pendant l'essai ; les utilisateurs déjà
--    actifs ne sont jamais désactivés.
-- À exécuter dans l'éditeur SQL de Supabase (après migration_paiement_en_ligne.sql).

alter table plans add column if not exists utilisateurs_par_role integer;      -- null = illimité
alter table plans add column if not exists prix_place_supp integer not null default 3000;
update plans set utilisateurs_par_role = case code when 'entreprise' then 3 else 1 end
where utilisateurs_par_role is null;

alter table entreprises add column if not exists places_supp integer not null default 0 check (places_supp >= 0);
alter table paiements_en_ligne add column if not exists places integer;
alter table paiements_en_ligne drop constraint if exists paiements_en_ligne_objet_check;
alter table paiements_en_ligne add constraint paiements_en_ligne_objet_check check (objet in ('abonnement', 'unites', 'places'));

-- Seuls la plateforme et le promoteur changent le nombre de places achetées.
create or replace function proteger_places_supp()
returns trigger
language plpgsql
as $$
begin
  if new.places_supp is distinct from old.places_supp and current_user in ('authenticated', 'anon') then
    raise exception 'modification non autorisée : les places supplémentaires s''achètent depuis Mon abonnement';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_proteger_places_supp on entreprises;
create trigger trg_proteger_places_supp before update of places_supp on entreprises
  for each row execute function proteger_places_supp();

-- Situation des places d'une entreprise : par rôle (actifs + invitations en
-- attente), inclus, dépassement total, places achetées.
create or replace function situation_places(p_entreprise_id uuid)
returns jsonb
language sql
security definer
stable
set search_path to 'public'
as $$
  with e as (
    select e.id, e.statut, e.places_supp, p.utilisateurs_par_role as inclus, p.prix_place_supp as prix
    from entreprises e left join plans p on p.code = e.plan where e.id = p_entreprise_id
  ), r as (
    select role, count(*) as n from (
      select role from profils where entreprise_id = p_entreprise_id and actif is not false and role <> 'commercial'
      union all
      select role from invitations where entreprise_id = p_entreprise_id and statut = 'en_attente' and role <> 'commercial'
    ) x group by role
  )
  select jsonb_build_object(
    'inclus_par_role', (select inclus from e),
    'prix_place', (select prix from e),
    'places_achetees', (select places_supp from e),
    'essai', (select statut = 'essai' from e),
    'roles', coalesce((select jsonb_object_agg(role, n) from r), '{}'::jsonb),
    'depassement', case when (select inclus from e) is null then 0
                        else coalesce((select sum(greatest(n - (select inclus from e), 0)) from r), 0) end
  );
$$;

-- Contrôle commun : l'ajout d'un utilisateur de rôle p_role tient-il dans
-- les places incluses + achetées ? (aucune limite pendant l'essai)
create or replace function verifier_place_disponible(p_entreprise_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_s jsonb;
  v_inclus integer;
  v_actuel integer;
  v_depassement_apres integer;
begin
  if p_role = 'commercial' then return; end if;
  v_s := situation_places(p_entreprise_id);
  if coalesce((v_s->>'essai')::boolean, false) or v_s->>'inclus_par_role' is null then return; end if;
  v_inclus := (v_s->>'inclus_par_role')::integer;
  v_actuel := coalesce((v_s->'roles'->>p_role)::integer, 0);
  -- Dépassement si on ajoute une personne de plus dans ce rôle.
  v_depassement_apres := (v_s->>'depassement')::integer
    + case when v_actuel + 1 > v_inclus then 1 else 0 end;
  if v_depassement_apres > (v_s->>'places_achetees')::integer then
    raise exception 'quota_utilisateurs_atteint: votre formule inclut % utilisateur(s) par rôle et vos % place(s) supplémentaire(s) sont toutes utilisées — ajoutez une place dans Mon abonnement',
      v_inclus, (v_s->>'places_achetees')::integer;
  end if;
end;
$$;
revoke all on function verifier_place_disponible(uuid, text) from public, anon, authenticated;

-- À l'envoi d'une invitation.
create or replace function controler_place_invitation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.statut = 'en_attente' then perform verifier_place_disponible(new.entreprise_id, new.role); end if;
  return new;
end;
$$;
drop trigger if exists trg_controler_place_invitation on invitations;
create trigger trg_controler_place_invitation before insert on invitations
  for each row execute function controler_place_invitation();

-- Au changement de rôle et à la réactivation (l'acceptation d'une invitation
-- a déjà été comptée à l'envoi : elle n'est pas contrôlée une seconde fois).
create or replace function controler_place_profil()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.role = 'commercial' or new.actif is false then return new; end if;
  if tg_op = 'INSERT' then return new; end if;
  if old.role = new.role and old.actif is not false then return new; end if;
  perform verifier_place_disponible(new.entreprise_id, new.role);
  return new;
end;
$$;
drop trigger if exists trg_controler_place_profil on profils;
create trigger trg_controler_place_profil before update of role, actif on profils
  for each row execute function controler_place_profil();

-- Montant du renouvellement : formule + places supplémentaires (même cycle).
create or replace function montant_abonnement(p_entreprise_id uuid, p_plan text, p_cycle text, p_places integer)
returns integer
language sql
security definer
stable
set search_path to 'public'
as $$
  select (case when p_cycle = 'annuel' then p.prix_annuel + round(coalesce(p_places, 0) * p.prix_place_supp * 12 * 0.8)
               else p.prix_mensuel + coalesce(p_places, 0) * p.prix_place_supp end)::integer
  from plans p where p.code = p_plan;
$$;

-- Prix au prorata pour ajouter des places en cours de période.
create or replace function prix_places_prorata(p_entreprise_id uuid, p_places integer)
returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_e record;
  v_jours integer;
  v_montant integer;
begin
  select e.statut, e.cycle_facturation, e.date_prochaine_echeance, p.prix_place_supp
    into v_e from entreprises e join plans p on p.code = e.plan where e.id = p_entreprise_id;
  if v_e.statut <> 'actif' or v_e.date_prochaine_echeance is null or v_e.date_prochaine_echeance < current_date then
    return jsonb_build_object('possible', false, 'motif', 'abonnement_inactif');
  end if;
  v_jours := v_e.date_prochaine_echeance - current_date + 1;
  v_montant := case when v_e.cycle_facturation = 'annuel'
                    then ceil(p_places * v_e.prix_place_supp * 12 * 0.8 * v_jours / 365.0)
                    else ceil(p_places * v_e.prix_place_supp * v_jours / 30.0) end;
  v_montant := greatest(ceil(v_montant / 5.0) * 5, 100);  -- CinetPay : multiple de 5
  return jsonb_build_object('possible', true, 'montant', v_montant, 'jours', v_jours, 'prix_place', v_e.prix_place_supp,
                            'echeance', v_e.date_prochaine_echeance, 'cycle', v_e.cycle_facturation);
end;
$$;

-- Finalisation des paiements en ligne : ajout du cas « places » et des
-- places incluses dans le paiement d'abonnement. (Remplace la version de
-- migration_paiement_en_ligne.sql, même logique pour le reste.)
create or replace function finaliser_paiement_en_ligne(p_transaction_id text, p_accepte boolean, p_montant numeric, p_moyen text, p_reponse jsonb)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_p record;
  v_e record;
  v_debut date;
  v_fin date;
begin
  select * into v_p from paiements_en_ligne where transaction_id = p_transaction_id for update;
  if not found then return 'inconnu'; end if;
  if v_p.statut <> 'initie' then return v_p.statut; end if;

  if not p_accepte then
    update paiements_en_ligne set statut = 'echoue', reponse_operateur = p_reponse, finalise_at = now() where id = v_p.id;
    return 'echoue';
  end if;
  if coalesce(p_montant, 0) < v_p.montant then
    update paiements_en_ligne set statut = 'echoue', reponse_operateur = p_reponse || jsonb_build_object('motif', 'montant différent'), finalise_at = now() where id = v_p.id;
    return 'echoue';
  end if;

  update paiements_en_ligne set statut = 'reussi', moyen = p_moyen, reponse_operateur = p_reponse, finalise_at = now() where id = v_p.id;

  if v_p.objet = 'unites' then
    perform mouvement_ia(v_p.entreprise_id, 'achat', v_p.unites, v_p.montant, null, null, 'Achat en ligne — pack ' || coalesce(v_p.pack_code, '') || ' (' || p_transaction_id || ')');
  elsif v_p.objet = 'places' then
    update entreprises set places_supp = places_supp + coalesce(v_p.places, 0) where id = v_p.entreprise_id;
  else
    select * into v_e from entreprises where id = v_p.entreprise_id for update;
    v_debut := greatest(coalesce(v_e.date_prochaine_echeance + 1, current_date), current_date);
    if v_e.statut <> 'actif' then v_debut := current_date; end if;
    v_fin := case when v_p.cycle = 'annuel' then (v_debut + interval '1 year')::date - 1 else (v_debut + interval '1 month')::date - 1 end;
    insert into paiements_abonnement (entreprise_id, plan_code, cycle, montant, transaction_id, moyen_paiement, statut, periode_debut, periode_fin, confirme_at)
    values (v_p.entreprise_id, v_p.plan_code, v_p.cycle, v_p.montant, p_transaction_id, coalesce(p_moyen, 'cinetpay'), 'reussi', v_debut, v_fin, now());
    update entreprises set plan = v_p.plan_code, cycle_facturation = v_p.cycle, statut = 'actif', date_prochaine_echeance = v_fin,
           places_supp = greatest(places_supp, coalesce(v_p.places, places_supp))
    where id = v_p.entreprise_id;
  end if;
  insert into plateforme_journal (action, entreprise_id, details)
  values ('paiement_en_ligne', v_p.entreprise_id, jsonb_build_object('objet', v_p.objet, 'montant', v_p.montant, 'transaction', p_transaction_id, 'moyen', p_moyen, 'places', v_p.places));
  return 'reussi';
end;
$$;
revoke all on function finaliser_paiement_en_ligne(text, boolean, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function finaliser_paiement_en_ligne(text, boolean, numeric, text, jsonb) to service_role;

-- Console : réglages par formule et places d'une entreprise.
create or replace function plateforme_modifier_places_formule(p_code text, p_utilisateurs_par_role integer, p_prix_place_supp integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  if p_prix_place_supp < 0 or (p_utilisateurs_par_role is not null and p_utilisateurs_par_role < 1) then raise exception 'valeurs invalides'; end if;
  update plans set utilisateurs_par_role = p_utilisateurs_par_role, prix_place_supp = p_prix_place_supp where code = p_code;
  if not found then raise exception 'formule inconnue'; end if;
  perform journaliser_plateforme('modification_places_formule', null, jsonb_build_object('code', p_code, 'inclus', p_utilisateurs_par_role, 'prix', p_prix_place_supp));
end;
$$;

create or replace function plateforme_definir_places(p_entreprise_id uuid, p_places integer, p_motif text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  if p_places is null or p_places < 0 then raise exception 'nombre de places invalide'; end if;
  if coalesce(length(trim(p_motif)), 0) < 3 then raise exception 'le motif est obligatoire'; end if;
  update entreprises set places_supp = p_places where id = p_entreprise_id;
  perform journaliser_plateforme('places_supplementaires', p_entreprise_id, jsonb_build_object('places', p_places, 'motif', trim(p_motif)));
end;
$$;

create or replace function plateforme_situation_places(p_entreprise_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  return situation_places(p_entreprise_id);
end;
$$;

-- « Mon abonnement » : situation des places de son entreprise.
create or replace function mes_places()
returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès réservé à la direction et au comptable'; end if;
  return situation_places(current_entreprise_id()) || jsonb_build_object('prorata_une_place', prix_places_prorata(current_entreprise_id(), 1));
end;
$$;

notify pgrst, 'reload schema';
