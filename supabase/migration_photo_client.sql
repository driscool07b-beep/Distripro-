-- Migration : photo de devanture/enseigne sur la fiche client
-- À exécuter dans l'éditeur SQL de Supabase.

-- 1. Colonne pour stocker le chemin de la photo dans le bucket
alter table clients add column if not exists photo_devanture_path text;

-- 2. Bucket de stockage privé (accès contrôlé par policies, pas d'URL publique directe)
insert into storage.buckets (id, name, public)
values ('client-photos', 'client-photos', false)
on conflict (id) do nothing;

-- 3. Policies RLS sur storage.objects, isolées par entreprise
-- Convention de chemin : {entreprise_id}/{client_id}.{extension}
-- (storage.foldername(name))[1] correspond au premier segment du chemin, donc l'entreprise_id

drop policy if exists client_photos_select on storage.objects;
create policy client_photos_select on storage.objects
  for select using (
    bucket_id = 'client-photos'
    and (storage.foldername(name))[1] = current_entreprise_id()::text
  );

drop policy if exists client_photos_insert on storage.objects;
create policy client_photos_insert on storage.objects
  for insert with check (
    bucket_id = 'client-photos'
    and (storage.foldername(name))[1] = current_entreprise_id()::text
  );

drop policy if exists client_photos_update on storage.objects;
create policy client_photos_update on storage.objects
  for update using (
    bucket_id = 'client-photos'
    and (storage.foldername(name))[1] = current_entreprise_id()::text
  );

drop policy if exists client_photos_delete on storage.objects;
create policy client_photos_delete on storage.objects
  for delete using (
    bucket_id = 'client-photos'
    and (storage.foldername(name))[1] = current_entreprise_id()::text
  );
