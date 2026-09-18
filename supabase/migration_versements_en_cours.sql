-- Migration : synthèse des versements en cours pour le Dashboard —
-- ventes cash (commerciaux), recouvrement (commerciaux), ventes cash
-- (bureau), recouvrement (bureau), déjà versé et reste à verser, sur
-- la journée en cours.
--
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function versements_en_cours()
returns table (
  ventes_cash_commerciaux numeric,
  recouvrement_commerciaux numeric,
  ventes_cash_bureau numeric,
  recouvrement_bureau numeric,
  deja_verse numeric,
  reste_a_verser numeric
)
language plpgsql
security definer
stable
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_aujourdhui date := current_date;
  v_ventes_cash_commerciaux numeric;
  v_ventes_cash_bureau numeric;
  v_recouvrement_commerciaux numeric;
  v_recouvrement_bureau numeric;
  v_deja_verse numeric;
begin
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé';
  end if;

  select coalesce(sum(montant_regle), 0) into v_ventes_cash_commerciaux
  from ventes
  where entreprise_id = v_entreprise_id
    and mode_paiement = 'cash'
    and statut <> 'annulee'
    and commercial_id is not null
    and created_at::date = v_aujourdhui;

  select coalesce(sum(montant_regle), 0) into v_ventes_cash_bureau
  from ventes
  where entreprise_id = v_entreprise_id
    and mode_paiement = 'cash'
    and statut <> 'annulee'
    and commercial_id is null
    and created_at::date = v_aujourdhui;

  select coalesce(sum(montant), 0) into v_recouvrement_commerciaux
  from reglements
  where entreprise_id = v_entreprise_id
    and commercial_id is not null
    and created_at::date = v_aujourdhui;

  select coalesce(sum(montant), 0) into v_recouvrement_bureau
  from reglements
  where entreprise_id = v_entreprise_id
    and commercial_id is null
    and created_at::date = v_aujourdhui;

  select coalesce(sum(montant), 0) into v_deja_verse
  from versements_caisse
  where entreprise_id = v_entreprise_id
    and date_versement = v_aujourdhui;

  return query select
    v_ventes_cash_commerciaux,
    v_recouvrement_commerciaux,
    v_ventes_cash_bureau,
    v_recouvrement_bureau,
    v_deja_verse,
    (v_ventes_cash_commerciaux + v_recouvrement_commerciaux + v_ventes_cash_bureau + v_recouvrement_bureau) - v_deja_verse;
end;
$$;

-- Active le temps réel sur les tables concernées, pour que la carte
-- du Dashboard se mette à jour toute seule (sans recharger la page)
-- dès qu'une vente, un règlement ou un versement est enregistré.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ventes') then
    alter publication supabase_realtime add table ventes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'reglements') then
    alter publication supabase_realtime add table reglements;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'versements_caisse') then
    alter publication supabase_realtime add table versements_caisse;
  end if;
end $$;
