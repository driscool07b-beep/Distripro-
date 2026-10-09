-- =====================================================================
-- Site vitrine (page d'accueil publique de distribpro.com)
--   • demandes_contact : demandes de démonstration / contact reçues par le
--     formulaire du site. Écrites uniquement par la fonction Edge
--     « demande-contact » (service_role), lues par le promoteur dans la
--     Console plateforme → onglet Prospects.
--   • tarifs_publics() : les formules actives et leurs prix, lisibles sans
--     connexion, pour que le site affiche toujours les prix de la Console.
-- À exécuter une fois dans le SQL Editor (ré-exécutable sans risque).
-- =====================================================================

create table if not exists demandes_contact (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nom text not null,
  entreprise text,
  telephone text not null,
  email text not null,
  ville text,
  taille_equipe text,
  sujet text not null,
  message text,
  source text,                       -- ex. « formulaire », « fiche technique »
  ip_hash text,                      -- empreinte de l'adresse IP (anti-abus), jamais l'IP en clair
  statut text not null default 'nouveau' check (statut in ('nouveau', 'en_cours', 'traite', 'spam')),
  note_interne text,
  traite_at timestamptz
);
create index if not exists idx_demandes_contact_date on demandes_contact(created_at desc);
create index if not exists idx_demandes_contact_ip on demandes_contact(ip_hash, created_at);

-- RLS activée sans aucune politique : personne ne lit ni n'écrit directement,
-- tout passe par la fonction Edge (service_role) ou les fonctions ci-dessous.
alter table demandes_contact enable row level security;

-- ---------------------------------------------------------------------
-- Tarifs affichés sur le site (sans connexion)
-- ---------------------------------------------------------------------
create or replace function tarifs_publics()
returns table (code text, nom text, prix_mensuel numeric, prix_annuel numeric, max_commerciaux integer, prix_place_supp integer, ordre integer)
language sql
security definer
stable
set search_path to 'public'
as $$
  select p.code, p.nom, p.prix_mensuel, p.prix_annuel, p.max_commerciaux, p.prix_place_supp, p.ordre
  from plans p
  where p.actif
  order by p.ordre;
$$;
revoke execute on function tarifs_publics() from public;
grant execute on function tarifs_publics() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Console plateforme : liste et suivi des demandes
-- ---------------------------------------------------------------------
create or replace function plateforme_demandes_contact(p_limite integer default 200)
returns setof demandes_contact
language plpgsql
security definer
stable
set search_path to 'public'
as $$
begin
  if not est_super_admin() then raise exception 'accès réservé au promoteur de la plateforme'; end if;
  return query select * from demandes_contact order by created_at desc limit greatest(1, least(coalesce(p_limite, 200), 1000));
end;
$$;
revoke execute on function plateforme_demandes_contact(integer) from public, anon;
grant execute on function plateforme_demandes_contact(integer) to authenticated, service_role;

create or replace function plateforme_suivre_demande_contact(p_id uuid, p_statut text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not est_super_admin() then raise exception 'accès réservé au promoteur de la plateforme'; end if;
  update demandes_contact
  set statut = p_statut,
      note_interne = coalesce(p_note, note_interne),
      traite_at = case when p_statut = 'traite' then now() else traite_at end
  where id = p_id;
end;
$$;
revoke execute on function plateforme_suivre_demande_contact(uuid, text, text) from public, anon;
grant execute on function plateforme_suivre_demande_contact(uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- Contrôle : doit renvoyer les formules actives (Starter, Pro, Entreprise).
select code, nom, prix_mensuel, max_commerciaux from tarifs_publics();
