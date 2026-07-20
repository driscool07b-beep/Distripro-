import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Ventes() {
  const [ventes, setVentes] = useState([])
  const [clients, setClients] = useState([])
  const [produits, setProduits] = useState([])
  const [chargement, setChargement] = useState(true)
  const [modalOuvert, setModalOuvert] = useState(false)
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState('')

  const [clientId, setClientId] = useState('')
  const [lignes, setLignes] = useState([{ produit_id: '', quantite: 1, prix_unitaire: 0 }])

  useEffect(() => {
    chargerVentes()
  }, [])

  async function chargerVentes() {
    setChargement(true)
    const { data, error } = await supabase
      .from('ventes')
      .select('id, total, created_at, clients(nom), ventes_lignes(id)')
      .order('created_at', { ascending: false })
      .limit(50)
    if (!error) setVentes(data || [])
    setChargement(false)
  }

  async function ouvrirModal() {
    setErreur('')
    setClientId('')
    setLignes([{ produit_id: '', quantite: 1, prix_unitaire: 0 }])
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from('clients').select('id, nom').order('nom'),
      supabase.from('produits').select('id, nom, prix_unitaire, stocks(quantite)').order('nom'),
    ])
    setClients(c || [])
    setProduits((p || []).map((pr) => ({ ...pr, quantite_stock: pr.stocks?.[0]?.quantite ?? 0 })))
    setModalOuvert(true)
  }

  function ajouterLigne() {
    setLignes([...lignes, { produit_id: '', quantite: 1, prix_unitaire: 0 }])
  }

  function retirerLigne(index) {
    setLignes(lignes.filter((_, i) => i !== index))
  }

  function modifierLigne(index, champ, valeur) {
    const copie = [...lignes]
    copie[index] = { ...copie[index], [champ]: valeur }
    if (champ === 'produit_id') {
      const produit = produits.find((p) => p.id === valeur)
      copie[index].prix_unitaire = produit?.prix_unitaire ?? 0
    }
    setLignes(copie)
  }

  const total = lignes.reduce((s, l) => s + Number(l.quantite || 0) * Number(l.prix_unitaire || 0), 0)

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

    setEnregistrement(true)
    const { error } = await supabase.rpc('creer_vente', {
      p_client_id: clientId,
      p_lignes: lignesValides.map((l) => ({
        produit_id: l.produit_id,
        quantite: Number(l.quantite),
        prix_unitaire: Number(l.prix_unitaire),
      })),
    })
    setEnregistrement(false)

    if (error) {
      setErreur(
        error.message?.includes('stock insuffisant')
          ? 'Stock insuffisant pour au moins un article de la commande.'
          : "Erreur lors de l'enregistrement de la vente."
      )
      return
    }
    setModalOuvert(false)
    chargerVentes()
  }

  return (
    <div className="p-8 max-w-6xl">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Ventes</h1>
          <p className="text-sm text-petrol-700 mt-1">{ventes.length} vente(s) récente(s)</p>
        </div>
        <button className="btn-primary" onClick={ouvrirModal}>
          + Nouvelle vente
        </button>
      </header>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Articles</th>
              <th className="px-4 py-3 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {chargement ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-petrol-500">Chargement…</td></tr>
            ) : ventes.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-petrol-500">Aucune vente enregistrée.</td></tr>
            ) : (
              ventes.map((v) => (
                <tr key={v.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                  <td className="px-4 py-3 text-petrol-700">
                    {new Date(v.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 font-medium">{v.clients?.nom || '—'}</td>
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
                <select
                  className="input-field"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                >
                  <option value="">Sélectionner un client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
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
                          {produit && ligne.quantite > produit.quantite_stock && (
                            <span className="text-red-600">stock!</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => retirerLigne(i)}
                          className="col-span-1 text-petrol-400 hover:text-red-600 text-sm"
                          disabled={lignes.length === 1}
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-line pt-3">
                <span className="text-sm font-medium text-petrol-700">Total</span>
                <span className="font-mono text-lg font-semibold">{formatXOF(total)}</span>
              </div>

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
    </div>
  )
}

function formatXOF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0) + ' F CFA'
}
