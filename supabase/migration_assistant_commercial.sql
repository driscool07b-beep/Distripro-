-- Migration : assistant commercial (saisie dictée de ventes et commandes).
-- Recherche « tolérante » des clients et des produits à partir d'un texte
-- dicté (accents, ordre des mots, fautes légères), avec le tarif du client
-- et le stock disponible. L'assistant ne fait que PRÉPARER : l'enregistrement
-- passe par creer_vente / creer_commande après validation du commercial.
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function normaliser_texte(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    translate(lower(coalesce(p, '')), 'àâäáãéèêëíìîïóòôöõúùûüçñ''’-', 'aaaaaeeeeiiiiooooouuuucn   '),
    '\s+', ' ', 'g');
$$;

-- Clients correspondant à un texte dicté (les plus proches d'abord).
create or replace function assistant_rechercher_clients(p_texte text)
returns table (id uuid, nom text, telephone text, ville text, score integer)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_mots text[];
begin
  if current_role_utilisateur() = 'gestionnaire_stock' then return; end if;
  v_mots := array(select m from unnest(string_to_array(normaliser_texte(p_texte), ' ')) m where length(m) >= 2);
  if coalesce(array_length(v_mots, 1), 0) = 0 then return; end if;
  return query
    select x.* from (
    select c.id, c.nom::text, c.telephone::text, c.ville::text,
           (select count(*)::integer from unnest(v_mots) m where normaliser_texte(c.nom) like '%' || m || '%')
             + case when normaliser_texte(c.nom) = normaliser_texte(p_texte) then 5 else 0 end
             + case when regexp_replace(coalesce(c.telephone, ''), '\D', '', 'g') <> ''
                     and regexp_replace(p_texte, '\D', '', 'g') like '%' || right(regexp_replace(c.telephone, '\D', '', 'g'), 8) || '%' then 5 else 0 end
    from clients c
    where c.entreprise_id = current_entreprise_id()
    ) x(id, nom, telephone, ville, score)
    where x.score > 0
    order by x.score desc, x.nom
    limit 6;
end;
$$;

-- Produits correspondant à un texte dicté, avec le prix applicable au client
-- (tarif négocié sinon prix de vente) et le stock disponible.
create or replace function assistant_rechercher_produits(p_texte text, p_client_id uuid default null)
returns table (id uuid, nom text, reference text, prix numeric, stock_en_main integer, stock_magasins integer, score integer)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_mots text[];
begin
  v_mots := array(select m from unnest(string_to_array(normaliser_texte(p_texte), ' ')) m where length(m) >= 2 or m ~ '^\d+$');
  if coalesce(array_length(v_mots, 1), 0) = 0 then return; end if;
  return query
    select x.* from (
    select p.id, p.nom::text, p.reference::text,
           coalesce((select t.prix_negocie from tarifs_client t where t.client_id = p_client_id and t.produit_id = p.id limit 1), p.prix_vente)::numeric,
           coalesce((select sc.quantite from stock_commercial sc where sc.commercial_id = auth.uid() and sc.produit_id = p.id), 0)::integer,
           coalesce((select sum(s.quantite) from stocks s where s.produit_id = p.id), 0)::integer,
           (select count(*)::integer from unnest(v_mots) m
             where normaliser_texte(p.nom || ' ' || coalesce(p.reference, '')) like '%' || m || '%')
    from produits p
    where p.entreprise_id = current_entreprise_id() and coalesce(p.actif, true)
    ) x(id, nom, reference, prix, stock_en_main, stock_magasins, score)
    where x.score > 0
    order by x.score desc, x.nom
    limit 6;
end;
$$;

notify pgrst, 'reload schema';
