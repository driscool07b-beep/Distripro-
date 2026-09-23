-- Migration : responsable de caisse — restreint qui peut réellement
-- PAYER un décaissement validé à la personne qui détient
-- physiquement la caisse, plutôt qu'à n'importe quel admin/manager/
-- comptable.
--
-- Optionnel par entreprise : tant qu'aucun responsable n'est affecté
-- à une caisse, le comportement actuel est conservé (tout
-- admin/manager/comptable peut payer) — ne casse rien pour ceux qui
-- n'utilisent pas cette fonctionnalité.
--
-- À exécuter dans l'éditeur SQL de Supabase.

alter table caisses add column if not exists responsable_id uuid references profils(id);

create or replace function affecter_responsable_caisse(p_caisse_id uuid, p_responsable_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if current_role_utilisateur() <> 'admin' then
    raise exception 'accès refusé : seul un administrateur peut affecter un responsable de caisse';
  end if;
  if p_responsable_id is not null then
    perform 1 from profils where id = p_responsable_id and entreprise_id = current_entreprise_id();
    if not found then raise exception 'utilisateur introuvable pour cette entreprise'; end if;
  end if;
  update caisses set responsable_id = p_responsable_id
  where id = p_caisse_id and entreprise_id = current_entreprise_id();
end;
$$;

create or replace function payer_demande_decaissement(p_demande_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_entreprise_id uuid := current_entreprise_id();
  v_role text := current_role_utilisateur();
  v_demande record;
  v_responsable_id uuid;
begin
  if v_role not in ('admin', 'manager', 'comptable') then
    raise exception 'accès refusé';
  end if;

  select * into v_demande from demandes_decaissement
  where id = p_demande_id and entreprise_id = v_entreprise_id
  for update;
  if not found then
    raise exception 'demande introuvable';
  end if;

  select responsable_id into v_responsable_id from caisses where id = v_demande.caisse_id;
  if v_responsable_id is not null and v_responsable_id <> auth.uid() then
    raise exception 'accès refusé : seul le responsable de cette caisse peut effectuer ce paiement';
  end if;

  if v_demande.statut <> 'validee' then
    raise exception 'seule une demande validée peut être payée';
  end if;

  update demandes_decaissement
  set statut = 'payee', payee_par = auth.uid(), payee_at = now()
  where id = p_demande_id;
end;
$$;
