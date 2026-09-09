import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { traduireErreur } from '../lib/erreurs'

const LIBELLES_TYPE = {
  principal: 'Principal',
  secondaire: 'Secondaire',
  mobile: 'Mobile',
}

export default function Depots() {
  const { profil } = useAuth()
  const [depots, setDepots] = useState([])
  const [responsables, setResponsables] = useState([])
  const [chargement, setChargement] = useState(true)

  const [modalOuvert, setModalOuvert] = useState(false)
  const [depotEnEdition, setDepotEnEdition] = useState(null)
  const [nom, setNom] = useState('')
  const [type, setType] = useState('secondaire')
  const [responsableId, setResponsableId] = useState('')
  const [actif, setActif] = useState(true)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')

  const autorise = ['admin', 'manager'].includes(profil?.role)

  useEffect(() => {
    if (autorise) charger()
  }, [autorise])

  async function charger() {
    setChargement(true)
    const [{ data: d }, { data: r }] = await Promise.all([
      supabase.from('depots').select('id, nom, type, actif, responsable_id, profils!responsable_id(nom)').order('nom'),
      supabase.from('profils').select('id, nom').in('role', ['admin', 'manager', 'gestionnaire_stock']).order('nom'),
    ])
    setDepots(d || [])
    setResponsables(r || [])
    setChargement(false)
  }

  function ouvrirModal(depot) {
    if (depot) {
      setDepotEnEdition(depot)
      setNom(depot.nom)
      setType(depot.type || 'secondaire')
      setResponsableId(depot.responsable_id || '')
      setActif(depot.actif)
    } else {
      setDepotEnEdition(null)
      setNom('')
      setType('secondaire')
      setResponsableId('')
      setActif(true)
    }
    setErreur('')
    setModalOuvert(true)
  }

  async function enregistrer(e) {
    e.preventDefault()
    setErreur('')
    if (!nom.trim()) {
      setErreur('Le nom du dépôt est requis.')
      return
    }
    setEnvoi(true)

    let error
    if (depotEnEdition) {
      const resultat = await supabase.rpc('modifier_depot', {
        p_depot_id: depotEnEdition.id,
        p_nom: nom.trim(),
        p_type: type,
        p_responsable_id: responsableId || null,
        p_actif: actif,
      })
      error = resultat.error
    } else {
      const resultat = await supabase.rpc('creer_depot', {
        p_nom: nom.trim(),
        p_type: type,
        p_responsable_id: responsableId || null,
      })
      error = resultat.error
    }

    setEnvoi(false)
    if (error) {
      setErreur(`Erreur : ${traduireErreur(error.message)}`)
      return
    }
    setModalOuvert(false)
    charger()
  }

  if (!autorise) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">Cette page est réservée à l'administrateur et au manager.</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold">Magasins de stockage</h1>
        <button onClick={() => ouvrirModal(null)} className="btn-primary text-sm">
          + Nouveau dépôt
        </button>
      </div>

      {chargement ? (
        <p className="text-sm text-petrol-500">Chargement…</p>
      ) : (
        <div className="space-y-2">
          {depots.map((d) => (
            <div key={d.id} className={`border rounded-lg p-3 flex justify-between items-center ${d.actif ? 'border-line' : 'border-red-200 bg-red-50/40'}`}>
              <div>
                <p className="text-sm font-medium">
                  {d.nom}
                  {!d.actif && <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Inactif</span>}
                </p>
                <p className="text-xs text-petrol-500">
                  {LIBELLES_TYPE[d.type] || d.type || 'Type non précisé'}
                  {d.profils?.nom ? ` — Responsable : ${d.profils.nom}` : ''}
                </p>
              </div>
              <button onClick={() => ouvrirModal(d)} className="text-xs text-petrol-600 underline">
                Modifier
              </button>
            </div>
          ))}
          {depots.length === 0 && <p className="text-petrol-400 text-center py-8 text-sm">Aucun dépôt.</p>}
        </div>
      )}

      {modalOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md">
            <h2 className="font-semibold text-lg mb-4">{depotEnEdition ? 'Modifier le dépôt' : 'Nouveau dépôt'}</h2>
            <form onSubmit={enregistrer} className="space-y-3">
              <div>
                <label className="label">Nom</label>
                <input className="input-field" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex. Entrepôt Yopougon" />
              </div>
              <div>
                <label className="label">Type</label>
                <select className="input-field" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="principal">Principal</option>
                  <option value="secondaire">Secondaire</option>
                  <option value="mobile">Mobile</option>
                </select>
              </div>
              <div>
                <label className="label">Responsable (optionnel)</label>
                <select className="input-field" value={responsableId} onChange={(e) => setResponsableId(e.target.value)}>
                  <option value="">— Aucun —</option>
                  {responsables.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
                </select>
              </div>
              {depotEnEdition && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} />
                  Dépôt actif
                </label>
              )}
              {erreur && <p className="text-sm text-red-600">{erreur}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setModalOuvert(false)}>Annuler</button>
                <button type="submit" disabled={envoi} className="btn-primary flex-1">
                  {envoi ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
