-- Complément à migration_banques.sql, exécutée avec succès sans ce
-- correctif : enregistrer_reglement() n'acceptait pas encore le
-- paramètre banque, alors que la colonne reglements.banque_id, elle,
-- existe déjà. Sans ceci, impossible d'enregistrer un règlement en
-- précisant sur quelle banque le chèque/virement est déposé.
--
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function enregistrer_reglement(p_vente_id uuid, p_montant numeric, p_mode text default 'espece', p_commercial_id uuid default null, p_banque_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_vente record;
  v_reglement_id uuid;
begin
  select * into v_vente from ventes where id = p_vente_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'vente introuvable';
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

  if p_banque_id is not null then
    perform 1 from banques where id = p_banque_id and entreprise_id = v_entreprise_id;
    if not found then raise exception 'banque introuvable'; end if;
  end if;

  update ventes
  set montant_regle = montant_regle + p_montant
  where id = p_vente_id;

  insert into reglements (entreprise_id, vente_id, montant, mode, created_by, commercial_id, banque_id)
  values (v_entreprise_id, p_vente_id, p_montant, p_mode, auth.uid(), p_commercial_id, p_banque_id)
  returning id into v_reglement_id;

  return v_reglement_id;
end;
$$;
