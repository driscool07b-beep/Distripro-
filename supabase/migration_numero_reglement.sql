-- Migration : référence unique sur les reçus de paiement (recouvrement de
-- créances), cohérente avec la numérotation déjà en place sur ventes,
-- commandes et versements.
-- À exécuter dans l'éditeur SQL de Supabase.

alter table reglements add column if not exists numero text;

create or replace function generer_numero_reglement()
returns trigger
language plpgsql
as $$
declare
  compteur int;
begin
  select count(*) + 1 into compteur
  from reglements
  where entreprise_id = new.entreprise_id
    and extract(year from created_at) = extract(year from now());
  new.numero := 'REC-' || extract(year from now()) || '-' || lpad(compteur::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists trg_generer_numero_reglement on reglements;
create trigger trg_generer_numero_reglement
before insert on reglements
for each row execute function generer_numero_reglement();
