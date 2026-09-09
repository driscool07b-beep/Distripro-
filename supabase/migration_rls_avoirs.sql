-- Migration : la table avoirs n'a jamais eu la RLS activée (créée
-- manuellement dans l'éditeur SQL, hors de toute migration versionnée —
-- comme depots avant sa propre correction plus tôt dans cette série de
-- migrations). Sans lecture RLS scoped à l'entreprise, n'importe quel
-- utilisateur authentifié de n'importe quelle entreprise cliente du SaaS
-- pourrait lire les avoirs de toutes les autres. Ça n'avait jamais été
-- visible car rien ne lisait cette table depuis le frontend jusqu'ici —
-- la génération de la facture d'avoir en a maintenant besoin.
--
-- À exécuter dans l'éditeur SQL de Supabase.

alter table avoirs enable row level security;

drop policy if exists avoirs_select on avoirs;
create policy avoirs_select on avoirs
  for select using (entreprise_id = current_entreprise_id());
