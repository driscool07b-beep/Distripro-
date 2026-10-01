import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import ConversationAssistant from './ConversationAssistant'

export const CLE_BULLE = 'distribpro-bulle-assistant'
export const bulleMasquee = () => { try { return localStorage.getItem(CLE_BULLE) === 'masquee' } catch { return false } }

// Bulle flottante de l'assistant, présente sur tous les écrans (désactivable
// dans « Apparence » ou depuis la bulle elle-même).
export default function BulleAssistant() {
  const { t } = useTranslation('assistant')
  const { profil } = useAuth()
  const { pathname } = useLocation()
  const [ouvert, setOuvert] = useState(false)
  const [masquee, setMasquee] = useState(bulleMasquee)

  // Réglage modifié ailleurs (page Apparence).
  useEffect(() => {
    const maj = () => setMasquee(bulleMasquee())
    window.addEventListener('distribpro-bulle-changee', maj)
    return () => window.removeEventListener('distribpro-bulle-changee', maj)
  }, [])

  if (!profil || profil.ia_active === false || masquee || pathname === '/assistant') return null

  function masquer() {
    try { localStorage.setItem(CLE_BULLE, 'masquee') } catch { /* ignore */ }
    setOuvert(false)
    setMasquee(true)
    window.dispatchEvent(new Event('distribpro-bulle-changee'))
  }

  return (
    <div className="no-print">
      {ouvert && (
        <div className="fixed z-40 bottom-24 right-3 sm:right-5 w-[calc(100vw-1.5rem)] sm:w-[400px] h-[min(75vh,620px)] card bg-canvas shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-petrol-900 text-white">
            <span className="text-lg">✨</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight">{t('bulle.titre')}</p>
              <p className="text-[10px] text-white/60 leading-tight">{t('bulle.sousTitre')}</p>
            </div>
            <button onClick={masquer} title={t('bulle.masquer')} className="text-[10px] text-white/60 hover:text-white underline px-1">{t('bulle.masquer')}</button>
            <button data-fermer onClick={() => setOuvert(false)} className="text-white/80 hover:text-white text-lg px-1" aria-label={t('bulle.fermer')}>✕</button>
          </div>
          <div className="flex-1 min-h-0">
            <ConversationAssistant compact onNavigation={() => setOuvert(false)} />
          </div>
        </div>
      )}
      <button
        onClick={() => setOuvert((o) => !o)}
        aria-label={t('bulle.ouvrir')}
        title={t('bulle.ouvrir')}
        className={`fixed z-40 bottom-5 right-4 sm:right-5 w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-2xl transition-transform hover:scale-105 ${ouvert ? 'bg-petrol-800 text-white' : 'bg-amber-500 text-petrol-950'}`}
      >
        {ouvert ? '✕' : '✨'}
      </button>
    </div>
  )
}
