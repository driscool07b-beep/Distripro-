// Codes TVA de la Facture Normalisée Électronique (DGI Côte d'Ivoire).
export const CODES_TVA_LIBELLES = {
  TVA: 'TVA — 18 % (A)',
  TVAB: 'TVAB — 9 % (B)',
  TVAC: 'TVAC — Exonération conventionnelle (C)',
  TVAD: 'TVAD — Exonération légale (D)',
  TVAE: 'TVAE — Exonération export (E)',
}

// Timbre fiscal dû sur un paiement en espèces, selon le barème de l'entreprise
// (même règle que calculer_timbre côté base de données).
export function calculerTimbre(entreprise, montant) {
  const m = Number(montant) || 0
  if (!entreprise?.timbre_actif || m <= 0) return 0
  const tranche = (entreprise.timbre_bareme || [])
    .filter((x) => m >= Number(x.de || 0) && (x.a == null || x.a === '' || m <= Number(x.a)))
    .sort((x, y) => Number(y.de || 0) - Number(x.de || 0))[0]
  return tranche ? Number(tranche.montant) || 0 : 0
}
