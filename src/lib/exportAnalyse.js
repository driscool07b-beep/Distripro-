import jsPDF from 'jspdf'
import { ecrireEnTeteEntreprise } from './export'

// Découpe le texte d'une analyse IA en blocs simples :
// titres (**Titre** seul sur sa ligne, ou # Titre), puces (- / • / *) et paragraphes.
// Le gras en ligne (**mot**) est conservé sous forme de segments.
export function analyserTexte(contenu) {
  const blocs = []
  ;(contenu || '').replace(/[\u202F\u00A0]/g, ' ').split('\n').forEach((brute) => {
    const ligne = brute.trim()
    if (!ligne) return
    const titre = ligne.match(/^#{1,4}\s+(.*)$/) || ligne.match(/^\*\*(.+?)\*\*\s*:?\s*$/)
    if (titre) {
      blocs.push({ type: 'titre', texte: titre[1].replace(/\*\*/g, '').trim() })
      return
    }
    const puce = ligne.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/)
    if (puce) {
      blocs.push({ type: 'puce', segments: segments(puce[1]) })
      return
    }
    blocs.push({ type: 'paragraphe', segments: segments(ligne) })
  })
  return blocs
}

function segments(texte) {
  return texte.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((s) =>
    s.startsWith('**') && s.endsWith('**') ? { texte: s.slice(2, -2), gras: true } : { texte: s, gras: false }
  )
}

const texteBrut = (segs) => segs.map((s) => s.texte).join('')

function nomFichier(date) {
  return `analyse-ia-${new Date(date).toISOString().split('T')[0]}`
}

export function exporterAnalysePDF({ entreprise, analyse, titre, sousTitre }) {
  const doc = new jsPDF()
  const largeur = doc.internal.pageSize.getWidth() - 28
  const hauteurPage = doc.internal.pageSize.getHeight()
  let y = ecrireEnTeteEntreprise(doc, entreprise)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(10, 31, 38)
  doc.text(titre, 14, y + 4)
  y += 10
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(110)
  doc.text(sousTitre, 14, y)
  y += 4
  doc.setDrawColor(214, 148, 40)
  doc.setLineWidth(0.8)
  doc.line(14, y, 40, y)
  y += 8

  const saut = (h) => {
    if (y + h > hauteurPage - 16) {
      doc.addPage()
      y = 18
    }
  }

  analyserTexte(analyse.contenu).forEach((b) => {
    if (b.type === 'titre') {
      y += 3
      saut(12)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.setTextColor(10, 31, 38)
      doc.splitTextToSize(b.texte, largeur).forEach((l) => { saut(6); doc.text(l, 14, y); y += 6 })
      y += 1
      return
    }
    const retrait = b.type === 'puce' ? 6 : 0
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(40)
    const lignes = doc.splitTextToSize(texteBrut(b.segments), largeur - retrait)
    lignes.forEach((l, i) => {
      saut(5.2)
      if (b.type === 'puce' && i === 0) doc.text('•', 15, y)
      doc.text(l, 14 + retrait, y)
      y += 5.2
    })
    y += 1.8
  })

  const nbPages = doc.getNumberOfPages()
  for (let i = 1; i <= nbPages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(`${entreprise?.nom || ''} — ${titre} — ${i}/${nbPages}`, 14, hauteurPage - 8)
  }
  doc.save(`${nomFichier(analyse.created_at)}.pdf`)
}

export async function exporterAnalyseWord({ entreprise, analyse, titre, sousTitre }) {
  // Chargée seulement au clic, pour ne pas alourdir l'application.
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, BorderStyle } = await import('docx')
  const enfants = [
    new Paragraph({ children: [new TextRun({ text: entreprise?.nom || '', bold: true, size: 28, color: '0A1F26' })] }),
    new Paragraph({ text: titre, heading: HeadingLevel.TITLE, spacing: { before: 200 } }),
    new Paragraph({
      children: [new TextRun({ text: sousTitre, italics: true, color: '6E6E6E', size: 18 })],
      border: { bottom: { color: 'D69428', size: 12, style: BorderStyle.SINGLE, space: 6 } },
      spacing: { after: 240 },
    }),
  ]
  analyserTexte(analyse.contenu).forEach((b) => {
    if (b.type === 'titre') {
      enfants.push(new Paragraph({ text: b.texte, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 } }))
      return
    }
    const runs = b.segments.map((s) => new TextRun({ text: s.texte, bold: s.gras }))
    enfants.push(
      b.type === 'puce'
        ? new Paragraph({ children: runs, bullet: { level: 0 }, spacing: { after: 60 } })
        : new Paragraph({ children: runs, spacing: { after: 120 } })
    )
  })
  const document = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children: enfants }],
  })
  const blob = await Packer.toBlob(document)
  const url = URL.createObjectURL(blob)
  const lien = window.document.createElement('a')
  lien.href = url
  lien.download = `${nomFichier(analyse.created_at)}.docx`
  window.document.body.appendChild(lien)
  lien.click()
  lien.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
