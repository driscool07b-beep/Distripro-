-- Migration : champ pays optionnel sur les clients.
--
-- Reste facultatif — aucune obligation de le renseigner. Ouvre la
-- possibilité, plus tard, de distinguer les ventes "internationales"
-- des ventes domestiques (par ex. pour un objectif de direction), ce
-- qui n'était pas possible avec le seul champ ville.
--
-- À exécuter dans l'éditeur SQL de Supabase.

alter table clients add column if not exists pays text;
