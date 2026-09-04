import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const NAV_ITEMS = [
  { to: '/', label: 'Tableau de bord', icon: DashIcon, end: true },
  { to: '/clients', label: 'Clients', icon: ClientsIcon },
  { to: '/groupes', label: 'Groupes de clients', icon: GroupesIcon },
  { to: '/carte-clients', label: 'Carte des clients', icon: CarteIcon },
  { to: '/stock', label: 'Produits & Stock', icon: StockIcon },
  { to: '/ventes', label: 'Ventes', icon: VentesIcon },
  { to: '/commandes', label: 'Commandes', icon: CommandesIcon },
  { to: '/tournees', label: 'Tournées', icon: VentesIcon },
  { to: '/rapports', label: 'Rapports de visite', icon: RapportsIcon },
  { to: '/creances', label: 'Créances', icon: CreancesIcon },
  { to: '/localiser-stock', label: 'Localiser un produit', icon: LocaliserIcon },
]

export default function Layout() {
  const { profil, entreprise, deconnexion } = useAuth()
  const [menuOuvert, setMenuOuvert] = useState(false)

  return (
    <div className="min-h-screen flex bg-canvas overflow-x-hidden">
      {menuOuvert && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setMenuOuvert(false)}
        />
      )}

      <aside
        className={`no-print fixed inset-y-0 left-0 z-50 w-64 shrink-0 bg-petrol-950 text-white flex flex-col transition-transform duration-200 md:static md:translate-x-0 ${
          menuOuvert ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-6 py-6 border-b border-white/10 flex items-center justify-between">
          <div>
            <div className="font-display font-bold text-lg tracking-tight">DistribPro</div>
            <div className="text-xs text-white/50 mt-0.5 truncate">{entreprise?.nom || '—'}</div>
          </div>
          <button
            onClick={() => setMenuOuvert(false)}
            className="md:hidden text-white/70 hover:text-white p-1"
            aria-label="Fermer le menu"
          >
            ✕
          </button>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMenuOuvert(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-amber-500 text-petrol-950'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
          {['admin', 'manager'].includes(profil?.role) && (
            <NavLink
              to="/analytique"
              onClick={() => setMenuOuvert(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-amber-500 text-petrol-950'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <AnalytiqueIcon className="w-4 h-4 shrink-0" />
              Analytique
            </NavLink>
          )}
          {['admin', 'manager'].includes(profil?.role) && (
            <NavLink
              to="/objectifs"
              onClick={() => setMenuOuvert(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-amber-500 text-petrol-950'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <ObjectifsIcon className="w-4 h-4 shrink-0" />
              Objectifs
            </NavLink>
          )}
          {['admin', 'manager'].includes(profil?.role) && (
            <NavLink
              to="/analyse-ia"
              onClick={() => setMenuOuvert(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-amber-500 text-petrol-950'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <AnalyseIAIcon className="w-4 h-4 shrink-0" />
              Analyse IA
            </NavLink>
          )}
          {['admin', 'manager', 'gestionnaire_stock'].includes(profil?.role) && (
            <NavLink
              to="/stock-commercial"
              onClick={() => setMenuOuvert(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-amber-500 text-petrol-950'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <StockCommercialIcon className="w-4 h-4 shrink-0" />
              Stock des commerciaux
            </NavLink>
          )}
          {['admin', 'manager', 'comptable'].includes(profil?.role) && (
            <NavLink
              to="/versements"
              onClick={() => setMenuOuvert(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-amber-500 text-petrol-950'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <VersementsIcon className="w-4 h-4 shrink-0" />
              Versements
            </NavLink>
          )}
          {profil?.role === 'admin' && (
            <NavLink
              to="/utilisateurs"
              onClick={() => setMenuOuvert(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-amber-500 text-petrol-950'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <EquipeIcon className="w-4 h-4 shrink-0" />
              Équipe
            </NavLink>
          )}
          {profil?.role === 'admin' && (
            <NavLink
              to="/parametres"
              onClick={() => setMenuOuvert(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-amber-500 text-petrol-950'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <SettingsIcon className="w-4 h-4 shrink-0" />
              Paramètres
            </NavLink>
          )}
        </nav>

        <div className="px-3 py-4 border-t border-white/10">
          <div className="px-3 py-2 mb-2">
            <div className="text-sm font-medium truncate">{profil?.nom}</div>
            <div className="text-xs text-white/50 capitalize">{profil?.role?.replace('_', ' ')}</div>
          </div>
          <button
            onClick={deconnexion}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            Déconnexion
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="no-print md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-line">
          <button
            onClick={() => setMenuOuvert(true)}
            className="text-petrol-800 p-1"
            aria-label="Ouvrir le menu"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <span className="font-display font-semibold">DistribPro</span>
        </div>
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function DashIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  )
}
function ClientsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="9" cy="8" r="3" /><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6" />
      <circle cx="17" cy="8" r="2.5" /><path d="M16 14.2c2.8.4 5 2.4 5 5.8" />
    </svg>
  )
}
function GroupesIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <rect x="3" y="4" width="7" height="7" rx="1" />
      <rect x="14" y="4" width="7" height="7" rx="1" />
      <rect x="3" y="15" width="7" height="7" rx="1" />
      <rect x="14" y="15" width="7" height="7" rx="1" />
    </svg>
  )
}
function CarteIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2Z" />
      <path d="M9 3v16M15 5v16" />
    </svg>
  )
}
function StockIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" />
    </svg>
  )
}
function VentesIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M3 3h2l2.4 12.4a2 2 0 0 0 2 1.6h7.2a2 2 0 0 0 2-1.6L21 8H6" />
      <circle cx="9" cy="20" r="1" /><circle cx="17" cy="20" r="1" />
    </svg>
  )
}
function EquipeIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="9" cy="7" r="3" />
      <path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />
      <path d="M16 4.2a3 3 0 0 1 0 5.6" />
      <path d="M21 21c0-3-1.7-5.6-4-6.7" />
    </svg>
  )
}
function SettingsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}
function RapportsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M9 13h6M9 17h6M9 9h1" />
    </svg>
  )
}
function CreancesIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5c0-1.4 1.1-2.5 2.5-2.5s2.5 1 2.5 2c0 1.5-2.5 2-2.5 2s-2.5.5-2.5 2c0 1 1.1 2 2.5 2s2.5-1.1 2.5-2.5" />
    </svg>
  )
}
function CommandesIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M20 7L12 3 4 7m16 0-8 4m8-4v10l-8 4M4 7l8 4m-8-4v10l8 4m0-10v10" />
    </svg>
  )
}
function AnalytiqueIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M3 3v18h18" />
      <path d="M7 16l4-6 4 3 5-8" />
    </svg>
  )
}
function ObjectifsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  )
}
function LocaliserIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
      <path d="M11 8v3l2 1" />
    </svg>
  )
}
function AnalyseIAIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9L19 15z" />
    </svg>
  )
}
function StockCommercialIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <rect x="3" y="7" width="18" height="13" rx="1" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 11h18" />
    </svg>
  )
}
function VersementsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 6v0M18 18v0" />
    </svg>
  )
}
