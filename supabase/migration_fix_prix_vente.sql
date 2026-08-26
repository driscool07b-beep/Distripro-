-- Migration : basculer creer_produit() de prix_unitaire vers prix_vente
-- (produits.prix_vente est la colonne réellement utilisée en production ;
--  produits.prix_unitaire est une colonne orpheline, restée à 0)
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function creer_produit(
  p_nom text,
  p_categorie text,
  p_prix_vente numeric,
  p_seuil_alerte integer,
  p_quantite_initiale integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_produit_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;

  insert into produits (entreprise_id, nom, categorie, prix_vente, seuil_alerte)
  values (v_entreprise_id, p_nom, p_categorie, p_prix_vente, p_seuil_alerte)
  returning id into v_produit_id;

  insert into stocks (entreprise_id, produit_id, quantite)
  values (v_entreprise_id, v_produit_id, coalesce(p_quantite_initiale, 0));

  if coalesce(p_quantite_initiale, 0) > 0 then
    insert into mouvements_stock (entreprise_id, produit_id, type, quantite, motif, created_by)
    values (v_entreprise_id, v_produit_id, 'entree', p_quantite_initiale, 'Stock initial', auth.uid());
  end if;

  return v_produit_id;
end;
$$;
