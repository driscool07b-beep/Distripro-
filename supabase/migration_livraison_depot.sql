-- Migration : livraison des commandes depuis un magasin choisi.
-- Auparavant, la livraison n'indiquait pas le magasin : refusée dès qu'il y a
-- plusieurs magasins, et la vente pouvait puiser en silence dans le stock du
-- commercial. À exécuter APRÈS migration_audit_mouvements.sql.

drop function if exists livrer_commande(uuid, jsonb, numeric, text);

create or replace function livrer_commande(p_commande_id uuid, p_lignes_livrees jsonb, p_montant_supplementaire_paye numeric default 0, p_mode_paiement text default null, p_depot_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := mon_entreprise_id();
  v_role text := current_role_utilisateur();
  v_client_id uuid;
  v_commercial_id uuid;
  v_statut_actuel text;
  v_mode_paiement text;
  v_montant_paye_commande numeric(14,2);
  v_ligne jsonb;
  v_produit_id uuid;
  v_qte_livree integer;
  v_prix_unitaire numeric(14,2);
  v_lignes_vente jsonb := '[]'::jsonb;
  v_montant_paye_total numeric(14,2);
  v_vente_id uuid;
  v_vente_total numeric(14,2);
  v_excedent numeric(14,2);
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'commercial', 'comptable') then
    raise exception 'accès refusé';
  end if;

  select client_id, commercial_id, statut, mode_paiement, montant_paye
  into v_client_id, v_commercial_id, v_statut_actuel, v_mode_paiement, v_montant_paye_commande
  from commandes
  where id = p_commande_id and entreprise_id = v_entreprise_id
  for update;

  if v_client_id is null then
    raise exception 'commande introuvable pour cette entreprise';
  end if;
  if v_statut_actuel in ('livree', 'annulee') then
    raise exception 'cette commande est déjà % et ne peut plus être livrée', v_statut_actuel;
  end if;

  v_mode_paiement := coalesce(p_mode_paiement, v_mode_paiement, 'cash');

  for v_ligne in select * from jsonb_array_elements(p_lignes_livrees)
  loop
    v_produit_id := (v_ligne->>'produit_id')::uuid;
    v_qte_livree := (v_ligne->>'quantite_livree')::integer;

    update lignes_commande
    set quantite_livree = v_qte_livree
    where commande_id = p_commande_id and produit_id = v_produit_id;

    if v_qte_livree > 0 then
      select prix_unitaire into v_prix_unitaire
      from lignes_commande
      where commande_id = p_commande_id and produit_id = v_produit_id;

      v_lignes_vente := v_lignes_vente || jsonb_build_object(
        'produit_id', v_produit_id,
        'quantite', v_qte_livree,
        'prix_unitaire', v_prix_unitaire
      );
    end if;
  end loop;

  if jsonb_array_length(v_lignes_vente) = 0 then
    raise exception 'aucun article à livrer (toutes les quantités sont à zéro)';
  end if;

  v_montant_paye_total := coalesce(v_montant_paye_commande, 0) + coalesce(p_montant_supplementaire_paye, 0);

  -- La commande est livrée depuis le magasin choisi : la vente est attribuée
  -- au commercial de la commande, mais la marchandise sort du magasin.
  v_vente_id := creer_vente(
    p_client_id := v_client_id, p_lignes := v_lignes_vente, p_mode_paiement := v_mode_paiement,
    p_commercial_id := v_commercial_id, p_montant_paye := v_montant_paye_total,
    p_depot_id := p_depot_id, p_source_stock := 'depot'
  );

  select total into v_vente_total from ventes where id = v_vente_id;
  v_excedent := v_montant_paye_total - coalesce(v_vente_total, 0);
  if v_excedent > 0 then
    update clients
    set solde_credit = coalesce(solde_credit, 0) + v_excedent
    where id = v_client_id and entreprise_id = v_entreprise_id;

    insert into mouvements_credit_client (entreprise_id, client_id, montant, type_mouvement, vente_id, motif, effectue_par)
    values (
      v_entreprise_id, v_client_id, v_excedent, 'credit_annulation', v_vente_id,
      'Avance excédentaire — livraison partielle de la commande ' || p_commande_id, auth.uid()
    );
  end if;

  update commandes
  set statut = 'livree', vente_id = v_vente_id, mode_paiement = v_mode_paiement, updated_at = now()
  where id = p_commande_id;

  insert into commande_historique (entreprise_id, commande_id, ancien_statut, nouveau_statut, note, effectue_par)
  values (v_entreprise_id, p_commande_id, v_statut_actuel, 'livree', 'Convertie en vente ' || v_vente_id, auth.uid());

  return v_vente_id;
end;
$$;

notify pgrst, 'reload schema';
