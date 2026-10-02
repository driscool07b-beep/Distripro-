-- Migration : paiement en ligne (CinetPay — Mobile Money et cartes).
-- - Paiement de l'abonnement (formule, mensuel ou annuel) et achat de packs
--   d'unités IA, directement depuis « Mon abonnement ».
-- - Le montant est TOUJOURS calculé côté serveur (formule ou pack), jamais
--   transmis par le navigateur.
-- - Validation unique et idempotente : au retour du client, à la
--   notification CinetPay ou par la vérification automatique (toutes les
--   15 minutes) ; seulement si CinetPay confirme et si le montant correspond.
-- À exécuter dans l'éditeur SQL de Supabase (après migration_console_plateforme.sql).

-- Packs d'unités IA proposés aux clients (modifiables dans la console).
create table if not exists ia_packs (
  code text primary key,
  nom text not null,
  unites integer not null check (unites > 0),
  prix integer not null check (prix > 0),
  ordre integer not null default 0,
  actif boolean not null default true
);
alter table ia_packs enable row level security;
drop policy if exists ia_packs_select on ia_packs;
create policy ia_packs_select on ia_packs for select using (auth.uid() is not null);
insert into ia_packs (code, nom, unites, prix, ordre) values
  ('decouverte', 'Découverte', 5000, 5000, 1),
  ('standard', 'Standard', 20000, 19000, 2),
  ('intensif', 'Intensif', 50000, 45000, 3)
on conflict (code) do nothing;

create table if not exists paiements_en_ligne (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  objet text not null check (objet in ('abonnement', 'unites')),
  plan_code text,
  cycle text check (cycle in ('mensuel', 'annuel')),
  pack_code text,
  unites integer,
  montant integer not null check (montant > 0),
  transaction_id text not null unique,
  statut text not null default 'initie' check (statut in ('initie', 'reussi', 'echoue', 'expire')),
  lien_paiement text,
  moyen text,
  reponse_operateur jsonb,
  cree_par uuid references auth.users(id),
  created_at timestamptz not null default now(),
  finalise_at timestamptz
);
create index if not exists idx_paiements_en_ligne_statut on paiements_en_ligne (statut, created_at);
alter table paiements_en_ligne enable row level security;
drop policy if exists paiements_en_ligne_select on paiements_en_ligne;
create policy paiements_en_ligne_select on paiements_en_ligne for select using (
  est_super_admin() or (entreprise_id = current_entreprise_id() and current_role_utilisateur() in ('admin', 'manager', 'comptable')));

-- Gestion des packs depuis la console.
create or replace function plateforme_modifier_pack(p_code text, p_nom text, p_unites integer, p_prix integer, p_actif boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  if p_unites <= 0 or p_prix <= 0 or p_prix % 5 <> 0 then raise exception 'unités et prix positifs, prix multiple de 5 (exigence CinetPay)'; end if;
  insert into ia_packs (code, nom, unites, prix, actif) values (p_code, trim(p_nom), p_unites, p_prix, p_actif)
  on conflict (code) do update set nom = excluded.nom, unites = excluded.unites, prix = excluded.prix, actif = excluded.actif;
  perform journaliser_plateforme('modification_pack_ia', null, jsonb_build_object('code', p_code, 'unites', p_unites, 'prix', p_prix, 'actif', p_actif));
end;
$$;

-- Validation d'un paiement en ligne : appelée UNIQUEMENT par la fonction
-- serveur (après vérification auprès de CinetPay). Idempotente.
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
  if v_p.statut <> 'initie' then return v_p.statut; end if; -- déjà traité

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
  else
    -- Abonnement prolongé à partir de l'échéance en cours (ou d'aujourd'hui).
    select * into v_e from entreprises where id = v_p.entreprise_id for update;
    v_debut := greatest(coalesce(v_e.date_prochaine_echeance + 1, current_date), current_date);
    if v_e.statut <> 'actif' then v_debut := current_date; end if;
    v_fin := case when v_p.cycle = 'annuel' then (v_debut + interval '1 year')::date - 1 else (v_debut + interval '1 month')::date - 1 end;
    insert into paiements_abonnement (entreprise_id, plan_code, cycle, montant, transaction_id, moyen_paiement, statut, periode_debut, periode_fin, confirme_at)
    values (v_p.entreprise_id, v_p.plan_code, v_p.cycle, v_p.montant, p_transaction_id, coalesce(p_moyen, 'cinetpay'), 'reussi', v_debut, v_fin, now());
    update entreprises set plan = v_p.plan_code, cycle_facturation = v_p.cycle, statut = 'actif', date_prochaine_echeance = v_fin
    where id = v_p.entreprise_id;
  end if;
  insert into plateforme_journal (action, entreprise_id, details)
  values ('paiement_en_ligne', v_p.entreprise_id, jsonb_build_object('objet', v_p.objet, 'montant', v_p.montant, 'transaction', p_transaction_id, 'moyen', p_moyen));
  return 'reussi';
end;
$$;
revoke all on function finaliser_paiement_en_ligne(text, boolean, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function finaliser_paiement_en_ligne(text, boolean, numeric, text, jsonb) to service_role;

-- La fiche entreprise de la console montre aussi les paiements en ligne.
create or replace function plateforme_paiements_en_ligne(p_entreprise_id uuid default null)
returns setof paiements_en_ligne
language plpgsql
security definer
stable
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  return query select * from paiements_en_ligne
    where p_entreprise_id is null or entreprise_id = p_entreprise_id
    order by created_at desc limit 100;
end;
$$;

-- Vérification automatique des paiements restés en attente (toutes les 15 min).
select cron.unschedule('verifier-paiements-cinetpay')
where exists (select 1 from cron.job where jobname = 'verifier-paiements-cinetpay');
select cron.schedule(
  'verifier-paiements-cinetpay',
  '*/15 * * * *',
  $cron$
    select net.http_post(
      url := 'https://eikazcqkimnaguwzlahd.supabase.co/functions/v1/paiement-cinetpay',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'apikey', (select valeur from public.plateforme_secrets where cle = 'cle_publique'),
        'x-rapport-secret', (select valeur from public.plateforme_secrets where cle = 'rapport_mensuel')),
      body := '{"action": "verifier_en_attente"}'::jsonb,
      timeout_milliseconds := 120000
    )
    where exists (select 1 from public.paiements_en_ligne where statut = 'initie' and created_at > now() - interval '2 days');
  $cron$
);

notify pgrst, 'reload schema';
