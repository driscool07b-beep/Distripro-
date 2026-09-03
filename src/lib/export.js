import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const LIBELLES_MODE = {
  espece: 'Espèces',
  cheque: 'Chèque',
  mobile_money: 'Mobile Money',
  virement: 'Virement bancaire',
}

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
 * Écrit l'en-tête entreprise (nom, adresse, téléphone, email, NCC, RCCM) en
 * haut d'un document PDF. Retourne la position Y à partir de laquelle
 * continuer à écrire (la hauteur de l'en-tête varie selon les infos remplies).
 */
function ecrireEnTeteEntreprise(doc, entreprise) {
  doc.setFontSize(16)
  doc.setTextColor(0)
  doc.text(entreprise?.nom || '', 14, 18)

  doc.setFontSize(9)
  doc.setTextColor(90)
  let y = 24

  if (entreprise?.adresse) {
    doc.text(entreprise.adresse, 14, y)
    y += 5
  }
  const contact = [entreprise?.telephone, entreprise?.email].filter(Boolean).join('  —  ')
  if (contact) {
    doc.text(contact, 14, y)
    y += 5
  }
  const legal = [
    entreprise?.ncc ? `NCC : ${entreprise.ncc}` : null,
    entreprise?.rccm ? `RCCM : ${entreprise.rccm}` : null,
  ].filter(Boolean).join('  —  ')
  if (legal) {
    doc.text(legal, 14, y)
    y += 5
  }

  doc.setTextColor(0)
  return y + 3
}

/**
 * Exporte un tableau d'objets en fichier Excel (.xlsx).
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
 */
export function exporterPDF(nomFichier, titre, sousTitre, colonnes, lignes, totalLibelle, totalValeur, entreprise) {
  const doc = new jsPDF()
  let y = 18

  if (entreprise) {
    y = ecrireEnTeteEntreprise(doc, entreprise)
  }

  doc.setFontSize(14)
  doc.setTextColor(0)
  doc.text(titre, 14, y + 4)
  y += 10
  if (sousTitre) {
    doc.setFontSize(10)
    doc.setTextColor(100)
    doc.text(sousTitre, 14, y)
    y += 6
  }

  autoTable(doc, {
    startY: y + 2,
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
    const yTotal = doc.lastAutoTable.finalY + 10
    doc.setFontSize(11)
    doc.setTextColor(0)
    doc.text(`${totalLibelle} : ${totalValeur}`, 14, yTotal)
  }

  doc.save(`${nomFichier}.pdf`)
}

/**
 * Génère un reçu/facture interne pour une vente.
 */
export function genererRecuVente({ entreprise, vente, lignes }) {
  const doc = new jsPDF()
  const y0 = ecrireEnTeteEntreprise(doc, entreprise)

  const soldeDu = Number(vente.total) - Number(vente.montant_regle)
  const couleurBandeau = soldeDu > 0 ? [255, 243, 224] : [230, 245, 236]
  const couleurBordure = soldeDu > 0 ? [217, 160, 60] : [45, 140, 90]
  const couleurTexte = soldeDu > 0 ? [150, 90, 10] : [20, 100, 55]

  doc.setFillColor(...couleurBandeau)
  doc.setDrawColor(...couleurBordure)
  doc.rect(14, y0, 182, 9, 'FD')
  doc.setFontSize(9)
  doc.setTextColor(...couleurTexte)
  doc.text(`REÇU DE VENTE${vente.numero_vente ? ' — ' + vente.numero_vente : ''}`, 105, y0 + 6, { align: 'center' })

  doc.setTextColor(0)
  doc.setFontSize(10)
  const yInfo = y0 + 18
  doc.text(`Client : ${vente.clients?.nom || '—'}`, 14, yInfo)
  if (vente.clients?.telephone) doc.text(`Téléphone : ${vente.clients.telephone}`, 14, yInfo + 6)
  if (vente.clients?.adresse) doc.text(`Adresse : ${vente.clients.adresse}`, 14, yInfo + 12)
  doc.text(`Date : ${new Date(vente.created_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}`, 120, yInfo)
  if (vente.profils?.nom) doc.text(`Commercial : ${vente.profils.nom}`, 120, yInfo + 6)

  autoTable(doc, {
    startY: yInfo + 20,
    head: [['Produit', 'Qté', 'PU (F CFA)', 'Sous-total (F CFA)']],
    body: lignes.map((l) => [
      l.produits?.nom || '',
      String(l.quantite),
      formatMontantPDF(l.prix_unitaire),
      formatMontantPDF(l.sous_total),
    ]),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [10, 31, 38] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })

  const formatMontant = (n) => formatMontantPDF(n) + ' F CFA'
  const corpsRecap = []
  if (Number(vente.remise_montant) > 0) {
    const sousTotal = lignes.reduce((s, l) => s + Number(l.sous_total || 0), 0)
    corpsRecap.push(['Sous-total', formatMontant(sousTotal)])
    corpsRecap.push(['Remise', '- ' + formatMontant(vente.remise_montant)])
  }
  corpsRecap.push(['Total', formatMontant(vente.total)])
  corpsRecap.push(['Mode de paiement', `${vente.mode_paiement === 'credit' ? 'Crédit' : 'Cash'}${vente.mode_reglement ? ' — ' + LIBELLES_MODE[vente.mode_reglement] : ''}`])
  corpsRecap.push(['Montant réglé', formatMontant(vente.montant_regle)])
  if (soldeDu > 0) corpsRecap.push(['Reste dû', formatMontant(soldeDu)])

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    body: corpsRecap,
    styles: { fontSize: 10, cellPadding: 3 },
    theme: 'plain',
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (soldeDu > 0 && data.row.index === corpsRecap.length - 1) {
        data.cell.styles.textColor = [180, 60, 20]
      }
    },
  })

  doc.setFontSize(8)
  doc.setTextColor(130)
  doc.text('Ce document tient lieu de justificatif interne — pas une facture normalisée DGI (FNE).', 14, 285)

  return doc
}

/**
 * Génère un reçu de paiement (encaissement sur une vente à crédit).
 */
export function genererRecuPaiement({ entreprise, client, montant, nouveauSolde, total, date, numero, venteNumero }) {
  const doc = new jsPDF()
  const y0 = ecrireEnTeteEntreprise(doc, entreprise)
  const formatMontant = (n) => formatMontantPDF(n) + ' F CFA'

  doc.setFillColor(230, 245, 236)
  doc.setDrawColor(45, 140, 90)
  doc.rect(14, y0, 182, 9, 'FD')
  doc.setFontSize(9)
  doc.setTextColor(20, 100, 55)
  doc.text(`REÇU DE PAIEMENT${numero ? ' — ' + numero : ''}`, 105, y0 + 6, { align: 'center' })

  doc.setTextColor(0)
  doc.setFontSize(11)
  const yInfo = y0 + 20
  doc.text(`Client : ${client?.nom || '—'}`, 14, yInfo)
  if (client?.telephone) doc.text(`Téléphone : ${client.telephone}`, 14, yInfo + 7)
  doc.text(`Date : ${new Date(date).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}`, 130, yInfo)
  if (venteNumero) doc.text(`Réf. vente : ${venteNumero}`, 130, yInfo + 7)

  const yBoite = yInfo + 20
  doc.setFillColor(247, 247, 245)
  doc.setDrawColor(220, 220, 215)
  doc.rect(14, yBoite, 182, 22, 'FD')
  doc.setFontSize(10)
  doc.setTextColor(90)
  doc.text('Montant reçu', 22, yBoite + 9)
  doc.setFontSize(18)
  doc.setTextColor(20, 100, 55)
  doc.setFont(undefined, 'bold')
  doc.text(formatMontant(montant), 22, yBoite + 18)
  doc.setFont(undefined, 'normal')

  autoTable(doc, {
    startY: yBoite + 32,
    body: [
      ['Total de la vente', formatMontant(total)],
      ['Solde restant dû après ce paiement', formatMontant(nouveauSolde)],
    ],
    styles: { fontSize: 10, cellPadding: 3 },
    theme: 'plain',
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
  })

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
  const y0 = ecrireEnTeteEntreprise(doc, entreprise)

  doc.setFontSize(11)
  doc.setTextColor(60)
  doc.text(`BON DE LIVRAISON${vente.numero_bl ? ' — ' + vente.numero_bl : ''}`, 14, y0)

  doc.setTextColor(0)
  doc.setFontSize(10)
  const yInfo = y0 + 10
  doc.text(`Client : ${vente.clients?.nom || '—'}`, 14, yInfo)
  if (vente.clients?.telephone) doc.text(`Téléphone : ${vente.clients.telephone}`, 14, yInfo + 6)
  if (vente.clients?.adresse) doc.text(`Adresse de livraison : ${vente.clients.adresse}`, 14, yInfo + 12)
  doc.text(`Date : ${new Date(vente.created_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}`, 120, yInfo)
  if (vente.profils?.nom) doc.text(`Livré par : ${vente.profils.nom}`, 120, yInfo + 6)
  if (vente.numero_vente) doc.text(`Réf. vente : ${vente.numero_vente}`, 120, yInfo + 12)

  autoTable(doc, {
    startY: yInfo + 20,
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

/**
 * Génère une facture proforma pour une commande (mise en page A4 complète).
 */
export function genererFactureProforma({ entreprise, commande, lignes }) {
  const doc = new jsPDF()
  const y0 = ecrireEnTeteEntreprise(doc, entreprise)

  doc.setFillColor(255, 243, 224)
  doc.setDrawColor(217, 160, 60)
  doc.rect(14, y0, 182, 9, 'FD')
  doc.setFontSize(9)
  doc.setTextColor(150, 90, 10)
  doc.text('FACTURE PROFORMA — document non valable comme facture définitive', 105, y0 + 6, { align: 'center' })

  doc.setTextColor(0)
  doc.setFontSize(11)
  const yTitre = y0 + 18
  doc.text(`${commande.numero || ''} — ${commande.clients?.nom || ''}`, 14, yTitre)

  doc.setFontSize(10)
  const yInfo = yTitre + 8
  if (commande.clients?.adresse) doc.text(`Adresse : ${commande.clients.adresse}`, 14, yInfo)
  if (commande.clients?.telephone) doc.text(`Téléphone : ${commande.clients.telephone}`, 14, yInfo + 6)
  doc.text(`Date : ${new Date(commande.created_at).toLocaleDateString('fr-FR')}`, 130, yInfo)
  if (commande.date_livraison_souhaitee) {
    doc.text(`Livraison souhaitée : ${new Date(commande.date_livraison_souhaitee).toLocaleDateString('fr-FR')}`, 130, yInfo + 6)
  }

  autoTable(doc, {
    startY: yInfo + 16,
    head: [['Produit', 'Qté', 'PU (F CFA)', 'Sous-total (F CFA)']],
    body: lignes.map((l) => [
      l.produits?.nom || '',
      String(l.quantite),
      formatMontantPDF(l.prix_unitaire),
      formatMontantPDF(l.quantite * l.prix_unitaire),
    ]),
    styles: { fontSize: 10, cellPadding: 3 },
    headStyles: { fillColor: [10, 31, 38] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })

  const totalHT = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0)
  const y = doc.lastAutoTable.finalY + 12
  const formatMontant = (n) => formatMontantPDF(n) + ' F CFA'

  doc.setFontSize(10)
  doc.text(`Montant HT`, 130, y)
  doc.text(formatMontant(commande.montant_ht ?? totalHT), 195, y, { align: 'right' })
  doc.text(`TVA`, 130, y + 7)
  doc.text(formatMontant(commande.montant_tva ?? 0), 195, y + 7, { align: 'right' })
  doc.setFontSize(12)
  doc.setFont(undefined, 'bold')
  doc.text(`Total TTC`, 130, y + 16)
  doc.text(formatMontant(commande.montant_ttc ?? totalHT), 195, y + 16, { align: 'right' })
  doc.setFont(undefined, 'normal')

  if (commande.notes) {
    doc.setFontSize(9)
    doc.setTextColor(90)
    doc.text('Notes :', 14, y + 30)
    doc.text(doc.splitTextToSize(commande.notes, 180), 14, y + 36)
    doc.setTextColor(0)
  }

  doc.setFontSize(8)
  doc.setTextColor(130)
  doc.text('Document non contractuel, sujet à confirmation de disponibilité et de prix.', 14, 285)

  return doc
}

/**
 * Génère un accusé de réception pour un versement d'un commercial à une caisse.
 */
export function genererAccuseVersement({ entreprise, versement, commercial, caisse, recuPar }) {
  const doc = new jsPDF()
  const y0 = ecrireEnTeteEntreprise(doc, entreprise)
  const formatMontant = (n) => formatMontantPDF(n) + ' F CFA'

  doc.setFontSize(11)
  doc.setTextColor(60)
  doc.text(`ACCUSÉ DE RÉCEPTION${versement.numero ? ' — ' + versement.numero : ''}`, 14, y0)

  doc.setTextColor(0)
  doc.setFontSize(11)
  const yInfo = y0 + 14
  doc.text(`Commercial : ${commercial?.nom || '—'}`, 14, yInfo)
  doc.text(`Caisse : ${caisse?.nom || '—'}`, 14, yInfo + 8)
  doc.text(`Date : ${new Date(versement.date_versement).toLocaleDateString('fr-FR')}`, 14, yInfo + 16)
  doc.text(`Reçu par : ${recuPar?.nom || '—'}`, 14, yInfo + 24)

  doc.setFontSize(16)
  doc.text(`Montant remis : ${formatMontant(versement.montant)}`, 14, yInfo + 42)

  doc.setFontSize(9)
  doc.setTextColor(90)
  doc.text("Ce document atteste la remise physique de ce montant par le commercial à la caisse indiquée.", 14, yInfo + 58)

  doc.setFontSize(9)
  doc.text('Signature du commercial', 14, yInfo + 80)
  doc.rect(14, yInfo + 84, 80, 22)
  doc.text('Signature du réceptionnaire', 110, yInfo + 80)
  doc.rect(110, yInfo + 84, 80, 22)

  doc.setFontSize(8)
  doc.setTextColor(130)
  doc.text('Ce document tient lieu de justificatif interne — pas une facture normalisée DGI (FNE).', 14, 285)

  return doc
}
