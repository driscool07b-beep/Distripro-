import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { exporterExcel, exporterPDF, genererFactureProforma } from '../lib/export'
import SelectRecherche from '../components/SelectRecherche'

const LIBELLES_STATUT = {
  brouillon: 'Brouillon',
  confirmee: 'Confirmée',
  en_preparation: 'En préparation',
  livree: 'Livrée',
  annulee: 'Annulée',
}

const COULEURS_STATUT = {
  brouillon: 'bg-amber-50 text-amber-700 border-amber-200',
  confirmee: 'bg-blue-50 text-blue-700 border-blue-200',
  en_preparation: 'bg-purple-50 text-purple-700 border-purple-200',
  livree: 'bg-green-50 text-green-700 border-green-200',
  annulee: 'bg-petrol-50 text-petrol-500 border-line',
}

const LIGNE_VIDE = { produit_id: '', quantite: 1, prix_unitaire: 0 }

export default function Commandes() {
  const { entreprise, profil } = useAuth()
  const [commandes, setCommandes] = useState([])
  const [clients, setClients] = useState([])
  const [produits, setProduits] = useState([])
  const [commerciaux, setCommerciaux] = useState([])
  const [depots, setDepots] = useState([])
  const [chargement, setChargement] = useState(true)
  const [filtreStatut, setFiltreStatut] = useState('')

  const [modalOuvert, setModalOuvert] = useState(false)
  const [clientId, setClientId] = useState('')
  const [commercialId, setCommercialId] = useState('')
  const [depotId, setDepotId] = useState('')
  const [modePaiement, setModePaiement] = useState('cash')
  const [montantPaye, setMontantPaye] = useState('')
  const [dateLivraison, setDateLivraison] = useState('')
  const [notes, setNotes] = useState('')
  const [lignes, setLignes] = useState([{ ...LIGNE_VIDE }])
  const [captureGps, setCaptureGps] = useState('idle')
  const [position, setPosition] = useState(null)
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState('')

  const [commandeOuverte, setCommandeOuverte] = useState(null)
  const [detail, setDetail] = useState(null)
  const [chargementDetail, setChargementDetail] = useState(false)
  const [modeLivraison, setModeLivraison] = useState(false)
  const [quantitesLivrees, setQuantitesLivrees] = useState({})
  const [montantSupplementaire, setMontantSupplementaire] = useState('')
  const [modePaiementLivraison, setModePaiementLivraison] = useState('cash')
  const [actionEnvoi, setActionEnvoi] = useState(false)
  const [erreurAction, setErreurAction] = useState('')
  const [refBonCommande, setRefBonCommande] = useState('')
  const [urlBonCommande, setUrlBonCommande] = useState(null)
  const [envoiBonCommande, setEnvoiBonCommande] = useState(false)
  const [erreurBonCommande, setErreurBonCommande] = useState('')

  useEffect(() => {
    chargerCommandes()
  }, [filtreStatut])

  async function chargerCommandes() {
    setChargement(true)
    let requete = supabase
      .from('commandes')
      .select('id, numero, statut, montant_ttc, montant_paye, date_livraison_souhaitee, created_at, clients(nom), profils!commercial_id(nom), lignes_commande(id)')
      .order('created_at', { ascending: false })
    if (filtreStatut) requete = requete.eq('statut', filtreStatut)
    const { data, error } = await requete
    if (!error) setCommandes(data || [])
    setChargement(false)
  }

  function capturerPosition() {
    if (!navigator.geolocation) {
      setCaptureGps('echec')
      return
    }
    setCaptureGps('en_cours')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setCaptureGps('ok')
      },
      () => setCaptureGps('echec'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  async function ouvrirModal() {
    setErreur('')
    setClientId('')
    setCommercialId('')
    setDepotId('')
    setModePaiement('cash')
    setMontantPaye('')
    setDateLivraison('')
    setNotes('')
    setLignes([{ ...LIGNE_VIDE }])
    setPosition(null)
    setCaptureGps('idle')
    const [{ data: c }, { data: p }, { data: com }, { data: dep }] = await Promise.all([
      supabase.from('clients').select('id, nom').order('nom'),
      supabase.from('produits').select('id, nom, prix_vente').order('nom'),
      supabase.from('profils').select('id, nom').eq('role', 'commercial').order('nom'),
      supabase.from('depots').select('id, nom').eq('actif', true).order('nom'),
    ])
    setClients(c || [])
    setProduits(p || [])
    setCommerciaux(com || [])
    setDepots(dep || [])
    if (dep && dep.length === 1) setDepotId(dep[0].id)
    setModalOuvert(true)
    capturerPosition()
  }

  function ajouterLigne() {
    setLignes((prev) => [...prev, { ...LIGNE_VIDE }])
  }
  function retirerLigne(index) {
    setLignes((prev) => prev.filter((_, i) => i !== index))
  }
  function majLigne(index, champ, valeur) {
    setLignes((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l
        const maj = { ...l, [champ]: valeur }
        if (champ === 'produit_id') {
          const prod = produits.find((p) => p.id === valeur)
          maj.prix_unitaire = prod?.prix_vente || 0
        }
        return maj
      })
    )
  }

  const totalCommande = lignes.reduce((s, l) => s + Number(l.quantite || 0) * Number(l.prix_unitaire || 0), 0)

  async function validerCommande(e) {
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
    setEnregistrement(true)
    const { error } = await supabase.rpc('creer_commande', {
      p_client_id: clientId,
      p_lignes: lignesValides.map((l) => ({
        produit_id: l.produit_id,
        quantite: Number(l.quantite),
        prix_unitaire: Number(l.prix_unitaire),
      })),
      p_commercial_id: commercialId || null,
      p_depot_id: depotId || null,
      p_mode_paiement: modePaiement,
      p_montant_paye: montantPaye === '' ? null : Number(montantPaye),
      p_date_livraison_souhaitee: dateLivraison || null,
      p_notes: notes.trim() || null,
      p_latitude: position?.lat ?? null,
      p_longitude: position?.lon ?? null,
    })
    setEnregistrement(false)
    if (error) {
      setErreur(`Erreur : ${error.message}`)
      return
    }
    setModalOuvert(false)
    chargerCommandes()
  }

  async function ouvrirDetail(commandeId) {
    setCommandeOuverte(commandeId)
    setChargementDetail(true)
    setDetail(null)
    setModeLivraison(false)
    setErreurAction('')
    setMontantSupplementaire('')

    const [{ data: commande }, { data: lignesData }, { data: historique }] = await Promise.all([
      supabase
        .from('commandes')
        .select('id, numero, statut, mode_paiement, montant_ht, montant_tva, montant_ttc, montant_paye, date_livraison_souhaitee, notes, bon_commande_client_path, bon_commande_client_reference, created_at, clients(nom, telephone, adresse), profils!commercial_id(nom)')
        .eq('id', commandeId)
        .single(),
      supabase.from('lignes_commande').select('id, produit_id, quantite, prix_unitaire, montant_ligne, quantite_livree, produits(nom)').eq('commande_id', commandeId),
      supabase.from('commande_historique').select('ancien_statut, nouveau_statut, note, created_at, profils(nom)').eq('commande_id', commandeId).order('created_at'),
    ])

    setDetail({ commande, lignes: lignesData || [], historique: historique || [] })
    const init = {}
    ;(lignesData || []).forEach((l) => { init[l.produit_id] = l.quantite_livree ?? l.quantite })
    setQuantitesLivrees(init)
    setRefBonCommande(commande?.bon_commande_client_reference || '')
    setUrlBonCommande(null)
    setErreurBonCommande('')
    if (commande?.bon_commande_client_path) {
      const { data } = await supabase.storage.from('pieces-jointes').createSignedUrl(commande.bon_commande_client_path, 3600)
      if (data?.signedUrl) setUrlBonCommande(data.signedUrl)
    }
    setModePaiementLivraison(commande?.mode_paiement || 'cash')
    setChargementDetail(false)
  }

  function fermerDetail() {
    setCommandeOuverte(null)
    setDetail(null)
    setModeLivraison(false)
  }

  function telechargerProforma() {
    if (!detail) return
    const doc = genererFactureProforma({ entreprise, commande: detail.commande, lignes: detail.lignes })
    doc.save(`${detail.commande?.numero || 'proforma'}.pdf`)
  }

  async function enregistrerReferenceBonCommande() {
    setErreurBonCommande('')
    const { error } = await supabase
      .from('commandes')
      .update({ bon_commande_client_reference: refBonCommande.trim() || null })
      .eq('id', commandeOuverte)
    if (error) setErreurBonCommande(`Erreur : ${error.message}`)
  }

  async function envoyerBonCommande(e) {
    const fichier = e.target.files?.[0]
    if (!fichier || !commandeOuverte || !entreprise?.id) return
    setErreurBonCommande('')
    setEnvoiBonCommande(true)

    const extension = fichier.name.split('.').pop() || 'pdf'
    const chemin = `${entreprise.id}/commandes/${commandeOuverte}.${extension}`

    const { error: erreurUpload } = await supabase.storage
      .from('pieces-jointes')
      .upload(chemin, fichier, { upsert: true })

    if (erreurUpload) {
      setEnvoiBonCommande(false)
      setErreurBonCommande(`Erreur envoi : ${erreurUpload.message}`)
      return
    }

    const { error: erreurMaj } = await supabase
      .from('commandes')
      .update({ bon_commande_client_path: chemin })
      .eq('id', commandeOuverte)

    setEnvoiBonCommande(false)
    if (erreurMaj) {
      setErreurBonCommande(`Erreur enregistrement : ${erreurMaj.message}`)
      return
    }

    const { data } = await supabase.storage.from('pieces-jointes').createSignedUrl(chemin, 3600)
    if (data?.signedUrl) setUrlBonCommande(data.signedUrl)
  }

  async function changerStatut(nouveauStatut) {
    setActionEnvoi(true)
    setErreurAction('')
    const { error } = await supabase.rpc('changer_statut_commande', {
      p_commande_id: commandeOuverte,
      p_nouveau_statut: nouveauStatut,
    })
    setActionEnvoi(false)
    if (error) {
      setErreurAction(`Erreur : ${error.message}`)
      return
    }
    await ouvrirDetail(commandeOuverte)
    chargerCommandes()
  }

  async function confirmerLivraison() {
    setActionEnvoi(true)
    setErreurAction('')
    const lignesFinales = detail.lignes.map((l) => ({
      produit_id: l.produit_id,
      quantite_livree: Number(quantitesLivrees[l.produit_id] ?? 0),
    }))
    const { error } = await supabase.rpc('livrer_commande', {
      p_commande_id: commandeOuverte,
      p_lignes_livrees: lignesFinales,
      p_montant_supplementaire_paye: montantSupplementaire === '' ? 0 : Number(montantSupplementaire),
      p_mode_paiement: modePaiementLivraison,
    })
    setActionEnvoi(false)
    if (error) {
      setErreurAction(`Erreur : ${error.message}`)
      return
    }
    await ouvrirDetail(commandeOuverte)
    chargerCommandes()
  }

  const COLONNES_EXPORT = [
    { cle: 'numero', titre: 'Numéro' },
    { cle: 'client', titre: 'Client' },
    { cle: 'commercial', titre: 'Commercial' },
    { cle: 'statut', titre: 'Statut' },
    { cle: 'montant', titre: 'Montant TTC (F CFA)', alignDroite: true },
    { cle: 'date', titre: 'Date' },
  ]
  function donneesExport() {
    return commandes.map((c) => ({
      numero: c.numero,
      client: c.clients?.nom || '—',
      commercial: c.profils?.nom || '—',
      statut: LIBELLES_STATUT[c.statut] || c.statut,
      montant: Number(c.montant_ttc || 0),
      date: new Date(c.created_at).toLocaleDateString('fr-FR'),
    }))
  }

  if (chargement) {
    return <div className="p-4 text-center text-petrol-500">Chargement des commandes…</div>
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Commandes</h1>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" disabled={commandes.length === 0} onClick={() => exporterExcel('commandes', COLONNES_EXPORT, donneesExport())}>
            📊 Excel
          </button>
          <button className="btn-secondary text-xs" disabled={commandes.length === 0} onClick={() => exporterPDF('commandes', 'Commandes', null, COLONNES_EXPORT, donneesExport(), undefined, undefined, entreprise)}>
            📄 PDF
          </button>
          <button onClick={ouvrirModal} className="btn-primary text-sm">
            + Nouvelle commande
          </button>
        </div>
      </div>

      <div className="mb-4 flex gap-2 flex-wrap">
        <button
          onClick={() => setFiltreStatut('')}
          className={`text-xs px-3 py-1.5 rounded-full border ${!filtreStatut ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line'}`}
        >
          Toutes
        </button>
        {Object.entries(LIBELLES_STATUT).map(([val, lib]) => (
          <button
            key={val}
            onClick={() => setFiltreStatut(val)}
            className={`text-xs px-3 py-1.5 rounded-full border ${filtreStatut === val ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line'}`}
          >
            {lib}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {commandes.map((c) => (
          <button
            key={c.id}
            onClick={() => ouvrirDetail(c.id)}
            className="w-full text-left border border-line rounded-lg p-3 flex justify-between items-center hover:bg-canvas/60"
          >
            <div>
              <p className="font-medium text-sm">{c.numero} — {c.clients?.nom || 'Client'}</p>
              <p className="text-xs text-petrol-500">
                {c.lignes_commande?.length || 0} article(s) — {new Date(c.created_at).toLocaleDateString('fr-FR')}
                {c.profils?.nom ? ` — ${c.profils.nom}` : ''}
              </p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full border shrink-0 ml-2 ${COULEURS_STATUT[c.statut]}`}>
              {LIBELLES_STATUT[c.statut] || c.statut}
            </span>
          </button>
        ))}
        {commandes.length === 0 && (
          <p className="text-petrol-400 text-center py-8">Aucune commande {filtreStatut ? `au statut "${LIBELLES_STATUT[filtreStatut]}"` : ''}.</p>
        )}
      </div>

      {modalOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-4">Nouvelle commande</h2>
            <form onSubmit={validerCommande} className="space-y-3">
              <div>
                <label className="label">Client</label>
                <SelectRecherche options={clients} value={clientId} onChange={setClientId} placeholder="Rechercher un client…" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Commercial (optionnel)</label>
                  <select className="input-field" value={commercialId} onChange={(e) => setCommercialId(e.target.value)}>
                    <option value="">— Aucun —</option>
                    {commerciaux.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Dépôt de livraison</label>
                  <select className="input-field" value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                    <option value="">— Aucun —</option>
                    {depots.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Articles</label>
                <div className="space-y-2">
                  {lignes.map((l, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <select
                        className="input-field flex-1"
                        value={l.produit_id}
                        onChange={(e) => majLigne(i, 'produit_id', e.target.value)}
                      >
                        <option value="">— Produit —</option>
                        {produits.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
                      </select>
                      <input
                        type="number"
                        min="1"
                        className="input-field w-20"
                        value={l.quantite}
                        onChange={(e) => majLigne(i, 'quantite', e.target.value)}
                      />
                      {lignes.length > 1 && (
                        <button type="button" onClick={() => retirerLigne(i)} className="text-red-600 text-sm px-1">✕</button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={ajouterLigne} className="text-xs text-petrol-600 underline mt-2">
                  + Ajouter un article
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Mode de paiement</label>
                  <select className="input-field" value={modePaiement} onChange={(e) => setModePaiement(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="credit">Crédit</option>
                  </select>
                </div>
                <div>
                  <label className="label">Acompte versé (optionnel)</label>
                  <input
                    type="number"
                    min="0"
                    max={totalCommande}
                    className="input-field"
                    value={montantPaye}
                    onChange={(e) => setMontantPaye(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>

              <div>
                <label className="label">Date de livraison souhaitée</label>
                <input type="date" className="input-field" value={dateLivraison} onChange={(e) => setDateLivraison(e.target.value)} />
              </div>

              <div>
                <label className="label">Notes</label>
                <textarea className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              <div className="text-xs flex items-center gap-2 flex-wrap">
                {captureGps === 'ok' && <span className="text-green-600">📍 Position de prise de commande capturée.</span>}
                {captureGps === 'echec' && <span className="text-amber-600">⚠️ Position indisponible.</span>}
                <button type="button" onClick={capturerPosition} className="underline text-petrol-600">
                  {captureGps === 'en_cours' ? 'Capture…' : 'Recapturer ma position'}
                </button>
              </div>

              <div className="flex items-center justify-between border-t border-line pt-3">
                <span className="text-sm font-medium text-petrol-700">Total</span>
                <span className="font-mono text-lg font-semibold">{formatXOF(totalCommande)}</span>
              </div>

              {erreur && <div className="text-sm text-red-600">{erreur}</div>}

              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setModalOuvert(false)}>Annuler</button>
                <button type="submit" disabled={enregistrement} className="btn-primary flex-1">
                  {enregistrement ? 'Enregistrement…' : 'Créer la commande'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {commandeOuverte && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-3">
            {chargementDetail ? (
              <p className="text-sm text-petrol-500 text-center py-8">Chargement…</p>
            ) : detail ? (
              <>
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="font-semibold text-lg">{detail.commande?.numero}</h2>
                    <p className="text-sm text-petrol-700">{detail.commande?.clients?.nom}</p>
                    {detail.commande?.profils?.nom && (
                      <p className="text-xs text-petrol-500">Commercial : {detail.commande.profils.nom}</p>
                    )}
                  </div>
                  <button onClick={fermerDetail} className="text-petrol-400 text-xl leading-none">✕</button>
                </div>

                <span className={`inline-block text-xs px-2 py-1 rounded-full border ${COULEURS_STATUT[detail.commande?.statut]}`}>
                  {LIBELLES_STATUT[detail.commande?.statut] || detail.commande?.statut}
                </span>

                {detail.commande?.notes && <p className="text-sm text-petrol-600">{detail.commande.notes}</p>}
                {detail.commande?.date_livraison_souhaitee && (
                  <p className="text-xs text-petrol-500">
                    Livraison souhaitée : {new Date(detail.commande.date_livraison_souhaitee).toLocaleDateString('fr-FR')}
                  </p>
                )}

                <div className="border-t border-line pt-3">
                  <label className="label">Bon de commande du client (justificatif)</label>
                  <div className="flex gap-2 mb-2">
                    <input
                      className="input-field flex-1 text-sm"
                      placeholder="Référence du bon de commande (ex. BC-4521)"
                      value={refBonCommande}
                      onChange={(e) => setRefBonCommande(e.target.value)}
                      onBlur={enregistrerReferenceBonCommande}
                    />
                  </div>
                  {urlBonCommande ? (
                    <a href={urlBonCommande} target="_blank" rel="noreferrer" className="text-blue-600 text-sm underline">
                      📎 Voir le document joint
                    </a>
                  ) : (
                    <p className="text-xs text-petrol-400 mb-1">Aucun document joint pour le moment.</p>
                  )}
                  <div className="mt-2">
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      onChange={envoyerBonCommande}
                      disabled={envoiBonCommande}
                      className="text-sm"
                    />
                    {envoiBonCommande && <p className="text-xs text-petrol-600 mt-1">Envoi en cours…</p>}
                    {erreurBonCommande && <p className="text-xs text-red-600 mt-1">{erreurBonCommande}</p>}
                  </div>
                </div>

                {!modeLivraison ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-petrol-500 border-b border-line">
                        <th className="pb-2">Produit</th>
                        <th className="pb-2 text-right">Commandé</th>
                        <th className="pb-2 text-right">Livré</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lignes.map((l) => (
                        <tr key={l.id} className="border-b border-line last:border-0">
                          <td className="py-1.5">{l.produits?.nom}</td>
                          <td className="py-1.5 text-right font-mono">{l.quantite}</td>
                          <td className="py-1.5 text-right font-mono">{l.quantite_livree ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div>
                    <p className="text-sm font-medium mb-2">Quantités livrées (rupture possible)</p>
                    <div className="space-y-2">
                      {detail.lignes.map((l) => (
                        <div key={l.id} className="flex items-center justify-between gap-3">
                          <span className="text-sm">{l.produits?.nom} <span className="text-petrol-400">(cmd. {l.quantite})</span></span>
                          <input
                            type="number"
                            min="0"
                            max={l.quantite}
                            className="w-20 border rounded px-2 py-1 text-sm"
                            value={quantitesLivrees[l.produit_id] ?? l.quantite}
                            onChange={(e) => setQuantitesLivrees((prev) => ({ ...prev, [l.produit_id]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="label">Montant supplémentaire encaissé</label>
                        <input
                          type="number"
                          min="0"
                          className="input-field"
                          value={montantSupplementaire}
                          onChange={(e) => setMontantSupplementaire(e.target.value)}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="label">Mode de paiement</label>
                        <select className="input-field" value={modePaiementLivraison} onChange={(e) => setModePaiementLivraison(e.target.value)}>
                          <option value="cash">Cash</option>
                          <option value="credit">Crédit</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {erreurAction && <p className="text-sm text-red-600">{erreurAction}</p>}

                <div className="flex flex-wrap gap-2 pt-2 border-t border-line">
                  <button onClick={telechargerProforma} className="btn-secondary text-sm">
                    📄 Facture proforma
                  </button>

                  {detail.commande?.statut === 'brouillon' && (
                    <button onClick={() => changerStatut('confirmee')} disabled={actionEnvoi} className="bg-blue-600 text-white px-3 py-2 rounded text-sm">
                      Confirmer
                    </button>
                  )}
                  {detail.commande?.statut === 'confirmee' && (
                    <button onClick={() => changerStatut('en_preparation')} disabled={actionEnvoi} className="bg-purple-600 text-white px-3 py-2 rounded text-sm">
                      Démarrer la préparation
                    </button>
                  )}
                  {detail.commande?.statut === 'en_preparation' && !modeLivraison && (
                    <button onClick={() => setModeLivraison(true)} className="bg-green-600 text-white px-3 py-2 rounded text-sm">
                      Enregistrer la livraison
                    </button>
                  )}
                  {modeLivraison && (
                    <button onClick={confirmerLivraison} disabled={actionEnvoi} className="bg-green-600 text-white px-3 py-2 rounded text-sm">
                      {actionEnvoi ? 'Envoi…' : 'Valider la livraison'}
                    </button>
                  )}
                  {!['livree', 'annulee'].includes(detail.commande?.statut) && !modeLivraison && (
                    <button onClick={() => changerStatut('annulee')} disabled={actionEnvoi} className="text-red-600 text-sm px-3 py-2">
                      Annuler la commande
                    </button>
                  )}
                </div>

                {detail.historique.length > 0 && (
                  <div className="border-t border-line pt-2">
                    <p className="text-xs font-medium text-petrol-600 mb-1">Historique</p>
                    {detail.historique.map((h, i) => (
                      <p key={i} className="text-xs text-petrol-500">
                        {new Date(h.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} — {LIBELLES_STATUT[h.nouveau_statut] || h.nouveau_statut} par {h.profils?.nom || '—'}
                      </p>
                    ))}
                  </div>
                )}
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
