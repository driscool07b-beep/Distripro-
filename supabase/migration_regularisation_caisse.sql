-- Migration : régularisation d'un écart d'inventaire de caisse —
-- génère l'écriture correctrice dans le journal de caisse (le solde
-- comptable devient égal au solde compté), réservé aux rôles
-- configurables par l'entreprise.
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Réglage — qui peut régulariser un écart de caisse.
-- ---------------------------------------------------------------------
alter table entreprises add column if not exists roles_regularisation_caisse text[] not null default array['admin', 'manager'];

create or replace function modifier_parametrage_regularisation(p_roles text[])
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if current_role_utilisateur() <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut modifier ce réglage';
  end if;
  if p_roles is null or array_length(p_roles, 1) is null then
    raise exception 'au moins un rôle est requis';
  end if;
  update entreprises set roles_regularisation_caisse = p_roles where id = current_entreprise_id();
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Écriture de régularisation — montant signé (positif = surplus
--    trouvé, négatif = manque constaté), liée à l'inventaire qui l'a
--    déclenchée.
-- ---------------------------------------------------------------------
create table if not exists caisse_regularisations (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  numero text,
  caisse_id uuid not null references caisses(id),
  inventaire_id uuid references inventaires_caisse(id),
  montant numeric(14,2) not null,
  motif text not null,
  regularise_par uuid not null references profils(id),
  created_at timestamptz not null default now()
);

create or replace function generer_numero_regularisation()
returns trigger language plpgsql as $$
declare v_compteur int;
begin
  select count(*) + 1 into v_compteur from caisse_regularisations
  where entreprise_id = new.entreprise_id and extract(year from created_at) = extract(year from now());
  new.numero := 'REG-' || extract(year from now()) || '-' || lpad(v_compteur::text, 5, '0');
  return new;
end;
$$;
drop trigger if exists trg_numero_regularisation on caisse_regularisations;
create trigger trg_numero_regularisation before insert on caisse_regularisations
for each row execute function generer_numero_regularisation();

alter table caisse_regularisations enable row level security;
drop policy if exists caisse_regularisations_select on caisse_regularisations;
create policy caisse_regularisations_select on caisse_regularisations
  for select using (entreprise_id = current_entreprise_id());

-- ---------------------------------------------------------------------
-- 3. Marque l'inventaire comme régularisé (traçabilité, empêche une
--    double régularisation du même écart).
-- ---------------------------------------------------------------------
alter table inventaires_caisse add column if not exists regularise_par uuid references profils(id);
alter table inventaires_caisse add column if not exists regularise_at timestamptz;

create or replace function regulariser_inventaire_caisse(p_inventaire_id uuid, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_roles_autorises text[];
  v_inventaire record;
  v_id uuid;
begin
  select roles_regularisation_caisse into v_roles_autorises from entreprises where id = v_entreprise_id;
  if not (v_role = any(v_roles_autorises)) then
    raise exception 'accès refusé : votre rôle n''est pas autorisé à régulariser un écart de caisse';
  end if;

  select * into v_inventaire from inventaires_caisse
  where id = p_inventaire_id and entreprise_id = v_entreprise_id
  for update;
  if not found then raise exception 'inventaire introuvable'; end if;
  if v_inventaire.ecart = 0 then raise exception 'aucun écart à régulariser pour cet inventaire'; end if;
  if v_inventaire.regularise_at is not null then raise exception 'cet inventaire a déjà été régularisé'; end if;

  insert into caisse_regularisations (entreprise_id, caisse_id, inventaire_id, montant, motif, regularise_par)
  values (
    v_entreprise_id, v_inventaire.caisse_id, p_inventaire_id, v_inventaire.ecart,
    'Régularisation suite à inventaire ' || v_inventaire.numero || coalesce(' — ' || nullif(trim(p_notes), ''), ''),
    auth.uid()
  )
  returning id into v_id;

  update inventaires_caisse set regularise_par = auth.uid(), regularise_at = now() where id = p_inventaire_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. solde_caisse / journal_caisse — intègrent les régularisations.
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
    + coalesce((select sum(montant) from caisse_approvisionnements where caisse_id = p_caisse_id), 0)
    + coalesce((select sum(montant) from caisse_retours_fonds where caisse_id = p_caisse_id), 0)
    + coalesce((select sum(montant) from caisse_transferts where caisse_destination_id = p_caisse_id and statut = 'receptionnee'), 0)
    + coalesce((select sum(montant) from caisse_regularisations where caisse_id = p_caisse_id), 0)
    - coalesce((select sum(montant_valide) from demandes_decaissement where caisse_id = p_caisse_id and statut = 'payee'), 0)
    - coalesce((select sum(montant) from caisse_transferts where caisse_source_id = p_caisse_id), 0);
$$;

create or replace function journal_caisse(p_caisse_id uuid, p_date_debut date default null, p_date_fin date default null)
returns table (
  date_mouvement timestamptz,
  numero text,
  type_mouvement text,
  libelle text,
  debit numeric,
  credit numeric,
  solde numeric
)
language sql
security definer
stable
set search_path to 'public'
as $$
  with mouvements as (
    select v.created_at as date_mouvement, v.numero, 'versement'::text as type_mouvement,
           'Versement — ' || coalesce(p.nom, '?') as libelle, 0::numeric as debit, v.montant as credit
    from versements_caisse v
    left join profils p on p.id = v.commercial_id
    where v.caisse_id = p_caisse_id

    union all
    select a.created_at, a.numero, 'approvisionnement',
           'Approvisionnement (' || a.source || ') — ' || a.libelle, 0, a.montant
    from caisse_approvisionnements a
    where a.caisse_id = p_caisse_id

    union all
    select r.created_at, r.numero, 'retour_fonds',
           'Retour de fonds — ' || r.motif, 0, r.montant
    from caisse_retours_fonds r
    where r.caisse_id = p_caisse_id

    union all
    select d.payee_at, d.numero, 'decaissement',
           'Décaissement — ' || d.libelle, d.montant_valide, 0
    from demandes_decaissement d
    where d.caisse_id = p_caisse_id and d.statut = 'payee'

    union all
    select t.created_at, t.numero, 'transfert_sortant',
           'Transfert sortant — ' || coalesce(t.libelle, coalesce(t.destination_banque, 'vers autre caisse')), t.montant, 0
    from caisse_transferts t
    where t.caisse_source_id = p_caisse_id

    union all
    select t.receptionne_at, t.numero, 'transfert_entrant',
           'Transfert entrant — ' || coalesce(t.libelle, 'depuis autre caisse'), 0, t.montant
    from caisse_transferts t
    where t.caisse_destination_id = p_caisse_id and t.statut = 'receptionnee'

    union all
    select r.created_at, r.numero, 'regularisation',
           r.motif, case when r.montant < 0 then abs(r.montant) else 0 end, case when r.montant > 0 then r.montant else 0 end
    from caisse_regularisations r
    where r.caisse_id = p_caisse_id
  )
  select
    date_mouvement, numero, type_mouvement, libelle, debit, credit,
    sum(credit - debit) over (order by date_mouvement, numero rows between unbounded preceding and current row) as solde
  from mouvements
  where date_mouvement is not null
    and (p_date_debut is null or date_mouvement::date >= p_date_debut)
    and (p_date_fin is null or date_mouvement::date <= p_date_fin)
  order by date_mouvement, numero;
$$;
