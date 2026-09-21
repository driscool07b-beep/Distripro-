import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts'
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

    const parCle = {}
    ;(data || []).forEach((v) => {
      const d = new Date(v.created_at)
      const cle =
        periode === '12m'
          ? d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
          : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
      parCle[cle] = (parCle[cle] || 0) + Number(v.total || 0)
    })
    setVentesGraphe(Object.entries(parCle).map(([jour, total]) => ({ jour, total })))
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
        supabase.from('stocks').select('quantite, produits(nom, seuil_alerte, prix_vente)'),
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
            <h2 className="font-semibold">{t('entreprise.ventesPeriodeTitre')}</h2>
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
              <LineChart data={ventesGraphe}>
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

      <CarteVersementsEnCours />
      <AlerteInventaires afficherStock afficherCaisse />
      <AlerteLotsAPeremption />
      <CartesSoldesCaisses />
      <CartesSoldesBanques />
      <CamembertRepartitionCA />

      <div className="card p-6 mb-6">
        <h2 className="font-semibold mb-1">{t('entreprise.objectifsTitre')}</h2>
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
        <h2 className="font-semibold mb-4">{t('entreprise.comparaisonAnnuelleTitre')}</h2>
        {chargementComparaison ? (
          <div className="h-64 flex items-center justify-center text-sm text-petrol-500">{t('chargement')}</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={comparaisonAnnuelle}>
              <CartesianGrid stroke="#e2e4df" vertical={false} />
              <XAxis dataKey="mois" tick={{ fontSize: 12, fill: '#255a67' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#255a67' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => formatXOF(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {[0, 1, 2].map((i) => {
                const annee = new Date().getFullYear() - 2 + i
                const couleurs = ['#94a3b8', '#255a67', '#d69428']
                return (
                  <Line key={annee} type="monotone" dataKey={annee} name={String(annee)} stroke={couleurs[i]} strokeWidth={2} dot={{ r: 2 }} />
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
      <div className="flex justify-between text-sm mb-1">
        <span className="font-mono">{formatXOF(realise)} / {formatXOF(cible)}</span>
        {pct !== null && <span className="font-semibold">{pct}%</span>}
      </div>
      <div className="w-full bg-canvas rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full ${pct >= 100 ? 'bg-green-600' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
          style={{ width: `${pct || 0}%` }}
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
        <h2 className="font-semibold">{t('entreprise.versementsEnCoursTitre')}</h2>
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
      <h2 className="font-semibold mb-3">{t('entreprise.soldesCaissesTitre')}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {caisses.map((c) => (
          <Link
            key={c.id}
            to="/journal-caisse"
            className="flex justify-between items-center border border-line rounded-lg px-3 py-2 hover:bg-canvas transition-colors"
          >
            <span className="text-sm">{c.nom}</span>
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
      <h2 className="font-semibold mb-3">{t('entreprise.soldesBanquesTitre')}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {banques.map((b) => (
          <Link
            key={b.id}
            to="/banques"
            className="flex justify-between items-center border border-line rounded-lg px-3 py-2 hover:bg-canvas transition-colors"
          >
            <span className="text-sm">{b.nom}</span>
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
    const { data } = await supabase.rpc('repartition_ca', { p_type: type, p_debut: debut, p_fin: fin })
    setDonnees((data || []).filter((d) => Number(d.montant) > 0).slice(0, 8))
    setChargement(false)
  }

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-semibold">{t('entreprise.repartitionCaTitre')}</h2>
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
      ) : donnees.length === 0 ? (
        <p className="text-sm text-petrol-400 text-center py-8">{t('entreprise.aucuneVentePeriode')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={donnees}
              dataKey="montant"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={90}
              label={({ label, percent }) => `${label} (${(percent * 100).toFixed(0)}%)`}
            >
              {donnees.map((_, i) => <Cell key={i} fill={COULEURS_CAMEMBERT[i % COULEURS_CAMEMBERT.length]} />)}
            </Pie>
            <Tooltip formatter={(v) => formatXOF(v)} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
