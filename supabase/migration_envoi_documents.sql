-- Migration : envoi des documents aux clients (email et WhatsApp).
-- - Réglage : envoi automatique du reçu / de la facture par email après
--   chaque vente (si le client a une adresse email).
-- - Traçabilité de chaque envoi (document, canal, destinataire, résultat).
-- L'email est envoyé par la fonction serveur « envoyer-document » (Resend).
-- À exécuter dans l'éditeur SQL de Supabase.

alter table entreprises add column if not exists envoi_auto_email boolean not null default false;

create or replace function modifier_envoi_auto_email(p_actif boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_role_utilisateur() <> 'admin' then raise exception 'seul un administrateur modifie ce réglage'; end if;
  update entreprises set envoi_auto_email = coalesce(p_actif, false) where id = current_entreprise_id();
end;
$$;

create table if not exists envois_documents (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references entreprises(id),
  vente_id uuid references ventes(id),
  commande_id uuid references commandes(id),
  type_document text not null check (type_document in ('recu', 'facture_fne', 'proforma', 'avoir')),
  canal text not null check (canal in ('email', 'whatsapp')),
  destinataire text,
  succes boolean not null,
  erreur text,
  automatique boolean not null default false,
  effectue_par uuid references profils(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_envois_documents_vente on envois_documents (vente_id, created_at);
alter table envois_documents enable row level security;
drop policy if exists envois_documents_select on envois_documents;
create policy envois_documents_select on envois_documents
  for select using (entreprise_id = current_entreprise_id());
-- Le partage WhatsApp (ouvert depuis le téléphone de l'utilisateur) est
-- consigné par l'application elle-même.
drop policy if exists envois_documents_insert on envois_documents;
create policy envois_documents_insert on envois_documents
  for insert with check (entreprise_id = current_entreprise_id() and canal = 'whatsapp' and effectue_par = auth.uid());

notify pgrst, 'reload schema';
