-- Migration : objectifs — modification tracée (lot 3).
-- - Un objectif peut être modifié (période, montants, quantité, notes) par un
--   administrateur ou un manager, avec un motif obligatoire.
-- - Toute création, modification ou suppression est inscrite dans un
--   historique : qui, quand, valeurs avant / après, motif.
-- - La suppression passe aussi par une fonction avec motif (plus de
--   suppression directe sans trace).
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists historique_objectifs (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id),
  objectif_id uuid not null,
  action text not null check (action in ('creation', 'modification', 'suppression')),
  avant jsonb,
  apres jsonb,
  motif text,
  effectue_par uuid references profils(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_historique_objectifs on historique_objectifs (objectif_id, created_at);

alter table historique_objectifs enable row level security;
drop policy if exists historique_objectifs_select on historique_objectifs;
create policy historique_objectifs_select on historique_objectifs
  for select using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager')
  );

create or replace function journaliser_objectif()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_motif text := nullif(current_setting('distribpro.motif', true), '');
begin
  if tg_op = 'INSERT' then
    insert into historique_objectifs (entreprise_id, objectif_id, action, apres, effectue_par)
    values (new.entreprise_id, new.id, 'creation', to_jsonb(new), auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    insert into historique_objectifs (entreprise_id, objectif_id, action, avant, apres, motif, effectue_par)
    values (new.entreprise_id, new.id, 'modification', to_jsonb(old), to_jsonb(new), v_motif, auth.uid());
    return new;
  else
    insert into historique_objectifs (entreprise_id, objectif_id, action, avant, motif, effectue_par)
    values (old.entreprise_id, old.id, 'suppression', to_jsonb(old), v_motif, auth.uid());
    return old;
  end if;
end;
$$;

drop trigger if exists trg_journaliser_objectif on objectifs;
create trigger trg_journaliser_objectif
  after insert or update or delete on objectifs
  for each row execute function journaliser_objectif();

create or replace function modifier_objectif(
  p_objectif_id uuid,
  p_periode_debut date,
  p_periode_fin date,
  p_montant_cible numeric,
  p_quantite_cible integer,
  p_notes text,
  p_motif text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'manager') then
    raise exception 'seul un administrateur ou un manager peut modifier un objectif';
  end if;
  if coalesce(length(trim(p_motif)), 0) < 3 then raise exception 'le motif de la modification est obligatoire'; end if;
  if p_montant_cible is null and p_quantite_cible is null then raise exception 'indiquez un montant ou une quantité'; end if;
  if p_periode_fin < p_periode_debut then raise exception 'la date de fin doit suivre la date de début'; end if;

  perform set_config('distribpro.motif', trim(p_motif), true);
  update objectifs
  set periode_debut = p_periode_debut, periode_fin = p_periode_fin,
      montant_cible = p_montant_cible, quantite_cible = p_quantite_cible,
      notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_objectif_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'objectif introuvable'; end if;
end;
$$;

create or replace function supprimer_objectif(p_objectif_id uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
begin
  if v_entreprise_id is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'manager') then
    raise exception 'seul un administrateur ou un manager peut supprimer un objectif';
  end if;
  if coalesce(length(trim(p_motif)), 0) < 3 then raise exception 'le motif de la suppression est obligatoire'; end if;

  perform set_config('distribpro.motif', trim(p_motif), true);
  delete from objectifs where id = p_objectif_id and entreprise_id = v_entreprise_id;
  if not found then raise exception 'objectif introuvable'; end if;
end;
$$;

-- Plus de suppression directe (sans motif ni trace) depuis l'application.
drop policy if exists objectifs_delete on objectifs;

notify pgrst, 'reload schema';
