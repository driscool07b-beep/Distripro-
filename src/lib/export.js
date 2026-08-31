import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

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
