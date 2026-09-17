// Conversion d'un nombre en toutes lettres, en français — utilisé sur
// les documents comptables (bons de caisse, factures, reçus) où la
// mention en lettres du montant est une pratique standard.

const UNITES = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf']
const DIX_A_SEIZE = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize']
const DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt']

function centainesEnLettres(n, estTrancheFinale) {
  if (n === 0) return ''
  let mots = []
  const centaine = Math.floor(n / 100)
  const reste = n % 100

  if (centaine > 0) {
    const pluriel = centaine > 1 && reste === 0 && estTrancheFinale
    mots.push(centaine === 1 ? 'cent' : UNITES[centaine] + ' cent' + (pluriel ? 's' : ''))
  }

  if (reste > 0) {
    if (reste < 10) {
      mots.push(UNITES[reste])
    } else if (reste < 17) {
      mots.push(DIX_A_SEIZE[reste - 10])
    } else if (reste < 20) {
      mots.push('dix-' + UNITES[reste - 10])
    } else {
      const dizaine = Math.floor(reste / 10)
      const unite = reste % 10
      if (dizaine === 7 || dizaine === 9) {
        const base = DIZAINES[dizaine]
        const resteUnite = reste - (dizaine === 7 ? 60 : 80)
        mots.push(base + '-' + (resteUnite < 17 ? DIX_A_SEIZE[resteUnite - 10] : 'dix-' + UNITES[resteUnite - 10]))
      } else {
        let motDizaine = DIZAINES[dizaine]
        if (unite === 1 && dizaine !== 8) motDizaine += ' et un'
        else if (unite === 1 && dizaine === 8) motDizaine += '-un'
        else if (unite > 0) motDizaine += '-' + UNITES[unite]
        else if (dizaine === 8 && estTrancheFinale) motDizaine += 's'
        mots.push(motDizaine)
      }
    }
  }

  return mots.join(' ')
}

/** Convertit un entier positif en toutes lettres françaises. */
export function nombreEnLettres(nombre) {
  let n = Math.floor(Math.abs(Number(nombre) || 0))
  if (n === 0) return 'zéro'

  const tranches = []
  const milliards = Math.floor(n / 1000000000)
  n %= 1000000000
  const millions = Math.floor(n / 1000000)
  n %= 1000000
  const milliers = Math.floor(n / 1000)
  n %= 1000
  const unites = n

  if (milliards > 0) {
    tranches.push(centainesEnLettres(milliards, false) + (milliards > 1 ? ' milliards' : ' milliard'))
  }
  if (millions > 0) {
    tranches.push(centainesEnLettres(millions, false) + (millions > 1 ? ' millions' : ' million'))
  }
  if (milliers > 0) {
    tranches.push(milliers === 1 ? 'mille' : centainesEnLettres(milliers, false) + ' mille')
  }
  if (unites > 0) {
    tranches.push(centainesEnLettres(unites, true))
  }

  return tranches.join(' ').replace(/\s+/g, ' ').trim()
}

/** Montant en lettres suivi de la devise, pour affichage sur documents. */
export function montantEnLettresAvecDevise(montant, nomDevise = 'francs CFA') {
  const entier = Math.floor(Math.abs(Number(montant) || 0))
  return `${nombreEnLettres(entier)} ${nomDevise}`.replace(/^\w/, (c) => c.toUpperCase())
}
