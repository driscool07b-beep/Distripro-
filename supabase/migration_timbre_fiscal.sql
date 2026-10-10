-- =====================================================================
-- Timbre fiscal sur les paiements en espèces
--   • entreprises.timbre_actif / timbre_bareme : barème saisi par
--     l'entreprise (Paramètres → Pays et fiscalité), par tranches :
--     [{"de": 5001, "a": 100000, "montant": 100}, …] ("a" vide = sans limite).
--     Désactivé par défaut : rien ne change tant qu'il n'est pas activé.
--   • ventes.montant_timbre : timbre dû sur la part de la vente payée en
--     espèces au moment de la vente (hors crédit client utilisé).
--     Il s'ajoute au montant encaissé, mais pas au chiffre d'affaires
--     (le timbre est collecté pour le compte de l'État).
--   • La caisse attendue (encaisse_physique_vente) inclut le timbre.
-- À exécuter une fois dans le SQL Editor (ré-exécutable sans risque).
-- =====================================================================

alter table entreprises add column if not exists timbre_actif boolean not null default false;
alter table entreprises add column if not exists timbre_bareme jsonb not null default '[]'::jsonb;
alter table ventes add column if not exists montant_timbre numeric(14,2) not null default 0;

-- Montant du timbre pour un paiement en espèces donné, selon le barème.
create or replace function calculer_timbre(p_entreprise_id uuid, p_montant numeric)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select (t->>'montant')::numeric
    from entreprises e, jsonb_array_elements(e.timbre_bareme) t
    where e.id = p_entreprise_id and e.timbre_actif and coalesce(p_montant, 0) > 0
      and p_montant >= coalesce(nullif(t->>'de', '')::numeric, 0)
      and (nullif(t->>'a', '') is null or p_montant <= (t->>'a')::numeric)
    order by coalesce(nullif(t->>'de', '')::numeric, 0) desc
    limit 1), 0);
$$;
revoke execute on function calculer_timbre(uuid, numeric) from public, anon;
grant execute on function calculer_timbre(uuid, numeric) to authenticated, service_role;

-- Calcul à la fin de la transaction de vente (le crédit client utilisé est
-- enregistré juste après la vente) : aucune modification de creer_vente.
create or replace function timbre_vente_auto()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_especes numeric;
  v_timbre numeric;
begin
  select case when v.mode_reglement = 'espece'
    then v.montant_regle - coalesce((select sum(m.montant) from mouvements_credit_client m
                                     where m.vente_id = v.id and m.type_mouvement = 'utilisation_vente'), 0)
    else 0 end
  into v_especes
  from ventes v where v.id = new.id;
  v_timbre := calculer_timbre(new.entreprise_id, v_especes);
  if v_timbre > 0 then
    update ventes set montant_timbre = v_timbre where id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists timbre_vente on ventes;
create constraint trigger timbre_vente after insert on ventes
  deferrable initially deferred for each row execute function timbre_vente_auto();

-- Espèces réellement reçues pour une vente : timbre compris.
create or replace function encaisse_physique_vente(p_vente_id uuid)
returns numeric
language sql
security definer
stable
set search_path to 'public'
as $$
  select case when coalesce(v.mode_reglement, 'espece') in ('espece', 'cheque')
    then greatest(
      v.montant_regle
      + coalesce((select sum(a.trop_percu) from avoirs a where a.vente_id = v.id), 0)
      - coalesce((select sum(m.montant) from mouvements_credit_client m
                  where m.vente_id = v.id and m.type_mouvement = 'utilisation_vente'), 0), 0)
      + coalesce(v.montant_timbre, 0)
    else 0 end
  from ventes v where v.id = p_vente_id;
$$;

-- Réglage du timbre (administrateur / manager / comptable).
create or replace function modifier_timbre_fiscal(p_actif boolean, p_bareme jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t jsonb;
begin
  if current_entreprise_id() is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable') then raise exception 'accès refusé'; end if;
  if jsonb_typeof(coalesce(p_bareme, '[]'::jsonb)) <> 'array' then raise exception 'barème invalide'; end if;
  for t in select * from jsonb_array_elements(coalesce(p_bareme, '[]'::jsonb)) loop
    if coalesce(nullif(t->>'montant', '')::numeric, -1) < 0 then raise exception 'barème du timbre : montant invalide'; end if;
    if nullif(t->>'a', '') is not null and (t->>'a')::numeric < coalesce(nullif(t->>'de', '')::numeric, 0) then
      raise exception 'barème du timbre : tranche invalide';
    end if;
  end loop;
  if p_actif and jsonb_array_length(coalesce(p_bareme, '[]'::jsonb)) = 0 then
    raise exception 'saisissez au moins une tranche du barème du timbre';
  end if;
  update entreprises set timbre_actif = coalesce(p_actif, false), timbre_bareme = coalesce(p_bareme, '[]'::jsonb)
  where id = current_entreprise_id();
end;
$$;
revoke execute on function modifier_timbre_fiscal(boolean, jsonb) from public, anon;
grant execute on function modifier_timbre_fiscal(boolean, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';

-- Contrôle : doit renvoyer 3 lignes.
select proname from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('calculer_timbre', 'timbre_vente_auto', 'modifier_timbre_fiscal');
