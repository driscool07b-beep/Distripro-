import { useState } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { traduireErreur } from '../lib/erreurs'
import SelecteurLangue from '../components/SelecteurLangue'
import ChampMotDePasse from '../components/ChampMotDePasse'
import ChoixLogo from '../components/ChoixLogo'
import { preparerLogo, televerserLogo, memoriserLogoEnAttente } from '../lib/logo'

export default function CreerEntreprise() {
  const { t } = useTranslation()
  const { inscription, estConnecte } = useAuth()
  const [nomEntreprise, setNomEntreprise] = useState('')
  const [nomAdmin, setNomAdmin] = useState('')
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [logo, setLogo] = useState(null) // logo préparé (facultatif)
  const [erreurLogo, setErreurLogo] = useState('')
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
      if (erreurCreation) {
        setChargement(false)
        setErreur(`${t('commun.erreur')} : ${traduireErreur(erreurCreation.message)}`)
        return
      }
      // Logo choisi : déposé tout de suite (un échec ne bloque pas l'inscription).
      if (logo) {
        const { data: p } = await supabase.from('profils').select('entreprise_id').eq('id', data.session.user.id).single()
        if (p?.entreprise_id) await televerserLogo(p.entreprise_id, logo)
      }
      setChargement(false)
      return
    }

    // Email à confirmer : le logo sera déposé à la première connexion.
    if (logo) memoriserLogoEnAttente(email.trim(), logo)
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
            <ChampMotDePasse
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">{t('inscription.confirmerMotDePasse')}</label>
            <ChampMotDePasse
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">{t('logo.facultatif')}</label>
            <ChoixLogo
              apercu={logo?.dataUrl}
              onChoisir={async (f) => { setErreurLogo(''); try { setLogo(await preparerLogo(f)) } catch { setErreurLogo(t('logo.formatInvalide')) } }}
              onRetirer={() => setLogo(null)}
            />
            <p className="text-[11px] text-petrol-500 mt-1">{t('logo.aideInscription')}</p>
            {erreurLogo && <p className="text-xs text-red-600 mt-1">{erreurLogo}</p>}
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
