import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Nouvelle version de l'application : bandeau « Mettre à jour ».
// On ne recharge pas automatiquement la page, pour ne jamais faire perdre
// une saisie en cours (vente, ajustement…) : l'utilisateur choisit le moment.
export default function MiseAJour() {
  const { t } = useTranslation('commun')
  const [disponible, setDisponible] = useState(false)

  useEffect(() => {
    const signaler = () => setDisponible(true)
    window.addEventListener('distribpro-maj-disponible', signaler)
    if (window.__distribproMajDisponible) setDisponible(true)
    return () => window.removeEventListener('distribpro-maj-disponible', signaler)
  }, [])

  if (!disponible) return null
  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:end-4 z-[90] sm:max-w-sm rounded-2xl bg-petrol-900 text-white shadow-2xl p-4 flex items-center gap-3">
      <span className="text-2xl">✨</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{t('miseAJour.titre')}</p>
        <p className="text-xs text-white/70">{t('miseAJour.texte')}</p>
      </div>
      <button onClick={() => (window.__distribproMettreAJour ? window.__distribproMettreAJour() : window.location.reload())} className="shrink-0 bg-amber-500 hover:bg-amber-400 text-petrol-950 font-semibold text-sm px-3 py-2 rounded-xl">
        {t('miseAJour.bouton')}
      </button>
    </div>
  )
}
