-- Migration : informations légales de l'entreprise, à afficher sur tous les
-- documents générés (factures, reçus, bons de livraison, proforma)
-- À exécuter dans l'éditeur SQL de Supabase.

alter table entreprises add column if not exists adresse text;
alter table entreprises add column if not exists telephone text;
alter table entreprises add column if not exists email text;
alter table entreprises add column if not exists ncc text;
alter table entreprises add column if not exists rccm text;

-- La policy entreprises_update_admin existe déjà (créée plus tôt cette
-- session) et couvre automatiquement ces nouvelles colonnes.
