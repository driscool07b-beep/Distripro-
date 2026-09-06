-- Migration : ajoute le contrôle "compte en lecture seule" aux policies
-- d'écriture directe (hors fonctions RPC) — caisses, groupes de clients,
-- objectifs, tarifs négociés. Les policies de lecture (SELECT) restent
-- inchangées : un compte en lecture seule continue de tout voir.
-- Reconstruit à partir des définitions réellement en base.
-- À exécuter dans l'éditeur SQL de Supabase.

drop policy if exists caisses_insert on caisses;
create policy caisses_insert on caisses
  for insert with check (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() = any (array['admin', 'manager'])
    and not mon_compte_lecture_seule()
  );

drop policy if exists caisses_update on caisses;
create policy caisses_update on caisses
  for update using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() = any (array['admin', 'manager'])
    and not mon_compte_lecture_seule()
  );

drop policy if exists groupes_clients_insert on groupes_clients;
create policy groupes_clients_insert on groupes_clients
  for insert with check (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() = any (array['admin', 'manager'])
    and not mon_compte_lecture_seule()
  );

drop policy if exists groupes_clients_delete on groupes_clients;
create policy groupes_clients_delete on groupes_clients
  for delete using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() = any (array['admin', 'manager'])
    and not mon_compte_lecture_seule()
  );

drop policy if exists objectifs_insert on objectifs;
create policy objectifs_insert on objectifs
  for insert with check (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() = any (array['admin', 'manager'])
    and not mon_compte_lecture_seule()
  );

drop policy if exists objectifs_delete on objectifs;
create policy objectifs_delete on objectifs
  for delete using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() = any (array['admin', 'manager'])
    and not mon_compte_lecture_seule()
  );

drop policy if exists tarifs_client_insert on tarifs_client;
create policy tarifs_client_insert on tarifs_client
  for insert with check (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() = any (array['admin', 'manager'])
    and not mon_compte_lecture_seule()
  );

drop policy if exists tarifs_client_update on tarifs_client;
create policy tarifs_client_update on tarifs_client
  for update using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() = any (array['admin', 'manager'])
    and not mon_compte_lecture_seule()
  );

drop policy if exists tarifs_client_delete on tarifs_client;
create policy tarifs_client_delete on tarifs_client
  for delete using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() = any (array['admin', 'manager'])
    and not mon_compte_lecture_seule()
  );
