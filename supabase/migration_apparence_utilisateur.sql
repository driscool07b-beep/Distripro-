-- Migration : préférences d'apparence par utilisateur (pas par
-- entreprise) — thème de couleurs et taille de police, pour que
-- chacun personnalise son propre confort visuel, notamment les
-- personnes ayant des soucis de vision (police agrandie, thème
-- contraste élevé).
--
-- À exécuter dans l'éditeur SQL de Supabase.

alter table profils add column if not exists theme text not null default 'petrol'
  check (theme in ('petrol', 'ocean', 'forest', 'sunset', 'contraste'));
alter table profils add column if not exists taille_police text not null default 'normal'
  check (taille_police in ('normal', 'grand', 'tres_grand'));

create or replace function modifier_apparence(p_theme text, p_taille_police text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_theme not in ('petrol', 'ocean', 'forest', 'sunset', 'contraste') then
    raise exception 'thème invalide';
  end if;
  if p_taille_police not in ('normal', 'grand', 'tres_grand') then
    raise exception 'taille de police invalide';
  end if;

  update profils set theme = p_theme, taille_police = p_taille_police where id = auth.uid();
end;
$$;
