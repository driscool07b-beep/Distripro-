import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const CLIENT_VIDE = {
  nom: '',
  telephone: '',
  email: '',
  adresse: '',
  ville: '',
  type_client: '',
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
  const [typesClient, setTypesClient] = useState([])
  const [ajoutTypeOuvert, setAjoutTypeOuvert] = useState(false)
  const [nouveauType, setNouveauType] = useState('')
  const [clientEnEdition, setClientEnEdition] = useState(null) // null = création, sinon id du client

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
    setClientEnEdition(null)
    setFormulaire(CLIENT_VIDE)
    setErreur('')
    setModalOuvert(true)
    capturerPositionActuelle()
  }

  function ouvrirEditionClient(client) {
    setClientEnEdition(client.id)
    setFormulaire({
      nom: client.nom || '',
      telephone: client.telephone || '',
      email: client.email || '',
      adresse: client.adresse || '',
      ville: client.ville || '',
      type_client: client.type_client || '',
      segment: client.segment || 'nouveau',
      limite_credit: client.limite_credit != null ? String(client.limite_credit) : '',
      notes: client.notes || '',
      latitude: client.latitude != null ? String(client.latitude) : '',
      longitude: client.longitude != null ? String(client.longitude) : '',
    })
    setErreur('')
    setCaptureGps('idle')
    setModalOuvert(true)
  }

  function ouvrirItineraire(client) {
    if (client.latitude == null || client.longitude == null) return
    const url = `https://www.google.com/maps/dir/?api=1&destination=${client.latitude},${client.longitude}`
    window.open(url, '_blank')
  }

  useEffect(() => {
    chargerClients()
    chargerTypesClient()
  }, [])

  async function chargerTypesClient() {
    const { data, error } = await supabase
      .from('types_client')
      .select('id, libelle')
      .eq('actif', true)
      .order('libelle')
    if (!error) setTypesClient(data || [])
  }

  async function ajouterTypeClient() {
    const libelle = nouveauType.trim()
    if (!libelle || !profil?.entreprise_id) return
    const { data, error } = await supabase
      .from('types_client')
      .insert({ entreprise_id: profil.entreprise_id, libelle })
      .select('id, libelle')
      .single()
    if (!error && data) {
      setTypesClient((prev) => [...prev, data].sort((a, b) => a.libelle.localeCompare(b.libelle)))
      setFormulaire((f) => ({ ...f, type_client: data.libelle }))
    }
    setNouveauType('')
    setAjoutTypeOuvert(false)
  }

  async function chargerClients() {
    setChargement(true)
    const { data, error } = await supabase
      .from('clients')
      .select('id, nom, telephone, email, adresse, ville, type_client, segment, limite_credit, notes, latitude, longitude, created_at')
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

    const donneesCommunes = {
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
    }

    const { error } = clientEnEdition
      ? await supabase.from('clients').update(donneesCommunes).eq('id', clientEnEdition)
      : await supabase.from('clients').insert({
          entreprise_id: profil.entreprise_id,
          commercial_id: profil.id,
          ...donneesCommunes,
        })

    setEnregistrement(false)
    if (error) {
      console.error('Erreur enregistrement client:', error)
      setErreur(`Erreur : ${error.message || 'inconnue'}`)
      return
    }
    setModalOuvert(false)
    setFormulaire(CLIENT_VIDE)
    setCaptureGps('idle')
    setAjoutTypeOuvert(false)
    setClientEnEdition(null)
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

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
              <th className="px-4 py-3 font-medium">Nom</th>
              <th className="px-4 py-3 font-medium">Téléphone</th>
              <th className="px-4 py-3 font-medium">Ville</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Segment</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {chargement ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-petrol-500">Chargement…</td></tr>
            ) : clientsFiltres.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-petrol-500">Aucun client trouvé.</td></tr>
            ) : (
              clientsFiltres.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                  <td className="px-4 py-3 font-medium">{c.nom}</td>
                  <td className="px-4 py-3 font-mono text-petrol-700">{c.telephone || '—'}</td>
                  <td className="px-4 py-3 text-petrol-700">{c.ville || '—'}</td>
                  <td className="px-4 py-3 text-petrol-700 capitalize">{c.type_client || '—'}</td>
                  <td className="px-4 py-3 text-petrol-700 capitalize">{c.segment || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => ouvrirEditionClient(c)}
                        className="text-petrol-700 underline"
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => ouvrirItineraire(c)}
                        disabled={c.latitude == null || c.longitude == null}
                        className={
                          c.latitude == null || c.longitude == null
                            ? 'text-petrol-300 cursor-not-allowed'
                            : 'text-blue-600 underline'
                        }
                        title={c.latitude == null ? 'Pas de position GPS enregistrée' : 'Ouvrir dans Google Maps'}
                      >
                        📍 Itinéraire
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md">
            <h2 className="font-semibold text-lg mb-4">
              {clientEnEdition ? 'Modifier le client' : 'Nouveau client'}
            </h2>
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
                  {!ajoutTypeOuvert ? (
                    <select
                      className="input-field"
                      value={formulaire.type_client}
                      onChange={(e) => {
                        if (e.target.value === '__nouveau__') {
                          setAjoutTypeOuvert(true)
                        } else {
                          setFormulaire({ ...formulaire, type_client: e.target.value })
                        }
                      }}
                    >
                      <option value="">— Sélectionner —</option>
                      {typesClient.map((t) => (
                        <option key={t.id} value={t.libelle}>{t.libelle}</option>
                      ))}
                      <option value="__nouveau__">+ Ajouter un type…</option>
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        className="input-field"
                        autoFocus
                        placeholder="Nom du nouveau type"
                        value={nouveauType}
                        onChange={(e) => setNouveauType(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), ajouterTypeClient())}
                      />
                      <button type="button" className="btn-secondary" onClick={ajouterTypeClient}>
                        OK
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setAjoutTypeOuvert(false)
                          setNouveauType('')
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  )}
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
              <div className="text-xs flex items-center gap-2 flex-wrap">
                {captureGps === 'en_cours' && (
                  <span className="text-petrol-600">📍 Capture de votre position en cours…</span>
                )}
                {captureGps === 'ok' && (
                  <span className="text-green-600">📍 Position capturée automatiquement.</span>
                )}
                {captureGps === 'echec' && (
                  <span className="text-amber-600">⚠️ Position indisponible — saisissez-la manuellement.</span>
                )}
                {captureGps !== 'en_cours' && (
                  <button type="button" onClick={capturerPositionActuelle} className="underline text-petrol-600">
                    {clientEnEdition ? '📍 Recapturer ma position actuelle' : 'Réessayer la capture'}
                  </button>
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
                    setAjoutTypeOuvert(false)
                    setClientEnEdition(null)
                  }}
                >
                  Annuler
                </button>
                <button type="submit" disabled={enregistrement} className="btn-primary flex-1">
                  {enregistrement
                    ? 'Enregistrement…'
                    : clientEnEdition
                    ? 'Modifier'
                    : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
