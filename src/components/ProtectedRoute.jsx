import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { estConnecte, loading, entreprise } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <div className="text-petrol-700 font-mono text-sm">Chargement…</div>
      </div>
    )
  }

  if (!estConnecte) {
    return <Navigate to="/connexion" replace />
  }

  if (entreprise?.statut === 'suspendu') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
        <div className="card p-8 max-w-md text-center">
          <h2 className="text-lg font-semibold mb-2">Compte suspendu</h2>
          <p className="text-sm text-petrol-700">
            L'abonnement de votre entreprise est actuellement suspendu. Contactez le support DistribPro pour régulariser votre situation.
          </p>
        </div>
      </div>
    )
  }

  return children
}
