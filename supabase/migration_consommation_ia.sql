-- Migration : journal de consommation de l'IA (étape 1 de la facturation des crédits IA).
-- Chaque appel à l'IA (Analyse IA, planification des tournées, futur assistant)
-- est enregistré avec les tokens réellement consommés (renvoyés par Anthropic)
-- et son coût en dollars, calculé avec le tarif en vigueur au moment de l'appel.
-- Rien n'est bloqué à ce stade : on mesure, pour fixer ensuite les quotas et les prix.
-- À exécuter dans l'éditeur SQL de Supabase.

-- Tarifs Anthropic par modèle (en dollars par million de tokens).
-- Modifiables à tout moment, à vérifier sur https://www.anthropic.com/pricing
-- Réservé à la plateforme : aucune politique RLS = invisible pour les clients.
create table if not exists tarifs_ia (
  modele text primary key,
  prix_entree_usd_par_million numeric not null,
  prix_sortie_usd_par_million numeric not null,
  updated_at timestamptz not null default now()
);
alter table tarifs_ia enable row level security;

insert into tarifs_ia (modele, prix_entree_usd_par_million, prix_sortie_usd_par_million)
values ('claude-sonnet-5', 3, 15)
on conflict (modele) do nothing;

create table if not exists consommation_ia (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id),
  profil_id uuid references profils(id),
  fonction text not null,              -- 'analyse_ia', 'planification_tournees', ...
  modele text not null,
  tokens_entree integer not null default 0,
  tokens_sortie integer not null default 0,
  cout_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_consommation_ia_entreprise_date on consommation_ia (entreprise_id, created_at);

alter table consommation_ia enable row level security;

-- Les administrateurs d'une entreprise voient la consommation de leur entreprise.
-- Aucune politique d'écriture : seules les Edge Functions (clé service) enregistrent.
drop policy if exists consommation_ia_select_admin on consommation_ia;
create policy consommation_ia_select_admin on consommation_ia
  for select using (
    entreprise_id = current_entreprise_id() and current_role_utilisateur() = 'admin'
  );

-- Synthèse mensuelle par entreprise, pour le propriétaire de la plateforme.
-- À consulter dans l'éditeur SQL :  select * from v_consommation_ia_mensuelle;
-- security_invoker : via l'API, la vue applique les droits de l'utilisateur
-- (un client ne voit donc jamais les autres entreprises).
create or replace view v_consommation_ia_mensuelle
with (security_invoker = true) as
select
  date_trunc('month', c.created_at)::date as mois,
  e.nom as entreprise,
  c.fonction,
  count(*) as nb_appels,
  sum(c.tokens_entree) as tokens_entree,
  sum(c.tokens_sortie) as tokens_sortie,
  round(sum(c.cout_usd), 4) as cout_usd,
  round(sum(c.cout_usd) / count(*), 4) as cout_moyen_par_appel_usd
from consommation_ia c
join entreprises e on e.id = c.entreprise_id
group by 1, 2, 3
order by 1 desc, cout_usd desc;

revoke all on v_consommation_ia_mensuelle from anon, authenticated;

notify pgrst, 'reload schema';
