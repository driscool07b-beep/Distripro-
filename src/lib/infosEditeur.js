// Informations de la société éditrice de DistribPro, reprises dans les
// pages légales (conditions d'utilisation, confidentialité, mentions).
// À COMPLÉTER une fois la société créée : tant qu'une valeur commence par
// « [ », la page affiche un avertissement « document en cours de finalisation ».
export const EDITEUR = {
  raisonSociale: 'Kora Système',
  formeJuridique: '[Forme juridique, ex. SASU]',
  capital: '[Capital social] F CFA',
  siege: '[Adresse du siège social], Abidjan, Côte d\'Ivoire',
  rccm: '[Numéro RCCM]',
  ncc: '[Numéro de compte contribuable (NCC)]',
  representant: '[Nom du représentant légal], [fonction]',
  email: 'contact@distribpro.com',
  telephone: '[Téléphone]',
  declarationArtci: '[Numéro de déclaration / d\'autorisation ARTCI]',
  site: 'distribpro.com',
  application: 'distribpro.com',
  dateVersion: '[date de mise à jour]',
}

export const documentEnCoursDeFinalisation = () =>
  Object.values(EDITEUR).some((v) => String(v).includes('['))
