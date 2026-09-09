-- Migration : ajoute le transfert de stock entre deux dépôts, chaînon
-- manquant pour que le gestionnaire de stock puisse gérer autre chose que
-- les sorties vers les commerciaux (réceptions fournisseur/usine, casses,
-- reconditionnement passent par ajuster_stock qui gère déjà le dépôt —
-- seul le transfert entre deux dépôts avait besoin d'une fonction dédiée,
-- car il doit débiter l'un et créditer l'autre de façon atomique).
--
-- La table mouvements_stock n'autorise que 'entree'/'sortie' (pas de type
-- 'transfert') : on enregistre donc deux mouvements distincts, reliés
-- par leur texte de motif ("Transfert vers X" / "Transfert depuis X").
-- La colonne reference_doc reste volontairement inutilisée ici : c'est
-- celle où attacher_justificatif_mouvement stocke le fichier joint, donc
-- on ne doit pas s'en servir pour autre chose (un justificatif peut être
-- joint à chacun des deux mouvements du transfert).
--
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function transferer_stock(
  p_produit_id uuid,
  p_depot_source_id uuid,
  p_depot_destination_id uuid,
  p_quantite integer,
  p_motif text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_nom_source text;
  v_nom_destination text;
  v_stock_source integer;
  v_mouvement_sortie_id uuid;
  v_mouvement_entree_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de transférer du stock';
  end if;
  if p_quantite is null or p_quantite <= 0 then
    raise exception 'la quantité doit être supérieure à zéro';
  end if;
  if p_depot_source_id = p_depot_destination_id then
    raise exception 'le dépôt source et le dépôt destination doivent être différents';
  end if;

  select nom into v_nom_source from depots where id = p_depot_source_id and entreprise_id = v_entreprise_id and actif = true;
  select nom into v_nom_destination from depots where id = p_depot_destination_id and entreprise_id = v_entreprise_id and actif = true;
  if v_nom_source is null or v_nom_destination is null then
    raise exception 'dépôt introuvable ou inactif pour cette entreprise';
  end if;

  select quantite into v_stock_source
  from stocks
  where produit_id = p_produit_id and depot_id = p_depot_source_id and entreprise_id = v_entreprise_id
  for update;

  if v_stock_source is null then
    raise exception 'produit introuvable dans le dépôt source';
  end if;
  if v_stock_source < p_quantite then
    raise exception 'stock insuffisant dans le dépôt source';
  end if;

  -- Verrouille aussi la ligne destination si elle existe déjà, pour éviter
  -- une mise à jour concurrente pendant le transfert.
  perform 1 from stocks
  where produit_id = p_produit_id and depot_id = p_depot_destination_id and entreprise_id = v_entreprise_id
  for update;

  update stocks
  set quantite = quantite - p_quantite, updated_at = now()
  where produit_id = p_produit_id and depot_id = p_depot_source_id and entreprise_id = v_entreprise_id;

  insert into stocks (entreprise_id, produit_id, depot_id, quantite)
  values (v_entreprise_id, p_produit_id, p_depot_destination_id, p_quantite)
  on conflict (produit_id, depot_id)
  do update set quantite = stocks.quantite + excluded.quantite, updated_at = now();

  insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
  values (
    v_entreprise_id, p_produit_id, p_depot_source_id, 'sortie', p_quantite,
    'Transfert vers ' || v_nom_destination || case when p_motif is not null and trim(p_motif) <> '' then ' — ' || trim(p_motif) else '' end,
    auth.uid()
  )
  returning id into v_mouvement_sortie_id;

  insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
  values (
    v_entreprise_id, p_produit_id, p_depot_destination_id, 'entree', p_quantite,
    'Transfert depuis ' || v_nom_source || case when p_motif is not null and trim(p_motif) <> '' then ' — ' || trim(p_motif) else '' end,
    auth.uid()
  )
  returning id into v_mouvement_entree_id;

  return jsonb_build_object('mouvement_sortie_id', v_mouvement_sortie_id, 'mouvement_entree_id', v_mouvement_entree_id);
end;
$$;
