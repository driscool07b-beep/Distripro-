import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import './lib/i18n'
import './index.css'

// Mises à jour : on vérifie régulièrement (toutes les 10 min et à chaque
// retour sur l'app) ; quand une version est prête, un bandeau propose
// « Mettre à jour » — c'est ce clic qui l'active puis recharge la page.
const mettreAJour = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.__distribproMajDisponible = true
    window.dispatchEvent(new Event('distribpro-maj-disponible'))
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return
    const verifier = () => registration.update().catch(() => {})
    setInterval(verifier, 10 * 60 * 1000)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verifier() })
  },
})
window.__distribproMettreAJour = () => mettreAJour(true)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
