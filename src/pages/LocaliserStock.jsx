import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function LocaliserStock() {
  const [produits, setProduits] = useState([])
  const [produitId, setProduitId] = useState('')
  const [chargement, setChargement] = useState(false)
  const [resultats, setResultats] = useState(null)
  const [position, setPosition] = useState(null)
  const [captureGps, setCaptureGps] = useState('idle')

  useEffect(() => {
    supabase.from('produits').select('id, nom').eq('actif', true).order('nom').then(({ data }) => setProduits(data || []))
  }, [])

  function capturerPosition() {
    if (!navigator.geolocation) {
      setCaptureGps('echec')
      return
    }
    setCaptureGps('en_cours')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setCaptureGps('ok')
      },
      () => setCaptureGps('echec'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  async function rechercher() {
    if (!produitId) return
    setChargement(true)
    setResultats(null)

    const { data, error } = await supabase
      .from('rapport_visite_produits')
      .select('quantite_rayon, rapports_visite(created_at, client_id, clients(nom, telephone, adresse, ville, latitude, longitude))')
      .eq('produit_id', produitId)
      .gt('quantite_rayon', 0)
      .order('created_at', { foreignTable: 'rapports_visite', ascending: false })

    if (error || !data) {
      setResultats([])
      setChargement(false)
      return
    }

    const dejaVus = new Set()
    let clientsUniques = []
    const donneesTriees = [...data].sort(
      (a, b) => new Date(b.rapports_visite?.created_at || 0) - new Date(a.rapports_visite?.created_at || 0)
    )
    donneesTriees.forEach((l) => {
      const rv = l.rapports_visite
      if (!rv || !rv.clients) return
      if (dejaVus.has(rv.client_id)) return
      dejaVus.add(rv.client_id)
      clientsUniques.push({
        clientId: rv.client_id,
        nom: rv.clients.nom,
        telephone: rv.clients.telephone,
        adresse: rv.clients.adresse,
        ville: rv.clients.ville,
        latitude: rv.clients.latitude,
        longitude: rv.clients.longitude,
        quantite: l.quantite_rayon,
        dateReleve: rv.created_at,
      })
    })

    if (position) {
      clientsUniques = clientsUniques
        .map((c) => ({
          ...c,
          distanceKm:
            c.latitude != null && c.longitude != null
              ? distanceKm(position.lat, position.lon, c.latitude, c.longitude)
              : null,
        }))
        .sort((a, b) => {
          if (a.distanceKm == null) return 1
          if (b.distanceKm == null) return -1
          return a.distanceKm - b.distanceKm
        })
    }

    setResultats(clientsUniques)
    setChargement(false)
  }

  function ouvrirItineraire(c) {
    if (c.latitude == null || c.longitude == null) return
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${c.latitude},${c.longitude}`, '_blank')
  }

  function joursDepuis(date) {
    const jours = Math.floor((Date.now() - new Date(date)) / 86400000)
    if (jours === 0) return "aujourd'hui"
    if (jours === 1) return 'hier'
    return `il y a ${jours} jours`
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Localiser un produit</h1>
      <p className="text-sm text-petrol-500 mb-4">
        Trouvez les clients ayant eu ce produit en rayon lors de leur dernière visite relevée —
        utile quand un client appelle pour savoir où en trouver.
      </p>

      <div className="card p-4 mb-4 space-y-3">
        <div>
          <label className="label">Produit recherché</label>
          <select className="input-field" value={produitId} onChange={(e) => setProduitId(e.target.value)}>
            <option value="">— Sélectionner —</option>
            {produits.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </select>
        </div>

        <div className="text-xs flex items-center gap-2 flex-wrap">
          {captureGps === 'ok' && <span className="text-green-600">📍 Position capturée — résultats triés par proximité.</span>}
          {captureGps === 'echec' && <span className="text-amber-600">⚠️ Position indisponible — résultats triés par date.</span>}
          <button type="button" onClick={capturerPosition} className="underline text-petrol-600">
            {captureGps === 'en_cours' ? 'Capture en cours…' : '📍 Utiliser ma position actuelle'}
          </button>
        </div>

        <button onClick={rechercher} disabled={!produitId || chargement} className="btn-primary w-full">
          {chargement ? 'Recherche…' : 'Rechercher'}
        </button>
      </div>

      {resultats && (
        <div className="space-y-2">
          <p className="text-xs text-petrol-500">
            {resultats.length} client(s) où ce produit a été relevé en stock — donnée basée sur les
            visites terrain, pas un inventaire en temps réel.
          </p>
          {resultats.map((c) => (
            <div key={c.clientId} className="border border-line rounded-lg p-3 flex justify-between items-start gap-3">
              <div>
                <p className="font-medium text-sm">{c.nom}</p>
                <p className="text-xs text-petrol-500">
                  {c.ville || c.adresse || 'Localisation non précisée'}
                  {c.distanceKm != null && ` — ${c.distanceKm.toFixed(1)} km`}
                </p>
                <p className="text-xs text-petrol-500">
                  {c.quantite} unité(s) vue(s) en rayon — relevé {joursDepuis(c.dateReleve)}
                </p>
                {c.telephone && <p className="text-xs text-petrol-600 mt-1">📞 {c.telephone}</p>}
              </div>
              {c.latitude != null && (
                <button onClick={() => ouvrirItineraire(c)} className="text-blue-600 text-xs underline shrink-0">
                  📍 Itinéraire
                </button>
              )}
            </div>
          ))}
          {resultats.length === 0 && (
            <p className="text-petrol-400 text-center py-8 text-sm">
              Aucun relevé récent de ce produit en stock chez un client.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
