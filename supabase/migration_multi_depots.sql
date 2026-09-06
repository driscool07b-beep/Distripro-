-- Migration : gestion de plusieurs magasins de stockage (dépôts). La
-- structure (stocks avec contrainte unique produit_id+depot_id, table
-- depots) était déjà prête — cette migration ajoute la gestion (créer/
-- modifier un dépôt) et rend creer_produit + ajuster_stock compatibles
-- avec plusieurs dépôts (ils ne géraient qu'un seul dépôt implicite
-- jusqu'ici).
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function creer_depot(
  p_nom text,
  p_type text default null,
  p_responsable_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_depot_id uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager') then
    raise exception 'accès refusé : seul un administrateur ou un manager peut créer un dépôt';
  end if;
  if p_nom is null or trim(p_nom) = '' then
    raise exception 'le nom du dépôt est requis';
  end if;

  insert into depots (entreprise_id, nom, type, responsable_id, actif)
  values (v_entreprise_id, trim(p_nom), p_type, p_responsable_id, true)
  returning id into v_depot_id;

  -- Un produit doit avoir une ligne de stock (à 0) dans chaque dépôt actif,
  -- pour qu'une vente ou un ajustement puisse s'y faire sans erreur.
  insert into stocks (entreprise_id, produit_id, depot_id, quantite)
  select v_entreprise_id, id, v_depot_id, 0
  from produits
  where entreprise_id = v_entreprise_id
  on conflict (produit_id, depot_id) do nothing;

  return v_depot_id;
end;
$$;

create or replace function modifier_depot(
  p_depot_id uuid,
  p_nom text,
  p_type text,
  p_responsable_id uuid,
  p_actif boolean
)
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
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager') then
    raise exception 'accès refusé : seul un administrateur ou un manager peut modifier un dépôt';
  end if;
  if p_nom is null or trim(p_nom) = '' then
    raise exception 'le nom du dépôt est requis';
  end if;

  update depots
  set nom = trim(p_nom), type = p_type, responsable_id = p_responsable_id, actif = p_actif
  where id = p_depot_id and entreprise_id = v_entreprise_id;

  if not found then
    raise exception 'dépôt introuvable pour cette entreprise';
  end if;
end;
$$;

create or replace function creer_produit(
  p_nom text,
  p_categorie text,
  p_prix_vente numeric,
  p_seuil_alerte integer,
  p_quantite_initiale integer,
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
  v_produit_id uuid;
  v_depot_principal uuid;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattache a une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de créer un produit';
  end if;

  if p_depot_id is not null then
    perform 1 from depots where id = p_depot_id and entreprise_id = v_entreprise_id and actif = true;
    if not found then
      raise exception 'dépôt introuvable ou inactif pour cette entreprise';
    end if;
    v_depot_principal := p_depot_id;
  else
    select id into v_depot_principal
    from depots
    where entreprise_id = v_entreprise_id and actif = true
    order by nom
    limit 1;
  end if;

  if v_depot_principal is null then
    raise exception 'aucun depot actif trouve pour cette entreprise';
  end if;

  insert into produits (entreprise_id, nom, categorie, prix_vente, seuil_alerte)
  values (v_entreprise_id, p_nom, p_categorie, p_prix_vente, p_seuil_alerte)
  returning id into v_produit_id;

  -- Une ligne de stock (à 0) dans chaque dépôt actif de l'entreprise, avec
  -- la quantité initiale placée dans le dépôt choisi.
  insert into stocks (entreprise_id, produit_id, depot_id, quantite)
  select v_entreprise_id, v_produit_id, d.id,
    case when d.id = v_depot_principal then coalesce(p_quantite_initiale, 0) else 0 end
  from depots d
  where d.entreprise_id = v_entreprise_id and d.actif = true;

  if coalesce(p_quantite_initiale, 0) > 0 then
    insert into mouvements_stock (entreprise_id, produit_id, depot_id, type_mouvement, quantite, motif, effectue_par)
    values (v_entreprise_id, v_produit_id, v_depot_principal, 'entree', p_quantite_initiale, 'Stock initial', auth.uid());
  end if;

  return v_produit_id;
end;
$$;

create or replace function ajuster_stock(
  p_produit_id uuid,
  p_type text,
  p_quantite integer,
  p_motif text,
  p_depot_id uuid default null
)
returns void
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
  values (v_entreprise_id, p_produit_id, v_depot_id, p_type, p_quantite, p_motif, auth.uid());
end;
$$;
