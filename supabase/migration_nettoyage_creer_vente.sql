-- Migration : nettoyage — plusieurs versions de creer_vente coexistaient
-- (chaque ajout de paramètre cette session a créé une nouvelle fonction au
-- lieu de remplacer l'ancienne, car CREATE OR REPLACE exige une signature
-- identique). On ne garde que la version complète à 6 paramètres.
-- À exécuter dans l'éditeur SQL de Supabase.

drop function if exists creer_vente(uuid, jsonb, text);
drop function if exists creer_vente(uuid, jsonb, text, date);
-- La version à 6 paramètres (p_client_id, p_lignes, p_mode_paiement,
-- p_date_echeance, p_commercial_id, p_montant_paye) reste en place, inchangée.
