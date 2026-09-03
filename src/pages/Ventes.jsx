import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { exporterExcel, exporterPDF, genererRecuVente, genererBonLivraison, formatMontantPDF } from '../lib/export'
import SelectRecherche from '../components/SelectRecherche'

export default function Ventes() {
  const { entreprise, profil } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [ventes, setVentes] = useState([])
  const [clients, setClients] = useState([])
  const [produits, setProduits] = useState([])
  const [commerciaux, setCommerciaux] = useState([])
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
  const [commercialVendeurId, setCommercialVendeurId] = useState('')
  const [montantPaye, setMontantPaye] = useState('')
  const [remiseMontant, setRemiseMontant] = useState('')
  const [motifRemise, setMotifRemise] = useState('')
  const [modeReglement, setModeReglement] = useState('espece')
  const [dateEcheance, setDateEcheance] = useState('')
  const [lignes, setLignes] = useState([{ produit_id: '', quantite: 1, prix_unitaire: 0 }])

  useEffect(() => {
    chargerReferences()
  }, [])

  useEffect(() => {
    chargerVentes()
  }, [filtres])

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

    const { data, error } = await requete
    if (!error) setVentes(data || [])
    else console.error('Erreur chargement ventes:', error)
    setChargement(false)
  }

  async function ouvrirDetailVente(venteId) {
    setVenteOuverte(venteId)
    setChargementDetail(true)
    setDetailVente(null)

    const [{ data: vente }, { data: lignes }] = await Promise.all([
      supabase
        .from('ventes')
        .select('id, numero_vente, numero_bl, total, created_at, mode_paiement, mode_reglement, statut, montant_regle, remise_montant, notes, clients(nom, telephone, adresse, ville), profils!created_by(nom)')
        .eq('id', venteId)
        .single(),
      supabase
        .from('ventes_lignes')
        .select('quantite, prix_unitaire, sous_total, produits(nom)')
        .eq('vente_id', venteId),
    ])

    setDetailVente({ vente, lignes: lignes || [] })
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
      setErreurAnnulation('Le motif est obligatoire.')
      return
    }
    setEnvoiAnnulation(true)
    setErreurAnnulation('')
    const { error } = await supabase.rpc('creer_avoir', {
      p_vente_id: venteOuverte,
      p_motif: motifAnnulation.trim(),
    })
    setEnvoiAnnulation(false)
    if (error) {
      setErreurAnnulation(`Erreur : ${error.message}`)
      return
    }
    setModeAnnulation(false)
    setMotifAnnulation('')
    await ouvrirDetailVente(venteOuverte)
    chargerVentes()
  }

  function telechargerRecu() {
    if (!detailVente) return
    const doc = genererRecuVente({ entreprise, vente: detailVente.vente, lignes: detailVente.lignes })
    doc.save(`recu-vente-${detailVente.vente.id.slice(0, 8)}.pdf`)
  }

  function telechargerBonLivraison() {
    if (!detailVente) return
    const doc = genererBonLivraison({ entreprise, vente: detailVente.vente, lignes: detailVente.lignes })
    doc.save(`${detailVente.vente.numero_bl || 'bon-livraison-' + detailVente.vente.id.slice(0, 8)}.pdf`)
  }

  async function partagerRecu() {
    if (!detailVente) return
    const doc = genererRecuVente({ entreprise, vente: detailVente.vente, lignes: detailVente.lignes })
    const blob = doc.output('blob')
    const fichier = new File([blob], `recu-vente-${detailVente.vente.id.slice(0, 8)}.pdf`, { type: 'application/pdf' })

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [fichier] })) {
      try {
        await navigator.share({
          files: [fichier],
          title: 'Reçu de vente',
          text: `Reçu de vente — ${entreprise?.nom || ''}`,
        })
      } catch (e) {
        // Annulation par l'utilisateur : ne rien faire
      }
    } else {
      alert("Le partage direct n'est pas disponible sur ce navigateur. Téléchargez le PDF puis partagez-le manuellement (WhatsApp, email…).")
      doc.save(`recu-vente-${detailVente.vente.id.slice(0, 8)}.pdf`)
    }
  }

  async function ouvrirModal() {
    setErreur('')
    setClientId('')
    setTarifsClient({})
    setMontantPaye('')
    setRemiseMontant('')
    setMotifRemise('')
    setModeReglement('espece')
    setDateEcheance('')
    setLignes([{ produit_id: '', quantite: 1, prix_unitaire: 0 }])
    setCommercialVendeurId(profil?.role === 'commercial' ? profil.id : '')
    const [{ data: c }, { data: p }, { data: com }] = await Promise.all([
      supabase.from('clients').select('id, nom').order('nom'),
      supabase.from('produits').select('id, nom, prix_vente, stocks(quantite)').order('nom'),
      supabase.from('profils').select('id, nom').eq('role', 'commercial').order('nom'),
    ])
    setClients(c || [])
    setProduits((p || []).map((pr) => ({ ...pr, quantite_stock: pr.stocks?.[0]?.quantite ?? 0 })))
    setCommerciaux(com || [])
    setModalOuvert(true)
  }

  function ajouterLigne() {
    setLignes([...lignes, { produit_id: '', quantite: 1, prix_unitaire: 0 }])
  }

  function retirerLigne(index) {
    setLignes(lignes.filter((_, i) => i !== index))
  }

  async function changerClient(nouveauClientId) {
    setClientId(nouveauClientId)
    if (!nouveauClientId) {
      setTarifsClient({})
      return
    }
    const { data } = await supabase.from('tarifs_client').select('produit_id, prix_negocie').eq('client_id', nouveauClientId)
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
  const remiseEffective = Math.min(Number(remiseMontant || 0), sousTotal)
  const total = sousTotal - remiseEffective
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
      setErreur('Sélectionnez un client.')
      return
    }
    const lignesValides = lignes.filter((l) => l.produit_id && Number(l.quantite) > 0)
    if (lignesValides.length === 0) {
      setErreur('Ajoutez au moins un article valide.')
      return
    }

    if (remiseEffective > 0 && !motifRemise.trim()) {
      setErreur('Un motif est requis pour appliquer une remise.')
      return
    }

    const montantPayeEffectif = montantPaye === '' ? total : Math.min(Number(montantPaye), total)
    const resteAPayer = total - montantPayeEffectif

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
    })
    setEnregistrement(false)

    if (error) {
      console.error('Erreur creer_vente:', error)
      setErreur(`Erreur (création vente) : ${error.message || 'inconnue'}`)
      return
    }
    setModalOuvert(false)
    chargerVentes()
    if (nouvelleVenteId && montantPayeEffectif > 0) ouvrirDetailVente(nouvelleVenteId)
  }

  return (
    <div className="p-8 max-w-6xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Ventes</h1>
          <p className="text-sm text-petrol-700 mt-1">
            {ventes.length} vente(s) — Total filtré : <span className="font-mono font-medium">{formatXOF(totalFiltre)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary text-sm" onClick={exportExcel} disabled={ventes.length === 0}>
            📊 Excel
          </button>
          <button className="btn-secondary text-sm" onClick={exportPDF} disabled={ventes.length === 0}>
            📄 PDF
          </button>
          <button className="btn-primary" onClick={ouvrirModal}>
            + Nouvelle vente
          </button>
        </div>
      </header>

      <div className="card p-4 mb-4 grid grid-cols-2 md:grid-cols-5 gap-3">
        <div>
          <label className="label">Période</label>
          <select
            className="input-field"
            value={filtres.periode}
            onChange={(e) => setFiltres({ ...filtres, periode: e.target.value })}
          >
            <option value="tout">Tout</option>
            <option value="jour">Aujourd'hui</option>
            <option value="mois">Ce mois</option>
            <option value="personnalise">Personnalisée…</option>
          </select>
        </div>
        {filtres.periode === 'personnalise' && (
          <div className="col-span-2 grid grid-cols-2 gap-3">
            <div>
              <label className="label">Du</label>
              <input
                type="date"
                className="input-field"
                value={filtres.dateDebut}
                onChange={(e) => setFiltres({ ...filtres, dateDebut: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Au</label>
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
          <label className="label">Commercial</label>
          <select
            className="input-field"
            value={filtres.commercialId}
            onChange={(e) => setFiltres({ ...filtres, commercialId: e.target.value })}
          >
            <option value="">Tous</option>
            {commerciaux.map((c) => (
              <option key={c.id} value={c.id}>{c.nom}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Magasin / client</label>
          <select
            className="input-field"
            value={filtres.clientId}
            onChange={(e) => setFiltres({ ...filtres, clientId: e.target.value })}
          >
            <option value="">Tous</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.nom}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Zone / ville</label>
          <select
            className="input-field"
            value={filtres.ville}
            onChange={(e) => setFiltres({ ...filtres, ville: e.target.value })}
          >
            <option value="">Toutes</option>
            {villes.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Produit</label>
          <select
            className="input-field"
            value={filtres.produitId}
            onChange={(e) => setFiltres({ ...filtres, produitId: e.target.value })}
          >
            <option value="">Tous</option>
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
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Ville</th>
              <th className="px-4 py-3 font-medium">Commercial</th>
              <th className="px-4 py-3 font-medium">Articles</th>
              <th className="px-4 py-3 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {chargement ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-petrol-500">Chargement…</td></tr>
            ) : ventes.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-petrol-500">Aucune vente pour ces filtres.</td></tr>
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
                      <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Annulée</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-petrol-700">{v.clients?.ville || '—'}</td>
                  <td className="px-4 py-3 text-petrol-700">{v.profils?.nom || '—'}</td>
                  <td className="px-4 py-3 text-petrol-700">{v.ventes_lignes?.length || 0} article(s)</td>
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
            <h2 className="font-semibold text-lg mb-4">Nouvelle vente</h2>
            <form onSubmit={validerVente} className="space-y-4">
              <div>
                <label className="label">Client *</label>
                <SelectRecherche
                  options={clients}
                  value={clientId}
                  onChange={changerClient}
                  placeholder="Rechercher un client…"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Articles</label>
                  <button type="button" onClick={ajouterLigne} className="text-xs font-medium text-amber-600 hover:text-amber-700">
                    + Ajouter un article
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
                          <option value="">Produit…</option>
                          {produits.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nom} (stock: {p.quantite_stock})
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="1"
                          className="input-field col-span-2 font-mono"
                          value={ligne.quantite}
                          onChange={(e) => modifierLigne(i, 'quantite', e.target.value)}
                          placeholder="Qté"
                        />
                        <input
                          type="number"
                          className="input-field col-span-3 font-mono"
                          value={ligne.prix_unitaire}
                          onChange={(e) => modifierLigne(i, 'prix_unitaire', e.target.value)}
                        />
                        <div className="col-span-1 font-mono text-xs text-petrol-700 text-right">
                          {ligne.produit_id && tarifsClient[ligne.produit_id] != null && (
                            <span className="text-green-600" title="Tarif négocié appliqué">%</span>
                          )}
                          {produit && ligne.quantite > produit.quantite_stock && (
                            <span className="text-red-600">stock!</span>
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
                  <span>Sous-total</span>
                  <span className="font-mono">{formatXOF(sousTotal)}</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Remise (F CFA)</label>
                    <input
                      type="number"
                      min="0"
                      max={sousTotal}
                      className="input-field"
                      value={remiseMontant}
                      onChange={(e) => setRemiseMontant(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  {remiseEffective > 0 && (
                    <div>
                      <label className="label">Motif de la remise</label>
                      <input
                        className="input-field"
                        value={motifRemise}
                        onChange={(e) => setMotifRemise(e.target.value)}
                        placeholder="Ex. geste commercial, gros volume…"
                      />
                    </div>
                  )}
                </div>

                {remiseEffective > 0 && sousTotal > 0 && profil?.role === 'commercial' && (
                  (remiseEffective / sousTotal) * 100 > (entreprise?.seuil_remise_pourcentage ?? 15) && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                      ⚠️ Cette remise ({((remiseEffective / sousTotal) * 100).toFixed(1)}%) dépasse le seuil autorisé
                      ({entreprise?.seuil_remise_pourcentage ?? 15}%). Un manager ou administrateur doit la valider.
                    </p>
                  )
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm font-medium text-petrol-700">Total</span>
                  <span className="font-mono text-lg font-semibold">{formatXOF(total)}</span>
                </div>
              </div>

              <div>
                <label className="label">Vente réalisée par (stock terrain)</label>
                {profil?.role === 'commercial' ? (
                  <p className="text-sm text-petrol-600 border border-line rounded-lg px-3 py-2 bg-canvas">
                    Vous-même — débitée de votre stock en main
                  </p>
                ) : (
                  <select
                    className="input-field"
                    value={commercialVendeurId}
                    onChange={(e) => setCommercialVendeurId(e.target.value)}
                  >
                    <option value="">Vente de bureau (débite le stock magasin)</option>
                    {commerciaux.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Montant payé maintenant</label>
                  <input
                    type="number"
                    min="0"
                    max={total}
                    className="input-field"
                    value={montantPaye}
                    onChange={(e) => setMontantPaye(e.target.value)}
                    placeholder={`Total : ${formatXOF(total)}`}
                  />
                  <p className="text-xs text-petrol-500 mt-1">Laissez vide pour un paiement intégral (cash).</p>
                </div>
                {(() => {
                  const montantPayeEffectif = montantPaye === '' ? total : Math.min(Number(montantPaye), total)
                  const resteAPayer = total - montantPayeEffectif
                  return resteAPayer > 0 ? (
                    <div>
                      <label className="label">Solde à payer : {formatXOF(resteAPayer)}</label>
                      <input
                        type="date"
                        className="input-field"
                        value={dateEcheance}
                        onChange={(e) => setDateEcheance(e.target.value)}
                        placeholder="Échéance du solde"
                      />
                      <p className="text-xs text-petrol-500 mt-1">Échéance du solde (optionnel)</p>
                    </div>
                  ) : (
                    <div className="flex items-end">
                      <p className="text-sm text-green-700 font-medium">✓ Paiement intégral</p>
                    </div>
                  )
                })()}
              </div>

              {(montantPaye === '' || Number(montantPaye) > 0) && (
                <div>
                  <label className="label">Mode de règlement</label>
                  <select className="input-field" value={modeReglement} onChange={(e) => setModeReglement(e.target.value)}>
                    <option value="espece">Espèces</option>
                    <option value="cheque">Chèque</option>
                    <option value="mobile_money">Mobile Money</option>
                    <option value="virement">Virement bancaire</option>
                  </select>
                </div>
              )}

              {erreur && <div className="text-sm text-red-600">{erreur}</div>}

              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setModalOuvert(false)}>
                  Annuler
                </button>
                <button type="submit" disabled={enregistrement} className="btn-primary flex-1">
                  {enregistrement ? 'Enregistrement…' : 'Valider la vente'}
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
              <p className="text-sm text-petrol-500 text-center py-8">Chargement…</p>
            ) : detailVente ? (
              <>
                <div className="no-print flex justify-between items-start mb-4">
                  <div>
                    <h2 className="font-semibold text-lg">{entreprise?.nom}</h2>
                    <p className="text-xs text-petrol-500">
                      Détail de vente{detailVente.vente?.numero_vente ? ` — ${detailVente.vente.numero_vente}` : ''}
                    </p>
                  </div>
                  <button onClick={fermerDetailVente} className="text-petrol-400 hover:text-petrol-700 text-xl leading-none">
                    ✕
                  </button>
                </div>
                <div className="hidden print:block mb-4">
                  <h2 className="font-semibold text-lg">{entreprise?.nom}</h2>
                  <p className="text-xs text-petrol-500">Reçu de vente — document interne</p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm mb-4 pb-4 border-b border-line">
                  <div>
                    <p className="text-xs text-petrol-500">Client</p>
                    <p className="font-medium">{detailVente.vente?.clients?.nom || '—'}</p>
                    {detailVente.vente?.clients?.telephone && (
                      <p className="text-petrol-600">{detailVente.vente.clients.telephone}</p>
                    )}
                    {detailVente.vente?.clients?.adresse && (
                      <p className="text-petrol-600">{detailVente.vente.clients.adresse}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-petrol-500">Date</p>
                    <p className="font-medium">
                      {new Date(detailVente.vente?.created_at).toLocaleDateString('fr-FR', {
                        dateStyle: 'medium',
                      })}
                    </p>
                    <p className="text-xs text-petrol-500 mt-1">Commercial</p>
                    <p className="text-petrol-700">{detailVente.vente?.profils?.nom || '—'}</p>
                  </div>
                </div>

                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="text-left text-xs text-petrol-500 border-b border-line">
                      <th className="font-medium pb-2">Produit</th>
                      <th className="font-medium pb-2 text-right">Qté</th>
                      <th className="font-medium pb-2 text-right">PU</th>
                      <th className="font-medium pb-2 text-right">Sous-total</th>
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
                      <p className="text-blue-600">Remise appliquée : {formatXOF(detailVente.vente.remise_montant)}</p>
                    )}
                    <p>Mode de paiement : <span className="capitalize">{detailVente.vente?.mode_paiement}</span></p>
                    <p>Statut : <span className="capitalize">{detailVente.vente?.statut}</span></p>
                    {detailVente.vente?.montant_regle < detailVente.vente?.total && (
                      <p className="text-amber-600 font-medium">
                        Reste à régler : {formatXOF(detailVente.vente.total - detailVente.vente.montant_regle)}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-petrol-500">Total</p>
                    <p className="font-mono text-xl font-semibold">{formatXOF(detailVente.vente?.total)}</p>
                  </div>
                </div>

                {detailVente.vente?.statut === 'annulee' ? (
                  <div className="no-print border border-red-200 bg-red-50 rounded-lg p-3">
                    <p className="text-sm font-medium text-red-700">Cette vente a été annulée (avoir émis, stock remis en magasin).</p>
                  </div>
                ) : modeAnnulation ? (
                  <div className="no-print border border-red-200 bg-red-50 rounded-lg p-3 space-y-2">
                    <label className="text-sm font-medium text-red-700">Motif de l'annulation (obligatoire)</label>
                    <textarea
                      className="input-field text-sm"
                      rows={2}
                      value={motifAnnulation}
                      onChange={(e) => setMotifAnnulation(e.target.value)}
                      placeholder="Ex. erreur de saisie, retour client, mauvais client sélectionné…"
                    />
                    {erreurAnnulation && <p className="text-xs text-red-600">{erreurAnnulation}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-secondary text-xs flex-1"
                        onClick={() => { setModeAnnulation(false); setMotifAnnulation(''); setErreurAnnulation('') }}
                      >
                        Retour
                      </button>
                      <button
                        onClick={confirmerAnnulation}
                        disabled={envoiAnnulation}
                        className="bg-red-600 text-white text-xs flex-1 rounded px-3 py-2 disabled:opacity-50"
                      >
                        {envoiAnnulation ? 'Envoi…' : 'Confirmer l\u2019annulation'}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="no-print flex gap-2 pt-4 mt-2 border-t border-line flex-wrap">
                  <button onClick={() => window.print()} className="btn-secondary text-xs flex-1">
                    🖨️ Imprimer
                  </button>
                  <button onClick={telechargerRecu} className="btn-secondary text-xs flex-1">
                    📄 PDF
                  </button>
                  <button onClick={telechargerBonLivraison} className="btn-secondary text-xs flex-1">
                    📦 Bon de livraison
                  </button>
                  <button onClick={partagerRecu} className="btn-primary text-xs flex-1">
                    📤 Partager
                  </button>
                  {['admin', 'manager'].includes(profil?.role) && detailVente.vente?.statut !== 'annulee' && !modeAnnulation && (
                    <button onClick={() => setModeAnnulation(true)} className="text-xs text-red-600 underline w-full text-center pt-1">
                      Annuler cette vente (avoir)
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-red-600 text-center py-8">Impossible de charger le détail.</p>
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
