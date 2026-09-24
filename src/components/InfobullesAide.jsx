import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Bulles d'aide : expliquent le rôle d'un bouton.
// - Ordinateur : au survol, après un court délai.
// - Téléphone : par appui long (le survol n'existe pas au doigt) ; l'appui
//   long n'exécute PAS l'action du bouton, seul un appui normal le fait.
// Les boutons portent un attribut data-aide="namespace.cle" ; le texte est
// cherché dans locales/<langue>/infobulles.json (d'abord la clé exacte, puis
// une explication générique pour les boutons communs : Excel, PDF…).
// Désactivables par chaque utilisateur (page Apparence), réglage mémorisé
// sur l'appareil.

const CLE_STOCKAGE = 'distribpro_infobulles'

export function infobullesActives() {
  try {
    return localStorage.getItem(CLE_STOCKAGE) !== 'off'
  } catch {
    return true
  }
}

export function definirInfobulles(actives) {
  try {
    localStorage.setItem(CLE_STOCKAGE, actives ? 'on' : 'off')
  } catch { /* stockage indisponible : réglage non mémorisé */ }
  window.dispatchEvent(new Event('infobulles-change'))
}

export default function InfobullesAide() {
  const { t, i18n } = useTranslation('infobulles')
  const [actives, setActives] = useState(infobullesActives())
  const [bulle, setBulle] = useState(null)

  useEffect(() => {
    const maj = () => setActives(infobullesActives())
    window.addEventListener('infobulles-change', maj)
    return () => window.removeEventListener('infobulles-change', maj)
  }, [])

  useEffect(() => {
    if (!actives) {
      setBulle(null)
      return
    }
    let minuterie = null
    let fermeture = null
    let cibleSurvol = null
    let bloquerProchainClic = false

    const texteDe = (el) => {
      const cle = el.getAttribute('data-aide')
      if (!cle) return null
      const morceaux = cle.split('.')
      const derniere = morceaux[morceaux.length - 1]
      for (const c of [cle, `commun.${derniere}`]) {
        if (i18n.exists(c, { ns: 'infobulles' })) return t(c)
      }
      return null
    }

    const afficher = (el) => {
      const texte = texteDe(el)
      if (!texte) return false
      const r = el.getBoundingClientRect()
      setBulle({ texte, x: r.left + r.width / 2, haut: r.top, bas: r.bottom })
      return true
    }

    const masquer = () => {
      clearTimeout(minuterie)
      setBulle(null)
    }

    const survol = (e) => {
      if (e.pointerType !== 'mouse') return
      const el = e.target.closest?.('[data-aide]')
      if (el === cibleSurvol) return
      cibleSurvol = el
      masquer()
      if (el) minuterie = setTimeout(() => afficher(el), 450)
    }

    const appui = (e) => {
      if (e.pointerType === 'mouse') return
      const el = e.target.closest?.('[data-aide]')
      clearTimeout(minuterie)
      if (!el) return
      minuterie = setTimeout(() => {
        if (afficher(el)) {
          bloquerProchainClic = true
          clearTimeout(fermeture)
          fermeture = setTimeout(() => setBulle(null), 3500)
        }
      }, 550)
    }

    const finAppui = () => clearTimeout(minuterie)

    const clic = (e) => {
      if (bloquerProchainClic) {
        e.preventDefault()
        e.stopPropagation()
        bloquerProchainClic = false
      }
    }

    document.addEventListener('pointerover', survol)
    document.addEventListener('pointerdown', appui)
    document.addEventListener('pointerup', finAppui)
    document.addEventListener('pointercancel', finAppui)
    document.addEventListener('click', clic, true)
    window.addEventListener('scroll', masquer, true)
    return () => {
      clearTimeout(minuterie)
      clearTimeout(fermeture)
      document.removeEventListener('pointerover', survol)
      document.removeEventListener('pointerdown', appui)
      document.removeEventListener('pointerup', finAppui)
      document.removeEventListener('pointercancel', finAppui)
      document.removeEventListener('click', clic, true)
      window.removeEventListener('scroll', masquer, true)
    }
  }, [actives, t, i18n])

  if (!bulle) return null

  const largeur = Math.min(260, window.innerWidth - 24)
  const gauche = Math.min(Math.max(bulle.x, largeur / 2 + 12), window.innerWidth - largeur / 2 - 12)
  const auDessus = bulle.haut > 90
  const style = {
    left: gauche,
    width: 'max-content',
    maxWidth: largeur,
    ...(auDessus ? { top: bulle.haut - 10, transform: 'translate(-50%, -100%)' } : { top: bulle.bas + 10, transform: 'translateX(-50%)' }),
  }

  return (
    <div role="tooltip" className="infobulle" style={style}>
      <span className="infobulle-icone">💡</span>
      {bulle.texte}
    </div>
  )
}
