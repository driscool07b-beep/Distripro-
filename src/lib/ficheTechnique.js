// Fiche technique DistribPro (PDF A4) générée dans le navigateur depuis le
// site vitrine : toujours à jour (les tarifs viennent de la Console
// plateforme), sans fichier à maintenir à la main.
// NB : la police Helvetica de jsPDF gère les accents mais pas l'apostrophe
// typographique, les flèches ni les espaces fines : on s'en tient au latin courant.
import jsPDF from 'jspdf'
import { EDITEUR } from './infosEditeur'

const PETROLE = [10, 31, 38]
const PETROLE_CLAIR = [18, 54, 64]
const AMBRE = [232, 168, 60]
const GRIS = [59, 90, 98]

const MODULES = [
  ['Ventes et encaissements', 'Ventes au comptant ou à crédit, taxes calculées, reçus, encaissements partiels et règlements groupés, avoirs.'],
  ['Stock multi-magasins', 'Stock par magasin, lots et dates de péremption (FIFO), inventaires, transferts, justificatifs photo.'],
  ['Commerciaux et tournées', 'Stock en main de chaque commercial, tournées planifiées, visites géolocalisées, rapports de visite, objectifs.'],
  ['Réconciliation', 'Écarts de stock et d\'argent par commercial, dettes suivies, retenues sur salaire encadrées.'],
  ['Commandes et livraisons', 'Commandes clients, préparation au magasin, livraisons partielles, proformas, bons de livraison.'],
  ['Facturation et FNE', 'Reçus et factures A4 ; module de facture normalisée électronique (FNE) de la DGI ; envoi par WhatsApp et e-mail.'],
  ['Caisse, banque, comptabilité', 'Journaux de caisse et de banque, rapprochement bancaire, plan comptable SYSCOHADA, export vers votre logiciel comptable.'],
  ['Pilotage', 'Tableaux de bord par rôle, analyses, carte des clients, rapport d\'activité PowerPoint mensuel.'],
]

const TECHNIQUE = [
  ['Accès', 'Navigateur web sur ordinateur, tablette et téléphone ; installable sur l\'écran d\'accueil (Android, iPhone), sans magasin d\'applications.'],
  ['Hors connexion', 'Les saisies terrain sont conservées sur le téléphone et synchronisées au retour du réseau.'],
  ['Langues', 'Français, anglais, arabe et chinois ; documents dans la langue du client.'],
  ['Sécurité', 'Connexions chiffrées (HTTPS), données de chaque entreprise strictement isolées, droits par rôle, journal des actions sensibles.'],
  ['Assistant IA', 'Saisie par la voix ou en texte : l\'assistant prépare, l\'utilisateur valide. Consommation suivie en unités IA.'],
  ['Reprise des données', 'Import Excel des produits, clients, soldes et comptes clients existants.'],
  ['Vos données', 'Export Excel et PDF à tout moment.'],
]

const fcfa = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/\s/g, ' ')} F CFA`

export function genererFicheTechnique(tarifs = []) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const L = 210
  const marge = 16
  const largeur = L - 2 * marge
  let y = 0

  const enTete = () => {
    doc.setFillColor(...PETROLE)
    doc.rect(0, 0, L, 40, 'F')
    doc.setFillColor(...AMBRE)
    doc.circle(marge + 4, 17, 4, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22)
    doc.text('DistribPro', marge + 11, 19.5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10.5)
    doc.setTextColor(201, 217, 221)
    doc.text('Fiche technique - gestion commerciale et distribution', marge, 31)
    doc.setTextColor(...AMBRE)
    doc.text('distribpro.com', L - marge, 31, { align: 'right' })
    y = 50
  }

  const piedDePage = () => {
    const n = doc.getNumberOfPages()
    for (let i = 1; i <= n; i++) {
      doc.setPage(i)
      doc.setFontSize(8.5)
      doc.setTextColor(...GRIS)
      doc.text(`DistribPro - ${EDITEUR.email} - distribpro.com`, marge, 289)
      doc.text(`Page ${i} / ${n}`, L - marge, 289, { align: 'right' })
    }
  }

  const titre = (texte) => {
    if (y > 255) { doc.addPage(); y = 20 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...PETROLE)
    doc.text(texte, marge, y)
    doc.setDrawColor(...AMBRE)
    doc.setLineWidth(0.8)
    doc.line(marge, y + 2, marge + 18, y + 2)
    y += 9
  }

  const paragraphe = (texte, taille = 10) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(taille)
    doc.setTextColor(...GRIS)
    const lignes = doc.splitTextToSize(texte, largeur)
    doc.text(lignes, marge, y)
    y += lignes.length * (taille * 0.45) + 3
  }

  // Liste « intitulé : description » sur deux colonnes de texte.
  const liste = (elements) => {
    for (const [nom, texte] of elements) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      const lignes = doc.splitTextToSize(texte, largeur - 52)
      const h = Math.max(1, lignes.length) * 4.3 + 2.5
      if (y + h > 280) { doc.addPage(); y = 20 }
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...PETROLE)
      doc.text(doc.splitTextToSize(nom, 48), marge, y)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...GRIS)
      doc.text(lignes, marge + 52, y)
      y += h
    }
    y += 3
  }

  enTete()
  paragraphe('DistribPro est une application de gestion commerciale pensée pour les distributeurs, grossistes et producteurs qui vendent avec une force de vente terrain, en Côte d\'Ivoire et dans l\'espace CEDEAO. Ventes, stock jusque chez le commercial, encaissements, réconciliations et comptabilité sont réunis dans une seule application, avec un assistant IA qui saisit à la voix.', 10.5)
  y += 2

  titre('Modules')
  liste(MODULES)

  titre('Caractéristiques techniques')
  liste(TECHNIQUE)

  if (y + 50 > 280) { doc.addPage(); y = 20 }
  titre('Formules')
  if (tarifs.length) {
    const col = largeur / tarifs.length
    if (y + 34 > 280) { doc.addPage(); y = 20 }
    tarifs.forEach((p, i) => {
      const x = marge + i * col
      doc.setFillColor(...(i === 1 ? PETROLE_CLAIR : [233, 240, 241]))
      doc.roundedRect(x + 1, y - 5, col - 2, 30, 2, 2, 'F')
      const clair = i === 1
      doc.setTextColor(...(clair ? [255, 255, 255] : PETROLE))
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.text(p.nom, x + 5, y + 2)
      doc.setFontSize(13)
      doc.text(`${fcfa(p.prix_mensuel)} / mois`, x + 5, y + 10)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...(clair ? [201, 217, 221] : GRIS))
      doc.text(p.max_commerciaux ? `Jusqu'à ${p.max_commerciaux} commerciaux` : 'Commerciaux illimités', x + 5, y + 16)
      doc.text(`${fcfa(p.prix_annuel)} / an`, x + 5, y + 21)
    })
    y += 32
    const place = tarifs[0]?.prix_place_supp
    paragraphe(`Essai gratuit de 21 jours, sans carte bancaire. Un utilisateur inclus par rôle (administration, comptabilité, magasin...)${place ? `, puis ${fcfa(place)} par mois et par utilisateur supplémentaire` : ''}. Paiement annuel : -20 %.`, 9.5)
  } else {
    paragraphe('Tarifs à jour sur distribpro.com. Essai gratuit de 21 jours, sans carte bancaire.', 9.5)
  }

  titre('Contact')
  paragraphe(`Demande de démonstration, devis ou reprise de vos données : ${EDITEUR.email} - formulaire de contact sur distribpro.com. Essai gratuit : distribpro.com/creer-entreprise`, 10)

  piedDePage()
  doc.save('DistribPro-fiche-technique.pdf')
}
