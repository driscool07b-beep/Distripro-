import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Ventes() {
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

    let selectStr = 'id, total, created_at, clients!inner(nom, ville), profils!created_by(nom)'
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

  async function ouvrirModal() {
    setErreur('')
    setClientId('')
    setLignes([{ produit_id: '', quantite: 1, prix_unitaire: 0 }])
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from('clients').select('id, nom').order('nom'),
      supabase.from('produits').select('id, nom, prix_vente, stocks(quantite)').order('nom'),
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
      copie[index].prix_unitaire = produit?.prix_vente ?? 0
    }
    setLignes(copie)
  }

  const total = lignes.reduce((s, l) => s + Number(l.quantite || 0) * Number(l.prix_unitaire || 0), 0)
  const totalFiltre = ventes.reduce((s, v) => s + Number(v.total || 0), 0)

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
          <p className="text-sm text-petrol-700 mt-1">
            {ventes.length} vente(s) — Total filtré : <span className="font-mono font-medium">{formatXOF(totalFiltre)}</span>
          </p>
        </div>
        <button className="btn-primary" onClick={ouvrirModal}>
          + Nouvelle vente
        </button>
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
                <tr key={v.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                  <td className="px-4 py-3 text-petrol-700">
                    {new Date(v.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 font-medium">{v.clients?.nom || '—'}</td>
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
