-- Migration : outils de données de l'assistant IA conversationnel.
-- L'assistant ne lit JAMAIS la base librement : il appelle ces fonctions,
-- exécutées avec les droits de l'utilisateur qui pose la question.
--  - commercial : uniquement ses propres ventes et créances ;
--  - gestionnaire de stock : le stock uniquement ;
--  - direction, comptable : tout.
-- À exécuter dans l'éditeur SQL de Supabase.

-- Périmètre des ventes visibles par l'utilisateur.
create or replace function ia_peut_voir_vente(p_commercial_id uuid, p_created_by uuid)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $$
  select case current_role_utilisateur()
    when 'admin' then true when 'manager' then true when 'comptable' then true
    when 'commercial' then (p_commercial_id = auth.uid() or p_created_by = auth.uid())
    else false end;
$$;

-- 1. Indicateurs clés du moment.
create or replace function ia_indicateurs()
returns jsonb
language sql
security definer
stable
set search_path to 'public'
as $$
  with v as (
    select v.* from ventes v
    where v.entreprise_id = current_entreprise_id() and coalesce(v.statut, '') <> 'annulee'
      and ia_peut_voir_vente(v.commercial_id, v.created_by)
  ), j as (select (now() at time zone 'Africa/Abidjan')::date as d)
  select jsonb_build_object(
    'date_du_jour', (select d from j),
    'role_utilisateur', current_role_utilisateur(),
    'ca_du_jour', coalesce((select sum(total) from v, j where (v.created_at at time zone 'Africa/Abidjan')::date = j.d), 0),
    'nb_ventes_du_jour', (select count(*) from v, j where (v.created_at at time zone 'Africa/Abidjan')::date = j.d),
    'ca_du_mois', coalesce((select sum(total) from v, j where date_trunc('month', v.created_at at time zone 'Africa/Abidjan') = date_trunc('month', j.d::timestamp)), 0),
    'ca_mois_precedent', coalesce((select sum(total) from v, j where date_trunc('month', v.created_at at time zone 'Africa/Abidjan') = date_trunc('month', j.d::timestamp) - interval '1 month'), 0),
    'creances_total', coalesce((select sum(total - montant_regle) from v where total > montant_regle), 0),
    'creances_echues', coalesce((select sum(total - montant_regle) from v, j where total > montant_regle and date_echeance < j.d), 0),
    'produits_en_alerte', (
      select count(*) from produits p
      where p.entreprise_id = current_entreprise_id()
        and current_role_utilisateur() in ('admin', 'manager', 'comptable', 'gestionnaire_stock')
        and coalesce((select sum(quantite) from stocks s where s.produit_id = p.id), 0) <= coalesce(p.seuil_alerte, 0))
  );
$$;

-- 2. Ventes agrégées sur une période, par jour / mois / commercial / client / produit / magasin.
create or replace function ia_ventes(p_debut date, p_fin date, p_groupement text default 'mois', p_limite integer default 20)
returns table (cle text, nb_ventes bigint, quantite numeric, montant numeric, encaisse numeric)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
begin
  if p_groupement not in ('jour', 'mois', 'commercial', 'client', 'produit', 'magasin') then
    raise exception 'groupement invalide (jour, mois, commercial, client, produit, magasin)';
  end if;
  if p_groupement = 'produit' then
    return query
      select pr.nom::text, count(distinct v.id), sum(l.quantite)::numeric, sum(l.sous_total)::numeric, null::numeric
      from ventes v join ventes_lignes l on l.vente_id = v.id join produits pr on pr.id = l.produit_id
      where v.entreprise_id = current_entreprise_id() and coalesce(v.statut, '') <> 'annulee'
        and ia_peut_voir_vente(v.commercial_id, v.created_by)
        and (v.created_at at time zone 'Africa/Abidjan')::date between p_debut and p_fin
      group by pr.nom order by 4 desc limit least(greatest(p_limite, 1), 100);
    return;
  end if;
  return query
    select case p_groupement
             when 'jour' then to_char(v.created_at at time zone 'Africa/Abidjan', 'YYYY-MM-DD')
             when 'mois' then to_char(v.created_at at time zone 'Africa/Abidjan', 'YYYY-MM')
             when 'commercial' then coalesce(pc.nom, 'Vente de bureau')
             when 'client' then coalesce(c.nom, '—')
             else coalesce(d.nom, 'Stock terrain d''un commercial') end::text,
           count(*), null::numeric, sum(v.total)::numeric, sum(v.montant_regle)::numeric
    from ventes v
    left join profils pc on pc.id = v.commercial_id
    left join clients c on c.id = v.client_id
    left join depots d on d.id = v.depot_id
    where v.entreprise_id = current_entreprise_id() and coalesce(v.statut, '') <> 'annulee'
      and ia_peut_voir_vente(v.commercial_id, v.created_by)
      and (v.created_at at time zone 'Africa/Abidjan')::date between p_debut and p_fin
    group by 1
    -- Jours et mois : ordre chronologique ; autres : les plus gros montants d'abord.
    order by case when p_groupement in ('jour', 'mois') then 0 else -sum(v.total) end, 1
    limit least(greatest(p_limite, 1), 100);
end;
$$;

-- 3. Créances clients (restes à payer), les plus importantes d'abord.
create or replace function ia_creances(p_seulement_echues boolean default false, p_limite integer default 20)
returns table (client text, telephone text, vente text, date_vente date, echeance date, reste numeric, jours_de_retard integer)
language sql
security definer
stable
set search_path to 'public'
as $$
  select c.nom::text, c.telephone::text, v.numero_vente::text, (v.created_at at time zone 'Africa/Abidjan')::date,
         v.date_echeance, (v.total - v.montant_regle)::numeric,
         greatest(((now() at time zone 'Africa/Abidjan')::date - v.date_echeance), 0)::integer
  from ventes v join clients c on c.id = v.client_id
  where v.entreprise_id = current_entreprise_id() and coalesce(v.statut, '') <> 'annulee'
    and v.total > v.montant_regle and ia_peut_voir_vente(v.commercial_id, v.created_by)
    and (not p_seulement_echues or v.date_echeance < (now() at time zone 'Africa/Abidjan')::date)
  order by 6 desc
  limit least(greatest(p_limite, 1), 100);
$$;

-- 4. Stock par produit et par magasin.
create or replace function ia_stock(p_alertes_seulement boolean default false, p_magasin text default null)
returns table (produit text, magasin text, quantite integer, seuil_alerte integer, en_alerte boolean)
language sql
security definer
stable
set search_path to 'public'
as $$
  select p.nom::text, d.nom::text, s.quantite, p.seuil_alerte, s.quantite <= coalesce(p.seuil_alerte, 0)
  from stocks s join produits p on p.id = s.produit_id join depots d on d.id = s.depot_id
  where s.entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager', 'comptable', 'gestionnaire_stock')
    and (p_magasin is null or d.nom ilike '%' || p_magasin || '%')
    and (not p_alertes_seulement or s.quantite <= coalesce(p.seuil_alerte, 0))
  order by 5 desc, 1, 2
  limit 200;
$$;

-- 5. Stock en main des commerciaux.
create or replace function ia_stock_commerciaux()
returns table (commercial text, produit text, quantite integer)
language sql
security definer
stable
set search_path to 'public'
as $$
  select pc.nom::text, p.nom::text, sc.quantite
  from stock_commercial sc join profils pc on pc.id = sc.commercial_id join produits p on p.id = sc.produit_id
  where sc.entreprise_id = current_entreprise_id() and sc.quantite > 0
    and (current_role_utilisateur() in ('admin', 'manager', 'comptable', 'gestionnaire_stock') or sc.commercial_id = auth.uid())
  order by 1, 2;
$$;

notify pgrst, 'reload schema';
