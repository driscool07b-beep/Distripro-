import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const PRODUIT_VIDE = { nom: '', categorie: '', prix_unitaire: '', seuil_alerte: '10', quantite_initiale: '0' }

export default function Stock() {
  const [produits, setProduits] = useState([])
  const [recherche, setRecherche] = useState('')
  const [chargement, setChargement] = useState(true)
  const [modalProduit, setModalProduit] = useState(false)
  const [modalMouvement, setModalMouvement] = useState(null) // produit sélectionné
  const [formulaire, setFormulaire] = useState(PRODUIT_VIDE)
  const [mouvement, setMouvement] = useState({ type: 'entree', quantite: '', motif: '' })
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    chargerProduits()
  }, [])

  async function chargerProduits() {
    setChargement(true)
    const { data, error } = await supabase
      .from('produits')
      .select('id, nom, categorie, prix_unitaire, seuil_alerte, created_at, stocks(quantite)')
      .order('created_at', { ascending: false })
    if (!error) {
      setProduits(
        (data || []).map((p) => ({
          ...p,
          quantite: p.stocks?.[0]?.quantite ?? 0,
        }))
      )
    }
    setChargement(false)
  }

  async function enregistrerProduit(e) {
    e.preventDefault()
    setErreur('')
    if (!formulaire.nom.trim() || !formulaire.prix_unitaire) {
      setErreur('Le nom et le prix unitaire sont requis.')
      return
    }
    setEnregistrement(true)
    const { error } = await supabase.rpc('creer_produit', {
      p_nom: formulaire.nom.trim(),
      p_categorie: formulaire.categorie.trim() || null,
      p_prix_unitaire: Number(formulaire.prix_unitaire),
      p_seuil_alerte: Number(formulaire.seuil_alerte || 0),
      p_quantite_initiale: Number(formulaire.quantite_initiale || 0),
    })
    setEnregistrement(false)
    if (error) {
      setErreur("Erreur lors de l'enregistrement. Réessayez.")
      return
    }
    setModalProduit(false)
    setFormulaire(PRODUIT_VIDE)
    chargerProduits()
  }

  async function enregistrerMouvement(e) {
    e.preventDefault()
    setErreur('')
    const qte = Number(mouvement.quantite)
    if (!qte || qte <= 0) {
      setErreur('Indiquez une quantité valide.')
      return
    }
    setEnregistrement(true)
    const { error } = await supabase.rpc('ajuster_stock', {
      p_produit_id: modalMouvement.id,
      p_type: mouvement.type,
      p_quantite: qte,
      p_motif: mouvement.motif.trim() || null,
    })
    setEnregistrement(false)
    if (error) {
      setErreur(error.message?.includes('stock insuffisant') ? 'Stock insuffisant pour cette sortie.' : 'Erreur lors de l\'ajustement.')
      return
    }
    setModalMouvement(null)
    setMouvement({ type: 'entree', quantite: '', motif: '' })
    chargerProduits()
  }

  const produitsFiltres = produits.filter((p) =>
    p.nom.toLowerCase().includes(recherche.toLowerCase())
  )
  const nbAlertes = produits.filter((p) => p.quantite <= (p.seuil_alerte ?? 0)).length

  return (
    <div className="p-8 max-w-6xl">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Produits &amp; Stock</h1>
          <p className="text-sm text-petrol-700 mt-1">
            {produits.length} produit(s) — {nbAlertes > 0 ? (
              <span className="text-amber-600 font-medium">{nbAlertes} en alerte de stock</span>
            ) : (
              'stock sain'
            )}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setModalProduit(true)}>
          + Nouveau produit
        </button>
      </header>

      <input
        type="text"
        placeholder="Rechercher un produit…"
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        className="input-field max-w-sm mb-4"
      />

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
              <th className="px-4 py-3 font-medium">Produit</th>
              <th className="px-4 py-3 font-medium">Catégorie</th>
              <th className="px-4 py-3 font-medium">Prix unitaire</th>
              <th className="px-4 py-3 font-medium">Stock</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {chargement ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-petrol-500">Chargement…</td></tr>
            ) : produitsFiltres.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-petrol-500">Aucun produit trouvé.</td></tr>
            ) : (
              produitsFiltres.map((p) => {
                const enAlerte = p.quantite <= (p.seuil_alerte ?? 0)
                return (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                    <td className="px-4 py-3 font-medium">{p.nom}</td>
                    <td className="px-4 py-3 text-petrol-700">{p.categorie || '—'}</td>
                    <td className="px-4 py-3 font-mono text-petrol-700">{formatXOF(p.prix_unitaire)}</td>
                    <td className="px-4 py-3">
                      <span className={`font-mono px-2 py-0.5 rounded ${enAlerte ? 'bg-amber-50 text-amber-700' : 'text-petrol-900'}`}>
                        {p.quantite}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="text-xs font-medium text-petrol-700 hover:text-amber-600"
                        onClick={() => setModalMouvement(p)}
                      >
                        Ajuster le stock
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {modalProduit && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md">
            <h2 className="font-semibold text-lg mb-4">Nouveau produit</h2>
            <form onSubmit={enregistrerProduit} className="space-y-3">
              <div>
                <label className="label">Nom *</label>
                <input
                  className="input-field"
                  value={formulaire.nom}
                  onChange={(e) => setFormulaire({ ...formulaire, nom: e.target.value })}
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Catégorie</label>
                <input
                  className="input-field"
                  value={formulaire.categorie}
                  onChange={(e) => setFormulaire({ ...formulaire, categorie: e.target.value })}
                  placeholder="Céréales, Farines, Épices…"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Prix unitaire (F CFA) *</label>
                  <input
                    type="number"
                    className="input-field font-mono"
                    value={formulaire.prix_unitaire}
                    onChange={(e) => setFormulaire({ ...formulaire, prix_unitaire: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Seuil d'alerte</label>
                  <input
                    type="number"
                    className="input-field font-mono"
                    value={formulaire.seuil_alerte}
                    onChange={(e) => setFormulaire({ ...formulaire, seuil_alerte: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label">Quantité initiale en stock</label>
                <input
                  type="number"
                  className="input-field font-mono"
                  value={formulaire.quantite_initiale}
                  onChange={(e) => setFormulaire({ ...formulaire, quantite_initiale: e.target.value })}
                />
              </div>

              {erreur && <div className="text-sm text-red-600">{erreur}</div>}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  className="btn-secondary flex-1"
                  onClick={() => {
                    setModalProduit(false)
                    setFormulaire(PRODUIT_VIDE)
                    setErreur('')
                  }}
                >
                  Annuler
                </button>
                <button type="submit" disabled={enregistrement} className="btn-primary flex-1">
                  {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalMouvement && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md">
            <h2 className="font-semibold text-lg mb-1">Ajuster le stock</h2>
            <p className="text-sm text-petrol-600 mb-4">{modalMouvement.nom} — stock actuel : {modalMouvement.quantite}</p>
            <form onSubmit={enregistrerMouvement} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMouvement({ ...mouvement, type: 'entree' })}
                  className={`py-2 rounded-lg text-sm font-medium border ${
                    mouvement.type === 'entree'
                      ? 'bg-petrol-800 text-white border-petrol-800'
                      : 'border-line text-petrol-700'
                  }`}
                >
                  Entrée
                </button>
                <button
                  type="button"
                  onClick={() => setMouvement({ ...mouvement, type: 'sortie' })}
                  className={`py-2 rounded-lg text-sm font-medium border ${
                    mouvement.type === 'sortie'
                      ? 'bg-petrol-800 text-white border-petrol-800'
                      : 'border-line text-petrol-700'
                  }`}
                >
                  Sortie
                </button>
              </div>
              <div>
                <label className="label">Quantité</label>
                <input
                  type="number"
                  className="input-field font-mono"
                  value={mouvement.quantite}
                  onChange={(e) => setMouvement({ ...mouvement, quantite: e.target.value })}
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Motif</label>
                <input
                  className="input-field"
                  value={mouvement.motif}
                  onChange={(e) => setMouvement({ ...mouvement, motif: e.target.value })}
                  placeholder="Réception fournisseur, casse, inventaire…"
                />
              </div>

              {erreur && <div className="text-sm text-red-600">{erreur}</div>}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  className="btn-secondary flex-1"
                  onClick={() => {
                    setModalMouvement(null)
                    setMouvement({ type: 'entree', quantite: '', motif: '' })
                    setErreur('')
                  }}
                >
                  Annuler
                </button>
                <button type="submit" disabled={enregistrement} className="btn-primary flex-1">
                  {enregistrement ? 'Enregistrement…' : 'Valider'}
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
