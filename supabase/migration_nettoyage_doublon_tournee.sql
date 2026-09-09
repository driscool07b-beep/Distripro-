-- Migration : supprime les doublons de tournée qui empêchaient l'ajout de
-- la contrainte "une tournée par commercial et par jour"
-- (migration_gouvernance_tournees.sql).
--
-- Deux doublons trouvés et vérifiés manuellement, tous deux sur le commercial
-- 0378ed2e-5b7d-43af-9bbe-679c164d37b8 (Driss), tous deux encore au statut
-- 'planifiee' (aucune visite validée) :
--
-- 1. 27/08/2026 : 13e590b2-1699-4750-be96-62ea3fcbbfa2 (3 clients) est un
--    sous-ensemble exact de d56d34f1-2a02-49b4-8b26-e5686457ff30 (mêmes 3
--    clients + 1 client supplémentaire). On garde la seconde.
-- 2. 31/08/2026 : e9eaf185-9364-4e58-8916-ed536775abe2 et
--    000229a8-b6f4-415c-b83c-bdbff23c32e4 ont exactement les 5 mêmes
--    clients dans le même ordre — doublon strict. On garde la première
--    (créée 49 minutes avant l'autre).
--
-- Aucune perte de données dans les deux cas : tout le contenu supprimé
-- existe déjà (ou est un sous-ensemble) de la tournée conservée.
--
-- À exécuter dans l'éditeur SQL de Supabase.

delete from visites where tournee_id in (
  '13e590b2-1699-4750-be96-62ea3fcbbfa2',
  '000229a8-b6f4-415c-b83c-bdbff23c32e4'
);
delete from tournee_lignes where tournee_id in (
  '13e590b2-1699-4750-be96-62ea3fcbbfa2',
  '000229a8-b6f4-415c-b83c-bdbff23c32e4'
);
delete from tournees where id in (
  '13e590b2-1699-4750-be96-62ea3fcbbfa2',
  '000229a8-b6f4-415c-b83c-bdbff23c32e4'
);

-- Vérification défensive : s'il reste d'autres doublons non détectés
-- manuellement, cette étape échouera avec un message clair plutôt que de
-- laisser la contrainte suivante échouer sans contexte.
do $$
declare
  v_reste integer;
begin
  select count(*) into v_reste from (
    select commercial_id, date_tournee
    from tournees
    group by commercial_id, date_tournee
    having count(*) > 1
  ) doublons;
  if v_reste > 0 then
    raise exception 'Il reste % groupe(s) de tournées en doublon non traités — relancer le diagnostic avant de continuer.', v_reste;
  end if;
end $$;

-- Ajout de la contrainte, maintenant que les doublons ont disparu.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'tournees'::regclass and conname = 'tournees_commercial_date_unique'
  ) then
    alter table tournees add constraint tournees_commercial_date_unique unique (commercial_id, date_tournee);
  end if;
end $$;
