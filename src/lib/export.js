import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

/**
 * Formate un montant pour affichage dans un PDF. Intl.NumberFormat('fr-FR')
 * utilise une espace fine insécable (U+202F) comme séparateur de milliers,
 * que la police par défaut de jsPDF (Helvetica) ne sait pas afficher — elle
 * la rend visuellement comme un "/". On la remplace par une espace normale.
 */
export function formatMontantPDF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
    .format(n || 0)
    .replace(/[\u202F\u00A0]/g, ' ')
}

/**
 * Exporte un tableau d'objets en fichier Excel (.xlsx).
 * @param {string} nomFichier - sans extension, ex. "ventes-2026-08"
 * @param {{ cle: string, titre: string }[]} colonnes - définit l'ordre et les en-têtes
 * @param {object[]} lignes - tableau d'objets, une entrée par ligne
 */
export function exporterExcel(nomFichier, colonnes, lignes) {
  const donnees = lignes.map((ligne) => {
    const objet = {}
    colonnes.forEach((col) => {
      objet[col.titre] = ligne[col.cle]
    })
    return objet
  })
  const feuille = XLSX.utils.json_to_sheet(donnees)
  const classeur = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(classeur, feuille, 'Données')
  XLSX.writeFile(classeur, `${nomFichier}.xlsx`)
}

/**
 * Exporte un tableau d'objets en PDF avec en-tête, tableau et total optionnel.
 * @param {string} nomFichier - sans extension
 * @param {string} titre - titre affiché en haut du PDF
 * @param {string} sousTitre - ligne secondaire (ex. nom entreprise, période)
 * @param {{ cle: string, titre: string, alignDroite?: boolean }[]} colonnes
 * @param {object[]} lignes
 * @param {string} [totalLibelle] - si fourni, affiche une ligne de total en bas
 * @param {string} [totalValeur]
 */
export function exporterPDF(nomFichier, titre, sousTitre, colonnes, lignes, totalLibelle, totalValeur) {
  const doc = new jsPDF()

  doc.setFontSize(14)
  doc.text(titre, 14, 18)
  if (sousTitre) {
    doc.setFontSize(10)
    doc.setTextColor(100)
    doc.text(sousTitre, 14, 25)
  }

  autoTable(doc, {
    startY: sousTitre ? 32 : 26,
    head: [colonnes.map((c) => c.titre)],
    body: lignes.map((ligne) => colonnes.map((c) => String(ligne[c.cle] ?? ''))),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [10, 31, 38] },
    columnStyles: colonnes.reduce((acc, c, i) => {
      if (c.alignDroite) acc[i] = { halign: 'right' }
      return acc
    }, {}),
  })

  if (totalLibelle) {
    const y = doc.lastAutoTable.finalY + 10
    doc.setFontSize(11)
    doc.setTextColor(0)
    doc.text(`${totalLibelle} : ${totalValeur}`, 14, y)
  }

  doc.save(`${nomFichier}.pdf`)
}

/**
 * Génère un reçu/facture interne pour une vente (document jsPDF, non enregistré).
 * Appelant : doc.save(nom) pour télécharger, ou doc.output('blob') pour partager.
 */
export function genererRecuVente({ entreprise, vente, lignes }) {
  const doc = new jsPDF()

  doc.setFontSize(16)
  doc.text(entreprise?.nom || 'Facture', 14, 18)
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`Reçu de vente — document interne${vente.numero_vente ? ' — ' + vente.numero_vente : ''}`, 14, 25)

  doc.setTextColor(0)
  doc.setFontSize(10)
  doc.text(`Client : ${vente.clients?.nom || '—'}`, 14, 36)
  if (vente.clients?.telephone) doc.text(`Téléphone : ${vente.clients.telephone}`, 14, 42)
  if (vente.clients?.adresse) doc.text(`Adresse : ${vente.clients.adresse}`, 14, 48)
  doc.text(`Date : ${new Date(vente.created_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}`, 120, 36)
  if (vente.profils?.nom) doc.text(`Commercial : ${vente.profils.nom}`, 120, 42)

  autoTable(doc, {
    startY: 56,
    head: [['Produit', 'Qté', 'PU (F CFA)', 'Sous-total (F CFA)']],
    body: lignes.map((l) => [
      l.produits?.nom || '',
      String(l.quantite),
      formatMontantPDF(l.prix_unitaire),
      formatMontantPDF(l.sous_total),
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [10, 31, 38] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  })

  const y = doc.lastAutoTable.finalY + 10
  const formatMontant = (n) => formatMontantPDF(n) + ' F CFA'

  doc.setFontSize(11)
  doc.text(`Total : ${formatMontant(vente.total)}`, 14, y)
  doc.text(`Mode de paiement : ${vente.mode_paiement === 'credit' ? 'Crédit' : 'Cash'}`, 14, y + 7)
  doc.text(`Montant réglé : ${formatMontant(vente.montant_regle)}`, 14, y + 14)
  if (Number(vente.montant_regle) < Number(vente.total)) {
    doc.setTextColor(180, 60, 20)
    doc.text(`Reste dû : ${formatMontant(vente.total - vente.montant_regle)}`, 14, y + 21)
    doc.setTextColor(0)
  }

  doc.setFontSize(8)
  doc.setTextColor(130)
  doc.text('Ce document tient lieu de justificatif interne — pas une facture normalisée DGI (FNE).', 14, 285)

  return doc
}

/**
 * Génère un reçu de paiement (encaissement sur une vente à crédit).
 */
export function genererRecuPaiement({ entreprise, client, montant, nouveauSolde, total, date }) {
  const doc = new jsPDF()
  const formatMontant = (n) => formatMontantPDF(n) + ' F CFA'

  doc.setFontSize(16)
  doc.text(entreprise?.nom || 'Reçu de paiement', 14, 18)
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text('Reçu de paiement — document interne', 14, 25)

  doc.setTextColor(0)
  doc.setFontSize(11)
  doc.text(`Client : ${client?.nom || '—'}`, 14, 40)
  if (client?.telephone) doc.text(`Téléphone : ${client.telephone}`, 14, 47)
  doc.text(`Date : ${new Date(date).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}`, 14, 54)

  doc.setFontSize(14)
  doc.text(`Montant reçu : ${formatMontant(montant)}`, 14, 70)

  doc.setFontSize(10)
  doc.text(`Total de la vente : ${formatMontant(total)}`, 14, 82)
  doc.text(`Solde restant dû après ce paiement : ${formatMontant(nouveauSolde)}`, 14, 89)

  doc.setFontSize(8)
  doc.setTextColor(130)
  doc.text('Ce document tient lieu de justificatif interne — pas une facture normalisée DGI (FNE).', 14, 285)

  return doc
}

/**
 * Génère un bon de livraison (atteste ce qui a été physiquement remis au
 * client — distinct du reçu/facture, sans emphase sur le paiement).
 */
export function genererBonLivraison({ entreprise, vente, lignes }) {
  const doc = new jsPDF()

  doc.setFontSize(16)
  doc.text(entreprise?.nom || 'Bon de livraison', 14, 18)
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`BON DE LIVRAISON${vente.numero_bl ? ' — ' + vente.numero_bl : ''}`, 14, 25)

  doc.setTextColor(0)
  doc.setFontSize(10)
  doc.text(`Client : ${vente.clients?.nom || '—'}`, 14, 36)
  if (vente.clients?.telephone) doc.text(`Téléphone : ${vente.clients.telephone}`, 14, 42)
  if (vente.clients?.adresse) doc.text(`Adresse de livraison : ${vente.clients.adresse}`, 14, 48)
  doc.text(`Date : ${new Date(vente.created_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}`, 120, 36)
  if (vente.profils?.nom) doc.text(`Livré par : ${vente.profils.nom}`, 120, 42)
  if (vente.numero_vente) doc.text(`Réf. vente : ${vente.numero_vente}`, 120, 48)

  autoTable(doc, {
    startY: 56,
    head: [['Produit', 'Quantité livrée']],
    body: lignes.map((l) => [l.produits?.nom || '', String(l.quantite)]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [10, 31, 38] },
    columnStyles: { 1: { halign: 'right' } },
  })

  const y = doc.lastAutoTable.finalY + 20
  doc.setFontSize(9)
  doc.text('Signature du destinataire (bon reçu, conforme) :', 14, y)
  doc.rect(14, y + 5, 80, 25)

  doc.setFontSize(8)
  doc.setTextColor(130)
  doc.text('Ce document tient lieu de bon de livraison interne — pas une facture normalisée DGI (FNE).', 14, 285)

  return doc
}
