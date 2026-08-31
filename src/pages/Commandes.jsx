import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const LIBELLES_STATUT = {
  recue: 'Reçue',
  confirmee: 'Confirmée',
  en_preparation: 'En préparation',
  livree: 'Livrée',
  annulee: 'Annulée',
}

const COULEURS_STATUT = {
  recue: 'bg-amber-50 text-amber-700 border-amber-200',
  confirmee: 'bg-blue-50 text-blue-700 border-blue-200',
  en_preparation: 'bg-purple-50 text-purple-700 border-purple-200',
  livree: 'bg-green-50 text-green-700 border-green-200',
  annulee: 'bg-petrol-50 text-petrol-500 border-line',
}

const LIGNE_VIDE = { produit_id: '', quantite: 1, prix_unitaire: 0 }

export default function Commandes() {
  const { entreprise } = useAuth()
  const [commandes, setCommandes] = useState([])
  const [clients, setClients] = useState([])
  const [produits, setProduits] = useState([])
  const [commerciaux, setCommerciaux] = useState([])
  const [chargement, setChargement] = useState(true)
  const [filtreStatut, setFiltreStatut] = useState('')

  const [modalOuvert, setModalOuvert] = useState(false)
  const [clientId, setClientId] = useState('')
  const [commercialId, setCommercialId] = useState('')
  const [modePaiement, setModePaiement] = useState('cash')
  const [dateLivraison, setDateLivraison] = useState('')
  const [notes, setNotes] = useState('')
  const [lignes, setLignes] = useState([{ ...LIGNE_VIDE }])
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState('')

  const [commandeOuverte, setCommandeOuverte] = useState(null)
  const [detail, setDetail] = useState(null)
  const [chargementDetail, setChargementDetail] = useState(false)
  const [modeLivraison, setModeLivraison] = useState(false)
  const [quantitesLivrees, setQuantitesLivrees] = useState({})
  const [modePaiementLivraison, setModePaiementLivraison] = useState('cash')
  const [actionEnvoi, setActionEnvoi] = useState(false)
  const [erreurAction, setErreurAction] = useState('')
  const [vueProforma, setVueProforma] = useState(false)

  useEffect(() => {
    chargerCommandes()
  }, [filtreStatut])

  async function chargerCommandes() {
    setChargement(true)
    let requete = supabase
      .from('commandes')
      .select('id, statut, mode_paiement, date_livraison_souhaitee, created_at, clients(nom), profils!commercial_id(nom), commande_lignes(id)')
      .order('created_at', { ascending: false })
    if (filtreStatut) requete = requete.eq('statut', filtreStatut)
    const { data, error } = await requete
    if (!error) setCommandes(data || [])
    setChargement(false)
  }

  async function ouvrirModal() {
    setErreur('')
    setClientId('')
    setCommercialId('')
    setModePaiement('cash')
    setDateLivraison('')
    setNotes('')
    setLignes([{ ...LIGNE_VIDE }])
    const [{ data: c }, { data: p }, { data: com }] = await Promise.all([
      supabase.from('clients').select('id, nom').order('nom'),
      supabase.from('produits').select('id, nom, prix_vente').order('nom'),
      supabase.from('profils').select('id, nom').eq('role', 'commercial').order('nom'),
    ])
    setClients(c || [])
    setProduits(p || [])
    setCommerciaux(com || [])
    setModalOuvert(true)
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
      p_mode_paiement: modePaiement,
      p_date_livraison_souhaitee: dateLivraison || null,
      p_notes: notes.trim() || null,
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
    setVueProforma(false)
    setErreurAction('')

    const [{ data: commande }, { data: cLignes }, { data: historique }] = await Promise.all([
      supabase
        .from('commandes')
        .select('id, statut, mode_paiement, date_livraison_souhaitee, notes, created_at, clients(nom, telephone, adresse), profils!commercial_id(nom), createur:profils!cree_par(nom)')
        .eq('id', commandeId)
        .single(),
      supabase.from('commande_lignes').select('id, produit_id, quantite_commandee, quantite_livree, prix_unitaire, produits(nom)').eq('commande_id', commandeId),
      supabase.from('commande_historique').select('ancien_statut, nouveau_statut, note, created_at, profils(nom)').eq('commande_id', commandeId).order('created_at'),
    ])

    setDetail({ commande, lignes: cLignes || [], historique: historique || [] })
    const quantitesInit = {}
    ;(cLignes || []).forEach((l) => { quantitesInit[l.id] = l.quantite_commandee })
    setQuantitesLivrees(quantitesInit)
    setModePaiementLivraison(commande?.mode_paiement || 'cash')
    setChargementDetail(false)
  }

  function fermerDetail() {
    setCommandeOuverte(null)
    setDetail(null)
    setModeLivraison(false)
    setVueProforma(false)
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
      quantite_livree: Number(quantitesLivrees[l.id] ?? 0),
    }))
    const { error } = await supabase.rpc('livrer_commande', {
      p_commande_id: commandeOuverte,
      p_lignes_livrees: lignesFinales,
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

  if (chargement) {
    return <div className="p-4 text-center text-petrol-500">Chargement des commandes…</div>
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Commandes</h1>
        <button onClick={ouvrirModal} className="btn-primary text-sm">
          + Nouvelle commande
        </button>
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
              <p className="font-medium text-sm">{c.clients?.nom || 'Client'}</p>
              <p className="text-xs text-petrol-500">
                {c.commande_lignes?.length || 0} article(s) — {new Date(c.created_at).toLocaleDateString('fr-FR')}
                {c.profils?.nom ? ` — ${c.profils.nom}` : ''}
              </p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full border shrink-0 ml-2 ${COULEURS_STATUT[c.statut]}`}>
              {LIBELLES_STATUT[c.statut]}
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
                <select className="input-field" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">— Sélectionner —</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Commercial assigné (optionnel)</label>
                  <select className="input-field" value={commercialId} onChange={(e) => setCommercialId(e.target.value)}>
                    <option value="">— Aucun —</option>
                    {commerciaux.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Mode de paiement</label>
                  <select className="input-field" value={modePaiement} onChange={(e) => setModePaiement(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="credit">Crédit</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Date de livraison souhaitée</label>
                <input type="date" className="input-field" value={dateLivraison} onChange={(e) => setDateLivraison(e.target.value)} />
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

              <div>
                <label className="label">Notes</label>
                <textarea className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              <div className="flex items-center justify-between border-t border-line pt-3">
                <span className="text-sm font-medium text-petrol-700">Total estimé</span>
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
            ) : detail && vueProforma ? (
              <>
                <div className="no-print flex justify-between items-center mb-2">
                  <button onClick={() => setVueProforma(false)} className="text-xs text-petrol-600 underline">← Retour</button>
                  <button onClick={() => window.print()} className="btn-secondary text-xs">🖨️ Imprimer</button>
                </div>
                <div className="text-center border-2 border-amber-400 bg-amber-50 rounded p-2 text-xs font-medium text-amber-800 mb-3">
                  FACTURE PROFORMA — document non valable comme facture définitive
                </div>
                <h2 className="font-semibold text-lg">{entreprise?.nom}</h2>
                <p className="text-sm">{detail.commande?.clients?.nom}</p>
                {detail.commande?.clients?.adresse && <p className="text-xs text-petrol-500">{detail.commande.clients.adresse}</p>}
                <p className="text-xs text-petrol-500 mb-3">Date : {new Date(detail.commande?.created_at).toLocaleDateString('fr-FR')}</p>
                <table className="w-full text-sm mb-3">
                  <thead>
                    <tr className="text-left text-xs text-petrol-500 border-b border-line">
                      <th className="pb-2">Produit</th>
                      <th className="pb-2 text-right">Qté</th>
                      <th className="pb-2 text-right">PU</th>
                      <th className="pb-2 text-right">Sous-total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lignes.map((l) => (
                      <tr key={l.id} className="border-b border-line last:border-0">
                        <td className="py-1.5">{l.produits?.nom}</td>
                        <td className="py-1.5 text-right font-mono">{l.quantite_commandee}</td>
                        <td className="py-1.5 text-right font-mono">{formatXOF(l.prix_unitaire)}</td>
                        <td className="py-1.5 text-right font-mono">{formatXOF(l.quantite_commandee * l.prix_unitaire)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex justify-between font-medium border-t border-line pt-2">
                  <span>Total estimé</span>
                  <span className="font-mono">
                    {formatXOF(detail.lignes.reduce((s, l) => s + l.quantite_commandee * l.prix_unitaire, 0))}
                  </span>
                </div>
              </>
            ) : detail ? (
              <>
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="font-semibold text-lg">{detail.commande?.clients?.nom}</h2>
                    <p className="text-xs text-petrol-500">
                      Reçue par {detail.commande?.createur?.nom || '—'}
                      {detail.commande?.profils?.nom ? ` — assignée à ${detail.commande.profils.nom}` : ''}
                    </p>
                  </div>
                  <button onClick={fermerDetail} className="text-petrol-400 text-xl leading-none">✕</button>
                </div>

                <span className={`inline-block text-xs px-2 py-1 rounded-full border ${COULEURS_STATUT[detail.commande?.statut]}`}>
                  {LIBELLES_STATUT[detail.commande?.statut]}
                </span>

                {detail.commande?.notes && <p className="text-sm text-petrol-600">{detail.commande.notes}</p>}

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
                          <td className="py-1.5 text-right font-mono">{l.quantite_commandee}</td>
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
                          <span className="text-sm">{l.produits?.nom} <span className="text-petrol-400">(cmd. {l.quantite_commandee})</span></span>
                          <input
                            type="number"
                            min="0"
                            max={l.quantite_commandee}
                            className="w-20 border rounded px-2 py-1 text-sm"
                            value={quantitesLivrees[l.id] ?? l.quantite_commandee}
                            onChange={(e) => setQuantitesLivrees((prev) => ({ ...prev, [l.id]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mt-3">
                      <label className="label">Mode de paiement</label>
                      <select className="input-field" value={modePaiementLivraison} onChange={(e) => setModePaiementLivraison(e.target.value)}>
                        <option value="cash">Cash</option>
                        <option value="credit">Crédit</option>
                      </select>
                    </div>
                  </div>
                )}

                {erreurAction && <p className="text-sm text-red-600">{erreurAction}</p>}

                <div className="flex flex-wrap gap-2 pt-2 border-t border-line">
                  <button onClick={() => setVueProforma(true)} className="btn-secondary text-sm">
                    📄 Facture proforma
                  </button>

                  {detail.commande?.statut === 'recue' && (
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
