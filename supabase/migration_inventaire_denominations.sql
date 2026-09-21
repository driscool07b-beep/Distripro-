-- Migration : comptage détaillé par coupure pour l'inventaire de
-- caisse — nombre de billets de X, nombre de pièces de Y..., total
-- calculé automatiquement et comparé au solde théorique.
--
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists inventaire_caisse_denominations (
  id uuid primary key default gen_random_uuid(),
  inventaire_id uuid not null references inventaires_caisse(id) on delete cascade,
  valeur numeric not null check (valeur > 0),
  quantite integer not null check (quantite >= 0)
);

alter table inventaire_caisse_denominations enable row level security;
drop policy if exists inventaire_caisse_denominations_select on inventaire_caisse_denominations;
create policy inventaire_caisse_denominations_select on inventaire_caisse_denominations
  for select using (
    inventaire_id in (select id from inventaires_caisse where entreprise_id = current_entreprise_id())
  );

create or replace function creer_inventaire_caisse(
  p_caisse_id uuid,
  p_solde_compte numeric,
  p_notes text default null,
  p_denominations jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_solde_theorique numeric;
  v_id uuid;
  v_denom jsonb;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé : réservé au responsable comptable';
  end if;
  perform 1 from caisses where id = p_caisse_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'caisse introuvable'; end if;
  if p_solde_compte is null or p_solde_compte < 0 then raise exception 'montant compté invalide'; end if;

  v_solde_theorique := solde_caisse(p_caisse_id);

  insert into inventaires_caisse (entreprise_id, caisse_id, solde_theorique, solde_compte, controle_par, notes)
  values (v_entreprise_id, p_caisse_id, v_solde_theorique, p_solde_compte, auth.uid(), nullif(trim(p_notes), ''))
  returning id into v_id;

  if p_denominations is not null then
    for v_denom in select * from jsonb_array_elements(p_denominations)
    loop
      if (v_denom->>'quantite')::integer > 0 then
        insert into inventaire_caisse_denominations (inventaire_id, valeur, quantite)
        values (v_id, (v_denom->>'valeur')::numeric, (v_denom->>'quantite')::integer);
      end if;
    end loop;
  end if;

  return v_id;
end;
$$;
