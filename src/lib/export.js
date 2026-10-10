import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatNombre, formatXOF as formatMontantDevise, formatDate, formatDateHeure, DEVISES, deviseCourante } from './format'
import { montantEnLettresAvecDevise } from './nombreEnLettres'

const LIBELLES_MODE = {
  espece: 'Espèces',
  cheque: 'Chèque',
  mobile_money: 'Mobile Money',
  virement: 'Virement bancaire',
}

/**
 * Formate un montant pour affichage dans un PDF. Intl.NumberFormat utilise
 * une espace fine insécable (U+202F) comme séparateur de milliers, que la
 * police par défaut de jsPDF (Helvetica) ne sait pas afficher — elle la
 * rend visuellement comme un "/". formatNombre() la remplace déjà par une
 * espace normale. Suit aussi la devise configurée par l'entreprise (plus
 * seulement F CFA) et la langue active (plus seulement fr-FR).
 */
export function formatMontantPDF(n) {
  return formatNombre(n)
}

/** Symbole de la devise active de l'entreprise (F CFA, €, $...). */
export function symboleDevise() {
  return DEVISES[deviseCourante()]?.symbole || 'F CFA'
}

/**
 * Écrit l'en-tête entreprise (nom, adresse, téléphone, email, NCC, RCCM) en
 * haut d'un document PDF. Retourne la position Y à partir de laquelle
 * continuer à écrire (la hauteur de l'en-tête varie selon les infos remplies).
 */
// Désignation d'un article sur les documents : référence (code article) en tête.
export function designationProduit(produit) {
  if (!produit) return ''
  return [produit.reference, produit.nom].filter(Boolean).join(' — ')
}

export function ecrireEnTeteEntreprise(doc, entreprise) {
  // Logo de l'entreprise (facultatif), en haut à droite, proportions respectées.
  if (entreprise?.logo_data) {
    try {
      const ratio = Number(entreprise.logo_ratio) || 2
      let largeur = 42
      let hauteur = largeur / ratio
      if (hauteur > 20) { hauteur = 20; largeur = hauteur * ratio }
      const x = doc.internal.pageSize.getWidth() - 14 - largeur
      const format = String(entreprise.logo_data).startsWith('data:image/png') ? 'PNG' : 'JPEG'
      doc.addImage(entreprise.logo_data, format, x, 8, largeur, hauteur, undefined, 'FAST')
    } catch { /* un logo illisible ne doit jamais bloquer un document */ }
  }
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
  // Tableaux larges (plus de 8 colonnes) : page à l'italienne.
  const large = colonnes.length > 8
  const doc = new jsPDF(large ? { orientation: 'landscape' } : undefined)
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
    body: lignes.map((ligne) => colonnes.map((c) => {
      const valeur = ligne[c.cle]
      return typeof valeur === 'number' ? formatNombre(valeur) : String(valeur ?? '')
    })),
    styles: { fontSize: large ? 8.5 : 9 },
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
export function genererRecuVente({ entreprise, vente, lignes, autresTaxes, qrFne, visuelFne }) {
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
  // Vente certifiée FNE : un seul numéro, celui de la DGI.
  doc.text(
    vente.fne_statut === 'certifiee' && vente.fne_reference
      ? `FACTURE N° ${vente.fne_reference}`
      : `REÇU DE VENTE${vente.numero_vente ? ' — ' + vente.numero_vente : ''}`,
    105, y0 + 6, { align: 'center' })

  doc.setTextColor(0)
  doc.setFontSize(10)
  const yInfo = y0 + 18
  doc.text(`Client : ${vente.clients?.nom || '—'}`, 14, yInfo)
  if (vente.clients?.telephone) doc.text(`Téléphone : ${vente.clients.telephone}`, 14, yInfo + 6)
  if (vente.clients?.adresse) doc.text(`Adresse : ${vente.clients.adresse}`, 14, yInfo + 12)
  doc.text(`Date : ${formatDateHeure(vente.created_at, { dateStyle: 'medium', timeStyle: 'short' })}`, 120, yInfo)
  doc.text(`Commercial : ${vente.commercial?.nom || 'Vente de bureau'}`, 120, yInfo + 6)
  if (vente.profils?.nom) doc.text(`Saisi par : ${vente.profils.nom}`, 120, yInfo + 12)

  autoTable(doc, {
    startY: yInfo + 20,
    head: [['Produit', 'Qté', `PU (${symboleDevise()})`, `Sous-total (${symboleDevise()})`]],
    body: lignes.map((l) => [
      designationProduit(l.produits),
      String(l.quantite),
      formatMontantPDF(l.prix_unitaire),
      formatMontantPDF(l.sous_total),
    ]),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [10, 31, 38] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })

  const formatMontant = (n) => formatMontantDevise(n)
  const corpsRecap = []
  const sousTotalBrut = lignes.reduce((s, l) => s + Number(l.sous_total || 0), 0)
  const aDesTaxes = Number(vente.montant_tva) > 0 || Number(vente.montant_autres_taxes) > 0

  if (Number(vente.remise_montant) > 0) {
    corpsRecap.push(['Sous-total', formatMontant(sousTotalBrut)])
    corpsRecap.push(['Remise', '- ' + formatMontant(vente.remise_montant)])
  }
  if (aDesTaxes) {
    corpsRecap.push(['Total HT', formatMontant(vente.montant_ht)])

    // TVA : détail par taux (obligation légale — pas juste un total TVA).
    // Le taux réduit proportionnellement à la remise, comme calculé côté
    // serveur (montant_ht / sous-total brut = même facteur pour tous les taux).
    const facteurRemise = sousTotalBrut > 0 ? Number(vente.montant_ht) / sousTotalBrut : 1
    const tvaParTaux = {}
    lignes.forEach((l) => {
      const taux = Number(l.taux_tva || 0)
      if (taux > 0) tvaParTaux[taux] = (tvaParTaux[taux] || 0) + Number(l.montant_tva || 0)
    })
    Object.entries(tvaParTaux)
      .sort(([a], [b]) => Number(a) - Number(b))
      .forEach(([taux, montantBrut]) => {
        corpsRecap.push([`TVA (${taux}%)`, formatMontant(montantBrut * facteurRemise)])
      })

    // Autres taxes (AIRSI…) : nom + taux de chacune, dans l'ordre où elles
    // ont été enregistrées à la vente.
    ;(autresTaxes || []).forEach((tx) => {
      corpsRecap.push([`${tx.nom} (${tx.taux}%)`, formatMontant(tx.montant)])
    })
  }
  // Après un avoir, la vente garde son montant facturé d'origine
  // (total_initial) ; les avoirs et le net apparaissent à part.
  const totalFacture = vente.total_initial != null ? Number(vente.total_initial) : Number(vente.total)
  corpsRecap.push(['Total' + (aDesTaxes ? ' TTC' : ''), formatMontant(totalFacture)])
  if (vente.total_initial != null) {
    corpsRecap.push(['Avoirs', '- ' + formatMontant(totalFacture - Number(vente.total))])
    corpsRecap.push(['Net après avoirs', formatMontant(vente.total)])
  }
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

  doc.setFontSize(9)
  doc.setTextColor(60)
  const nomDevise = DEVISES[deviseCourante()]?.nom || 'francs CFA'
  const texteEnLettres = doc.splitTextToSize(
    `Arrêtée la présente ${aDesTaxes ? 'facture' : 'vente'} à la somme de : ${montantEnLettresAvecDevise(vente.total_initial != null ? vente.total_initial : vente.total, nomDevise)}.`,
    182
  )
  doc.text(texteEnLettres, 14, doc.lastAutoTable.finalY + 10)
  doc.setTextColor(0)

  const certifiee = vente.fne_statut === 'certifiee' && vente.fne_reference
  if (certifiee) {
    // Éléments FNE : référence DGI + QR code de vérification (lien DGI).
    const yFne = Math.min(doc.lastAutoTable.finalY + 22, 235)
    if (qrFne) doc.addImage(qrFne, 'PNG', 150, yFne, 42, 42)
    // Visuel officiel FNE, à gauche du QR code.
    if (visuelFne) doc.addImage(visuelFne, 'PNG', 118, yFne + 5, 30, 30)
    doc.setFontSize(10)
    doc.setTextColor(0)
    doc.setFont(undefined, 'bold')
    doc.text('Facture Normalisée Électronique (FNE)', 14, yFne + 6)
    doc.setFont(undefined, 'normal')
    doc.setFontSize(9)
    doc.text(`N° de facture (DGI) : ${vente.fne_reference}`, 14, yFne + 13)
    if (vente.fne_certifiee_at) doc.text(`Certifiée le : ${formatDateHeure(vente.fne_certifiee_at, { dateStyle: 'medium', timeStyle: 'short' })}`, 14, yFne + 19)
    doc.text(doc.splitTextToSize('Authenticité vérifiable en scannant le QR code (plateforme FNE de la DGI).', 125), 14, yFne + 25)
    if (vente.fne_avoir_reference) {
      doc.setTextColor(180, 60, 20)
      doc.text(`Avoir FNE émis : ${vente.fne_avoir_reference}`, 14, yFne + 35)
      doc.setTextColor(0)
    }
  } else {
    doc.setFontSize(8)
    doc.setTextColor(130)
    doc.text('Ce document tient lieu de justificatif interne — pas une facture normalisée DGI (FNE).', 14, 285)
  }

  return doc
}

/**
 * Génère une facture d'avoir (annulation de vente) — atteste le montant
 * crédité au client et la remise en stock des articles. Visuellement
 * distinct des reçus (bandeau rouge) pour ne jamais être confondu avec un
 * document de paiement.
 */
export function genererFactureAvoir({ entreprise, client, vente, lignes, motif, montant, date, reference, fneReference, typeAvoir, qrFne, visuelFne }) {
  const doc = new jsPDF()
  const y0 = ecrireEnTeteEntreprise(doc, entreprise)
  const formatMontant = (n) => formatMontantDevise(n)

  doc.setFillColor(253, 232, 232)
  doc.setDrawColor(190, 50, 50)
  doc.rect(14, y0, 182, 9, 'FD')
  doc.setFontSize(9)
  doc.setTextColor(150, 20, 20)
  const libelleType = typeAvoir === 'prix' ? ' (correction de prix)' : typeAvoir === 'retour' ? ' (retour de marchandise)' : ''
  // Avoir certifié FNE : un seul numéro, celui de la DGI.
  doc.text(fneReference ? `AVOIR N° ${fneReference}${libelleType}` : `AVOIR${reference ? ' — ' + reference : ''}${libelleType}`, 105, y0 + 6, { align: 'center' })

  doc.setTextColor(0)
  doc.setFontSize(10)
  const yInfo = y0 + 18
  doc.text(`Client : ${client?.nom || '—'}`, 14, yInfo)
  if (client?.telephone) doc.text(`Téléphone : ${client.telephone}`, 14, yInfo + 6)
  doc.text(`Date : ${formatDateHeure(date, { dateStyle: 'medium', timeStyle: 'short' })}`, 120, yInfo)
  const refVente = vente?.fne_statut === 'certifiee' && vente?.fne_reference ? vente.fne_reference : vente?.numero_vente
  if (refVente) doc.text(`${typeAvoir === 'retour' || typeAvoir === 'prix' ? 'Facture concernée' : 'Facture annulée'} : ${refVente}`, 120, yInfo + 6)

  let y = yInfo + 18
  if (motif) {
    doc.setFontSize(9)
    doc.setTextColor(90)
    doc.text(`Motif : ${motif}`, 14, y)
    y += 8
  }

  if (lignes && lignes.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Produit', 'Qté', typeAvoir === 'prix' ? `PU → corrigé (${symboleDevise()})` : `PU (${symboleDevise()})`, `Montant (${symboleDevise()})`]],
      body: lignes.map((l) => [
        designationProduit(l.produits) + (l.etat === 'abime' ? ' (abîmé)' : ''),
        String(l.quantite),
        l.prix_corrige != null ? `${formatMontantPDF(l.prix_unitaire)} → ${formatMontantPDF(l.prix_corrige)}` : formatMontantPDF(l.prix_unitaire),
        formatMontantPDF(l.sous_total),
      ]),
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [10, 31, 38] },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 12
  }

  doc.setFillColor(253, 245, 245)
  doc.setDrawColor(220, 200, 200)
  doc.rect(14, y, 182, 22, 'FD')
  doc.setFontSize(10)
  doc.setTextColor(90)
  doc.text('Montant crédité au client', 22, y + 9)
  doc.setFontSize(18)
  doc.setTextColor(150, 20, 20)
  doc.setFont(undefined, 'bold')
  doc.text('- ' + formatMontant(montant), 22, y + 18)
  doc.setFont(undefined, 'normal')

  doc.setFontSize(8)
  doc.setTextColor(130)
  doc.text(
    typeAvoir === 'prix'
      ? 'Ce document atteste la correction du prix des articles ci-dessus.'
      : typeAvoir === 'retour'
        ? 'Ce document atteste le retour des articles ci-dessus, déduits de la vente.'
        : 'Ce document atteste l\u2019annulation de la vente ci-dessus et la remise en stock des articles concernés.',
    14, 278
  )
  if (!fneReference) doc.text('Il ne constitue pas une facture normalisée DGI (FNE).', 14, 283)
  if (fneReference && (qrFne || visuelFne)) {
    // Signature électronique FNE de l'avoir : visuel, QR code, numéro DGI.
    const yS = 235
    if (visuelFne) doc.addImage(visuelFne, 'PNG', 118, yS + 5, 30, 30)
    if (qrFne) doc.addImage(qrFne, 'PNG', 150, yS, 42, 42)
    doc.setFontSize(9)
    doc.setTextColor(0)
    doc.text('Avoir certifié — Facture Normalisée Électronique (FNE)', 14, yS + 10)
    doc.text(`N° d'avoir (DGI) : ${fneReference}`, 14, yS + 16)
  }

  return doc
}

/**
 * Génère un reçu de paiement (encaissement sur une vente à crédit).
 */
export function genererRecuPaiement({ entreprise, client, montant, nouveauSolde, total, date, numero, venteNumero, receptionnePar }) {
  const doc = new jsPDF()
  const y0 = ecrireEnTeteEntreprise(doc, entreprise)
  const formatMontant = (n) => formatMontantDevise(n)

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
  doc.text(`Date : ${formatDateHeure(date, { dateStyle: 'medium', timeStyle: 'short' })}`, 130, yInfo)
  if (venteNumero) doc.text(`Réf. vente : ${venteNumero}`, 130, yInfo + 7)
  if (receptionnePar) doc.text(`Reçu par : ${receptionnePar}`, 130, yInfo + 14)

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
  doc.text(`Date : ${formatDateHeure(vente.created_at, { dateStyle: 'medium', timeStyle: 'short' })}`, 120, yInfo)
  if (vente.commercial?.nom || vente.profils?.nom) doc.text(`Commercial : ${vente.commercial?.nom || 'Vente de bureau'}`, 120, yInfo + 6)
  const refFacture = vente.fne_statut === 'certifiee' && vente.fne_reference ? vente.fne_reference : vente.numero_vente
  if (refFacture) doc.text(`Réf. facture : ${refFacture}`, 120, yInfo + 12)

  autoTable(doc, {
    startY: yInfo + 20,
    head: [['Produit', 'Quantité livrée']],
    body: lignes.map((l) => [designationProduit(l.produits), String(l.quantite)]),
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
  doc.text(`Date : ${formatDate(commande.created_at)}`, 130, yInfo)
  if (commande.date_livraison_souhaitee) {
    doc.text(`Livraison souhaitée : ${formatDate(commande.date_livraison_souhaitee)}`, 130, yInfo + 6)
  }

  autoTable(doc, {
    startY: yInfo + 16,
    head: [['Produit', 'Qté', `PU (${symboleDevise()})`, `Sous-total (${symboleDevise()})`]],
    body: lignes.map((l) => [
      designationProduit(l.produits),
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
  const formatMontant = (n) => formatMontantDevise(n)

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
  const formatMontant = (n) => formatMontantDevise(n)

  doc.setFontSize(11)
  doc.setTextColor(60)
  doc.text(`ACCUSÉ DE RÉCEPTION${versement.numero ? ' — ' + versement.numero : ''}`, 14, y0)

  doc.setTextColor(0)
  doc.setFontSize(11)
  const yInfo = y0 + 14
  doc.text(`Commercial : ${commercial?.nom || '—'}`, 14, yInfo)
  doc.text(`Caisse : ${caisse?.nom || '—'}`, 14, yInfo + 8)
  doc.text(`Date : ${formatDate(versement.date_versement)}`, 14, yInfo + 16)
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

export function genererBonCaisse({ entreprise, demande, caisse, demandePar, validePar, payePar }) {
  const doc = new jsPDF()
  const y0 = ecrireEnTeteEntreprise(doc, entreprise)
  const formatMontant = (n) => formatMontantDevise(n)
  const nomDevise = DEVISES[deviseCourante()]?.nom || 'francs CFA'

  doc.setFontSize(11)
  doc.setTextColor(60)
  doc.text(`BON DE CAISSE — SORTIE${demande.numero ? '  N° ' + demande.numero : ''}`, 14, y0)

  doc.setTextColor(0)
  doc.setFontSize(11)
  const yInfo = y0 + 14
  doc.text(`Caisse : ${caisse?.nom || '—'}`, 14, yInfo)
  doc.text(`Libellé : ${demande.libelle}`, 14, yInfo + 8)
  doc.text(`Bénéficiaire : ${demande.beneficiaire || demandePar?.nom || '—'}`, 14, yInfo + 16)
  doc.text(`Demandé par : ${demandePar?.nom || '—'} — ${formatDate(demande.created_at)}`, 14, yInfo + 24)
  doc.text(`Montant demandé : ${formatMontant(demande.montant_demande)}`, 14, yInfo + 32)
  if (validePar) {
    doc.text(`Validé par : ${validePar.nom} — ${formatDateHeure(demande.valide_at, { dateStyle: 'medium', timeStyle: 'short' })}`, 14, yInfo + 40)
  } else {
    doc.text("Validé automatiquement (montant sous le seuil de l'entreprise)", 14, yInfo + 40)
  }
  doc.text(`Payé par : ${payePar?.nom || '—'} — ${formatDateHeure(demande.payee_at, { dateStyle: 'medium', timeStyle: 'short' })}`, 14, yInfo + 48)

  doc.setFontSize(16)
  doc.text(`Montant payé : ${formatMontant(demande.montant_valide)}`, 14, yInfo + 64)
  if (Number(demande.montant_valide) < Number(demande.montant_demande)) {
    doc.setFontSize(9)
    doc.setTextColor(150, 90, 20)
    doc.text(`(réduit par rapport au montant demandé de ${formatMontant(demande.montant_demande)})`, 14, yInfo + 72)
    doc.setTextColor(0)
  }

  doc.setFontSize(9)
  doc.setTextColor(60)
  const texteEnLettres = doc.splitTextToSize(
    `Arrêté le présent montant à la somme de : ${montantEnLettresAvecDevise(demande.montant_valide, nomDevise)}.`,
    182
  )
  doc.text(texteEnLettres, 14, yInfo + 84)
  doc.setTextColor(0)

  const ySignatures = yInfo + 84 + texteEnLettres.length * 5 + 14
  doc.setFontSize(9)
  doc.text('Signature du caissier', 14, ySignatures)
  doc.rect(14, ySignatures + 4, 80, 22)
  doc.text(`Signature du bénéficiaire (${demande.beneficiaire || demandePar?.nom || '—'})`, 110, ySignatures)
  doc.rect(110, ySignatures + 4, 80, 22)

  doc.setFontSize(8)
  doc.setTextColor(130)
  doc.text('Ce document tient lieu de justificatif interne — pas une facture normalisée DGI (FNE).', 14, 285)

  return doc
}

export function genererRapportInventaireCaisse({ entreprise, inventaire, caisse }) {
  const doc = new jsPDF()
  const y0 = ecrireEnTeteEntreprise(doc, entreprise)
  const formatMontant = (n) => formatMontantDevise(n)

  doc.setFontSize(11)
  doc.setTextColor(60)
  doc.text(`INVENTAIRE DE CAISSE${inventaire.numero ? '  N° ' + inventaire.numero : ''}`, 14, y0)

  doc.setTextColor(0)
  doc.setFontSize(11)
  const yInfo = y0 + 14
  doc.text(`Caisse : ${caisse?.nom || '—'}`, 14, yInfo)
  doc.text(`Date du contrôle : ${formatDateHeure(inventaire.created_at, { dateStyle: 'medium', timeStyle: 'short' })}`, 14, yInfo + 8)
  doc.text(`Contrôlé par : ${inventaire.controleur?.nom || '—'}`, 14, yInfo + 16)

  let yApresDetail = yInfo + 26
  const denominations = (inventaire.denominations || []).slice().sort((a, b) => b.valeur - a.valeur)
  if (denominations.length > 0) {
    doc.setFontSize(9)
    doc.setTextColor(60)
    doc.text('Détail du comptage physique', 14, yApresDetail)
    autoTable(doc, {
      startY: yApresDetail + 4,
      head: [['Coupure', 'Quantité', 'Sous-total']],
      body: denominations.map((d) => [formatMontant(d.valeur), String(d.quantite), formatMontant(d.valeur * d.quantite)]),
      styles: { fontSize: 9, cellPadding: 2.5 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    })
    yApresDetail = doc.lastAutoTable.finalY + 8
  }

  autoTable(doc, {
    startY: yApresDetail,
    head: [['', 'Montant']],
    body: [
      ['Solde théorique (comptable)', formatMontant(inventaire.solde_theorique)],
      ['Solde compté (physique)', formatMontant(inventaire.solde_compte)],
      ['Écart', (Number(inventaire.ecart) > 0 ? '+' : '') + formatMontant(inventaire.ecart)],
    ],
    styles: { fontSize: 11, cellPadding: 4 },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.row.index === 2 && Number(inventaire.ecart) !== 0) {
        data.cell.styles.textColor = [190, 40, 30]
      }
    },
  })

  let y = doc.lastAutoTable.finalY + 12
  if (inventaire.notes) {
    doc.setFontSize(10)
    doc.setTextColor(60)
    const notes = doc.splitTextToSize(`Notes : ${inventaire.notes}`, 182)
    doc.text(notes, 14, y)
    y += notes.length * 5 + 10
  }

  doc.setFontSize(9)
  doc.text('Signature du contrôleur', 14, y + 15)
  doc.rect(14, y + 19, 80, 22)
  doc.text('Signature du responsable de caisse', 110, y + 15)
  doc.rect(110, y + 19, 80, 22)

  doc.setFontSize(8)
  doc.setTextColor(130)
  doc.text('Ce document tient lieu de justificatif interne — pas une facture normalisée DGI (FNE).', 14, 285)

  return doc
}

export function genererRapportInventaireStock({ entreprise, inventaire }) {
  const doc = new jsPDF()
  const y0 = ecrireEnTeteEntreprise(doc, entreprise)

  doc.setFontSize(11)
  doc.setTextColor(60)
  doc.text(`INVENTAIRE DE STOCK${inventaire.numero ? '  N° ' + inventaire.numero : ''}`, 14, y0)

  doc.setTextColor(0)
  doc.setFontSize(10)
  const yInfo = y0 + 12
  doc.text(`Dépôt : ${inventaire.depot?.nom || '—'}`, 14, yInfo)
  doc.text(`Date : ${formatDateHeure(inventaire.created_at, { dateStyle: 'medium', timeStyle: 'short' })}`, 14, yInfo + 7)
  doc.text(`Contrôlé par : ${inventaire.controleur?.nom || '—'}`, 14, yInfo + 14)

  const lignes = (inventaire.lignes || []).map((l) => [
    designationProduit(l.produits) || '—',
    formatNombre(l.quantite_theorique),
    formatNombre(l.quantite_comptee),
    (Number(l.ecart) > 0 ? '+' : '') + formatNombre(l.ecart),
  ])

  autoTable(doc, {
    startY: yInfo + 22,
    head: [['Produit', 'Théorique', 'Compté', 'Écart']],
    body: lignes,
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 3) {
        const valeur = Number((inventaire.lignes || [])[data.row.index]?.ecart || 0)
        if (valeur !== 0) data.cell.styles.textColor = [190, 40, 30]
      }
    },
  })

  let y = doc.lastAutoTable.finalY + 10
  if (inventaire.notes) {
    doc.setFontSize(9)
    doc.setTextColor(60)
    const notes = doc.splitTextToSize(`Notes : ${inventaire.notes}`, 182)
    doc.text(notes, 14, y)
    y += notes.length * 5 + 8
  }

  doc.setFontSize(9)
  doc.setTextColor(0)
  doc.text('Signature du contrôleur', 14, y + 15)
  doc.rect(14, y + 19, 80, 22)
  doc.text('Signature du responsable de dépôt', 110, y + 15)
  doc.rect(110, y + 19, 80, 22)

  doc.setFontSize(8)
  doc.setTextColor(130)
  doc.text('Les écarts non nuls ont été automatiquement ajustés dans le stock théorique.', 14, 280)
  doc.text('Ce document tient lieu de justificatif interne — pas une facture normalisée DGI (FNE).', 14, 285)

  return doc
}

export function genererRapportNotesUtilisation({ entreprise, notes, mois }) {
  const doc = new jsPDF()
  const y0 = ecrireEnTeteEntreprise(doc, entreprise)

  const libelleMois = new Date(mois).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  doc.setFontSize(11)
  doc.setTextColor(60)
  doc.text(`NOTES D'UTILISATION DE L'APPLICATION — ${libelleMois.toUpperCase()}`, 14, y0)

  const tri = [...notes].sort((a, b) => b.score_total - a.score_total)
  const lignes = tri.map((n, i) => [
    String(i + 1),
    n.profils?.nom || '—',
    `${n.score_total} / 100`,
    `${n.score_assiduite} (${n.jours_actifs}/${n.jours_ouvres}j)`,
    n.visites_prevues > 0 ? `${n.score_rapports} (${n.visites_avec_rapport}/${n.visites_prevues})` : `${n.score_rapports} (n/a)`,
    n.jours_avec_vente_cash > 0 ? `${n.score_versements} (${n.jours_avec_versement}/${n.jours_avec_vente_cash})` : `${n.score_versements} (n/a)`,
  ])

  autoTable(doc, {
    startY: y0 + 12,
    head: [['#', 'Commercial', 'Note /100', 'Assiduité', 'Rapports', 'Versements']],
    body: lignes,
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { halign: 'center' }, 2: { halign: 'center', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
  })

  const y = doc.lastAutoTable.finalY + 10
  doc.setFontSize(8)
  doc.setTextColor(130)
  doc.text(
    'Note calculée automatiquement à partir des données enregistrées dans DistribPro (assiduité terrain, rapports de',
    14, y
  )
  doc.text(
    'visite complets, discipline de versement) — à examiner par un responsable avant toute décision de prime.',
    14, y + 5
  )

  return doc
}

// ---------------------------------------------------------------------------
// Facture normalisée électronique (FNE) — même dispositif que la facture
// produite par la plateforme FNE de la DGI : bloc fiscal de l'entreprise,
// « Facture de vente N° <numéro DGI> », QR code + visuel FNE, bloc client,
// tableau des articles (Réf, Désignation, P.U HT, Qté, Unité, Taxes, Rem.,
// Montant HT), totaux, résumé par catégorie de taxe.
// Sert aussi pour la facture d'avoir certifiée (avoir = { reference,
// referenceOrigine, motif, montant }).
// ---------------------------------------------------------------------------
const CATEGORIES_TVA = {
  TVA: { taux: 18, libelle: 'TVA normale - TVA sur HT 18,00% - A' },
  TVAB: { taux: 9, libelle: 'TVA réduite - TVA sur HT 09,00% - B' },
  TVAC: { taux: 0, libelle: 'TVA exo.conv - TVA sur HT 00,00% - C' },
  TVAD: { taux: 0, libelle: 'TVA exo.légale - TVA sur HT 00,00% - D' },
  TVAE: { taux: 0, libelle: 'TVA exo.export - TVA sur HT 00,00% - E' },
}
export const CODES_TVA_FNE = Object.keys(CATEGORIES_TVA)
export const CODES_EXONERATION_FNE = ['TVAD', 'TVAC', 'TVAE']
// Code TVA FNE d'une ligne : code réellement certifié (ventes_lignes) >
// exception client > exception produit > taux > code d'exonération par défaut.
export function codeTvaFne(taux, assujetti, defaut, codeLigne, codeClient, codeProduit) {
  for (const c of [codeLigne, codeClient, codeProduit]) if (c && CATEGORIES_TVA[c]) return c
  const exo = CODES_EXONERATION_FNE.includes(defaut) ? defaut : 'TVAD'
  if (!assujetti) return exo
  if (Number(taux) === 18) return 'TVA'
  if (Number(taux) === 9) return 'TVAB'
  return exo
}
const LIBELLES_PAIEMENT_FNE = { espece: 'Espèces', cheque: 'Chèque', mobile_money: 'Mobile Money', virement: 'Virement', carte: 'Carte bancaire' }

export function genererFactureFne({ entreprise, vente, lignes, autresTaxes, qrFne, visuelFne, configFne, client, avoir }) {
  const doc = new jsPDF()
  const L = 210
  const fmt = (n) => formatMontantPDF(Math.round(Number(n) || 0))
  const cli = client || vente.clients || {}
  doc.setFont('helvetica', 'normal')

  // Bloc fiscal de l'entreprise (cadre arrondi).
  doc.setDrawColor(0)
  doc.setLineWidth(0.3)
  doc.roundedRect(10, 10, 96, 32, 2, 2)
  doc.setTextColor(0)
  doc.setFontSize(11)
  const lignesFiscales = [
    String(entreprise?.nom || '').toUpperCase(),
    entreprise?.ncc ? `NCC : ${entreprise.ncc}` : null,
    entreprise?.regime_imposition ? `Régime d'imposition : ${entreprise.regime_imposition}` : null,
    entreprise?.centre_impots ? `Centre des impôts : ${entreprise.centre_impots}` : null,
  ].filter(Boolean)
  let yf = 17
  lignesFiscales.forEach((t) => {
    const morceaux = doc.splitTextToSize(t, 90)
    doc.text(morceaux, 13, yf)
    yf += morceaux.length * 5.2
  })

  // Logo de l'entreprise, en haut à droite.
  if (entreprise?.logo_data) {
    try {
      const ratio = Number(entreprise.logo_ratio) || 1.4
      let h = 26
      let w = h * ratio
      if (w > 48) { w = 48; h = w / ratio }
      const format = String(entreprise.logo_data).startsWith('data:image/png') ? 'PNG' : 'JPEG'
      doc.addImage(entreprise.logo_data, format, 150 - w / 2 + 18, 10, w, h, undefined, 'FAST')
    } catch { /* logo illisible : on continue */ }
  }

  // Titre + signature électronique (QR code, visuel FNE, numéro DGI).
  doc.setFontSize(10)
  const titre = avoir ? `Facture d'avoir N° ${avoir.reference}` : `Facture de vente N° ${vente.fne_reference}`
  doc.text(titre, 148, 46, { align: 'center' })
  if (qrFne) doc.addImage(qrFne, 'PNG', 117, 50, 28, 28)
  if (visuelFne) doc.addImage(visuelFne, 'PNG', 152, 50, 37, 27.6)

  // Informations de l'entreprise et de la vente (colonne de gauche).
  const modePaiement = vente.mode_paiement === 'credit' && Number(vente.montant_regle || 0) === 0
    ? 'À terme' : (LIBELLES_PAIEMENT_FNE[vente.mode_reglement] || (vente.mode_paiement === 'credit' ? 'À terme' : 'Espèces'))
  const dateDoc = avoir?.date || vente.fne_certifiee_at || vente.created_at
  const infos = [
    ['RCCM', entreprise?.rccm],
    ['Références bancaires', entreprise?.references_bancaires || ''],
    ['Établissement', configFne?.etablissement || entreprise?.nom],
    ['Adresse', entreprise?.adresse],
    ['N° Tel', entreprise?.telephone],
    ['Mail', entreprise?.email],
    ['Nom du vendeur', vente.commercial?.nom || vente.profils?.nom],
    ['Nom de PDV', configFne?.point_de_vente],
    ['Date et heure', formatDateHeure(dateDoc, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })],
    ['Mode de paiement', modePaiement],
  ].filter(([, v]) => v !== undefined && v !== null)
  doc.setFontSize(9.5)
  let yi = 50
  infos.forEach(([k, v]) => {
    const morceaux = doc.splitTextToSize(`${k} :  ${v || ''}`, 98)
    doc.text(morceaux, 10, yi)
    yi += Math.max(morceaux.length, 1) * 6.3
  })

  // Bloc client (colonne de droite).
  let yc = 85
  doc.setFont('helvetica', 'bold')
  doc.text('Client', 117, yc)
  doc.setFont('helvetica', 'normal')
  yc += 6.3
  ;[
    ['Nom', cli.nom],
    ['Adresse', cli.adresse || cli.email],
    ['NCC', cli.ncc],
    ["Régime d'imposition", cli.regime_imposition],
  ].filter(([, v]) => v).forEach(([k, v]) => {
    const morceaux = doc.splitTextToSize(`${k} :  ${v}`, 82)
    doc.text(morceaux, 117, yc)
    yc += morceaux.length * 6.3
  })
  let y = Math.max(yi, yc) + 4
  if (avoir) {
    doc.setFontSize(9)
    doc.text(`Facture d'origine N° ${avoir.referenceOrigine || ''}`, 10, y)
    if (avoir.motif) doc.text(doc.splitTextToSize(`Motif : ${avoir.motif}`, 190), 10, y + 5)
    y += avoir.motif ? 12 : 7
  }

  // Articles.
  const brut = (lignes || []).reduce((s, l) => s + Number(l.quantite) * Number(l.prix_unitaire), 0)
  const brutVente = Number(avoir?.brutVente ?? brut)
  const remisePct = brutVente > 0 ? Math.round((Number(vente.remise_montant || 0) / brutVente) * 10000) / 100 : 0
  const parCategorie = {}
  let totalHt = 0
  let totalTva = 0
  const corps = (lignes || []).map((l) => {
    const code = codeTvaFne(l.taux_tva, !!entreprise?.assujetti_tva, entreprise?.fne_code_exoneration, l.code_tva_fne, client?.code_tva_fne, l.produits?.code_tva_fne)
    const cat = CATEGORIES_TVA[code]
    const ht = Number(l.quantite) * Number(l.prix_unitaire) * (1 - remisePct / 100)
    const tva = ht * cat.taux / 100
    totalHt += ht
    totalTva += tva
    const c = (parCategorie[code] ||= { ht: 0, tva: 0 })
    c.ht += ht
    c.tva += tva
    return [
      l.produits?.reference || '',
      l.produits?.nom || '',
      fmt(l.prix_unitaire),
      String(l.quantite),
      l.produits?.unite || '',
      `${code} (${cat.taux})`,
      String(remisePct),
      fmt(ht),
    ]
  })
  autoTable(doc, {
    startY: y,
    head: [['Réf', 'Désignation', 'P.U HT', 'Qté', 'Unité', 'Taxes (%)', 'Rem. (%)', 'Montant HT']],
    body: corps,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.8, textColor: 0, lineColor: 0, lineWidth: 0.2 },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 26 }, 1: { cellWidth: 38 }, 2: { cellWidth: 20, halign: 'right' }, 3: { cellWidth: 11, halign: 'right' },
      4: { cellWidth: 14 }, 5: { cellWidth: 23, halign: 'center' }, 6: { cellWidth: 18, halign: 'center' }, 7: { halign: 'right' },
    },
    margin: { left: 10, right: 10 },
  })

  // Totaux : le total à payer est le montant de la facture (ou de l'avoir) ;
  // l'écart éventuel avec HT + TVA correspond aux autres taxes.
  const totalAPayer = avoir ? Number(avoir.montant) : Number(vente.total_initial ?? vente.total)
  const totalTtc = totalHt + totalTva
  const autres = avoir
    ? Math.max(totalAPayer - totalTtc, 0)
    : (autresTaxes || []).reduce((s, tx) => s + Number(tx.montant || 0), 0) || Math.max(totalAPayer - totalTtc, 0)
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY,
    body: [
      ['TOTAL HT', fmt(totalHt)],
      ['TVA', fmt(totalTva)],
      ['TOTAL TTC', fmt(totalTtc)],
      ['AUTRES TAXES', fmt(autres)],
      [avoir ? "MONTANT DE L'AVOIR" : 'TOTAL A PAYER', fmt(totalAPayer)],
    ],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, textColor: 0, lineColor: 0, lineWidth: 0.2, halign: 'right' },
    columnStyles: { 0: { cellWidth: 72 }, 1: { cellWidth: 40, fontStyle: 'bold' } },
    margin: { left: L - 10 - 112, right: 10 },
  })

  // Résumé de la facture, par catégorie de taxe.
  let yr = doc.lastAutoTable.finalY + 9
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.text(avoir ? "RESUME DE L'AVOIR" : 'RESUME DE LA FACTURE', 11, yr)
  doc.setFont('helvetica', 'normal')
  autoTable(doc, {
    startY: yr + 2,
    head: [['CATEGORIE', 'SOUS-TOTAL', 'TAUX (%)', 'TOTAL TAXES']],
    body: Object.entries(parCategorie).map(([code, c]) => [CATEGORIES_TVA[code].libelle, fmt(c.ht), `${CATEGORIES_TVA[code].taux}%`, fmt(c.tva)]),
    theme: 'plain',
    styles: { fontSize: 8, cellPadding: 2, textColor: 0 },
    headStyles: { fontStyle: 'bold', lineWidth: { top: 0.3, bottom: 0.3 }, lineColor: 0 },
    bodyStyles: { lineWidth: { bottom: 0.2 }, lineColor: 0 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'center' }, 3: { halign: 'right' } },
    didParseCell: (d) => { if (d.section === 'head') d.cell.styles.halign = ['left', 'right', 'center', 'right'][d.column.index] },
    margin: { left: 10, right: 10 },
  })

  // Montant en lettres.
  const nomDevise = DEVISES[deviseCourante()]?.nom || 'francs CFA'
  doc.setFontSize(8.5)
  doc.text(doc.splitTextToSize(`${avoir ? 'Arrêté le présent avoir' : 'Arrêtée la présente facture'} à la somme de : ${montantEnLettresAvecDevise(totalAPayer, nomDevise)}.`, 190), 10, doc.lastAutoTable.finalY + 8)
  return doc
}
