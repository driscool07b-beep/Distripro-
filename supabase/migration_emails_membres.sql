-- Migration : adresses email des membres dans la page Équipe.
-- Les emails sont stockés dans la partie protégée de la base (auth.users) :
-- cette fonction ne les fournit qu'à l'administrateur et au manager, et
-- seulement pour les membres de leur propre entreprise.
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function emails_membres()
returns table (id uuid, email text, derniere_connexion timestamptz)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
begin
  if current_role_utilisateur() not in ('admin', 'manager') then return; end if;
  return query
    select p.id, u.email::text, u.last_sign_in_at
    from profils p join auth.users u on u.id = p.id
    where p.entreprise_id = current_entreprise_id();
end;
$$;

notify pgrst, 'reload schema';
