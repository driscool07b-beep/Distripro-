// @ts-nocheck — le générateur PowerPoint est en JavaScript simple (testé sous Deno).
// supabase/functions/rapport-activite/index.ts
// Edge Function : rapport d'activité commerciale en PowerPoint.
//  - mode « manuel » : l'utilisateur connecté choisit une période ; il reçoit
//    le fichier .pptx (dans la limite de ses droits : un commercial n'a que
//    sa propre activité).
//  - mode « mensuel » : appelé le 1er du mois par la planification (pg_cron),
//    avec le secret partagé ; pour chaque entreprise ayant activé l'option,
//    le rapport du mois écoulé est envoyé par email (pièce jointe) à la direction.
// Les chiffres viennent de la base ; l'IA ne rédige que les commentaires.
// Secrets utilisés (déjà configurés) : ANTHROPIC_API_KEY, RESEND_API_KEY, RESEND_FROM.

import { createClient } from 'npm:@supabase/supabase-js@2'
import PptxGen from 'npm:pptxgenjs@4.0.1'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-rapport-secret',
}
const reponse = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
const MODELE = 'claude-sonnet-5'

// ===== DEBUT GENERATEUR PPTX =====
// Construit la présentation du rapport d'activité (pptxgenjs).
// Entrées : donnees (rapport_activite_donnees), commentaires (rédigés par
// l'IA), entreprise { nom, devise }. Retourne l'instance pptxgenjs.
function construireRapportPptx(PptxGen, donnees, commentaires, entreprise) {
  const C = {
    nuit: '0C2B34', petrole: '145161', lagune: '3E8E96', ambre: 'E3A437', sable: 'F1DDB5',
    fond: 'F7F4EE', texte: '1F2D33', gris: '6B7F86', ligne: 'DCD6CA', blanc: 'FFFFFF',
    hausse: '2E7D4F', baisse: 'B4441F',
  }
  const TITRE = 'Cambria'
  const CORPS = 'Calibri'
  const devise = entreprise?.devise === 'XOF' || !entreprise?.devise ? 'F CFA' : entreprise.devise
  const nb = (n) => Math.round(Number(n || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const fcfa = (n) => `${nb(n)} ${devise}`
  const court = (n) => {
    const v = Number(n || 0)
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1).replace('.', ',')} Md`
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')} M`
    if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3)} k`
    return nb(v)
  }
  const dateFr = (iso) => { const [a, m, j] = String(iso).split('-'); return `${j}/${m}/${a}` }
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
  const libelleCle = (cle) => {
    const p = String(cle).split('-')
    return p.length === 2 ? `${MOIS[Number(p[1]) - 1]} ${p[0].slice(2)}` : `${p[2]}/${p[1]}`
  }
  const variation = (actuel, precedent) => {
    if (!Number(precedent)) return null
    return ((Number(actuel) - Number(precedent)) / Number(precedent)) * 100
  }
  const tronquer = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''))

  const pres = new PptxGen()
  pres.layout = 'LAYOUT_16x9' // 10 x 5.625 pouces
  pres.title = `Rapport d'activité — ${entreprise?.nom || ''}`
  pres.company = entreprise?.nom || ''
  pres.author = 'DistribPro'

  const periodeTexte = `du ${dateFr(donnees.periode.debut)} au ${dateFr(donnees.periode.fin)}`
  const s = donnees.synthese || {}
  const com = commentaires || {}
  let numero = 0

  // Motif récurrent : le « point de vente » (anneau ambré) de l'identité DistribPro.
  const pointDeVente = (slide, x, y, r, sur = 'clair') => {
    slide.addShape(pres.shapes.OVAL, { x: x - r, y: y - r, w: r * 2, h: r * 2, fill: { color: C.ambre, transparency: 100 }, line: { color: C.ambre, width: 1.25, transparency: sur === 'sombre' ? 30 : 0 } })
    slide.addShape(pres.shapes.OVAL, { x: x - r * 0.42, y: y - r * 0.42, w: r * 0.84, h: r * 0.84, fill: { color: C.ambre }, line: { color: C.ambre, width: 0 } })
  }

  // Gabarit des diapositives de contenu.
  const nouvelleDiapo = (titre, sousTitre) => {
    numero += 1
    const slide = pres.addSlide()
    slide.background = { color: C.fond }
    pointDeVente(slide, 0.62, 0.62, 0.13)
    slide.addText(titre, { x: 0.9, y: 0.38, w: 8.2, h: 0.5, fontFace: TITRE, fontSize: 24, bold: true, color: C.nuit, margin: 0, isTextBox: true })
    if (sousTitre) slide.addText(sousTitre, { x: 0.9, y: 0.86, w: 8.2, h: 0.3, fontFace: CORPS, fontSize: 11, color: C.gris, margin: 0, isTextBox: true })
    slide.addText(`${entreprise?.nom || ''}  ·  ${periodeTexte}`, { x: 0.5, y: 5.22, w: 7.5, h: 0.25, fontFace: CORPS, fontSize: 8, color: C.gris, margin: 0, isTextBox: true })
    slide.addText(String(numero + 1), { x: 9.0, y: 5.22, w: 0.5, h: 0.25, fontFace: CORPS, fontSize: 8, color: C.gris, align: 'right', margin: 0, isTextBox: true })
    return slide
  }

  // Encadré de commentaire de l'IA (colonne droite).
  const encadreAnalyse = (slide, texte, x = 6.55, y = 1.35, w = 3.0, h = 3.65) => {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: C.blanc }, line: { color: C.ligne, width: 0.75 } })
    slide.addText('ANALYSE', { x: x + 0.2, y: y + 0.18, w: w - 0.4, h: 0.25, fontFace: CORPS, fontSize: 9, bold: true, color: C.ambre, charSpacing: 2, margin: 0, isTextBox: true })
    slide.addText(texte || '—', { x: x + 0.2, y: y + 0.5, w: w - 0.4, h: h - 0.7, fontFace: CORPS, fontSize: 11.5, color: C.texte, valign: 'top', margin: 0, paraSpaceAfter: 4, isTextBox: true })
  }

  const messageVide = (slide, texte) => {
    slide.addText(texte, { x: 0.9, y: 2.4, w: 5.4, h: 0.8, fontFace: CORPS, fontSize: 14, color: C.gris, italic: true, margin: 0, isTextBox: true })
  }

  const optionsBarres = (titre, couleurs, horizontal = false) => ({
    barDir: horizontal ? 'bar' : 'col',
    showTitle: !!titre, title: titre, titleFontFace: CORPS, titleFontSize: 11, titleColor: C.gris,
    chartColors: couleurs, showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 8, dataLabelColor: C.texte,
    dataLabelFormatCode: '#,##0', valAxisLabelFormatCode: '#,##0',
    catAxisLabelColor: C.texte, catAxisLabelFontSize: 9, catAxisLabelFontFace: CORPS,
    // Montants écrits sur les barres : l'axe des valeurs est inutile.
    valAxisHidden: true, valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
    showLegend: false, barGapWidthPct: 45,
  })

  // ---------------------------------------------------------------- 1. Couverture
  {
    const slide = pres.addSlide()
    slide.background = { color: C.nuit }
    // Réseau de tournées stylisé (motif de l'identité).
    const hub = { x: 7.55, y: 2.75 }
    const points = [[6.2, 1.2], [8.9, 1.0], [9.35, 2.6], [8.7, 4.4], [6.6, 4.55], [5.7, 2.9]]
    points.forEach(([px, py], i) => {
      slide.addShape(pres.shapes.LINE, { x: Math.min(hub.x, px), y: Math.min(hub.y, py), w: Math.abs(px - hub.x) || 0.01, h: Math.abs(py - hub.y) || 0.01,
        flipH: (px < hub.x) !== (py < hub.y), line: { color: i % 2 ? C.lagune : C.ambre, width: i % 2 ? 1 : 2, dashType: i % 2 ? 'dash' : 'solid', transparency: 15 } })
    })
    points.forEach(([px, py]) => pointDeVente(slide, px, py, 0.14, 'sombre'))
    slide.addShape(pres.shapes.OVAL, { x: hub.x - 0.32, y: hub.y - 0.32, w: 0.64, h: 0.64, fill: { color: C.ambre }, line: { color: C.sable, width: 2 } })
    slide.addText(entreprise?.nom || '', { x: 0.6, y: 1.25, w: 5.2, h: 0.5, fontFace: CORPS, fontSize: 16, color: C.sable, bold: true, margin: 0, isTextBox: true })
    slide.addText("Rapport d'activité commerciale", { x: 0.6, y: 1.8, w: 5.3, h: 1.3, fontFace: TITRE, fontSize: 36, bold: true, color: C.blanc, valign: 'top', margin: 0, isTextBox: true })
    slide.addText(periodeTexte.charAt(0).toUpperCase() + periodeTexte.slice(1), { x: 0.6, y: 3.25, w: 5.2, h: 0.4, fontFace: CORPS, fontSize: 16, color: C.ambre, margin: 0, isTextBox: true })
    slide.addText(donnees.periode.perimetre === 'commercial' ? 'Activité personnelle' : 'Toute l\'entreprise', { x: 0.6, y: 3.7, w: 5.2, h: 0.3, fontFace: CORPS, fontSize: 11, color: C.sable, margin: 0, isTextBox: true })
    slide.addText(`Généré par DistribPro le ${new Date().toLocaleDateString('fr-FR')}`, { x: 0.6, y: 4.9, w: 5.2, h: 0.3, fontFace: CORPS, fontSize: 9, color: C.lagune, margin: 0, isTextBox: true })
  }

  // ---------------------------------------------------------------- 2. Synthèse
  {
    const slide = nouvelleDiapo('Synthèse de la période', `Comparaison avec la période précédente (${dateFr(donnees.periode.debut_precedente)} – ${dateFr(donnees.periode.fin_precedente)})`)
    const panier = s.nb_ventes ? s.ca / s.nb_ventes : 0
    const panierPrec = s.nb_ventes_precedent ? s.ca_precedent / s.nb_ventes_precedent : 0
    const cartes = [
      { label: "Chiffre d'affaires", valeur: court(s.ca), unite: devise, v: variation(s.ca, s.ca_precedent) },
      { label: 'Ventes', valeur: nb(s.nb_ventes), unite: `${nb(s.nb_clients_actifs)} clients actifs`, v: variation(s.nb_ventes, s.nb_ventes_precedent) },
      { label: 'Panier moyen', valeur: court(panier), unite: devise, v: variation(panier, panierPrec) },
      { label: 'Encaissé', valeur: court(s.encaisse), unite: s.ca ? `${Math.round((s.encaisse / s.ca) * 100)} % du CA` : devise, v: null },
    ]
    cartes.forEach((c, i) => {
      const x = 0.5 + i * 2.3
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.35, w: 2.1, h: 1.55, rectRadius: 0.08, fill: { color: i === 0 ? C.nuit : C.blanc }, line: { color: i === 0 ? C.nuit : C.ligne, width: 0.75 } })
      slide.addText(c.label.toUpperCase(), { x: x + 0.15, y: 1.47, w: 1.8, h: 0.22, fontFace: CORPS, fontSize: 8.5, bold: true, color: i === 0 ? C.ambre : C.gris, charSpacing: 1, margin: 0, isTextBox: true })
      slide.addText(c.valeur, { x: x + 0.15, y: 1.72, w: 1.8, h: 0.62, fontFace: TITRE, fontSize: 30, bold: true, color: i === 0 ? C.blanc : C.nuit, margin: 0, isTextBox: true })
      slide.addText(c.unite, { x: x + 0.15, y: 2.33, w: 1.8, h: 0.22, fontFace: CORPS, fontSize: 9, color: i === 0 ? C.sable : C.gris, margin: 0, isTextBox: true })
      if (c.v != null) {
        const hausse = c.v >= 0
        slide.addText(`${hausse ? '▲' : '▼'} ${Math.abs(c.v).toFixed(1).replace('.', ',')} %`, { x: x + 0.15, y: 2.57, w: 1.8, h: 0.22, fontFace: CORPS, fontSize: 9.5, bold: true, color: hausse ? (i === 0 ? '7FD6A4' : C.hausse) : (i === 0 ? 'F2A07B' : C.baisse), margin: 0, isTextBox: true })
      }
    })
    slide.addText('FAITS MARQUANTS', { x: 0.5, y: 3.15, w: 9, h: 0.25, fontFace: CORPS, fontSize: 9, bold: true, color: C.ambre, charSpacing: 2, margin: 0, isTextBox: true })
    const faits = (com.faits_marquants || []).slice(0, 4)
    slide.addText(faits.length ? faits.map((f, i) => ({ text: f, options: { bullet: true, breakLine: i < faits.length - 1 } })) : [{ text: 'Aucun fait marquant.' }],
      { x: 0.5, y: 3.45, w: 9, h: 1.65, fontFace: CORPS, fontSize: 12.5, color: C.texte, valign: 'top', margin: 0, paraSpaceAfter: 5, isTextBox: true })
  }

  // ---------------------------------------------------------------- 3. Évolution
  {
    const evo = donnees.evolution || []
    const slide = nouvelleDiapo("Évolution du chiffre d'affaires", donnees.periode.granularite === 'mois' ? 'Par mois' : 'Par jour')
    if (!evo.length) messageVide(slide, 'Aucune vente sur la période.')
    else {
      // Beaucoup de jours : une date sur cinq (et la dernière), pour la lisibilité.
      const espacer = evo.length > 15
      const serie = [{
        name: "Chiffre d'affaires",
        labels: evo.map((e, i) => (!espacer || i % 5 === 0 || i === evo.length - 1 ? libelleCle(e.cle) : '')),
        values: evo.map((e) => Number(e.montant)),
      }]
      const peu = evo.length <= 12
      const options = peu
        ? optionsBarres('', [C.petrole])
        : { chartColors: [C.ambre], lineSize: 2.5, lineDataSymbol: 'circle', lineDataSymbolSize: 5, showValue: false,
            catAxisLabelColor: C.texte, catAxisLabelFontSize: 8, valAxisLabelColor: C.gris, valAxisLabelFontSize: 8, valAxisLabelFormatCode: '#,##0',
            valGridLine: { color: 'E6E1D6', size: 0.5 }, catGridLine: { style: 'none' }, showLegend: false,
            // Une date sur cinq quand il y a beaucoup de points (lisibilité).
            catAxisLabelFrequency: evo.length > 15 ? 5 : 1 }
      slide.addChart(peu ? pres.charts.BAR : pres.charts.LINE, serie, { ...options, x: 0.5, y: 1.35, w: 5.85, h: 3.65 })
    }
    encadreAnalyse(slide, com.evolution)
  }

  // Graphique en barres horizontales « top N » + analyse.
  const diapoClassement = (titre, sousTitre, lignes, nomCle, couleur, texte, vide) => {
    const slide = nouvelleDiapo(titre, sousTitre)
    if (!lignes.length) messageVide(slide, vide)
    else {
      const l = lignes.slice(0, 8).reverse()
      slide.addChart(pres.charts.BAR, [{ name: titre, labels: l.map((x) => tronquer(x[nomCle], 26)), values: l.map((x) => Number(x.montant)) }],
        { ...optionsBarres('', [couleur], true), x: 0.5, y: 1.3, w: 5.85, h: 3.75 })
    }
    encadreAnalyse(slide, texte)
    return slide
  }

  // ---------------------------------------------------------------- 4. Clients
  diapoClassement('Meilleurs clients', `Chiffre d'affaires TTC (${devise})`, donnees.top_clients || [], 'nom', C.petrole, com.clients, 'Aucune vente sur la période.')

  // ---------------------------------------------------------------- 5. Produits
  diapoClassement('Produits les plus vendus', `Chiffre d'affaires HT (${devise})`, donnees.top_produits || [], 'nom', C.ambre, com.produits, 'Aucune vente sur la période.')

  // ---------------------------------------------------------------- 6. Commerciaux
  if (donnees.periode.perimetre === 'entreprise') {
    const lignes = (donnees.commerciaux || []).slice(0, 8)
    const slide = nouvelleDiapo('Performance des commerciaux', lignes.some((c) => Number(c.objectif) > 0) ? 'Réalisé et objectif de la période' : `Chiffre d'affaires TTC (${devise})`)
    if (!lignes.length) messageVide(slide, 'Aucune vente sur la période.')
    else {
      const labels = lignes.map((c) => tronquer(c.nom, 20))
      const series = [{ name: 'Réalisé', labels, values: lignes.map((c) => Number(c.montant)) }]
      const avecObjectif = lignes.some((c) => Number(c.objectif) > 0)
      if (avecObjectif) series.push({ name: 'Objectif', labels, values: lignes.map((c) => Number(c.objectif || 0)) })
      slide.addChart(pres.charts.BAR, series, {
        ...optionsBarres('', avecObjectif ? [C.petrole, C.sable] : [C.petrole]),
        showLegend: avecObjectif, legendPos: 'b', legendFontSize: 9, legendColor: C.texte,
        x: 0.5, y: 1.3, w: 5.85, h: 3.75,
      })
    }
    encadreAnalyse(slide, com.commerciaux)
  }

  // ---------------------------------------------------------------- 7. Magasins
  {
    const lignes = (donnees.magasins || []).filter((m) => Number(m.montant) > 0)
    const slide = nouvelleDiapo('Répartition des ventes', 'Par magasin et stock terrain des commerciaux')
    if (!lignes.length) messageVide(slide, 'Aucune vente sur la période.')
    else {
      slide.addChart(pres.charts.DOUGHNUT, [{ name: 'Ventes', labels: lignes.map((m) => tronquer(m.nom, 28)), values: lignes.map((m) => Number(m.montant)) }], {
        x: 0.5, y: 1.3, w: 5.85, h: 3.75, holeSize: 58,
        chartColors: [C.petrole, C.ambre, C.lagune, C.sable, '8A6A3A', '9FB8BC'],
        showPercent: true, showValue: false, dataLabelColor: C.blanc, dataLabelFontSize: 10,
        showLegend: true, legendPos: 'r', legendFontSize: 10, legendColor: C.texte, legendFontFace: CORPS,
      })
    }
    encadreAnalyse(slide, com.magasins)
  }

  // ---------------------------------------------------------------- 8. Créances
  {
    const cr = donnees.creances || {}
    const slide = nouvelleDiapo('Créances clients', 'Situation au jour du rapport')
    const kpis = [
      { label: 'Encours total', valeur: court(cr.total), sombre: true },
      { label: 'Dont échu', valeur: court(cr.echues) },
      { label: 'Factures échues', valeur: nb(cr.nb_factures_echues) },
    ]
    kpis.forEach((k, i) => {
      const x = 0.5 + i * 2.0
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.35, w: 1.85, h: 1.05, rectRadius: 0.08, fill: { color: k.sombre ? C.nuit : C.blanc }, line: { color: k.sombre ? C.nuit : C.ligne, width: 0.75 } })
      slide.addText(k.label.toUpperCase(), { x: x + 0.12, y: 1.45, w: 1.65, h: 0.22, fontFace: CORPS, fontSize: 8, bold: true, color: k.sombre ? C.ambre : C.gris, charSpacing: 1, margin: 0, isTextBox: true })
      slide.addText(k.valeur, { x: x + 0.12, y: 1.7, w: 1.65, h: 0.55, fontFace: TITRE, fontSize: 24, bold: true, color: k.sombre ? C.blanc : (i === 1 && Number(cr.echues) > 0 ? C.baisse : C.nuit), margin: 0, isTextBox: true })
    })
    const top = (cr.top || []).slice(0, 6)
    if (top.length) {
      const entete = ['Client', 'Reste dû', 'Retard'].map((t, i) => ({ text: t, options: { bold: true, color: C.blanc, fill: { color: C.petrole }, align: i ? 'right' : 'left' } }))
      const corps = top.map((t) => [
        { text: tronquer(t.client, 30) },
        { text: fcfa(t.reste), options: { align: 'right' } },
        { text: Number(t.jours) > 0 ? `${t.jours} j` : 'à échoir', options: { align: 'right', color: Number(t.jours) > 30 ? C.baisse : C.texte } },
      ])
      slide.addTable([entete, ...corps], { x: 0.5, y: 2.6, w: 5.85, colW: [3.0, 1.85, 1.0], fontFace: CORPS, fontSize: 10, color: C.texte, border: { type: 'solid', color: C.ligne, pt: 0.5 }, fill: { color: C.blanc }, rowH: 0.3, margin: 0.06 })
    } else messageVide(slide, 'Aucune créance en cours.')
    encadreAnalyse(slide, com.creances)
  }

  // ---------------------------------------------------------------- 9. Stock
  if (donnees.periode.perimetre === 'entreprise') {
    const st = donnees.stock || {}
    const slide = nouvelleDiapo('Stock', 'Ruptures, alertes et marchandise chez les commerciaux')
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.35, w: 2.8, h: 1.05, rectRadius: 0.08, fill: { color: C.blanc }, line: { color: C.ligne, width: 0.75 } })
    slide.addText('PRODUITS EN ALERTE', { x: 0.62, y: 1.45, w: 2.6, h: 0.22, fontFace: CORPS, fontSize: 8, bold: true, color: C.gris, charSpacing: 1, margin: 0, isTextBox: true })
    slide.addText(nb(st.nb_alertes), { x: 0.62, y: 1.7, w: 2.6, h: 0.55, fontFace: TITRE, fontSize: 24, bold: true, color: Number(st.nb_alertes) > 0 ? C.baisse : C.hausse, margin: 0, isTextBox: true })
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.5, y: 1.35, w: 2.85, h: 1.05, rectRadius: 0.08, fill: { color: C.nuit }, line: { color: C.nuit, width: 0.75 } })
    slide.addText('STOCK CHEZ LES COMMERCIAUX', { x: 3.62, y: 1.45, w: 2.65, h: 0.22, fontFace: CORPS, fontSize: 8, bold: true, color: C.ambre, charSpacing: 1, margin: 0, isTextBox: true })
    slide.addText(court(st.valeur_terrain), { x: 3.62, y: 1.7, w: 2.65, h: 0.55, fontFace: TITRE, fontSize: 24, bold: true, color: C.blanc, margin: 0, isTextBox: true })
    const alertes = (st.alertes || []).slice(0, 6)
    if (alertes.length) {
      const entete = ['Produit', 'Stock', 'Seuil'].map((t, i) => ({ text: t, options: { bold: true, color: C.blanc, fill: { color: C.petrole }, align: i ? 'right' : 'left' } }))
      const corps = alertes.map((a) => [
        { text: tronquer(a.produit, 34) },
        { text: nb(a.quantite), options: { align: 'right', color: Number(a.quantite) <= 0 ? C.baisse : C.texte, bold: Number(a.quantite) <= 0 } },
        { text: nb(a.seuil), options: { align: 'right' } },
      ])
      slide.addTable([entete, ...corps], { x: 0.5, y: 2.6, w: 5.85, colW: [3.85, 1.0, 1.0], fontFace: CORPS, fontSize: 10, color: C.texte, border: { type: 'solid', color: C.ligne, pt: 0.5 }, fill: { color: C.blanc }, rowH: 0.3, margin: 0.06 })
    } else messageVide(slide, 'Aucun produit sous le seuil d\'alerte.')
    encadreAnalyse(slide, com.stock)
  }

  // ---------------------------------------------------------------- 10. Recommandations
  {
    numero += 1
    const slide = pres.addSlide()
    slide.background = { color: C.nuit }
    pointDeVente(slide, 0.62, 0.62, 0.13, 'sombre')
    slide.addText('Recommandations', { x: 0.9, y: 0.38, w: 8.2, h: 0.55, fontFace: TITRE, fontSize: 26, bold: true, color: C.blanc, margin: 0, isTextBox: true })
    const recos = (com.recommandations || []).slice(0, 4)
    recos.forEach((r, i) => {
      const y = 1.3 + i * 0.95
      slide.addShape(pres.shapes.OVAL, { x: 0.6, y, w: 0.5, h: 0.5, fill: { color: C.ambre }, line: { color: C.ambre, width: 0 } })
      slide.addText(String(i + 1), { x: 0.6, y, w: 0.5, h: 0.5, fontFace: TITRE, fontSize: 16, bold: true, color: C.nuit, align: 'center', valign: 'middle', margin: 0, isTextBox: true })
      slide.addText(r, { x: 1.35, y: y - 0.06, w: 8.1, h: 0.75, fontFace: CORPS, fontSize: 13, color: C.blanc, valign: 'middle', margin: 0, isTextBox: true })
    })
    if (!recos.length) slide.addText('—', { x: 1.35, y: 1.3, w: 8, h: 0.5, fontFace: CORPS, fontSize: 13, color: C.sable, margin: 0, isTextBox: true })
    slide.addText('Analyse rédigée par l\'IA à partir des données de DistribPro — à vérifier avant toute décision importante.', { x: 0.6, y: 5.12, w: 8.8, h: 0.3, fontFace: CORPS, fontSize: 8.5, italic: true, color: C.lagune, margin: 0, isTextBox: true })
  }

  return pres
}
// ===== FIN GENERATEUR PPTX =====

// Commentaires rédigés par l'IA à partir des chiffres (jamais l'inverse).
async function rediger(donnees: any, entreprise: any, anthropicKey: string | undefined) {
  const vide = { faits_marquants: [], recommandations: [] }
  if (!anthropicKey) return { commentaires: vide, usage: null }
  const consigne = `Tu es analyste commercial pour « ${entreprise?.nom || ''} », distributeur en Côte d'Ivoire (montants en F CFA).
Voici les données EXACTES d'un rapport d'activité (JSON). Rédige les commentaires d'une présentation de direction.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, avec ces clés :
{"faits_marquants": [3 à 4 phrases courtes], "evolution": "…", "clients": "…", "produits": "…", "commerciaux": "…", "magasins": "…", "creances": "…", "stock": "…", "recommandations": [3 à 4 actions concrètes]}
Règles : n'utilise QUE les chiffres fournis (aucune invention) ; chaque commentaire fait au plus 300 caractères ; ton factuel et utile ;
chiffres arrondis avec espaces de milliers (ex. 1 250 000 F CFA ou 1,25 M F CFA) ; si une section est vide, dis-le simplement.
Le périmètre « commercial » concerne un seul commercial (pas de comparaison entre commerciaux).
Données : ${JSON.stringify(donnees)}`
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODELE, max_tokens: 1800, messages: [{ role: 'user', content: consigne }] }),
    })
    if (!r.ok) return { commentaires: vide, usage: null }
    const res = await r.json()
    const texte = (res.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    const json = texte.slice(texte.indexOf('{'), texte.lastIndexOf('}') + 1)
    return { commentaires: JSON.parse(json), usage: res.usage }
  } catch {
    return { commentaires: vide, usage: null }
  }
}

async function consommation(supabase: any, entrepriseId: string, profilId: string | null, usage: any) {
  if (!usage) return
  try {
    const entree = Number(usage.input_tokens || 0)
    const sortie = Number(usage.output_tokens || 0)
    const { data: tarif } = await supabase.from('tarifs_ia').select('*').eq('modele', MODELE).maybeSingle()
    const cout = tarif ? (entree * Number(tarif.prix_entree_usd_par_million) + sortie * Number(tarif.prix_sortie_usd_par_million)) / 1_000_000 : 0
    await supabase.from('consommation_ia').insert({
      entreprise_id: entrepriseId, profil_id: profilId, fonction: 'rapport_activite',
      modele: MODELE, tokens_entree: entree, tokens_sortie: sortie, cout_usd: cout,
    })
  } catch (_) { /* jamais bloquant */ }
}

async function genererFichier(donnees: any, entreprise: any, anthropicKey: string | undefined) {
  const { commentaires, usage } = await rediger(donnees, entreprise, anthropicKey)
  const pres = construireRapportPptx(PptxGen, donnees, commentaires, entreprise)
  const base64 = await pres.write({ outputType: 'base64' }) as string
  return { base64, usage }
}

const nomFichier = (entreprise: any, debut: string, fin: string) =>
  `rapport-activite-${String(entreprise?.nom || 'entreprise').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${debut}-au-${fin}.pptx`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const corps = await req.json().catch(() => ({}))

    // ------------------------------------------------ rapport mensuel planifié
    if (corps.mode === 'mensuel') {
      const { data: secret } = await supabase.from('plateforme_secrets').select('valeur').eq('cle', 'rapport_mensuel').maybeSingle()
      if (!secret?.valeur || req.headers.get('x-rapport-secret') !== secret.valeur) return reponse({ error: 'accès refusé' }, 403)
      const resendApiKey = Deno.env.get('RESEND_API_KEY')
      if (!resendApiKey) return reponse({ error: 'RESEND_API_KEY manquant' }, 500)

      // Mois écoulé (heure d'Abidjan = UTC).
      const maintenant = new Date()
      const debutMois = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - 1, 1))
      const finMois = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 0))
      const debut = debutMois.toISOString().slice(0, 10)
      const fin = finMois.toISOString().slice(0, 10)
      const libelleMois = debutMois.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })

      const { data: entreprises } = await supabase.from('entreprises')
        .select('id, nom, devise, email, rapport_mensuel_destinataires').eq('rapport_mensuel_actif', true)
      const bilan: any[] = []
      for (const e of entreprises || []) {
        try {
          // Destinataires : liste paramétrée, sinon administrateurs et managers actifs.
          let destinataires = String(e.rapport_mensuel_destinataires || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean)
          if (!destinataires.length) {
            const { data: dirigeants } = await supabase.from('profils').select('id').eq('entreprise_id', e.id).in('role', ['admin', 'manager']).neq('actif', false)
            for (const d of dirigeants || []) {
              const { data: u } = await supabase.auth.admin.getUserById(d.id)
              if (u?.user?.email) destinataires.push(u.user.email)
            }
          }
          if (!destinataires.length) throw new Error('aucun destinataire')

          const { data: donnees, error } = await supabase.rpc('rapport_activite_donnees', { p_entreprise_id: e.id, p_debut: debut, p_fin: fin, p_commercial_id: null })
          if (error) throw error
          const { base64, usage } = await genererFichier(donnees, e, anthropicKey)
          await consommation(supabase, e.id, null, usage)
          const fichier = nomFichier(e, debut, fin)
          const envoi = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: `DistribPro <${(Deno.env.get('RESEND_FROM') || 'onboarding@resend.dev').replace(/^.*<|>$/g, '')}>`,
              to: destinataires,
              subject: `Rapport d'activité de ${libelleMois} — ${e.nom}`,
              html: `<div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1a2e35;">
                <h2 style="margin-bottom: 4px;">${e.nom}</h2>
                <p>Bonjour,</p>
                <p>Voici le <strong>rapport d'activité commerciale de ${libelleMois}</strong> (présentation PowerPoint jointe) : chiffre d'affaires et évolution, meilleurs clients et produits, performance des commerciaux, créances, stock et recommandations.</p>
                <p style="color: #5b7580; font-size: 12px;">Envoyé automatiquement par DistribPro le 1er de chaque mois. Pour modifier les destinataires ou désactiver cet envoi : Paramètres → Rapport mensuel.</p>
              </div>`,
              attachments: [{ filename: fichier, content: base64 }],
            }),
          })
          if (!envoi.ok) throw new Error(`Resend ${envoi.status}`)
          await supabase.from('rapports_activite').insert({ entreprise_id: e.id, periode_debut: debut, periode_fin: fin, type: 'mensuel', destinataires: destinataires.join(', '), succes: true })
          bilan.push({ entreprise: e.nom, ok: true })
        } catch (err) {
          await supabase.from('rapports_activite').insert({ entreprise_id: e.id, periode_debut: debut, periode_fin: fin, type: 'mensuel', succes: false, erreur: String(err?.message || err).slice(0, 500) })
          bilan.push({ entreprise: e.nom, ok: false, erreur: String(err?.message || err) })
        }
      }
      return reponse({ periode: { debut, fin }, bilan })
    }

    // ------------------------------------------------ rapport à la demande
    const authHeader = req.headers.get('Authorization') || ''
    const supabaseUtilisateur = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userError } = await supabaseUtilisateur.auth.getUser()
    if (userError || !userData?.user) return reponse({ error: 'Utilisateur non authentifié.' }, 401)
    const { data: profil } = await supabase.from('profils').select('id, entreprise_id, actif, ia_active').eq('id', userData.user.id).single()
    if (!profil || profil.actif === false) return reponse({ error: 'Compte inactif.' }, 403)

    const { debut, fin } = corps
    if (!/^\d{4}-\d{2}-\d{2}$/.test(debut || '') || !/^\d{4}-\d{2}-\d{2}$/.test(fin || '')) return reponse({ error: 'Période invalide.' }, 400)
    // Données lues AVEC LES DROITS de l'utilisateur.
    const { data: donnees, error } = await supabaseUtilisateur.rpc('rapport_activite', { p_debut: debut, p_fin: fin })
    if (error) return reponse({ error: error.message }, 400)
    const { data: entreprise } = await supabase.from('entreprises').select('nom, devise').eq('id', profil.entreprise_id).single()
    const { base64, usage } = await genererFichier(donnees, entreprise, profil.ia_active === false ? undefined : anthropicKey)
    await consommation(supabase, profil.entreprise_id, profil.id, usage)
    await supabase.from('rapports_activite').insert({ entreprise_id: profil.entreprise_id, periode_debut: debut, periode_fin: fin, type: 'manuel', succes: true, demande_par: profil.id })
    return reponse({ fichier: base64, nom: nomFichier(entreprise, debut, fin) })
  } catch (e) {
    return reponse({ error: String(e?.message || e) }, 500)
  }
})
