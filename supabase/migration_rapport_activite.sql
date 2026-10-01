-- Migration : rapport d'activité commerciale (PowerPoint) et rapport mensuel
-- automatique.
-- - rapport_activite_donnees : toutes les données d'un rapport sur une
--   période (synthèse et comparaison avec la période précédente, évolution,
--   clients, produits, commerciaux vs objectifs, magasins, créances, stock).
--   Interne : appelée seulement par la fonction serveur « rapport-activite ».
-- - rapport_activite : la même chose pour l'utilisateur connecté, dans la
--   limite de ses droits (un commercial ne voit que sa propre activité).
-- - Rapport mensuel automatique : le 1er de chaque mois à 7 h, le rapport du
--   mois écoulé est envoyé par email (PowerPoint joint) à la direction.
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function rapport_activite_donnees(p_entreprise_id uuid, p_debut date, p_fin date, p_commercial_id uuid default null)
returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_duree integer := (p_fin - p_debut) + 1;
  v_debut_prec date := p_debut - ((p_fin - p_debut) + 1);
  v_fin_prec date := p_debut - 1;
  v_aujourdhui date := (now() at time zone 'Africa/Abidjan')::date;
  v_par_mois boolean := (p_fin - p_debut) > 45;
  v_resultat jsonb;
begin
  if p_fin < p_debut then raise exception 'période invalide'; end if;
  if v_duree > 400 then raise exception 'période trop longue (13 mois maximum)'; end if;

  with ventes_periode as (
    select v.*, (v.created_at at time zone 'Africa/Abidjan')::date as jour
    from ventes v
    where v.entreprise_id = p_entreprise_id and coalesce(v.statut, '') <> 'annulee'
      and (p_commercial_id is null or v.commercial_id = p_commercial_id)
      and (v.created_at at time zone 'Africa/Abidjan')::date between p_debut and p_fin
  ), ventes_prec as (
    select v.* from ventes v
    where v.entreprise_id = p_entreprise_id and coalesce(v.statut, '') <> 'annulee'
      and (p_commercial_id is null or v.commercial_id = p_commercial_id)
      and (v.created_at at time zone 'Africa/Abidjan')::date between v_debut_prec and v_fin_prec
  ), toutes_ventes as (
    select v.* from ventes v
    where v.entreprise_id = p_entreprise_id and coalesce(v.statut, '') <> 'annulee'
      and (p_commercial_id is null or v.commercial_id = p_commercial_id)
  )
  select jsonb_build_object(
    'periode', jsonb_build_object('debut', p_debut, 'fin', p_fin, 'debut_precedente', v_debut_prec, 'fin_precedente', v_fin_prec,
                                  'granularite', case when v_par_mois then 'mois' else 'jour' end,
                                  'perimetre', case when p_commercial_id is null then 'entreprise' else 'commercial' end),
    'synthese', jsonb_build_object(
      'ca', coalesce((select sum(total) from ventes_periode), 0),
      'nb_ventes', (select count(*) from ventes_periode),
      'encaisse', coalesce((select sum(montant_regle) from ventes_periode), 0),
      'nb_clients_actifs', (select count(distinct client_id) from ventes_periode),
      'ca_precedent', coalesce((select sum(total) from ventes_prec), 0),
      'nb_ventes_precedent', (select count(*) from ventes_prec)),
    'evolution', coalesce((
      select jsonb_agg(jsonb_build_object('cle', cle, 'montant', montant) order by cle)
      from (select case when v_par_mois then to_char(jour, 'YYYY-MM') else to_char(jour, 'YYYY-MM-DD') end as cle, sum(total) as montant
            from ventes_periode group by 1) e), '[]'::jsonb),
    'top_clients', coalesce((
      select jsonb_agg(x order by (x->>'montant')::numeric desc) from (
        select jsonb_build_object('nom', c.nom, 'montant', sum(vp.total), 'nb', count(*)) as x
        from ventes_periode vp join clients c on c.id = vp.client_id
        group by c.id, c.nom order by sum(vp.total) desc limit 10) t), '[]'::jsonb),
    'top_produits', coalesce((
      select jsonb_agg(x order by (x->>'montant')::numeric desc) from (
        select jsonb_build_object('nom', p.nom, 'montant', sum(l.sous_total), 'quantite', sum(l.quantite)) as x
        from ventes_periode vp join ventes_lignes l on l.vente_id = vp.id join produits p on p.id = l.produit_id
        group by p.id, p.nom order by sum(l.sous_total) desc limit 10) t), '[]'::jsonb),
    'commerciaux', coalesce((
      select jsonb_agg(x order by (x->>'montant')::numeric desc) from (
        select jsonb_build_object(
          'nom', coalesce(pc.nom, 'Vente de bureau'),
          'montant', sum(vp.total), 'nb', count(*),
          'objectif', (select sum(o.montant_cible) from objectifs o
                       where o.entreprise_id = p_entreprise_id and o.commercial_id = vp.commercial_id
                         and o.periode_debut <= p_fin and o.periode_fin >= p_debut)) as x
        from ventes_periode vp left join profils pc on pc.id = vp.commercial_id
        group by vp.commercial_id, pc.nom order by sum(vp.total) desc limit 15) t), '[]'::jsonb),
    'magasins', coalesce((
      select jsonb_agg(x order by (x->>'montant')::numeric desc) from (
        select jsonb_build_object('nom', coalesce(d.nom, 'Stock terrain (commerciaux)'), 'montant', sum(vp.total)) as x
        from ventes_periode vp left join depots d on d.id = vp.depot_id
        group by d.nom) t), '[]'::jsonb),
    'creances', jsonb_build_object(
      'total', coalesce((select sum(total - montant_regle) from toutes_ventes where total > montant_regle), 0),
      'echues', coalesce((select sum(total - montant_regle) from toutes_ventes where total > montant_regle and date_echeance < v_aujourdhui), 0),
      'nb_factures_echues', (select count(*) from toutes_ventes where total > montant_regle and date_echeance < v_aujourdhui),
      'top', coalesce((
        select jsonb_agg(x order by (x->>'reste')::numeric desc) from (
          select jsonb_build_object('client', c.nom, 'reste', sum(tv.total - tv.montant_regle),
                                    'jours', max(greatest(v_aujourdhui - tv.date_echeance, 0))) as x
          from toutes_ventes tv join clients c on c.id = tv.client_id
          where tv.total > tv.montant_regle
          group by c.id, c.nom order by sum(tv.total - tv.montant_regle) desc limit 8) t), '[]'::jsonb)),
    'stock', case when p_commercial_id is null then jsonb_build_object(
      'nb_alertes', (select count(*) from produits p where p.entreprise_id = p_entreprise_id
                     and coalesce((select sum(quantite) from stocks s where s.produit_id = p.id), 0) <= coalesce(p.seuil_alerte, 0)),
      'alertes', coalesce((
        select jsonb_agg(x) from (
          select jsonb_build_object('produit', p.nom, 'quantite', coalesce(sum(s.quantite), 0), 'seuil', p.seuil_alerte) as x
          from produits p left join stocks s on s.produit_id = p.id
          where p.entreprise_id = p_entreprise_id
          group by p.id, p.nom, p.seuil_alerte
          having coalesce(sum(s.quantite), 0) <= coalesce(p.seuil_alerte, 0)
          order by coalesce(sum(s.quantite), 0) limit 10) t), '[]'::jsonb),
      'valeur_terrain', coalesce((select sum(sc.quantite * p.prix_vente) from stock_commercial sc join produits p on p.id = sc.produit_id
                                  where sc.entreprise_id = p_entreprise_id and sc.quantite > 0), 0))
    else jsonb_build_object(
      'valeur_terrain', coalesce((select sum(sc.quantite * p.prix_vente) from stock_commercial sc join produits p on p.id = sc.produit_id
                                  where sc.commercial_id = p_commercial_id and sc.quantite > 0), 0))
    end
  ) into v_resultat;
  return v_resultat;
end;
$$;
revoke all on function rapport_activite_donnees(uuid, date, date, uuid) from public, anon, authenticated;
grant execute on function rapport_activite_donnees(uuid, date, date, uuid) to service_role;

-- Pour l'utilisateur connecté (dans la limite de ses droits).
create or replace function rapport_activite(p_debut date, p_fin date)
returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_role text := current_role_utilisateur();
begin
  if v_role in ('admin', 'manager', 'comptable') then
    return rapport_activite_donnees(current_entreprise_id(), p_debut, p_fin, null);
  elsif v_role = 'commercial' then
    return rapport_activite_donnees(current_entreprise_id(), p_debut, p_fin, auth.uid());
  end if;
  raise exception 'rapport d''activité non disponible pour votre rôle';
end;
$$;

-- Réglages du rapport mensuel automatique.
alter table entreprises add column if not exists rapport_mensuel_actif boolean not null default false;
alter table entreprises add column if not exists rapport_mensuel_destinataires text;

create or replace function modifier_rapport_mensuel(p_actif boolean, p_destinataires text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_adresse text;
begin
  if current_role_utilisateur() <> 'admin' then raise exception 'seul un administrateur modifie ce réglage'; end if;
  foreach v_adresse in array regexp_split_to_array(coalesce(trim(p_destinataires), ''), '\s*[,;]\s*') loop
    if v_adresse <> '' and v_adresse !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'adresse email invalide : %', v_adresse; end if;
  end loop;
  update entreprises set rapport_mensuel_actif = coalesce(p_actif, false), rapport_mensuel_destinataires = nullif(trim(p_destinataires), '')
  where id = current_entreprise_id();
end;
$$;

-- Historique des rapports produits.
create table if not exists rapports_activite (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id),
  periode_debut date not null,
  periode_fin date not null,
  type text not null check (type in ('manuel', 'mensuel')),
  destinataires text,
  succes boolean not null,
  erreur text,
  demande_par uuid references profils(id),
  created_at timestamptz not null default now()
);
alter table rapports_activite enable row level security;
drop policy if exists rapports_activite_select on rapports_activite;
create policy rapports_activite_select on rapports_activite
  for select using (entreprise_id = current_entreprise_id() and current_role_utilisateur() in ('admin', 'manager', 'comptable'));

-- Secret partagé entre la planification et la fonction serveur (jamais lisible
-- depuis l'application : RLS sans politique).
create table if not exists plateforme_secrets (
  cle text primary key,
  valeur text not null
);
alter table plateforme_secrets enable row level security;
insert into plateforme_secrets (cle, valeur)
values ('rapport_mensuel', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (cle) do nothing;

-- Planification : le 1er de chaque mois à 7 h (heure d'Abidjan = UTC).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('rapport-mensuel-distribpro')
where exists (select 1 from cron.job where jobname = 'rapport-mensuel-distribpro');
select cron.schedule(
  'rapport-mensuel-distribpro',
  '0 7 1 * *',
  $cron$
    select net.http_post(
      url := 'https://eikazcqkimnaguwzlahd.supabase.co/functions/v1/rapport-activite',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-rapport-secret', (select valeur from public.plateforme_secrets where cle = 'rapport_mensuel')),
      body := '{"mode": "mensuel"}'::jsonb,
      timeout_milliseconds := 300000
    );
  $cron$
);

notify pgrst, 'reload schema';
