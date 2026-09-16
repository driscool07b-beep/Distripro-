// Applique le thème de couleurs et la taille de police choisis par
// l'utilisateur — via un attribut data-theme sur <html> (les
// variables CSS correspondantes sont définies dans index.css) et une
// variable --font-scale qui fait grandir tout le texte de l'app
// proportionnellement (rem), sans toucher à aucune page individuelle.

export const THEMES = ['petrol', 'ocean', 'forest', 'sunset', 'contraste']
export const TAILLES_POLICE = { normal: 1, grand: 1.15, tres_grand: 1.3 }

export function appliquerApparence(theme, taillePolice) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', THEMES.includes(theme) ? theme : 'petrol')
  document.documentElement.style.setProperty('--font-scale', String(TAILLES_POLICE[taillePolice] || 1))
}
