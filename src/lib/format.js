// Formatage des dates et montants selon la langue active de l'app et
// la devise configurée par l'entreprise, plutôt que codé en dur en
// 'fr-FR' / 'F CFA' comme c'était le cas dans chaque page jusqu'ici.

import i18n from './i18n'

const LOCALES_INTL = {
  fr: 'fr-FR',
  en: 'en-US',
  ar: 'ar',
  zh: 'zh-CN',
}

function localeActif() {
  return LOCALES_INTL[i18n.language] || 'fr-FR'
}

// ---------------------------------------------------------------------
// Devise — réglée par entreprise (Paramètres), lue via AuthContext au
// chargement du profil. Module-level plutôt que passée en argument à
// chaque appel : ça évite de devoir modifier chaque appel de
// formatXOF(...) dans toutes les pages pour lui passer la devise.
// ---------------------------------------------------------------------
export const DEVISES = {
  XOF: { nom: 'Franc CFA (UEMOA)', symbole: 'F CFA', decimales: 0, position: 'apres' },
  EUR: { nom: 'Euro', symbole: '€', decimales: 2, position: 'apres' },
  USD: { nom: 'Dollar américain', symbole: '$', decimales: 2, position: 'avant' },
  GBP: { nom: 'Livre sterling', symbole: '£', decimales: 2, position: 'avant' },
  GHS: { nom: 'Cedi ghanéen', symbole: 'GH₵', decimales: 2, position: 'avant' },
  NGN: { nom: 'Naira nigérian', symbole: '₦', decimales: 2, position: 'avant' },
}

let deviseActuelle = 'XOF'

export function definirDevise(code) {
  deviseActuelle = DEVISES[code] ? code : 'XOF'
}

export function deviseCourante() {
  return deviseActuelle
}

// Montant formaté dans la devise configurée par l'entreprise. Garde le
// nom "formatXOF" pour que les pages qui l'utilisaient déjà n'aient
// rien à changer au niveau de leurs appels — seul l'import change.
export function formatXOF(n) {
  const d = DEVISES[deviseActuelle] || DEVISES.XOF
  const nombre = new Intl.NumberFormat(localeActif(), {
    minimumFractionDigits: d.decimales,
    maximumFractionDigits: d.decimales,
  }).format(n || 0).replace(/[\u202F\u00A0]/g, ' ')
  return d.position === 'avant' ? `${d.symbole}${nombre}` : `${nombre} ${d.symbole}`
}

// Version sans le symbole de devise (utile pour les PDF où le montant
// et "F CFA"/€/$ sont parfois positionnés dans des colonnes séparées).
export function formatNombre(n) {
  const d = DEVISES[deviseActuelle] || DEVISES.XOF
  return new Intl.NumberFormat(localeActif(), {
    minimumFractionDigits: d.decimales,
    maximumFractionDigits: d.decimales,
  }).format(n || 0).replace(/[\u202F\u00A0]/g, ' ')
}

// ---------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------

// Date courte : 05/09/2026 (fr) — 09/05/2026 (en)
export function formatDate(date, options) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString(localeActif(), options || { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Date longue : 5 septembre 2026 (fr) — September 5, 2026 (en)
export function formatDateLongue(date) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString(localeActif(), { dateStyle: 'long' })
}

// Date + heure : 05/09/2026 14:30
export function formatDateHeure(date, options) {
  if (!date) return '—'
  return new Date(date).toLocaleString(localeActif(), options || { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
