import { useState, useEffect } from 'react'
import { Navigate, Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import SelecteurLangue from '../components/SelecteurLangue'
import ChampMotDePasse from '../components/ChampMotDePasse'
import illustrationParDefaut from '../assets/illustration-distribution.svg'

export default function Login() {
  const { t } = useTranslation()
  const { connexion, estConnecte } = useAuth()
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [erreur, setErreur] = useState('')
  const [chargement, setChargement] = useState(false)
  const [fondEcran, setFondEcran] = useState(illustrationParDefaut)
  const navigate = useNavigate()
  const [modeOubli, setModeOubli] = useState(false)
  const [emailOubli, setEmailOubli] = useState('')
  const [envoiOubli, setEnvoiOubli] = useState(false)
  const [messageOubli, setMessageOubli] = useState('')
  const [compteDesactive] = useState(() => {
    try {
      const v = sessionStorage.getItem('distribpro-compte-desactive') === '1'
      sessionStorage.removeItem('distribpro-compte-desactive')
      return v
    } catch { return false }
  })
  const [codeEnvoye, setCodeEnvoye] = useState(false)
  const [code, setCode] = useState('')
  const [nouveauMdp, setNouveauMdp] = useState('')
  const [confirmationMdp, setConfirmationMdp] = useState('')
  const [erreurCode, setErreurCode] = useState('')

  useEffect(() => {
    const { data } = supabase.storage.from('plateforme-publique').getPublicUrl('connexion-fond.jpg')
    if (data?.publicUrl) {
      const img = new Image()
      img.onload = () => setFondEcran(data.publicUrl)
      img.onerror = () => {} // garde l'illustration par défaut si rien n'a été téléversé
      img.src = data.publicUrl
    }
  }, [])

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

  async function envoyerLienReinitialisation(e) {
    e.preventDefault()
    setMessageOubli('')
    setEnvoiOubli(true)
    const { error } = await supabase.auth.resetPasswordForEmail(emailOubli, {
      redirectTo: `${window.location.origin}/reinitialiser-mot-de-passe`,
    })
    setEnvoiOubli(false)
    // Message identique en succès ou en erreur : on ne confirme jamais
    // si un compte existe ou non pour cette adresse, par sécurité.
    setMessageOubli(error ? t('connexion.oubli.erreur') : t('connexion.oubli.envoye'))
    if (!error) setCodeEnvoye(true)
  }

  // Réinitialisation par CODE reçu par email : insensible aux messageries qui
  // ouvrent automatiquement les liens (et les rendent inutilisables).
  async function validerCode(e) {
    e.preventDefault()
    setErreurCode('')
    if (nouveauMdp.length < 8) { setErreurCode(t('connexion.reinitialisation.erreurFaible')); return }
    if (nouveauMdp !== confirmationMdp) { setErreurCode(t('connexion.reinitialisation.erreurConfirmation')); return }
    setEnvoiOubli(true)
    const { error: erreurVerif } = await supabase.auth.verifyOtp({ email: emailOubli.trim(), token: code.trim(), type: 'recovery' })
    if (erreurVerif) {
      setEnvoiOubli(false)
      setErreurCode(t('connexion.oubli.codeInvalide'))
      return
    }
    const { error } = await supabase.auth.updateUser({ password: nouveauMdp })
    setEnvoiOubli(false)
    if (error) {
      const msg = error.message || ''
      if (error.code === 'same_password' || /different from the old/i.test(msg)) setErreurCode(t('connexion.reinitialisation.erreurIdentique'))
      else if (error.code === 'weak_password' || /weak|should contain|characters/i.test(msg)) setErreurCode(t('connexion.reinitialisation.erreurFaible'))
      else setErreurCode(`${t('connexion.reinitialisation.erreurAutre')} (${msg})`)
      return
    }
    navigate('/')
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-petrol-950">
      <img
        src={fondEcran}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-petrol-950/70 via-petrol-950/20 to-transparent md:from-petrol-950/60 md:via-petrol-950/10" />

      <div className="absolute top-4 right-4 z-10">
        <SelecteurLangue className="!bg-white/10 !border-white/10 !text-white text-xs py-1.5 w-auto backdrop-blur-sm" />
      </div>

      <div className="relative min-h-screen flex items-center justify-center md:justify-end px-4 md:px-16 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-6">
            <div className="font-display font-bold text-2xl text-white tracking-tight drop-shadow-sm">DistribPro</div>
            <div className="text-sm text-white/70 mt-1 drop-shadow-sm">{t('connexion.tagline')}</div>
          </div>

          {!modeOubli ? (
            <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
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
                <div className="flex items-center justify-between">
                  <label className="label mb-0">{t('connexion.motDePasse')}</label>
                  <button
                    type="button"
                    onClick={() => { setModeOubli(true); setEmailOubli(email); setMessageOubli('') }}
                    className="text-xs text-petrol-600 underline mb-1"
                  >
                    {t('connexion.motDePasseOublie')}
                  </button>
                </div>
                <ChampMotDePasse
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>

              {(erreur || compteDesactive) && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {erreur || t('connexion.compteDesactive')}
                </div>
              )}

              <button type="submit" disabled={chargement} className="btn-primary w-full">
                {chargement ? t('connexion.enCours') : t('connexion.seConnecter')}
              </button>
            </form>
          ) : (
            <form onSubmit={envoyerLienReinitialisation} className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
              <div>
                <h2 className="font-semibold text-petrol-900">{t('connexion.oubli.titre')}</h2>
                <p className="text-xs text-petrol-500 mt-1">{t('connexion.oubli.sousTitre')}</p>
              </div>
              <div>
                <label className="label">{t('connexion.email')}</label>
                <input
                  type="email"
                  required
                  value={emailOubli}
                  onChange={(e) => setEmailOubli(e.target.value)}
                  className="input-field"
                  placeholder="vous@entreprise.com"
                />
              </div>
              {messageOubli && (
                <div className="text-sm text-petrol-700 bg-canvas border border-line rounded-lg px-3 py-2">
                  {messageOubli}
                </div>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setModeOubli(false); setCodeEnvoye(false) }} className="btn-secondary flex-1">
                  {t('connexion.oubli.retour')}
                </button>
                <button type="submit" disabled={envoiOubli} className="btn-primary flex-1">
                  {envoiOubli ? t('connexion.enCours') : t('connexion.oubli.envoyer')}
                </button>
              </div>
              {!codeEnvoye && (
                <button type="button" className="text-xs underline text-petrol-600 w-full text-center" onClick={() => setCodeEnvoye(true)}>
                  {t('connexion.oubli.dejaCode')}
                </button>
              )}
            </form>
          )}
          {modeOubli && codeEnvoye && (
            <form onSubmit={validerCode} className="bg-white rounded-2xl shadow-xl p-6 space-y-3 mt-3">
              <div>
                <h2 className="font-semibold text-petrol-900">{t('connexion.oubli.titreCode')}</h2>
                <p className="text-xs text-petrol-500 mt-1">{t('connexion.oubli.aideCode')}</p>
              </div>
              <div>
                <label className="label">{t('connexion.oubli.code')}</label>
                <input inputMode="numeric" autoComplete="one-time-code" maxLength={10} required value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
                  className="input-field font-mono text-lg tracking-[0.4em] text-center" placeholder="••••••" />
              </div>
              <div>
                <label className="label">{t('connexion.reinitialisation.nouveauMdp')}</label>
                <ChampMotDePasse value={nouveauMdp} onChange={(e) => setNouveauMdp(e.target.value)} />
              </div>
              <div>
                <label className="label">{t('connexion.reinitialisation.confirmerMdp')}</label>
                <ChampMotDePasse value={confirmationMdp} onChange={(e) => setConfirmationMdp(e.target.value)} />
              </div>
              {erreurCode && <p className="text-xs text-red-600">{erreurCode}</p>}
              <button type="submit" disabled={envoiOubli || !emailOubli} className="btn-primary w-full">
                {envoiOubli ? t('connexion.enCours') : t('connexion.oubli.validerCode')}
              </button>
            </form>
          )}

          <p className="text-center text-xs text-white/70 mt-6 drop-shadow-sm">
            {t('connexion.inviteRejoindre')}{' '}
            <Link to="/inscription" className="underline text-white">{t('connexion.creerCompte')}</Link>
          </p>
          <p className="text-center text-xs text-white/70 mt-2 drop-shadow-sm">
            {t('connexion.nouvelleEntreprise')}{' '}
            <Link to="/creer-entreprise" className="underline text-white">{t('connexion.creerEspace')}</Link>
          </p>
          <p className="text-center text-[11px] text-white/60 mt-4 drop-shadow-sm space-x-3">
            <Link to="/legal/cgu" className="underline">{t('legal.cgu')}</Link>
            <Link to="/legal/confidentialite" className="underline">{t('legal.confidentialite')}</Link>
            <Link to="/legal/mentions" className="underline">{t('legal.mentions')}</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
