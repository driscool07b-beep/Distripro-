-- Migration : le caractère obligatoire du justificatif sur un ajustement de
-- stock devient un réglage configurable par l'admin (Paramètres), pas une
-- règle figée dans le code.
-- À exécuter dans l'éditeur SQL de Supabase.

alter table entreprises add column if not exists justificatif_stock_obligatoire boolean not null default true;
