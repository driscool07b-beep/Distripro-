-- Migration : une tournée dont la date est passée est clôturée.
-- - Plus aucun client ne peut y être ajouté ni retiré, et on ne peut plus
--   créer de tournée à une date passée.
-- - Les visites peuvent encore être validées jusqu'à la fin du lendemain,
--   uniquement pour laisser le temps aux visites faites HORS CONNEXION de se
--   synchroniser. Au-delà, plus aucune modification n'est possible.
-- Contrôle côté serveur (trigger) : il s'applique quelle que soit la façon
-- d'accéder aux données. Date de référence : heure d'Abidjan (UTC+0).
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function verrouiller_tournee_passee()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tournee_id uuid := coalesce(new.tournee_id, old.tournee_id);
  v_date date;
  v_aujourdhui date := (now() at time zone 'Africa/Abidjan')::date;
begin
  select date_tournee into v_date from tournees where id = v_tournee_id;
  if v_date is null then
    return coalesce(new, old);
  end if;

  if tg_op in ('INSERT', 'DELETE') then
    -- Suppression en cascade d'une tournée entière (ex. refus) : autorisée
    -- seulement si la tournée n'est pas passée, comme le reste.
    if v_date < v_aujourdhui then
      raise exception 'tournée du % clôturée : elle ne peut plus être modifiée', to_char(v_date, 'DD/MM/YYYY');
    end if;
  elsif tg_op = 'UPDATE' then
    if v_date < v_aujourdhui - 1 then
      raise exception 'tournée du % clôturée : elle ne peut plus être modifiée', to_char(v_date, 'DD/MM/YYYY');
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_verrouiller_tournee_passee on tournee_lignes;
create trigger trg_verrouiller_tournee_passee
  before insert or update or delete on tournee_lignes
  for each row execute function verrouiller_tournee_passee();
