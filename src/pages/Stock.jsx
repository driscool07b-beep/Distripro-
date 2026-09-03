import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { exporterExcel, exporterPDF, formatMontantPDF } from '../lib/export'
import * as XLSX from 'xlsx'

const PRODUIT_VIDE = { nom: '', categorie: '', prix_vente: '', seuil_alerte: '10', quantite_initiale: '0' }

export default function Stock() {
  const { entreprise } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const filtreAlertes = searchParams.get('filtre') === 'alertes'
  const [produits, setProduits] = useState([])
  const [recherche, setRecherche] = useState('')
  const [chargement, setChargement] = useState(true)
  const [modalProduit, setModalProduit] = useState(false)
  const [modalImportOuvert, setModalImportOuvert] = useState(false)
  const [lignesImport, setLignesImport] = useState([])
  const [erreurImport, setErreurImport] = useState('')
  const [importEnCours, setImportEnCours] = useState(false)
  const [progressionImport, setProgressionImport] = useState(0)
  const [resultatImport, setResultatImport] = useState(null)
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
      .select('id, nom, categorie, prix_vente, seuil_alerte, created_at, stocks(quantite)')
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
    if (!formulaire.nom.trim() || !formulaire.prix_vente) {
      setErreur('Le nom et le prix unitaire sont requis.')
      return
    }
    setEnregistrement(true)
    const { error } = await supabase.rpc('creer_produit', {
      p_nom: formulaire.nom.trim(),
      p_categorie: formulaire.categorie.trim() || null,
      p_prix_vente: Number(formulaire.prix_vente),
      p_seuil_alerte: Number(formulaire.seuil_alerte || 0),
      p_quantite_initiale: Number(formulaire.quantite_initiale || 0),
    })
    setEnregistrement(false)
    if (error) {
      console.error('Erreur creer_produit:', error)
      setErreur(`Erreur : ${error.message || 'inconnue'}`)
      return
    }
    setModalProduit(false)
    setFormulaire(PRODUIT_VIDE)
    chargerProduits()
  }

  function ouvrirModalImport() {
    setLignesImport([])
    setErreurImport('')
    setResultatImport(null)
    setProgressionImport(0)
    setModalImportOuvert(true)
  }

  function telechargerModeleImport() {
    const feuille = XLSX.utils.aoa_to_sheet([
      ['Nom', 'Catégorie', 'Prix de vente', 'Seuil alerte', 'Stock initial'],
      ['Produit Exemple 500g', 'Céréales', 1000, 10, 50],
    ])
    const classeur = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(classeur, feuille, 'Produits')
    XLSX.writeFile(classeur, 'modele-import-produits.xlsx')
  }

  function lireFichierImport(e) {
    const fichier = e.target.files?.[0]
    if (!fichier) return
    setErreurImport('')
    setResultatImport(null)

    const lecteur = new FileReader()
    lecteur.onload = (event) => {
      try {
        const classeur = XLSX.read(event.target.result, { type: 'array' })
        const feuille = classeur.Sheets[classeur.SheetNames[0]]
        const lignes = XLSX.utils.sheet_to_json(feuille, {
          header: ['nom', 'categorie', 'prix_vente', 'seuil_alerte', 'quantite_initiale'],
          range: 1,
          defval: '',
        })
        const lignesValides = lignes
          .map((l) => ({
            nom: String(l.nom || '').trim(),
            categorie: String(l.categorie || '').trim(),
            prix_vente: Number(l.prix_vente) || 0,
            seuil_alerte: Number(l.seuil_alerte) || 0,
            quantite_initiale: Number(l.quantite_initiale) || 0,
          }))
          .filter((l) => l.nom && l.prix_vente > 0)
        setLignesImport(lignesValides)
        if (lignesValides.length === 0) setErreurImport('Aucune ligne valide (nom et prix de vente obligatoires).')
      } catch (err) {
        setErreurImport(`Fichier illisible : ${err.message}`)
      }
    }
    lecteur.readAsArrayBuffer(fichier)
  }

  async function confirmerImport() {
    if (lignesImport.length === 0) return
    setImportEnCours(true)
    setErreurImport('')
    let reussis = 0
    const echecs = []

    for (let i = 0; i < lignesImport.length; i++) {
      const l = lignesImport[i]
      const { error } = await supabase.rpc('creer_produit', {
        p_nom: l.nom,
        p_categorie: l.categorie || null,
        p_prix_vente: l.prix_vente,
        p_seuil_alerte: l.seuil_alerte,
        p_quantite_initiale: l.quantite_initiale,
      })
      if (error) echecs.push(`${l.nom} : ${error.message}`)
      else reussis++
      setProgressionImport(i + 1)
    }

    setImportEnCours(false)
    setResultatImport({ reussis, total: lignesImport.length, echecs })
    setLignesImport([])
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

  const produitsFiltres = produits
    .filter((p) => p.nom.toLowerCase().includes(recherche.toLowerCase()))
    .filter((p) => !filtreAlertes || p.quantite <= (p.seuil_alerte ?? 0))
  const nbAlertes = produits.filter((p) => p.quantite <= (p.seuil_alerte ?? 0)).length
  const valeurTotaleStock = produits.reduce((s, p) => s + p.quantite * (p.prix_vente || 0), 0)

  const COLONNES_EXPORT = [
    { cle: 'nom', titre: 'Produit' },
    { cle: 'categorie', titre: 'Catégorie' },
    { cle: 'prix', titre: 'Prix unitaire (F CFA)', alignDroite: true },
    { cle: 'stock', titre: 'Stock', alignDroite: true },
    { cle: 'valeur', titre: 'Valeur (F CFA)', alignDroite: true },
  ]
  function donneesExport() {
    return (produitsFiltres || []).map((p) => ({
      nom: p.nom,
      categorie: p.categorie || '—',
      prix: Number(p.prix_vente || 0),
      stock: p.quantite,
      valeur: p.quantite * (p.prix_vente || 0),
    }))
  }
  function exportExcel() {
    exporterExcel('stock', COLONNES_EXPORT, donneesExport())
  }
  function exportPDF() {
    exporterPDF('stock', 'Produits & Stock', null, COLONNES_EXPORT, donneesExport(), 'Valeur totale', formatMontantPDF(valeurTotaleStock) + ' F CFA', entreprise)
  }

  return (
    <div className="p-8 max-w-6xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Produits &amp; Stock</h1>
          <p className="text-sm text-petrol-700 mt-1">
            {produits.length} produit(s) — {nbAlertes > 0 ? (
              <span className="text-amber-600 font-medium">{nbAlertes} en alerte de stock</span>
            ) : (
              'stock sain'
            )}
          </p>
          <p className="text-sm text-petrol-700 mt-0.5">
            Valeur totale du stock : <span className="font-mono font-medium">{formatXOF(valeurTotaleStock)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary text-sm" onClick={exportExcel} disabled={produitsFiltres.length === 0}>
            📊 Excel
          </button>
          <button className="btn-secondary text-sm" onClick={exportPDF} disabled={produitsFiltres.length === 0}>
            📄 PDF
          </button>
          <button className="btn-secondary text-sm" onClick={ouvrirModalImport}>
            📥 Importer
          </button>
          <button className="btn-primary" onClick={() => setModalProduit(true)}>
            + Nouveau produit
          </button>
        </div>
      </header>

      <input
        type="text"
        placeholder="Rechercher un produit…"
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        className="input-field max-w-sm mb-4"
      />

      {filtreAlertes && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full">
            Filtré : produits en alerte de stock
          </span>
          <button
            onClick={() => setSearchParams({})}
            className="text-petrol-500 underline text-xs"
          >
            Retirer le filtre
          </button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
              <th className="px-4 py-3 font-medium">Produit</th>
              <th className="px-4 py-3 font-medium">Catégorie</th>
              <th className="px-4 py-3 font-medium">Prix unitaire</th>
              <th className="px-4 py-3 font-medium">Stock</th>
              <th className="px-4 py-3 font-medium">Valeur</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {chargement ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-petrol-500">Chargement…</td></tr>
            ) : produitsFiltres.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-petrol-500">Aucun produit trouvé.</td></tr>
            ) : (
              produitsFiltres.map((p) => {
                const enAlerte = p.quantite <= (p.seuil_alerte ?? 0)
                return (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                    <td className="px-4 py-3 font-medium">{p.nom}</td>
                    <td className="px-4 py-3 text-petrol-700">{p.categorie || '—'}</td>
                    <td className="px-4 py-3 font-mono text-petrol-700">{formatXOF(p.prix_vente)}</td>
                    <td className="px-4 py-3">
                      <span className={`font-mono px-2 py-0.5 rounded ${enAlerte ? 'bg-amber-50 text-amber-700' : 'text-petrol-900'}`}>
                        {p.quantite}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-petrol-700">
                      {formatXOF(p.quantite * (p.prix_vente || 0))}
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
          <div className="card bg-white p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
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
                    value={formulaire.prix_vente}
                    onChange={(e) => setFormulaire({ ...formulaire, prix_vente: e.target.value })}
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
          <div className="card bg-white p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
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

      {modalImportOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="font-semibold text-lg">Importer des produits (Excel)</h2>
              <button onClick={() => setModalImportOuvert(false)} className="text-petrol-400 text-xl leading-none">✕</button>
            </div>

            <p className="text-sm text-petrol-600 mb-3">
              Téléchargez le modèle, remplissez-le en gardant l'ordre des colonnes, puis importez-le.
            </p>
            <button onClick={telechargerModeleImport} className="btn-secondary text-sm mb-4">
              📄 Télécharger le modèle
            </button>

            <div className="mb-4">
              <label className="label">Fichier Excel (.xlsx)</label>
              <input type="file" accept=".xlsx,.xls" onChange={lireFichierImport} className="text-sm" />
            </div>

            {erreurImport && <p className="text-sm text-red-600 mb-3">{erreurImport}</p>}

            {lignesImport.length > 0 && (
              <>
                <p className="text-sm font-medium mb-2">{lignesImport.length} produit(s) prêt(s) à importer</p>
                <div className="border border-line rounded-lg overflow-y-auto max-h-48 mb-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-canvas text-left">
                        <th className="px-2 py-1.5">Nom</th>
                        <th className="px-2 py-1.5 text-right">Prix</th>
                        <th className="px-2 py-1.5 text-right">Stock initial</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignesImport.slice(0, 20).map((l, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="px-2 py-1.5">{l.nom}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{l.prix_vente}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{l.quantite_initiale}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {lignesImport.length > 20 && (
                    <p className="text-xs text-petrol-400 text-center py-1.5">… et {lignesImport.length - 20} de plus</p>
                  )}
                </div>
                <button onClick={confirmerImport} disabled={importEnCours} className="btn-primary w-full">
                  {importEnCours ? `Import en cours… (${progressionImport}/${lignesImport.length})` : `Importer ${lignesImport.length} produit(s)`}
                </button>
              </>
            )}

            {resultatImport && (
              <div className="mt-3">
                <p className="text-sm text-green-700">
                  ✓ {resultatImport.reussis} produit(s) importé(s) sur {resultatImport.total}.
                </p>
                {resultatImport.echecs.length > 0 && (
                  <div className="text-xs text-red-600 mt-2">
                    {resultatImport.echecs.map((e, i) => <p key={i}>{e}</p>)}
                  </div>
                )}
              </div>
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
