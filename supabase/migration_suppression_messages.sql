-- =====================================================================
-- Messagerie : suppression d'un message, comme sur WhatsApp
--   • « Supprimer pour moi » : le message disparaît seulement chez moi ;
--   • « Supprimer pour tout le monde » : réservé à l'expéditeur, dans les
--     48 heures ; le contenu est effacé et chacun voit
--     « Ce message a été supprimé ».
-- À exécuter une fois dans le SQL Editor (ré-exécutable sans risque).
-- =====================================================================

alter table messages add column if not exists supprime_pour_tous boolean not null default false;
alter table messages add column if not exists supprime_at timestamptz;

-- Messages masqués par un utilisateur (« supprimer pour moi »).
create table if not exists messages_masques (
  message_id uuid not null references messages(id) on delete cascade,
  profil_id uuid not null references profils(id) on delete cascade,
  masque_at timestamptz not null default now(),
  primary key (message_id, profil_id)
);
alter table messages_masques enable row level security;
drop policy if exists messages_masques_select on messages_masques;
create policy messages_masques_select on messages_masques
  for select to authenticated using (profil_id = auth.uid());

create or replace function supprimer_message(p_message_id uuid, p_pour_tous boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_message messages%rowtype;
begin
  select * into v_message from messages where id = p_message_id;
  if not found then raise exception 'message introuvable'; end if;
  -- Seuls les membres de la conversation peuvent agir sur ses messages.
  if not exists (
    select 1 from conversations_membres
    where conversation_id = v_message.conversation_id and profil_id = auth.uid()
  ) then
    raise exception 'accès refusé';
  end if;

  if p_pour_tous then
    if v_message.expediteur_id <> auth.uid() then
      raise exception 'seul l''expéditeur peut supprimer un message pour tout le monde';
    end if;
    if v_message.created_at < now() - interval '48 hours' then
      raise exception 'un message ne peut être supprimé pour tout le monde que dans les 48 heures suivant son envoi';
    end if;
    update messages
    set contenu = null, piece_jointe_path = null, piece_jointe_nom = null, piece_jointe_type = null,
        supprime_pour_tous = true, supprime_at = now()
    where id = p_message_id;
  else
    insert into messages_masques (message_id, profil_id) values (p_message_id, auth.uid())
    on conflict do nothing;
  end if;
end;
$$;
revoke execute on function supprimer_message(uuid, boolean) from public, anon;
grant execute on function supprimer_message(uuid, boolean) to authenticated;

-- Liste des conversations : le dernier message tient compte des suppressions.
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
  autre_membre_photo text,
  dernier_message_supprime boolean
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
        and not m.supprime_pour_tous
        and not exists (select 1 from messages_masques mm where mm.message_id = m.id and mm.profil_id = auth.uid())
    ),
    am.id,
    am.photo_path,
    coalesce(dm.supprime_pour_tous, false)
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
    select m.contenu, m.piece_jointe_path, m.created_at, m.expediteur_id, m.supprime_pour_tous
    from messages m
    where m.conversation_id = c.id
      and not exists (select 1 from messages_masques mm where mm.message_id = m.id and mm.profil_id = auth.uid())
    order by m.created_at desc
    limit 1
  ) dm on true
  left join profils dp on dp.id = dm.expediteur_id
  where c.entreprise_id = current_entreprise_id()
  order by coalesce(dm.created_at, c.created_at) desc;
$$;
revoke execute on function mes_conversations() from public, anon;
grant execute on function mes_conversations() to authenticated;

notify pgrst, 'reload schema';
