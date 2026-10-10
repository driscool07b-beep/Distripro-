-- =====================================================================
-- Mentions de la facture normalisée (modèle de la plateforme FNE)
--   • Entreprise : régime d'imposition, centre des impôts, références bancaires.
--   • Client : régime d'imposition (TEE, RME, RSI, RNI…).
-- À exécuter une fois dans le SQL Editor (ré-exécutable sans risque).
-- =====================================================================

alter table entreprises add column if not exists regime_imposition text;
alter table entreprises add column if not exists centre_impots text;
alter table entreprises add column if not exists references_bancaires text;
alter table clients add column if not exists regime_imposition text;

notify pgrst, 'reload schema';

-- Contrôle : doit renvoyer 4 lignes.
select table_name, column_name from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'entreprises' and column_name in ('regime_imposition', 'centre_impots', 'references_bancaires'))
    or (table_name = 'clients' and column_name = 'regime_imposition'))
order by 1, 2;
