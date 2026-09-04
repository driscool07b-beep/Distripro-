-- Migration : un commercial est limité à ses propres données (ventes,
-- créances, commandes, tournées, rapports) sauf si l'admin lui accorde un
-- accès élargi (ex. commercial senior devant voir l'activité globale).
-- À exécuter dans l'éditeur SQL de Supabase.

alter table profils add column if not exists acces_etendu boolean not null default false;
