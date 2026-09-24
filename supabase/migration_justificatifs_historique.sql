-- Migration : justificatifs des mouvements de stock — historique complet.
-- Principe anti-fraude : un justificatif n'est JAMAIS supprimé. En cas
-- d'erreur de fichier, on le REMPLACE avec un motif obligatoire ; l'ancien
-- fichier reste conservé et consultable (qui l'a déposé, quand, qui l'a
-- remplacé et pourquoi). Chaque fichier a son propre chemin : aucun fichier
-- stocké ne peut être écrasé (pas de droit de modification ni de suppression
-- sur le stockage).
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists justificatifs_mouvements (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id),
  mouvement_id uuid not null references mouvements_stock(id),
  chemin text not null,
  nom_fichier text,
  taille_octets bigint,
  type_mime text,
  ajoute_par uuid references profils(id),
  created_at timestamptz not null default now(),
  remplace_le timestamptz,
  remplace_par uuid references profils(id),
  motif_remplacement text
);
create index if not exists idx_justificatifs_mouvement on justificatifs_mouvements (mouvement_id, created_at);

alter table justificatifs_mouvements enable row level security;

drop policy if exists justificatifs_mouvements_select on justificatifs_mouvements;
create policy justificatifs_mouvements_select on justificatifs_mouvements
  for select using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager', 'gestionnaire_stock', 'comptable')
  );
-- Aucune politique d'écriture : tout passe par la fonction ci-dessous.

-- Reprise des justificatifs déjà attachés.
insert into justificatifs_mouvements (entreprise_id, mouvement_id, chemin, ajoute_par, created_at)
select m.entreprise_id, m.id, m.reference_doc, m.effectue_par, m.created_at
from mouvements_stock m
where m.reference_doc is not null
  and not exists (select 1 from justificatifs_mouvements j where j.mouvement_id = m.id);

-- Les comptables (audit) peuvent aussi consulter les fichiers.
drop policy if exists justificatifs_stock_select on storage.objects;
create policy justificatifs_stock_select on storage.objects
  for select using (
    bucket_id = 'justificatifs-stock'
    and (storage.foldername(name))[1] = current_entreprise_id()::text
    and current_role_utilisateur() in ('admin', 'manager', 'gestionnaire_stock', 'comptable')
  );

-- Attacher (ou remplacer, avec motif) le justificatif d'un mouvement.
drop function if exists attacher_justificatif_mouvement(uuid, text);

create or replace function attacher_justificatif_mouvement(
  p_mouvement_id uuid,
  p_chemin text,
  p_nom_fichier text default null,
  p_taille_octets bigint default null,
  p_type_mime text default null,
  p_motif_remplacement text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_actuel uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé';
  end if;

  perform 1 from mouvements_stock where id = p_mouvement_id and entreprise_id = v_entreprise_id for update;
  if not found then
    raise exception 'mouvement introuvable pour cette entreprise';
  end if;

  -- Le fichier doit se trouver dans le dossier de l'entreprise.
  if split_part(p_chemin, '/', 1) <> v_entreprise_id::text then
    raise exception 'chemin de fichier invalide';
  end if;

  select id into v_actuel
  from justificatifs_mouvements
  where mouvement_id = p_mouvement_id and remplace_le is null
  order by created_at desc
  limit 1;

  if v_actuel is not null then
    if coalesce(trim(p_motif_remplacement), '') = '' then
      raise exception 'un justificatif existe déjà : indiquez le motif du remplacement';
    end if;
    update justificatifs_mouvements
    set remplace_le = now(), remplace_par = auth.uid(), motif_remplacement = trim(p_motif_remplacement)
    where id = v_actuel;
  end if;

  insert into justificatifs_mouvements (entreprise_id, mouvement_id, chemin, nom_fichier, taille_octets, type_mime, ajoute_par)
  values (v_entreprise_id, p_mouvement_id, p_chemin, p_nom_fichier, p_taille_octets, p_type_mime, auth.uid());

  update mouvements_stock set reference_doc = p_chemin where id = p_mouvement_id;
end;
$$;

notify pgrst, 'reload schema';
