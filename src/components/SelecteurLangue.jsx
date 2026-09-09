import { useTranslation } from 'react-i18next'
import { LANGUES } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

/**
 * Sélecteur de langue. Change la langue immédiatement (i18next persiste
 * déjà le choix dans localStorage via le detector), et si l'utilisateur
 * est connecté, sauvegarde aussi le choix sur son profil pour qu'il le
 * retrouve sur un autre appareil.
 */
export default function SelecteurLangue({ className = '' }) {
  const { i18n, t } = useTranslation()
  const { profil, rechargerProfil } = useAuth()

  async function changerLangue(code) {
    i18n.changeLanguage(code)
    if (profil?.id) {
      await supabase.from('profils').update({ langue: code }).eq('id', profil.id)
      rechargerProfil?.()
    }
  }

  return (
    <select
      className={`input-field ${className}`}
      value={i18n.language}
      onChange={(e) => changerLangue(e.target.value)}
      aria-label={t('langue.selectionner')}
    >
      {LANGUES.map((l) => (
        <option key={l.code} value={l.code}>{l.nom}</option>
      ))}
    </select>
  )
}
