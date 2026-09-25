-- Migration : audit de sécurité n°3 (anti-fraude).
-- Principe : les champs sensibles ne peuvent plus être modifiés « à la main »
-- depuis l'application (requête directe à l'API) ; seules les fonctions
-- serveur contrôlées (RPC) peuvent les changer.
-- Dans les déclencheurs ci-dessous, current_user = 'authenticated' signifie
-- « requête directe d'un utilisateur » ; une fonction serveur (security
-- definer) s'exécute sous un autre rôle et n'est donc pas bloquée.
-- À exécuter dans l'éditeur SQL de Supabase.

-- ---------------------------------------------------------------------------
-- 1. ABONNEMENT : un administrateur client ne peut pas modifier lui-même son
--    offre, son statut ni ses dates d'échéance (sinon : abonnement gratuit).
-- ---------------------------------------------------------------------------
create or replace function proteger_abonnement_entreprise()
returns trigger
language plpgsql
as $$
begin
  -- Comparaison par nom de colonne (via jsonb) : fonctionne même si une
  -- colonne d'abonnement n'existe pas encore dans cette base.
  if current_user in ('authenticated', 'anon') then
    if exists (
      select 1 from unnest(array['id', 'plan', 'statut', 'cycle_facturation', 'date_fin_essai',
                                 'date_prochaine_echeance', 'created_at']) as c
      where (to_jsonb(new) -> c) is distinct from (to_jsonb(old) -> c)
    ) then
      raise exception 'modification non autorisée : l''abonnement ne peut être changé que par un paiement ou par le support DistribPro';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_abonnement_entreprise on entreprises;
create trigger trg_proteger_abonnement_entreprise
  before update on entreprises
  for each row execute function proteger_abonnement_entreprise();

-- ---------------------------------------------------------------------------
-- 2. CLIENTS : champs sensibles protégés.
--    - Position GPS : sert à vérifier qu'une visite a eu lieu sur place. Un
--      commercial ne peut la saisir que si elle est vide ; ensuite, seuls
--      admin/manager peuvent la corriger (sinon : fausses visites depuis chez soi).
--    - Plafond de crédit : admin/manager uniquement.
--    - Commercial attitré (portefeuille) : admin/manager/responsables tournées.
--    - Solde d'avoir : jamais modifiable directement (uniquement par les
--      opérations de vente/avoir/remboursement).
-- ---------------------------------------------------------------------------
-- Attention : fonction volontairement SANS « security definer », pour que
-- current_user reflète bien l'appelant.
create or replace function proteger_champs_clients()
returns trigger
language plpgsql
as $$
declare
  v_role text;
  v_responsable boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  v_role := current_role_utilisateur();
  select coalesce(responsable_tournees, false) into v_responsable
  from profils where id = auth.uid();

  if new.entreprise_id is distinct from old.entreprise_id then
    raise exception 'modification non autorisée';
  end if;
  if new.solde_credit is distinct from old.solde_credit then
    raise exception 'le solde d''avoir d''un client ne se modifie pas directement';
  end if;
  if new.limite_credit is distinct from old.limite_credit and v_role not in ('admin', 'manager') then
    raise exception 'seul un administrateur ou un manager peut modifier le plafond de crédit';
  end if;
  if new.commercial_id is distinct from old.commercial_id
     and v_role not in ('admin', 'manager') and not v_responsable then
    raise exception 'seul un responsable peut changer le commercial attitré d''un client';
  end if;
  if (new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude)
     and old.latitude is not null and old.longitude is not null
     and v_role not in ('admin', 'manager') then
    raise exception 'la position GPS de ce client est déjà enregistrée : seul un administrateur ou un manager peut la corriger';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_champs_clients on clients;
create trigger trg_proteger_champs_clients
  before update on clients
  for each row execute function proteger_champs_clients();

-- ---------------------------------------------------------------------------
-- 3. COMMANDES : plus de suppression (une commande s'annule, elle ne
--    disparaît pas) ; en modification directe, seul le bon de commande du
--    client (référence + fichier) peut être changé. Tout le reste (statut,
--    montants, client, commercial) passe par les fonctions serveur.
-- ---------------------------------------------------------------------------
drop policy if exists commandes_delete on commandes;

create or replace function proteger_commandes()
returns trigger
language plpgsql
as $$
declare
  v_libres text[] := array['bon_commande_client_reference', 'bon_commande_client_path', 'updated_at'];
begin
  if current_user in ('authenticated', 'anon')
     and (to_jsonb(new) - v_libres) is distinct from (to_jsonb(old) - v_libres) then
    raise exception 'une commande ne se modifie que par ses actions (confirmer, préparer, livrer, annuler)';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_commandes on commandes;
create trigger trg_proteger_commandes
  before update on commandes
  for each row execute function proteger_commandes();

-- ---------------------------------------------------------------------------
-- 4. TOURNÉES : plus aucune écriture directe. Création, validation, ajout et
--    retrait de clients passent par les fonctions serveur (qui vérifient les
--    rôles, la validation par un responsable et la clôture des tournées
--    passées). Sinon un commercial pouvait s'auto-valider, changer la date
--    d'une tournée passée ou la supprimer.
-- ---------------------------------------------------------------------------
drop policy if exists tournees_insert on tournees;
drop policy if exists tournees_update on tournees;
drop policy if exists tournees_delete on tournees;

-- ---------------------------------------------------------------------------
-- 5. PRODUITS : création réservée à ceux qui gèrent le catalogue.
-- ---------------------------------------------------------------------------
drop policy if exists produits_insert on produits;
create policy produits_insert on produits
  for insert with check (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() in ('admin', 'manager', 'gestionnaire_stock')
  );

-- ---------------------------------------------------------------------------
-- 6. PREUVES (photos de visite, pièces jointes) : plus d'écrasement ni de
--    suppression d'un fichier déjà déposé. Chaque envoi a désormais son
--    propre nom de fichier.
-- ---------------------------------------------------------------------------
drop policy if exists pieces_jointes_update on storage.objects;
drop policy if exists client_photos_update on storage.objects;
drop policy if exists client_photos_delete on storage.objects;

-- ---------------------------------------------------------------------------
-- 7. LANGUE : chaque utilisateur peut enregistrer sa propre langue
--    (auparavant seul l'administrateur y parvenait, sans message d'erreur).
-- ---------------------------------------------------------------------------
create or replace function definir_ma_langue(p_langue text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_langue not in ('fr', 'en', 'ar', 'zh') then
    raise exception 'langue non prise en charge';
  end if;
  update profils set langue = p_langue where id = auth.uid();
end;
$$;

notify pgrst, 'reload schema';
