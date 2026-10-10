-- =====================================================================
-- Paramétrage fiscal par entreprise (Côte d'Ivoire et autres pays)
--   • entreprises.pays : pays de l'entreprise (code ISO, CI par défaut).
--     La FNE (DGI Côte d'Ivoire) n'est proposée qu'aux entreprises de CI.
--   • entreprises.fne_code_exoneration : code TVA FNE des ventes sans TVA
--     (entreprise non assujettie, ou article à 0 %) — TVAD par défaut.
--   • clients.code_tva_fne / produits.code_tva_fne : exceptions facultatives
--     (client à l'export ou exonéré, produit exonéré…).
--     Ordre de priorité : client > produit > taux (18 % → TVA, 9 % → TVAB)
--     > code par défaut de l'entreprise.
--   • ventes_lignes.code_tva_fne : code réellement envoyé à la DGI (imprimé
--     sur la facture).
-- À exécuter une fois dans le SQL Editor (ré-exécutable sans risque).
-- =====================================================================

alter table entreprises add column if not exists pays text not null default 'CI';
alter table entreprises add column if not exists fne_code_exoneration text not null default 'TVAD';
alter table entreprises drop constraint if exists entreprises_fne_code_exoneration_check;
alter table entreprises add constraint entreprises_fne_code_exoneration_check check (fne_code_exoneration in ('TVAC', 'TVAD', 'TVAE'));

alter table clients add column if not exists code_tva_fne text;
alter table clients drop constraint if exists clients_code_tva_fne_check;
alter table clients add constraint clients_code_tva_fne_check check (code_tva_fne is null or code_tva_fne in ('TVA', 'TVAB', 'TVAC', 'TVAD', 'TVAE'));

alter table produits add column if not exists code_tva_fne text;
alter table produits drop constraint if exists produits_code_tva_fne_check;
alter table produits add constraint produits_code_tva_fne_check check (code_tva_fne is null or code_tva_fne in ('TVA', 'TVAB', 'TVAC', 'TVAD', 'TVAE'));

alter table ventes_lignes add column if not exists code_tva_fne text;

-- Réglages fiscaux de l'entreprise (administrateur / manager).
create or replace function modifier_parametrage_fiscal(p_pays text, p_code_exoneration text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_entreprise_id() is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'manager') then raise exception 'accès refusé : réservé à l''administrateur et au manager'; end if;
  if p_pays is null or p_pays !~ '^[A-Z]{2}$' then raise exception 'pays inconnu'; end if;
  if p_code_exoneration not in ('TVAC', 'TVAD', 'TVAE') then raise exception 'code TVA inconnu'; end if;
  update entreprises set pays = p_pays, fne_code_exoneration = p_code_exoneration where id = current_entreprise_id();
end;
$$;
revoke execute on function modifier_parametrage_fiscal(text, text) from public, anon;
grant execute on function modifier_parametrage_fiscal(text, text) to authenticated, service_role;

-- Code TVA FNE d'un produit (exception facultative).
create or replace function definir_code_tva_produit(p_produit_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_entreprise_id() is null then raise exception 'utilisateur non rattaché à une entreprise'; end if;
  if mon_compte_lecture_seule() then raise exception 'votre compte est en lecture seule — contactez votre administrateur'; end if;
  if current_role_utilisateur() not in ('admin', 'manager', 'comptable', 'gestionnaire_stock') then raise exception 'accès refusé'; end if;
  if p_code is not null and p_code not in ('TVA', 'TVAB', 'TVAC', 'TVAD', 'TVAE') then raise exception 'code TVA inconnu'; end if;
  update produits set code_tva_fne = p_code where id = p_produit_id and entreprise_id = current_entreprise_id();
end;
$$;
revoke execute on function definir_code_tva_produit(uuid, text) from public, anon;
grant execute on function definir_code_tva_produit(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- Contrôle : doit renvoyer 2 lignes.
select proname from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('modifier_parametrage_fiscal', 'definir_code_tva_produit');
