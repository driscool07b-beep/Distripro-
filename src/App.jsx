import { useEffect, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { direction } from './lib/i18n'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import { useAuth } from './context/AuthContext'
const Vitrine = lazy(() => import('./pages/Vitrine'))
const ReinitialiserMotDePasse = lazy(() => import('./pages/ReinitialiserMotDePasse'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Clients = lazy(() => import('./pages/Clients'))
const Stock = lazy(() => import('./pages/Stock'))
const Ventes = lazy(() => import('./pages/Ventes'))
const NotFound = lazy(() => import('./pages/NotFound'))
const Tournees = lazy(() => import('./pages/Tournees'))
const Parametres = lazy(() => import('./pages/Parametres'))
const Rapports = lazy(() => import('./pages/Rapports'))
const Creances = lazy(() => import('./pages/Creances'))
const GrandLivre = lazy(() => import('./pages/GrandLivre'))
const Commandes = lazy(() => import('./pages/Commandes'))
const Analytique = lazy(() => import('./pages/Analytique'))
const LocaliserStock = lazy(() => import('./pages/LocaliserStock'))
const Messagerie = lazy(() => import('./pages/Messagerie'))
const Apparence = lazy(() => import('./pages/Apparence'))
const JournalCaisse = lazy(() => import('./pages/JournalCaisse'))
const Aide = lazy(() => import('./pages/Aide'))
const Banques = lazy(() => import('./pages/Banques'))
const PlanComptable = lazy(() => import('./pages/PlanComptable'))
const NotesUtilisation = lazy(() => import('./pages/NotesUtilisation'))
const AnalyseIA = lazy(() => import('./pages/AnalyseIA'))
const StockCommercial = lazy(() => import('./pages/StockCommercial'))
const Versements = lazy(() => import('./pages/Versements'))
const Reconciliations = lazy(() => import('./pages/Reconciliations'))
const AssistantIA = lazy(() => import('./pages/AssistantIA'))
const PagesLegales = lazy(() => import('./pages/PagesLegales'))
const ConsolePlateforme = lazy(() => import('./pages/ConsolePlateforme'))
const MonAbonnement = lazy(() => import('./pages/MonAbonnement'))
const Groupes = lazy(() => import('./pages/Groupes'))
const Inscription = lazy(() => import('./pages/Inscription'))
const CreerEntreprise = lazy(() => import('./pages/CreerEntreprise'))
const Depots = lazy(() => import('./pages/Depots'))
const MouvementsStock = lazy(() => import('./pages/MouvementsStock'))
const Utilisateurs = lazy(() => import('./pages/Utilisateurs'))
const Objectifs = lazy(() => import('./pages/Objectifs'))
const CarteClients = lazy(() => import('./pages/CarteClients'))
const MesVersements = lazy(() => import('./pages/MesVersements'))

// Affiché le temps de charger une page (découpage : chaque page est
// téléchargée à la première ouverture, puis gardée en cache).
function ChargementPage() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-4 border-petrol-200 border-t-amber-500 animate-spin" aria-label="Chargement" />
    </div>
  )
}

// Racine du site : un visiteur non connecté qui arrive sur distribpro.com voit
// le site vitrine ; un utilisateur connecté arrive sur son espace. Depuis
// l'application installée sur le téléphone, on va directement à la connexion.
function Racine() {
  const { estConnecte, loading } = useAuth()
  const { pathname } = useLocation()
  const appliInstallee = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches
  if (pathname === '/' && !loading && !estConnecte) {
    return appliInstallee ? <Navigate to="/connexion" replace /> : <Vitrine />
  }
  return (
    <ProtectedRoute>
      <Layout />
    </ProtectedRoute>
  )
}

export default function App() {
  const { i18n } = useTranslation()

  useEffect(() => {
    document.documentElement.dir = direction(i18n.language)
    document.documentElement.lang = i18n.language
  }, [i18n.language])

  return (
    <Suspense fallback={<ChargementPage />}>
      <Routes>
      <Route path="/connexion" element={<Login />} />
      <Route path="/reinitialiser-mot-de-passe" element={<ReinitialiserMotDePasse />} />
      <Route path="/inscription" element={<Inscription />} />
      <Route path="/creer-entreprise" element={<CreerEntreprise />} />
      <Route path="/legal/:document" element={<PagesLegales />} />

      <Route path="/presentation" element={<Vitrine />} />

      <Route path="/" element={<Racine />}>
        <Route index element={<Dashboard />} />
        <Route path="clients" element={<Clients />} />
        <Route path="stock" element={<Stock />} />
        <Route path="depots" element={<Depots />} />
        <Route path="mouvements-stock" element={<MouvementsStock />} />
        <Route path="ventes" element={<Ventes />} />
        <Route path="tournees" element={<Tournees />} />
        <Route path="rapports" element={<Rapports />} />
        <Route path="creances" element={<Creances />} />
        <Route path="commandes" element={<Commandes />} />
        <Route path="analytique" element={<Analytique />} />
        <Route path="localiser-stock" element={<LocaliserStock />} />
        <Route path="messagerie" element={<Messagerie />} />
        <Route path="apparence" element={<Apparence />} />
        <Route path="journal-caisse" element={<JournalCaisse />} />
        <Route path="aide" element={<Aide />} />
        <Route path="banques" element={<Banques />} />
        <Route path="plan-comptable" element={<PlanComptable />} />
        <Route path="notes-utilisation" element={<NotesUtilisation />} />
        <Route path="analyse-ia" element={<AnalyseIA />} />
        <Route path="assistant" element={<AssistantIA />} />
        <Route path="plateforme" element={<ConsolePlateforme />} />
        <Route path="abonnement" element={<MonAbonnement />} />
        <Route path="stock-commercial" element={<StockCommercial />} />
        <Route path="versements" element={<Versements />} />
        <Route path="reconciliations" element={<Reconciliations />} />
        <Route path="mes-versements" element={<MesVersements />} />
        <Route path="groupes" element={<Groupes />} />
        <Route path="utilisateurs" element={<Utilisateurs />} />
        <Route path="objectifs" element={<Objectifs />} />
        <Route path="carte-clients" element={<CarteClients />} />
        <Route path="grand-livre" element={<GrandLivre />} />
        <Route path="parametres" element={<Parametres />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  )
}
