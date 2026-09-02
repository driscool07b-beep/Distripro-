-- Migration : fix creer_commande — lignes_commande.montant_ligne est une
-- colonne calculée automatiquement par PostgreSQL (generated column), il ne
-- faut jamais lui donner de valeur explicite à l'insertion.
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function creer_commande(
  p_client_id uuid,
  p_lignes jsonb,
  p_commercial_id uuid default null,
  p_depot_id uuid default null,
  p_mode_paiement text default 'cash',
  p_montant_paye numeric default null,
  p_date_livraison_souhaitee date default null,
  p_notes text default null,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := mon_entreprise_id();
  v_role text := current_role_utilisateur();
  v_commande_id uuid;
  v_ligne jsonb;
  v_montant_ht numeric(14,2) := 0;
  v_montant_paye numeric(14,2);
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role not in ('admin', 'manager', 'commercial', 'comptable') then
    raise exception 'accès refusé : votre rôle ne permet pas de créer une commande';
  end if;
  if p_mode_paiement not in ('cash', 'credit') then
    raise exception 'mode de paiement invalide';
  end if;

  perform 1 from clients where id = p_client_id and entreprise_id = v_entreprise_id;
  if not found then
    raise exception 'client introuvable pour cette entreprise';
  end if;

  if jsonb_array_length(p_lignes) = 0 then
    raise exception 'la commande doit contenir au moins un article';
  end if;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    v_montant_ht := v_montant_ht + ((v_ligne->>'quantite')::integer * (v_ligne->>'prix_unitaire')::numeric);
  end loop;

  v_montant_paye := coalesce(least(p_montant_paye, v_montant_ht), 0);
  if v_montant_paye < 0 then
    v_montant_paye := 0;
  end if;

  insert into commandes (
    entreprise_id, client_id, commercial_id, depot_id, statut,
    montant_ht, montant_tva, montant_ttc, mode_paiement, montant_paye,
    date_livraison_souhaitee, notes, latitude_saisie, longitude_saisie
  )
  values (
    v_entreprise_id, p_client_id, p_commercial_id, p_depot_id, 'brouillon',
    v_montant_ht, 0, v_montant_ht, p_mode_paiement, v_montant_paye,
    p_date_livraison_souhaitee, p_notes, p_latitude, p_longitude
  )
  returning id into v_commande_id;

  for v_ligne in select * from jsonb_array_elements(p_lignes)
  loop
    insert into lignes_commande (commande_id, produit_id, quantite, prix_unitaire)
    values (
      v_commande_id,
      (v_ligne->>'produit_id')::uuid,
      (v_ligne->>'quantite')::integer,
      (v_ligne->>'prix_unitaire')::numeric
    );
  end loop;

  insert into commande_historique (entreprise_id, commande_id, ancien_statut, nouveau_statut, effectue_par)
  values (v_entreprise_id, v_commande_id, null, 'brouillon', auth.uid());

  return v_commande_id;
end;
$$;
