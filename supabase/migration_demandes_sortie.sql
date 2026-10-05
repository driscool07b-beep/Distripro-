-- Migration : demandes de sortie de produits (commercial → gestionnaire de stock)
--
-- Le commercial demande la marchandise dont il a besoin pour sa tournée
-- (produits, quantités, magasin, date souhaitée), éventuellement avec une
-- proposition de l'IA. Le gestionnaire de stock (ou admin/manager) accorde
-- tout ou partie, ou refuse avec un motif. Accorder crée directement la
-- sortie de stock habituelle (creer_sortie_stock) : aucun circuit parallèle.
--
-- Cycle : en_attente → accordee | partielle | refusee | annulee
-- Rien n'est supprimé : chaque étape garde qui et quand.
--
-- À exécuter dans l'éditeur SQL de Supabase (après
-- migration_restriction_depots_gestionnaire.sql).

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists demandes_sortie (
  id              uuid primary key default gen_random_uuid(),
  entreprise_id   uuid not null references entreprises(id) on delete cascade,
  numero          text,
  commercial_id   uuid not null references profils(id),
  depot_id        uuid not null references depots(id),
  date_souhaitee  date not null default current_date,
  commentaire     text,
  statut          text not null default 'en_attente'
                  check (statut in ('en_attente', 'accordee', 'partielle', 'refusee', 'annulee')),
  proposee_par_ia boolean not null default false,
  synthese_ia     text,
  traite_par      uuid references profils(id),
  traite_le       timestamptz,
  motif_traitement text,
  sortie_id       uuid references sorties_stock(id),
  created_at      timestamptz not null default now()
);

create index if not exists idx_demandes_sortie_entreprise on demandes_sortie(entreprise_id, statut);
create index if not exists idx_demandes_sortie_commercial on demandes_sortie(commercial_id);

create table if not exists demande_sortie_lignes (
  id                 uuid primary key default gen_random_uuid(),
  entreprise_id      uuid not null references entreprises(id) on delete cascade,
  demande_id         uuid not null references demandes_sortie(id) on delete cascade,
  produit_id         uuid not null references produits(id),
  quantite_demandee  integer not null check (quantite_demandee > 0),
  quantite_accordee  integer check (quantite_accordee >= 0),
  raison_ia          text
);

create index if not exists idx_demande_sortie_lignes_demande on demande_sortie_lignes(demande_id);

-- Numérotation DS-AAAA-00001 par entreprise et par année
create or replace function generer_numero_demande_sortie()
returns trigger
language plpgsql
as $$
declare
  compteur int;
begin
  perform pg_advisory_xact_lock(hashtext('demandes_sortie' || new.entreprise_id::text));
  select count(*) + 1 into compteur
  from demandes_sortie
  where entreprise_id = new.entreprise_id
    and extract(year from created_at) = extract(year from now());
  new.numero := 'DS-' || extract(year from now()) || '-' || lpad(compteur::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists trg_numero_demande_sortie on demandes_sortie;
create trigger trg_numero_demande_sortie
before insert on demandes_sortie
for each row execute function generer_numero_demande_sortie();

-- ---------------------------------------------------------------------
-- 2. Sécurité : lecture seulement, toute écriture passe par les RPC
-- ---------------------------------------------------------------------
alter table demandes_sortie enable row level security;
alter table demande_sortie_lignes enable row level security;

drop policy if exists demandes_sortie_select on demandes_sortie;
create policy demandes_sortie_select on demandes_sortie
  for select using (
    entreprise_id = current_entreprise_id()
    and (current_role_utilisateur() in ('admin', 'manager', 'gestionnaire_stock') or commercial_id = auth.uid())
  );

drop policy if exists demande_sortie_lignes_select on demande_sortie_lignes;
create policy demande_sortie_lignes_select on demande_sortie_lignes
  for select using (
    entreprise_id = current_entreprise_id()
    and exists (
      select 1 from demandes_sortie d
      where d.id = demande_sortie_lignes.demande_id
        and (current_role_utilisateur() in ('admin', 'manager', 'gestionnaire_stock') or d.commercial_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- 3. Le commercial crée sa demande
-- p_lignes : [{ "produit_id": "...", "quantite": 12, "raison_ia": "..." }]
-- ---------------------------------------------------------------------
create or replace function creer_demande_sortie(
  p_depot_id uuid,
  p_date_souhaitee date,
  p_lignes jsonb,
  p_commentaire text default null,
  p_proposee_par_ia boolean default false,
  p_synthese_ia text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_demande_id uuid;
  v_ligne jsonb;
  v_produit_id uuid;
  v_quantite integer;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role <> 'commercial' then
    raise exception 'accès refusé : seul un commercial peut demander une sortie de produits';
  end if;
  if not exists (select 1 from depots where id = p_depot_id and entreprise_id = v_entreprise_id and actif) then
    raise exception 'magasin introuvable';
  end if;
  if p_date_souhaitee < current_date then
    raise exception 'la date souhaitée ne peut pas être passée';
  end if;
  if p_lignes is null or jsonb_array_length(p_lignes) = 0 then
    raise exception 'la demande doit contenir au moins un article';
  end if;

  insert into demandes_sortie (entreprise_id, commercial_id, depot_id, date_souhaitee, commentaire, proposee_par_ia, synthese_ia)
  values (v_entreprise_id, auth.uid(), p_depot_id, p_date_souhaitee,
          nullif(left(trim(coalesce(p_commentaire, '')), 500), ''),
          coalesce(p_proposee_par_ia, false), nullif(left(coalesce(p_synthese_ia, ''), 1000), ''))
  returning id into v_demande_id;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_quantite := (v_ligne->>'quantite')::integer;
    if v_quantite is null or v_quantite <= 0 then
      continue;
    end if;
    if not exists (select 1 from produits where id = v_produit_id and entreprise_id = v_entreprise_id) then
      raise exception 'produit introuvable';
    end if;
    insert into demande_sortie_lignes (entreprise_id, demande_id, produit_id, quantite_demandee, raison_ia)
    values (v_entreprise_id, v_demande_id, v_produit_id, v_quantite, nullif(left(coalesce(v_ligne->>'raison_ia', ''), 200), ''));
  end loop;

  if not exists (select 1 from demande_sortie_lignes where demande_id = v_demande_id) then
    raise exception 'la demande doit contenir au moins un article';
  end if;

  return v_demande_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Le commercial annule sa demande tant qu'elle est en attente
-- ---------------------------------------------------------------------
create or replace function annuler_demande_sortie(p_demande_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update demandes_sortie
  set statut = 'annulee', traite_par = auth.uid(), traite_le = now()
  where id = p_demande_id
    and entreprise_id = current_entreprise_id()
    and commercial_id = auth.uid()
    and statut = 'en_attente';
  if not found then
    raise exception 'demande introuvable ou déjà traitée';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Le gestionnaire accorde (tout ou partie) ou refuse
-- p_lignes : [{ "ligne_id": "...", "quantite_accordee": 10 }]
-- p_depot_id : magasin réellement utilisé (peut différer de celui demandé)
-- Accorder 0 partout = refuser (motif obligatoire).
-- ---------------------------------------------------------------------
create or replace function traiter_demande_sortie(
  p_demande_id uuid,
  p_depot_id uuid,
  p_lignes jsonb,
  p_motif text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_demande demandes_sortie%rowtype;
  v_ligne record;
  v_accorde integer;
  v_lignes_sortie jsonb := '[]'::jsonb;
  v_total_demande integer := 0;
  v_total_accorde integer := 0;
  v_sortie_id uuid;
  v_statut text;
begin
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de traiter une demande de sortie';
  end if;

  select * into v_demande from demandes_sortie
  where id = p_demande_id and entreprise_id = v_entreprise_id
  for update;
  if v_demande.id is null then
    raise exception 'demande introuvable';
  end if;
  if v_demande.statut <> 'en_attente' then
    raise exception 'cette demande a déjà été traitée';
  end if;
  if not mon_depot_autorise(coalesce(p_depot_id, v_demande.depot_id)) then
    raise exception 'accès refusé : ce dépôt ne vous est pas attribué';
  end if;

  for v_ligne in select * from demande_sortie_lignes where demande_id = p_demande_id
  loop
    select greatest(coalesce((x->>'quantite_accordee')::integer, 0), 0) into v_accorde
    from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) x
    where (x->>'ligne_id')::uuid = v_ligne.id;
    v_accorde := coalesce(v_accorde, 0);

    update demande_sortie_lignes set quantite_accordee = v_accorde where id = v_ligne.id;
    v_total_demande := v_total_demande + v_ligne.quantite_demandee;
    v_total_accorde := v_total_accorde + v_accorde;
    if v_accorde > 0 then
      v_lignes_sortie := v_lignes_sortie || jsonb_build_object('produit_id', v_ligne.produit_id, 'quantite', v_accorde);
    end if;
  end loop;

  if v_total_accorde = 0 then
    if nullif(trim(coalesce(p_motif, '')), '') is null then
      raise exception 'un motif est obligatoire pour refuser une demande';
    end if;
    v_statut := 'refusee';
  else
    -- Même chemin que « + Nouvelle sortie de stock » : contrôle du stock
    -- magasin, lots, journal de stock, stock en main du commercial.
    v_sortie_id := creer_sortie_stock(v_demande.commercial_id, coalesce(p_depot_id, v_demande.depot_id), v_lignes_sortie);
    v_statut := case when v_total_accorde >= v_total_demande
                      and not exists (select 1 from demande_sortie_lignes where demande_id = p_demande_id and quantite_accordee < quantite_demandee)
                     then 'accordee' else 'partielle' end;
    if v_statut = 'partielle' and nullif(trim(coalesce(p_motif, '')), '') is null then
      raise exception 'un motif est obligatoire pour une demande accordée en partie';
    end if;
  end if;

  update demandes_sortie
  set statut = v_statut,
      traite_par = auth.uid(),
      traite_le = now(),
      motif_traitement = nullif(left(trim(coalesce(p_motif, '')), 500), ''),
      sortie_id = v_sortie_id,
      depot_id = coalesce(p_depot_id, v_demande.depot_id)
  where id = p_demande_id;

  return v_sortie_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Temps réel (badge du menu, liste qui se met à jour seule)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'demandes_sortie') then
    alter publication supabase_realtime add table demandes_sortie;
  end if;
end $$;
