import guide from '../locales/fr/aide.json'

// Sélectionne dans le guide d'utilisation les passages les plus proches d'une
// question (mots communs, titres pondérés), pour l'assistance technique.
const MOTS_VIDES = new Set(['comment', 'pourquoi', 'quand', 'quel', 'quelle', 'quels', 'quelles', 'est', 'une', 'des', 'les', 'mon', 'mes', 'dans', 'pour', 'avec', 'sur', 'que', 'qui', 'faire', 'peux', 'puis', 'pas', 'plus', 'cette', 'ces', 'son', 'ses', 'aux', 'par', 'the', 'how', 'what', 'faut'])
const normaliser = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const mots = (s) => normaliser(s).split(/[^a-z0-9]+/).filter((m) => m.length > 2 && !MOTS_VIDES.has(m))

const ENTREES = (guide.categories || []).flatMap((c) => (c.items || []).map((it) => ({
  categorie: c.titre, q: it.q, r: it.r, motsQ: new Set(mots(`${c.titre} ${it.q}`)), motsR: new Set(mots(it.r)),
})))

export function extraitsGuide(question, nombre = 6) {
  const cherches = mots(question)
  if (!cherches.length) return []
  return ENTREES
    .map((e) => ({
      e,
      score: cherches.reduce((s, m) => s + ([...e.motsQ].some((x) => x.startsWith(m) || m.startsWith(x)) ? 3 : 0)
        + ([...e.motsR].some((x) => x.startsWith(m) || m.startsWith(x)) ? 1 : 0), 0),
    }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, nombre)
    .map(({ e }) => ({ rubrique: e.categorie, question: e.q, reponse: e.r }))
}
