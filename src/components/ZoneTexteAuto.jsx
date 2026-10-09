import { useLayoutEffect, useRef } from 'react'

// Zone de saisie qui s'agrandit vers le bas avec le texte (jusqu'à
// `maxLignes`, puis défilement vertical) : on relit tout sans défiler de
// gauche à droite. Entrée envoie sur ordinateur ; sur téléphone, Entrée
// passe à la ligne et on envoie avec le bouton (comme WhatsApp).
const ecranTactile = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

export default function ZoneTexteAuto({ value, onChange, onEnvoyer, maxLignes = 6, className = '', ...props }) {
  const ref = useRef(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const style = window.getComputedStyle(el)
    const ligne = parseFloat(style.lineHeight) || 20
    const marges = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
    const max = ligne * maxLignes + marges
    el.style.height = `${Math.min(el.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth), max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [value, maxLignes])

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={onChange}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !ecranTactile() && onEnvoyer) {
          e.preventDefault()
          onEnvoyer()
        }
      }}
      className={`resize-none leading-5 ${className}`}
      {...props}
    />
  )
}
