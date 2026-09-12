-- Migration : la devise de facturation devient un réglage par
-- entreprise, configurable dans Paramètres, au lieu d'être F CFA
-- codé en dur partout dans le frontend.
--
-- À exécuter dans l'éditeur SQL de Supabase.

alter table entreprises add column if not exists devise text not null default 'XOF'
  check (devise in ('XOF', 'EUR', 'USD', 'GBP', 'GHS', 'NGN'));

create or replace function modifier_devise_entreprise(p_devise text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut modifier la devise';
  end if;
  if p_devise not in ('XOF', 'EUR', 'USD', 'GBP', 'GHS', 'NGN') then
    raise exception 'devise invalide';
  end if;

  update entreprises set devise = p_devise where id = v_entreprise_id;
end;
$$;
