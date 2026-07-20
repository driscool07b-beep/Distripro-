import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Dashboard() {
  const { profil } = useAuth()
  const [kpi, setKpi] = useState({ caJour: 0, caMois: 0, nbClients: 0, alertesStock: 0 })
  const [ventes7j, setVentes7j] = useState([])
  const [alertes, setAlertes] = useState([])
  const [chargement, setChargement] = useState(true)

  useEffect(() => {
    chargerDonnees()
  }, [])

  async function chargerDonnees() {
    setChargement(true)

    const debutJour = new Date()
    debutJour.setHours(0, 0, 0, 0)
    const debutMois = new Date()
    debutMois.setDate(1)
    debutMois.setHours(0, 0, 0, 0)

    const [{ data: ventesJour }, { data: ventesMois }, { count: nbClients }, { data: stockBas }, { data: histo }] =
      await Promise.all([
        supabase.from('ventes').select('total').gte('created_at', debutJour.toISOString()),
        supabase.from('ventes').select('total, created_at').gte('created_at', debutMois.toISOString()),
        supabase.from('clients').select('id', { count: 'exact', head: true }),
        supabase.from('stocks').select('quantite, produits(nom, seuil_alerte)'),
        supabase
          .from('ventes')
          .select('total, created_at')
          .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
      ])

    const caJour = (ventesJour || []).reduce((s, v) => s + Number(v.total || 0), 0)
    const caMois = (ventesMois || []).reduce((s, v) => s + Number(v.total || 0), 0)
    const enAlerte = (stockBas || []).filter(
      (s) => s.produits && s.quantite <= (s.produits.seuil_alerte ?? 0)
    )

    // Regroupement des ventes par jour pour le graphique
    const parJour = {}
    ;(histo || []).forEach((v) => {
      const jour = new Date(v.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
      parJour[jour] = (parJour[jour] || 0) + Number(v.total || 0)
    })

    setKpi({
      caJour,
      caMois,
      nbClients: nbClients || 0,
      alertesStock: enAlerte.length,
    })
    setAlertes(enAlerte.slice(0, 5))
    setVentes7j(Object.entries(parJour).map(([jour, total]) => ({ jour, total })))
    setChargement(false)
  }

  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Bonjour {profil?.nom?.split(' ')[0] || ''} 👋</h1>
        <p className="text-sm text-petrol-700 mt-1">Voici l'activité de votre entreprise aujourd'hui.</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <CarteKpi label="Ventes du jour" valeur={formatXOF(kpi.caJour)} accent />
        <CarteKpi label="Ventes du mois" valeur={formatXOF(kpi.caMois)} />
        <CarteKpi label="Clients actifs" valeur={kpi.nbClients} />
        <CarteKpi
          label="Alertes stock"
          valeur={kpi.alertesStock}
          alerte={kpi.alertesStock > 0}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-6 lg:col-span-2">
          <h2 className="font-semibold mb-4">Ventes des 7 derniers jours</h2>
          {chargement ? (
            <div className="h-64 flex items-center justify-center text-sm text-petrol-500">Chargement…</div>
          ) : ventes7j.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-petrol-500">
              Aucune vente enregistrée sur cette période.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={ventes7j}>
                <CartesianGrid stroke="#e2e4df" vertical={false} />
                <XAxis dataKey="jour" tick={{ fontSize: 12, fill: '#255a67' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#255a67' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => formatXOF(v)} />
                <Line type="monotone" dataKey="total" stroke="#d69428" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-6">
          <h2 className="font-semibold mb-4">Produits en alerte</h2>
          {alertes.length === 0 ? (
            <p className="text-sm text-petrol-500">Aucun produit sous le seuil d'alerte.</p>
          ) : (
            <ul className="space-y-3">
              {alertes.map((a, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="truncate">{a.produits?.nom}</span>
                  <span className="font-mono text-amber-600 shrink-0 ml-2">{a.quantite} restants</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function CarteKpi({ label, valeur, accent, alerte }) {
  return (
    <div className={`card p-5 ${alerte ? 'border-amber-400 bg-amber-50/40' : ''}`}>
      <div className="text-xs text-petrol-600 mb-1.5">{label}</div>
      <div
        className={`font-mono text-xl font-medium ${
          accent ? 'text-petrol-900' : alerte ? 'text-amber-600' : 'text-petrol-900'
        }`}
      >
        {valeur}
      </div>
    </div>
  )
}

function formatXOF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0) + ' F CFA'
}
