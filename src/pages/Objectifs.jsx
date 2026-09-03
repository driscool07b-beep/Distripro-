import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Objectifs() {
  const { profil } = useAuth()
  const [objectifs, setObjectifs] = useState([])
  const [chargement, setChargement] = useState(true)
  const [commerciaux, setCommerciaux] = useState([])
  const [produits, setProduits] = useState([])

  const [modalOuvert, setModalOuvert] = useState(false)
  const [typeCible, setTypeCible] = useState('commercial')
  const [commercialId, setCommercialId] = useState('')
  const [zone, setZone] = useState('')
  const [produitId, setProduitId] = useState('')
  const [periodeDebut, setPeriodeDebut] = useState(premierJourDuMois())
  const [periodeFin, setPeriodeFin] = useState(dernierJourDuMois())
  const [montantCible, setMontantCible] = useState('')
  const [quantiteCible, setQuantiteCible] = useState('')
  const [notes, setNotes] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')

  const autorise = ['admin', 'manager'].includes(profil?.role)

  useEffect(() => {
    if (autorise) charger()
  }, [autorise])

  async function charger() {
    setChargement(true)
    const { data } = await supabase
      .from('objectifs')
      .select('id, commercial_id, zone, produit_id, periode_debut, periode_fin, montant_cible, quantite_cible, notes, profils!commercial_id(nom), produits(nom)')
      .order('periode_debut', { ascending: false })

    const avecProgression = await Promise.all(
      (data || []).map(async (o) => {
        const progression = await calculerProgression(o)
        return { ...o, ...progression }
      })
    )
    setObjectifs(avecProgression)
    setChargement(false)
  }

  async function calculerProgression(o) {
    let ventes
    if (o.commercial_id) {
      const { data } = await supabase
        .from('ventes')
        .select('id, total, ventes_lignes(produit_id, quantite)')
        .neq('statut', 'annulee')
        .eq('commercial_id', o.commercial_id)
        .gte('created_at', `${o.periode_debut}T00:00:00`)
        .lt('created_at', `${o.periode_fin}T23:59:59.999`)
      ventes = data
    } else if (o.zone) {
      const { data } = await supabase
        .from('ventes')
        .select('id, total, ventes_lignes(produit_id, quantite), clients!inner(ville)')
        .neq('statut', 'annulee')
        .eq('clients.ville', o.zone)
        .gte('created_at', `${o.periode_debut}T00:00:00`)
        .lt('created_at', `${o.periode_fin}T23:59:59.999`)
      ventes = data
    }

    const montantRealise = (ventes || []).reduce((s, v) => s + Number(v.total || 0), 0)
    let quantiteRealisee = 0
    if (o.produit_id) {
      ;(ventes || []).forEach((v) => {
        ;(v.ventes_lignes || []).forEach((l) => {
          if (l.produit_id === o.produit_id) quantiteRealisee += l.quantite
        })
      })
    }

    return { montantRealise, quantiteRealisee }
  }

  async function chargerListes() {
    const [{ data: com }, { data: prod }] = await Promise.all([
      supabase.from('profils').select('id, nom').eq('role', 'commercial').order('nom'),
      supabase.from('produits').select('id, nom').eq('actif', true).order('nom'),
    ])
    setCommerciaux(com || [])
    setProduits(prod || [])
  }

  function ouvrirModal() {
    setTypeCible('commercial')
    setCommercialId('')
    setZone('')
    setProduitId('')
    setPeriodeDebut(premierJourDuMois())
    setPeriodeFin(dernierJourDuMois())
    setMontantCible('')
    setQuantiteCible('')
    setNotes('')
    setErreur('')
    chargerListes()
    setModalOuvert(true)
  }

  async function enregistrerObjectif(e) {
    e.preventDefault()
    setErreur('')

    if (typeCible === 'commercial' && !commercialId) {
      setErreur('Sélectionnez un commercial.')
      return
    }
    if (typeCible === 'zone' && !zone.trim()) {
      setErreur('Indiquez une zone.')
      return
    }
    if (!montantCible && !quantiteCible) {
      setErreur('Indiquez un montant cible et/ou une quantité cible.')
      return
    }
    if (quantiteCible && !produitId) {
      setErreur('Une quantité cible doit être associée à un produit précis.')
      return
    }

    setEnvoi(true)
    const { error } = await supabase.from('objectifs').insert({
      entreprise_id: profil.entreprise_id,
      commercial_id: typeCible === 'commercial' ? commercialId : null,
      zone: typeCible === 'zone' ? zone.trim() : null,
      produit_id: produitId || null,
      periode_debut: periodeDebut,
      periode_fin: periodeFin,
      montant_cible: montantCible ? Number(montantCible) : null,
      quantite_cible: quantiteCible ? Number(quantiteCible) : null,
      notes: notes.trim() || null,
      created_by: profil.id,
    })
    setEnvoi(false)
    if (error) {
      setErreur(`Erreur : ${error.message}`)
      return
    }
    setModalOuvert(false)
    charger()
  }

  async function supprimerObjectif(id) {
    await supabase.from('objectifs').delete().eq('id', id)
    charger()
  }

  if (!autorise) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">Cette page est réservée aux responsables commerciaux et à la direction.</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold">Objectifs commerciaux</h1>
        <button onClick={ouvrirModal} className="btn-primary text-sm">
          + Nouvel objectif
        </button>
      </div>

      {chargement ? (
        <p className="text-sm text-petrol-500">Chargement…</p>
      ) : (
        <div className="space-y-3">
          {objectifs.map((o) => (
            <CarteObjectif key={o.id} objectif={o} onSupprimer={() => supprimerObjectif(o.id)} />
          ))}
          {objectifs.length === 0 && <p className="text-petrol-400 text-center py-8 text-sm">Aucun objectif défini.</p>}
        </div>
      )}

      {modalOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-4">Nouvel objectif</h2>
            <form onSubmit={enregistrerObjectif} className="space-y-3">
              <div>
                <label className="label">Cible</label>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setTypeCible('commercial')}
                    className={`flex-1 text-sm px-3 py-2 rounded-lg border ${typeCible === 'commercial' ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line'}`}
                  >
                    Un commercial
                  </button>
                  <button
                    type="button"
                    onClick={() => setTypeCible('zone')}
                    className={`flex-1 text-sm px-3 py-2 rounded-lg border ${typeCible === 'zone' ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line'}`}
                  >
                    Une zone
                  </button>
                </div>
                {typeCible === 'commercial' ? (
                  <select className="input-field" value={commercialId} onChange={(e) => setCommercialId(e.target.value)}>
                    <option value="">— Sélectionner —</option>
                    {commerciaux.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                ) : (
                  <input
                    className="input-field"
                    value={zone}
                    onChange={(e) => setZone(e.target.value)}
                    placeholder="Ex. Abidjan Nord (doit correspondre à la ville des clients)"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Début de période</label>
                  <input type="date" className="input-field" value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} />
                </div>
                <div>
                  <label className="label">Fin de période</label>
                  <input type="date" className="input-field" value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="label">Montant cible (F CFA, optionnel)</label>
                <input
                  type="number"
                  min="0"
                  className="input-field"
                  value={montantCible}
                  onChange={(e) => setMontantCible(e.target.value)}
                  placeholder="Ex. 500000"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Produit (pour une quantité cible)</label>
                  <select className="input-field" value={produitId} onChange={(e) => setProduitId(e.target.value)}>
                    <option value="">— Aucun —</option>
                    {produits.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Quantité cible</label>
                  <input
                    type="number"
                    min="0"
                    className="input-field"
                    value={quantiteCible}
                    onChange={(e) => setQuantiteCible(e.target.value)}
                    placeholder="Ex. 200"
                  />
                </div>
              </div>

              <div>
                <label className="label">Notes</label>
                <textarea className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              {erreur && <p className="text-sm text-red-600">{erreur}</p>}

              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setModalOuvert(false)}>Annuler</button>
                <button type="submit" disabled={envoi} className="btn-primary flex-1">
                  {envoi ? 'Enregistrement…' : "Créer l'objectif"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function CarteObjectif({ objectif: o, onSupprimer }) {
  const cible = o.profils?.nom || o.zone
  const pctMontant = o.montant_cible ? Math.min(100, Math.round((o.montantRealise / o.montant_cible) * 100)) : null
  const pctQuantite = o.quantite_cible ? Math.min(100, Math.round((o.quantiteRealisee / o.quantite_cible) * 100)) : null

  return (
    <div className="card p-4">
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="font-medium text-sm">{cible}</p>
          <p className="text-xs text-petrol-500">
            {new Date(o.periode_debut).toLocaleDateString('fr-FR')} — {new Date(o.periode_fin).toLocaleDateString('fr-FR')}
            {o.produits?.nom ? ` — ${o.produits.nom}` : ''}
          </p>
        </div>
        <button onClick={onSupprimer} className="text-xs text-red-600 underline">Supprimer</button>
      </div>

      {o.montant_cible != null && (
        <div className="mb-2">
          <div className="flex justify-between text-xs text-petrol-600 mb-1">
            <span>Montant : {formatXOF(o.montantRealise)} / {formatXOF(o.montant_cible)}</span>
            <span className="font-medium">{pctMontant}%</span>
          </div>
          <BarreProgression pct={pctMontant} />
        </div>
      )}

      {o.quantite_cible != null && (
        <div>
          <div className="flex justify-between text-xs text-petrol-600 mb-1">
            <span>Quantité : {o.quantiteRealisee} / {o.quantite_cible}</span>
            <span className="font-medium">{pctQuantite}%</span>
          </div>
          <BarreProgression pct={pctQuantite} />
        </div>
      )}

      {o.notes && <p className="text-xs text-petrol-500 mt-2">{o.notes}</p>}
    </div>
  )
}

function BarreProgression({ pct }) {
  const couleur = pct >= 100 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-400'
  return (
    <div className="w-full bg-canvas rounded-full h-2">
      <div className={`h-2 rounded-full ${couleur}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function premierJourDuMois() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
}
function dernierJourDuMois() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]
}
function formatXOF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0) + ' F CFA'
}
