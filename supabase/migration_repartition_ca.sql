-- Migration : répartition du chiffre d'affaires (pour le camembert
-- Dashboard) par produit, zone/ville ou groupe de client.
--
-- Le solde des caisses n'a pas besoin de nouvelle fonction — il
-- réutilise solde_caisse(), déjà en place, appelée une fois par
-- caisse active depuis le frontend.
--
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function repartition_ca(p_type text, p_debut date, p_fin date)
returns table (label text, montant numeric)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé';
  end if;

  if p_type = 'produit' then
    return query
    select coalesce(pr.nom, 'Autre')::text, sum(vl.sous_total)
    from ventes v
    join ventes_lignes vl on vl.vente_id = v.id
    left join produits pr on pr.id = vl.produit_id
    where v.entreprise_id = current_entreprise_id()
      and v.statut <> 'annulee'
      and v.created_at::date between p_debut and p_fin
    group by pr.nom
    order by sum(vl.sous_total) desc;

  elsif p_type = 'zone' then
    return query
    select coalesce(c.ville, 'Non renseignée')::text, sum(v.total)
    from ventes v
    left join clients c on c.id = v.client_id
    where v.entreprise_id = current_entreprise_id()
      and v.statut <> 'annulee'
      and v.created_at::date between p_debut and p_fin
    group by c.ville
    order by sum(v.total) desc;

  elsif p_type = 'groupe' then
    return query
    select coalesce(g.nom, 'Sans groupe')::text, sum(v.total)
    from ventes v
    left join clients c on c.id = v.client_id
    left join groupes_clients g on g.id = c.groupe_id
    where v.entreprise_id = current_entreprise_id()
      and v.statut <> 'annulee'
      and v.created_at::date between p_debut and p_fin
    group by g.nom
    order by sum(v.total) desc;

  else
    raise exception 'type invalide';
  end if;
end;
$$;
