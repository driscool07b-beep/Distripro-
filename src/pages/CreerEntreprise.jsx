import { useState } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { traduireErreur } from '../lib/erreurs'
import SelecteurLangue from '../components/SelecteurLangue'

export default function CreerEntreprise() {
  const { t } = useTranslation()
  const { inscription, estConnecte } = useAuth()
  const [nomEntreprise, setNomEntreprise] = useState('')
  const [nomAdmin, setNomAdmin] = useState('')
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [erreur, setErreur] = useState('')
  const [chargement, setChargement] = useState(false)
  const [succes, setSucces] = useState(false)

  if (estConnecte) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setErreur('')

    if (!nomEntreprise.trim() || !nomAdmin.trim()) {
      setErreur(t('creerEntreprise.champsRequis'))
      return
    }
    if (motDePasse.length < 6) {
      setErreur(t('inscription.mdpMinLength'))
      return
    }
    if (motDePasse !== confirmation) {
      setErreur(t('inscription.mdpMismatch'))
      return
    }

    setChargement(true)
    const { data, error } = await inscription(email.trim(), motDePasse, {
      nom_entreprise: nomEntreprise.trim(),
      nom_admin: nomAdmin.trim(),
    })

    if (error) {
      setChargement(false)
      setErreur(traduireErreur(error.message))
      return
    }

    if (data?.session) {
      const { error: erreurCreation } = await supabase.rpc('inscrire_entreprise', {
        p_nom_entreprise: nomEntreprise.trim(),
        p_nom_admin: nomAdmin.trim(),
      })
      setChargement(false)
      if (erreurCreation) {
        setErreur(`${t('commun.erreur')} : ${traduireErreur(erreurCreation.message)}`)
        return
      }
      return
    }

    setChargement(false)
    setSucces(true)
  }

  if (succes) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-petrol-950 px-4">
        <div className="w-full max-w-sm card p-6 text-center">
          <h1 className="font-semibold text-lg mb-2">{t('inscription.compteCree')}</h1>
          <p className="text-sm text-petrol-600 mb-4">{t('creerEntreprise.verifierEmail')}</p>
          <Link to="/connexion" className="btn-primary inline-block">{t('inscription.allerConnexion')}</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-petrol-950 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="flex justify-end mb-4">
          <SelecteurLangue className="!bg-white/10 !border-white/10 !text-white text-xs py-1.5 w-auto" />
        </div>
        <div className="text-center mb-8">
          <div className="font-display font-bold text-2xl text-white tracking-tight">DistribPro</div>
          <div className="text-sm text-white/50 mt-1">{t('creerEntreprise.titre')}</div>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <div>
            <label className="label">{t('creerEntreprise.nomEntreprise')}</label>
            <input
              required
              value={nomEntreprise}
              onChange={(e) => setNomEntreprise(e.target.value)}
              className="input-field"
              placeholder={t('creerEntreprise.placeholderEntreprise')}
            />
          </div>
          <div>
            <label className="label">{t('creerEntreprise.votreNomComplet')}</label>
            <input
              required
              value={nomAdmin}
              onChange={(e) => setNomAdmin(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="label">{t('connexion.email')}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
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
            {chargement ? t('creerEntreprise.enCours') : t('creerEntreprise.creerMonEntreprise')}
          </button>
          <p className="text-xs text-center text-petrol-500">
            {t('creerEntreprise.inviteRejoindreEquipe')} <Link to="/inscription" className="underline">{t('creerEntreprise.cliquezIci')}</Link>
          </p>
          <p className="text-xs text-center text-petrol-500">
            {t('inscription.dejaCompte')} <Link to="/connexion" className="underline">{t('connexion.seConnecter')}</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
