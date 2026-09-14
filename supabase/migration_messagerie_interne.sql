-- Migration : messagerie interne entre collègues.
-- Conversations directes (1-à-1) et canaux de groupe, avec pièces
-- jointes (photos/PDF). Ouvert à tout le monde dans l'entreprise —
-- n'importe qui peut démarrer une conversation avec n'importe qui.
--
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  type text not null check (type in ('directe', 'groupe')),
  nom text,  -- null pour les conversations directes (le nom affiché est celui de l'autre membre)
  cree_par uuid not null references profils(id),
  created_at timestamptz not null default now()
);

create table if not exists conversations_membres (
  conversation_id uuid not null references conversations(id) on delete cascade,
  profil_id uuid not null references profils(id) on delete cascade,
  ajoute_at timestamptz not null default now(),
  dernier_lu_at timestamptz,
  primary key (conversation_id, profil_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  expediteur_id uuid not null references profils(id),
  contenu text,
  piece_jointe_path text,
  piece_jointe_nom text,
  piece_jointe_type text,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversations_membres_profil on conversations_membres(profil_id);
create index if not exists idx_messages_conversation on messages(conversation_id, created_at);

-- ---------------------------------------------------------------------
-- 2. Sécurité (RLS)
-- ---------------------------------------------------------------------
create or replace function est_membre_conversation(p_conversation_id uuid)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $$
  select exists (
    select 1 from conversations_membres
    where conversation_id = p_conversation_id and profil_id = auth.uid()
  );
$$;

alter table conversations enable row level security;
alter table conversations_membres enable row level security;
alter table messages enable row level security;

drop policy if exists conversations_select on conversations;
create policy conversations_select on conversations
  for select using (entreprise_id = current_entreprise_id() and est_membre_conversation(id));

drop policy if exists conversations_membres_select on conversations_membres;
create policy conversations_membres_select on conversations_membres
  for select using (est_membre_conversation(conversation_id));

drop policy if exists messages_select on messages;
create policy messages_select on messages
  for select using (entreprise_id = current_entreprise_id() and est_membre_conversation(conversation_id));

-- Les insertions passent uniquement par les fonctions ci-dessous
-- (security definer), pas par un insert direct côté client.

-- ---------------------------------------------------------------------
-- 3. Stockage des pièces jointes — réutilise le bucket privé existant
--    'pieces-jointes' (déjà isolé par entreprise_id), nouveau
--    sous-dossier "messagerie/".
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('pieces-jointes', 'pieces-jointes', false)
on conflict (id) do nothing;

drop policy if exists messagerie_pj_select on storage.objects;
create policy messagerie_pj_select on storage.objects
  for select using (
    bucket_id = 'pieces-jointes'
    and (storage.foldername(name))[1] = current_entreprise_id()::text
    and (storage.foldername(name))[2] = 'messagerie'
  );

drop policy if exists messagerie_pj_insert on storage.objects;
create policy messagerie_pj_insert on storage.objects
  for insert with check (
    bucket_id = 'pieces-jointes'
    and (storage.foldername(name))[1] = current_entreprise_id()::text
    and (storage.foldername(name))[2] = 'messagerie'
  );

-- ---------------------------------------------------------------------
-- 4. Fonctions
-- ---------------------------------------------------------------------

-- Démarre une conversation directe avec un collègue, ou réutilise
-- celle qui existe déjà entre les deux.
create or replace function demarrer_conversation_directe(p_autre_profil_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_conversation_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if p_autre_profil_id = auth.uid() then
    raise exception 'impossible de démarrer une conversation avec soi-même';
  end if;
  perform 1 from profils where id = p_autre_profil_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'collègue introuvable dans votre entreprise';
  end if;

  select c.id into v_conversation_id
  from conversations c
  where c.type = 'directe' and c.entreprise_id = v_entreprise_id
    and exists (select 1 from conversations_membres where conversation_id = c.id and profil_id = auth.uid())
    and exists (select 1 from conversations_membres where conversation_id = c.id and profil_id = p_autre_profil_id)
  limit 1;

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  insert into conversations (entreprise_id, type, cree_par)
  values (v_entreprise_id, 'directe', auth.uid())
  returning id into v_conversation_id;

  insert into conversations_membres (conversation_id, profil_id) values
    (v_conversation_id, auth.uid()),
    (v_conversation_id, p_autre_profil_id);

  return v_conversation_id;
end;
$$;

-- Crée un canal de groupe avec un nom et une liste de membres (le
-- créateur est ajouté automatiquement).
create or replace function creer_canal_groupe(p_nom text, p_membres_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_conversation_id uuid;
  v_membre_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if p_nom is null or trim(p_nom) = '' then
    raise exception 'le nom du canal est requis';
  end if;

  insert into conversations (entreprise_id, type, nom, cree_par)
  values (v_entreprise_id, 'groupe', trim(p_nom), auth.uid())
  returning id into v_conversation_id;

  insert into conversations_membres (conversation_id, profil_id) values (v_conversation_id, auth.uid());

  foreach v_membre_id in array coalesce(p_membres_ids, array[]::uuid[])
  loop
    if v_membre_id <> auth.uid() and exists (select 1 from profils where id = v_membre_id and entreprise_id = v_entreprise_id) then
      insert into conversations_membres (conversation_id, profil_id)
      values (v_conversation_id, v_membre_id)
      on conflict do nothing;
    end if;
  end loop;

  return v_conversation_id;
end;
$$;

-- Ajoute un collègue à un canal de groupe existant (n'importe quel
-- membre du canal peut inviter quelqu'un d'autre).
create or replace function ajouter_membre_canal(p_conversation_id uuid, p_profil_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
begin
  if not est_membre_conversation(p_conversation_id) then
    raise exception 'vous ne faites pas partie de ce canal';
  end if;
  perform 1 from conversations where id = p_conversation_id and type = 'groupe';
  if not found then
    raise exception 'seuls les canaux de groupe acceptent des membres supplémentaires';
  end if;
  perform 1 from profils where id = p_profil_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'collègue introuvable dans votre entreprise';
  end if;

  insert into conversations_membres (conversation_id, profil_id)
  values (p_conversation_id, p_profil_id)
  on conflict do nothing;
end;
$$;

-- Envoie un message (texte et/ou pièce jointe déjà uploadée par le
-- client dans le bucket avant cet appel).
create or replace function envoyer_message(
  p_conversation_id uuid,
  p_contenu text default null,
  p_piece_jointe_path text default null,
  p_piece_jointe_nom text default null,
  p_piece_jointe_type text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_message_id uuid;
begin
  if not est_membre_conversation(p_conversation_id) then
    raise exception 'vous ne faites pas partie de cette conversation';
  end if;
  if (p_contenu is null or trim(p_contenu) = '') and p_piece_jointe_path is null then
    raise exception 'le message est vide';
  end if;

  insert into messages (conversation_id, entreprise_id, expediteur_id, contenu, piece_jointe_path, piece_jointe_nom, piece_jointe_type)
  values (p_conversation_id, v_entreprise_id, auth.uid(), nullif(trim(p_contenu), ''), p_piece_jointe_path, p_piece_jointe_nom, p_piece_jointe_type)
  returning id into v_message_id;

  return v_message_id;
end;
$$;

-- Marque une conversation comme lue par l'utilisateur courant.
create or replace function marquer_conversation_lue(p_conversation_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update conversations_membres
  set dernier_lu_at = now()
  where conversation_id = p_conversation_id and profil_id = auth.uid();
$$;

-- Liste des conversations de l'utilisateur courant, avec aperçu du
-- dernier message et nombre de messages non lus — évite plusieurs
-- allers-retours côté client pour construire la liste.
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
  non_lus bigint
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
    case when c.type = 'directe' then (
      select p.nom from conversations_membres cm2
      join profils p on p.id = cm2.profil_id
      where cm2.conversation_id = c.id and cm2.profil_id <> auth.uid()
      limit 1
    ) else null end,
    dm.contenu,
    dm.piece_jointe_path is not null,
    dm.created_at,
    dp.nom,
    (
      select count(*) from messages m
      where m.conversation_id = c.id
        and m.created_at > coalesce(cm.dernier_lu_at, 'epoch'::timestamptz)
        and m.expediteur_id <> auth.uid()
    )
  from conversations c
  join conversations_membres cm on cm.conversation_id = c.id and cm.profil_id = auth.uid()
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

-- ---------------------------------------------------------------------
-- 5. Temps réel — permet aux nouveaux messages d'apparaître
--    instantanément sans recharger.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
