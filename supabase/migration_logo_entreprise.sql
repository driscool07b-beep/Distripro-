-- Migration : logo de l'entreprise sur toute la documentation (factures,
-- reçus, bons de livraison, proformas, avoirs, rapports, emails).
-- - Dossier de stockage « logos-entreprises » (public en lecture : le logo
--   doit s'afficher dans les emails et documents ; 1 Mo, PNG / JPEG / WebP).
-- - Seul l'administrateur de l'entreprise dépose ou change le logo, et
--   seulement dans le dossier de son entreprise.
-- À exécuter dans l'éditeur SQL de Supabase.

alter table entreprises add column if not exists logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos-entreprises', 'logos-entreprises', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

drop policy if exists logos_entreprises_insert on storage.objects;
create policy logos_entreprises_insert on storage.objects
  for insert with check (
    bucket_id = 'logos-entreprises'
    and (storage.foldername(name))[1] = mon_entreprise_id()::text
    and current_role_utilisateur() = 'admin'
  );
drop policy if exists logos_entreprises_update on storage.objects;
create policy logos_entreprises_update on storage.objects
  for update using (
    bucket_id = 'logos-entreprises'
    and (storage.foldername(name))[1] = mon_entreprise_id()::text
    and current_role_utilisateur() = 'admin'
  );
drop policy if exists logos_entreprises_delete on storage.objects;
create policy logos_entreprises_delete on storage.objects
  for delete using (
    bucket_id = 'logos-entreprises'
    and (storage.foldername(name))[1] = mon_entreprise_id()::text
    and current_role_utilisateur() = 'admin'
  );

create or replace function definir_logo_entreprise(p_path text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
begin
  if current_role_utilisateur() <> 'admin' then raise exception 'seul un administrateur modifie le logo'; end if;
  if p_path is not null and split_part(p_path, '/', 1) <> v_entreprise_id::text then
    raise exception 'emplacement du logo invalide';
  end if;
  update entreprises set logo_path = p_path where id = v_entreprise_id;
end;
$$;

notify pgrst, 'reload schema';
