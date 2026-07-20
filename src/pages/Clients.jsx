import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const CLIENT_VIDE = { nom: '', telephone: '', adresse: '', latitude: '', longitude: '' }

export default function Clients() {
  const [clients, setClients] = useState([])
  const [recherche, setRecherche] = useState('')
  const [chargement, setChargement] = useState(true)
  const [modalOuvert, setModalOuvert] = useState(false)
  const [formulaire, setFormulaire] = useState(CLIENT_VIDE)
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    chargerClients()
  }, [])

  async function chargerClients() {
    setChargement(true)
    const { data, error } = await supabase
      .from('clients')
      .select('id, nom, telephone, adresse, created_at')
      .order('created_at', { ascending: false })
    if (!error) setClients(data || [])
    setChargement(false)
  }

  async function enregistrerClient(e) {
    e.preventDefault()
    setErreur('')
    if (!formulaire.nom.trim()) {
      setErreur('Le nom du client est requis.')
      return
    }
    setEnregistrement(true)
    const { error } = await supabase.from('clients').insert({
      nom: formulaire.nom.trim(),
      telephone: formulaire.telephone.trim() || null,
      adresse: formulaire.adresse.trim() || null,
      latitude: formulaire.latitude ? Number(formulaire.latitude) : null,
      longitude: formulaire.longitude ? Number(formulaire.longitude) : null,
    })
    setEnregistrement(false)
    if (error) {
      setErreur("Erreur lors de l'enregistrement. Réessayez.")
      return
    }
    setModalOuvert(false)
    setFormulaire(CLIENT_VIDE)
    chargerClients()
  }

  const clientsFiltres = clients.filter((c) =>
    c.nom.toLowerCase().includes(recherche.toLowerCase())
  )

  return (
    <div className="p-8 max-w-6xl">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="text-sm text-petrol-700 mt-1">{clients.length} client(s) enregistré(s)</p>
        </div>
        <button className="btn-primary" onClick={() => setModalOuvert(true)}>
          + Nouveau client
        </button>
      </header>

      <input
        type="text"
        placeholder="Rechercher un client…"
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        className="input-field max-w-sm mb-4"
      />

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
              <th className="px-4 py-3 font-medium">Nom</th>
              <th className="px-4 py-3 font-medium">Téléphone</th>
              <th className="px-4 py-3 font-medium">Adresse</th>
            </tr>
          </thead>
          <tbody>
            {chargement ? (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-petrol-500">Chargement…</td></tr>
            ) : clientsFiltres.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-petrol-500">Aucun client trouvé.</td></tr>
            ) : (
              clientsFiltres.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                  <td className="px-4 py-3 font-medium">{c.nom}</td>
                  <td className="px-4 py-3 font-mono text-petrol-700">{c.telephone || '—'}</td>
                  <td className="px-4 py-3 text-petrol-700">{c.adresse || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md">
            <h2 className="font-semibold text-lg mb-4">Nouveau client</h2>
            <form onSubmit={enregistrerClient} className="space-y-3">
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
                <label className="label">Téléphone</label>
                <input
                  className="input-field"
                  value={formulaire.telephone}
                  onChange={(e) => setFormulaire({ ...formulaire, telephone: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Adresse</label>
                <input
                  className="input-field"
                  value={formulaire.adresse}
                  onChange={(e) => setFormulaire({ ...formulaire, adresse: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Latitude</label>
                  <input
                    className="input-field font-mono"
                    value={formulaire.latitude}
                    onChange={(e) => setFormulaire({ ...formulaire, latitude: e.target.value })}
                    placeholder="5.3097"
                  />
                </div>
                <div>
                  <label className="label">Longitude</label>
                  <input
                    className="input-field font-mono"
                    value={formulaire.longitude}
                    onChange={(e) => setFormulaire({ ...formulaire, longitude: e.target.value })}
                    placeholder="-4.0126"
                  />
                </div>
              </div>

              {erreur && <div className="text-sm text-red-600">{erreur}</div>}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  className="btn-secondary flex-1"
                  onClick={() => {
                    setModalOuvert(false)
                    setFormulaire(CLIENT_VIDE)
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
    </div>
  )
}
