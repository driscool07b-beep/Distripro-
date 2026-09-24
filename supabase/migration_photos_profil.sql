-- Migration : photo de profil de chaque compte (affichée dans la messagerie,
-- l'équipe et le menu).
-- Stockage privé : seuls les membres de la même entreprise voient les photos.
-- Chacun ne peut déposer une photo que dans son propre dossier ; une photo
-- n'est jamais écrasée (nouveau fichier à chaque changement).
-- À exécuter dans l'éditeur SQL de Supabase.

alter table profils add column if not exists photo_path text;

insert into storage.buckets (id, name, public)
values ('photos-profil', 'photos-profil', false)
on conflict (id) do nothing;

drop policy if exists photos_profil_select on storage.objects;
create policy photos_profil_select on storage.objects
  for select using (
    bucket_id = 'photos-profil'
    and (storage.foldername(name))[1] = current_entreprise_id()::text
  );

drop policy if exists photos_profil_insert on storage.objects;
create policy photos_profil_insert on storage.objects
  for insert with check (
    bucket_id = 'photos-profil'
    and (storage.foldername(name))[1] = current_entreprise_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Définir (ou retirer, avec null) sa propre photo de profil.
create or replace function definir_photo_profil(p_chemin text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if p_chemin is not null
     and (split_part(p_chemin, '/', 1) <> v_entreprise_id::text or split_part(p_chemin, '/', 2) <> auth.uid()::text) then
    raise exception 'chemin de photo invalide';
  end if;
  update profils set photo_path = p_chemin where id = auth.uid();
end;
$$;

-- Liste des conversations : on ajoute l'identifiant et la photo du
-- correspondant (conversations directes). Le type de retour change, d'où
-- la suppression préalable.
drop function if exists mes_conversations();

create or replace function mes_conversations()
returns table (
  conversation_id uuid,
  type text,
  nom text,
  autre_membre_nom text,
  dernier_message text,
  dernier_message_a_piece_jointe boolean,
  dernier_message_at timestamptz,
  dernier_expediteur_nom text,
  non_lus bigint,
  autre_membre_id uuid,
  autre_membre_photo text
)
language sql
security definer
stable
set search_path to 'public'
as $$
  select
    c.id,
    c.type,
    c.nom,
    am.nom,
    dm.contenu,
    dm.piece_jointe_path is not null,
    dm.created_at,
    dp.nom,
    (
      select count(*) from messages m
      where m.conversation_id = c.id
        and m.created_at > coalesce(cm.dernier_lu_at, 'epoch'::timestamptz)
        and m.expediteur_id <> auth.uid()
    ),
    am.id,
    am.photo_path
  from conversations c
  join conversations_membres cm on cm.conversation_id = c.id and cm.profil_id = auth.uid()
  left join lateral (
    select p.id, p.nom, p.photo_path
    from conversations_membres cm2
    join profils p on p.id = cm2.profil_id
    where c.type = 'directe' and cm2.conversation_id = c.id and cm2.profil_id <> auth.uid()
    limit 1
  ) am on true
  left join lateral (
    select contenu, piece_jointe_path, created_at, expediteur_id
    from messages
    where conversation_id = c.id
    order by created_at desc
    limit 1
  ) dm on true
  left join profils dp on dp.id = dm.expediteur_id
  where c.entreprise_id = current_entreprise_id()
  order by coalesce(dm.created_at, c.created_at) desc;
$$;

notify pgrst, 'reload schema';
