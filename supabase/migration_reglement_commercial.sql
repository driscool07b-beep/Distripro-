-- Migration : permettre d'attribuer un encaissement de créance à un
-- commercial précis (distinct de qui a saisi le paiement dans l'appli),
-- pour que Versements reflète correctement qui doit remettre quoi.
-- À exécuter dans l'éditeur SQL de Supabase.

alter table reglements add column if not exists commercial_id uuid references profils(id);

create or replace function enregistrer_reglement(
  p_vente_id uuid,
  p_montant numeric,
  p_mode text default 'espece',
  p_commercial_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_vente record;
  v_reglement_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;

  if v_role not in ('admin', 'manager', 'commercial', 'comptable') then
    raise exception 'accès refusé : votre rôle ne permet pas d''enregistrer un règlement';
  end if;

  if p_montant is null or p_montant <= 0 then
    raise exception 'montant invalide';
  end if;

  select * into v_vente from ventes
  where id = p_vente_id and entreprise_id = v_entreprise_id
  for update;

  if not found then
    raise exception 'vente introuvable pour cette entreprise';
  end if;

  if v_vente.statut = 'annulee' then
    raise exception 'impossible de régler une vente annulée';
  end if;

  if v_vente.mode_paiement <> 'credit' then
    raise exception 'cette vente n''est pas à crédit';
  end if;

  if v_vente.montant_regle + p_montant > v_vente.total then
    raise exception 'le montant dépasse le solde restant dû';
  end if;

  update ventes
  set montant_regle = montant_regle + p_montant
  where id = p_vente_id;

  insert into reglements (entreprise_id, vente_id, montant, mode, created_by, commercial_id)
  values (v_entreprise_id, p_vente_id, p_montant, p_mode, auth.uid(), p_commercial_id)
  returning id into v_reglement_id;

  return v_reglement_id;
end;
$$;
