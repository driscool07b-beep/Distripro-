import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listerActionsEnAttente, ecouterFileAttente, synchroniser, retirerActionManuellement } from '../lib/offline'

export default function BandeauHorsLigne() {
  const { t } = useTranslation('commun')
  const [enLigne, setEnLigne] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [actions, setActions] = useState([])
  const [ouvert, setOuvert] = useState(false)

  useEffect(() => {
    function majActions() {
      listerActionsEnAttente().then(setActions)
    }
    majActions()
    const retirer = ecouterFileAttente(majActions)

    function passerEnLigne() {
      setEnLigne(true)
      synchroniser()
    }
    function passerHorsLigne() {
      setEnLigne(false)
    }
    window.addEventListener('online', passerEnLigne)
    window.addEventListener('offline', passerHorsLigne)
    return () => {
      retirer()
      window.removeEventListener('online', passerEnLigne)
      window.removeEventListener('offline', passerHorsLigne)
    }
  }, [])

  const enAttente = actions.filter((a) => a.statut === 'en_attente').length
  const echouees = actions.filter((a) => a.statut === 'echoue').length

  if (enLigne && actions.length === 0) return null

  return (
    <div className="relative z-40">
      <button
        onClick={() => setOuvert((o) => !o)}
        className={`w-full text-xs font-medium px-3 py-1.5 flex items-center justify-center gap-2 ${
          !enLigne ? 'bg-amber-500 text-petrol-950' : echouees > 0 ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700'
        }`}
      >
        {!enLigne ? (
          <span>{t('horsLigne.horsLigne')}{actions.length > 0 ? ` — ${t('horsLigne.enAttente', { n: actions.length })}` : ''}</span>
        ) : (
          <span>{t('horsLigne.synchronisation', { n: actions.length })}</span>
        )}
      </button>

      {ouvert && actions.length > 0 && (
        <div className="absolute top-full left-0 right-0 bg-white border-b border-line shadow-lg max-h-64 overflow-y-auto">
          {actions.map((a) => (
            <div key={a.id} className="flex items-center justify-between px-3 py-2 text-xs border-b border-line last:border-0">
              <div className="min-w-0">
                <p className="truncate">{a.resume || a.type}</p>
                <p className={a.statut === 'echoue' ? 'text-red-600' : 'text-petrol-400'}>
                  {a.statut === 'echoue' ? t('horsLigne.echec', { message: a.erreur }) : t('horsLigne.attenteSynchro')}
                </p>
              </div>
              {a.statut === 'echoue' && (
                <button
                  onClick={() => retirerActionManuellement(a.id)}
                  className="text-red-600 underline shrink-0 ml-2"
                >
                  {t('horsLigne.supprimer')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
