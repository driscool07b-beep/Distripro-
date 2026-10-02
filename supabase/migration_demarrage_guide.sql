-- Migration : démarrage guidé des nouvelles entreprises (« Premiers pas »).
-- L'avancement de chaque étape est détecté automatiquement à partir des
-- données réelles de l'entreprise (aucune case à cocher manuelle).
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function etat_demarrage()
returns jsonb
language sql
security definer
stable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'logo', e.logo_path is not null,
    'infos', coalesce(nullif(trim(e.adresse), ''), nullif(trim(e.telephone), '')) is not null,
    'magasin', exists (select 1 from depots d where d.entreprise_id = e.id),
    'produits', (select count(*) from produits p where p.entreprise_id = e.id),
    'stock', exists (select 1 from stocks s where s.entreprise_id = e.id and s.quantite > 0),
    'clients', (select count(*) from clients c where c.entreprise_id = e.id),
    'equipe', exists (select 1 from profils p where p.entreprise_id = e.id and p.role <> 'admin')
              or exists (select 1 from invitations i where i.entreprise_id = e.id),
    'vente', exists (select 1 from ventes v where v.entreprise_id = e.id),
    'assistant', exists (select 1 from consommation_ia c where c.entreprise_id = e.id and c.fonction = 'assistant_ia')
  )
  from entreprises e
  where e.id = current_entreprise_id() and current_role_utilisateur() in ('admin', 'manager');
$$;

notify pgrst, 'reload schema';
