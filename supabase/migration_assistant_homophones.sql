-- Migration : assistant commercial — homophones de la dictée.
-- « mil » (la céréale) et « mille » / « 1000 » se prononcent pareil : la
-- recherche de produits les traite comme « mil ».
-- À exécuter dans l'éditeur SQL de Supabase.

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
  -- Homophones de la dictée : « mil » (céréale) est souvent transcrit
  -- « mille » ou « 1000 » ; « maïs » en « mais » (déjà sans accent).
  v_mots := array(
    select case when m in ('mille', '1000') then 'mil' else m end
    from unnest(string_to_array(normaliser_texte(p_texte), ' ')) m
    where length(m) >= 2 or m ~ '^\d+$');
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
