-- Migration : quotité des retenues sur salaire (en %) et acte de cession.
-- - Le plafond mensuel des retenues s'exprime en POURCENTAGE du salaire de
--   référence de chaque commercial (assiette : brut + accessoires − impôts et
--   prélèvements obligatoires), en plus de l'éventuel plafond en montant ;
--   le plus bas des deux s'applique. Taux à faire valider par le RH / le
--   conseil (référence : décret n° 2014-370 du 18 juin 2014).
-- - Les salaires de référence sont dans une table à accès RESTREINT
--   (administrateur et comptable) : jamais visibles par l'équipe.
-- À exécuter dans l'éditeur SQL de Supabase.

alter table entreprises add column if not exists quotite_retenue_pourcentage numeric(5, 2);
alter table entreprises drop constraint if exists entreprises_quotite_check;
alter table entreprises add constraint entreprises_quotite_check
  check (quotite_retenue_pourcentage is null or (quotite_retenue_pourcentage > 0 and quotite_retenue_pourcentage <= 100));

create table if not exists salaires_reference (
  profil_id uuid primary key references profils(id) on delete cascade,
  entreprise_id uuid not null references entreprises(id),
  montant numeric(14, 2) not null check (montant > 0),
  maj_par uuid references profils(id),
  maj_at timestamptz not null default now()
);
alter table salaires_reference enable row level security;
drop policy if exists salaires_reference_select on salaires_reference;
create policy salaires_reference_select on salaires_reference
  for select using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'comptable')
  );

create or replace function definir_salaire_reference(p_profil_id uuid, p_montant numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
begin
  if current_role_utilisateur() not in ('admin', 'comptable') then raise exception 'accès réservé à l''administrateur et au comptable'; end if;
  if p_montant is null or p_montant <= 0 then raise exception 'salaire de référence invalide'; end if;
  perform 1 from profils where id = p_profil_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'membre introuvable'; end if;
  insert into salaires_reference (profil_id, entreprise_id, montant, maj_par, maj_at)
  values (p_profil_id, v_entreprise_id, p_montant, auth.uid(), now())
  on conflict (profil_id) do update set montant = excluded.montant, maj_par = auth.uid(), maj_at = now();
end;
$$;

create or replace function modifier_quotite_retenue(p_pourcentage numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_role_utilisateur() <> 'admin' then raise exception 'seul un administrateur peut modifier ce paramètre'; end if;
  if p_pourcentage is not null and (p_pourcentage <= 0 or p_pourcentage > 100) then raise exception 'pourcentage invalide'; end if;
  update entreprises set quotite_retenue_pourcentage = p_pourcentage where id = current_entreprise_id();
end;
$$;

-- Plafond mensuel applicable à un commercial : le plus bas entre le plafond
-- en montant et la quotité × son salaire de référence (null = aucun plafond).
create or replace function plafond_retenue_commercial(p_commercial_id uuid)
returns numeric
language sql
security definer
stable
set search_path to 'public'
as $$
  select case
    when e.quotite_retenue_pourcentage is not null and s.montant is not null and e.plafond_retenue_mensuelle is not null
      then least(e.plafond_retenue_mensuelle, floor(s.montant * e.quotite_retenue_pourcentage / 100))
    when e.quotite_retenue_pourcentage is not null and s.montant is not null
      then floor(s.montant * e.quotite_retenue_pourcentage / 100)
    else e.plafond_retenue_mensuelle
  end
  from profils p
  join entreprises e on e.id = p.entreprise_id
  left join salaires_reference s on s.profil_id = p.id
  where p.id = p_commercial_id and p.entreprise_id = current_entreprise_id();
$$;

drop function if exists recouvrement_force(uuid, numeric, integer, text, text);
create or replace function recouvrement_force(
  p_commercial_id uuid, p_montant numeric, p_nb_mensualites integer, p_premiere_periode text, p_motif text,
  p_salaire_reference numeric default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_e record;
  v_solde numeric;
  v_mensualite numeric;
  v_avance_id uuid;
  v_nom text;
  v_plafond numeric;
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'comptable') then raise exception 'recouvrement forcé réservé à l''administrateur et au comptable'; end if;
  if coalesce(length(trim(p_motif)), 0) < 3 then raise exception 'le motif est obligatoire'; end if;
  if p_nb_mensualites is null or p_nb_mensualites < 1 or p_nb_mensualites > 60 then raise exception 'nombre de mensualités invalide (1 à 60)'; end if;
  if p_premiere_periode !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'premier mois de retenue invalide'; end if;
  v_solde := solde_dette_commercial(p_commercial_id);
  if p_montant is null or p_montant <= 0 or p_montant > v_solde then
    raise exception 'montant invalide : la dette restante est de %', v_solde;
  end if;

  select * into v_e from entreprises where id = v_entreprise_id;
  v_mensualite := ceil(p_montant / p_nb_mensualites);
  -- Salaire de référence (assiette : brut + accessoires − impôts et
  -- prélèvements obligatoires) : enregistré s'il est fourni.
  if p_salaire_reference is not null then
    if p_salaire_reference <= 0 then raise exception 'salaire de référence invalide'; end if;
    insert into salaires_reference (profil_id, entreprise_id, montant, maj_par, maj_at)
    values (p_commercial_id, v_entreprise_id, p_salaire_reference, auth.uid(), now())
    on conflict (profil_id) do update set montant = excluded.montant, maj_par = auth.uid(), maj_at = now();
  end if;
  if v_e.quotite_retenue_pourcentage is not null
     and not exists (select 1 from salaires_reference where profil_id = p_commercial_id) then
    raise exception 'indiquez le salaire de référence du commercial pour appliquer la quotité de % %%', v_e.quotite_retenue_pourcentage;
  end if;
  v_plafond := plafond_retenue_commercial(p_commercial_id);
  if v_plafond is not null and v_mensualite > v_plafond then
    raise exception 'mensualité de % supérieure au plafond de retenue (%) : augmentez le nombre de mensualités', v_mensualite, v_plafond;
  end if;
  select nom into v_nom from profils where id = p_commercial_id;

  insert into avances_salaire (entreprise_id, commercial_id, montant, nb_mensualites, mensualite, premiere_periode, motif, cree_par)
  values (v_entreprise_id, p_commercial_id, p_montant, p_nb_mensualites, v_mensualite, p_premiere_periode, trim(p_motif), auth.uid())
  returning id into v_avance_id;

  insert into dettes_commerciaux (entreprise_id, commercial_id, type, montant, motif, effectue_par)
  values (v_entreprise_id, p_commercial_id, 'transfert_salaire', p_montant, 'Recouvrement forcé — retenue sur salaire : ' || trim(p_motif), auth.uid());

  -- Reclassement : la dette quitte le compte de tiers (471) pour le compte
  -- d'avances au personnel (421). Écriture passée ici uniquement.
  perform passer_ecriture(v_entreprise_id, (now() at time zone 'Africa/Abidjan')::date, 'OD', null,
                          assurer_compte_avance(p_commercial_id), assurer_compte_commercial(p_commercial_id),
                          'Recouvrement forcé — dette reclassée en avance sur salaire — ' || coalesce(v_nom, ''),
                          p_montant, 'recouvrement_force', v_avance_id);
  return v_avance_id;
end;
$$;

create or replace function enregistrer_retenue_salaire(p_avance_id uuid, p_periode_paie text, p_montant numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a record;
  v_e record;
  v_restant numeric;
  v_nom text;
  v_plafond numeric;
begin
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'comptable') then raise exception 'accès réservé à l''administrateur et au comptable'; end if;
  select * into v_a from avances_salaire where id = p_avance_id and entreprise_id = current_entreprise_id() for update;
  if not found then raise exception 'avance introuvable'; end if;
  if v_a.statut = 'soldee' then raise exception 'cette avance est déjà soldée'; end if;
  if p_periode_paie !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'mois de paie invalide'; end if;
  if exists (select 1 from retenues_salaire where avance_id = p_avance_id and periode_paie = p_periode_paie) then
    raise exception 'une retenue est déjà enregistrée pour ce mois de paie';
  end if;
  v_restant := restant_avance(p_avance_id);
  if p_montant is null or p_montant <= 0 or p_montant > v_restant then
    raise exception 'montant invalide : il reste % à retenir', v_restant;
  end if;
  select * into v_e from entreprises where id = v_a.entreprise_id;
  v_plafond := plafond_retenue_commercial(v_a.commercial_id);
  if v_plafond is not null and p_montant > v_plafond then
    raise exception 'retenue supérieure au plafond mensuel (%)', v_plafond;
  end if;

  insert into retenues_salaire (entreprise_id, avance_id, periode_paie, montant, comptabilisee_par, cree_par)
  values (v_a.entreprise_id, p_avance_id, p_periode_paie, p_montant, v_e.retenues_comptabilisees_par, auth.uid());

  -- Écriture 422 / 421 SEULEMENT si DistribPro est désigné pour la passer ;
  -- sinon c'est le logiciel de paie qui la comptabilise (pas de doublon).
  if v_e.retenues_comptabilisees_par = 'distribpro' then
    select nom into v_nom from profils where id = v_a.commercial_id;
    perform passer_ecriture(v_a.entreprise_id, (to_date(p_periode_paie || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date,
                            'OD', p_periode_paie, v_e.compte_remuneration_numero, assurer_compte_avance(v_a.commercial_id),
                            'Retenue sur salaire ' || p_periode_paie || ' — ' || coalesce(v_nom, ''), p_montant, 'retenue_salaire', p_avance_id);
  end if;

  if p_montant = v_restant then
    update avances_salaire set statut = 'soldee' where id = p_avance_id;
  end if;
end;
$$;

notify pgrst, 'reload schema';
