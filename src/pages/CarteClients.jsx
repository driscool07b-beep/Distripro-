import { useState, useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'

const COULEURS_SEGMENT_HEX = {
  actif: '#16a34a',
  vip: '#16a34a',
  nouveau: '#2563eb',
  a_relancer: '#d97706',
  inactif: '#dc2626',
}
const COULEUR_DEFAUT = '#64748b'

const LIBELLES_SEGMENT = {
  actif: 'Actif',
  vip: 'VIP',
  nouveau: 'Nouveau',
  a_relancer: 'À relancer',
  inactif: 'Inactif',
}

const CENTRE_CI = [7.54, -5.55]

export default function CarteClients() {
  const [clients, setClients] = useState([])
  const [chargement, setChargement] = useState(true)
  const [segmentsVisibles, setSegmentsVisibles] = useState({
    actif: true,
    vip: true,
    nouveau: true,
    a_relancer: true,
    inactif: true,
    autre: true,
  })

  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setChargement(true)
    const { data } = await supabase
      .from('clients')
      .select('id, nom, ville, telephone, segment, latitude, longitude')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
    setClients(data || [])
    setChargement(false)
  }

  const clientsAffiches = useMemo(
    () => clients.filter((c) => segmentsVisibles[c.segment] ?? segmentsVisibles.autre),
    [clients, segmentsVisibles]
  )

  function basculerSegment(segment) {
    setSegmentsVisibles((prev) => ({ ...prev, [segment]: !prev[segment] }))
  }

  if (chargement) {
    return <div className="p-4 text-center text-petrol-500">Chargement de la carte…</div>
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Carte des clients</h1>
      <p className="text-sm text-petrol-500 mb-3">
        {clientsAffiches.length} client(s) positionné(s) — zoomez pour passer de la vue Côte d'Ivoire à Abidjan.
      </p>

      <div className="flex flex-wrap gap-2 mb-3">
        {Object.entries(LIBELLES_SEGMENT).map(([seg, libelle]) => (
          <button
            key={seg}
            onClick={() => basculerSegment(seg)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-opacity ${
              segmentsVisibles[seg] ? 'border-line' : 'opacity-40 border-line'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COULEURS_SEGMENT_HEX[seg] }} />
            {libelle}
          </button>
        ))}
      </div>

      {clients.length === 0 ? (
        <p className="text-petrol-400 text-center py-12 text-sm border border-line rounded-lg">
          Aucun client n'a de position GPS enregistrée pour le moment.
        </p>
      ) : (
        <div className="rounded-lg overflow-hidden border border-line" style={{ height: '70vh' }}>
          <MapContainer center={CENTRE_CI} zoom={7} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <AjusterVue clients={clientsAffiches} />
            {clientsAffiches.map((c) => (
              <CircleMarker
                key={c.id}
                center={[c.latitude, c.longitude]}
                radius={8}
                pathOptions={{
                  color: '#fff',
                  weight: 2,
                  fillColor: COULEURS_SEGMENT_HEX[c.segment] || COULEUR_DEFAUT,
                  fillOpacity: 0.9,
                }}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-semibold">{c.nom}</p>
                    {c.ville && <p>{c.ville}</p>}
                    {c.telephone && <p>📞 {c.telephone}</p>}
                    <p className="capitalize">{LIBELLES_SEGMENT[c.segment] || c.segment || '—'}</p>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      )}
    </div>
  )
}

function AjusterVue({ clients }) {
  const map = useMap()

  useEffect(() => {
    if (clients.length === 0) return
    const bounds = clients.map((c) => [c.latitude, c.longitude])
    if (bounds.length === 1) {
      map.setView(bounds[0], 13)
    } else {
      map.fitBounds(bounds, { padding: [30, 30] })
    }
  }, [clients, map])

  return null
}
