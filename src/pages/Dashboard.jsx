import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Dashboard() {
  const { profil } = useAuth()
  if (profil?.role === 'commercial') return <DashboardCommercial />
  if (profil?.role === 'comptable') return <DashboardComptable />
  if (profil?.role === 'gestionnaire_stock') return <DashboardGestionnaireStock />
  if (profil?.role === 'agent_recouvrement') return <DashboardAgentRecouvrement />
  return <DashboardEntreprise />
}

function DashboardEntreprise() {
  const { t } = useTranslation('dashboard')
  const { profil } = useAuth()
  const [kpi, setKpi] = useState({
    caJour: 0,
    caMois: 0,
    nbClientsActifs: 0,
    nbClientsTotal: 0,
    alertesStock: 0,
    valeurStock: 0,
    creances: 0,
    creancesEchues: 0,
    commandesEnAttente: 0,
  })
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

    const [{ data: ventesJour }, { data: ventesMois }, { count: nbClientsActifs }, { count: nbClientsTotal }, { data: stockBas }, { data: histo }, { data: creancesData }, { count: commandesCount }] =
      await Promise.all([
        supabase.from('ventes').select('total').neq('statut', 'annulee').gte('created_at', debutJour.toISOString()),
        supabase.from('ventes').select('total, created_at').neq('statut', 'annulee').gte('created_at', debutMois.toISOString()),
        supabase.from('clients').select('id', { count: 'exact', head: true }).eq('segment', 'actif'),
        supabase.from('clients').select('id', { count: 'exact', head: true }),
        supabase.from('stocks').select('quantite, produits(nom, seuil_alerte, prix_vente)'),
        supabase
          .from('ventes')
          .select('total, created_at')
          .neq('statut', 'annulee')
          .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
        supabase
          .from('ventes')
          .select('total, montant_regle, date_echeance')
          .eq('mode_paiement', 'credit')
          .neq('statut', 'annulee'),
        supabase
          .from('commandes')
          .select('id', { count: 'exact', head: true })
          .in('statut', ['brouillon', 'confirmee', 'en_preparation']),
      ])

    const caJour = (ventesJour || []).reduce((s, v) => s + Number(v.total || 0), 0)
    const caMois = (ventesMois || []).reduce((s, v) => s + Number(v.total || 0), 0)
    const enAlerte = (stockBas || []).filter(
      (s) => s.produits && s.quantite <= (s.produits.seuil_alerte ?? 0)
    )
    const valeurStock = (stockBas || []).reduce(
      (s, ligne) => s + ligne.quantite * (ligne.produits?.prix_vente || 0),
      0
    )

    const parJour = {}
    ;(histo || []).forEach((v) => {
      const jour = new Date(v.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
      parJour[jour] = (parJour[jour] || 0) + Number(v.total || 0)
    })

    const aujourdhui = new Date().toISOString().split('T')[0]
    const creancesOuvertes = (creancesData || []).filter((v) => Number(v.montant_regle) < Number(v.total))
    const totalCreances = creancesOuvertes.reduce((s, v) => s + (Number(v.total) - Number(v.montant_regle)), 0)
    const creancesEchues = creancesOuvertes.filter((v) => v.date_echeance && v.date_echeance < aujourdhui)
    const totalCreancesEchues = creancesEchues.reduce((s, v) => s + (Number(v.total) - Number(v.montant_regle)), 0)

    setKpi({
      caJour,
      caMois,
      nbClientsActifs: nbClientsActifs || 0,
      nbClientsTotal: nbClientsTotal || 0,
      alertesStock: enAlerte.length,
      valeurStock,
      creances: totalCreances,
      creancesEchues: totalCreancesEchues,
      commandesEnAttente: commandesCount || 0,
    })
    setAlertes(enAlerte.slice(0, 5))
    setVentes7j(Object.entries(parJour).map(([jour, total]) => ({ jour, total })))
    setChargement(false)
  }

  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">{t('bonjour', { prenom: profil?.nom?.split(' ')[0] || '' })}</h1>
        <p className="text-sm text-petrol-700 mt-1">{t('entreprise.sousTitre')}</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <CarteKpi label={t('entreprise.ventesJour')} valeur={formatXOF(kpi.caJour)} accent to="/ventes?periode=jour" />
        <CarteKpi label={t('entreprise.ventesMois')} valeur={formatXOF(kpi.caMois)} to="/ventes?periode=mois" />
        <CarteKpi label={t('entreprise.clientsActifs')} valeur={`${kpi.nbClientsActifs}/${kpi.nbClientsTotal}`} to="/clients" />
        <CarteKpi label={t('entreprise.valeurStock')} valeur={formatXOF(kpi.valeurStock)} to="/stock" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <CarteKpi
          label={t('entreprise.alertesStock')}
          valeur={kpi.alertesStock}
          alerte={kpi.alertesStock > 0}
          to="/stock?filtre=alertes"
        />
        <CarteKpi label={t('entreprise.creancesEnCours')} valeur={formatXOF(kpi.creances)} to="/creances" />
        <CarteKpi
          label={t('entreprise.creancesEchues')}
          valeur={formatXOF(kpi.creancesEchues)}
          alerte={kpi.creancesEchues > 0}
          to="/creances?filtre=echues"
        />
        <CarteKpi
          label={t('entreprise.commandesEnAttente')}
          valeur={kpi.commandesEnAttente}
          alerte={kpi.commandesEnAttente > 0}
          to="/commandes"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-6 lg:col-span-2">
          <h2 className="font-semibold mb-4">{t('entreprise.ventes7jTitre')}</h2>
          {chargement ? (
            <div className="h-64 flex items-center justify-center text-sm text-petrol-500">{t('chargement')}</div>
          ) : ventes7j.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-petrol-500">
              {t('entreprise.aucuneVentePeriode')}
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
          <h2 className="font-semibold mb-4">{t('entreprise.produitsEnAlerte')}</h2>
          {alertes.length === 0 ? (
            <p className="text-sm text-petrol-500">{t('entreprise.aucunProduitSeuil')}</p>
          ) : (
            <ul className="space-y-3">
              {alertes.map((a, i) => (
                <Link
                  key={i}
                  to="/stock?filtre=alertes"
                  className="flex items-center justify-between text-sm hover:underline"
                >
                  <span className="truncate">{a.produits?.nom}</span>
                  <span className="font-mono text-amber-600 shrink-0 ml-2">{a.quantite} {t('restants')}</span>
                </Link>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function DashboardCommercial() {
  const { t } = useTranslation('dashboard')
  const { profil } = useAuth()
  const [kpi, setKpi] = useState({
    caJour: 0,
    caMois: 0,
    stockEnMain: 0,
    creances: 0,
    resteAVerser: 0,
    commandesEnCours: 0,
  })
  const [ventes7j, setVentes7j] = useState([])
  const [objectif, setObjectif] = useState(null)
  const [chargement, setChargement] = useState(true)

  useEffect(() => {
    if (profil?.id) chargerDonnees()
  }, [profil?.id])

  async function chargerDonnees() {
    setChargement(true)

    const debutJour = new Date()
    debutJour.setHours(0, 0, 0, 0)
    const finJourISO = new Date(debutJour.getTime() + 86400000).toISOString()
    const debutMois = new Date()
    debutMois.setDate(1)
    debutMois.setHours(0, 0, 0, 0)
    const aujourdhui = new Date().toISOString().split('T')[0]

    const [
      { data: ventesJour },
      { data: ventesMois },
      { data: stockCommercial },
      { data: creancesData },
      { data: reglementsJour },
      { data: versementsJour },
      { data: histo },
      { data: objectifs },
      { count: commandesEnCoursCount },
    ] = await Promise.all([
      supabase.from('ventes').select('total, montant_regle, mode_paiement').eq('commercial_id', profil.id).neq('statut', 'annulee').gte('created_at', debutJour.toISOString()).lt('created_at', finJourISO),
      supabase.from('ventes').select('total, created_at').eq('commercial_id', profil.id).neq('statut', 'annulee').gte('created_at', debutMois.toISOString()),
      supabase.from('stock_commercial').select('quantite, produits(prix_vente)').eq('commercial_id', profil.id).gt('quantite', 0),
      supabase.from('ventes').select('total, montant_regle').eq('commercial_id', profil.id).eq('mode_paiement', 'credit').neq('statut', 'annulee'),
      supabase.from('reglements').select('montant').eq('commercial_id', profil.id).gte('created_at', debutJour.toISOString()).lt('created_at', finJourISO),
      supabase.from('versements_caisse').select('montant').eq('commercial_id', profil.id).eq('date_versement', aujourdhui),
      supabase.from('ventes').select('total, created_at').eq('commercial_id', profil.id).neq('statut', 'annulee').gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
      supabase.from('objectifs').select('montant_cible, periode_debut, periode_fin').eq('commercial_id', profil.id).lte('periode_debut', aujourdhui).gte('periode_fin', aujourdhui).not('montant_cible', 'is', null).limit(1),
      supabase.from('commandes').select('id', { count: 'exact', head: true }).eq('commercial_id', profil.id).in('statut', ['recue', 'confirmee', 'en_preparation']),
    ])

    const caJour = (ventesJour || []).reduce((s, v) => s + Number(v.total || 0), 0)
    const caMois = (ventesMois || []).reduce((s, v) => s + Number(v.total || 0), 0)
    const stockEnMain = (stockCommercial || []).reduce((s, l) => s + l.quantite * (l.produits?.prix_vente || 0), 0)

    const creancesOuvertes = (creancesData || []).filter((v) => Number(v.montant_regle) < Number(v.total))
    const totalCreances = creancesOuvertes.reduce((s, v) => s + (Number(v.total) - Number(v.montant_regle)), 0)

    const cashJour = (ventesJour || []).filter((v) => v.mode_paiement === 'cash').reduce((s, v) => s + Number(v.montant_regle || 0), 0)
    const recouvreJour = (reglementsJour || []).reduce((s, p) => s + Number(p.montant || 0), 0)
    const verseJour = (versementsJour || []).reduce((s, v) => s + Number(v.montant || 0), 0)
    const resteAVerser = Math.max(0, cashJour + recouvreJour - verseJour)

    const parJour = {}
    ;(histo || []).forEach((v) => {
      const jour = new Date(v.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
      parJour[jour] = (parJour[jour] || 0) + Number(v.total || 0)
    })

    if (objectifs && objectifs[0]) {
      setObjectif({ cible: Number(objectifs[0].montant_cible), realise: caMois })
    } else {
      setObjectif(null)
    }

    setKpi({ caJour, caMois, stockEnMain, creances: totalCreances, resteAVerser, commandesEnCours: commandesEnCoursCount || 0 })
    setVentes7j(Object.entries(parJour).map(([jour, total]) => ({ jour, total })))
    setChargement(false)
  }

  const pctObjectif = objectif && objectif.cible > 0 ? Math.min(100, Math.round((objectif.realise / objectif.cible) * 100)) : null

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{t('bonjour', { prenom: profil?.nom?.split(' ')[0] || '' })}</h1>
        <p className="text-sm text-petrol-700 mt-1">{t('commercial.sousTitre')}</p>
      </header>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <CarteKpi label={t('commercial.mesVentesJour')} valeur={formatXOF(kpi.caJour)} accent to="/ventes" />
        <CarteKpi label={t('commercial.mesVentesMois')} valeur={formatXOF(kpi.caMois)} to="/ventes" />
      </div>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <CarteKpi label={t('commercial.monStockEnMain')} valeur={formatXOF(kpi.stockEnMain)} to="/stock-commercial" />
        <CarteKpi label={t('commercial.mesCreancesEnCours')} valeur={formatXOF(kpi.creances)} to="/creances" />
      </div>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <CarteKpi label={t('commercial.mesCommandesEnCours')} valeur={String(kpi.commandesEnCours)} to="/commandes" />
        <CarteKpi
          label={t('commercial.resteAVerserAujourdhui')}
          valeur={formatXOF(kpi.resteAVerser)}
          alerte={kpi.resteAVerser > 0}
          to="/mes-versements"
        />
      </div>

      {objectif && (
        <div className="card p-5 mb-6">
          <h2 className="font-semibold mb-2 text-sm">{t('commercial.monObjectifMois')}</h2>
          <div className="flex justify-between text-xs text-petrol-600 mb-1">
            <span>{formatXOF(objectif.realise)} / {formatXOF(objectif.cible)}</span>
            <span className="font-medium">{pctObjectif}%</span>
          </div>
          <div className="w-full bg-canvas rounded-full h-2">
            <div
              className={`h-2 rounded-full ${pctObjectif >= 100 ? 'bg-green-500' : pctObjectif >= 60 ? 'bg-amber-500' : 'bg-red-400'}`}
              style={{ width: `${pctObjectif}%` }}
            />
          </div>
        </div>
      )}

      <div className="card p-6">
        <h2 className="font-semibold mb-4">{t('commercial.mesVentes7j')}</h2>
        {chargement ? (
          <div className="h-56 flex items-center justify-center text-sm text-petrol-500">{t('chargement')}</div>
        ) : ventes7j.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-sm text-petrol-500">
            {t('entreprise.aucuneVentePeriode')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
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
    </div>
  )
}

function DashboardComptable() {
  const { t } = useTranslation('dashboard')
  const { profil } = useAuth()
  const [kpi, setKpi] = useState({
    ventesCashJour: 0,
    recouvrementJour: 0,
    creances: 0,
    creancesEchues: 0,
  })
  const [chargement, setChargement] = useState(true)

  useEffect(() => {
    chargerDonnees()
  }, [])

  async function chargerDonnees() {
    setChargement(true)
    const debutJour = new Date()
    debutJour.setHours(0, 0, 0, 0)
    const aujourdhui = new Date().toISOString().split('T')[0]

    const [{ data: ventesCash }, { data: reglementsJour }, { data: creancesData }] = await Promise.all([
      supabase.from('ventes').select('montant_regle').eq('mode_paiement', 'cash').neq('statut', 'annulee').gte('created_at', debutJour.toISOString()),
      supabase.from('reglements').select('montant').gte('created_at', debutJour.toISOString()),
      supabase.from('ventes').select('total, montant_regle, date_echeance').eq('mode_paiement', 'credit').neq('statut', 'annulee'),
    ])

    const ventesCashJour = (ventesCash || []).reduce((s, v) => s + Number(v.montant_regle || 0), 0)
    const recouvrementJour = (reglementsJour || []).reduce((s, p) => s + Number(p.montant || 0), 0)

    const creancesOuvertes = (creancesData || []).filter((v) => Number(v.montant_regle) < Number(v.total))
    const totalCreances = creancesOuvertes.reduce((s, v) => s + (Number(v.total) - Number(v.montant_regle)), 0)
    const creancesEchues = creancesOuvertes.filter((v) => v.date_echeance && v.date_echeance < aujourdhui)
    const totalCreancesEchues = creancesEchues.reduce((s, v) => s + (Number(v.total) - Number(v.montant_regle)), 0)

    setKpi({ ventesCashJour, recouvrementJour, creances: totalCreances, creancesEchues: totalCreancesEchues })
    setChargement(false)
  }

  const totalAttendu = kpi.ventesCashJour + kpi.recouvrementJour

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{t('bonjour', { prenom: profil?.nom?.split(' ')[0] || '' })}</h1>
        <p className="text-sm text-petrol-700 mt-1">{t('comptable.sousTitre')}</p>
      </header>

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <CarteKpi label={t('comptable.totalAVerserAujourdhui')} valeur={formatXOF(totalAttendu)} accent to="/versements" />
            <CarteKpi label={t('comptable.creancesEnCours')} valeur={formatXOF(kpi.creances)} to="/creances" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <CarteKpi label={t('comptable.ventesCashJour')} valeur={formatXOF(kpi.ventesCashJour)} to="/versements" />
            <CarteKpi label={t('comptable.recouvrementJour')} valeur={formatXOF(kpi.recouvrementJour)} to="/versements" />
          </div>
          <div className="grid grid-cols-1">
            <CarteKpi
              label={t('comptable.creancesEchues')}
              valeur={formatXOF(kpi.creancesEchues)}
              alerte={kpi.creancesEchues > 0}
              to="/creances?filtre=echues"
            />
          </div>
        </>
      )}
    </div>
  )
}

function DashboardAgentRecouvrement() {
  const { t } = useTranslation('dashboard')
  const { profil } = useAuth()
  const [kpi, setKpi] = useState({
    creances: 0,
    creancesEchues: 0,
    encaisseJour: 0,
    encaisseMois: 0,
  })
  const [prioritaires, setPrioritaires] = useState([])
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
    const aujourdhui = new Date().toISOString().split('T')[0]

    const [{ data: creancesData }, { data: reglementsJour }, { data: reglementsMois }] = await Promise.all([
      supabase
        .from('ventes')
        .select('id, total, montant_regle, date_echeance, clients(nom, telephone, ville)')
        .eq('mode_paiement', 'credit')
        .neq('statut', 'annulee'),
      supabase.from('reglements').select('montant').gte('created_at', debutJour.toISOString()),
      supabase.from('reglements').select('montant').gte('created_at', debutMois.toISOString()),
    ])

    const creancesOuvertes = (creancesData || []).filter((v) => Number(v.montant_regle) < Number(v.total))
    const totalCreances = creancesOuvertes.reduce((s, v) => s + (Number(v.total) - Number(v.montant_regle)), 0)
    const creancesEchues = creancesOuvertes.filter((v) => v.date_echeance && v.date_echeance < aujourdhui)
    const totalCreancesEchues = creancesEchues.reduce((s, v) => s + (Number(v.total) - Number(v.montant_regle)), 0)

    const encaisseJour = (reglementsJour || []).reduce((s, p) => s + Number(p.montant || 0), 0)
    const encaisseMois = (reglementsMois || []).reduce((s, p) => s + Number(p.montant || 0), 0)

    const prioritairesListe = creancesEchues
      .map((v) => ({
        client: v.clients?.nom || '—',
        ville: v.clients?.ville || '',
        telephone: v.clients?.telephone || '',
        solde: Number(v.total) - Number(v.montant_regle),
        echeance: v.date_echeance,
      }))
      .sort((a, b) => a.echeance.localeCompare(b.echeance))
      .slice(0, 10)

    setKpi({ creances: totalCreances, creancesEchues: totalCreancesEchues, encaisseJour, encaisseMois })
    setPrioritaires(prioritairesListe)
    setChargement(false)
  }

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{t('bonjour', { prenom: profil?.nom?.split(' ')[0] || '' })}</h1>
        <p className="text-sm text-petrol-700 mt-1">{t('agentRecouvrement.sousTitre')}</p>
      </header>

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <CarteKpi label={t('agentRecouvrement.creancesEnCours')} valeur={formatXOF(kpi.creances)} to="/creances" />
            <CarteKpi
              label={t('agentRecouvrement.creancesEchues')}
              valeur={formatXOF(kpi.creancesEchues)}
              alerte={kpi.creancesEchues > 0}
              to="/creances?filtre=echues"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            <CarteKpi label={t('agentRecouvrement.encaisseAujourdhui')} valeur={formatXOF(kpi.encaisseJour)} accent to="/creances?filtre=encaissees" />
            <CarteKpi label={t('agentRecouvrement.encaisseMois')} valeur={formatXOF(kpi.encaisseMois)} to="/creances?filtre=encaissees" />
          </div>

          <div className="card p-5">
            <h2 className="font-semibold mb-3 text-sm">{t('agentRecouvrement.creancesUrgentes')}</h2>
            {prioritaires.length === 0 ? (
              <p className="text-sm text-petrol-500">{t('agentRecouvrement.aucuneCreanceEchue')}</p>
            ) : (
              <div className="space-y-2">
                {prioritaires.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-sm border-b border-line last:border-0 pb-2 last:pb-0">
                    <div>
                      <p className="font-medium">{p.client}</p>
                      <p className="text-xs text-petrol-500">
                        {p.ville}{p.ville && p.telephone ? ' — ' : ''}{p.telephone}
                        {' — ' + t('agentRecouvrement.echeance') + ' '}
                        {new Date(p.echeance).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </p>
                    </div>
                    <span className="font-mono text-amber-700 shrink-0">{formatXOF(p.solde)}</span>
                  </div>
                ))}
              </div>
            )}
            <Link to="/creances?filtre=echues" className="text-xs text-petrol-600 underline mt-3 inline-block">
              {t('agentRecouvrement.voirToutesEchues')}
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

function DashboardGestionnaireStock() {
  const { t } = useTranslation('dashboard')
  const { profil } = useAuth()
  const [kpi, setKpi] = useState({
    valeurStock: 0,
    alertesStock: 0,
    valeurStockCommerciaux: 0,
  })
  const [alertes, setAlertes] = useState([])
  const [chargement, setChargement] = useState(true)

  useEffect(() => {
    chargerDonnees()
  }, [])

  async function chargerDonnees() {
    setChargement(true)
    const [{ data: stockBas }, { data: stockCommerciaux }] = await Promise.all([
      supabase.from('stocks').select('quantite, produits(nom, seuil_alerte, prix_vente)'),
      supabase.from('stock_commercial').select('quantite, produits(prix_vente)').gt('quantite', 0),
    ])

    const enAlerte = (stockBas || []).filter((s) => s.produits && s.quantite <= (s.produits.seuil_alerte ?? 0))
    const valeurStock = (stockBas || []).reduce((s, l) => s + l.quantite * (l.produits?.prix_vente || 0), 0)
    const valeurStockCommerciaux = (stockCommerciaux || []).reduce((s, l) => s + l.quantite * (l.produits?.prix_vente || 0), 0)

    setKpi({ valeurStock, alertesStock: enAlerte.length, valeurStockCommerciaux })
    setAlertes(enAlerte.slice(0, 8))
    setChargement(false)
  }

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{t('bonjour', { prenom: profil?.nom?.split(' ')[0] || '' })}</h1>
        <p className="text-sm text-petrol-700 mt-1">{t('gestionnaireStock.sousTitre')}</p>
      </header>

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <CarteKpi label={t('gestionnaireStock.valeurStockMagasin')} valeur={formatXOF(kpi.valeurStock)} accent to="/stock" />
            <CarteKpi label={t('gestionnaireStock.valeurEnMainCommerciaux')} valeur={formatXOF(kpi.valeurStockCommerciaux)} to="/stock-commercial" />
            <CarteKpi
              label={t('gestionnaireStock.alertesStock')}
              valeur={kpi.alertesStock}
              alerte={kpi.alertesStock > 0}
              to="/stock?filtre=alertes"
            />
          </div>

          <div className="card p-6">
            <h2 className="font-semibold mb-4">{t('gestionnaireStock.produitsEnAlerte')}</h2>
            {alertes.length === 0 ? (
              <p className="text-sm text-petrol-500">{t('gestionnaireStock.aucunProduitSeuil')}</p>
            ) : (
              <ul className="space-y-3">
                {alertes.map((a, i) => (
                  <Link
                    key={i}
                    to="/stock?filtre=alertes"
                    className="flex items-center justify-between text-sm hover:underline"
                  >
                    <span className="truncate">{a.produits?.nom}</span>
                    <span className="font-mono text-amber-600 shrink-0 ml-2">{a.quantite} {t('restants')}</span>
                  </Link>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function CarteKpi({ label, valeur, accent, alerte, to }) {
  const contenu = (
    <div
      className={`card p-5 transition-shadow ${alerte ? 'border-amber-400 bg-amber-50/40' : ''} ${
        to ? 'hover:shadow-md cursor-pointer' : ''
      }`}
    >
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
  return to ? <Link to={to}>{contenu}</Link> : contenu
}

function formatXOF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0) + ' F CFA'
}
