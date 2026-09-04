-- Migration : un commercial ne voit que ses propres données (ventes,
-- commandes, rapports de visite, tournées, stock en main, règlements,
-- versements) — sauf si profils.acces_etendu = true. Comptable, manager et
-- admin conservent une visibilité complète (nécessaire à leur rôle).
--
-- Remplace entièrement les anciennes policies (jamais juste ajoutées à
-- côté) pour éviter qu'une ancienne règle plus permissive reste active en
-- parallèle et annule la nouvelle restriction.
-- À exécuter dans l'éditeur SQL de Supabase.

create or replace function mon_acces_etendu()
returns boolean
language sql
stable
security definer
as $$
  select coalesce(acces_etendu, false) from profils where id = auth.uid();
$$;

-- ventes
drop policy if exists ventes_select on ventes;
create policy ventes_select on ventes
  for select using (
    entreprise_id = current_entreprise_id()
    and (
      current_role_utilisateur() <> 'commercial'
      or mon_acces_etendu()
      or commercial_id = auth.uid()
    )
  );

-- commandes (l'ancienne policy 'isolation_commandes' couvrait ALL — on la
-- scinde pour ne restreindre que la lecture)
drop policy if exists isolation_commandes on commandes;

drop policy if exists commandes_insert on commandes;
create policy commandes_insert on commandes
  for insert with check (entreprise_id = mon_entreprise_id());

drop policy if exists commandes_update on commandes;
create policy commandes_update on commandes
  for update using (entreprise_id = mon_entreprise_id());

drop policy if exists commandes_delete on commandes;
create policy commandes_delete on commandes
  for delete using (entreprise_id = mon_entreprise_id());

drop policy if exists commandes_select on commandes;
create policy commandes_select on commandes
  for select using (
    entreprise_id = mon_entreprise_id()
    and (
      current_role_utilisateur() <> 'commercial'
      or mon_acces_etendu()
      or commercial_id = auth.uid()
    )
  );

-- rapports_visite
drop policy if exists rapports_visite_select on rapports_visite;
create policy rapports_visite_select on rapports_visite
  for select using (
    entreprise_id = current_entreprise_id()
    and (
      current_role_utilisateur() <> 'commercial'
      or mon_acces_etendu()
      or commercial_id = auth.uid()
    )
  );

-- tournees (deux anciennes policies redondantes détectées : isolation_tournees
-- en ALL + tournees_select — les deux sont supprimées et remplacées)
drop policy if exists isolation_tournees on tournees;
drop policy if exists tournees_select on tournees;

drop policy if exists tournees_insert on tournees;
create policy tournees_insert on tournees
  for insert with check (entreprise_id = mon_entreprise_id());

drop policy if exists tournees_update on tournees;
create policy tournees_update on tournees
  for update using (entreprise_id = mon_entreprise_id());

drop policy if exists tournees_delete on tournees;
create policy tournees_delete on tournees
  for delete using (entreprise_id = mon_entreprise_id());

drop policy if exists tournees_select on tournees;
create policy tournees_select on tournees
  for select using (
    entreprise_id = mon_entreprise_id()
    and (
      current_role_utilisateur() <> 'commercial'
      or mon_acces_etendu()
      or commercial_id = auth.uid()
    )
  );

-- tournee_lignes
drop policy if exists tournee_lignes_select on tournee_lignes;
create policy tournee_lignes_select on tournee_lignes
  for select using (
    tournee_id in (
      select id from tournees
      where entreprise_id = current_entreprise_id()
      and (
        current_role_utilisateur() <> 'commercial'
        or mon_acces_etendu()
        or commercial_id = auth.uid()
      )
    )
  );

-- stock_commercial (un commercial ne doit voir que ce qu'il a lui-même en main)
drop policy if exists stock_commercial_select on stock_commercial;
create policy stock_commercial_select on stock_commercial
  for select using (
    entreprise_id = current_entreprise_id()
    and (
      current_role_utilisateur() <> 'commercial'
      or mon_acces_etendu()
      or commercial_id = auth.uid()
    )
  );

-- reglements (recouvrements)
drop policy if exists reglements_select on reglements;
create policy reglements_select on reglements
  for select using (
    entreprise_id = current_entreprise_id()
    and (
      current_role_utilisateur() <> 'commercial'
      or mon_acces_etendu()
      or commercial_id = auth.uid()
    )
  );

-- versements_caisse
drop policy if exists versements_caisse_select on versements_caisse;
create policy versements_caisse_select on versements_caisse
  for select using (
    entreprise_id = current_entreprise_id()
    and (
      current_role_utilisateur() <> 'commercial'
      or mon_acces_etendu()
      or commercial_id = auth.uid()
    )
  );
