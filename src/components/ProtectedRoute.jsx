import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { t } = useTranslation()
  const { estConnecte, loading, entreprise, profil, session, profilError, rechargerProfil, deconnexion } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <div className="text-petrol-700 font-mono text-sm">{t('commun.chargement')}</div>
      </div>
    )
  }

  if (!estConnecte) {
    return <Navigate to="/connexion" replace />
  }

  if (session?.user && !profil) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
        <div className="card p-6 max-w-md text-center space-y-3">
          {profilError ? (
            <>
              <p className="text-sm font-medium text-red-600">{t('auth.profilImpossible')}</p>
              <p className="text-xs text-petrol-600 font-mono break-words">{profilError}</p>
            </>
          ) : (
            <div className="text-petrol-700 font-mono text-sm">{t('commun.chargementProfil')}</div>
          )}
          {profilError && (
            <div className="flex gap-2 justify-center pt-1">
              <button onClick={rechargerProfil} className="btn-primary text-xs">{t('actions.reessayer')}</button>
              <button onClick={deconnexion} className="btn-secondary text-xs">{t('menu.deconnexion')}</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (entreprise?.statut === 'suspendu') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
        <div className="card p-8 max-w-md text-center">
          <h2 className="text-lg font-semibold mb-2">{t('auth.compteSuspenduTitre')}</h2>
          <p className="text-sm text-petrol-700">{t('auth.compteSuspenduTexte')}</p>
        </div>
      </div>
    )
  }

  return children
}
