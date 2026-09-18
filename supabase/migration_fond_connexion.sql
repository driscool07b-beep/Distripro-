-- Migration : bucket public pour l'image de fond de la page de
-- connexion — page partagée par toutes les entreprises (pas encore
-- de sélection d'entreprise avant connexion), donc ce réglage est
-- pour l'instant unique pour toute la plateforme, pas par entreprise.
-- Remplaçable par n'importe quel admin depuis Paramètres.
--
-- À exécuter dans l'éditeur SQL de Supabase.

insert into storage.buckets (id, name, public)
values ('plateforme-publique', 'plateforme-publique', true)
on conflict (id) do nothing;

drop policy if exists plateforme_publique_select on storage.objects;
create policy plateforme_publique_select on storage.objects
  for select using (bucket_id = 'plateforme-publique');

drop policy if exists plateforme_publique_insert on storage.objects;
create policy plateforme_publique_insert on storage.objects
  for insert with check (
    bucket_id = 'plateforme-publique'
    and current_role_utilisateur() = 'admin'
  );

drop policy if exists plateforme_publique_update on storage.objects;
create policy plateforme_publique_update on storage.objects
  for update using (
    bucket_id = 'plateforme-publique'
    and current_role_utilisateur() = 'admin'
  );
