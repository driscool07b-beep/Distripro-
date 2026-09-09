-- Migration : la migration multi-dépôts a ajouté p_depot_id à creer_vente
-- avec CREATE OR REPLACE, mais comme CREATE OR REPLACE exige une signature
-- identique, l'ajout d'un nouveau paramètre a créé une DEUXIÈME fonction
-- au lieu de remplacer l'ancienne (même piège que creer_produit/
-- ajuster_stock corrigé plus tôt) — PostgREST ne sait plus laquelle
-- appeler ("Could not choose the best candidate function").
--
-- On supprime l'ancienne version (9 paramètres, sans depot_id) ; la
-- version à 10 paramètres (avec p_depot_id) reste en place, inchangée.
--
-- À exécuter dans l'éditeur SQL de Supabase.

drop function if exists creer_vente(uuid, jsonb, text, date, uuid, numeric, text, numeric, text);
