-- =====================================================================
-- Sécurité : corrections suite au Security Advisor Supabase (7 oct. 2026)
-- À exécuter une seule fois dans le SQL Editor. Ré-exécutable sans risque.
-- =====================================================================

-- 1) Aucune fonction n'est appelable sans être connecté (rôle anon).
--    Toutes les RPC de DistribPro sont appelées par un utilisateur connecté
--    ou par les fonctions serveur (service_role). On retire le droit hérité
--    de PUBLIC et celui d'anon, en conservant exactement les droits actuels
--    d'authenticated (les fonctions déjà verrouillées le restent).
do $$
declare
  f record;
  v_auth boolean;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    v_auth := has_function_privilege('authenticated', f.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', f.sig);
    if v_auth then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- Fonctions créées à l'avenir : pas d'accès anonyme par défaut.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- 2) Fonctions internes : appelées seulement par d'autres fonctions serveur
--    ou par les fonctions Edge (service_role), jamais par l'application.
--    Elles acceptent un identifiant d'entreprise en paramètre : on les ferme
--    aux utilisateurs pour qu'aucun ne puisse lire ou écrire chez un autre.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'journaliser_plateforme', 'inscrire_au_plan', 'ia_solde_disponible',
        'situation_places', 'prix_places_prorata', 'montant_abonnement',
        'compte_deja_pris', 'consommer_lots_fifo', 'prochain_compte_libre',
        'assurer_compte_avance', 'assurer_compte_client',
        'assurer_compte_commercial', 'assurer_compte_groupe'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- 3) search_path figé sur les fonctions qui ne l'avaient pas.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions', f.sig);
  end loop;
end $$;

-- 4) Fond d'écran de connexion (bucket public « plateforme-publique ») :
--    - plus de listing des fichiers (l'URL publique suffit pour l'afficher) ;
--    - seul le promoteur de la plateforme peut le remplacer
--      (avant : n'importe quel administrateur d'entreprise cliente).
drop policy if exists plateforme_publique_select on storage.objects;
create policy plateforme_publique_select on storage.objects
  for select to authenticated
  using (bucket_id = 'plateforme-publique' and est_super_admin());

drop policy if exists plateforme_publique_insert on storage.objects;
create policy plateforme_publique_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'plateforme-publique' and est_super_admin());

drop policy if exists plateforme_publique_update on storage.objects;
create policy plateforme_publique_update on storage.objects
  for update to authenticated
  using (bucket_id = 'plateforme-publique' and est_super_admin());

-- Contrôle : doit renvoyer 0 (aucune fonction appelable sans connexion).
select count(*) as fonctions_ouvertes_sans_connexion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  and has_function_privilege('anon', p.oid, 'execute');
