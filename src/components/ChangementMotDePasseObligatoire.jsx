import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function ChangementMotDePasseObligatoire() {
  const { t } = useTranslation('commun')
  const { rechargerProfil } = useAuth()
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [erreur, setErreur] = useState('')
  const [envoi, setEnvoi] = useState(false)

  async function valider(e) {
    e.preventDefault()
    setErreur('')
    if (motDePasse.length < 6) {
      setErreur(t('mdpObligatoire.erreurLongueur'))
      return
    }
    if (motDePasse !== confirmation) {
      setErreur(t('mdpObligatoire.erreurConfirmation'))
      return
    }
    setEnvoi(true)
    const { error: erreurMaj } = await supabase.auth.updateUser({ password: motDePasse })
    if (erreurMaj) {
      setEnvoi(false)
      setErreur(erreurMaj.message)
      return
    }
    await supabase.rpc('confirmer_changement_mot_de_passe')
    setEnvoi(false)
    await rechargerProfil?.()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas p-4">
      <div className="card p-6 w-full max-w-sm">
        <h1 className="text-lg font-bold mb-1">{t('mdpObligatoire.titre')}</h1>
        <p className="text-sm text-petrol-500 mb-4">{t('mdpObligatoire.sousTitre')}</p>
        <form onSubmit={valider} className="space-y-3">
          <div>
            <label className="label">{t('mdpObligatoire.nouveauMdp')}</label>
            <input
              type="password"
              className="input-field"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label">{t('mdpObligatoire.confirmerMdp')}</label>
            <input
              type="password"
              className="input-field"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </div>
          {erreur && <p className="text-xs text-red-600">{erreur}</p>}
          <button type="submit" disabled={envoi} className="btn-primary w-full">
            {envoi ? t('mdpObligatoire.enCours') : t('mdpObligatoire.valider')}
          </button>
        </form>
      </div>
    </div>
  )
}
