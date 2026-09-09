-- Migration : Phase 0 du plan de bilinguisation (FR/EN/AR/ZH).
-- Ajoute les colonnes nécessaires pour stocker la préférence de langue :
--   - profils.langue : langue de l'interface pour cet utilisateur
--   - entreprises.langue_par_defaut : langue de repli pour les documents
--     (reçus, factures) d'un client qui n'a pas sa propre langue définie
--   - clients.langue : langue dans laquelle générer les documents pour ce
--     client (facture, reçu, bon de livraison) — la convention standard
--     étant que le document suit le client, pas l'utilisateur connecté
--     qui l'a généré.
--
-- À exécuter dans l'éditeur SQL de Supabase.

alter table profils add column if not exists langue text not null default 'fr' check (langue in ('fr', 'en', 'ar', 'zh'));
alter table entreprises add column if not exists langue_par_defaut text not null default 'fr' check (langue_par_defaut in ('fr', 'en', 'ar', 'zh'));
alter table clients add column if not exists langue text check (langue in ('fr', 'en', 'ar', 'zh'));
-- clients.langue reste nullable : NULL = « pas de préférence connue »,
-- auquel cas le document retombe sur entreprises.langue_par_defaut
-- (logique gérée côté application en Phase 4, pas ici).
