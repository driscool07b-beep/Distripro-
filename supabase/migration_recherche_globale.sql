-- Migration : recherche générale (barre du haut, raccourci Ctrl + K).
-- Une saisie (référence de document, nom, téléphone, compte, NCC…) renvoie les
-- documents correspondants QUE L'UTILISATEUR A LE DROIT DE VOIR :
--  - ventes : direction et comptable ; un commercial, seulement les siennes ;
--  - commandes, encaissements, versements, réconciliations : idem ;
--  - règlements groupés : direction et comptable ;
--  - clients : tous sauf le gestionnaire de stock ; produits : tous.
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function recherche_globale(p_terme text)
returns table (type text, id uuid, cible_id uuid, titre text, detail text, date_doc timestamptz)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_moi uuid := auth.uid();
  v_t text := trim(coalesce(p_terme, ''));
  v_motif text;
  v_direction boolean;
begin
  if v_entreprise_id is null or length(v_t) < 2 then return; end if;
  v_motif := '%' || replace(replace(v_t, '%', ''), '_', '\_') || '%';
  v_direction := v_role in ('admin', 'manager', 'comptable');

  -- Ventes (numéro, bon de livraison, référence FNE, client)
  return query
    select 'vente'::text, v.id, v.id, coalesce(v.numero_vente, 'Vente')::text,
           (coalesce(c.nom, '—') || ' · ' || to_char(v.total, 'FM999G999G999G990') || ' F' ||
            case when v.statut = 'annulee' then ' · annulée' else '' end)::text, v.created_at
    from ventes v left join clients c on c.id = v.client_id
    where v.entreprise_id = v_entreprise_id and ia_peut_voir_vente(v.commercial_id, v.created_by)
      and (v.numero_vente ilike v_motif or v.numero_bl ilike v_motif or v.fne_reference ilike v_motif)
    order by v.created_at desc limit 8;

  -- Commandes
  return query
    select 'commande'::text, co.id, co.id, coalesce(co.numero, 'Commande')::text,
           (coalesce(c.nom, '—') || ' · ' || replace(co.statut, '_', ' '))::text, co.created_at
    from commandes co left join clients c on c.id = co.client_id
    where co.entreprise_id = v_entreprise_id
      and (v_direction or v_role = 'gestionnaire_stock' or co.commercial_id = v_moi)
      and co.numero ilike v_motif
    order by co.created_at desc limit 8;

  -- Encaissements (règlements de créances) : ouvrent la vente concernée
  return query
    select 'encaissement'::text, r.id, r.vente_id, coalesce(r.numero, 'Encaissement')::text,
           (coalesce(c.nom, '—') || ' · ' || to_char(r.montant, 'FM999G999G999G990') || ' F')::text, r.created_at
    from reglements r left join ventes v on v.id = r.vente_id left join clients c on c.id = v.client_id
    where r.entreprise_id = v_entreprise_id
      and (v_direction or r.commercial_id = v_moi)
      and (r.numero ilike v_motif or r.reference_paiement ilike v_motif)
    order by r.created_at desc limit 8;

  -- Versements en caisse
  return query
    select 'versement'::text, vc.id, vc.id, coalesce(vc.numero, 'Versement')::text,
           (coalesce(p.nom, '—') || ' · ' || to_char(vc.montant, 'FM999G999G999G990') || ' F')::text, vc.created_at
    from versements_caisse vc left join profils p on p.id = vc.commercial_id
    where vc.entreprise_id = v_entreprise_id
      and (v_direction or vc.commercial_id = v_moi or vc.recu_par = v_moi)
      and vc.numero ilike v_motif
    order by vc.created_at desc limit 8;

  -- Fiches de réconciliation
  return query
    select 'reconciliation'::text, rc.id, rc.id, rc.numero::text,
           (coalesce(p.nom, '—') || ' · ' || to_char(rc.date_debut, 'DD/MM/YYYY') || ' → ' || to_char(rc.date_fin, 'DD/MM/YYYY'))::text, rc.created_at
    from reconciliations_commercial rc left join profils p on p.id = rc.commercial_id
    where rc.entreprise_id = v_entreprise_id
      and (peut_valider_caisse() or v_direction or rc.commercial_id = v_moi)
      and rc.numero ilike v_motif
    order by rc.created_at desc limit 8;

  -- Règlements groupés
  if v_direction then
    return query
      select 'reglement_groupe'::text, rg.id, rg.id, rg.numero::text,
             (coalesce(g.nom, '—') || ' · ' || to_char(rg.montant, 'FM999G999G999G990') || ' F')::text, rg.created_at
      from reglements_groupes rg left join groupes_clients g on g.id = rg.groupe_id
      where rg.entreprise_id = v_entreprise_id and (rg.numero ilike v_motif or rg.reference_paiement ilike v_motif)
      order by rg.created_at desc limit 5;
  end if;

  -- Clients (nom, téléphone, compte, NCC)
  if v_role <> 'gestionnaire_stock' then
    return query
      select 'client'::text, c.id, c.id, c.nom::text,
             concat_ws(' · ', c.telephone, c.compte_numero, c.ville)::text, c.created_at
      from clients c
      where c.entreprise_id = v_entreprise_id
        and (c.nom ilike v_motif or c.telephone ilike v_motif or c.compte_numero ilike v_motif or c.ncc ilike v_motif)
      order by c.nom limit 8;
  end if;

  -- Produits (nom, référence)
  return query
    select 'produit'::text, pr.id, pr.id, pr.nom::text,
           concat_ws(' · ', pr.reference, pr.categorie)::text, pr.created_at
    from produits pr
    where pr.entreprise_id = v_entreprise_id and (pr.nom ilike v_motif or pr.reference ilike v_motif)
    order by pr.nom limit 8;
end;
$$;

notify pgrst, 'reload schema';
