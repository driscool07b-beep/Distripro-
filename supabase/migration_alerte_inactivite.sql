-- Migration : alerte commerciaux inactifs depuis 24h.
--
-- Pas de notion de "supérieur direct" par commercial dans le modèle de
-- données actuel (organisation à plat) — visible donc par tout
-- admin/manager plutôt qu'un responsable nommément assigné. À
-- reconsidérer si une vraie hiérarchie est ajoutée plus tard.
--
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function commerciaux_inactifs()
returns table (
  profil_id uuid,
  nom text,
  zone text,
  derniere_connexion timestamptz,
  jamais_connecte boolean
)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
begin
  if current_role_utilisateur() not in ('admin', 'manager') then
    raise exception 'accès refusé';
  end if;

  return query
  select
    p.id,
    p.nom,
    p.zone,
    u.last_sign_in_at,
    u.last_sign_in_at is null
  from profils p
  join auth.users u on u.id = p.id
  where p.entreprise_id = current_entreprise_id()
    and p.role = 'commercial'
    and p.actif is not false
    and (u.last_sign_in_at is null or u.last_sign_in_at < now() - interval '24 hours')
  order by u.last_sign_in_at asc nulls first;
end;
$$;
