import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { envoyerParEmail, partagerWhatsApp } from '../lib/envoiDocuments'
import { lireConfigFne, certifierVenteFne, emettreAvoirFne, qrCodeFne, visuelFne } from '../lib/fne'
import { useAuth } from '../context/AuthContext'
import { accesAutorise } from '../lib/accesRole'
import { calculerTimbre } from '../lib/fiscalite'
import { exporterExcel, exporterPDF, genererRecuVente, genererBonLivraison, genererFactureAvoir, genererFactureFne, formatMontantPDF, symboleDevise } from '../lib/export'
import SelectRecherche from '../components/SelectRecherche'
import FenetreAvoir from '../components/FenetreAvoir'
import { traduireErreur } from '../lib/erreurs'
import { ajouterActionEnAttente } from '../lib/offline'
import { formatXOF, formatDate } from '../lib/format'
import i18n from '../lib/i18n'

export default function Ventes() {
  const { t } = useTranslation('ventes')
  const { entreprise, profil } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [ventes, setVentes] = useState([])
  const [avoirsListe, setAvoirsListe] = useState([])
  // État fiscal : détail des autres taxes par vente (ventes_taxes) et taxes
  // configurées par l'entreprise (AIRSI…), pour les colonnes de l'état.
  const [taxesParVente, setTaxesParVente] = useState({})
  const [taxesConfigurees, setTaxesConfigurees] = useState([])
  const [clients, setClients] = useState([])
  const [produits, setProduits] = useState([])
  const [commerciaux, setCommerciaux] = useState([])
  const [depots, setDepots] = useState([])
  const [villes, setVilles] = useState([])
  const [chargement, setChargement] = useState(true)
  const [modalOuvert, setModalOuvert] = useState(false)
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState('')

  const [venteOuverte, setVenteOuverte] = useState(null)
  const [modeAnnulation, setModeAnnulation] = useState(false)
  const [detailVente, setDetailVente] = useState(null)
  const [chargementDetail, setChargementDetail] = useState(false)

  const [filtres, setFiltres] = useState({
    periode: searchParams.get('periode') || 'tout',
    dateDebut: '',
    dateFin: '',
    clientId: '',
    ville: '',
    commercialId: '',
    produitId: '',
    document: '', // '' | 'fne' | 'recu'
  })

  const [clientId, setClientId] = useState('')
  const [tarifsClient, setTarifsClient] = useState({}) // { produit_id: prix_negocie }
  const [creditDisponible, setCreditDisponible] = useState(0)
  const [creditUtilise, setCreditUtilise] = useState('')
  const [commercialVendeurId, setCommercialVendeurId] = useState('')
  const [sourceStock, setSourceStock] = useState('depot') // 'depot' | 'commercial'
  const [totauxServeur, setTotauxServeur] = useState(null)
  const [configFne, setConfigFne] = useState({ actif: false })
  const [produireFne, setProduireFne] = useState(false)
  const [certificationEnCours, setCertificationEnCours] = useState(false)
  const [envoiDocument, setEnvoiDocument] = useState(false)
  useEffect(() => { lireConfigFne().then((c) => { setConfigFne(c); setProduireFne(!!c.fne_par_defaut) }) }, [])
  // Magasins actifs chargés dès l'ouverture de la page : nécessaires aussi pour
  // l'annulation par avoir (choix du magasin où la marchandise revient),
  // pas seulement pour le formulaire de nouvelle vente.
  useEffect(() => { supabase.from('depots').select('id, nom').eq('actif', true).order('nom').then(({ data }) => setDepots(data || [])) }, [])
  const [depotId, setDepotId] = useState('')
  const [stocksParDepot, setStocksParDepot] = useState({}) // { produit_id: { depot_id: quantite } }
  const [stockTerrain, setStockTerrain] = useState({}) // { produit_id: quantite } du commercial choisi
  const [montantPaye, setMontantPaye] = useState('')
  const [remisePourcentage, setRemisePourcentage] = useState('')
  const [motifRemise, setMotifRemise] = useState('')
  const [modeReglement, setModeReglement] = useState('espece')
  const [dateEcheance, setDateEcheance] = useState('')
  const [lignes, setLignes] = useState([{ produit_id: '', quantite: 1, prix_unitaire: 0 }])

  useEffect(() => {
    chargerReferences()
  }, [])

  useEffect(() => {
    if (profil) chargerVentes()
  }, [filtres, profil])

  async function chargerReferences() {
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from('clients').select('id, nom, ville').order('nom'),
      supabase.from('produits').select('id, nom').order('nom'),
    ])
    setClients(c || [])
    setProduits(p || [])
    const villesUniques = [...new Set((c || []).map((cl) => cl.ville).filter(Boolean))].sort()
    setVilles(villesUniques)

    const { data: ventesCreateurs } = await supabase.from('ventes').select('created_by')
    const idsCommerciaux = [...new Set((ventesCreateurs || []).map((v) => v.created_by).filter(Boolean))]
    if (idsCommerciaux.length > 0) {
      const { data: profilsData } = await supabase.from('profils').select('id, nom').in('id', idsCommerciaux)
      setCommerciaux(profilsData || [])
    }
  }

  async function chargerVentes() {
    setChargement(true)

    let selectStr = 'id, numero_vente, fne_statut, fne_reference, total, montant_ht, montant_tva, montant_autres_taxes, created_at, statut, clients!inner(nom, ville), profils!created_by(nom), commercial:profils!commercial_id(nom)'
    selectStr += filtres.produitId ? ', ventes_lignes!inner(id, produit_id)' : ', ventes_lignes(id)'

    // Filtres appliqués à la requête (réutilisée sans total_initial si la
    // base n'a pas encore le script des avoirs partiels).
    const construire = (colonnes) => {
    let requete = supabase.from('ventes').select(colonnes).order('created_at', { ascending: false })

    if (filtres.periode === 'jour') {
      const debut = new Date()
      debut.setHours(0, 0, 0, 0)
      requete = requete.gte('created_at', debut.toISOString())
    } else if (filtres.periode === 'mois') {
      const debut = new Date()
      debut.setDate(1)
      debut.setHours(0, 0, 0, 0)
      requete = requete.gte('created_at', debut.toISOString())
    } else if (filtres.periode === 'personnalise') {
      if (filtres.dateDebut) {
        const debut = new Date(filtres.dateDebut)
        debut.setHours(0, 0, 0, 0)
        requete = requete.gte('created_at', debut.toISOString())
      }
      if (filtres.dateFin) {
        const fin = new Date(filtres.dateFin)
        fin.setHours(23, 59, 59, 999)
        requete = requete.lte('created_at', fin.toISOString())
      }
    }
    if (filtres.clientId) requete = requete.eq('client_id', filtres.clientId)
    if (filtres.ville) requete = requete.eq('clients.ville', filtres.ville)
    if (filtres.commercialId) requete = requete.or(`commercial_id.eq.${filtres.commercialId},and(commercial_id.is.null,created_by.eq.${filtres.commercialId})`)
    if (filtres.produitId) requete = requete.eq('ventes_lignes.produit_id', filtres.produitId)
    // Type de document : facture certifiée FNE ou simple reçu de vente.
    if (filtres.document === 'fne') requete = requete.eq('fne_statut', 'certifiee')
    if (filtres.document === 'recu') requete = requete.or('fne_statut.is.null,fne_statut.neq.certifiee')
    if (profil?.role === 'commercial' && !profil?.acces_etendu) {
      requete = requete.eq('commercial_id', profil.id)
    }

    return requete
    }

    // Toutes les ventes de la période (par pages de 1000), pour que l'état
    // remis à la comptabilité soit complet.
    const toutCharger = async (colonnes) => {
      let tout = []
      for (let debut = 0; debut < 20000; debut += 1000) {
        const { data: page, error: e } = await construire(colonnes).range(debut, debut + 999)
        if (e) return { data: null, error: e }
        tout = tout.concat(page || [])
        if (!page || page.length < 1000) break
      }
      return { data: tout, error: null }
    }
    let { data, error } = await toutCharger(`${selectStr}, total_initial, montant_timbre`)
    if (error) ({ data, error } = await toutCharger(`${selectStr}, total_initial`))
    if (error) ({ data, error } = await toutCharger(selectStr))
    if (error) { console.error('Erreur chargement ventes:', error); setChargement(false); return }
    // Avoirs de ces ventes (annulations et avoirs partiels) : chacun devient
    // une ligne à part dans la liste et les exports, en négatif, avec la
    // référence de la vente d'origine.
    const ids = (data || []).map((v) => v.id)
    let avoirs = []
    if (ids.length) {
      let { data: av, error: erreurAvoirs } = await supabase.from('avoirs').select('id, vente_id, numero, montant, created_at, fne_reference, avoirs_lignes(id)').in('vente_id', ids)
      if (erreurAvoirs) ({ data: av } = await supabase.from('avoirs').select('id, vente_id, montant, created_at').in('vente_id', ids))
      avoirs = av || []
    }
    // Détail des autres taxes (AIRSI…) mémorisé à chaque vente.
    const detailTaxes = {}
    for (let i = 0; i < ids.length; i += 300) {
      const { data: tx } = await supabase.from('ventes_taxes').select('vente_id, nom, montant').in('vente_id', ids.slice(i, i + 300))
      for (const x of tx || []) (detailTaxes[x.vente_id] ||= []).push(x)
    }
    setTaxesParVente(detailTaxes)
    setVentes(data || [])
    setAvoirsListe(avoirs)
    setChargement(false)
  }

  useEffect(() => {
    supabase.from('taxes_entreprise').select('nom, actif').then(({ data }) => setTaxesConfigurees((data || []).filter((x) => x.actif).map((x) => x.nom)))
  }, [])

  // Arrivée depuis une commande livrée (?vente=…) : ouvre directement la vente
  // (reçu / facture, bon de livraison, partage).
  useEffect(() => {
    const id = searchParams.get('vente')
    if (id) ouvrirDetailVente(id)
  }, [])

  // Action demandée par lien (assistant IA, grand livre…), exécutée une
  // seule fois dès que le détail de la pièce est chargé.
  const actionDemandee = useRef(searchParams.get('action'))
  useEffect(() => {
    const action = actionDemandee.current
    if (!action || !detailVente?.vente || detailVente.vente.id !== searchParams.get('vente')) return
    actionDemandee.current = null
    const executer = {
      pdf: telechargerRecu, imprimer: () => setTimeout(() => window.print(), 400), bl: telechargerBonLivraison,
      whatsapp: envoyerWhatsAppDetail, email: envoyerEmailDetail, fne: certifierMaintenant,
    }[action]
    executer?.()
  }, [detailVente])

  async function ouvrirDetailVente(venteId) {
    setVenteOuverte(venteId)
    setChargementDetail(true)
    setDetailVente(null)

    const colonnesVente = 'id, numero_vente, numero_bl, total, created_at, mode_paiement, mode_reglement, statut, montant_regle, remise_montant, notes, montant_ht, montant_tva, montant_autres_taxes, depot_id, client_id, commercial_id, fne_statut, fne_reference, fne_token, fne_certifiee_at, fne_erreur, fne_avoir_reference, clients(nom, telephone, adresse, ville, email), profils!created_by(nom), commercial:profils!commercial_id(nom)'
    let [{ data: vente, error: erreurVente }, { data: lignes }, { data: autresTaxes }] = await Promise.all([
      supabase
        .from('ventes')
        .select(`${colonnesVente}, total_initial`)
        .eq('id', venteId)
        .single(),
      supabase
        .from('ventes_lignes')
        .select('id, produit_id, source_stock, quantite, prix_unitaire, sous_total, taux_tva, montant_tva, produits(nom, reference, unite)')
        .eq('vente_id', venteId),
      supabase
        .from('ventes_taxes')
        .select('nom, taux, montant, base_calcul')
        .eq('vente_id', venteId),
    ])
    // Base pas encore à jour (script des avoirs partiels non exécuté) : on
    // recharge sans la nouvelle colonne pour que le détail reste lisible.
    if (erreurVente) ({ data: vente } = await supabase.from('ventes').select(colonnesVente).eq('id', venteId).single())
    // Timbre fiscal (colonne ajoutée par migration_timbre_fiscal.sql).
    if (vente && 'timbre_actif' in (entreprise || {})) {
      const { data: tb, error: e } = await supabase.from('ventes').select('montant_timbre').eq('id', venteId).single()
      if (!e) vente = { ...vente, montant_timbre: Number(tb?.montant_timbre || 0) }
    }
    const { data: avoirs } = await supabase
      .from('avoirs')
      .select('id, numero, type_avoir, montant, motif, created_at, reduction_du, trop_percu, trop_percu_traitement, fne_reference, fne_token, fne_statut, fne_erreur')
      .eq('vente_id', venteId)
      .order('created_at')

    setDetailVente({ vente, lignes: lignes || [], autresTaxes: autresTaxes || [], avoirs: avoirs || [] })
    setChargementDetail(false)
  }

  function fermerDetailVente() {
    setVenteOuverte(null)
    setDetailVente(null)
    setModeAnnulation(false)
  }

  // Client complet pour la facture FNE (NCC, régime d'imposition).
  async function clientFacture(vente) {
    if (!vente.client_id) return vente.clients || {}
    let { data, error } = await supabase.from('clients').select('nom, adresse, email, ncc, regime_imposition').eq('id', vente.client_id).single()
    if (error) ({ data } = await supabase.from('clients').select('nom, adresse, email, ncc').eq('id', vente.client_id).single())
    return data || vente.clients || {}
  }

  // Vente certifiée : facture au modèle de la plateforme FNE ; sinon reçu.
  async function pdfVente(vente, lignes, autresTaxes) {
    const qrFne = await qrCodeFne(vente.fne_token)
    if (vente.fne_statut === 'certifiee' && vente.fne_reference) {
      // Avoirs de la vente : rappelés sous la facture avec le net (le tableau
      // officiel garde le montant certifié).
      const { data: avoirsVente } = await supabase.from('avoirs').select('numero, montant, fne_reference, created_at').eq('vente_id', vente.id).order('created_at')
      return genererFactureFne({ entreprise, vente, lignes, autresTaxes, qrFne, visuelFne: await visuelFne(), configFne, client: await clientFacture(vente), avoirsLies: avoirsVente || [] })
    }
    return genererRecuVente({ entreprise, vente, lignes, autresTaxes, qrFne })
  }

  async function telechargerRecu() {
    if (!detailVente) return
    const doc = await pdfVente(detailVente.vente, detailVente.lignes, detailVente.autresTaxes)
    doc.save(detailVente.vente.fne_statut === 'certifiee' && detailVente.vente.fne_reference ? `facture-${detailVente.vente.fne_reference}.pdf` : `recu-vente-${detailVente.vente.numero_vente || detailVente.vente.id.slice(0, 8)}.pdf`)
  }

  function telechargerBonLivraison() {
    if (!detailVente) return
    const doc = genererBonLivraison({ entreprise, vente: detailVente.vente, lignes: detailVente.lignes })
    doc.save(`${detailVente.vente.numero_bl || 'bon-livraison-' + detailVente.vente.id.slice(0, 8)}.pdf`)
  }

  // Facture d'avoir (PDF) : lignes de l'avoir s'il en a (avoirs partiels),
  // sinon toutes les lignes de la vente (anciennes annulations complètes).
  async function telechargerAvoir(avoir) {
    if (!detailVente || !avoir) return
    const { data: lignesAvoir } = await supabase.from('avoirs_lignes')
      .select('quantite, prix_unitaire, prix_corrige, montant, etat, ventes_lignes(*), produits(nom, reference, unite)').eq('avoir_id', avoir.id)
    const vente = detailVente.vente
    if (avoir.fne_reference) {
      // Avoir certifié : même modèle que la facture FNE.
      const doc = genererFactureFne({
        entreprise, vente, configFne, client: await clientFacture(vente),
        lignes: (lignesAvoir || []).map((l) => ({ ...l, taux_tva: l.ventes_lignes?.taux_tva, code_tva_fne: l.ventes_lignes?.code_tva_fne })),
        qrFne: await qrCodeFne(avoir.fne_token), visuelFne: await visuelFne(),
        avoir: { reference: avoir.fne_reference, referenceOrigine: vente.fne_reference || vente.numero_vente, motif: avoir.motif, montant: avoir.montant, date: avoir.created_at,
          brutVente: detailVente.lignes.reduce((n, l) => n + Number(l.quantite) * Number(l.prix_unitaire), 0) },
      })
      doc.save(`avoir-${avoir.fne_reference}.pdf`)
      return
    }
    const doc = genererFactureAvoir({
      entreprise,
      client: vente?.clients,
      vente,
      lignes: lignesAvoir?.length ? lignesAvoir.map((l) => ({ ...l, sous_total: l.montant })) : detailVente.lignes,
      motif: avoir.motif,
      montant: avoir.montant,
      date: avoir.created_at,
      reference: avoir.numero || avoir.id.slice(0, 8),
      typeAvoir: avoir.type_avoir,
    })
    doc.save(`${avoir.numero || 'avoir-' + avoir.id.slice(0, 8)}.pdf`)
  }

  async function certifierAvoir(avoir) {
    const { error } = await emettreAvoirFne(detailVente.vente.id, avoir.id)
    if (error) alert(t('fne.echecAvoir', { message: error }))
    await ouvrirDetailVente(detailVente.vente.id)
  }

  // Document du client : FNE si la vente est certifiée, sinon reçu interne.
  async function documentVente(vente, lignes, autresTaxes) {
    const doc = await pdfVente(vente, lignes, autresTaxes)
    const certifiee = vente.fne_statut === 'certifiee'
    return {
      doc,
      nomFichier: certifiee && vente.fne_reference ? `facture-${vente.fne_reference}.pdf` : `recu-${vente.numero_vente || vente.id.slice(0, 8)}.pdf`,
      typeDocument: certifiee ? 'facture_fne' : 'recu',
    }
  }

  async function envoyerEmailDetail() {
    if (!detailVente) return
    const d = await documentVente(detailVente.vente, detailVente.lignes, detailVente.autresTaxes)
    const destinataire = window.prompt(t('envoi.confirmerEmail'), detailVente.vente?.clients?.email || '')
    if (!destinataire) return
    setEnvoiDocument(true)
    const { error } = await envoyerParEmail({ ...d, venteId: detailVente.vente.id, destinataire })
    setEnvoiDocument(false)
    alert(error ? t('envoi.echecEmail', { message: error }) : t('envoi.emailEnvoye', { email: destinataire }))
  }

  async function envoyerWhatsAppDetail() {
    if (!detailVente) return
    const telephone = detailVente.vente?.clients?.telephone || window.prompt(t('envoi.numeroWhatsApp'), '')
    if (!telephone) return
    const d = await documentVente(detailVente.vente, detailVente.lignes, detailVente.autresTaxes)
    setEnvoiDocument(true)
    const { error } = await partagerWhatsApp({
      ...d, telephone, venteId: detailVente.vente.id, entrepriseId: profil.entreprise_id, profilId: profil.id,
      message: t('envoi.messageWhatsApp', {
        client: detailVente.vente?.clients?.nom || '', numero: detailVente.vente?.numero_vente || '',
        montant: formatXOF(detailVente.vente?.total), entreprise: entreprise?.nom || '',
      }),
    })
    setEnvoiDocument(false)
    if (error) alert(error === 'numero' ? t('envoi.numeroManquant') : t('envoi.echecWhatsApp', { message: error }))
  }

  async function partagerRecu() {
    if (!detailVente) return
    const doc = await pdfVente(detailVente.vente, detailVente.lignes, detailVente.autresTaxes)
    const blob = doc.output('blob')
    const fichier = new File([blob], `recu-vente-${detailVente.vente.id.slice(0, 8)}.pdf`, { type: 'application/pdf' })

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [fichier] })) {
      try {
        await navigator.share({
          files: [fichier],
          title: t('detail.titrePartage'),
          text: `${t('detail.titrePartage')} — ${entreprise?.nom || ''}`,
        })
      } catch (e) {
        // Annulation par l'utilisateur : ne rien faire
      }
    } else {
      alert(t('detail.partagePasDisponible'))
      doc.save(detailVente.vente.fne_statut === 'certifiee' && detailVente.vente.fne_reference ? `facture-${detailVente.vente.fne_reference}.pdf` : `recu-vente-${detailVente.vente.numero_vente || detailVente.vente.id.slice(0, 8)}.pdf`)
    }
  }

  async function ouvrirModal() {
    setErreur('')
    setClientId('')
    setCreditDisponible(0)
    setCreditUtilise('')
    setTarifsClient({})
    setMontantPaye('')
    setRemisePourcentage('')
    setMotifRemise('')
    setModeReglement('espece')
    setDateEcheance('')
    setLignes([{ produit_id: '', quantite: 1, prix_unitaire: 0 }])
    setCommercialVendeurId(profil?.role === 'commercial' ? profil.id : '')
    setDepotId('')
    setSourceStock('depot')
    setStockTerrain({})

    const [{ data: c }, { data: p }, { data: com }, { data: d }] = await Promise.all([
      supabase.from('clients').select('id, nom').order('nom'),
      supabase.from('produits').select('id, nom, reference, prix_vente, stocks(quantite, depot_id)').order('nom'),
      supabase.from('profils').select('id, nom').eq('role', 'commercial').order('nom'),
      supabase.from('depots').select('id, nom').eq('actif', true).order('nom'),
    ])
    setClients(c || [])
    setCommerciaux(com || [])
    setDepots(d || [])
    // Un seul dépôt actif : le présélectionner directement (pas besoin de
    // faire choisir l'utilisateur). Plusieurs dépôts : il faudra choisir.
    if ((d || []).length === 1) setDepotId(d[0].id)

    // Quantité par produit et par dépôt, pour recalculer l'affichage sans
    // recharger quand on change de dépôt sélectionné.
    const parDepot = {}
    ;(p || []).forEach((pr) => {
      parDepot[pr.id] = {}
      ;(pr.stocks || []).forEach((s) => { parDepot[pr.id][s.depot_id] = s.quantite })
    })
    setStocksParDepot(parDepot)

    if (profil?.role === 'commercial') {
      // Sur le terrain, le commercial doit voir son propre stock en main,
      // pas le stock magasin (qui a déjà été débité lors de la sortie).
      const { data: stockPerso } = await supabase
        .from('stock_commercial')
        .select('produit_id, quantite')
        .eq('commercial_id', profil.id)
      const quantitesParProduit = {}
      ;(stockPerso || []).forEach((s) => { quantitesParProduit[s.produit_id] = s.quantite })
      setProduits((p || []).map((pr) => ({ ...pr, quantite_stock: quantitesParProduit[pr.id] ?? 0 })))
    } else {
      const depotParDefaut = (d || []).length === 1 ? d[0].id : null
      setProduits((p || []).map((pr) => ({ ...pr, quantite_stock: depotParDefaut ? (parDepot[pr.id]?.[depotParDefaut] ?? 0) : 0 })))
    }

    setModalOuvert(true)
  }

  function changerDepot(nouveauDepotId) {
    setDepotId(nouveauDepotId)
  }

  // Source unique de la marchandise : un magasin (depot:<id>) ou le stock
  // terrain du commercial choisi (commercial).
  const valeurSource = profil?.role === 'commercial' ? '' : (sourceStock === 'commercial' ? 'commercial' : (depotId ? `depot:${depotId}` : ''))
  function changerSource(v) {
    if (v === 'commercial') { setSourceStock('commercial'); setDepotId('') }
    else { setSourceStock('depot'); setDepotId(v.replace('depot:', '')) }
  }
  async function changerCommercial(id) {
    setCommercialVendeurId(id)
    if (sourceStock === 'commercial') { setSourceStock('depot'); setDepotId(depots.length === 1 ? depots[0].id : '') }
    if (!id) { setStockTerrain({}); return }
    const { data } = await supabase.from('stock_commercial').select('produit_id, quantite').eq('commercial_id', id)
    setStockTerrain(Object.fromEntries((data || []).map((x) => [x.produit_id, x.quantite])))
  }
  // Stock disponible d'un produit pour la source choisie (null = source non choisie).
  function stockDisponible(pr) {
    if (profil?.role === 'commercial') return pr.quantite_stock
    if (sourceStock === 'commercial') return stockTerrain[pr.id] ?? 0
    if (depotId) return stocksParDepot[pr.id]?.[depotId] ?? 0
    return null
  }

  function ajouterLigne() {
    setLignes([...lignes, { produit_id: '', quantite: 1, prix_unitaire: 0 }])
  }

  function retirerLigne(index) {
    setLignes(lignes.filter((_, i) => i !== index))
  }

  async function changerClient(nouveauClientId) {
    setClientId(nouveauClientId)
    setCreditUtilise('')
    if (!nouveauClientId) {
      setTarifsClient({})
      setCreditDisponible(0)
      return
    }
    const [{ data }, { data: clientData }] = await Promise.all([
      supabase.from('tarifs_client').select('produit_id, prix_negocie').eq('client_id', nouveauClientId),
      supabase.from('clients').select('solde_credit').eq('id', nouveauClientId).single(),
    ])
    setCreditDisponible(Number(clientData?.solde_credit || 0))
    const carte = {}
    ;(data || []).forEach((t) => { carte[t.produit_id] = Number(t.prix_negocie) })
    setTarifsClient(carte)
    // Réapplique le bon prix sur les lignes déjà sélectionnées
    setLignes((prev) =>
      prev.map((l) =>
        l.produit_id
          ? { ...l, prix_unitaire: carte[l.produit_id] ?? produits.find((p) => p.id === l.produit_id)?.prix_vente ?? 0 }
          : l
      )
    )
  }

  function modifierLigne(index, champ, valeur) {
    const copie = [...lignes]
    copie[index] = { ...copie[index], [champ]: valeur }
    if (champ === 'produit_id') {
      const produit = produits.find((p) => p.id === valeur)
      copie[index].prix_unitaire = tarifsClient[valeur] ?? produit?.prix_vente ?? 0
    }
    setLignes(copie)
  }

  const sousTotal = lignes.reduce((s, l) => s + Number(l.quantite || 0) * Number(l.prix_unitaire || 0), 0)
  const remisePourcentageEffectif = Math.min(Math.max(Number(remisePourcentage || 0), 0), 100)
  const remiseEffective = Math.round(sousTotal * (remisePourcentageEffectif / 100))
  // Le total affiché est celui que le serveur enregistrera (TVA et autres
  // taxes comprises) : calculé par la même fonction que la vente.
  const totalHorsTaxes = sousTotal - remiseEffective
  const total = totauxServeur ? Number(totauxServeur.total) : totalHorsTaxes
  const cleTotaux = JSON.stringify([lignes.map((l) => [l.produit_id, l.quantite, l.prix_unitaire]), remiseEffective])
  useEffect(() => {
    const lignesCalc = lignes.filter((l) => l.produit_id && Number(l.quantite) > 0)
    if (lignesCalc.length === 0) { setTotauxServeur(null); return }
    const minuterie = setTimeout(async () => {
      const { data, error } = await supabase.rpc('calculer_totaux_vente', {
        p_lignes: lignesCalc.map((l) => ({ produit_id: l.produit_id, quantite: Number(l.quantite), prix_unitaire: Number(l.prix_unitaire || 0) })),
        p_remise_montant: remiseEffective,
      })
      setTotauxServeur(error ? null : data)
    }, 300)
    return () => clearTimeout(minuterie)
  }, [cleTotaux])

  const creditEffectif = Math.min(Math.max(Number(creditUtilise || 0), 0), creditDisponible, total)
  // Liste et exports : une ligne par vente (montant facturé) et une ligne
  // par avoir (montant négatif, référence de la vente) ; le total est le net.
  const ventesParId = Object.fromEntries(ventes.map((v) => [v.id, v]))
  // Vente certifiée FNE : son numéro est celui de la DGI.
  const numeroFacture = (v) => (v.fne_statut === 'certifiee' && v.fne_reference ? v.fne_reference : v.numero_vente)
  const lignesListe = [
    ...ventes.map((v) => ({ type: 'vente', cle: v.id, venteId: v.id, numero: numeroFacture(v), interne: v.fne_reference ? v.numero_vente : null, date: v.created_at, vente: v,
      articles: v.ventes_lignes?.length || 0, montant: Number(v.total_initial ?? v.total ?? 0) })),
    ...avoirsListe.filter((a) => ventesParId[a.vente_id]).map((a) => ({ type: 'avoir', cle: a.id, venteId: a.vente_id, numero: a.fne_reference || a.numero || `AV-${a.id.slice(0, 8)}`, interne: a.fne_reference ? a.numero : null,
      date: a.created_at, vente: ventesParId[a.vente_id], articles: a.avoirs_lignes?.length || ventesParId[a.vente_id].ventes_lignes?.length || 0,
      montant: -Number(a.montant || 0) })),
  ].sort((x, y) => new Date(y.date) - new Date(x.date))
  const totalFiltre = lignesListe.reduce((s, l) => s + l.montant, 0)

  // État fiscal des ventes : HT, TVA facturée, autres taxes (une colonne par
  // taxe : AIRSI…) et TTC, selon les impôts et taxes de l'entreprise. Une
  // entreprise non assujettie sans autre taxe n'a qu'un montant TTC.
  const nomsTaxes = [...new Set([...taxesConfigurees, ...Object.values(taxesParVente).flat().map((x) => x.nom)])]
  const avecTva = !!entreprise?.assujetti_tva || ventes.some((v) => Number(v.montant_tva) > 0)
  // Timbre fiscal : hors chiffre d'affaires (collecté pour l'État), en colonne à part.
  const avecTimbre = !!entreprise?.timbre_actif || ventes.some((v) => Number(v.montant_timbre) > 0)
  const etatDetaille = avecTva || nomsTaxes.length > 0 || avecTimbre
  const detailFiscal = (l) => {
    const v = l.vente
    const ttcVente = Number(v.total_initial ?? v.total ?? 0)
    const ratio = l.type === 'avoir' ? (ttcVente ? l.montant / ttcVente : 0) : 1
    const arrondi = (n) => Math.round(n * ratio)
    const taxes = {}
    let totalTaxes = 0
    const detail = taxesParVente[v.id]
    if (detail?.length) for (const x of detail) { taxes[x.nom] = (taxes[x.nom] || 0) + arrondi(Number(x.montant)); totalTaxes += arrondi(Number(x.montant)) }
    else if (Number(v.montant_autres_taxes) > 0) { const n = nomsTaxes[0] || 'Autres taxes'; taxes[n] = arrondi(Number(v.montant_autres_taxes)); totalTaxes = taxes[n] }
    const tva = arrondi(Number(v.montant_tva || 0))
    const timbre = l.type === 'vente' ? Number(v.montant_timbre || 0) : 0
    return { ht: l.montant - tva - totalTaxes, tva, taxes, ttc: l.montant, timbre }
  }
  const totauxFiscaux = lignesListe.reduce((acc, l) => {
    const d = detailFiscal(l)
    acc.ht += d.ht; acc.tva += d.tva; acc.ttc += d.ttc; acc.timbre += d.timbre
    for (const [n, m] of Object.entries(d.taxes)) acc.taxes[n] = (acc.taxes[n] || 0) + m
    return acc
  }, { ht: 0, tva: 0, taxes: {}, ttc: 0, timbre: 0 })

  const COLONNES_EXPORT = [
    { cle: 'numero', titre: t('export.numero') },
    { cle: 'date', titre: t('export.date') },
    { cle: 'type', titre: t('export.type') },
    { cle: 'client', titre: t('export.client') },
    { cle: 'ville', titre: t('export.ville') },
    { cle: 'commercial', titre: t('export.commercial') },
    { cle: 'articles', titre: t('export.articles'), alignDroite: true },
    { cle: 'reference', titre: t('export.reference') },
    ...(etatDetaille ? [
      { cle: 'ht', titre: `${t('export.ht')} (${symboleDevise()})`, alignDroite: true },
      ...(avecTva ? [{ cle: 'tva', titre: `${t('export.tva')} (${symboleDevise()})`, alignDroite: true }] : []),
      ...nomsTaxes.map((n) => ({ cle: `taxe_${n}`, titre: `${n} (${symboleDevise()})`, alignDroite: true })),
      { cle: 'total', titre: `${t('export.ttc')} (${symboleDevise()})`, alignDroite: true },
      ...(avecTimbre ? [{ cle: 'timbre', titre: `${t('export.timbre')} (${symboleDevise()})`, alignDroite: true }] : []),
    ] : [{ cle: 'total', titre: `${t('export.ttc')} (${symboleDevise()})`, alignDroite: true }]),
  ]
  function ligneFiscale(d) {
    return { ht: d.ht, tva: d.tva, ...Object.fromEntries(nomsTaxes.map((n) => [`taxe_${n}`, d.taxes[n] || 0])), total: d.ttc, timbre: d.timbre }
  }
  function donneesExport() {
    const lignes = lignesListe.map((l) => ({
      numero: l.numero || '—',
      date: formatDate(l.date),
      type: l.type === 'avoir' ? t('export.typeAvoir') : (l.vente.statut === 'annulee' ? `${t('export.typeVente')} (${t('table.annulee')})` : t('export.typeVente')),
      client: l.vente.clients?.nom || '—',
      ville: l.vente.clients?.ville || '—',
      commercial: l.vente.commercial?.nom || t('bureau'),
      articles: l.articles,
      reference: l.type === 'avoir' ? `${t('export.refVente')} ${numeroFacture(l.vente) || ''}` : '',
      ...(etatDetaille ? ligneFiscale(detailFiscal(l)) : { total: l.montant }),
    }))
    // Ligne de totaux (net des avoirs), colonne par colonne.
    if (etatDetaille && lignes.length) lignes.push({ numero: t('export.totalNet'), articles: '', ...ligneFiscale(totauxFiscaux) })
    return lignes
  }
  function exportExcel() {
    exporterExcel('ventes', COLONNES_EXPORT, donneesExport())
  }
  function exportPDF() {
    exporterPDF('ventes', etatDetaille ? t('export.titreEtatFiscal') : 'Ventes', null, COLONNES_EXPORT, donneesExport(), 'Total', formatMontantPDF(totalFiltre) + ' F CFA', entreprise)
  }

  async function validerVente(e) {
    e.preventDefault()
    setErreur('')

    if (!clientId) {
      setErreur(t('form.erreurSelectionnerClient'))
      return
    }
    if (profil?.role !== 'commercial' && !valeurSource) {
      setErreur(t('form.sourceObligatoire'))
      return
    }
    const lignesValides = lignes.filter((l) => l.produit_id && Number(l.quantite) > 0)
    if (lignesValides.length === 0) {
      setErreur(t('form.erreurArticleValide'))
      return
    }

    if (remiseEffective > 0 && !motifRemise.trim()) {
      setErreur(t('form.erreurMotifRemise'))
      return
    }

    const restantApresCredit = Math.max(0, total - creditEffectif)
    const montantPayeEffectif = montantPaye === '' ? restantApresCredit : Math.min(Number(montantPaye), restantApresCredit)
    const resteAPayer = restantApresCredit - montantPayeEffectif

    const parametresVente = {
      p_client_id: clientId,
      p_lignes: lignesValides.map((l) => ({
        produit_id: l.produit_id,
        quantite: Number(l.quantite),
        prix_unitaire: Number(l.prix_unitaire),
      })),
      p_mode_paiement: resteAPayer > 0 ? 'credit' : 'cash',
      p_montant_paye: montantPaye === '' ? null : montantPayeEffectif,
      p_mode_reglement: modeReglement,
      p_date_echeance: resteAPayer > 0 && dateEcheance ? dateEcheance : null,
      p_commercial_id: commercialVendeurId || null,
      p_remise_montant: remiseEffective,
      p_motif_remise: remiseEffective > 0 ? motifRemise.trim() : null,
      p_depot_id: depotId || null,
      p_credit_utilise: creditEffectif,
      // Choix explicite de la marchandise : magasin ou stock terrain du commercial.
      p_source_stock: profil?.role === 'commercial' ? null : sourceStock,
    }

    // Hors-ligne : uniquement possible pour un commercial vendant depuis
    // son propre stock porté (stock_commercial, vérifié côté serveur en
    // priorité par creer_vente avant le dépôt) — pas de vérification de
    // stock en temps réel possible sans réseau, donc pas éligible pour
    // une vente de bureau ou depuis un dépôt.
    const eligibleHorsLigne = profil?.role === 'commercial' && commercialVendeurId === profil?.id

    if (eligibleHorsLigne && !navigator.onLine) {
      await ajouterActionEnAttente(
        'creer_vente',
        parametresVente,
        `${t('titre')} — ${clients.find((c) => c.id === clientId)?.nom || ''} — ${formatXOF(total)}`
      )
      setModalOuvert(false)
      chargerVentes()
      return
    }

    setEnregistrement(true)
    const { data: nouvelleVenteId, error } = await supabase.rpc('creer_vente', parametresVente)
    setEnregistrement(false)

    if (error) {
      const erreurReseau = /failed to fetch|network|timeout|load failed/i.test(error.message || '')
      if (eligibleHorsLigne && erreurReseau) {
        await ajouterActionEnAttente(
          'creer_vente',
          parametresVente,
          `${t('titre')} — ${clients.find((c) => c.id === clientId)?.nom || ''} — ${formatXOF(total)}`
        )
        setModalOuvert(false)
        chargerVentes()
        return
      }
      console.error('Erreur creer_vente:', error)
      setErreur(`${t('form.erreurCreationVente')} : ${traduireErreur(error.message)}`)
      return
    }
    setModalOuvert(false)
    // FNE demandée : certification auprès de la DGI juste après la vente.
    if (nouvelleVenteId && configFne.actif && produireFne) {
      await supabase.rpc('demander_fne', { p_vente_id: nouvelleVenteId })
      const { data: fne, error: erreurFne } = await certifierVenteFne(nouvelleVenteId)
      if (erreurFne) alert(t('fne.echecApresVente', { message: erreurFne }))
      else if (fne?.avertissement_stickers != null) alert(t('fne.stickersBas', { n: fne.avertissement_stickers }))
    }
    if (nouvelleVenteId && entreprise?.envoi_auto_email) envoyerEmailAutomatique(nouvelleVenteId)
    chargerVentes()
    if (nouvelleVenteId && (montantPayeEffectif > 0 || produireFne)) ouvrirDetailVente(nouvelleVenteId)
  }

  // Envoi automatique (sans bloquer l'écran) si le client a une adresse email.
  async function envoyerEmailAutomatique(venteId) {
    const [{ data: v }, { data: lignes }, { data: autres }] = await Promise.all([
      supabase.from('ventes').select('*, clients(nom, telephone, adresse, ville, email), profils!created_by(nom), commercial:profils!commercial_id(nom)').eq('id', venteId).single(),
      supabase.from('ventes_lignes').select('*, produits(nom, reference, unite)').eq('vente_id', venteId),
      supabase.from('ventes_taxes').select('nom, taux, montant').eq('vente_id', venteId),
    ])
    if (!v?.clients?.email) return
    const d = await documentVente(v, lignes || [], autres || [])
    await envoyerParEmail({ ...d, venteId, automatique: true })
  }

  async function certifierMaintenant() {
    if (!detailVente?.vente) return
    setCertificationEnCours(true)
    await supabase.rpc('demander_fne', { p_vente_id: detailVente.vente.id })
    const { error: erreurFne } = await certifierVenteFne(detailVente.vente.id)
    setCertificationEnCours(false)
    if (erreurFne) alert(erreurFne)
    ouvrirDetailVente(detailVente.vente.id)
  }

  if (!accesAutorise('ventes', profil?.role)) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        <p className="text-petrol-500">{t('accesRefuse')}</p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{t('titre')}</h1>
          <p className="text-sm text-petrol-700 mt-1">
            {ventes.length} {t('compteur_venteS')} — {t('totalFiltre')} : <span className="font-mono font-medium">{formatXOF(totalFiltre)}</span>
          </p>
          {etatDetaille && ventes.length > 0 && (
            <p className="text-xs text-petrol-600 mt-1 flex flex-wrap gap-x-3">
              <span>{t('export.ht')} : <span className="font-mono">{formatXOF(totauxFiscaux.ht)}</span></span>
              {avecTva && <span>{t('export.tva')} : <span className="font-mono">{formatXOF(totauxFiscaux.tva)}</span></span>}
              {nomsTaxes.map((n) => <span key={n}>{n} : <span className="font-mono">{formatXOF(totauxFiscaux.taxes[n] || 0)}</span></span>)}
              <span>{t('export.ttc')} : <span className="font-mono">{formatXOF(totauxFiscaux.ttc)}</span></span>
              {avecTimbre && <span>{t('export.timbre')} : <span className="font-mono">{formatXOF(totauxFiscaux.timbre)}</span></span>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button data-aide="ventes.excel" className="btn-secondary text-sm" onClick={exportExcel} disabled={ventes.length === 0}>
            📊 {t('excel')}
          </button>
          <button data-aide="ventes.pdf" className="btn-secondary text-sm" onClick={exportPDF} disabled={ventes.length === 0}>
            📄 {t('pdf')}
          </button>
          <button data-aide="ventes.nouvelleVente" className="btn-primary" onClick={ouvrirModal}>
            {t('nouvelleVente')}
          </button>
        </div>
      </header>

      <div className="card p-4 mb-4 grid grid-cols-2 md:grid-cols-5 gap-3">
        <div>
          <label className="label">{t('filtres.periode')}</label>
          <select
            className="input-field"
            value={filtres.periode}
            onChange={(e) => setFiltres({ ...filtres, periode: e.target.value })}
          >
            <option value="tout">{t('filtres.tout')}</option>
            <option value="jour">{t('filtres.aujourdhui')}</option>
            <option value="mois">{t('filtres.ceMois')}</option>
            <option value="personnalise">{t('filtres.personnalisee')}</option>
          </select>
        </div>
        {filtres.periode === 'personnalise' && (
          <div className="col-span-2 grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('filtres.du')}</label>
              <input
                type="date" lang={i18n.language}
                className="input-field"
                value={filtres.dateDebut}
                onChange={(e) => setFiltres({ ...filtres, dateDebut: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t('filtres.au')}</label>
              <input
                type="date" lang={i18n.language}
                className="input-field"
                value={filtres.dateFin}
                onChange={(e) => setFiltres({ ...filtres, dateFin: e.target.value })}
              />
            </div>
          </div>
        )}
        <div>
          <label className="label">{t('filtres.commercial')}</label>
          <select
            className="input-field"
            value={filtres.commercialId}
            onChange={(e) => setFiltres({ ...filtres, commercialId: e.target.value })}
          >
            <option value="">{t('filtres.tous')}</option>
            {commerciaux.map((c) => (
              <option key={c.id} value={c.id}>{c.nom}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('filtres.magasinClient')}</label>
          <select
            className="input-field"
            value={filtres.clientId}
            onChange={(e) => setFiltres({ ...filtres, clientId: e.target.value })}
          >
            <option value="">{t('filtres.tous')}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.nom}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('filtres.zoneVille')}</label>
          <select
            className="input-field"
            value={filtres.ville}
            onChange={(e) => setFiltres({ ...filtres, ville: e.target.value })}
          >
            <option value="">{t('filtres.toutes')}</option>
            {villes.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('filtres.produit')}</label>
          <select
            className="input-field"
            value={filtres.produitId}
            onChange={(e) => setFiltres({ ...filtres, produitId: e.target.value })}
          >
            <option value="">{t('filtres.tous')}</option>
            {produits.map((p) => (
              <option key={p.id} value={p.id}>{p.nom}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('filtres.document')}</label>
          <select
            className="input-field"
            value={filtres.document}
            onChange={(e) => setFiltres({ ...filtres, document: e.target.value })}
          >
            <option value="">{t('filtres.tous')}</option>
            <option value="fne">{t('filtres.documentFne')}</option>
            <option value="recu">{t('filtres.documentRecu')}</option>
          </select>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
              <th className="px-4 py-3 font-medium">{t('export.numero')}</th>
              <th className="px-4 py-3 font-medium">{t('table.date')}</th>
              <th className="px-4 py-3 font-medium">{t('table.client')}</th>
              <th className="px-4 py-3 font-medium">{t('table.ville')}</th>
              <th className="px-4 py-3 font-medium">{t('table.commercial')}</th>
              <th className="px-4 py-3 font-medium">{t('table.articles')}</th>
              {etatDetaille && <th className="hidden lg:table-cell px-4 py-3 font-medium text-right">{t('export.ht')}</th>}
              {etatDetaille && avecTva && <th className="hidden lg:table-cell px-4 py-3 font-medium text-right">{t('export.tva')}</th>}
              {etatDetaille && nomsTaxes.map((n) => <th key={n} className="hidden lg:table-cell px-4 py-3 font-medium text-right">{n}</th>)}
              <th className="px-4 py-3 font-medium text-right">{etatDetaille ? t('export.ttc') : t('table.total')}</th>
              {etatDetaille && avecTimbre && <th className="hidden lg:table-cell px-4 py-3 font-medium text-right">{t('export.timbre')}</th>}
            </tr>
          </thead>
          <tbody>
            {chargement ? (
              <tr><td colSpan={20} className="px-4 py-8 text-center text-petrol-500">{t('table.chargement')}</td></tr>
            ) : ventes.length === 0 ? (
              <tr><td colSpan={20} className="px-4 py-8 text-center text-petrol-500">{t('table.aucuneVente')}</td></tr>
            ) : (
              lignesListe.map((l) => {
                const v = l.vente
                const estAvoir = l.type === 'avoir'
                const fisc = etatDetaille ? detailFiscal(l) : null
                const cellule = (n, k) => <td key={k} className={`hidden lg:table-cell px-4 py-3 font-mono text-right text-xs ${estAvoir ? 'text-red-700' : 'text-petrol-700'}`}>{n < 0 ? '- ' : ''}{formatXOF(Math.abs(n))}</td>
                return (
                <tr
                  key={l.cle}
                  onClick={() => ouvrirDetailVente(l.venteId)}
                  className={`border-b border-line last:border-0 hover:bg-canvas/60 cursor-pointer ${estAvoir ? 'bg-red-50/40' : ''}`}
                >
                  <td className={`px-4 py-3 font-mono text-xs ${estAvoir ? 'text-red-700' : 'text-petrol-700'}`}>
                    {l.numero || '—'}
                    {l.interne && <span className="block text-[10px] text-petrol-400">{l.interne}</span>}
                    {estAvoir && <span className="block text-[10px] text-petrol-500">{t('export.refVente')} {numeroFacture(v)}</span>}
                  </td>
                  <td className="px-4 py-3 text-petrol-700">
                    {new Date(l.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {v.clients?.nom || '—'}
                    {estAvoir
                      ? <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{t('export.typeAvoir')}</span>
                      : v.statut === 'annulee' && <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{t('table.annulee')}</span>}
                  </td>
                  <td className="px-4 py-3 text-petrol-700">{v.clients?.ville || '—'}</td>
                  <td className="px-4 py-3 text-petrol-700">{v.commercial?.nom || <span className="text-petrol-400">{t('bureau')}</span>}</td>
                  <td className="px-4 py-3 text-petrol-700">{t('table.nbArticles', { n: l.articles })}</td>
                  {fisc && cellule(fisc.ht, 'ht')}
                  {fisc && avecTva && cellule(fisc.tva, 'tva')}
                  {fisc && nomsTaxes.map((n) => cellule(fisc.taxes[n] || 0, n))}
                  <td className={`px-4 py-3 font-mono text-right ${estAvoir ? 'text-red-700' : ''}`}>{estAvoir ? '- ' : ''}{formatXOF(Math.abs(l.montant))}</td>
                  {fisc && avecTimbre && cellule(fisc.timbre, 'timbre')}
                </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {modalOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-4">{t('form.titre')}</h2>
            <form onSubmit={validerVente} className="space-y-4">
              <div>
                <label className="label">{t('form.client')}</label>
                <SelectRecherche
                  options={clients}
                  value={clientId}
                  onChange={changerClient}
                  placeholder={t('form.rechercherClient')}
                />
              </div>

              {profil?.role !== 'commercial' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t('form.commercialAttribue')}</label>
                    <select className="input-field" value={commercialVendeurId} onChange={(e) => changerCommercial(e.target.value)}>
                      <option value="">{t('form.venteDeBureau')}</option>
                      {commerciaux.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">{t('form.sourceMarchandise')} *</label>
                    <select className="input-field" value={valeurSource} onChange={(e) => changerSource(e.target.value)}>
                      <option value="">{t('form.choisirSource')}</option>
                      {depots.map((d) => <option key={d.id} value={`depot:${d.id}`}>🏬 {d.nom}</option>)}
                      {commercialVendeurId && (
                        <option value="commercial">🚚 {t('form.stockTerrainDe', { nom: commerciaux.find((c) => c.id === commercialVendeurId)?.nom || '' })}</option>
                      )}
                    </select>
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">{t('form.articles')}</label>
                  <button data-aide="ventes.form.ajouterArticle" type="button" onClick={ajouterLigne} className="text-xs font-medium text-amber-600 hover:text-amber-700">
                    {t('form.ajouterArticle')}
                  </button>
                </div>

                <div className="space-y-2">
                  {lignes.map((ligne, i) => {
                    const produit = produits.find((p) => p.id === ligne.produit_id)
                    return (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <select
                          className="input-field col-span-5"
                          value={ligne.produit_id}
                          onChange={(e) => modifierLigne(i, 'produit_id', e.target.value)}
                        >
                          <option value="">{t('form.produitPlaceholder')}</option>
                          {produits
                            // Un produit déjà choisi sur une autre ligne n'est plus proposé.
                            .filter((p) => p.id === ligne.produit_id || !lignes.some((l, j) => j !== i && l.produit_id === p.id))
                            .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.reference ? `${p.reference} — ` : ''}{p.nom} {stockDisponible(p) == null
                                ? `(${t('form.choisirSourceCourt')})`
                                : `(${profil?.role === 'commercial' || sourceStock === 'commercial' ? t('form.enMain') : t('form.stock')}: ${stockDisponible(p)})`}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="1"
                          className="input-field col-span-2 font-mono"
                          value={ligne.quantite}
                          onChange={(e) => modifierLigne(i, 'quantite', e.target.value)}
                          placeholder={t('form.qte')}
                        />
                        <input
                          type="number"
                          className="input-field col-span-3 font-mono"
                          value={ligne.prix_unitaire}
                          onChange={(e) => modifierLigne(i, 'prix_unitaire', e.target.value)}
                        />
                        <div className="col-span-1 font-mono text-xs text-petrol-700 text-right">
                          {ligne.produit_id && tarifsClient[ligne.produit_id] != null && (
                            <span className="text-green-600" title={t('form.tarifNegocieApplique')}>%</span>
                          )}
                          {produit && stockDisponible(produit) != null && ligne.quantite > stockDisponible(produit) && (
                            <span className="text-red-600">{t('form.stockInsuffisant')}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => retirerLigne(i)}
                          className="col-span-1 text-petrol-500 hover:text-red-600 text-sm"
                          disabled={lignes.length === 1}
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="border-t border-line pt-3 space-y-2">
                <div className="flex items-center justify-between text-sm text-petrol-600">
                  <span>{t('form.sousTotal')}</span>
                  <span className="font-mono">{formatXOF(sousTotal)}</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t('form.remisePourcentage')}</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      className="input-field"
                      value={remisePourcentage}
                      onChange={(e) => setRemisePourcentage(e.target.value)}
                      placeholder="0"
                    />
                    {remiseEffective > 0 && (
                      <p className="text-xs text-petrol-500 mt-1">{t('form.soitMoins', { montant: formatXOF(remiseEffective) })}</p>
                    )}
                  </div>
                  {remiseEffective > 0 && (
                    <div>
                      <label className="label">{t('form.motifRemise')}</label>
                      <input
                        className="input-field"
                        value={motifRemise}
                        onChange={(e) => setMotifRemise(e.target.value)}
                        placeholder={t('form.motifRemisePlaceholder')}
                      />
                    </div>
                  )}
                </div>

                {remiseEffective > 0 && profil?.role === 'commercial' && (
                  remisePourcentageEffectif > (entreprise?.seuil_remise_pourcentage ?? 15) && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                      {t('form.avertissementSeuilRemise', {
                        pct: remisePourcentageEffectif,
                        seuil: entreprise?.seuil_remise_pourcentage ?? 15,
                      })}
                    </p>
                  )
                )}

                {totauxServeur && (Number(totauxServeur.tva) > 0 || (totauxServeur.autres_taxes || []).length > 0) && (
                  <div className="text-sm space-y-0.5 pt-1">
                    <div className="flex justify-between text-petrol-600"><span>{t('form.totalHT')}</span><span className="font-mono">{formatXOF(totauxServeur.ht)}</span></div>
                    {Number(totauxServeur.tva) > 0 && (
                      <div className="flex justify-between text-petrol-600"><span>{t('form.tva')}</span><span className="font-mono">{formatXOF(totauxServeur.tva)}</span></div>
                    )}
                    {(totauxServeur.autres_taxes || []).map((tx) => (
                      <div key={tx.nom} className="flex justify-between text-petrol-600"><span>{tx.nom} ({tx.taux}%)</span><span className="font-mono">{formatXOF(tx.montant)}</span></div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm font-medium text-petrol-700">{totauxServeur && Number(totauxServeur.total) !== Number(totauxServeur.ht) ? t('form.totalTTC') : t('form.total')}</span>
                  <span className="font-mono text-lg font-semibold">{formatXOF(total)}</span>
                </div>
              </div>

              {profil?.role === 'commercial' && (
                <div>
                  <label className="label">{t('form.venteRealiseePar')}</label>
                  <p className="text-sm text-petrol-600 border border-line rounded-lg px-3 py-2 bg-canvas">
                    {t('form.vousMeme')}
                  </p>
                </div>
              )}

              {creditDisponible > 0 && (
                <div className="border border-green-200 bg-green-50 rounded-lg p-3">
                  <label className="label">{t('form.creditDisponible', { montant: formatXOF(creditDisponible) })}</label>
                  <input
                    type="number"
                    min="0"
                    max={Math.min(creditDisponible, total)}
                    className="input-field"
                    value={creditUtilise}
                    onChange={(e) => setCreditUtilise(e.target.value)}
                    placeholder="0"
                  />
                  <p className="text-xs text-petrol-600 mt-1">{t('form.creditAide')}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('form.montantPayeMaintenant')}</label>
                  <input
                    type="number"
                    min="0"
                    max={Math.max(0, total - creditEffectif)}
                    className="input-field"
                    value={montantPaye}
                    onChange={(e) => setMontantPaye(e.target.value)}
                    placeholder={t('form.totalPlaceholder', { montant: formatXOF(Math.max(0, total - creditEffectif)) })}
                  />
                  <p className="text-xs text-petrol-500 mt-1">{t('form.laisserVide')}</p>
                </div>
                {(() => {
                  const restantApresCredit = Math.max(0, total - creditEffectif)
                  const montantPayeEffectif = montantPaye === '' ? restantApresCredit : Math.min(Number(montantPaye), restantApresCredit)
                  const resteAPayer = restantApresCredit - montantPayeEffectif
                  return resteAPayer > 0 ? (
                    <div>
                      <label className="label">{t('form.soldeAPayer', { montant: formatXOF(resteAPayer) })}</label>
                      <input
                        type="date" lang={i18n.language}
                        className="input-field"
                        value={dateEcheance}
                        onChange={(e) => setDateEcheance(e.target.value)}
                        placeholder={t('form.echeanceSolde')}
                      />
                      <p className="text-xs text-petrol-500 mt-1">{t('form.echeanceOptionnelle')}</p>
                    </div>
                  ) : (
                    <div className="flex items-end">
                      <p className="text-sm text-green-700 font-medium">{t('form.paiementIntegral')}</p>
                    </div>
                  )
                })()}
              </div>

              {(montantPaye === '' || Number(montantPaye) > 0) && (
                <div>
                  <label className="label">{t('form.modeReglement')}</label>
                  <select className="input-field" value={modeReglement} onChange={(e) => setModeReglement(e.target.value)}>
                    <option value="espece">{t('form.especes')}</option>
                    <option value="cheque">{t('form.cheque')}</option>
                    <option value="mobile_money">{t('form.mobileMoney')}</option>
                    <option value="virement">{t('form.virement')}</option>
                  </select>
                  {(() => {
                    // Timbre fiscal : dû sur la part payée en espèces (barème de l'entreprise).
                    if (modeReglement !== 'espece') return null
                    const restant = Math.max(0, total - creditEffectif)
                    const especes = montantPaye === '' ? restant : Math.min(Number(montantPaye), restant)
                    const timbre = calculerTimbre(entreprise, especes)
                    return timbre > 0 ? (
                      <p className="text-xs text-petrol-700 mt-1">
                        {t('form.timbre', { timbre: formatXOF(timbre), total: formatXOF(especes + timbre) })}
                      </p>
                    ) : null
                  })()}
                </div>
              )}

              {configFne.actif && (
                <label className="flex items-start gap-2 text-sm rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
                  <input type="checkbox" className="mt-0.5" checked={produireFne} onChange={(e) => setProduireFne(e.target.checked)} />
                  <span>
                    <span className="font-medium">{t('fne.produire')}</span>
                    <span className="block text-xs text-petrol-500">{t('fne.aideProduire')}</span>
                  </span>
                </label>
              )}

              {erreur && <div className="text-sm text-red-600">{erreur}</div>}

              <div className="flex gap-2 pt-2">
                <button data-aide="ventes.form.annuler" type="button" className="btn-secondary flex-1" onClick={() => setModalOuvert(false)}>
                  {t('form.annuler')}
                </button>
                <button type="submit" disabled={enregistrement} className="btn-primary flex-1">
                  {enregistrement ? t('form.enregistrement') : t('form.validerVente')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {venteOuverte && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {chargementDetail ? (
              <p className="text-sm text-petrol-500 text-center py-8">{t('detail.chargement')}</p>
            ) : detailVente ? (
              <>
                <div className="no-print flex justify-between items-start mb-4">
                  <div>
                    <h2 className="font-semibold text-lg">{entreprise?.nom}</h2>
                    <p className="text-xs text-petrol-500">
                      {t('detail.detailVente')}{(detailVente.vente?.fne_statut === 'certifiee' && detailVente.vente?.fne_reference) ? ` — ${detailVente.vente.fne_reference}` : detailVente.vente?.numero_vente ? ` — ${detailVente.vente.numero_vente}` : ''}
                    </p>
                  </div>
                  <button onClick={fermerDetailVente} className="text-petrol-400 hover:text-petrol-700 text-xl leading-none">
                    ✕
                  </button>
                </div>
                <div className="hidden print:block mb-4">
                  <h2 className="font-semibold text-lg">{entreprise?.nom}</h2>
                  <p className="text-xs text-petrol-500">{t('detail.recuDocumentInterne')}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm mb-4 pb-4 border-b border-line">
                  <div>
                    <p className="text-xs text-petrol-500">{t('detail.client')}</p>
                    <p className="font-medium">{detailVente.vente?.clients?.nom || '—'}</p>
                    {detailVente.vente?.clients?.telephone && (
                      <p className="text-petrol-600">{detailVente.vente.clients.telephone}</p>
                    )}
                    {detailVente.vente?.clients?.adresse && (
                      <p className="text-petrol-600">{detailVente.vente.clients.adresse}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-petrol-500">{t('detail.date')}</p>
                    <p className="font-medium">
                      {new Date(detailVente.vente?.created_at).toLocaleDateString('fr-FR', {
                        dateStyle: 'medium',
                      })}
                    </p>
                    <p className="text-xs text-petrol-500 mt-1">{t('detail.commercial')}</p>
                    <p className="text-petrol-700">{detailVente.vente?.commercial?.nom || t('bureau')}</p>
                    <p className="text-xs text-petrol-500">{t('saisiPar', { nom: detailVente.vente?.profils?.nom || '—' })}</p>
                  </div>
                </div>

                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="text-left text-xs text-petrol-500 border-b border-line">
                      <th className="font-medium pb-2">{t('detail.produit')}</th>
                      <th className="font-medium pb-2 text-right">{t('detail.qte')}</th>
                      <th className="font-medium pb-2 text-right">{t('detail.pu')}</th>
                      <th className="font-medium pb-2 text-right">{t('detail.sousTotal')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailVente.lignes.map((l, i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="py-2">{l.produits?.nom || '—'}</td>
                        <td className="py-2 text-right font-mono">{l.quantite}</td>
                        <td className="py-2 text-right font-mono">{formatXOF(l.prix_unitaire)}</td>
                        <td className="py-2 text-right font-mono">{formatXOF(l.sous_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex justify-between items-center pt-2 border-t border-line">
                  <div className="text-xs text-petrol-500">
                    {Number(detailVente.vente?.remise_montant) > 0 && (
                      <p className="text-blue-600">{t('detail.remiseAppliquee', { montant: formatXOF(detailVente.vente.remise_montant) })}</p>
                    )}
                    {(Number(detailVente.vente?.montant_tva) > 0 || Number(detailVente.vente?.montant_autres_taxes) > 0) && (
                      <>
                        <p>Total HT : {formatXOF(detailVente.vente.montant_ht)}</p>
                        {(() => {
                          const sousTotalBrut = detailVente.lignes.reduce((s, l) => s + Number(l.sous_total || 0), 0)
                          const facteurRemise = sousTotalBrut > 0 ? Number(detailVente.vente.montant_ht) / sousTotalBrut : 1
                          const tvaParTaux = {}
                          detailVente.lignes.forEach((l) => {
                            const taux = Number(l.taux_tva || 0)
                            if (taux > 0) tvaParTaux[taux] = (tvaParTaux[taux] || 0) + Number(l.montant_tva || 0)
                          })
                          return Object.entries(tvaParTaux)
                            .sort(([a], [b]) => Number(a) - Number(b))
                            .map(([taux, montantBrut]) => (
                              <p key={taux}>TVA ({taux}%) : {formatXOF(montantBrut * facteurRemise)}</p>
                            ))
                        })()}
                        {(detailVente.autresTaxes || []).map((tx, i) => (
                          <p key={i}>{tx.nom} ({tx.taux}%) : {formatXOF(tx.montant)}</p>
                        ))}
                      </>
                    )}
                    <p>{t('detail.modeDePaiement')} : <span className="capitalize">{detailVente.vente?.mode_paiement}</span></p>
                    <p>{t('detail.statut')} : <span className="capitalize">{detailVente.vente?.statut}</span></p>
                    <p>Montant réglé : {formatXOF(detailVente.vente?.montant_regle)}</p>
                    {Number(detailVente.vente?.montant_timbre) > 0 && (
                      <p>{t('export.timbre')} : {formatXOF(detailVente.vente.montant_timbre)}</p>
                    )}
                    {detailVente.vente?.montant_regle < detailVente.vente?.total && (
                      <p className="text-amber-600 font-medium">
                        {t('detail.resteARegler', { montant: formatXOF(detailVente.vente.total - detailVente.vente.montant_regle) })}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    {detailVente.vente?.total_initial != null && (
                      <>
                        <p className="text-xs text-petrol-500">{t('avoir.totalFacture')} : <span className="font-mono">{formatXOF(detailVente.vente.total_initial)}</span></p>
                        <p className="text-xs text-red-700">{t('avoir.totalAvoirs')} : <span className="font-mono">- {formatXOF(Number(detailVente.vente.total_initial) - Number(detailVente.vente.total))}</span></p>
                      </>
                    )}
                    <p className="text-xs text-petrol-500">{detailVente.vente?.total_initial != null ? t('avoir.totalNet') : t('detail.total')}</p>
                    <p className="font-mono text-xl font-semibold">{formatXOF(detailVente.vente?.total)}</p>
                  </div>
                </div>

                {detailVente.vente?.statut === 'annulee' && (
                  <p className="no-print text-sm font-medium text-red-700 border border-red-200 bg-red-50 rounded-lg p-3">{t('detail.venteAnnulee')}</p>
                )}

                {(detailVente.avoirs || []).length > 0 && (
                  <div className="no-print border border-line rounded-lg p-3 mt-3 space-y-2">
                    <p className="text-sm font-semibold">{t('avoir.listeTitre')}</p>
                    {detailVente.avoirs.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs border-t border-line pt-2 first:border-0 first:pt-0">
                        <span className="font-mono font-semibold">{a.numero || a.id.slice(0, 8)}</span>
                        <span className="text-petrol-500">{formatDate(a.created_at)}</span>
                        <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700">{t(`avoir.type_${a.type_avoir || 'annulation'}`)}</span>
                        <span className="font-mono text-red-700">- {formatXOF(a.montant)}</span>
                        {Number(a.trop_percu) > 0 && (
                          <span className="text-petrol-600">{a.trop_percu_traitement === 'a_rembourser' ? t('avoir.aRembourser', { montant: formatXOF(a.trop_percu) }) : t('avoir.auCredit', { montant: formatXOF(a.trop_percu) })}</span>
                        )}
                        {a.fne_reference && <a href={a.fne_token || '#'} target="_blank" rel="noreferrer" className="text-emerald-700 underline">FNE {a.fne_reference}</a>}
                        <span className="ml-auto flex gap-2">
                          {detailVente.vente?.fne_statut === 'certifiee' && !a.fne_reference && a.type_avoir !== 'prix' && a.numero && (
                            <button type="button" onClick={() => certifierAvoir(a)} className="text-emerald-700 underline">{t('avoir.certifierFne')}</button>
                          )}
                          <button type="button" onClick={() => telechargerAvoir(a)} className="underline">📄 PDF</button>
                        </span>
                        {a.motif && <p className="w-full text-petrol-500">{a.motif}</p>}
                        {a.fne_statut === 'erreur' && a.fne_erreur && <p className="w-full text-red-700">{a.fne_erreur}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {modeAnnulation && detailVente.vente?.statut !== 'annulee' && (
                  <div className="mt-3">
                    <FenetreAvoir
                      vente={detailVente.vente}
                      lignes={detailVente.lignes}
                      depots={depots}
                      configFne={configFne}
                      onFermer={() => setModeAnnulation(false)}
                      onTermine={async (res) => {
                        setModeAnnulation(false)
                        if (res?.alerte) alert(res.alerte)
                        await ouvrirDetailVente(detailVente.vente.id)
                        chargerVentes()
                      }}
                    />
                  </div>
                )}

                {(configFne.actif || detailVente.vente?.fne_statut) && (
                  <div className={`no-print rounded-lg border p-3 mt-3 text-sm ${detailVente.vente?.fne_statut === 'certifiee' ? 'border-emerald-200 bg-emerald-50/60' : detailVente.vente?.fne_statut === 'erreur' ? 'border-red-200 bg-red-50/60' : 'border-line'}`}>
                    {detailVente.vente?.fne_statut === 'certifiee' ? (
                      <>
                        <p className="font-medium text-emerald-800">✅ {t('fne.certifiee')}</p>
                        <p className="text-xs font-mono">{detailVente.vente.fne_reference}</p>
                        {detailVente.vente.fne_token && <a href={detailVente.vente.fne_token} target="_blank" rel="noreferrer" className="text-xs underline text-emerald-800">{t('fne.verifier')}</a>}
                        {detailVente.vente.fne_avoir_reference && <p className="text-xs text-red-700 mt-1">{t('fne.avoir', { ref: detailVente.vente.fne_avoir_reference })}</p>}
                      </>
                    ) : (
                      <>
                        <p className="font-medium">{detailVente.vente?.fne_statut === 'erreur' ? `⚠️ ${t('fne.erreur')}` : t('fne.nonCertifiee')}</p>
                        {detailVente.vente?.fne_erreur && <p className="text-xs text-red-700">{detailVente.vente.fne_erreur}</p>}
                        {configFne.actif && detailVente.vente?.statut !== 'annulee' && (
                          <button className="btn-primary text-xs mt-2" disabled={certificationEnCours} onClick={certifierMaintenant}>
                            {certificationEnCours ? t('fne.enCours') : (detailVente.vente?.fne_statut === 'erreur' ? t('fne.reessayer') : t('fne.certifier'))}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}

                <div className="no-print flex gap-2 pt-4 mt-2 border-t border-line flex-wrap">
                  <button data-aide="ventes.detail.imprimer" onClick={() => window.print()} className="btn-secondary text-xs flex-1">
                    {t('detail.imprimer')}
                  </button>
                  <button data-aide="ventes.detail.pdf" onClick={telechargerRecu} className="btn-secondary text-xs flex-1">
                    {t('detail.pdf')}
                  </button>
                  <button data-aide="ventes.detail.bonLivraison" onClick={telechargerBonLivraison} className="btn-secondary text-xs flex-1">
                    {t('detail.bonLivraison')}
                  </button>
                  <button data-aide="ventes.detail.partager" onClick={partagerRecu} className="btn-primary text-xs flex-1">
                    {t('detail.partager')}
                  </button>
                  <button data-aide="ventes.detail.email" onClick={envoyerEmailDetail} disabled={envoiDocument} className="btn-secondary text-xs flex-1">
                    📧 {t('envoi.email')}
                  </button>
                  <button data-aide="ventes.detail.whatsapp" onClick={envoyerWhatsAppDetail} disabled={envoiDocument} className="btn-3d text-xs flex-1 px-3 py-2" style={{ background: 'linear-gradient(180deg,#4ade80,#16a34a 60%,#15803d)' }}>
                    💬 WhatsApp
                  </button>
                  {['admin', 'manager', 'comptable'].includes(profil?.role) && detailVente.vente?.statut !== 'annulee' && !modeAnnulation && (
                    <button data-aide="ventes.detail.annulerVenteAvoir" onClick={() => setModeAnnulation(true)} className="text-xs text-red-600 underline w-full text-center pt-1">
                      {t('avoir.ouvrir')}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-red-600 text-center py-8">{t('detail.impossibleChargerDetail')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

