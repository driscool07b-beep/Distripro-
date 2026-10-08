import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import ConversationAssistant from './ConversationAssistant'

export const CLE_BULLE = 'distribpro-bulle-assistant'
export const bulleMasquee = () => { try { return localStorage.getItem(CLE_BULLE) === 'masquee' } catch { return false } }

// Position de la bulle (déplaçable du doigt ou à la souris), mémorisée sur l'appareil.
const CLE_POSITION = 'distribpro-bulle-position'
const TAILLE = 56
const MARGE = 8
const positionParDefaut = () => ({ droite: 16, bas: 20 })
function lirePosition() {
  try {
    const p = JSON.parse(localStorage.getItem(CLE_POSITION) || 'null')
    if (p && Number.isFinite(p.droite) && Number.isFinite(p.bas)) return p
  } catch { /* ignore */ }
  return positionParDefaut()
}
function borner(p) {
  const maxDroite = Math.max(MARGE, window.innerWidth - TAILLE - MARGE)
  const maxBas = Math.max(MARGE, window.innerHeight - TAILLE - MARGE)
  return { droite: Math.min(Math.max(p.droite, MARGE), maxDroite), bas: Math.min(Math.max(p.bas, MARGE), maxBas) }
}

// Bulle flottante de l'assistant, présente sur tous les écrans (désactivable
// dans « Apparence » ou depuis la bulle elle-même).
export default function BulleAssistant() {
  const { t } = useTranslation('assistant')
  const { profil } = useAuth()
  const { pathname } = useLocation()
  const [ouvert, setOuvert] = useState(false)
  const [masquee, setMasquee] = useState(bulleMasquee)
  const [position, setPosition] = useState(() => borner(lirePosition()))
  const glisse = useRef(null) // { x, y, droite, bas, deplace }

  // Écran tourné ou redimensionné : la bulle reste visible.
  useEffect(() => {
    const surRedim = () => setPosition((p) => borner(p))
    window.addEventListener('resize', surRedim)
    return () => window.removeEventListener('resize', surRedim)
  }, [])

  // Réglage modifié ailleurs (page Apparence).
  useEffect(() => {
    const maj = () => setMasquee(bulleMasquee())
    window.addEventListener('distribpro-bulle-changee', maj)
    return () => window.removeEventListener('distribpro-bulle-changee', maj)
  }, [])

  // Pas de bulle sur la page de l'assistant ni dans la messagerie (elle
  // recouvrirait les boutons Envoyer et micro).
  if (!profil || profil.ia_active === false || masquee || pathname === '/assistant' || pathname.startsWith('/messagerie')) return null

  function debutGlisse(e) {
    glisse.current = { x: e.clientX, y: e.clientY, droite: position.droite, bas: position.bas, deplace: false }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  function pendantGlisse(e) {
    const g = glisse.current
    if (!g) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (!g.deplace && Math.hypot(dx, dy) < 6) return // simple appui, pas un déplacement
    g.deplace = true
    setPosition(borner({ droite: g.droite - dx, bas: g.bas - dy }))
  }
  function finGlisse() {
    const g = glisse.current
    glisse.current = null
    if (!g) return
    if (g.deplace) {
      setPosition((p) => {
        // Collée au bord le plus proche, comme sur un téléphone.
        const centre = window.innerWidth - p.droite - TAILLE / 2
        const finale = borner({ ...p, droite: centre < window.innerWidth / 2 ? window.innerWidth - TAILLE - MARGE * 2 : MARGE * 2 })
        try { localStorage.setItem(CLE_POSITION, JSON.stringify(finale)) } catch { /* ignore */ }
        return finale
      })
    } else {
      setOuvert((o) => !o)
    }
  }

  function masquer() {
    try { localStorage.setItem(CLE_BULLE, 'masquee') } catch { /* ignore */ }
    setOuvert(false)
    setMasquee(true)
    window.dispatchEvent(new Event('distribpro-bulle-changee'))
  }

  return (
    <div className="no-print">
      {ouvert && (
        <div className="fixed z-40 bottom-3 right-3 sm:right-5 w-[calc(100vw-1.5rem)] sm:w-[400px] h-[min(85vh,680px)] card bg-canvas shadow-2xl flex flex-col overflow-hidden">
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
      {/* Panneau ouvert : il a son propre bouton ✕ ; la bulle s'efface pour ne rien recouvrir. */}
      {!ouvert && <button
        onPointerDown={debutGlisse}
        onPointerMove={pendantGlisse}
        onPointerUp={finGlisse}
        onPointerCancel={() => { glisse.current = null }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOuvert((o) => !o) } }}
        aria-label={t('bulle.ouvrir')}
        title={t('bulle.deplacer')}
        style={{ right: position.droite, bottom: position.bas, touchAction: 'none' }}
        className="fixed z-40 w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-2xl select-none cursor-grab active:cursor-grabbing bg-amber-500 text-petrol-950"
      >
        ✨
      </button>}
    </div>
  )
}
