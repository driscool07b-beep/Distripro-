-- Migration : ajustement de stock — contrôle anti-fraude pour l'audit.
--
-- Problèmes corrigés :
-- 1. Deux versions de ajuster_stock coexistaient (5 et 7 paramètres). Celle
--    appelée par l'écran ne renvoyait pas l'identifiant du mouvement : le
--    justificatif ne pouvait donc jamais y être rattaché. L'inventaire, qui
--    l'appelle avec 5 paramètres, risquait aussi une erreur d'ambiguïté.
-- 2. Le justificatif « obligatoire » n'était vérifié que dans l'écran : en
--    passant par l'API, ou si l'envoi du fichier échouait après coup, le stock
--    était modifié SANS justificatif.
--
-- Nouveau fonctionnement :
-- - L'écran envoie d'abord le fichier, puis appelle ajuster_stock_manuel en
--   donnant son chemin. Tout se fait dans une seule transaction : pas de
--   justificatif valide = pas de mouvement de stock.
-- - Le serveur vérifie que le fichier existe réellement dans le stockage de
--   l'entreprise, et qu'il n'est pas déjà utilisé pour un autre mouvement.
-- - Le motif est obligatoire (au moins 3 caractères).
-- - ajuster_stock n'est plus appelable directement depuis l'application :
--   seules les fonctions internes (ex. validation d'inventaire) l'utilisent.
-- À exécuter dans l'éditeur SQL de Supabase.

-- 1. Une seule version de ajuster_stock (celle à 7 paramètres, avec les lots).
drop function if exists ajuster_stock(uuid, text, integer, text, uuid);
revoke execute on function ajuster_stock(uuid, text, integer, text, uuid, text, date) from public, anon, authenticated;

-- 2. Ajustement depuis l'écran, avec justificatif contrôlé côté serveur.
create or replace function ajuster_stock_manuel(
  p_produit_id uuid,
  p_type text,
  p_quantite integer,
  p_motif text,
  p_depot_id uuid default null,
  p_numero_lot text default null,
  p_date_peremption date default null,
  p_justificatif_chemin text default null,
  p_justificatif_nom text default null,
  p_justificatif_taille bigint default null,
  p_justificatif_type text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_obligatoire boolean;
  v_mouvement_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if p_quantite is null or p_quantite <= 0 then
    raise exception 'la quantité doit être supérieure à zéro';
  end if;
  if coalesce(length(trim(p_motif)), 0) < 3 then
    raise exception 'le motif de l''ajustement est obligatoire';
  end if;

  select coalesce(justificatif_stock_obligatoire, true) into v_obligatoire
  from entreprises where id = v_entreprise_id;

  if p_justificatif_chemin is null then
    if v_obligatoire then
      raise exception 'justificatif obligatoire : joignez une photo ou un PDF avant de valider';
    end if;
  else
    if split_part(p_justificatif_chemin, '/', 1) <> v_entreprise_id::text then
      raise exception 'chemin de justificatif invalide';
    end if;
    perform 1 from storage.objects
    where bucket_id = 'justificatifs-stock' and name = p_justificatif_chemin;
    if not found then
      raise exception 'justificatif introuvable : le fichier n''a pas été reçu, réessayez';
    end if;
    if exists (select 1 from justificatifs_mouvements where chemin = p_justificatif_chemin) then
      raise exception 'ce fichier est déjà rattaché à un autre mouvement';
    end if;
  end if;

  -- Contrôles de rôle, de dépôt, de stock et de lot : dans ajuster_stock.
  perform ajuster_stock(p_produit_id, p_type, p_quantite, trim(p_motif), p_depot_id, p_numero_lot, p_date_peremption);

  select id into v_mouvement_id
  from mouvements_stock
  where entreprise_id = v_entreprise_id and produit_id = p_produit_id and effectue_par = auth.uid()
  order by created_at desc
  limit 1;

  if p_justificatif_chemin is not null then
    insert into justificatifs_mouvements (entreprise_id, mouvement_id, chemin, nom_fichier, taille_octets, type_mime, ajoute_par)
    values (v_entreprise_id, v_mouvement_id, p_justificatif_chemin, p_justificatif_nom, p_justificatif_taille, p_justificatif_type, auth.uid());
    update mouvements_stock set reference_doc = p_justificatif_chemin where id = v_mouvement_id;
  end if;

  return v_mouvement_id;
end;
$$;

notify pgrst, 'reload schema';
