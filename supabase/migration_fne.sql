-- Migration : Facture Normalisée Électronique (FNE, DGI Côte d'Ivoire).
-- Référence : « Procédure d'interfaçage des entreprises par API », DGI, mai 2025.
-- - Configuration FNE par entreprise (clé API SECRÈTE : lisible seulement par
--   la fonction serveur « certifier-fne », jamais par l'application).
-- - Clients : NCC et type FNE (B2B entreprise, B2C particulier, B2G
--   administration, B2F international).
-- - Ventes : FNE demandée ou non (case à cocher), statut, référence DGI,
--   lien de vérification (QR code), avoir certifié.
-- - Journal de tous les échanges avec la DGI.
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists fne_config (
  entreprise_id uuid primary key references entreprises(id) on delete cascade,
  actif boolean not null default false,
  mode text not null default 'test' check (mode in ('test', 'production')),
  base_url text not null default 'http://54.247.95.108/ws',
  api_key text,
  point_de_vente text,
  etablissement text,
  fne_par_defaut boolean not null default true,
  maj_par uuid references profils(id),
  maj_at timestamptz not null default now()
);
-- RLS activée SANS politique de lecture : la clé API n'est jamais exposée.
alter table fne_config enable row level security;

create or replace function definir_config_fne(
  p_actif boolean, p_mode text, p_base_url text, p_api_key text,
  p_point_de_vente text, p_etablissement text, p_par_defaut boolean
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
begin
  if current_role_utilisateur() <> 'admin' then raise exception 'seul un administrateur configure la FNE'; end if;
  if p_mode not in ('test', 'production') then raise exception 'mode invalide'; end if;
  if coalesce(trim(p_base_url), '') !~ '^https?://' then raise exception 'adresse de la plateforme FNE invalide'; end if;
  if p_actif and (coalesce(trim(p_point_de_vente), '') = '' or coalesce(trim(p_etablissement), '') = '') then
    raise exception 'le point de vente et l''établissement sont obligatoires (exigés par la DGI)';
  end if;
  insert into fne_config (entreprise_id, actif, mode, base_url, api_key, point_de_vente, etablissement, fne_par_defaut, maj_par, maj_at)
  values (v_entreprise_id, p_actif, p_mode, trim(p_base_url), nullif(trim(coalesce(p_api_key, '')), ''),
          trim(p_point_de_vente), trim(p_etablissement), p_par_defaut, auth.uid(), now())
  on conflict (entreprise_id) do update set
    actif = excluded.actif, mode = excluded.mode, base_url = excluded.base_url,
    -- Clé laissée vide = on garde la clé déjà enregistrée.
    api_key = coalesce(excluded.api_key, fne_config.api_key),
    point_de_vente = excluded.point_de_vente, etablissement = excluded.etablissement,
    fne_par_defaut = excluded.fne_par_defaut, maj_par = auth.uid(), maj_at = now();
  if p_actif and not exists (select 1 from fne_config where entreprise_id = v_entreprise_id and api_key is not null) then
    raise exception 'saisissez la clé API FNE fournie par la DGI';
  end if;
end;
$$;

-- Configuration sans la clé (pour l'écran) : tous les membres savent si la
-- FNE est active ; seule la direction voit les détails.
create or replace function lire_config_fne()
returns jsonb
language sql
security definer
stable
set search_path to 'public'
as $$
  select coalesce((
    select jsonb_build_object(
      'actif', c.actif, 'fne_par_defaut', c.fne_par_defaut, 'mode', c.mode,
      'base_url', case when current_role_utilisateur() in ('admin', 'manager', 'comptable') then c.base_url end,
      'point_de_vente', case when current_role_utilisateur() in ('admin', 'manager', 'comptable') then c.point_de_vente end,
      'etablissement', case when current_role_utilisateur() in ('admin', 'manager', 'comptable') then c.etablissement end,
      'cle_enregistree', c.api_key is not null)
    from fne_config c where c.entreprise_id = current_entreprise_id()
  ), jsonb_build_object('actif', false, 'fne_par_defaut', false, 'mode', 'test', 'cle_enregistree', false));
$$;

-- Clients : NCC et type FNE
alter table clients add column if not exists ncc text;
alter table clients add column if not exists fne_template text;
alter table clients drop constraint if exists clients_fne_template_check;
alter table clients add constraint clients_fne_template_check check (fne_template is null or fne_template in ('B2B', 'B2C', 'B2G', 'B2F'));

-- Ventes : certification
alter table ventes add column if not exists fne_demandee boolean not null default false;
alter table ventes add column if not exists fne_statut text;
alter table ventes drop constraint if exists ventes_fne_statut_check;
alter table ventes add constraint ventes_fne_statut_check check (fne_statut is null or fne_statut in ('a_certifier', 'certifiee', 'erreur'));
alter table ventes add column if not exists fne_reference text;
alter table ventes add column if not exists fne_token text;
alter table ventes add column if not exists fne_id text;
alter table ventes add column if not exists fne_certifiee_at timestamptz;
alter table ventes add column if not exists fne_erreur text;
alter table ventes add column if not exists fne_avoir_reference text;
alter table ventes add column if not exists fne_avoir_token text;
alter table ventes_lignes add column if not exists fne_item_id text;

-- Demander la FNE sur une vente (la certification est faite par la fonction serveur).
create or replace function demander_fne(p_vente_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  update ventes set fne_demandee = true, fne_statut = coalesce(nullif(fne_statut, 'erreur'), 'a_certifier')
  where id = p_vente_id and entreprise_id = current_entreprise_id() and coalesce(fne_statut, '') <> 'certifiee';
end;
$$;

-- Journal des échanges avec la DGI (écrit par la fonction serveur).
create table if not exists fne_journal (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id),
  vente_id uuid references ventes(id),
  operation text not null check (operation in ('certification', 'avoir')),
  statut_http integer,
  succes boolean not null,
  requete jsonb,
  reponse jsonb,
  duree_ms integer,
  created_by uuid references profils(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_fne_journal_vente on fne_journal (vente_id, created_at);
alter table fne_journal enable row level security;
drop policy if exists fne_journal_select on fne_journal;
create policy fne_journal_select on fne_journal
  for select using (entreprise_id = current_entreprise_id() and current_role_utilisateur() in ('admin', 'manager', 'comptable'));

notify pgrst, 'reload schema';
