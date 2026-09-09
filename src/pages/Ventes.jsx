import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { accesAutorise } from '../lib/accesRole'
import { exporterExcel, exporterPDF, genererRecuVente, genererBonLivraison, genererFactureAvoir, formatMontantPDF } from '../lib/export'
import SelectRecherche from '../components/SelectRecherche'
import { traduireErreur } from '../lib/erreurs'

export default function Ventes() {
  const { t } = useTranslation('ventes')
  const { entreprise, profil } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [ventes, setVentes] = useState([])
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
  const [motifAnnulation, setMotifAnnulation] = useState('')
  const [envoiAnnulation, setEnvoiAnnulation] = useState(false)
  const [erreurAnnulation, setErreurAnnulation] = useState('')
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
  })

  const [clientId, setClientId] = useState('')
  const [tarifsClient, setTarifsClient] = useState({}) // { produit_id: prix_negocie }
  const [creditDisponible, setCreditDisponible] = useState(0)
  const [creditUtilise, setCreditUtilise] = useState('')
  const [commercialVendeurId, setCommercialVendeurId] = useState('')
  const [depotId, setDepotId] = useState('')
  const [stocksParDepot, setStocksParDepot] = useState({}) // { produit_id: { depot_id: quantite } }
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

    let selectStr = 'id, numero_vente, total, created_at, statut, clients!inner(nom, ville), profils!created_by(nom)'
    selectStr += filtres.produitId ? ', ventes_lignes!inner(id, produit_id)' : ', ventes_lignes(id)'

    let requete = supabase.from('ventes').select(selectStr).order('created_at', { ascending: false }).limit(200)

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
    if (filtres.commercialId) requete = requete.eq('created_by', filtres.commercialId)
    if (filtres.produitId) requete = requete.eq('ventes_lignes.produit_id', filtres.produitId)
    if (profil?.role === 'commercial' && !profil?.acces_etendu) {
      requete = requete.eq('commercial_id', profil.id)
    }

    const { data, error } = await requete
    if (!error) setVentes(data || [])
    else console.error('Erreur chargement ventes:', error)
    setChargement(false)
  }

  async function ouvrirDetailVente(venteId) {
    setVenteOuverte(venteId)
    setChargementDetail(true)
    setDetailVente(null)

    const [{ data: vente }, { data: lignes }, { data: autresTaxes }] = await Promise.all([
      supabase
        .from('ventes')
        .select('id, numero_vente, numero_bl, total, created_at, mode_paiement, mode_reglement, statut, montant_regle, remise_montant, notes, montant_ht, montant_tva, montant_autres_taxes, clients(nom, telephone, adresse, ville), profils!created_by(nom)')
        .eq('id', venteId)
        .single(),
      supabase
        .from('ventes_lignes')
        .select('quantite, prix_unitaire, sous_total, taux_tva, montant_tva, produits(nom)')
        .eq('vente_id', venteId),
      supabase
        .from('ventes_taxes')
        .select('nom, taux, montant, base_calcul')
        .eq('vente_id', venteId),
    ])

    setDetailVente({ vente, lignes: lignes || [], autresTaxes: autresTaxes || [] })
    setChargementDetail(false)
  }

  function fermerDetailVente() {
    setVenteOuverte(null)
    setDetailVente(null)
    setModeAnnulation(false)
    setMotifAnnulation('')
    setErreurAnnulation('')
  }

  async function confirmerAnnulation() {
    if (!motifAnnulation.trim()) {
      setErreurAnnulation(t('detail.erreurMotifObligatoire'))
      return
    }
    setEnvoiAnnulation(true)
    setErreurAnnulation('')
    const motif = motifAnnulation.trim()
    const { error } = await supabase.rpc('creer_avoir', {
      p_vente_id: venteOuverte,
      p_motif: motif,
    })
    setEnvoiAnnulation(false)
    if (error) {
      setErreurAnnulation(`Erreur : ${traduireErreur(error.message)}`)
      return
    }

    // Génère la facture d'avoir à partir de ce qu'on a déjà sous la main
    // (détail de la vente encore ouvert) plutôt que de tout recharger.
    const { data: avoir } = await supabase
      .from('avoirs')
      .select('id, montant, created_at')
      .eq('vente_id', venteOuverte)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (avoir && detailVente) {
      const doc = genererFactureAvoir({
        entreprise,
        client: detailVente.vente?.clients,
        vente: detailVente.vente,
        lignes: detailVente.lignes,
        motif,
        montant: avoir.montant,
        date: avoir.created_at,
        reference: avoir.id.slice(0, 8),
      })
      doc.save(`avoir-${avoir.id.slice(0, 8)}.pdf`)
    }

    setModeAnnulation(false)
    setMotifAnnulation('')
    await ouvrirDetailVente(venteOuverte)
    chargerVentes()
  }

  function telechargerRecu() {
    if (!detailVente) return
    const doc = genererRecuVente({ entreprise, vente: detailVente.vente, lignes: detailVente.lignes, autresTaxes: detailVente.autresTaxes })
    doc.save(`recu-vente-${detailVente.vente.id.slice(0, 8)}.pdf`)
  }

  function telechargerBonLivraison() {
    if (!detailVente) return
    const doc = genererBonLivraison({ entreprise, vente: detailVente.vente, lignes: detailVente.lignes })
    doc.save(`${detailVente.vente.numero_bl || 'bon-livraison-' + detailVente.vente.id.slice(0, 8)}.pdf`)
  }

  async function telechargerFactureAvoir() {
    if (!detailVente) return
    const { data: avoir } = await supabase
      .from('avoirs')
      .select('id, montant, motif, created_at')
      .eq('vente_id', detailVente.vente.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (!avoir) return
    const doc = genererFactureAvoir({
      entreprise,
      client: detailVente.vente?.clients,
      vente: detailVente.vente,
      lignes: detailVente.lignes,
      motif: avoir.motif,
      montant: avoir.montant,
      date: avoir.created_at,
      reference: avoir.id.slice(0, 8),
    })
    doc.save(`avoir-${avoir.id.slice(0, 8)}.pdf`)
  }

  async function partagerRecu() {
    if (!detailVente) return
    const doc = genererRecuVente({ entreprise, vente: detailVente.vente, lignes: detailVente.lignes, autresTaxes: detailVente.autresTaxes })
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
      doc.save(`recu-vente-${detailVente.vente.id.slice(0, 8)}.pdf`)
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

    const [{ data: c }, { data: p }, { data: com }, { data: d }] = await Promise.all([
      supabase.from('clients').select('id, nom').order('nom'),
      supabase.from('produits').select('id, nom, prix_vente, stocks(quantite, depot_id)').order('nom'),
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
    if (profil?.role === 'commercial') return // le commercial vend depuis son stock en main, pas un dépôt
    setProduits((prev) =>
      prev.map((pr) => ({ ...pr, quantite_stock: nouveauDepotId ? (stocksParDepot[pr.id]?.[nouveauDepotId] ?? 0) : 0 }))
    )
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
  const total = sousTotal - remiseEffective
  const creditEffectif = Math.min(Math.max(Number(creditUtilise || 0), 0), creditDisponible, total)
  const totalFiltre = ventes.reduce((s, v) => (v.statut === 'annulee' ? s : s + Number(v.total || 0)), 0)

  const COLONNES_EXPORT = [
    { cle: 'numero', titre: 'N° vente' },
    { cle: 'date', titre: 'Date' },
    { cle: 'client', titre: 'Client' },
    { cle: 'ville', titre: 'Ville' },
    { cle: 'commercial', titre: 'Commercial' },
    { cle: 'articles', titre: 'Articles', alignDroite: true },
    { cle: 'total', titre: 'Total (F CFA)', alignDroite: true },
  ]
  function donneesExport() {
    return ventes.map((v) => ({
      numero: v.numero_vente || '—',
      date: new Date(v.created_at).toLocaleDateString('fr-FR'),
      client: v.clients?.nom || '—',
      ville: v.clients?.ville || '—',
      commercial: v.profils?.nom || '—',
      articles: v.ventes_lignes?.length || 0,
      total: Number(v.total || 0),
    }))
  }
  function exportExcel() {
    exporterExcel('ventes', COLONNES_EXPORT, donneesExport())
  }
  function exportPDF() {
    exporterPDF('ventes', 'Ventes', null, COLONNES_EXPORT, donneesExport(), 'Total', formatMontantPDF(totalFiltre) + ' F CFA', entreprise)
  }

  async function validerVente(e) {
    e.preventDefault()
    setErreur('')

    if (!clientId) {
      setErreur(t('form.erreurSelectionnerClient'))
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

    setEnregistrement(true)
    const { data: nouvelleVenteId, error } = await supabase.rpc('creer_vente', {
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
    })
    setEnregistrement(false)

    if (error) {
      console.error('Erreur creer_vente:', error)
      setErreur(`${t('form.erreurCreationVente')} : ${traduireErreur(error.message)}`)
      return
    }
    setModalOuvert(false)
    chargerVentes()
    if (nouvelleVenteId && montantPayeEffectif > 0) ouvrirDetailVente(nouvelleVenteId)
  }

  if (!accesAutorise('ventes', profil?.role)) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">{t('accesRefuse')}</p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{t('titre')}</h1>
          <p className="text-sm text-petrol-700 mt-1">
            {ventes.length} {t('compteur_venteS')} — {t('totalFiltre')} : <span className="font-mono font-medium">{formatXOF(totalFiltre)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary text-sm" onClick={exportExcel} disabled={ventes.length === 0}>
            📊 {t('excel')}
          </button>
          <button className="btn-secondary text-sm" onClick={exportPDF} disabled={ventes.length === 0}>
            📄 {t('pdf')}
          </button>
          <button className="btn-primary" onClick={ouvrirModal}>
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
                type="date"
                className="input-field"
                value={filtres.dateDebut}
                onChange={(e) => setFiltres({ ...filtres, dateDebut: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t('filtres.au')}</label>
              <input
                type="date"
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
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
              <th className="px-4 py-3 font-medium">{t('table.date')}</th>
              <th className="px-4 py-3 font-medium">{t('table.client')}</th>
              <th className="px-4 py-3 font-medium">{t('table.ville')}</th>
              <th className="px-4 py-3 font-medium">{t('table.commercial')}</th>
              <th className="px-4 py-3 font-medium">{t('table.articles')}</th>
              <th className="px-4 py-3 font-medium text-right">{t('table.total')}</th>
            </tr>
          </thead>
          <tbody>
            {chargement ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-petrol-500">{t('table.chargement')}</td></tr>
            ) : ventes.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-petrol-500">{t('table.aucuneVente')}</td></tr>
            ) : (
              ventes.map((v) => (
                <tr
                  key={v.id}
                  onClick={() => ouvrirDetailVente(v.id)}
                  className={`border-b border-line last:border-0 hover:bg-canvas/60 cursor-pointer ${v.statut === 'annulee' ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-3 text-petrol-700">
                    {new Date(v.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {v.clients?.nom || '—'}
                    {v.statut === 'annulee' && (
                      <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{t('table.annulee')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-petrol-700">{v.clients?.ville || '—'}</td>
                  <td className="px-4 py-3 text-petrol-700">{v.profils?.nom || '—'}</td>
                  <td className="px-4 py-3 text-petrol-700">{t('table.nbArticles', { n: v.ventes_lignes?.length || 0 })}</td>
                  <td className="px-4 py-3 font-mono text-right">{formatXOF(v.total)}</td>
                </tr>
              ))
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

              {profil?.role !== 'commercial' && depots.length > 1 && (
                <div>
                  <label className="label">{t('form.depotVente')}</label>
                  <select className="input-field" value={depotId} onChange={(e) => changerDepot(e.target.value)}>
                    <option value="">{t('form.selectionnerDepot')}</option>
                    {depots.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
                  </select>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">{t('form.articles')}</label>
                  <button type="button" onClick={ajouterLigne} className="text-xs font-medium text-amber-600 hover:text-amber-700">
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
                          {produits.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nom} ({profil?.role === 'commercial' ? t('form.enMain') : t('form.stock')}: {p.quantite_stock})
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
                          {produit && ligne.quantite > produit.quantite_stock && (
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

                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm font-medium text-petrol-700">{t('form.total')}</span>
                  <span className="font-mono text-lg font-semibold">{formatXOF(total)}</span>
                </div>
              </div>

              <div>
                <label className="label">{t('form.venteRealiseePar')}</label>
                {profil?.role === 'commercial' ? (
                  <p className="text-sm text-petrol-600 border border-line rounded-lg px-3 py-2 bg-canvas">
                    {t('form.vousMeme')}
                  </p>
                ) : (
                  <select
                    className="input-field"
                    value={commercialVendeurId}
                    onChange={(e) => setCommercialVendeurId(e.target.value)}
                  >
                    <option value="">{t('form.venteDeBureau')}</option>
                    {commerciaux.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                )}
              </div>

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
                        type="date"
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
                </div>
              )}

              {erreur && <div className="text-sm text-red-600">{erreur}</div>}

              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setModalOuvert(false)}>
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
                      {t('detail.detailVente')}{detailVente.vente?.numero_vente ? ` — ${detailVente.vente.numero_vente}` : ''}
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
                    <p className="text-petrol-700">{detailVente.vente?.profils?.nom || '—'}</p>
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
                    {detailVente.vente?.montant_regle < detailVente.vente?.total && (
                      <p className="text-amber-600 font-medium">
                        {t('detail.resteARegler', { montant: formatXOF(detailVente.vente.total - detailVente.vente.montant_regle) })}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-petrol-500">{t('detail.total')}</p>
                    <p className="font-mono text-xl font-semibold">{formatXOF(detailVente.vente?.total)}</p>
                  </div>
                </div>

                {detailVente.vente?.statut === 'annulee' ? (
                  <div className="no-print border border-red-200 bg-red-50 rounded-lg p-3 space-y-2">
                    <p className="text-sm font-medium text-red-700">{t('detail.venteAnnulee')}</p>
                    <button onClick={telechargerFactureAvoir} className="text-xs text-red-700 underline">
                      {t('detail.telechargerAvoir')}
                    </button>
                  </div>
                ) : modeAnnulation ? (
                  <div className="no-print border border-red-200 bg-red-50 rounded-lg p-3 space-y-2">
                    <label className="text-sm font-medium text-red-700">{t('detail.motifAnnulationLabel')}</label>
                    <textarea
                      className="input-field text-sm"
                      rows={2}
                      value={motifAnnulation}
                      onChange={(e) => setMotifAnnulation(e.target.value)}
                      placeholder={t('detail.motifAnnulationPlaceholder')}
                    />
                    {erreurAnnulation && <p className="text-xs text-red-600">{erreurAnnulation}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-secondary text-xs flex-1"
                        onClick={() => { setModeAnnulation(false); setMotifAnnulation(''); setErreurAnnulation('') }}
                      >
                        {t('detail.retour')}
                      </button>
                      <button
                        onClick={confirmerAnnulation}
                        disabled={envoiAnnulation}
                        className="bg-red-600 text-white text-xs flex-1 rounded px-3 py-2 disabled:opacity-50"
                      >
                        {envoiAnnulation ? t('detail.envoi') : t('detail.confirmerAnnulation')}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="no-print flex gap-2 pt-4 mt-2 border-t border-line flex-wrap">
                  <button onClick={() => window.print()} className="btn-secondary text-xs flex-1">
                    {t('detail.imprimer')}
                  </button>
                  <button onClick={telechargerRecu} className="btn-secondary text-xs flex-1">
                    {t('detail.pdf')}
                  </button>
                  <button onClick={telechargerBonLivraison} className="btn-secondary text-xs flex-1">
                    {t('detail.bonLivraison')}
                  </button>
                  <button onClick={partagerRecu} className="btn-primary text-xs flex-1">
                    {t('detail.partager')}
                  </button>
                  {['admin', 'manager'].includes(profil?.role) && detailVente.vente?.statut !== 'annulee' && !modeAnnulation && (
                    <button onClick={() => setModeAnnulation(true)} className="text-xs text-red-600 underline w-full text-center pt-1">
                      {t('detail.annulerVenteAvoir')}
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

function formatXOF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0) + ' F CFA'
}
