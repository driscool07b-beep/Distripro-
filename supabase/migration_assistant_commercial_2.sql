-- Migration : assistant commercial, phase 2 (encaissements dictés).
-- Factures ouvertes d'un client (reste à payer), les plus anciennes d'abord,
-- dans la limite des droits de l'utilisateur (un commercial : ses ventes).
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function assistant_factures_ouvertes(p_client_id uuid)
returns table (vente_id uuid, numero text, date_vente date, echeance date, total numeric, reste numeric)
language sql
security definer
stable
set search_path to 'public'
as $$
  select v.id, v.numero_vente::text, (v.created_at at time zone 'Africa/Abidjan')::date, v.date_echeance,
         v.total::numeric, (v.total - v.montant_regle)::numeric
  from ventes v
  where v.entreprise_id = current_entreprise_id() and v.client_id = p_client_id
    and coalesce(v.statut, '') <> 'annulee' and v.total > v.montant_regle
    and (current_role_utilisateur() in ('admin', 'manager', 'comptable')
         or ia_peut_voir_vente(v.commercial_id, v.created_by))
  order by coalesce(v.date_echeance, (v.created_at at time zone 'Africa/Abidjan')::date), v.created_at
  limit 30;
$$;

notify pgrst, 'reload schema';
