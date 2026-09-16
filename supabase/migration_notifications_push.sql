-- Migration : notifications push (Web Push) — abonnements navigateur
-- par utilisateur, pour recevoir une alerte même app fermée.
--
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  profil_id uuid not null references profils(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_profil on push_subscriptions(profil_id);

alter table push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select on push_subscriptions;
create policy push_subscriptions_select on push_subscriptions
  for select using (profil_id = auth.uid());

-- L'Edge Function d'envoi lit les abonnements des DESTINATAIRES (pas
-- seulement les siens) via la clé service_role, qui contourne la RLS
-- — pas besoin de policy supplémentaire pour ça.

create or replace function enregistrer_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
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

  insert into push_subscriptions (entreprise_id, profil_id, endpoint, p256dh, auth)
  values (v_entreprise_id, auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, profil_id = excluded.profil_id, entreprise_id = excluded.entreprise_id;
end;
$$;

create or replace function supprimer_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from push_subscriptions where endpoint = p_endpoint and profil_id = auth.uid();
$$;
