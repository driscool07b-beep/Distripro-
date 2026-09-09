import { useState } from 'react'
import { Navigate, Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { traduireErreur } from '../lib/erreurs'
import SelecteurLangue from '../components/SelecteurLangue'

export default function Inscription() {
  const { t } = useTranslation()
  const { inscription, estConnecte } = useAuth()
  const [searchParams] = useSearchParams()
  const emailPredefini = searchParams.get('email') || ''
  const [email, setEmail] = useState(emailPredefini)
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [erreur, setErreur] = useState('')
  const [chargement, setChargement] = useState(false)
  const [succes, setSucces] = useState(false)

  if (estConnecte) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setErreur('')

    if (motDePasse.length < 6) {
      setErreur(t('inscription.mdpMinLength'))
      return
    }
    if (motDePasse !== confirmation) {
      setErreur(t('inscription.mdpMismatch'))
      return
    }

    setChargement(true)
    const { data, error } = await inscription(email.trim(), motDePasse)
    setChargement(false)

    if (error) {
      setErreur(traduireErreur(error.message))
      return
    }

    if (data?.session) {
      return
    }
    setSucces(true)
  }

  if (succes) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-petrol-950 px-4">
        <div className="w-full max-w-sm card p-6 text-center">
          <h1 className="font-semibold text-lg mb-2">{t('inscription.compteCree')}</h1>
          <p className="text-sm text-petrol-600 mb-4">{t('inscription.verifierEmail')}</p>
          <Link to="/connexion" className="btn-primary inline-block">{t('inscription.allerConnexion')}</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-petrol-950 px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-end mb-4">
          <SelecteurLangue className="!bg-white/10 !border-white/10 !text-white text-xs py-1.5 w-auto" />
        </div>
        <div className="text-center mb-8">
          <div className="font-display font-bold text-2xl text-white tracking-tight">DistribPro</div>
          <div className="text-sm text-white/50 mt-1">{t('inscription.creerVotreCompte')}</div>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <p className="text-xs text-petrol-500">{t('inscription.utiliserEmailInvitation')}</p>
          <div>
            <label className="label">{t('connexion.email')}</label>
            <input
              type="email"
              required
              readOnly={!!emailPredefini}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`input-field ${emailPredefini ? 'bg-canvas text-petrol-600' : ''}`}
              placeholder="vous@entreprise.com"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="label">{t('connexion.motDePasse')}</label>
            <input
              type="password"
              required
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              className="input-field"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">{t('inscription.confirmerMotDePasse')}</label>
            <input
              type="password"
              required
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              className="input-field"
              autoComplete="new-password"
            />
          </div>
          {erreur && <p className="text-sm text-red-600">{erreur}</p>}
          <button type="submit" disabled={chargement} className="btn-primary w-full">
            {chargement ? t('inscription.enCours') : t('inscription.creerMonCompte')}
          </button>
          <p className="text-xs text-center text-petrol-500">
            {t('inscription.dejaCompte')} <Link to="/connexion" className="underline">{t('connexion.seConnecter')}</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
