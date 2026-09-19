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

  useEffect(() => {
    // Le lien reçu par email contient un jeton de récupération que le
    // client Supabase détecte automatiquement dans l'URL et transforme
    // en session temporaire — on attend juste que ce soit fait.
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setPret(true)
    })
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setPret(true)
    })
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
    const { error } = await supabase.auth.updateUser({ password: motDePasse })
    setEnvoi(false)
    if (error) {
      setErreur(t('connexion.reinitialisation.erreurGenerique'))
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

        {!pret ? (
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
