import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import ChampMotDePasse from '../components/ChampMotDePasse'

export default function ReinitialiserMotDePasse() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [pret, setPret] = useState(false)
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [erreur, setErreur] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [succes, setSucces] = useState(false)
  const [lienInvalide, setLienInvalide] = useState(false)

  useEffect(() => {
    // Le lien reçu par email contient un jeton de récupération que le
    // client Supabase détecte automatiquement dans l'URL et transforme
    // en session temporaire — on attend juste que ce soit fait.
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setPret(true)
    })
    const params = new URLSearchParams(window.location.search)
    const erreurLien = params.get('error_description') || new URLSearchParams(window.location.hash.slice(1)).get('error_description')
    ;(async () => {
      if (erreurLien) { setLienInvalide(true); return }
      // Lien au format « token_hash » (modèle d'email Supabase conseillé) :
      // fonctionne même si le lien s'ouvre dans un autre navigateur.
      // Lien « token_hash » : on ne le consomme qu'à la validation du
      // formulaire (une messagerie qui ouvre le lien ne l'use donc pas).
      if (params.get('token_hash')) { setPret(true); return }
      const { data } = await supabase.auth.getSession()
      if (data.session) { setPret(true); return }
      // Laisse au client le temps de lire le jeton de l'URL, sinon lien invalide.
      setTimeout(async () => {
        const { data: d2 } = await supabase.auth.getSession()
        if (d2.session) setPret(true)
        else setLienInvalide(true)
      }, 6000)
    })()
    return () => subscription.subscription.unsubscribe()
  }, [])

  async function valider(e) {
    e.preventDefault()
    setErreur('')
    if (motDePasse.length < 6) {
      setErreur(t('connexion.reinitialisation.erreurLongueur'))
      return
    }
    if (motDePasse !== confirmation) {
      setErreur(t('connexion.reinitialisation.erreurConfirmation'))
      return
    }
    setEnvoi(true)
    const tokenHash = new URLSearchParams(window.location.search).get('token_hash')
    if (tokenHash) {
      const { error: erreurVerif } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
      if (erreurVerif) { setEnvoi(false); setLienInvalide(true); return }
    }
    const { error } = await supabase.auth.updateUser({ password: motDePasse })
    setEnvoi(false)
    if (error) {
      // Message précis selon la vraie raison du refus.
      const code = error.code || ''
      const msg = error.message || ''
      if (code === 'same_password' || /different from the old/i.test(msg)) setErreur(t('connexion.reinitialisation.erreurIdentique'))
      else if (code === 'weak_password' || /password.*(weak|should contain|at least|characters)/i.test(msg)) setErreur(t('connexion.reinitialisation.erreurFaible', { detail: msg }))
      else if (/session|jwt|expired|not authenticated|Auth session missing/i.test(msg)) setErreur(t('connexion.reinitialisation.erreurGenerique'))
      else setErreur(`${t('connexion.reinitialisation.erreurAutre')} (${msg})`)
      return
    }
    setSucces(true)
    setTimeout(() => navigate('/'), 2000)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-petrol-950 p-4">
      <div className="card bg-white p-6 w-full max-w-sm">
        <div className="font-display font-bold text-xl mb-1">DistribPro</div>
        <h1 className="text-lg font-semibold mb-1">{t('connexion.reinitialisation.titre')}</h1>

        {lienInvalide ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-red-600">{t('connexion.reinitialisation.erreurGenerique')}</p>
            <p className="text-xs text-petrol-500">{t('connexion.reinitialisation.conseilNavigateur')}</p>
            <button className="btn-secondary w-full text-sm" onClick={() => navigate('/connexion')}>{t('connexion.reinitialisation.retourConnexion')}</button>
          </div>
        ) : !pret ? (
          <p className="text-sm text-petrol-500 mt-3">{t('connexion.reinitialisation.chargement')}</p>
        ) : succes ? (
          <p className="text-sm text-green-600 mt-3">{t('connexion.reinitialisation.succes')}</p>
        ) : (
          <>
            <p className="text-sm text-petrol-500 mb-4">{t('connexion.reinitialisation.sousTitre')}</p>
            <form onSubmit={valider} className="space-y-3">
              <div>
                <label className="label">{t('connexion.reinitialisation.nouveauMdp')}</label>
                <ChampMotDePasse value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="label">{t('connexion.reinitialisation.confirmerMdp')}</label>
                <ChampMotDePasse value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
              </div>
              {erreur && <p className="text-xs text-red-600">{erreur}</p>}
              <button type="submit" disabled={envoi} className="btn-primary w-full">
                {envoi ? t('connexion.reinitialisation.enCours') : t('connexion.reinitialisation.valider')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
