-- Migration : aucun moyen n'existait de modifier un produit après sa
-- création (prix, catégorie, seuil d'alerte) — pourtant les prix
-- fournisseurs évoluent. Un changement de prix étant un vecteur de fraude
-- classique, chaque changement est tracé (qui, quand, ancien → nouveau).
-- À exécuter dans l'éditeur SQL de Supabase.

create table if not exists produits_historique_prix (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id) on delete cascade,
  produit_id uuid not null references produits(id) on delete cascade,
  ancien_prix numeric(14,2),
  nouveau_prix numeric(14,2) not null,
  modifie_par uuid references profils(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_historique_prix_produit on produits_historique_prix(produit_id);

alter table produits_historique_prix enable row level security;

drop policy if exists produits_historique_prix_select on produits_historique_prix;
create policy produits_historique_prix_select on produits_historique_prix
  for select using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager', 'gestionnaire_stock')
  );

create or replace function modifier_produit(
  p_produit_id uuid,
  p_nom text,
  p_categorie text,
  p_prix_vente numeric,
  p_seuil_alerte integer
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_ancien_prix numeric;
begin
  if v_entreprise_id is null then
    raise exception 'utilisateur non rattaché à une entreprise';
  end if;
  if mon_compte_lecture_seule() then
    raise exception 'votre compte est en lecture seule — contactez votre administrateur';
  end if;
  if v_role not in ('admin', 'manager', 'gestionnaire_stock') then
    raise exception 'accès refusé : votre rôle ne permet pas de modifier un produit';
  end if;
  if p_nom is null or trim(p_nom) = '' then
    raise exception 'le nom du produit est requis';
  end if;
  if p_prix_vente is null or p_prix_vente <= 0 then
    raise exception 'prix invalide';
  end if;

  select prix_vente into v_ancien_prix
  from produits
  where id = p_produit_id and entreprise_id = v_entreprise_id;

  if not found then
    raise exception 'produit introuvable pour cette entreprise';
  end if;

  update produits
  set nom = trim(p_nom), categorie = p_categorie, prix_vente = p_prix_vente, seuil_alerte = p_seuil_alerte
  where id = p_produit_id and entreprise_id = v_entreprise_id;

  if v_ancien_prix is distinct from p_prix_vente then
    insert into produits_historique_prix (entreprise_id, produit_id, ancien_prix, nouveau_prix, modifie_par)
    values (v_entreprise_id, p_produit_id, v_ancien_prix, p_prix_vente, auth.uid());
  end if;
end;
$$;
