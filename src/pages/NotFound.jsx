import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
      <div className="text-center">
        <div className="font-display text-5xl font-bold text-petrol-900 mb-2">404</div>
        <p className="text-petrol-700 mb-6">Cette page n'existe pas.</p>
        <Link to="/" className="btn-primary inline-block">
          Retour au tableau de bord
        </Link>
      </div>
    </div>
  )
}
