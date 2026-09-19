-- Migration : "Le bureau" comme cible d'objectif possible.
--
-- Jusqu'ici, une vente de bureau (commercial_id = null dans la table
-- ventes — vendue depuis le dépôt, pas depuis le stock porté par un
-- commercial) n'était comptée dans aucun réalisé d'objectif : exclue
-- des totaux d'équipe (qui ne somment que les commerciaux affiliés),
-- et il n'existait pas de cible dédiée pour la suivre spécifiquement.
--
-- À exécuter dans l'éditeur SQL de Supabase.

alter table objectifs add column if not exists cible_bureau boolean not null default false;

-- Le nom de la contrainte existante (commercial_id is not null or
-- zone is not null) a été auto-généré par Postgres à la création de
-- la table — on le retrouve dynamiquement plutôt que de le deviner,
-- pour ne pas risquer de la manquer.
do $$
declare
  v_nom_contrainte text;
begin
  select conname into v_nom_contrainte
  from pg_constraint
  where conrelid = 'objectifs'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%commercial_id%zone%';

  if v_nom_contrainte is not null then
    execute format('alter table objectifs drop constraint %I', v_nom_contrainte);
  end if;
end $$;

alter table objectifs add constraint objectifs_cible_check
  check (commercial_id is not null or zone is not null or cible_bureau);
