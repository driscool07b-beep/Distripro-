// Découpe une réponse de l'IA en blocs (titres, puces, paragraphes avec gras).
// Fichier léger, sans dépendance : utilisé par la bulle de l'assistant,
// présente sur tous les écrans.
// Découpe le texte d'une analyse IA en blocs simples :
// titres (**Titre** seul sur sa ligne, ou # Titre), puces (- / • / *) et paragraphes.
// Le gras en ligne (**mot**) est conservé sous forme de segments.
export function analyserTexte(contenu) {
  const blocs = []
  ;(contenu || '').replace(/[\u202F\u00A0]/g, ' ').split('\n').forEach((brute) => {
    const ligne = brute.trim()
    if (!ligne) return
    const titre = ligne.match(/^#{1,4}\s+(.*)$/) || ligne.match(/^\*\*(.+?)\*\*\s*:?\s*$/)
    if (titre) {
      blocs.push({ type: 'titre', texte: titre[1].replace(/\*\*/g, '').trim() })
      return
    }
    const puce = ligne.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/)
    if (puce) {
      blocs.push({ type: 'puce', segments: segments(puce[1]) })
      return
    }
    blocs.push({ type: 'paragraphe', segments: segments(ligne) })
  })
  return blocs
}

function segments(texte) {
  return texte.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((s) =>
    s.startsWith('**') && s.endsWith('**') ? { texte: s.slice(2, -2), gras: true } : { texte: s, gras: false }
  )
}
