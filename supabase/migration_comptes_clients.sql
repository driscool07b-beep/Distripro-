-- Migration : comptes clients et règlement groupé.
-- 1. Chaque client a un compte (sous-compte du 411) ; chaque groupe de
--    clients a un compte PRINCIPAL, parent des comptes de ses membres :
--      4112001      Groupe « Chaîne X »         (compte du groupe)
--      4112001001   Magasin X Cocody            (membre du groupe)
--      41110001     Boutique isolée             (client sans groupe)
--    Les écritures sont passées sur le compte du client ; le groupe sert au
--    regroupement dans les états (balance clients).
-- 2. Attribution AUTOMATIQUE (numéro libre suivant, jamais un compte existant)
--    ou MANUELLE (entreprises qui migrent avec leurs comptes).
-- 3. Règlement GROUPÉ : un paiement réparti sur les factures des membres
--    d'un groupe (un règlement par facture, même référence) ; l'excédent
--    devient un avoir au crédit du client désigné.
-- À exécuter dans l'éditeur SQL de Supabase.

-- ===========================================================================
-- 1. Paramètres et colonnes
-- ===========================================================================
alter table entreprises add column if not exists comptes_clients_mode text not null default 'auto';
alter table entreprises drop constraint if exists entreprises_comptes_clients_mode_check;
alter table entreprises add constraint entreprises_comptes_clients_mode_check check (comptes_clients_mode in ('auto', 'manuel'));
alter table entreprises add column if not exists compte_racine_clients text not null default '4111';
alter table entreprises add column if not exists compte_racine_groupes text not null default '4112';

alter table clients add column if not exists compte_numero text;
alter table groupes_clients add column if not exists compte_numero text;
create unique index if not exists idx_clients_compte_unique on clients (entreprise_id, compte_numero) where compte_numero is not null;
create unique index if not exists idx_groupes_compte_unique on groupes_clients (entreprise_id, compte_numero) where compte_numero is not null;

create or replace function modifier_parametres_comptes_clients(p_mode text, p_racine_clients text, p_racine_groupes text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_role_utilisateur() not in ('admin') then raise exception 'seul un administrateur peut modifier ces paramètres'; end if;
  if p_mode not in ('auto', 'manuel') then raise exception 'mode invalide'; end if;
  if coalesce(p_racine_clients, '') !~ '^[0-9]{2,10}$' or coalesce(p_racine_groupes, '') !~ '^[0-9]{2,10}$' then
    raise exception 'racine de compte invalide (chiffres uniquement)';
  end if;
  if p_racine_clients = p_racine_groupes then raise exception 'les racines clients et groupes doivent être différentes'; end if;
  update entreprises set comptes_clients_mode = p_mode, compte_racine_clients = p_racine_clients, compte_racine_groupes = p_racine_groupes
  where id = current_entreprise_id();
end;
$$;

-- Un numéro est « pris » s'il existe dans le plan comptable, chez un client
-- ou chez un groupe de l'entreprise.
create or replace function compte_deja_pris(p_entreprise_id uuid, p_numero text)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $$
  select exists (select 1 from plan_comptable where entreprise_id = p_entreprise_id and numero_compte = p_numero)
      or exists (select 1 from clients where entreprise_id = p_entreprise_id and compte_numero = p_numero)
      or exists (select 1 from groupes_clients where entreprise_id = p_entreprise_id and compte_numero = p_numero);
$$;

create or replace function prochain_compte_libre(p_entreprise_id uuid, p_racine text, p_largeur integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rang integer := 1;
  v_numero text;
begin
  loop
    v_numero := p_racine || lpad(v_rang::text, p_largeur, '0');
    exit when not compte_deja_pris(p_entreprise_id, v_numero);
    v_rang := v_rang + 1;
    if v_rang > power(10, p_largeur) - 1 then raise exception 'plus de numéro libre sous la racine %', p_racine; end if;
  end loop;
  return v_numero;
end;
$$;

-- Inscrit le compte au plan comptable s'il n'y est pas (libellé = nom).
create or replace function inscrire_au_plan(p_entreprise_id uuid, p_numero text, p_libelle text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into plan_comptable (entreprise_id, numero_compte, libelle)
  values (p_entreprise_id, p_numero, p_libelle)
  on conflict (entreprise_id, numero_compte) do nothing;
$$;

create or replace function assurer_compte_groupe(p_groupe_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_g record;
  v_numero text;
begin
  select g.*, e.compte_racine_groupes into v_g from groupes_clients g join entreprises e on e.id = g.entreprise_id where g.id = p_groupe_id;
  if not found then raise exception 'groupe introuvable'; end if;
  if v_g.compte_numero is not null then return v_g.compte_numero; end if;
  v_numero := prochain_compte_libre(v_g.entreprise_id, v_g.compte_racine_groupes, 3);
  update groupes_clients set compte_numero = v_numero where id = p_groupe_id;
  perform inscrire_au_plan(v_g.entreprise_id, v_numero, 'Groupe — ' || v_g.nom);
  return v_numero;
end;
$$;

create or replace function assurer_compte_client(p_client_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_c record;
  v_numero text;
begin
  select c.*, e.compte_racine_clients into v_c from clients c join entreprises e on e.id = c.entreprise_id where c.id = p_client_id;
  if not found then raise exception 'client introuvable'; end if;
  if v_c.compte_numero is not null then return v_c.compte_numero; end if;
  if v_c.groupe_id is not null then
    v_numero := prochain_compte_libre(v_c.entreprise_id, assurer_compte_groupe(v_c.groupe_id), 3);
  else
    v_numero := prochain_compte_libre(v_c.entreprise_id, v_c.compte_racine_clients, 4);
  end if;
  update clients set compte_numero = v_numero where id = p_client_id;
  perform inscrire_au_plan(v_c.entreprise_id, v_numero, v_c.nom);
  return v_numero;
end;
$$;

-- ===========================================================================
-- 2. Attribution automatique à la création, contrôle des saisies manuelles
-- ===========================================================================
create or replace function controler_compte_client()
returns trigger
language plpgsql
as $$
begin
  if new.compte_numero is not null then
    new.compte_numero := trim(new.compte_numero);
    if new.compte_numero !~ '^[0-9]{3,15}$' then raise exception 'numéro de compte client invalide (chiffres uniquement)'; end if;
  end if;
  if tg_op = 'UPDATE' and new.compte_numero is distinct from old.compte_numero and old.compte_numero is not null
     and current_user in ('authenticated', 'anon')
     and current_role_utilisateur() not in ('admin', 'manager', 'comptable') then
    raise exception 'seuls l''administrateur, le manager ou le comptable changent un compte client';
  end if;
  if new.compte_numero is not null and (tg_op = 'INSERT' or new.compte_numero is distinct from old.compte_numero) then
    if exists (select 1 from groupes_clients where entreprise_id = new.entreprise_id and compte_numero = new.compte_numero) then
      raise exception 'ce numéro est déjà le compte d''un groupe';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_controler_compte_client on clients;
create trigger trg_controler_compte_client before insert or update on clients
  for each row execute function controler_compte_client();

create or replace function apres_client_compte()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_mode text;
begin
  if new.compte_numero is not null then
    perform inscrire_au_plan(new.entreprise_id, new.compte_numero, new.nom);
  elsif tg_op = 'INSERT' then
    select comptes_clients_mode into v_mode from entreprises where id = new.entreprise_id;
    if v_mode = 'auto' then perform assurer_compte_client(new.id); end if;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_apres_client_compte on clients;
create trigger trg_apres_client_compte after insert or update of compte_numero on clients
  for each row execute function apres_client_compte();

create or replace function apres_groupe_compte()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_mode text;
begin
  if new.compte_numero is not null then
    perform inscrire_au_plan(new.entreprise_id, new.compte_numero, 'Groupe — ' || new.nom);
  elsif tg_op = 'INSERT' then
    select comptes_clients_mode into v_mode from entreprises where id = new.entreprise_id;
    if v_mode = 'auto' then perform assurer_compte_groupe(new.id); end if;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_apres_groupe_compte on groupes_clients;
create trigger trg_apres_groupe_compte after insert or update of compte_numero on groupes_clients
  for each row execute function apres_groupe_compte();

-- Saisie / correction manuelle d'un compte (client ou groupe).
create or replace function definir_compte_client(p_client_id uuid, p_numero text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_numero text := nullif(trim(coalesce(p_numero, '')), '');
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;
  if v_numero is not null and exists (select 1 from clients where entreprise_id = v_entreprise_id and compte_numero = v_numero and id <> p_client_id) then
    raise exception 'ce numéro est déjà attribué à un autre client';
  end if;
  update clients set compte_numero = v_numero where id = p_client_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'client introuvable'; end if;
end;
$$;

create or replace function definir_compte_groupe(p_groupe_id uuid, p_numero text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_numero text := nullif(trim(coalesce(p_numero, '')), '');
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;
  if v_numero is not null and v_numero !~ '^[0-9]{3,15}$' then raise exception 'numéro invalide (chiffres uniquement)'; end if;
  if v_numero is not null and (exists (select 1 from groupes_clients where entreprise_id = v_entreprise_id and compte_numero = v_numero and id <> p_groupe_id)
     or exists (select 1 from clients where entreprise_id = v_entreprise_id and compte_numero = v_numero)) then
    raise exception 'ce numéro est déjà attribué';
  end if;
  update groupes_clients set compte_numero = v_numero where id = p_groupe_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'groupe introuvable'; end if;
end;
$$;

-- Attribue un compte à tous les clients et groupes qui n'en ont pas.
create or replace function attribuer_comptes_manquants()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_nb integer := 0;
  v_id uuid;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;
  for v_id in select id from groupes_clients where entreprise_id = v_entreprise_id and compte_numero is null order by created_at loop
    perform assurer_compte_groupe(v_id); v_nb := v_nb + 1;
  end loop;
  for v_id in select id from clients where entreprise_id = v_entreprise_id and compte_numero is null order by created_at loop
    perform assurer_compte_client(v_id); v_nb := v_nb + 1;
  end loop;
  return v_nb;
end;
$$;

-- ===========================================================================
-- 3. Balance clients (regroupée par groupe)
-- ===========================================================================
create or replace function balance_clients()
returns table (compte text, client text, groupe text, compte_groupe text, total_facture numeric, total_regle numeric, solde numeric)
language sql
security definer
stable
set search_path to 'public'
as $$
  select c.compte_numero, c.nom, g.nom, g.compte_numero,
         coalesce(sum(v.total) filter (where coalesce(v.statut, '') <> 'annulee'), 0),
         coalesce(sum(v.montant_regle) filter (where coalesce(v.statut, '') <> 'annulee'), 0),
         coalesce(sum(v.total - v.montant_regle) filter (where coalesce(v.statut, '') <> 'annulee'), 0)
  from clients c
  left join groupes_clients g on g.id = c.groupe_id
  left join ventes v on v.client_id = c.id
  where c.entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager', 'comptable')
  group by c.id, g.id
  order by coalesce(g.compte_numero, c.compte_numero), c.compte_numero nulls last, c.nom;
$$;

-- ===========================================================================
-- 4. Règlement groupé
-- ===========================================================================
alter table mouvements_credit_client drop constraint if exists mouvements_credit_client_type_mouvement_check;
alter table mouvements_credit_client add constraint mouvements_credit_client_type_mouvement_check
  check (type_mouvement in ('credit_annulation', 'utilisation_vente', 'remboursement', 'credit_excedent'));

create table if not exists reglements_groupes (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id),
  numero text not null,
  groupe_id uuid not null references groupes_clients(id),
  montant numeric(14, 2) not null check (montant > 0),
  mode text not null,
  reference_paiement text,
  banque_id uuid references banques(id),
  excedent numeric(14, 2) not null default 0,
  client_excedent_id uuid references clients(id),
  created_by uuid references profils(id),
  created_at timestamptz not null default now()
);
alter table reglements add column if not exists reglement_groupe_id uuid references reglements_groupes(id);
alter table reglements_groupes enable row level security;
drop policy if exists reglements_groupes_select on reglements_groupes;
create policy reglements_groupes_select on reglements_groupes
  for select using (entreprise_id = current_entreprise_id());

create or replace function enregistrer_reglement_groupe(
  p_groupe_id uuid, p_montant numeric, p_mode text, p_repartition jsonb,
  p_reference text default null, p_banque_id uuid default null, p_client_excedent_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_id uuid;
  v_numero text;
  v_item jsonb;
  v_vente record;
  v_part numeric;
  v_total_reparti numeric := 0;
  v_reglement_id uuid;
  v_excedent numeric;
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'règlement groupé réservé à la direction et au comptable'; end if;
  if p_montant is null or p_montant <= 0 then raise exception 'montant invalide'; end if;
  perform 1 from groupes_clients where id = p_groupe_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'groupe introuvable'; end if;
  if p_mode in ('cheque', 'virement', 'mobile_money') and coalesce(length(trim(p_reference)), 0) < 2 then
    raise exception 'indiquez la référence du paiement (n° de chèque, de virement…)';
  end if;

  select 'RGP-' || to_char(now(), 'YYYY') || '-' || lpad((count(*) + 1)::text, 5, '0') into v_numero
  from reglements_groupes where entreprise_id = v_entreprise_id and to_char(created_at, 'YYYY') = to_char(now(), 'YYYY');

  insert into reglements_groupes (entreprise_id, numero, groupe_id, montant, mode, reference_paiement, banque_id, created_by)
  values (v_entreprise_id, v_numero, p_groupe_id, p_montant, p_mode, nullif(trim(coalesce(p_reference, '')), ''), p_banque_id, auth.uid())
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_repartition, '[]'::jsonb)) loop
    v_part := coalesce((v_item->>'montant')::numeric, 0);
    if v_part <= 0 then continue; end if;
    select v.* into v_vente from ventes v join clients c on c.id = v.client_id
    where v.id = (v_item->>'vente_id')::uuid and v.entreprise_id = v_entreprise_id and c.groupe_id = p_groupe_id;
    if not found then raise exception 'une facture répartie n''appartient pas à un membre de ce groupe'; end if;
    v_total_reparti := v_total_reparti + v_part;
    v_reglement_id := enregistrer_reglement(v_vente.id, v_part, p_mode, null, p_banque_id,
                                            coalesce(nullif(trim(coalesce(p_reference, '')), ''), v_numero));
    update reglements set reglement_groupe_id = v_id where id = v_reglement_id;
  end loop;

  if v_total_reparti > p_montant then raise exception 'la répartition (%) dépasse le montant reçu (%)', v_total_reparti, p_montant; end if;

  -- Excédent : avoir au crédit du client désigné (membre du groupe).
  v_excedent := p_montant - v_total_reparti;
  if v_excedent > 0 then
    if p_client_excedent_id is null then raise exception 'désignez le client qui reçoit l''excédent de % en avoir', v_excedent; end if;
    perform 1 from clients where id = p_client_excedent_id and groupe_id = p_groupe_id;
    if not found then raise exception 'le client de l''excédent doit être membre du groupe'; end if;
    update clients set solde_credit = coalesce(solde_credit, 0) + v_excedent where id = p_client_excedent_id;
    insert into mouvements_credit_client (entreprise_id, client_id, montant, type_mouvement, motif, effectue_par)
    values (v_entreprise_id, p_client_excedent_id, v_excedent, 'credit_excedent', 'Excédent du règlement groupé ' || v_numero, auth.uid());
    update reglements_groupes set excedent = v_excedent, client_excedent_id = p_client_excedent_id where id = v_id;
  end if;
  return v_id;
end;
$$;

notify pgrst, 'reload schema';
