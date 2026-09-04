-- Migration : permettre à l'admin de modifier une invitation en attente
-- (la policy de mise à jour n'existait pas encore — seule la suppression
-- était possible).
-- À exécuter dans l'éditeur SQL de Supabase.

drop policy if exists invitations_update on invitations;
create policy invitations_update on invitations
  for update using (
    entreprise_id = current_entreprise_id()
    and current_role_utilisateur() = 'admin'
  );
