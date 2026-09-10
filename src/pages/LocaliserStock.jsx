import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'

export default function LocaliserStock() {
  const { t } = useTranslation('localiserstock')
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

    const [{ data: releves }, { data: ventes }] = await Promise.all([
      supabase
        .from('rapport_visite_produits')
        .select('quantite_rayon, rapports_visite(created_at, client_id, clients(nom, telephone, adresse, ville, latitude, longitude))')
        .eq('produit_id', produitId)
        .gt('quantite_rayon', 0),
      supabase
        .from('ventes_lignes')
        .select('quantite, ventes!inner(created_at, client_id, statut, clients(nom, telephone, adresse, ville, latitude, longitude))')
        .eq('produit_id', produitId)
        .neq('ventes.statut', 'annulee'),
    ])

    // Fusionne les deux sources en un seul flux d'observations, chacune datée
    const observations = []
    ;(releves || []).forEach((l) => {
      const rv = l.rapports_visite
      if (!rv || !rv.clients) return
      observations.push({
        clientId: rv.client_id,
        clients: rv.clients,
        quantite: l.quantite_rayon,
        date: rv.created_at,
        source: 'visite',
      })
    })
    ;(ventes || []).forEach((l) => {
      const v = l.ventes
      if (!v || !v.clients) return
      observations.push({
        clientId: v.client_id,
        clients: v.clients,
        quantite: l.quantite,
        date: v.created_at,
        source: 'livraison',
      })
    })

    // Ne garder que l'observation la plus récente par client, tous types confondus
    observations.sort((a, b) => new Date(b.date) - new Date(a.date))
    const dejaVus = new Set()
    let clientsUniques = []
    observations.forEach((o) => {
      if (dejaVus.has(o.clientId)) return
      dejaVus.add(o.clientId)
      clientsUniques.push({
        clientId: o.clientId,
        nom: o.clients.nom,
        telephone: o.clients.telephone,
        adresse: o.clients.adresse,
        ville: o.clients.ville,
        latitude: o.clients.latitude,
        longitude: o.clients.longitude,
        quantite: o.quantite,
        dateReleve: o.date,
        source: o.source,
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
    if (jours === 0) return t('aujourdhui')
    if (jours === 1) return t('hier')
    return t('ilYaJours', { n: jours })
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-1">{t('titre')}</h1>
      <p className="text-sm text-petrol-500 mb-4">
        {t('sousTitre')}
      </p>

      <div className="card p-4 mb-4 space-y-3">
        <div>
          <label className="label">{t('produitRecherche')}</label>
          <select className="input-field" value={produitId} onChange={(e) => setProduitId(e.target.value)}>
            <option value="">{t('selectionner')}</option>
            {produits.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </select>
        </div>

        <div className="text-xs flex items-center gap-2 flex-wrap">
          {captureGps === 'ok' && <span className="text-green-600">{t('positionCapturee')}</span>}
          {captureGps === 'echec' && <span className="text-amber-600">{t('positionIndisponible')}</span>}
          <button type="button" onClick={capturerPosition} className="underline text-petrol-600">
            {captureGps === 'en_cours' ? t('captureEnCours') : t('utiliserPosition')}
          </button>
        </div>

        <button onClick={rechercher} disabled={!produitId || chargement} className="btn-primary w-full">
          {chargement ? t('recherche') : t('rechercher')}
        </button>
      </div>

      {resultats && (
        <div className="space-y-2">
          <p className="text-xs text-petrol-500">
            {t('compteurResultats', { n: resultats.length })}
          </p>
          {resultats.map((c) => (
            <div key={c.clientId} className="border border-line rounded-lg p-3 flex justify-between items-start gap-3">
              <div>
                <p className="font-medium text-sm">{c.nom}</p>
                <p className="text-xs text-petrol-500">
                  {c.ville || c.adresse || t('localisationNonPrecisee')}
                  {c.distanceKm != null && ` — ${c.distanceKm.toFixed(1)} km`}
                </p>
                <p className="text-xs text-petrol-500">
                  {c.quantite} {t('unites', { ns: 'stock' })} {c.source === 'livraison' ? t('livree') : t('vueEnRayon')} —{' '}
                  {c.source === 'livraison' ? t('livre') : t('releve')} {joursDepuis(c.dateReleve)}
                </p>
                {c.telephone && <p className="text-xs text-petrol-600 mt-1">📞 {c.telephone}</p>}
              </div>
              {c.latitude != null && (
                <button onClick={() => ouvrirItineraire(c)} className="text-blue-600 text-xs underline shrink-0">
                  {t('itineraire')}
                </button>
              )}
            </div>
          ))}
          {resultats.length === 0 && (
            <p className="text-petrol-400 text-center py-8 text-sm">
              {t('aucunReleve')}
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
