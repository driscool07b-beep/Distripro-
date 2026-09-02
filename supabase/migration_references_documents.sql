-- Migration : références uniques sur chaque document (vente, bon de
-- livraison) + pièce jointe du bon de commande client sur les commandes
-- À exécuter dans l'éditeur SQL de Supabase.

-- 1. Numérotation automatique des ventes et de leur bon de livraison associé
alter table ventes add column if not exists numero_vente text;
alter table ventes add column if not exists numero_bl text;

create or replace function generer_numeros_vente()
returns trigger
language plpgsql
as $$
declare
  compteur_vte int;
  compteur_bl int;
begin
  select count(*) + 1 into compteur_vte
  from ventes
  where entreprise_id = new.entreprise_id
    and extract(year from created_at) = extract(year from now());
  new.numero_vente := 'VTE-' || extract(year from now()) || '-' || lpad(compteur_vte::text, 5, '0');

  select count(*) + 1 into compteur_bl
  from ventes
  where entreprise_id = new.entreprise_id
    and extract(year from created_at) = extract(year from now());
  new.numero_bl := 'BL-' || extract(year from now()) || '-' || lpad(compteur_bl::text, 5, '0');

  return new;
end;
$$;

drop trigger if exists trg_generer_numeros_vente on ventes;
create trigger trg_generer_numeros_vente
before insert on ventes
for each row execute function generer_numeros_vente();

-- 2. Pièce jointe : bon de commande client (justificatif, saisie manuelle
-- des lignes en parallèle — l'OCR automatique reste une amélioration future)
alter table commandes add column if not exists bon_commande_client_path text;
alter table commandes add column if not exists bon_commande_client_reference text;

-- Bucket de stockage privé, réutilisable pour d'autres pièces jointes futures
-- (bons de livraison scannés, etc.)
insert into storage.buckets (id, name, public)
values ('pieces-jointes', 'pieces-jointes', false)
on conflict (id) do nothing;

drop policy if exists pieces_jointes_select on storage.objects;
create policy pieces_jointes_select on storage.objects
  for select using (
    bucket_id = 'pieces-jointes'
    and (storage.foldername(name))[1] = mon_entreprise_id()::text
  );

drop policy if exists pieces_jointes_insert on storage.objects;
create policy pieces_jointes_insert on storage.objects
  for insert with check (
    bucket_id = 'pieces-jointes'
    and (storage.foldername(name))[1] = mon_entreprise_id()::text
  );

drop policy if exists pieces_jointes_update on storage.objects;
create policy pieces_jointes_update on storage.objects
  for update using (
    bucket_id = 'pieces-jointes'
    and (storage.foldername(name))[1] = mon_entreprise_id()::text
  );
