import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const CLIENT_VIDE = {
  nom: '',
  telephone: '',
  email: '',
  adresse: '',
  ville: '',
  type_client: 'diaspora',
  segment: 'nouveau',
  limite_credit: '',
  notes: '',
  latitude: '',
  longitude: '',
}

export default function Clients() {
  const { profil } = useAuth()
  const [clients, setClients] = useState([])
  const [recherche, setRecherche] = useState('')
  const [chargement, setChargement] = useState(true)
  const [modalOuvert, setModalOuvert] = useState(false)
  const [formulaire, setFormulaire] = useState(CLIENT_VIDE)
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState('')
  const [captureGps, setCaptureGps] = useState('idle') // idle | en_cours | ok | echec

  function capturerPositionActuelle() {
    if (!navigator.geolocation) {
      setCaptureGps('echec')
      return
    }
    setCaptureGps('en_cours')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFormulaire((f) => ({
          ...f,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        }))
        setCaptureGps('ok')
      },
      () => setCaptureGps('echec'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  function ouvrirNouveauClient() {
    setFormulaire(CLIENT_VIDE)
    setErreur('')
    setModalOuvert(true)
    capturerPositionActuelle()
  }

  useEffect(() => {
    chargerClients()
  }, [])

  async function chargerClients() {
    setChargement(true)
    const { data, error } = await supabase
      .from('clients')
      .select('id, nom, telephone, ville, type_client, segment, adresse, created_at')
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
    if (!profil?.entreprise_id) {
      setErreur('Profil non chargé. Réessayez dans un instant.')
      return
    }
    setEnregistrement(true)
    const { error } = await supabase.from('clients').insert({
      entreprise_id: profil.entreprise_id,
      commercial_id: profil.id,
      nom: formulaire.nom.trim(),
      telephone: formulaire.telephone.trim() || null,
      email: formulaire.email.trim() || null,
      adresse: formulaire.adresse.trim() || null,
      ville: formulaire.ville.trim() || null,
      type_client: formulaire.type_client || null,
      segment: formulaire.segment || null,
      limite_credit: formulaire.limite_credit ? Number(formulaire.limite_credit) : 0,
      notes: formulaire.notes.trim() || null,
      latitude: formulaire.latitude ? Number(formulaire.latitude) : null,
      longitude: formulaire.longitude ? Number(formulaire.longitude) : null,
    })
    setEnregistrement(false)
    if (error) {
      console.error('Erreur insertion client:', error)
      setErreur(`Erreur : ${error.message || 'inconnue'}`)
      return
    }
    setModalOuvert(false)
    setFormulaire(CLIENT_VIDE)
    setCaptureGps('idle')
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
        <button className="btn-primary" onClick={ouvrirNouveauClient}>
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
              <th className="px-4 py-3 font-medium">Ville</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Segment</th>
            </tr>
          </thead>
          <tbody>
            {chargement ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-petrol-500">Chargement…</td></tr>
            ) : clientsFiltres.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-petrol-500">Aucun client trouvé.</td></tr>
            ) : (
              clientsFiltres.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                  <td className="px-4 py-3 font-medium">{c.nom}</td>
                  <td className="px-4 py-3 font-mono text-petrol-700">{c.telephone || '—'}</td>
                  <td className="px-4 py-3 text-petrol-700">{c.ville || '—'}</td>
                  <td className="px-4 py-3 text-petrol-700 capitalize">{c.type_client || '—'}</td>
                  <td className="px-4 py-3 text-petrol-700 capitalize">{c.segment || '—'}</td>
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
                  <label className="label">Email</label>
                  <input
                    type="email"
                    className="input-field"
                    value={formulaire.email}
                    onChange={(e) => setFormulaire({ ...formulaire, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Ville</label>
                  <input
                    className="input-field"
                    value={formulaire.ville}
                    onChange={(e) => setFormulaire({ ...formulaire, ville: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Type de client</label>
                  <select
                    className="input-field"
                    value={formulaire.type_client}
                    onChange={(e) => setFormulaire({ ...formulaire, type_client: e.target.value })}
                  >
                    <option value="diaspora">Diaspora</option>
                    <option value="prosuma">Prosuma</option>
                    <option value="prosuma_port">Prosuma Port</option>
                    <option value="sococe_ci">Sococe CI</option>
                    <option value="s2p">S2P</option>
                    <option value="auchan">Auchan</option>
                    <option value="clinique">Clinique</option>
                    <option value="autre">Autre</option>
                  </select>
                </div>
                <div>
                  <label className="label">Segment</label>
                  <select
                    className="input-field"
                    value={formulaire.segment}
                    onChange={(e) => setFormulaire({ ...formulaire, segment: e.target.value })}
                  >
                    <option value="nouveau">Nouveau</option>
                    <option value="actif">Actif</option>
                    <option value="vip">VIP</option>
                    <option value="a_relancer">À relancer</option>
                    <option value="inactif">Inactif</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Limite de crédit (F CFA)</label>
                <input
                  type="number"
                  min="0"
                  className="input-field"
                  value={formulaire.limite_credit}
                  onChange={(e) => setFormulaire({ ...formulaire, limite_credit: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input-field"
                  rows={2}
                  value={formulaire.notes}
                  onChange={(e) => setFormulaire({ ...formulaire, notes: e.target.value })}
                />
              </div>
              <div className="text-xs">
                {captureGps === 'en_cours' && (
                  <span className="text-petrol-600">📍 Capture de votre position en cours…</span>
                )}
                {captureGps === 'ok' && (
                  <span className="text-green-600">📍 Position capturée automatiquement.</span>
                )}
                {captureGps === 'echec' && (
                  <span className="text-amber-600">
                    ⚠️ Position indisponible — saisissez-la manuellement, ou{' '}
                    <button
                      type="button"
                      onClick={capturerPositionActuelle}
                      className="underline"
                    >
                      réessayer
                    </button>
                    .
                  </span>
                )}
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
                    setCaptureGps('idle')
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
