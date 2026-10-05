-- Migration : taux de change dollar / F CFA actualisé automatiquement.
-- Le F CFA est arrimé à l'euro (1 EUR = 655,957 F CFA) : le taux USD/XOF se
-- déduit du taux EUR/USD de la Banque centrale européenne (Frankfurter).
-- Actualisation chaque jour à 16 h 30 (UTC), après la publication de la BCE ;
-- désactivable (taux_auto = 0) pour revenir à un taux saisi à la main.
-- À exécuter dans l'éditeur SQL de Supabase (après migration_console_plateforme.sql).

alter table plateforme_parametres add column if not exists maj_at timestamptz;
alter table plateforme_parametres add column if not exists source text;

insert into plateforme_parametres (cle, valeur, description) values
  ('taux_auto', 1, '1 = actualiser automatiquement chaque jour le taux dollar / F CFA (BCE) ; 0 = taux saisi à la main')
on conflict (cle) do nothing;

-- Enregistrement d'un taux reçu (fonction serveur uniquement), avec garde-fou.
create or replace function enregistrer_taux_change(p_taux numeric, p_date_cours text, p_source text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ancien numeric;
begin
  if coalesce(parametre_plateforme('taux_auto'), 1) <> 1 then return 'desactive'; end if;
  -- Garde-fou : un taux hors de cette plage est forcément une erreur de source.
  if p_taux is null or p_taux < 400 or p_taux > 1000 then
    raise exception 'taux improbable reçu (%) : ignoré', p_taux;
  end if;
  select valeur into v_ancien from plateforme_parametres where cle = 'taux_usd_fcfa';
  update plateforme_parametres
  set valeur = round(p_taux, 2), maj_at = now(), source = p_source || ' — cours du ' || coalesce(p_date_cours, '?')
  where cle = 'taux_usd_fcfa';
  insert into plateforme_journal (action, details)
  values ('taux_change', jsonb_build_object('ancien', v_ancien, 'nouveau', round(p_taux, 2), 'source', p_source, 'date_cours', p_date_cours));
  return 'ok';
end;
$$;
revoke all on function enregistrer_taux_change(numeric, text, text) from public, anon, authenticated;
grant execute on function enregistrer_taux_change(numeric, text, text) to service_role;

-- Un réglage manuel du taux par le promoteur garde la trace de sa source.
create or replace function plateforme_modifier_parametre(p_cle text, p_valeur numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform exiger_super_admin();
  if p_valeur is null or p_valeur < 0 then raise exception 'valeur invalide'; end if;
  update plateforme_parametres
  set valeur = p_valeur,
      maj_at = case when p_cle = 'taux_usd_fcfa' then now() else maj_at end,
      source = case when p_cle = 'taux_usd_fcfa' then 'saisie manuelle' else source end
  where cle = p_cle;
  if not found then raise exception 'paramètre inconnu'; end if;
  perform journaliser_plateforme('modification_parametre', null, jsonb_build_object('cle', p_cle, 'valeur', p_valeur));
end;
$$;

-- Actualisation quotidienne.
select cron.unschedule('taux-change-distribpro')
where exists (select 1 from cron.job where jobname = 'taux-change-distribpro');
select cron.schedule(
  'taux-change-distribpro',
  '30 16 * * *',
  $cron$
    select net.http_post(
      url := 'https://eikazcqkimnaguwzlahd.supabase.co/functions/v1/actualiser-taux-change',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'apikey', (select valeur from public.plateforme_secrets where cle = 'cle_publique'),
        'x-rapport-secret', (select valeur from public.plateforme_secrets where cle = 'rapport_mensuel')),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);

notify pgrst, 'reload schema';
