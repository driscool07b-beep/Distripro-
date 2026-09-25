import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

// Libellés des boutons qui ferment un formulaire, dans les 4 langues.
const LIBELLES_FERMETURE = ['annuler', 'cancel', 'fermer', 'close', 'إلغاء', 'إغلاق', '取消', '关闭', '×', '✕', '✖']

function estVisible(el) {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

// Formulaire ouvert au premier plan : dernière fenêtre superposée visible.
function fenetreAuPremierPlan() {
  const fenetres = Array.from(document.querySelectorAll('.fixed.inset-0')).filter(estVisible)
  return fenetres[fenetres.length - 1] || null
}

function boutonFermeture(conteneur) {
  const boutons = Array.from(conteneur.querySelectorAll('button')).filter(estVisible)
  return boutons.find((b) => b.dataset.fermer !== undefined)
    || boutons.find((b) => LIBELLES_FERMETURE.includes((b.textContent || '').trim().toLowerCase()))
    || boutons.find((b) => LIBELLES_FERMETURE.includes((b.getAttribute('aria-label') || '').trim().toLowerCase()))
}

function enSaisie(e) {
  const el = e.target
  return el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

export function allerEnArriere(navigate) {
  if ((window.history.state?.idx ?? 0) > 0) navigate(-1)
  else navigate('/')
}

// Bouton « Retour » affiché en haut de chaque page (sauf le tableau de bord).
export function BoutonRetour() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  if (location.pathname === '/') return null
  return (
    <div className="no-print px-4 sm:px-6 lg:px-8 pt-3 max-w-7xl mx-auto">
      <button
        type="button"
        data-aide="commun.retour"
        onClick={() => allerEnArriere(navigate)}
        className="inline-flex items-center gap-1.5 text-sm text-petrol-600 hover:text-petrol-900 hover:bg-white rounded-lg px-2 py-1 -ms-2"
      >
        <span aria-hidden="true" className="rtl:rotate-180">←</span> {t('navigation.retour')}
      </button>
    </div>
  )
}

// Raccourcis clavier globaux + aide (touche « ? »).
export default function NavigationClavier() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [aideVisible, setAideVisible] = useState(false)

  useEffect(() => {
    const surTouche = (e) => {
      // Échap : ferme l'aide, sinon le formulaire au premier plan (= Annuler).
      if (e.key === 'Escape') {
        if (aideVisible) { setAideVisible(false); return }
        const fenetre = fenetreAuPremierPlan()
        const bouton = fenetre && boutonFermeture(fenetre)
        if (bouton) { e.preventDefault(); bouton.click() }
        return
      }
      // Ctrl+K (ou Cmd+K) : aller au champ de recherche de la page.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        const champ = Array.from(document.querySelectorAll('main input[type="text"], main input[type="search"], main input:not([type])'))
          .find((i) => estVisible(i) && /recherch|search|بحث|搜索/i.test(i.placeholder || ''))
        if (champ) { e.preventDefault(); champ.focus(); champ.select?.() }
        return
      }
      if (enSaisie(e)) return
      // Alt+N : action principale « + Nouveau… » de la page.
      if (e.altKey && e.key.toLowerCase() === 'n') {
        const bouton = Array.from(document.querySelectorAll('main button'))
          .find((b) => estVisible(b) && !b.disabled && (b.textContent || '').trim().startsWith('+'))
        if (bouton) { e.preventDefault(); bouton.click() }
        return
      }
      // Alt+R : retour à la page précédente.
      if (e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); allerEnArriere(navigate); return }
      // Alt+H : tableau de bord.
      if (e.altKey && e.key.toLowerCase() === 'h') { e.preventDefault(); navigate('/'); return }
      // ? : liste des raccourcis.
      if (e.key === '?') { e.preventDefault(); setAideVisible((v) => !v) }
    }
    window.addEventListener('keydown', surTouche)
    return () => window.removeEventListener('keydown', surTouche)
  }, [aideVisible, navigate])

  if (!aideVisible) return null
  const raccourcis = [
    ['Échap', t('raccourcis.echap')],
    ['Ctrl + K', t('raccourcis.recherche')],
    ['Alt + N', t('raccourcis.nouveau')],
    ['Alt + R', t('raccourcis.retour')],
    ['Alt + H', t('raccourcis.accueil')],
    ['?', t('raccourcis.aide')],
  ]
  return (
    <div className="fixed inset-0 z-[95] bg-black/40 flex items-center justify-center p-4" onClick={() => setAideVisible(false)}>
      <div className="card p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold mb-3">⌨️ {t('raccourcis.titre')}</h2>
        <ul className="space-y-2 text-sm">
          {raccourcis.map(([touche, texte]) => (
            <li key={touche} className="flex justify-between gap-3">
              <kbd className="font-mono text-xs bg-canvas border border-line rounded px-2 py-0.5 shrink-0">{touche}</kbd>
              <span className="text-petrol-700 text-end">{texte}</span>
            </li>
          ))}
        </ul>
        <button type="button" data-fermer className="btn-secondary w-full mt-4 text-sm" onClick={() => setAideVisible(false)}>{t('raccourcis.fermer')}</button>
      </div>
    </div>
  )
}
