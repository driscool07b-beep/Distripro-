import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { connexion, estConnecte } = useAuth()
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [erreur, setErreur] = useState('')
  const [chargement, setChargement] = useState(false)

  if (estConnecte) return <Navigate to="/" replace />

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErreur('')
    setChargement(true)
    const { error } = await connexion(email, motDePasse)
    setChargement(false)
    if (error) {
      setErreur('Email ou mot de passe incorrect.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-petrol-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="font-display font-bold text-2xl text-white tracking-tight">DistribPro</div>
          <div className="text-sm text-white/50 mt-1">Gestion commerciale &amp; distribution</div>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <div>
            <label className="label">Adresse email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="vous@entreprise.com"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="label">Mot de passe</label>
            <input
              type="password"
              required
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              className="input-field"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {erreur && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {erreur}
            </div>
          )}

          <button type="submit" disabled={chargement} className="btn-primary w-full">
            {chargement ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <p className="text-center text-xs text-white/40 mt-6">
          Pas encore de compte entreprise ? Contactez votre administrateur DistribPro.
        </p>
      </div>
    </div>
  )
}
