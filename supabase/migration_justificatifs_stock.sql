-- Migration : possibilité de joindre un justificatif (photo/PDF scanné ou
-- téléchargé) à un mouvement de stock — ex. bon d'approvisionnement de
-- l'usine. Utilise la colonne reference_doc déjà présente sur
-- mouvements_stock, qui stockera le chemin du fichier dans le bucket dédié.
-- À exécuter dans l'éditeur SQL de Supabase.

insert into storage.buckets (id, name, public)
values ('justificatifs-stock', 'justificatifs-stock', false)
on conflict (id) do nothing;

drop policy if exists justificatifs_stock_select on storage.objects;
create policy justificatifs_stock_select on storage.objects
  for select using (
    bucket_id = 'justificatifs-stock'
    and (storage.foldername(name))[1] = current_entreprise_id()::text
  );

drop policy if exists justificatifs_stock_insert on storage.objects;
create policy justificatifs_stock_insert on storage.objects
  for insert with check (
    bucket_id = 'justificatifs-stock'
    and (storage.foldername(name))[1] = current_entreprise_id()::text
    and current_role_utilisateur() in ('admin', 'manager', 'gestionnaire_stock')
    and not mon_compte_lecture_seule()
  );

-- ajuster_stock doit désormais renvoyer l'id du mouvement créé, pour que le
-- justificatif puisse y être attaché juste après l'enregistrement. Le
-- changement de type de retour (void -> uuid) impose de supprimer l'ancienne
-- version avant de recréer.
drop function if exists ajuster_stock(uuid, text, integer, text, uuid);

create or replace function ajuster_stock(
  p_produit_id uuid,
  p_type text,
  p_quantite integer,
  p_motif text,
  p_depot_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_quantite_actuelle integer;
  v_depot_id uuid;
  v_nb_depots integer;
  v_mouvement_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattache a une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas d''ajuster le stock magasin';
  end if;
  if p_type not in ('entree', 'sortie') then
    raise exception 'type de mouvement invalide';
  end if;

  if p_depot_id is not null then
    v_depot_id := p_depot_id;
  else
    select count(*) into v_nb_depots from depots where entreprise_id = v_entreprise_id and actif = true;
    if v_nb_depots > 1 then
      raise exception 'plusieurs dépôts existent — précisez le dépôt à ajuster';
    end if;
    select id into v_depot_id from depots where entreprise_id = v_entreprise_id and actif = true limit 1;
  end if;

  select quantite into v_quantite_actuelle
  from stocks
  where produit_id = p_produit_id and depot_id = v_depot_id and entreprise_id = v_entreprise_id
  for update;

  if v_quantite_actuelle is null then
    raise exception 'produit introuvable dans ce dépôt pour cette entreprise';
  end if;

  if p_type = 'sortie' and v_quantite_actuelle < p_quantite then
    raise exception 'stock insuffisant';
  end if;

  update stocks
  set quantite = quantite + (case when p_type = 'entree' then p_quantite else -p_quantite end),
      updated_at = now()
  where produit_id = p_produit_id and depot_id = v_depot_id and entreprise_id = v_entreprise_id;

  insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
  values (v_entreprise_id, p_produit_id, v_depot_id, p_type, p_quantite, p_motif, auth.uid())
  returning id into v_mouvement_id;

  return v_mouvement_id;
end;
$$;

create or replace function attacher_justificatif_mouvement(p_mouvement_id uuid, p_chemin text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé';
  end if;

  update mouvements_stock
  set reference_doc = p_chemin
  where id = p_mouvement_id and entreprise_id = v_entreprise_id;

  if not found then
    raise exception 'mouvement introuvable pour cette entreprise';
  end if;
end;
$$;
