import { useState } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import SelecteurLangue from '../components/SelecteurLangue'
import ChampMotDePasse from '../components/ChampMotDePasse'

export default function Login() {
  const { t } = useTranslation()
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
      setErreur(t('connexion.erreurIdentifiants'))
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-petrol-950 px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-end mb-4">
          <SelecteurLangue className="!bg-white/10 !border-white/10 !text-white text-xs py-1.5 w-auto" />
        </div>
        <div className="text-center mb-8">
          <div className="font-display font-bold text-2xl text-white tracking-tight">DistribPro</div>
          <div className="text-sm text-white/50 mt-1">{t('connexion.tagline')}</div>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <div>
            <label className="label">{t('connexion.email')}</label>
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
            <label className="label">{t('connexion.motDePasse')}</label>
            <ChampMotDePasse
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
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
            {chargement ? t('connexion.enCours') : t('connexion.seConnecter')}
          </button>
        </form>

        <p className="text-center text-xs text-white/40 mt-6">
          {t('connexion.inviteRejoindre')}{' '}
          <Link to="/inscription" className="underline text-white/70">{t('connexion.creerCompte')}</Link>
        </p>
        <p className="text-center text-xs text-white/40 mt-2">
          {t('connexion.nouvelleEntreprise')}{' '}
          <Link to="/creer-entreprise" className="underline text-white/70">{t('connexion.creerEspace')}</Link>
        </p>
      </div>
    </div>
  )
}
