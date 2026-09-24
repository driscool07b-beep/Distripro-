import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import './lib/i18n'
import './index.css'

// Vérifie régulièrement s'il existe une nouvelle version (toutes les 10 min
// et à chaque retour sur l'application) : une fenêtre installée laissée
// ouverte toute la journée ne resterait sinon jamais à jour.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    const verifier = () => registration.update().catch(() => {})
    setInterval(verifier, 10 * 60 * 1000)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verifier() })
    window.addEventListener('focus', verifier)
  },
})

// Le nouveau service worker prend la main dès son installation : on
// l'annonce (bandeau « Mettre à jour ») sans recharger de force.
if ('serviceWorker' in navigator) {
  const avaitDejaUnControleur = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avaitDejaUnControleur) return
    window.__distribproMajDisponible = true
    window.dispatchEvent(new Event('distribpro-maj-disponible'))
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
