-- Migration : plan comptable + export d'écritures comptables
-- compatible Sage Saari Compta / Ciel Compta (format d'import
-- paramétrable — Date, Code journal, N° compte, Libellé, N° pièce,
-- Débit, Crédit).
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Plan comptable — propre à chaque entreprise.
-- ---------------------------------------------------------------------
create table if not exists plan_comptable (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  numero_compte text not null,
  libelle text not null,
  created_at timestamptz not null default now(),
  unique (entreprise_id, numero_compte)
);

alter table plan_comptable enable row level security;
drop policy if exists plan_comptable_select on plan_comptable;
create policy plan_comptable_select on plan_comptable
  for select using (entreprise_id = current_entreprise_id());

create or replace function creer_compte_comptable(p_numero_compte text, p_libelle text)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_id uuid;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;
  if p_numero_compte is null or trim(p_numero_compte) = '' then raise exception 'le numéro de compte est requis'; end if;
  if p_libelle is null or trim(p_libelle) = '' then raise exception 'le libellé est requis'; end if;

  insert into plan_comptable (entreprise_id, numero_compte, libelle)
  values (v_entreprise_id, trim(p_numero_compte), trim(p_libelle))
  on conflict (entreprise_id, numero_compte) do update set libelle = excluded.libelle
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function importer_plan_comptable(p_comptes jsonb)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_compte jsonb;
  v_total integer := 0;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;

  for v_compte in select * from jsonb_array_elements(p_comptes)
  loop
    if v_compte->>'numero_compte' is not null and trim(v_compte->>'numero_compte') <> ''
       and v_compte->>'libelle' is not null and trim(v_compte->>'libelle') <> '' then
      insert into plan_comptable (entreprise_id, numero_compte, libelle)
      values (v_entreprise_id, trim(v_compte->>'numero_compte'), trim(v_compte->>'libelle'))
      on conflict (entreprise_id, numero_compte) do update set libelle = excluded.libelle;
      v_total := v_total + 1;
    end if;
  end loop;

  return v_total;
end;
$$;

create or replace function supprimer_compte_comptable(p_compte_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;
  delete from plan_comptable where id = p_compte_id and entreprise_id = current_entreprise_id();
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Rattachement de chaque caisse/banque à un compte de trésorerie,
--    et comptes de contrepartie par défaut par type de mouvement.
-- ---------------------------------------------------------------------
alter table caisses add column if not exists compte_comptable_id uuid references plan_comptable(id);
alter table banques add column if not exists compte_comptable_id uuid references plan_comptable(id);

alter table entreprises add column if not exists compte_charges_decaissement_id uuid references plan_comptable(id);
alter table entreprises add column if not exists compte_clients_defaut_id uuid references plan_comptable(id);
alter table entreprises add column if not exists compte_ecarts_caisse_id uuid references plan_comptable(id);
alter table entreprises add column if not exists compte_apports_defaut_id uuid references plan_comptable(id);
alter table entreprises add column if not exists code_journal_caisse text not null default 'CA';
alter table entreprises add column if not exists code_journal_banque text not null default 'BQ';

create or replace function affecter_compte_caisse(p_caisse_id uuid, p_compte_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;
  update caisses set compte_comptable_id = p_compte_id
  where id = p_caisse_id and entreprise_id = current_entreprise_id();
end;
$$;

create or replace function affecter_compte_banque(p_banque_id uuid, p_compte_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;
  update banques set compte_comptable_id = p_compte_id
  where id = p_banque_id and entreprise_id = current_entreprise_id();
end;
$$;

create or replace function modifier_comptes_par_defaut(
  p_compte_charges_id uuid default null,
  p_compte_clients_id uuid default null,
  p_compte_ecarts_id uuid default null,
  p_compte_apports_id uuid default null,
  p_code_journal_caisse text default 'CA',
  p_code_journal_banque text default 'BQ'
)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if current_role_utilisateur() <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut modifier ce réglage';
  end if;
  update entreprises
  set compte_charges_decaissement_id = p_compte_charges_id,
      compte_clients_defaut_id = p_compte_clients_id,
      compte_ecarts_caisse_id = p_compte_ecarts_id,
      compte_apports_defaut_id = p_compte_apports_id,
      code_journal_caisse = coalesce(nullif(trim(p_code_journal_caisse), ''), 'CA'),
      code_journal_banque = coalesce(nullif(trim(p_code_journal_banque), ''), 'BQ')
  where id = current_entreprise_id();
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Export d'écritures comptables — combine journal_caisse() /
--    journal_banque() (déjà en place) avec les comptes affectés, en
--    générant les 2 lignes (compte de trésorerie + contrepartie) de
--    chaque écriture en partie double.
-- ---------------------------------------------------------------------
create or replace function exporter_ecritures_caisse(p_caisse_id uuid, p_date_debut date, p_date_fin date)
returns table (
  date_piece date, code_journal text, numero_compte text, libelle_compte text,
  numero_piece text, libelle_ecriture text, debit numeric, credit numeric
)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_compte_caisse text;
  v_libelle_caisse text;
  v_code_journal text;
  v_compte_charges text;
  v_libelle_charges text;
  v_compte_clients text;
  v_libelle_clients text;
  v_compte_ecarts text;
  v_libelle_ecarts text;
  v_compte_apports text;
  v_libelle_apports text;
  v_ligne record;
  v_compte_contrepartie text;
  v_libelle_contrepartie text;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;

  select pc.numero_compte, pc.libelle into v_compte_caisse, v_libelle_caisse
  from caisses c join plan_comptable pc on pc.id = c.compte_comptable_id
  where c.id = p_caisse_id and c.entreprise_id = v_entreprise_id;
  if v_compte_caisse is null then raise exception 'aucun compte comptable affecté à cette caisse'; end if;

  select code_journal_caisse into v_code_journal from entreprises where id = v_entreprise_id;

  select pc.numero_compte, pc.libelle into v_compte_charges, v_libelle_charges
  from entreprises e join plan_comptable pc on pc.id = e.compte_charges_decaissement_id where e.id = v_entreprise_id;
  select pc.numero_compte, pc.libelle into v_compte_clients, v_libelle_clients
  from entreprises e join plan_comptable pc on pc.id = e.compte_clients_defaut_id where e.id = v_entreprise_id;
  select pc.numero_compte, pc.libelle into v_compte_ecarts, v_libelle_ecarts
  from entreprises e join plan_comptable pc on pc.id = e.compte_ecarts_caisse_id where e.id = v_entreprise_id;
  select pc.numero_compte, pc.libelle into v_compte_apports, v_libelle_apports
  from entreprises e join plan_comptable pc on pc.id = e.compte_apports_defaut_id where e.id = v_entreprise_id;

  for v_ligne in select * from journal_caisse(p_caisse_id, p_date_debut, p_date_fin)
  loop
    case v_ligne.type_mouvement
      when 'versement' then v_compte_contrepartie := v_compte_clients; v_libelle_contrepartie := v_libelle_clients;
      when 'decaissement' then v_compte_contrepartie := v_compte_charges; v_libelle_contrepartie := v_libelle_charges;
      when 'retour_fonds' then v_compte_contrepartie := v_compte_charges; v_libelle_contrepartie := v_libelle_charges;
      when 'approvisionnement' then v_compte_contrepartie := v_compte_apports; v_libelle_contrepartie := v_libelle_apports;
      when 'regularisation' then v_compte_contrepartie := v_compte_ecarts; v_libelle_contrepartie := v_libelle_ecarts;
      else v_compte_contrepartie := null; v_libelle_contrepartie := null;
    end case;

    if v_ligne.type_mouvement in ('transfert_sortant', 'transfert_entrant') then
      v_compte_contrepartie := coalesce(v_compte_charges, 'A_COMPLETER');
      v_libelle_contrepartie := 'Virement interne — à vérifier le compte de destination';
    end if;

    if v_compte_contrepartie is null then
      v_compte_contrepartie := 'A_COMPLETER';
      v_libelle_contrepartie := 'Compte non paramétré — ' || v_ligne.type_mouvement;
    end if;

    date_piece := v_ligne.date_mouvement::date;
    code_journal := v_code_journal;
    numero_compte := v_compte_caisse;
    libelle_compte := v_libelle_caisse;
    numero_piece := v_ligne.numero;
    libelle_ecriture := v_ligne.libelle;
    debit := v_ligne.debit;
    credit := v_ligne.credit;
    return next;

    numero_compte := v_compte_contrepartie;
    libelle_compte := v_libelle_contrepartie;
    debit := v_ligne.credit;
    credit := v_ligne.debit;
    return next;
  end loop;
end;
$$;

create or replace function exporter_ecritures_banque(p_banque_id uuid, p_date_debut date, p_date_fin date)
returns table (
  date_piece date, code_journal text, numero_compte text, libelle_compte text,
  numero_piece text, libelle_ecriture text, debit numeric, credit numeric
)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_compte_banque text;
  v_libelle_banque text;
  v_code_journal text;
  v_compte_clients text;
  v_libelle_clients text;
  v_compte_charges text;
  v_libelle_charges text;
  v_ligne record;
  v_compte_contrepartie text;
  v_libelle_contrepartie text;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;

  select pc.numero_compte, pc.libelle into v_compte_banque, v_libelle_banque
  from banques b join plan_comptable pc on pc.id = b.compte_comptable_id
  where b.id = p_banque_id and b.entreprise_id = v_entreprise_id;
  if v_compte_banque is null then raise exception 'aucun compte comptable affecté à cette banque'; end if;

  select code_journal_banque into v_code_journal from entreprises where id = v_entreprise_id;
  select pc.numero_compte, pc.libelle into v_compte_clients, v_libelle_clients
  from entreprises e join plan_comptable pc on pc.id = e.compte_clients_defaut_id where e.id = v_entreprise_id;
  select pc.numero_compte, pc.libelle into v_compte_charges, v_libelle_charges
  from entreprises e join plan_comptable pc on pc.id = e.compte_charges_decaissement_id where e.id = v_entreprise_id;

  for v_ligne in select * from journal_banque(p_banque_id, p_date_debut, p_date_fin)
  loop
    case v_ligne.type_mouvement
      when 'reglement' then v_compte_contrepartie := v_compte_clients; v_libelle_contrepartie := v_libelle_clients;
      when 'sortie_directe' then v_compte_contrepartie := v_compte_charges; v_libelle_contrepartie := v_libelle_charges;
      else v_compte_contrepartie := coalesce(v_compte_charges, 'A_COMPLETER'); v_libelle_contrepartie := 'Virement interne — à vérifier le compte de destination';
    end case;

    if v_compte_contrepartie is null then
      v_compte_contrepartie := 'A_COMPLETER';
      v_libelle_contrepartie := 'Compte non paramétré — ' || v_ligne.type_mouvement;
    end if;

    date_piece := v_ligne.date_mouvement::date;
    code_journal := v_code_journal;
    numero_compte := v_compte_banque;
    libelle_compte := v_libelle_banque;
    numero_piece := v_ligne.numero;
    libelle_ecriture := coalesce(v_ligne.reference, '') || case when v_ligne.reference is not null then ' — ' else '' end || v_ligne.libelle;
    debit := v_ligne.debit;
    credit := v_ligne.credit;
    return next;

    numero_compte := v_compte_contrepartie;
    libelle_compte := v_libelle_contrepartie;
    debit := v_ligne.credit;
    credit := v_ligne.debit;
    return next;
  end loop;
end;
$$;
