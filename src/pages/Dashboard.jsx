import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatXOF, formatDateHeure } from '../lib/format'
import i18n from '../lib/i18n'

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
  const [alertes, setAlertes] = useState([])
  const [chargement, setChargement] = useState(true)
  const [periodeGraphe, setPeriodeGraphe] = useState('7j')
  const [ventesGraphe, setVentesGraphe] = useState([])
  const [chargementGraphe, setChargementGraphe] = useState(true)
  const [comparaisonAnnuelle, setComparaisonAnnuelle] = useState([])
  const [chargementComparaison, setChargementComparaison] = useState(true)
  const [commerciauxInactifs, setCommerciauxInactifs] = useState([])
  const [objectifSynthese, setObjectifSynthese] = useState(null)
  const [chargementObjectifs, setChargementObjectifs] = useState(true)

  useEffect(() => {
    chargerDonnees()
  }, [])

  useEffect(() => {
    chargerGraphe(periodeGraphe)
  }, [periodeGraphe])

  useEffect(() => {
    chargerComparaisonAnnuelle()
  }, [])

  useEffect(() => {
    if (['admin', 'manager'].includes(profil?.role)) {
      supabase.rpc('commerciaux_inactifs').then(({ data }) => setCommerciauxInactifs(data || []))
      chargerObjectifSynthese()
    }
  }, [profil?.role])

  async function calculerRealiseObjectif(o) {
    let ventes
    if (o.commercial_id && o.role_cible === 'manager') {
      const { data: equipesGerees } = await supabase.from('equipes').select('id').eq('manager_id', o.commercial_id)
      const idsEquipes = (equipesGerees || []).map((e) => e.id)
      const { data: membres } = idsEquipes.length
        ? await supabase.from('profils').select('id').in('equipe_id', idsEquipes)
        : { data: [] }
      const idsCommerciaux = (membres || []).map((m) => m.id)
      const { data } = idsCommerciaux.length
        ? await supabase
            .from('ventes')
            .select('total')
            .neq('statut', 'annulee')
            .in('commercial_id', idsCommerciaux)
            .gte('created_at', `${o.periode_debut}T00:00:00`)
            .lt('created_at', `${o.periode_fin}T23:59:59.999`)
        : { data: [] }
      ventes = data
    } else if (o.commercial_id && o.role_cible === 'admin') {
      const { data } = await supabase
        .from('ventes')
        .select('total')
        .neq('statut', 'annulee')
        .gte('created_at', `${o.periode_debut}T00:00:00`)
        .lt('created_at', `${o.periode_fin}T23:59:59.999`)
      ventes = data
    } else if (o.commercial_id) {
      const { data } = await supabase
        .from('ventes')
        .select('total')
        .neq('statut', 'annulee')
        .eq('commercial_id', o.commercial_id)
        .gte('created_at', `${o.periode_debut}T00:00:00`)
        .lt('created_at', `${o.periode_fin}T23:59:59.999`)
      ventes = data
    } else if (o.zone) {
      const { data } = await supabase
        .from('ventes')
        .select('total, clients!inner(ville)')
        .neq('statut', 'annulee')
        .eq('clients.ville', o.zone)
        .gte('created_at', `${o.periode_debut}T00:00:00`)
        .lt('created_at', `${o.periode_fin}T23:59:59.999`)
      ventes = data
    } else if (o.cible_bureau) {
      const { data } = await supabase
        .from('ventes')
        .select('total')
        .neq('statut', 'annulee')
        .is('commercial_id', null)
        .gte('created_at', `${o.periode_debut}T00:00:00`)
        .lt('created_at', `${o.periode_fin}T23:59:59.999`)
      ventes = data
    }
    return (ventes || []).reduce((s, v) => s + Number(v.total || 0), 0)
  }

  async function chargerObjectifSynthese() {
    setChargementObjectifs(true)
    const maintenant = new Date()
    const debutMois = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1).toISOString().split('T')[0]
    const finMois = new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 0).toISOString().split('T')[0]
    const debutAnnee = `${maintenant.getFullYear()}-01-01`
    const finAnnee = `${maintenant.getFullYear()}-12-31`

    const { data } = await supabase
      .from('objectifs')
      .select('id, commercial_id, zone, cible_bureau, periode_debut, periode_fin, montant_cible, profils!commercial_id(role)')
      .not('montant_cible', 'is', null)
      .lte('periode_debut', finAnnee)
      .gte('periode_fin', debutAnnee)

    const tous = (data || []).map((o) => ({ ...o, role_cible: o.profils?.role }))
    const objectifsMois = tous.filter((o) => o.periode_debut <= finMois && o.periode_fin >= debutMois)

    const [realiseMois, realiseAnnee] = await Promise.all([
      Promise.all(objectifsMois.map(calculerRealiseObjectif)),
      Promise.all(tous.map(calculerRealiseObjectif)),
    ])

    setObjectifSynthese({
      mois: {
        cible: objectifsMois.reduce((s, o) => s + Number(o.montant_cible || 0), 0),
        realise: realiseMois.reduce((s, v) => s + v, 0),
        nb: objectifsMois.length,
      },
      annee: {
        cible: tous.reduce((s, o) => s + Number(o.montant_cible || 0), 0),
        realise: realiseAnnee.reduce((s, v) => s + v, 0),
        nb: tous.length,
      },
    })
    setChargementObjectifs(false)
  }

  async function chargerGraphe(periode) {
    setChargementGraphe(true)
    const maintenant = new Date()
    let debut
    if (periode === '7j') debut = new Date(Date.now() - 7 * 86400000)
    else if (periode === '30j') debut = new Date(Date.now() - 30 * 86400000)
    else debut = new Date(maintenant.getFullYear(), maintenant.getMonth() - 11, 1)

    const { data } = await supabase
      .from('ventes')
      .select('total, created_at')
      .neq('statut', 'annulee')
      .gte('created_at', debut.toISOString())
      .order('created_at')

    const cleDe = (d) =>
      periode === '12m'
        ? d.toLocaleDateString(i18n.language, { month: 'short', year: '2-digit' })
        : d.toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit' })
    // Toutes les dates de la période, y compris les jours sans vente (à 0),
    // pour que la courbe reflète la réalité au lieu de relier deux points isolés.
    const parCle = {}
    if (periode === '12m') {
      for (let i = 11; i >= 0; i--) parCle[cleDe(new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1))] = 0
    } else {
      const nbJours = periode === '7j' ? 7 : 30
      for (let i = nbJours - 1; i >= 0; i--) parCle[cleDe(new Date(Date.now() - i * 86400000))] = 0
    }
    ;(data || []).forEach((v) => {
      const cle = cleDe(new Date(v.created_at))
      if (cle in parCle) parCle[cle] += Number(v.total || 0)
    })
    const serie = Object.entries(parCle).map(([jour, total]) => ({ jour, total }))
    setVentesGraphe(serie.some((x) => x.total > 0) ? serie : [])
    setChargementGraphe(false)
  }

  async function chargerComparaisonAnnuelle() {
    setChargementComparaison(true)
    const anneeActuelle = new Date().getFullYear()
    const debut = new Date(anneeActuelle - 2, 0, 1)

    const { data } = await supabase
      .from('ventes')
      .select('total, created_at')
      .neq('statut', 'annulee')
      .gte('created_at', debut.toISOString())
      .order('created_at')

    const parMoisAnnee = {}
    ;(data || []).forEach((v) => {
      const d = new Date(v.created_at)
      const mois = d.getMonth()
      const annee = d.getFullYear()
      if (!parMoisAnnee[mois]) parMoisAnnee[mois] = {}
      parMoisAnnee[mois][annee] = (parMoisAnnee[mois][annee] || 0) + Number(v.total || 0)
    })

    const labelsMois = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
    const annees = [anneeActuelle - 2, anneeActuelle - 1, anneeActuelle]
    const lignes = labelsMois.map((label, i) => {
      const ligne = { mois: label }
      annees.forEach((a) => { ligne[a] = parMoisAnnee[i]?.[a] || 0 })
      return ligne
    })
    setComparaisonAnnuelle(lignes)
    setChargementComparaison(false)
  }

  async function chargerDonnees() {
    setChargement(true)

    const debutJour = new Date()
    debutJour.setHours(0, 0, 0, 0)
    const debutMois = new Date()
    debutMois.setDate(1)
    debutMois.setHours(0, 0, 0, 0)

    const [{ data: ventesJour }, { data: ventesMois }, { count: nbClientsActifs }, { count: nbClientsTotal }, { data: stockBas }, { data: creancesData }, { count: commandesCount }] =
      await Promise.all([
        supabase.from('ventes').select('total').neq('statut', 'annulee').gte('created_at', debutJour.toISOString()),
        supabase.from('ventes').select('total, created_at').neq('statut', 'annulee').gte('created_at', debutMois.toISOString()),
        supabase.from('clients').select('id', { count: 'exact', head: true }).eq('segment', 'actif'),
        supabase.from('clients').select('id', { count: 'exact', head: true }),
        supabase.from('stocks').select('quantite, depots(nom), produits(nom, seuil_alerte, prix_vente)'),
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
    setChargement(false)
  }

  return (
    <div className="p-8 max-w-[1600px] mx-auto">
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

      {commerciauxInactifs.length > 0 && (
        <div className="card p-4 mb-6 border-amber-300 bg-amber-50">
          <p className="text-sm font-semibold text-amber-800 mb-2">
            ⚠️ {t('entreprise.commerciauxInactifsTitreSeuil', { n: commerciauxInactifs.length })}
          </p>
          <div className="space-y-1">
            {commerciauxInactifs.map((c) => (
              <div key={c.profil_id} className="flex items-center justify-between text-sm">
                <span>{c.nom}{c.zone ? ` — ${c.zone}` : ''}</span>
                <span className="text-amber-700 text-xs">
                  {c.jamais_connecte
                    ? t('entreprise.jamaisConnecte')
                    : t('entreprise.dernierAccesDuree', {
                        date: formatDateHeure(c.derniere_connexion),
                        duree: formaterDureeEcoulee(c.derniere_connexion, t),
                      })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <TitreSection icone="tendance" theme="ventes" className="">{t('entreprise.ventesPeriodeTitre')}</TitreSection>
            <div className="flex gap-1">
              {['7j', '30j', '12m'].map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriodeGraphe(p)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    periodeGraphe === p ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line text-petrol-600'
                  }`}
                >
                  {t(`entreprise.periode_${p}`)}
                </button>
              ))}
            </div>
          </div>
          {chargementGraphe ? (
            <div className="h-64 flex items-center justify-center text-sm text-petrol-500">{t('chargement')}</div>
          ) : ventesGraphe.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-petrol-500">
              {t('entreprise.aucuneVentePeriode')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={ventesGraphe} margin={{ left: -8, right: 8 }}>
                <defs>
                  <linearGradient id="degradeVentes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d69428" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#d69428" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e2e4df" vertical={false} strokeDasharray="4 4" />
                <XAxis dataKey="jour" tick={{ fontSize: 11, fill: '#255a67' }} axisLine={false} tickLine={false} minTickGap={12} />
                <YAxis tick={{ fontSize: 11, fill: '#255a67' }} axisLine={false} tickLine={false} tickFormatter={formatCompact} width={44} />
                <Tooltip formatter={(v) => formatXOF(v)} contentStyle={STYLE_INFOBULLE} />
                <Area type="monotone" dataKey="total" stroke="#d69428" strokeWidth={2.5} fill="url(#degradeVentes)"
                  dot={periodeGraphe === '7j' ? { r: 3, fill: '#fff', strokeWidth: 2 } : false} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-6">
          <TitreSection icone="alerte" theme="alertes" className="mb-4">{t('entreprise.produitsEnAlerte')}</TitreSection>
          {alertes.length === 0 ? (
            <p className="text-sm text-petrol-500">{t('entreprise.aucunProduitSeuil')}</p>
          ) : (
            <ul className="space-y-3">
              {alertes.map((a, i) => {
                const seuil = Number(a.produits?.seuil_alerte || 0)
                const niveau = seuil > 0 ? Math.max(0, Math.min(100, (Number(a.quantite) / seuil) * 100)) : 0
                const rupture = Number(a.quantite) <= 0
                return (
                  <Link key={i} to="/stock?filtre=alertes" className="block group">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate group-hover:underline">{a.produits?.nom}</span>
                        {a.depots?.nom && <span className="block text-xs text-petrol-400 truncate">{a.depots.nom}</span>}
                      </span>
                      <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${rupture ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                        {rupture ? t('rupture') : `${a.quantite} ${t('restants')}`}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-canvas overflow-hidden">
                      <div className={`h-full rounded-full ${rupture ? 'bg-rose-500' : 'bg-amber-400'}`} style={{ width: `${rupture ? 100 : niveau}%` }} />
                    </div>
                  </Link>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <CarteVersementsEnCours />
      <AlerteInventaires afficherStock afficherCaisse />
      <AlerteLotsAPeremption />
      <CartesSoldesCaisses />
      <CartesSoldesBanques />
      <CamembertRepartitionCA />

      <div className="card p-6 mb-6">
        <TitreSection icone="cible" theme="ventes" className="mb-1">{t('entreprise.objectifsTitre')}</TitreSection>
        <p className="text-xs text-petrol-500 mb-4">{t('entreprise.objectifsSousTitre')}</p>
        {chargementObjectifs ? (
          <p className="text-sm text-petrol-500">{t('chargement')}</p>
        ) : !objectifSynthese || (objectifSynthese.mois.nb === 0 && objectifSynthese.annee.nb === 0) ? (
          <p className="text-sm text-petrol-400">{t('entreprise.aucunObjectifDefini')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <BlocObjectif
              titre={t('entreprise.objectifMois')}
              cible={objectifSynthese.mois.cible}
              realise={objectifSynthese.mois.realise}
              nb={objectifSynthese.mois.nb}
              t={t}
            />
            <BlocObjectif
              titre={t('entreprise.objectifAnnee')}
              cible={objectifSynthese.annee.cible}
              realise={objectifSynthese.annee.realise}
              nb={objectifSynthese.annee.nb}
              t={t}
            />
          </div>
        )}
      </div>

      <div className="card p-6">
        <TitreSection icone="calendrier" theme="clients" className="mb-4">{t('entreprise.comparaisonAnnuelleTitre')}</TitreSection>
        {chargementComparaison ? (
          <div className="h-64 flex items-center justify-center text-sm text-petrol-500">{t('chargement')}</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={comparaisonAnnuelle} margin={{ left: -8, right: 8 }}>
              <CartesianGrid stroke="#e2e4df" vertical={false} strokeDasharray="4 4" />
              <XAxis dataKey="mois" tick={{ fontSize: 11, fill: '#255a67' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#255a67' }} axisLine={false} tickLine={false} tickFormatter={formatCompact} width={44} />
              <Tooltip formatter={(v) => formatXOF(v)} contentStyle={STYLE_INFOBULLE} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {[0, 1, 2].map((i) => {
                const annee = new Date().getFullYear() - 2 + i
                const couleurs = ['#94a3b8', '#255a67', '#d69428']
                return (
                  <Line key={annee} type="monotone" dataKey={annee} name={String(annee)} stroke={couleurs[i]} strokeWidth={i === 2 ? 3 : 2} dot={false} activeDot={{ r: 4 }} />
                )
              })}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function BlocObjectif({ titre, cible, realise, nb, t }) {
  const pct = cible > 0 ? Math.min(100, Math.round((realise / cible) * 100)) : null
  return (
    <div>
      <p className="text-xs font-medium text-petrol-600 mb-1">{titre} <span className="text-petrol-400">({t('entreprise.nbObjectifs', { n: nb })})</span></p>
      <div className="flex items-end justify-between gap-2 mb-1.5">
        <div>
          <span className="font-mono text-lg font-semibold">{formatXOF(realise)}</span>
          <span className="block text-xs text-petrol-500">{t('entreprise.surCible', { cible: formatXOF(cible) })}</span>
        </div>
        {pct !== null && (
          <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${pct >= 100 ? 'bg-emerald-100 text-emerald-700' : pct >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{pct}%</span>
        )}
      </div>
      <div className="w-full bg-canvas rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${pct >= 100 ? 'from-emerald-400 to-emerald-600' : pct >= 60 ? 'from-amber-300 to-amber-500' : 'from-rose-400 to-rose-600'}`}
          style={{ width: `${Math.max(pct || 0, 2)}%` }}
        />
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

      <CarteMaNoteUtilisation />

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
          <TitreSection icone="cible" theme="ventes" className="mb-2 text-sm">{t('commercial.monObjectifMois')}</TitreSection>
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
        <TitreSection icone="tendance" theme="ventes" className="mb-4">{t('commercial.mesVentes7j')}</TitreSection>
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

          <CarteVersementsEnCours />
          <AlerteInventaires afficherCaisse />
          <CartesSoldesCaisses />
      <CartesSoldesBanques />
          <CamembertRepartitionCA />
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
            <TitreSection icone="horloge" theme="echues" className="mb-3 text-sm">{t('agentRecouvrement.creancesUrgentes')}</TitreSection>
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

      <AlerteInventaires afficherStock />
      <AlerteLotsAPeremption />

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
            <TitreSection icone="alerte" theme="alertes" className="mb-4">{t('gestionnaireStock.produitsEnAlerte')}</TitreSection>
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

// Illustration de chaque carte, choisie d'après la page vers laquelle elle mène.
const THEMES_KPI = {
  ventes:       { fond: 'bg-emerald-100', texte: 'text-emerald-600', trait: '#059669', icone: 'tendance' },
  clients:      { fond: 'bg-sky-100',     texte: 'text-sky-600',     trait: '#0284c7', icone: 'clients' },
  stock:        { fond: 'bg-indigo-100',  texte: 'text-indigo-600',  trait: '#4f46e5', icone: 'cartons' },
  alertes:      { fond: 'bg-amber-100',   texte: 'text-amber-600',   trait: '#d97706', icone: 'alerte' },
  creances:     { fond: 'bg-orange-100',  texte: 'text-orange-600',  trait: '#ea580c', icone: 'main' },
  echues:       { fond: 'bg-rose-100',    texte: 'text-rose-600',    trait: '#e11d48', icone: 'horloge' },
  commandes:    { fond: 'bg-teal-100',    texte: 'text-teal-600',    trait: '#0d9488', icone: 'bon' },
  stockMain:    { fond: 'bg-violet-100',  texte: 'text-violet-600',  trait: '#7c3aed', icone: 'camion' },
  versements:   { fond: 'bg-lime-100',    texte: 'text-lime-700',    trait: '#4d7c0f', icone: 'portefeuille' },
  defaut:       { fond: 'bg-petrol-50',   texte: 'text-petrol-600',  trait: '#0f4c5c', icone: 'pieces' },
}

function themeKpi(to = '') {
  if (to.includes('filtre=alertes')) return THEMES_KPI.alertes
  if (to.includes('filtre=echues')) return THEMES_KPI.echues
  if (to.startsWith('/stock-commercial')) return THEMES_KPI.stockMain
  if (to.startsWith('/ventes')) return THEMES_KPI.ventes
  if (to.startsWith('/clients')) return THEMES_KPI.clients
  if (to.startsWith('/stock')) return THEMES_KPI.stock
  if (to.startsWith('/creances')) return THEMES_KPI.creances
  if (to.startsWith('/commandes')) return THEMES_KPI.commandes
  if (to.startsWith('/versements')) return THEMES_KPI.versements
  return THEMES_KPI.defaut
}

const TRACES_ICONES = {
  tendance: <><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></>,
  clients: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M17.5 14.5c2 .3 3.5 1.8 4 4.5" /></>,
  cartons: <><path d="M3 8l9-4 9 4-9 4-9-4z" /><path d="M3 8v8l9 4 9-4V8" /><path d="M12 12v8" /></>,
  alerte: <><path d="M12 3l9.5 17h-19L12 3z" /><path d="M12 10v4" /><circle cx="12" cy="17" r=".6" fill="currentColor" /></>,
  main: <><path d="M3 15h3l4 2h5a2 2 0 000-4h-3" /><path d="M6 15v5H3v-5" /><path d="M10 17l7-3.5a1.8 1.8 0 012.4 2.4L13 20H8" /><circle cx="16" cy="6" r="3" /></>,
  horloge: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5" /><path d="M9 2h6" /></>,
  bon: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2.5h6V4" /><path d="M8.5 10h7M8.5 14h7M8.5 18h4" /></>,
  camion: <><path d="M2 6h11v10H2z" /><path d="M13 9h4l4 4v3h-8" /><circle cx="6" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>,
  portefeuille: <><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M16 15h2" /><path d="M6 6l9-3 1 3" /></>,
  cible: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /></>,
  calendrier: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="M7.5 14h2M11 14h2M14.5 14h2M7.5 17.5h2M11 17.5h2" /></>,
  caisse: <><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M6 11V6h9l3 5" /><path d="M8 15h8" /><circle cx="12" cy="18" r=".6" fill="currentColor" /></>,
  banque: <><path d="M3 10l9-6 9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 21h18" /></>,
  camembert: <><path d="M12 3a9 9 0 109 9h-9V3z" /><path d="M15 3.5A9 9 0 0120.5 9H15V3.5z" /></>,
  pieces: <><ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7" /><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></>,
}

function IconeKpi({ nom, className = '', strokeWidth = 1.8 }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {TRACES_ICONES[nom] || TRACES_ICONES.pieces}
    </svg>
  )
}

// Titre de section avec son illustration (mêmes couleurs que les cartes KPI).
function TitreSection({ icone, theme, className = '', children }) {
  const th = THEMES_KPI[theme] || THEMES_KPI.defaut
  return (
    <h2 className={`font-semibold flex items-center gap-2.5 ${className}`}>
      <span className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${th.fond} ${th.texte}`}>
        <IconeKpi nom={icone} className="w-[18px] h-[18px]" />
      </span>
      <span>{children}</span>
    </h2>
  )
}

// Montants abrégés pour les axes des graphiques : 24 k, 1,5 M…
function formatCompact(v) {
  return new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(v) || 0)
}

const STYLE_INFOBULLE = { borderRadius: 10, border: '1px solid #e2e4df', boxShadow: '0 4px 14px rgba(0,0,0,.08)', fontSize: 12 }

function CarteKpi({ label, valeur, accent, alerte, to }) {
  const theme = themeKpi(to)
  // Montants : le chiffre en grand, la devise (« F CFA », « GNF »…) en petit,
  // pour que la valeur tienne sur une ligne même sur un petit téléphone.
  const texte = String(valeur ?? '')
  const decoupe = texte.match(/^(.*\d)\s+(\D+)$/)
  const nombre = decoupe ? decoupe[1] : texte
  const unite = decoupe ? decoupe[2] : ''
  const contenu = (
    <div
      className={`card p-4 sm:p-5 relative overflow-hidden transition-shadow h-full ${alerte ? 'border-amber-400 bg-amber-50/40' : ''} ${
        to ? 'hover:shadow-md cursor-pointer' : ''
      }`}
    >
      {/* Illustration en filigrane */}
      <IconeKpi nom={theme.icone} strokeWidth={1.2}
        className={`absolute -right-3 -bottom-3 w-20 h-20 ${theme.texte} opacity-[0.08] pointer-events-none`} />
      <div className="flex items-center gap-2.5 mb-3 relative">
        <span className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${theme.fond} ${theme.texte}`}>
          <IconeKpi nom={theme.icone} className="w-5 h-5" />
        </span>
        <span className="text-xs text-petrol-600 leading-tight">{label}</span>
      </div>
      <div className="relative">
        <span
          className={`font-mono text-lg sm:text-xl font-semibold whitespace-nowrap ${
            accent ? 'text-petrol-900' : alerte ? 'text-amber-600' : 'text-petrol-900'
          }`}
        >
          {nombre}
        </span>
        {unite && <span className="ml-1 text-xs text-petrol-500 whitespace-nowrap">{unite}</span>}
      </div>
    </div>
  )
  return to ? <Link to={to} className="block h-full">{contenu}</Link> : contenu
}

function formaterDureeEcoulee(dateIso, t) {
  const maintenant = new Date()
  const alors = new Date(dateIso)
  const totalHeures = Math.floor((maintenant - alors) / (1000 * 60 * 60))
  const jours = Math.floor(totalHeures / 24)
  const heures = totalHeures % 24

  if (jours === 0) return t('entreprise.dureeHeures', { h: heures })
  if (heures === 0) return t('entreprise.dureeJours', { j: jours })
  return t('entreprise.dureeJoursHeures', { j: jours, h: heures })
}

function CarteVersementsEnCours() {
  const { t } = useTranslation('dashboard')
  const [donnees, setDonnees] = useState(null)
  const [chargement, setChargement] = useState(true)

  useEffect(() => {
    charger()

    // Temps réel : se remet à jour tout seul dès qu'une vente, un
    // règlement ou un versement est enregistré, sans recharger la page.
    const canal = supabase
      .channel('versements-en-cours-dashboard')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ventes' }, charger)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ventes' }, charger)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reglements' }, charger)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'versements_caisse' }, charger)
      .subscribe()

    return () => supabase.removeChannel(canal)
  }, [])

  async function charger() {
    const { data } = await supabase.rpc('versements_en_cours')
    const ligne = Array.isArray(data) ? data[0] : data
    setDonnees(ligne)
    setChargement(false)
  }

  if (chargement || !donnees) return null

  const lignes = [
    { libelle: t('entreprise.ventesCashCommerciaux'), valeur: donnees.ventes_cash_commerciaux },
    { libelle: t('entreprise.recouvrementCommerciaux'), valeur: donnees.recouvrement_commerciaux },
    { libelle: t('entreprise.ventesCashBureau'), valeur: donnees.ventes_cash_bureau },
    { libelle: t('entreprise.recouvrementBureau'), valeur: donnees.recouvrement_bureau },
  ]

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <TitreSection icone="portefeuille" theme="versements" className="">{t('entreprise.versementsEnCoursTitre')}</TitreSection>
        <span className="flex items-center gap-1.5 text-xs text-green-700">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          {t('entreprise.enDirect')}
        </span>
      </div>
      <div className="space-y-1.5 mb-3">
        {lignes.map((l) => (
          <div key={l.libelle} className="flex justify-between text-sm">
            <span className="text-petrol-600">{l.libelle}</span>
            <span className="font-mono">{formatXOF(l.valeur)}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-line pt-2 flex justify-between text-sm">
        <span className="text-petrol-600">{t('entreprise.dejaVerseAujourdhui')}</span>
        <span className="font-mono text-green-700">{formatXOF(donnees.deja_verse)}</span>
      </div>
      <div className="flex justify-between mt-1">
        <span className="font-medium text-sm">{t('entreprise.resteAVerser')}</span>
        <span className={`font-mono font-semibold ${donnees.reste_a_verser > 0 ? 'text-amber-700' : ''}`}>
          {formatXOF(donnees.reste_a_verser)}
        </span>
      </div>
    </div>
  )
}

function joursDeFrequence(frequence) {
  if (frequence === 'hebdomadaire') return 7
  if (frequence === 'mensuel') return 30
  if (frequence === 'trimestriel') return 90
  return null
}

function CarteMaNoteUtilisation() {
  const { t } = useTranslation('dashboard')
  const { profil } = useAuth()
  const [note, setNote] = useState(null)

  useEffect(() => {
    if (!profil?.id) return
    const d = new Date()
    const moisCourant = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    supabase
      .from('notes_utilisation')
      .select('score_total, score_assiduite, score_rapports, score_versements')
      .eq('profil_id', profil.id)
      .eq('mois', moisCourant)
      .maybeSingle()
      .then(({ data }) => setNote(data))
  }, [profil?.id])

  if (!note) return null

  return (
    <div className="card p-4 mb-4">
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold">{t('commercial.maNoteTitre')}</p>
        <span className="font-mono font-bold text-lg">{note.score_total}<span className="text-xs text-petrol-400"> / 100</span></span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs mt-2 text-petrol-500">
        <span>{t('commercial.noteAssiduite')} : {note.score_assiduite}</span>
        <span>{t('commercial.noteRapports')} : {note.score_rapports}</span>
        <span>{t('commercial.noteVersements')} : {note.score_versements}</span>
      </div>
    </div>
  )
}

function AlerteInventaires({ afficherStock, afficherCaisse }) {
  const { t } = useTranslation('dashboard')
  const { entreprise } = useAuth()
  const [enRetard, setEnRetard] = useState([])

  useEffect(() => {
    charger()
  }, [entreprise?.frequence_inventaire_stock, entreprise?.frequence_inventaire_caisse])

  async function charger() {
    const alertes = []
    const maintenant = new Date()

    if (afficherStock && entreprise?.frequence_inventaire_stock) {
      const jours = joursDeFrequence(entreprise.frequence_inventaire_stock)
      const { data } = await supabase.from('inventaires_stock').select('created_at').order('created_at', { ascending: false }).limit(1)
      const dernier = data?.[0]?.created_at ? new Date(data[0].created_at) : null
      if (!dernier || (maintenant - dernier) / 86400000 > jours) {
        alertes.push({ type: 'stock', depuis: dernier })
      }
    }

    if (afficherCaisse && entreprise?.frequence_inventaire_caisse) {
      const jours = joursDeFrequence(entreprise.frequence_inventaire_caisse)
      const { data } = await supabase.from('inventaires_caisse').select('created_at').order('created_at', { ascending: false }).limit(1)
      const dernier = data?.[0]?.created_at ? new Date(data[0].created_at) : null
      if (!dernier || (maintenant - dernier) / 86400000 > jours) {
        alertes.push({ type: 'caisse', depuis: dernier })
      }
    }

    setEnRetard(alertes)
  }

  if (enRetard.length === 0) return null

  return (
    <div className="card p-4 mb-6 border-amber-300 bg-amber-50">
      <p className="text-sm font-semibold text-amber-800 mb-1">⚠️ {t('entreprise.inventairesEnRetardTitre')}</p>
      <div className="space-y-1">
        {enRetard.map((a) => (
          <Link key={a.type} to={a.type === 'stock' ? '/stock' : '/journal-caisse'} className="block text-sm text-amber-700 underline">
            {a.type === 'stock' ? t('entreprise.inventaireStockEnRetard') : t('entreprise.inventaireCaisseEnRetard')}
            {' — '}
            {a.depuis ? t('entreprise.dernierLe', { date: formatDateHeure(a.depuis, { dateStyle: 'medium' }) }) : t('entreprise.jamaisFait')}
          </Link>
        ))}
      </div>
    </div>
  )
}

function AlerteLotsAPeremption() {
  const { t } = useTranslation('dashboard')
  const [lots, setLots] = useState([])

  useEffect(() => {
    supabase.rpc('lots_a_destocker', { p_jours_alerte: 15 }).then(({ data }) => setLots(data || []))
  }, [])

  if (lots.length === 0) return null

  const perimes = lots.filter((l) => l.jours_restants < 0).length

  return (
    <div className="card p-4 mb-6 border-amber-300 bg-amber-50">
      <p className="text-sm font-semibold text-amber-800 mb-1">⚠️ {t('entreprise.lotsAPeremptionTitre', { n: lots.length })}</p>
      {perimes > 0 && <p className="text-xs text-red-700 mb-1">{t('entreprise.lotsPerimes', { n: perimes })}</p>}
      <Link to="/stock" className="text-sm text-amber-700 underline">{t('entreprise.voirLesLots')}</Link>
    </div>
  )
}

function CartesSoldesCaisses() {
  const { t } = useTranslation('dashboard')
  const [caisses, setCaisses] = useState([])
  const [chargement, setChargement] = useState(true)

  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setChargement(true)
    const { data } = await supabase.from('caisses').select('id, nom').eq('actif', true).order('nom')
    const avecSolde = await Promise.all(
      (data || []).map(async (c) => {
        const { data: solde } = await supabase.rpc('solde_caisse', { p_caisse_id: c.id })
        return { ...c, solde: solde || 0 }
      })
    )
    setCaisses(avecSolde)
    setChargement(false)
  }

  if (chargement || caisses.length === 0) return null

  return (
    <div className="card p-4 mb-6">
      <TitreSection icone="caisse" theme="commandes" className="mb-3">{t('entreprise.soldesCaissesTitre')}</TitreSection>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {caisses.map((c) => (
          <Link
            key={c.id}
            to="/journal-caisse"
            className="flex justify-between items-center border border-line rounded-lg px-3 py-2 hover:bg-canvas transition-colors"
          >
            <span className="flex items-center gap-2 text-sm">
              <span className="w-7 h-7 rounded-lg bg-teal-100 text-teal-600 flex items-center justify-center"><IconeKpi nom="caisse" className="w-4 h-4" /></span>
              {c.nom}
            </span>
            <span className={`font-mono font-semibold ${c.solde < 0 ? 'text-red-600' : ''}`}>{formatXOF(c.solde)}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function CartesSoldesBanques() {
  const { t } = useTranslation('dashboard')
  const [banques, setBanques] = useState([])
  const [chargement, setChargement] = useState(true)

  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setChargement(true)
    const { data } = await supabase.from('banques').select('id, nom').eq('actif', true).order('nom')
    const avecSolde = await Promise.all(
      (data || []).map(async (b) => {
        const { data: solde } = await supabase.rpc('solde_banque', { p_banque_id: b.id })
        return { ...b, solde: solde || 0 }
      })
    )
    setBanques(avecSolde)
    setChargement(false)
  }

  if (chargement || banques.length === 0) return null

  return (
    <div className="card p-4 mb-6">
      <TitreSection icone="banque" theme="stock" className="mb-3">{t('entreprise.soldesBanquesTitre')}</TitreSection>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {banques.map((b) => (
          <Link
            key={b.id}
            to="/banques"
            className="flex justify-between items-center border border-line rounded-lg px-3 py-2 hover:bg-canvas transition-colors"
          >
            <span className="flex items-center gap-2 text-sm">
              <span className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center"><IconeKpi nom="banque" className="w-4 h-4" /></span>
              {b.nom}
            </span>
            <span className={`font-mono font-semibold ${b.solde < 0 ? 'text-red-600' : ''}`}>{formatXOF(b.solde)}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

const COULEURS_CAMEMBERT = ['#123640', '#d69428', '#255a67', '#e8a83c', '#347080', '#b87a1c', '#1a4752', '#0d2830']

function CamembertRepartitionCA() {
  const { t } = useTranslation('dashboard')
  const [type, setType] = useState('produit')
  const [periode, setPeriode] = useState('mois')
  const [dateDebutPerso, setDateDebutPerso] = useState('')
  const [dateFinPerso, setDateFinPerso] = useState('')
  const [erreurRepartition, setErreurRepartition] = useState('')
  const [donnees, setDonnees] = useState([])
  const [chargement, setChargement] = useState(true)

  useEffect(() => {
    if (periode !== 'personnalisee' || (dateDebutPerso && dateFinPerso)) charger()
  }, [type, periode, dateDebutPerso, dateFinPerso])

  function calculerBornes() {
    const maintenant = new Date()
    const annee = maintenant.getFullYear()
    const mois = maintenant.getMonth()

    if (periode === 'mois') {
      return [new Date(annee, mois, 1), new Date(annee, mois + 1, 0)]
    }
    if (periode === 'trimestre') {
      const debutTrimestre = Math.floor(mois / 3) * 3
      return [new Date(annee, debutTrimestre, 1), new Date(annee, debutTrimestre + 3, 0)]
    }
    if (periode === 'semestre') {
      const debutSemestre = mois < 6 ? 0 : 6
      return [new Date(annee, debutSemestre, 1), new Date(annee, debutSemestre + 6, 0)]
    }
    if (periode === 'annee') {
      return [new Date(annee, 0, 1), new Date(annee, 11, 31)]
    }
    if (periode === 'personnalisee') {
      return [new Date(dateDebutPerso), new Date(dateFinPerso)]
    }
    return [new Date(annee, mois, 1), new Date(annee, mois + 1, 0)]
  }

  async function charger() {
    setChargement(true)
    const [debutDate, finDate] = calculerBornes()
    const debut = debutDate.toISOString().split('T')[0]
    const fin = finDate.toISOString().split('T')[0]
    const { data, error } = await supabase.rpc('repartition_ca', { p_type: type, p_debut: debut, p_fin: fin })
    setErreurRepartition(error ? error.message : '')
    setDonnees((data || []).filter((d) => Number(d.montant) > 0).slice(0, 8))
    setChargement(false)
  }

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <TitreSection icone="camembert" theme="creances" className="">{t('entreprise.repartitionCaTitre')}</TitreSection>
        <div className="flex gap-1.5">
          {['produit', 'zone', 'groupe'].map((tp) => (
            <button
              key={tp}
              onClick={() => setType(tp)}
              className={`text-xs px-2.5 py-1 rounded-full border ${type === tp ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line'}`}
            >
              {t(`entreprise.repartition.${tp}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {['mois', 'trimestre', 'semestre', 'annee', 'personnalisee'].map((p) => (
          <button
            key={p}
            onClick={() => setPeriode(p)}
            className={`text-xs px-2.5 py-1 rounded-full border ${periode === p ? 'bg-amber-500 text-petrol-950 border-amber-500' : 'border-line text-petrol-600'}`}
          >
            {t(`entreprise.periodesCamembert.${p}`)}
          </button>
        ))}
      </div>

      {periode === 'personnalisee' && (
        <div className="flex gap-2 mb-4 items-end flex-wrap">
          <div>
            <label className="label">{t('entreprise.du')}</label>
            <input type="date" lang={i18n.language} className="input-field text-sm" value={dateDebutPerso} onChange={(e) => setDateDebutPerso(e.target.value)} />
          </div>
          <div>
            <label className="label">{t('entreprise.au')}</label>
            <input type="date" lang={i18n.language} className="input-field text-sm" value={dateFinPerso} onChange={(e) => setDateFinPerso(e.target.value)} />
          </div>
        </div>
      )}

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : erreurRepartition ? (
        <p className="text-sm text-red-600 text-center py-8">{t('entreprise.erreurRepartition')} ({erreurRepartition})</p>
      ) : donnees.length === 0 ? (
        <p className="text-sm text-petrol-400 text-center py-8">{t('entreprise.aucuneVentePeriode')}</p>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="relative w-full sm:w-1/2" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donnees} dataKey="montant" nameKey="label" cx="50%" cy="50%"
                  innerRadius={60} outerRadius={95} paddingAngle={2} stroke="none">
                  {donnees.map((_, i) => <Cell key={i} fill={COULEURS_CAMEMBERT[i % COULEURS_CAMEMBERT.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => formatXOF(v)} contentStyle={STYLE_INFOBULLE} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xs text-petrol-500">{t('entreprise.total')}</span>
              <span className="font-mono text-sm font-semibold">{formatCompact(donnees.reduce((s, d) => s + Number(d.montant), 0))}</span>
            </div>
          </div>
          <ul className="w-full sm:w-1/2 space-y-2">
            {(() => {
              const total = donnees.reduce((s, d) => s + Number(d.montant), 0) || 1
              return donnees.map((d, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: COULEURS_CAMEMBERT[i % COULEURS_CAMEMBERT.length] }} />
                  <span className="truncate flex-1">{d.label}</span>
                  <span className="text-xs text-petrol-500 shrink-0">{Math.round((Number(d.montant) / total) * 100)}%</span>
                  <span className="font-mono text-xs shrink-0">{formatCompact(Number(d.montant))}</span>
                </li>
              ))
            })()}
          </ul>
        </div>
      )}
    </div>
  )
}
