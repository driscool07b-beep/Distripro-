-- Migration : référence (code article) et unité des produits.
-- Les colonnes existent depuis l'origine mais n'étaient pas utilisées. Elles
-- servent désormais : fiche produit, listes, recherche, import Excel, factures,
-- reçus, bons, proformas, et FNE (référence et unité de mesure de chaque article).
-- À exécuter dans l'éditeur SQL de Supabase.

alter table produits add column if not exists reference text;
alter table produits add column if not exists unite text;

-- Une référence ne peut servir qu'à un seul produit de l'entreprise.
create unique index if not exists idx_produits_reference_unique
  on produits (entreprise_id, upper(reference)) where reference is not null and reference <> '';

create or replace function definir_reference_produit(p_produit_id uuid, p_reference text, p_unite text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_reference text := nullif(upper(trim(coalesce(p_reference, ''))), '');
begin
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'manager', 'gestionnaire_stock') then raise exception 'accès refusé'; end if;
  if v_reference is not null and v_reference !~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$' then
    raise exception 'référence invalide : lettres, chiffres et - _ . / uniquement (40 caractères maximum)';
  end if;
  if v_reference is not null and exists (
    select 1 from produits where entreprise_id = current_entreprise_id() and upper(reference) = v_reference and id <> p_produit_id
  ) then
    raise exception 'la référence % est déjà utilisée par un autre produit', v_reference;
  end if;
  update produits set reference = v_reference, unite = nullif(trim(coalesce(p_unite, '')), '')
  where id = p_produit_id and entreprise_id = current_entreprise_id();
  if not found then raise exception 'produit introuvable'; end if;
end;
$$;

-- Prochaine référence libre (ex. P0001, P0002…), proposée dans le formulaire.
create or replace function prochaine_reference_produit()
returns text
language sql
security definer
stable
set search_path to 'public'
as $$
  select 'P' || lpad((coalesce(max(substring(upper(reference) from '^P(\d+)$')::integer), 0) + 1)::text, 4, '0')
  from produits where entreprise_id = current_entreprise_id();
$$;

notify pgrst, 'reload schema';
