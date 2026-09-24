import { useEffect } from 'react'

// Sur petit écran, les tableaux s'affichent en fiches empilées (une fiche par
// ligne) au lieu d'être coupés à droite. Ce composant, monté une fois dans le
// Layout, recopie le titre de chaque colonne sur ses cellules (data-label) ;
// le CSS (index.css) fait le reste. Aucune page n'a besoin d'être modifiée.
// Exclus : les tableaux à colonnes redimensionnables (grands livres) et ceux
// marqués data-tableau-classique.

function preparer(racine) {
  racine.querySelectorAll('table').forEach((table) => {
    if (table.dataset.tableauClassique !== undefined || table.style.tableLayout === 'fixed') return
    const titres = []
    table.querySelectorAll('thead tr:first-child > th').forEach((th) => {
      const n = th.colSpan || 1
      for (let i = 0; i < n; i++) titres.push(th.textContent.trim())
    })
    if (titres.length === 0) return
    table.classList.add('tableau-responsif')
    table.querySelectorAll('tbody > tr').forEach((tr) => {
      let index = 0
      Array.from(tr.children).forEach((td) => {
        const n = td.colSpan || 1
        if (n > 1) td.setAttribute('data-pleine', '')
        else td.removeAttribute('data-pleine')
        const titre = titres[index] || ''
        if (td.getAttribute('data-label') !== titre) td.setAttribute('data-label', titre)
        index += n
      })
    })
  })
}

export default function TableauxResponsifs() {
  useEffect(() => {
    const racine = document.querySelector('main')
    if (!racine) return
    let enAttente = false
    const planifier = () => {
      if (enAttente) return
      enAttente = true
      requestAnimationFrame(() => {
        enAttente = false
        preparer(document.body)
      })
    }
    preparer(document.body)
    // Les modales sont parfois rendues hors de <main> : on observe tout le body.
    const observateur = new MutationObserver(planifier)
    observateur.observe(document.body, { childList: true, subtree: true })
    return () => observateur.disconnect()
  }, [])
  return null
}
