import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { exporterExcel, exporterPDF } from '../lib/export'

const ONGLETS = [
  { id: 'recap', label: 'Récap quotidien' },
  { id: 'rotation', label: 'Taux de rotation' },
  { id: 'presence', label: 'Taux de présence' },
]

export default function Analytique() {
  const { profil, entreprise } = useAuth()
  const [onglet, setOnglet] = useState('recap')

  if (!['admin', 'manager'].includes(profil?.role)) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">
          Cette page est réservée aux responsables commerciaux et à la direction.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Tableau analytique</h1>
      <p className="text-sm text-petrol-500 mb-4">{entreprise?.nom}</p>

      <div className="flex gap-2 mb-4 flex-wrap">
        {ONGLETS.map((o) => (
          <button
            key={o.id}
            onClick={() => setOnglet(o.id)}
            className={`text-sm px-3 py-1.5 rounded-full border ${
              onglet === o.id ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {onglet === 'recap' && <RecapQuotidien entreprise={entreprise} />}
      {onglet === 'rotation' && <TauxRotation entreprise={entreprise} />}
      {onglet === 'presence' && <TauxPresence entreprise={entreprise} />}
    </div>
  )
}

function RecapQuotidien({ entreprise }) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [chargement, setChargement] = useState(true)
  const [lignes, setLignes] = useState([])

  useEffect(() => {
    charger()
  }, [date])

  async function charger() {
    setChargement(true)
    const { data: commerciaux } = await supabase.from('profils').select('id, nom').eq('role', 'commercial').order('nom')

    const { data: tournees } = await supabase
      .from('tournees')
      .select('id, commercial_id, distance_totale_km')
      .eq('date_tournee', date)

    const tourneeIds = (tournees || []).map((t) => t.id)
    let tourneeLignes = []
    if (tourneeIds.length > 0) {
      const { data } = await supabase.from('tournee_lignes').select('tournee_id, statut').in('tournee_id', tourneeIds)
      tourneeLignes = data || []
    }

    const { data: rapports } = await supabase
      .from('rapports_visite')
      .select('commercial_id')
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59.999`)

    const resultat = (commerciaux || []).map((c) => {
      const tourneesDuCommercial = (tournees || []).filter((t) => t.commercial_id === c.id)
      const idsCommercial = tourneesDuCommercial.map((t) => t.id)
      const lignesCommercial = tourneeLignes.filter((l) => idsCommercial.includes(l.tournee_id))
      const distanceTotale = tourneesDuCommercial.reduce((s, t) => s + Number(t.distance_totale_km || 0), 0)
      const nbRapports = (rapports || []).filter((r) => r.commercial_id === c.id).length

      return {
        commercial: c.nom,
        visitesPrevues: lignesCommercial.length,
        visitesFaites: lignesCommercial.filter((l) => l.statut === 'visite').length,
        distanceKm: distanceTotale,
        rapports: nbRapports,
      }
    })

    setLignes(resultat)
    setChargement(false)
  }

  const COLONNES = [
    { cle: 'commercial', titre: 'Commercial' },
    { cle: 'visitesFaites', titre: 'Visites faites', alignDroite: true },
    { cle: 'visitesPrevues', titre: 'Visites prévues', alignDroite: true },
    { cle: 'distanceKm', titre: 'Distance (km)', alignDroite: true },
    { cle: 'rapports', titre: 'Rapports envoyés', alignDroite: true },
  ]

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input type="date" className="input-field max-w-xs" value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          className="btn-secondary text-xs"
          disabled={lignes.length === 0}
          onClick={() => exporterExcel(`recap-${date}`, COLONNES, lignes)}
        >
          📊 Excel
        </button>
        <button
          className="btn-secondary text-xs"
          disabled={lignes.length === 0}
          onClick={() => exporterPDF(`recap-${date}`, 'Récap quotidien', `${entreprise?.nom} — ${date}`, COLONNES, lignes)}
        >
          📄 PDF
        </button>
      </div>

      {chargement ? (
        <p className="text-sm text-petrol-500">Chargement…</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
                <th className="px-4 py-3 font-medium">Commercial</th>
                <th className="px-4 py-3 font-medium text-right">Visites faites</th>
                <th className="px-4 py-3 font-medium text-right">Visites prévues</th>
                <th className="px-4 py-3 font-medium text-right">Distance (km)</th>
                <th className="px-4 py-3 font-medium text-right">Rapports</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{l.commercial}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {l.visitesFaites}
                    {l.visitesPrevues > 0 && l.visitesFaites < l.visitesPrevues && (
                      <span className="text-amber-600"> ⚠</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{l.visitesPrevues}</td>
                  <td className="px-4 py-3 text-right font-mono">{l.distanceKm.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-mono">{l.rapports}</td>
                </tr>
              ))}
              {lignes.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-petrol-400">Aucun commercial ou aucune tournée ce jour-là.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TauxRotation({ entreprise }) {
  const [chargement, setChargement] = useState(true)
  const [lignes, setLignes] = useState([])

  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setChargement(true)
    const { data, error } = await supabase
      .from('rapport_visite_produits')
      .select('produit_id, quantite_rayon, produits(nom), rapports_visite(created_at, client_id)')
      .not('quantite_rayon', 'is', null)

    if (error || !data) {
      setChargement(false)
      return
    }

    const groupes = {}
    data.forEach((l) => {
      if (!l.rapports_visite) return
      const cle = `${l.produit_id}__${l.rapports_visite.client_id}`
      if (!groupes[cle]) groupes[cle] = { nom: l.produits?.nom, points: [] }
      groupes[cle].points.push({ date: new Date(l.rapports_visite.created_at), qte: l.quantite_rayon })
    })

    const rotationsParProduit = {}
    Object.values(groupes).forEach((g) => {
      g.points.sort((a, b) => a.date - b.date)
      for (let i = 1; i < g.points.length; i++) {
        const jours = (g.points[i].date - g.points[i - 1].date) / 86400000
        const baisse = g.points[i - 1].qte - g.points[i].qte
        if (jours > 0 && baisse > 0) {
          const rotationJour = baisse / jours
          if (!rotationsParProduit[g.nom]) rotationsParProduit[g.nom] = []
          rotationsParProduit[g.nom].push(rotationJour)
        }
      }
    })

    const resultat = Object.entries(rotationsParProduit)
      .map(([nom, valeurs]) => ({
        produit: nom,
        observations: valeurs.length,
        rotationMoyenne: Number((valeurs.reduce((s, v) => s + v, 0) / valeurs.length).toFixed(2)),
      }))
      .sort((a, b) => b.rotationMoyenne - a.rotationMoyenne)

    setLignes(resultat)
    setChargement(false)
  }

  const COLONNES = [
    { cle: 'produit', titre: 'Produit' },
    { cle: 'observations', titre: 'Observations', alignDroite: true },
    { cle: 'rotationMoyenne', titre: 'Rotation moy. (unités/jour)', alignDroite: true },
  ]

  return (
    <div>
      <p className="text-xs text-petrol-500 mb-3">
        Calculé à partir des relevés de stock rayon successifs saisis dans les rapports de visite,
        chez un même client. Nécessite au moins 2 relevés pour un même couple produit/client.
      </p>
      <div className="flex gap-2 mb-4">
        <button className="btn-secondary text-xs" disabled={lignes.length === 0} onClick={() => exporterExcel('taux-rotation', COLONNES, lignes)}>
          📊 Excel
        </button>
        <button className="btn-secondary text-xs" disabled={lignes.length === 0} onClick={() => exporterPDF('taux-rotation', 'Taux de rotation', entreprise?.nom, COLONNES, lignes)}>
          📄 PDF
        </button>
      </div>

      {chargement ? (
        <p className="text-sm text-petrol-500">Chargement…</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
                <th className="px-4 py-3 font-medium">Produit</th>
                <th className="px-4 py-3 font-medium text-right">Observations</th>
                <th className="px-4 py-3 font-medium text-right">Rotation moy. (unités/jour)</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{l.produit}</td>
                  <td className="px-4 py-3 text-right font-mono">{l.observations}</td>
                  <td className="px-4 py-3 text-right font-mono">{l.rotationMoyenne}</td>
                </tr>
              ))}
              {lignes.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-petrol-400">Pas encore assez de données (au moins 2 relevés par produit/client nécessaires).</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TauxPresence({ entreprise }) {
  const [chargement, setChargement] = useState(true)
  const [propres, setPropres] = useState([])
  const [concurrents, setConcurrents] = useState([])

  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setChargement(true)
    const [{ data: dataPropres }, { data: dataConcurrents }] = await Promise.all([
      supabase.from('rapport_visite_produits').select('produit_id, quantite_rayon, produits(nom)'),
      supabase.from('rapport_visite_concurrents').select('produit_concurrent_id, present, produits_concurrents(nom)'),
    ])

    const groupesPropres = {}
    ;(dataPropres || []).forEach((l) => {
      const nom = l.produits?.nom
      if (!nom) return
      if (!groupesPropres[nom]) groupesPropres[nom] = { total: 0, presents: 0 }
      groupesPropres[nom].total += 1
      if (l.quantite_rayon > 0) groupesPropres[nom].presents += 1
    })

    const groupesConcurrents = {}
    ;(dataConcurrents || []).forEach((l) => {
      const nom = l.produits_concurrents?.nom
      if (!nom) return
      if (!groupesConcurrents[nom]) groupesConcurrents[nom] = { total: 0, presents: 0 }
      groupesConcurrents[nom].total += 1
      if (l.present) groupesConcurrents[nom].presents += 1
    })

    const versLignes = (groupes) =>
      Object.entries(groupes)
        .map(([nom, g]) => ({ produit: nom, visites: g.total, taux: Math.round((g.presents / g.total) * 100) }))
        .sort((a, b) => b.taux - a.taux)

    setPropres(versLignes(groupesPropres))
    setConcurrents(versLignes(groupesConcurrents))
    setChargement(false)
  }

  const COLONNES = [
    { cle: 'produit', titre: 'Produit' },
    { cle: 'visites', titre: 'Visites où relevé', alignDroite: true },
    { cle: 'taux', titre: 'Taux de présence (%)', alignDroite: true },
  ]

  return (
    <div>
      <p className="text-xs text-petrol-500 mb-4">
        Basé uniquement sur les visites où le produit a été explicitement relevé (rayon ou checklist
        concurrent) — un produit jamais relevé n'entre pas dans le calcul.
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-sm">Nos produits</h2>
            <div className="flex gap-1">
              <button className="text-xs text-petrol-600 underline" disabled={propres.length === 0} onClick={() => exporterExcel('presence-nos-produits', COLONNES, propres)}>Excel</button>
              <span className="text-petrol-300">·</span>
              <button className="text-xs text-petrol-600 underline" disabled={propres.length === 0} onClick={() => exporterPDF('presence-nos-produits', 'Taux de présence — nos produits', entreprise?.nom, COLONNES, propres)}>PDF</button>
            </div>
          </div>
          <TableauPresence lignes={propres} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-sm">Produits concurrents</h2>
            <div className="flex gap-1">
              <button className="text-xs text-petrol-600 underline" disabled={concurrents.length === 0} onClick={() => exporterExcel('presence-concurrents', COLONNES, concurrents)}>Excel</button>
              <span className="text-petrol-300">·</span>
              <button className="text-xs text-petrol-600 underline" disabled={concurrents.length === 0} onClick={() => exporterPDF('presence-concurrents', 'Taux de présence — concurrents', entreprise?.nom, COLONNES, concurrents)}>PDF</button>
            </div>
          </div>
          <TableauPresence lignes={concurrents} />
        </div>
      </div>

      {chargement && <p className="text-sm text-petrol-500 mt-4">Chargement…</p>}
    </div>
  )
}

function TableauPresence({ lignes }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
            <th className="px-3 py-2 font-medium">Produit</th>
            <th className="px-3 py-2 font-medium text-right">Taux</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              <td className="px-3 py-2">{l.produit}</td>
              <td className="px-3 py-2 text-right font-mono">
                <span className={l.taux >= 70 ? 'text-green-700' : l.taux >= 40 ? 'text-amber-600' : 'text-red-600'}>
                  {l.taux}%
                </span>
                <span className="text-petrol-400 text-xs"> ({l.visites})</span>
              </td>
            </tr>
          ))}
          {lignes.length === 0 && (
            <tr><td colSpan={2} className="px-3 py-6 text-center text-petrol-400 text-xs">Aucune donnée.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
