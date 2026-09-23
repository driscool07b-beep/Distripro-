import { useState, useCallback, useRef } from 'react'

// Rend les colonnes d'un tableau redimensionnables (glisser le bord
// droit d'un en-tête pour l'élargir/rétrécir). Souris ET tactile
// (mobile). Les largeurs choisies sont mémorisées dans le
// navigateur (localStorage) par clé de tableau, pour que
// l'utilisateur n'ait pas à les réajuster à chaque visite.
//
// Usage :
//   const { largeurs, PoigneeRedim, largeurTotale } = useColonnesRedimensionnables('grandLivreCaisse', [
//     { cle: 'date', titre: 'Date', largeur: 110 },
//     { cle: 'debit', titre: 'Débit', largeur: 130 },
//   ])
//   <table style={{ tableLayout: 'fixed', width: largeurTotale }}>
//     <colgroup>{colonnes.map(c => <col key={c.cle} style={{ width: largeurs[c.cle] }} />)}</colgroup>
//     <thead><tr>
//       <th className="relative">{c.titre}<PoigneeRedim cle={c.cle} /></th>
//     </tr></thead>
//   </table>

const LARGEUR_MIN = 50

export function useColonnesRedimensionnables(cleStockage, colonnesInitiales) {
  const [largeurs, setLargeurs] = useState(() => {
    const defaut = Object.fromEntries(colonnesInitiales.map((c) => [c.cle, c.largeur]))
    try {
      const sauvegarde = localStorage.getItem(`tableau-largeurs:${cleStockage}`)
      if (sauvegarde) {
        const parsed = JSON.parse(sauvegarde)
        return { ...defaut, ...parsed }
      }
    } catch {
      // localStorage indisponible ou corrompu — on garde les valeurs par défaut
    }
    return defaut
  })

  const dragRef = useRef(null)

  const sauvegarder = useCallback((nouvellesLargeurs) => {
    try {
      localStorage.setItem(`tableau-largeurs:${cleStockage}`, JSON.stringify(nouvellesLargeurs))
    } catch {
      // pas grave si ça échoue, juste pas de mémorisation
    }
  }, [cleStockage])

  const demarrer = useCallback((cle, clientX) => {
    dragRef.current = { cle, startX: clientX, startLargeur: largeurs[cle] }
  }, [largeurs])

  const deplacer = useCallback((clientX) => {
    if (!dragRef.current) return
    const { cle, startX, startLargeur } = dragRef.current
    const nouvelle = Math.max(LARGEUR_MIN, startLargeur + (clientX - startX))
    setLargeurs((prev) => ({ ...prev, [cle]: nouvelle }))
  }, [])

  const terminer = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    setLargeurs((prev) => {
      sauvegarder(prev)
      return prev
    })
  }, [sauvegarder])

  function PoigneeRedim({ cle, className = '' }) {
    return (
      <span
        onMouseDown={(e) => {
          e.preventDefault()
          demarrer(cle, e.clientX)
          const onMove = (ev) => deplacer(ev.clientX)
          const onUp = () => {
            terminer()
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
        }}
        onTouchStart={(e) => {
          const touch = e.touches[0]
          demarrer(cle, touch.clientX)
          const onMove = (ev) => deplacer(ev.touches[0].clientX)
          const onEnd = () => {
            terminer()
            window.removeEventListener('touchmove', onMove)
            window.removeEventListener('touchend', onEnd)
          }
          window.addEventListener('touchmove', onMove, { passive: true })
          window.addEventListener('touchend', onEnd)
        }}
        className={`absolute top-0 right-0 h-full w-3 cursor-col-resize select-none touch-none group ${className}`}
      >
        <span className="block h-full w-px bg-line group-hover:w-0.5 group-hover:bg-petrol-500 mx-auto transition-all" />
      </span>
    )
  }

  const largeurTotale = colonnesInitiales.reduce((s, c) => s + (largeurs[c.cle] ?? c.largeur), 0)

  return { largeurs, PoigneeRedim, largeurTotale }
}
