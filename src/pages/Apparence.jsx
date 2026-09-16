import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { appliquerApparence, TAILLES_POLICE } from '../lib/apparence'
import { pushSupporte, estAbonne, activerNotifications, desactiverNotifications } from '../lib/push'

const APERCU_THEMES = {
  petrol: { fond: '#123640', accent: '#d69428' },
  ocean: { fond: '#0f3457', accent: '#d69428' },
  forest: { fond: '#1a3a29', accent: '#d69428' },
  sunset: { fond: '#452012', accent: '#d69428' },
  contraste: { fond: '#000000', accent: '#d69428' },
}

export default function Apparence() {
  const { t } = useTranslation('apparence')
  const { profil, rechargerProfil } = useAuth()
  const [theme, setTheme] = useState(profil?.theme || 'petrol')
  const [taillePolice, setTaillePolice] = useState(profil?.taille_police || 'normal')
  const [enregistrement, setEnregistrement] = useState(false)
  const [confirmation, setConfirmation] = useState(false)
  const [abonnePush, setAbonnePush] = useState(null)
  const [enCoursPush, setEnCoursPush] = useState(false)
  const [erreurPush, setErreurPush] = useState('')

  useEffect(() => {
    if (pushSupporte()) {
      estAbonne().then(setAbonnePush)
    } else {
      setAbonnePush(false)
    }
  }, [])

  async function basculerPush() {
    setErreurPush('')
    setEnCoursPush(true)
    try {
      if (abonnePush) {
        await desactiverNotifications()
        setAbonnePush(false)
      } else {
        await activerNotifications()
        setAbonnePush(true)
      }
    } catch (err) {
      if (err.message === 'denied') setErreurPush(t('notifications.erreurRefuse'))
      else if (err.message === 'unsupported') setErreurPush(t('notifications.erreurNonSupporte'))
      else setErreurPush(t('notifications.erreurGenerique'))
    }
    setEnCoursPush(false)
  }

  function previsualiser(nouveauTheme, nouvelleTaille) {
    appliquerApparence(nouveauTheme, nouvelleTaille)
  }

  function choisirTheme(valeur) {
    setTheme(valeur)
    previsualiser(valeur, taillePolice)
  }

  function choisirTaille(valeur) {
    setTaillePolice(valeur)
    previsualiser(theme, valeur)
  }

  async function enregistrer() {
    setEnregistrement(true)
    const { error } = await supabase.rpc('modifier_apparence', { p_theme: theme, p_taille_police: taillePolice })
    setEnregistrement(false)
    if (!error) {
      await rechargerProfil?.()
      setConfirmation(true)
      setTimeout(() => setConfirmation(false), 2500)
    }
  }

  return (
    <div className="p-4 max-w-xl mx-auto">
      <h1 className="text-xl font-bold mb-1">{t('titre')}</h1>
      <p className="text-sm text-petrol-500 mb-6">{t('sousTitre')}</p>

      <div className="card p-4 mb-4">
        <h2 className="font-semibold mb-1">{t('couleurs.titre')}</h2>
        <p className="text-xs text-petrol-500 mb-3">{t('couleurs.sousTitre')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(APERCU_THEMES).map(([code, couleurs]) => (
            <button
              key={code}
              onClick={() => choisirTheme(code)}
              className={`rounded-lg border-2 p-3 text-left transition-colors ${
                theme === code ? 'border-amber-500' : 'border-line'
              }`}
            >
              <div className="flex gap-1.5 mb-2">
                <span className="w-6 h-6 rounded-full" style={{ backgroundColor: couleurs.fond }} />
                <span className="w-6 h-6 rounded-full" style={{ backgroundColor: couleurs.accent }} />
              </div>
              <p className="text-xs font-medium">{t(`couleurs.${code}`)}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="card p-4 mb-4">
        <h2 className="font-semibold mb-1">{t('taillePolice.titre')}</h2>
        <p className="text-xs text-petrol-500 mb-3">{t('taillePolice.sousTitre')}</p>
        <div className="flex gap-2">
          {Object.keys(TAILLES_POLICE).map((valeur) => (
            <button
              key={valeur}
              onClick={() => choisirTaille(valeur)}
              className={`flex-1 border-2 rounded-lg px-3 py-3 text-center transition-colors ${
                taillePolice === valeur ? 'border-amber-500 bg-amber-50' : 'border-line'
              }`}
            >
              <span
                className="block font-medium"
                style={{ fontSize: `${TAILLES_POLICE[valeur] * 0.95}rem` }}
              >
                Aa
              </span>
              <span className="text-xs text-petrol-500 mt-1 block">{t(`taillePolice.${valeur}`)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card p-4 mb-4">
        <h2 className="font-semibold mb-1">{t('notifications.titre')}</h2>
        <p className="text-xs text-petrol-500 mb-3">{t('notifications.sousTitre')}</p>
        {abonnePush === null ? (
          <p className="text-sm text-petrol-400">{t('notifications.verification')}</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-sm">{t('notifications.recevoir')}</p>
                <p className="text-xs text-petrol-500">
                  {abonnePush ? t('notifications.actives') : t('notifications.inactives')}
                </p>
              </div>
              <button
                type="button"
                onClick={basculerPush}
                disabled={enCoursPush}
                className={`shrink-0 w-12 h-7 rounded-full transition-colors relative disabled:opacity-50 ${
                  abonnePush ? 'bg-amber-500' : 'bg-line'
                }`}
              >
                <span
                  className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${
                    abonnePush ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            {erreurPush && <p className="text-xs text-red-600 mt-2">{erreurPush}</p>}
          </>
        )}
      </div>

      <button onClick={enregistrer} disabled={enregistrement} className="btn-primary w-full">
        {enregistrement ? t('enregistrement') : t('enregistrer')}
      </button>
      {confirmation && <p className="text-sm text-green-600 mt-2 text-center">{t('enregistre')}</p>}
    </div>
  )
}
