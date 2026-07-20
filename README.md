# DistribPro — Socle applicatif v1

Application de gestion commerciale multi-tenant (React + Vite + Tailwind + Supabase).

Ce socle couvre : authentification multi-entreprise, tableau de bord (KPI), gestion clients, gestion produits/stock, et ventes avec décrémentation automatique du stock.

## 1. Installation

```bash
npm install
```

## 2. Configuration Supabase

1. Créez un projet sur [supabase.com](https://supabase.com) (si ce n'est pas déjà fait).
2. Dans l'éditeur SQL du projet, exécutez le contenu de `supabase/schema.sql`. Ce script crée toutes les tables, active la sécurité au niveau ligne (RLS) pour l'isolation entre entreprises, et installe les fonctions métier (`creer_produit`, `ajuster_stock`, `creer_vente`, `inscrire_entreprise`).
3. Copiez `.env.example` vers `.env` et renseignez vos clés (Project Settings → API dans Supabase) :

```bash
cp .env.example .env
```

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxxx
```

## 3. Créer votre première entreprise et votre compte admin

Le formulaire de connexion (`Login.jsx`) ne gère que la connexion, pas encore l'inscription. Pour créer votre premier compte administrateur :

1. Dans Supabase → Authentication → Users, créez un utilisateur (email + mot de passe) — ou utilisez `supabase.auth.signUp()` depuis la console du navigateur.
2. Dans l'éditeur SQL, connecté en tant que cet utilisateur (ou via un script), appelez :
   ```sql
   select inscrire_entreprise('Rama Cereal', 'Votre Nom');
   ```
   Cela crée l'entreprise (tenant) et votre profil `admin` rattaché.
3. Connectez-vous ensuite normalement via l'écran de connexion de l'application.

> Prochaine étape recommandée : construire un écran d'inscription self-service qui enchaîne `signUp()` puis `inscrire_entreprise()` automatiquement, pour que vos futurs clients puissent créer leur compte sans intervention manuelle.

## 4. Lancer l'application

```bash
npm run dev
```

## 5. Structure du projet

```
src/
  lib/supabase.js          Client Supabase (env vars)
  context/AuthContext.jsx  Session, profil, entreprise (tenant) courants
  components/
    Layout.jsx              Sidebar + navigation
    ProtectedRoute.jsx       Garde d'accès (session + statut abonnement)
  pages/
    Login.jsx                Connexion
    Dashboard.jsx             KPI + graphique ventes 7 jours + alertes stock
    Clients.jsx               Liste + création clients (avec géoloc)
    Stock.jsx                 Produits + ajustement stock (entrée/sortie)
    Ventes.jsx                Commande multi-articles + décrément stock auto
supabase/
  schema.sql                 Schéma complet + RLS + fonctions RPC
```

## 6. Notes d'architecture

- **Isolation multi-tenant** : chaque table métier porte un `entreprise_id`. Les RLS policies filtrent automatiquement par `current_entreprise_id()` (dérivé de la session Supabase Auth). Un utilisateur d'une entreprise ne peut jamais voir les données d'une autre.
- **Écritures via RPC** : la création de produits, l'ajustement de stock et la création de ventes passent par des fonctions PostgreSQL `SECURITY DEFINER` (`creer_produit`, `ajuster_stock`, `creer_vente`). Cela garantit l'atomicité (ex. une vente et la décrémentation du stock associée réussissent ou échouent ensemble) et empêche les incohérences qu'une suite d'appels séparés côté client pourrait créer.
- **Rôles** : `admin`, `manager`, `commercial`, `gestionnaire_stock`, `comptable` sont définis dans `profils.role`. Le filtrage fin des permissions par rôle (ex. cacher le bouton "Nouvelle vente" à un comptable) reste à implémenter dans l'UI — la donnée est déjà disponible via `useAuth().profil.role`.

## 7. Ce qu'il reste à construire (hors périmètre de ce socle)

- Écran d'inscription self-service (signup + `inscrire_entreprise`)
- Espace Super Admin DistribPro (gestion des tenants, facturation SaaS)
- Permissions granulaires par rôle dans l'UI
- Mode hors-ligne (PWA / IndexedDB) — le manifest est en place, le service worker reste à écrire
- Module Tournées, IA (segmentation, prévision), export Excel/PDF
