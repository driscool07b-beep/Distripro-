-- Migration : import de soldes de créances en cours (continuité lors d'une
-- migration depuis un autre logiciel) — ne touche jamais le stock, distinct
-- d'une vente réelle.
-- À exécuter dans l'éditeur SQL de Supabase.

alter table ventes add column if not exists solde_report boolean not null default false;
alter table ventes add column if not exists notes text;

create or replace function importer_solde_creance(
  p_client_id uuid,
  p_montant numeric,
  p_date_echeance date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := mon_entreprise_id();
  v_role text := current_role_utilisateur();
  v_vente_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role not in ('admin', 'manager') then
    raise exception 'accès refusé : seul un administrateur ou un manager peut importer un solde';
  end if;
  if p_montant is null or p_montant <= 0 then
    raise exception 'montant invalide';
  end if;

  perform 1 from clients where id = p_client_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'client introuvable pour cette entreprise';
  end if;

  insert into ventes (
    entreprise_id, client_id, total, created_by, mode_paiement, statut,
    montant_regle, date_echeance, solde_report, notes
  )
  values (
    v_entreprise_id, p_client_id, p_montant, auth.uid(), 'credit', 'validee',
    0, p_date_echeance, true, coalesce(p_notes, 'Solde reporté (import)')
  )
  returning id into v_vente_id;

  return v_vente_id;
end;
$$;
