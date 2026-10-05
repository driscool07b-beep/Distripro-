import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatXOF, formatDate, formatDateHeure } from '../lib/format'
import { traduireErreur } from '../lib/erreurs'

// Console du promoteur de la plateforme (super-administrateur) : pilotage des
// entreprises clientes, abonnements, unités IA, formules, annonces, journal.
// Toutes les données passent par des fonctions serveur réservées au promoteur.

const ONGLETS = [
  ['bord', '📊 Tableau de bord'], ['entreprises', '🏢 Entreprises'], ['formules', '💳 Formules'],
  ['ia', '⚙️ Paramètres'], ['annonces', '📣 Annonces'], ['journal', '📜 Journal'],
]
const STATUTS = { actif: ['Actif', 'bg-emerald-100 text-emerald-800'], essai: ['Essai', 'bg-sky-100 text-sky-800'], suspendu: ['Suspendu', 'bg-red-100 text-red-700'] }
const aujourdhui = () => new Date().toISOString().slice(0, 10)
const usd = (n) => `${Number(n || 0).toFixed(2)} $`
const nb = (n) => Math.round(Number(n || 0)).toLocaleString('fr-FR')

function Carte({ titre, valeur, detail, alerte }) {
  return (
    <div className={`card p-3 ${alerte ? 'border-amber-300 bg-amber-50/60' : ''}`}>
      <p className="text-[11px] uppercase tracking-wide text-petrol-500">{titre}</p>
      <p className="text-xl font-bold mt-0.5">{valeur}</p>
      {detail && <p className="text-[11px] text-petrol-500 mt-0.5">{detail}</p>}
    </div>
  )
}

function Message({ erreur, ok }) {
  if (erreur) return <p className="text-xs text-red-600">{erreur}</p>
  if (ok) return <p className="text-xs text-emerald-700">{ok}</p>
  return null
}

// ------------------------------------------------------------------ Tableau de bord
function TableauDeBord() {
  const [d, setD] = useState(null)
  const [erreur, setErreur] = useState('')
  useEffect(() => {
    supabase.rpc('plateforme_tableau_de_bord').then(({ data, error }) => (error ? setErreur(traduireErreur(error.message)) : setD(data)))
  }, [])
  if (erreur) return <Message erreur={erreur} />
  if (!d) return <p className="text-sm text-petrol-500">Chargement…</p>
  const coutFcfa = Number(d.ia_cout_usd_mois) * Number(d.taux_usd_fcfa || 620)
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Entreprises clientes</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Carte titre="Entreprises" valeur={nb(d.entreprises)} detail={`${nb(d.nouvelles_30j)} nouvelle(s) en 30 jours`} />
          <Carte titre="Abonnements actifs" valeur={nb(d.actives)} />
          <Carte titre="En essai" valeur={nb(d.essais)} detail={d.essais_expires ? `${nb(d.essais_expires)} essai(s) expiré(s)` : null} alerte={d.essais_expires > 0} />
          <Carte titre="Suspendues" valeur={nb(d.suspendues)} alerte={d.suspendues > 0} />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">Revenus</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Carte titre="Revenu mensuel récurrent" valeur={formatXOF(d.revenu_mensuel)} detail="abonnements actifs (annuels ramenés au mois)" />
          <Carte titre="Encaissé ce mois" valeur={formatXOF(d.encaisse_mois)} detail="paiements d'abonnement" />
          <Carte titre="Échéances sous 7 jours" valeur={nb(d.echeances_7j)} alerte={d.echeances_7j > 0} />
          <Carte titre="Échéances dépassées" valeur={nb(d.echeances_depassees)} alerte={d.echeances_depassees > 0} />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">Intelligence artificielle (ce mois)</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Carte titre="Coût réel de l'IA" valeur={usd(d.ia_cout_usd_mois)} detail={`≈ ${formatXOF(coutFcfa)}`} />
          <Carte titre="Unités consommées" valeur={nb(d.ia_unites_consommees_mois)} detail={`marge ≈ ${formatXOF(Number(d.ia_unites_consommees_mois) - coutFcfa)}`} />
          <Carte titre="Unités vendues" valeur={nb(d.ia_unites_vendues_mois)} detail={formatXOF(d.ia_ventes_fcfa_mois)} />
          <Carte titre="Soldes IA bas" valeur={nb(d.ia_soldes_bas)} alerte={d.ia_soldes_bas > 0} />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">Utilisateurs</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Carte titre="Comptes actifs" valeur={nb(d.utilisateurs)} />
          <Carte titre="Connectés (30 jours)" valeur={nb(d.utilisateurs_actifs_30j)} />
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Fiche entreprise
function FicheEntreprise({ e, formules, onFermer, onMaj }) {
  const [fiche, setFiche] = useState(null)
  const [abo, setAbo] = useState({ plan: e.plan, statut: e.statut, cycle: e.cycle || 'mensuel', fin_essai: e.date_fin_essai || '', echeance: e.date_prochaine_echeance || '', motif: '' })
  const [paiement, setPaiement] = useState({ plan: e.plan, cycle: e.cycle || 'mensuel', montant: '', moyen: 'virement', reference: '', debut: aujourdhui(), fin: '' })
  const [ia, setIa] = useState({ unites: '', type: 'achat', montant: '', motif: '' })
  const [msg, setMsg] = useState({})

  const [enLigne, setEnLigne] = useState([])
  const [lectureSeule, setLectureSeule] = useState(null)
  const [places, setPlaces] = useState(null)
  useEffect(() => { supabase.rpc('plateforme_situation_places', { p_entreprise_id: e.id }).then(({ data }) => setPlaces(data || null)) }, [e.id])
  useEffect(() => { supabase.rpc('plateforme_lecture_seule_etat', { p_entreprise_id: e.id }).then(({ data }) => setLectureSeule(!!data)) }, [e.id])
  const charger = () => {
    supabase.rpc('plateforme_fiche_entreprise', { p_entreprise_id: e.id }).then(({ data }) => setFiche(data))
    supabase.rpc('plateforme_paiements_en_ligne', { p_entreprise_id: e.id }).then(({ data }) => setEnLigne(data || []))
  }
  useEffect(() => { charger() }, [e.id])

  // Fin de période proposée selon le cycle.
  useEffect(() => {
    const d = new Date(paiement.debut)
    if (Number.isNaN(d.getTime())) return
    const f = new Date(d)
    if (paiement.cycle === 'annuel') f.setFullYear(f.getFullYear() + 1)
    else f.setMonth(f.getMonth() + 1)
    f.setDate(f.getDate() - 1)
    const formule = formules.find((x) => x.code === paiement.plan)
    setPaiement((p) => ({ ...p, fin: f.toISOString().slice(0, 10), montant: p.montant || String(formule ? (paiement.cycle === 'annuel' ? formule.prix_annuel : formule.prix_mensuel) : '') }))
  }, [paiement.debut, paiement.cycle, paiement.plan])

  async function action(cle, fn, params, okTexte) {
    setMsg({ [cle]: { erreur: '' } })
    const { error } = await supabase.rpc(fn, params)
    if (error) { setMsg({ [cle]: { erreur: traduireErreur(error.message) } }); return }
    setMsg({ [cle]: { ok: okTexte } })
    charger()
    onMaj()
  }

  const champ = 'input-field !py-1.5 text-sm'
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onFermer}>
      <div className="bg-canvas w-full max-w-2xl h-full overflow-y-auto p-4 space-y-4" onClick={(x) => x.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">{e.nom}</h2>
            <p className="text-xs text-petrol-500">Inscrite le {formatDate(e.created_at)} · Admin : {e.admin_email || '—'}</p>
          </div>
          <button data-fermer className="btn-secondary text-sm" onClick={onFermer}>Fermer</button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Carte titre="Formule" valeur={(formules.find((f) => f.code === e.plan) || {}).nom || e.plan} detail={STATUTS[e.statut]?.[0]} />
          <Carte titre="Commerciaux" valeur={`${e.nb_commerciaux} / ${e.max_commerciaux ?? '∞'}`} alerte={e.max_commerciaux != null && e.nb_commerciaux > e.max_commerciaux} />
          <Carte titre="Ventes 30 jours" valeur={nb(e.ventes_30j)} detail={formatXOF(e.ca_30j)} />
          <Carte titre="Solde IA" valeur={nb(e.solde_ia)} detail={`coût du mois ${usd(e.cout_ia_mois_usd)}`} alerte={Number(e.solde_ia) <= 0} />
        </div>

        <section className="card p-3 space-y-2">
          <h3 className="font-semibold text-sm">Abonnement</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <label className="text-xs">Formule<select className={champ} value={abo.plan} onChange={(x) => setAbo({ ...abo, plan: x.target.value })}>{formules.map((f) => <option key={f.code} value={f.code}>{f.nom}</option>)}</select></label>
            <label className="text-xs">Statut<select className={champ} value={abo.statut} onChange={(x) => setAbo({ ...abo, statut: x.target.value })}>{Object.entries(STATUTS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="text-xs">Cycle<select className={champ} value={abo.cycle} onChange={(x) => setAbo({ ...abo, cycle: x.target.value })}><option value="mensuel">Mensuel</option><option value="annuel">Annuel</option></select></label>
            <label className="text-xs">Fin d'essai<input type="date" className={champ} value={abo.fin_essai} onChange={(x) => setAbo({ ...abo, fin_essai: x.target.value })} /></label>
            <label className="text-xs">Prochaine échéance<input type="date" className={champ} value={abo.echeance} onChange={(x) => setAbo({ ...abo, echeance: x.target.value })} /></label>
            <label className="text-xs col-span-2 sm:col-span-1">Motif *<input className={champ} value={abo.motif} onChange={(x) => setAbo({ ...abo, motif: x.target.value })} placeholder="ex. prolongation d'essai" /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary text-xs" onClick={() => action('abo', 'plateforme_modifier_abonnement', {
              p_entreprise_id: e.id, p_plan: abo.plan, p_statut: abo.statut, p_cycle: abo.cycle,
              p_date_fin_essai: abo.fin_essai || null, p_date_echeance: abo.echeance || null, p_motif: abo.motif,
            }, 'Abonnement mis à jour.')}>Enregistrer</button>
            <button className="btn-secondary text-xs" onClick={() => {
              const d = new Date(Math.max(Date.now(), new Date(abo.fin_essai || Date.now()).getTime()))
              d.setDate(d.getDate() + 14)
              setAbo({ ...abo, statut: 'essai', fin_essai: d.toISOString().slice(0, 10), motif: abo.motif || 'Prolongation de l\'essai de 14 jours' })
            }}>+14 jours d'essai</button>
            {e.statut !== 'suspendu'
              ? <button className="text-xs text-red-700 underline" onClick={() => setAbo({ ...abo, statut: 'suspendu', motif: abo.motif || 'Impayé' })}>Préparer une suspension</button>
              : <button className="text-xs text-emerald-700 underline" onClick={() => setAbo({ ...abo, statut: 'actif', motif: abo.motif || 'Réactivation' })}>Préparer une réactivation</button>}
          </div>
          <Message {...(msg.abo || {})} />
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
            <span className="text-xs">Lecture seule : <strong className={lectureSeule ? 'text-red-700' : 'text-emerald-700'}>{lectureSeule == null ? '…' : lectureSeule ? 'active' : 'non'}</strong></span>
            <button className="btn-secondary text-xs" onClick={async () => {
              const motif = window.prompt(lectureSeule ? 'Motif de la levée de la lecture seule :' : 'Motif de la mise en lecture seule :')
              if (!motif) return
              const { error } = await supabase.rpc('plateforme_lecture_seule', { p_entreprise_id: e.id, p_active: !lectureSeule, p_motif: motif })
              if (error) { setMsg({ abo: { erreur: traduireErreur(error.message) } }); return }
              setLectureSeule(!lectureSeule)
              charger()
            }}>{lectureSeule ? 'Lever la lecture seule' : 'Mettre en lecture seule'}</button>
          </div>
        </section>

        <section className="card p-3 space-y-2">
          <h3 className="font-semibold text-sm">Enregistrer un paiement reçu</h3>
          <p className="text-[11px] text-petrol-500">Virement, espèces ou Mobile Money reçu directement (en attendant le paiement en ligne) : l'abonnement est activé jusqu'à la fin de la période.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <label className="text-xs">Formule<select className={champ} value={paiement.plan} onChange={(x) => setPaiement({ ...paiement, plan: x.target.value, montant: '' })}>{formules.map((f) => <option key={f.code} value={f.code}>{f.nom}</option>)}</select></label>
            <label className="text-xs">Cycle<select className={champ} value={paiement.cycle} onChange={(x) => setPaiement({ ...paiement, cycle: x.target.value, montant: '' })}><option value="mensuel">Mensuel</option><option value="annuel">Annuel</option></select></label>
            <label className="text-xs">Montant (F CFA)<input type="number" className={champ} value={paiement.montant} onChange={(x) => setPaiement({ ...paiement, montant: x.target.value })} /></label>
            <label className="text-xs">Moyen<select className={champ} value={paiement.moyen} onChange={(x) => setPaiement({ ...paiement, moyen: x.target.value })}>
              {[['virement', 'Virement'], ['mobile_money', 'Mobile Money'], ['especes', 'Espèces'], ['cheque', 'Chèque']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></label>
            <label className="text-xs">Du<input type="date" className={champ} value={paiement.debut} onChange={(x) => setPaiement({ ...paiement, debut: x.target.value })} /></label>
            <label className="text-xs">Au<input type="date" className={champ} value={paiement.fin} onChange={(x) => setPaiement({ ...paiement, fin: x.target.value })} /></label>
            <label className="text-xs col-span-2 sm:col-span-3">Référence<input className={champ} value={paiement.reference} onChange={(x) => setPaiement({ ...paiement, reference: x.target.value })} placeholder="n° de transaction, de virement…" /></label>
          </div>
          <button className="btn-primary text-xs" onClick={() => action('paiement', 'plateforme_enregistrer_paiement', {
            p_entreprise_id: e.id, p_plan: paiement.plan, p_cycle: paiement.cycle, p_montant: Number(paiement.montant),
            p_moyen: paiement.moyen, p_reference: paiement.reference, p_debut: paiement.debut, p_fin: paiement.fin,
          }, 'Paiement enregistré, abonnement activé.')}>Enregistrer le paiement</button>
          <Message {...(msg.paiement || {})} />
        </section>

        <section className="card p-3 space-y-2">
          <h3 className="font-semibold text-sm">Unités IA</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label className="text-xs">Opération<select className={champ} value={ia.type} onChange={(x) => setIa({ ...ia, type: x.target.value })}>
              {[['achat', 'Achat'], ['offert', 'Offert'], ['ajustement', 'Ajustement (±)'], ['remboursement', 'Remboursement (±)']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></label>
            <label className="text-xs">Unités<input type="number" className={champ} value={ia.unites} onChange={(x) => setIa({ ...ia, unites: x.target.value })} /></label>
            <label className="text-xs">Payé (F CFA)<input type="number" className={champ} value={ia.montant} onChange={(x) => setIa({ ...ia, montant: x.target.value })} disabled={ia.type !== 'achat'} /></label>
            <label className="text-xs">Motif *<input className={champ} value={ia.motif} onChange={(x) => setIa({ ...ia, motif: x.target.value })} /></label>
          </div>
          <button className="btn-primary text-xs" onClick={() => action('ia', 'plateforme_crediter_ia', {
            p_entreprise_id: e.id, p_unites: Number(ia.unites), p_type: ia.type, p_montant: Number(ia.montant || 0), p_motif: ia.motif,
          }, 'Porte-monnaie mis à jour.')}>Valider</button>
          <Message {...(msg.ia || {})} />
          {fiche?.conso_ia_par_fonction?.length > 0 && (
            <p className="text-[11px] text-petrol-600">30 derniers jours : {fiche.conso_ia_par_fonction.map((c) => `${c.fonction} ${c.appels} appel(s), ${usd(c.cout_usd)}`).join(' · ')}</p>
          )}
          <div className="max-h-40 overflow-y-auto text-xs space-y-0.5">
            {(fiche?.mouvements_ia || []).map((m, i) => (
              <p key={i} className="flex justify-between gap-2 border-b border-line py-0.5">
                <span>{formatDateHeure(m.created_at)} · {m.type}{m.fonction ? ` (${m.fonction})` : ''}{m.motif ? ` — ${m.motif}` : ''}</span>
                <span className={`font-mono ${Number(m.unites) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{Number(m.unites) > 0 ? '+' : ''}{nb(m.unites)}</span>
              </p>
            ))}
          </div>
        </section>

        {places && (
          <section className="card p-3 space-y-2 text-sm">
            <h3 className="font-semibold text-sm">Utilisateurs par rôle et places supplémentaires</h3>
            <p className="text-xs text-petrol-600">
              Inclus par rôle : {places.inclus_par_role ?? 'illimité'} · {Object.entries(places.roles || {}).map(([r, n]) => `${r} ${n}`).join(' · ') || 'aucun'}
            </p>
            <p className="text-xs">Places nécessaires : <strong>{places.depassement}</strong> · achetées : <strong>{places.places_achetees}</strong>
              {places.depassement > places.places_achetees && <span className="text-red-700"> · dépassement non payé ({places.depassement - places.places_achetees})</span>}
              {places.essai && <span className="text-sky-700"> · en essai (pas de limite)</span>}</p>
            <button className="btn-secondary text-xs" onClick={async () => {
              const n = window.prompt('Nombre de places supplémentaires pour cette entreprise :', String(places.places_achetees))
              if (n == null) return
              const motif = window.prompt('Motif :', 'Ajustement')
              if (!motif) return
              const { error } = await supabase.rpc('plateforme_definir_places', { p_entreprise_id: e.id, p_places: Number(n), p_motif: motif })
              if (error) { window.alert(traduireErreur(error.message)); return }
              supabase.rpc('plateforme_situation_places', { p_entreprise_id: e.id }).then(({ data }) => setPlaces(data || null))
              charger()
            }}>Modifier le nombre de places</button>
          </section>
        )}

        <section className="card p-3">
          <h3 className="font-semibold text-sm mb-2">Utilisateurs ({fiche?.utilisateurs?.length ?? '…'})</h3>
          <div className="text-xs space-y-0.5 max-h-48 overflow-y-auto">
            {(fiche?.utilisateurs || []).map((u, i) => (
              <p key={i} className={`flex justify-between gap-2 border-b border-line py-0.5 ${u.actif ? '' : 'opacity-50'}`}>
                <span>{u.nom} · {u.role} · {u.email}</span>
                <span className="text-petrol-500">{u.derniere_connexion ? formatDate(u.derniere_connexion) : 'jamais'}</span>
              </p>
            ))}
          </div>
        </section>

        <section className="card p-3">
          <h3 className="font-semibold text-sm mb-2">Paiements d'abonnement</h3>
          <div className="text-xs space-y-0.5">
            {(fiche?.paiements || []).length === 0 ? <p className="text-petrol-400">Aucun paiement.</p> : fiche.paiements.map((p) => (
              <p key={p.id} className="flex justify-between gap-2 border-b border-line py-0.5">
                <span>{formatDate(p.created_at)} · {p.plan_code} {p.cycle} · {p.moyen_paiement || '—'} · {p.statut}</span>
                <span className="font-mono">{formatXOF(p.montant)}</span>
              </p>
            ))}
          </div>
        </section>

        <section className="card p-3">
          <h3 className="font-semibold text-sm mb-2">Paiements en ligne (CinetPay)</h3>
          <div className="text-xs space-y-0.5">
            {enLigne.length === 0 ? <p className="text-petrol-400">Aucun paiement en ligne.</p> : enLigne.map((p) => (
              <p key={p.id} className="flex justify-between gap-2 border-b border-line py-0.5">
                <span>{formatDateHeure(p.created_at)} · {p.objet === 'unites' ? `pack ${p.pack_code} (${nb(p.unites)} u.)` : `${p.plan_code} ${p.cycle}`} · {p.moyen || '—'} · <span className={p.statut === 'reussi' ? 'text-emerald-700' : p.statut === 'initie' ? 'text-sky-700' : 'text-red-700'}>{p.statut}</span></span>
                <span className="font-mono">{formatXOF(p.montant)}</span>
              </p>
            ))}
          </div>
        </section>

        <section className="card p-3">
          <h3 className="font-semibold text-sm mb-2">Historique des interventions</h3>
          <div className="text-xs space-y-1">
            {(fiche?.journal || []).length === 0 ? <p className="text-petrol-400">Aucune intervention.</p> : fiche.journal.map((j, i) => (
              <p key={i} className="border-b border-line py-0.5">{formatDateHeure(j.created_at)} · <strong>{j.action}</strong> {j.details?.motif ? `— ${j.details.motif}` : ''}</p>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Entreprises
function Entreprises() {
  const [liste, setListe] = useState([])
  const [formules, setFormules] = useState([])
  const [filtre, setFiltre] = useState('')
  const [statut, setStatut] = useState('')
  const [ouverte, setOuverte] = useState(null)
  const [erreur, setErreur] = useState('')

  const charger = async () => {
    const [{ data, error }, { data: f }] = await Promise.all([
      supabase.rpc('plateforme_entreprises'),
      supabase.from('plans').select('*').order('ordre'),
    ])
    if (error) setErreur(traduireErreur(error.message))
    setListe(data || [])
    setFormules(f || [])
    return data || []
  }
  useEffect(() => { charger() }, [])

  const filtrees = useMemo(() => liste.filter((e) =>
    (!statut || e.statut === statut || (statut === 'essai_expire' && e.statut === 'essai' && e.date_fin_essai && e.date_fin_essai < aujourdhui()))
    && (!filtre || `${e.nom} ${e.admin_email || ''}`.toLowerCase().includes(filtre.toLowerCase()))), [liste, filtre, statut])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className="input-field !py-1.5 text-sm flex-1 min-w-[180px]" placeholder="Rechercher (nom, email de l'admin)…" value={filtre} onChange={(x) => setFiltre(x.target.value)} />
        <select className="input-field !py-1.5 text-sm w-auto" value={statut} onChange={(x) => setStatut(x.target.value)}>
          <option value="">Tous les statuts</option>
          <option value="actif">Actives</option>
          <option value="essai">En essai</option>
          <option value="essai_expire">Essai expiré</option>
          <option value="suspendu">Suspendues</option>
        </select>
      </div>
      <Message erreur={erreur} />
      <p className="text-xs text-petrol-500">{filtrees.length} entreprise(s)</p>
      <div className="space-y-2">
        {filtrees.map((e) => {
          const essaiExpire = e.statut === 'essai' && e.date_fin_essai && e.date_fin_essai < aujourdhui()
          const echeanceDepassee = e.statut === 'actif' && e.date_prochaine_echeance && e.date_prochaine_echeance < aujourdhui()
          return (
            <button key={e.id} onClick={() => setOuverte(e)} className="card p-3 w-full text-left hover:border-amber-400">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{e.nom}</p>
                  <p className="text-[11px] text-petrol-500 truncate">{e.admin_email || '—'} · inscrite le {formatDate(e.created_at)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className={`px-2 py-0.5 rounded-full ${STATUTS[e.statut]?.[1] || ''}`}>{STATUTS[e.statut]?.[0] || e.statut}</span>
                  <span className="px-2 py-0.5 rounded-full bg-canvas border border-line">{(formules.find((f) => f.code === e.plan) || {}).nom || e.plan}</span>
                  {essaiExpire && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">essai expiré</span>}
                  {echeanceDepassee && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700">échéance dépassée</span>}
                  {Number(e.solde_ia) <= 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700">IA épuisée</span>}
                </div>
              </div>
              <p className="text-[11px] text-petrol-600 mt-1.5">
                {e.nb_utilisateurs} utilisateur(s) · {e.nb_commerciaux}/{e.max_commerciaux ?? '∞'} commerciaux · {nb(e.ventes_30j)} vente(s) en 30 j ({formatXOF(e.ca_30j)}) ·
                IA : {nb(e.solde_ia)} unités · {e.statut === 'essai' ? `fin d'essai ${e.date_fin_essai ? formatDate(e.date_fin_essai) : '—'}` : `échéance ${e.date_prochaine_echeance ? formatDate(e.date_prochaine_echeance) : '—'}`} ·
                dernière connexion {e.derniere_connexion ? formatDate(e.derniere_connexion) : 'jamais'}
              </p>
            </button>
          )
        })}
      </div>
      {ouverte && <FicheEntreprise key={ouverte.id} e={ouverte} formules={formules} onFermer={() => setOuverte(null)} onMaj={async () => {
        // La fiche ouverte reflète les nouvelles valeurs (formule, statut, solde IA…).
        const data = await charger()
        setOuverte((o) => data.find((x) => x.id === o?.id) || o)
      }} />}
    </div>
  )
}

// ------------------------------------------------------------------ Formules
function Formules() {
  const [formules, setFormules] = useState([])
  const [msg, setMsg] = useState({})
  const charger = () => supabase.from('plans').select('*').order('ordre').then(({ data }) => setFormules((data || []).map((f) => ({ ...f, max: f.max_commerciaux ?? '', inclus: f.utilisateurs_par_role ?? '', prixPlace: f.prix_place_supp ?? 3000 }))))
  useEffect(() => { charger() }, [])
  const maj = (code, cle, v) => setFormules(formules.map((f) => (f.code === code ? { ...f, [cle]: v } : f)))
  async function enregistrer(f) {
    const { error } = await supabase.rpc('plateforme_modifier_formule', {
      p_code: f.code, p_nom: f.nom, p_prix_mensuel: Number(f.prix_mensuel), p_prix_annuel: Number(f.prix_annuel),
      p_max_commerciaux: f.max === '' ? null : Number(f.max), p_actif: f.actif,
    })
    if (error) { setMsg({ [f.code]: { erreur: traduireErreur(error.message) } }); return }
    const r = await supabase.rpc('plateforme_modifier_places_formule', {
      p_code: f.code, p_utilisateurs_par_role: f.inclus === '' ? null : Number(f.inclus), p_prix_place_supp: Number(f.prixPlace),
    })
    setMsg({ [f.code]: r.error ? { erreur: traduireErreur(r.error.message) } : { ok: 'Enregistré.' } })
  }
  const champ = 'input-field !py-1.5 text-sm'
  return (
    <div className="grid md:grid-cols-3 gap-3">
      {formules.map((f) => (
        <div key={f.code} className="card p-3 space-y-2">
          <p className="text-[11px] uppercase text-petrol-500">{f.code}</p>
          <label className="text-xs block">Nom<input className={champ} value={f.nom} onChange={(x) => maj(f.code, 'nom', x.target.value)} /></label>
          <label className="text-xs block">Prix mensuel (F CFA)<input type="number" className={champ} value={f.prix_mensuel} onChange={(x) => maj(f.code, 'prix_mensuel', x.target.value)} /></label>
          <label className="text-xs block">Prix annuel (F CFA)<input type="number" className={champ} value={f.prix_annuel} onChange={(x) => maj(f.code, 'prix_annuel', x.target.value)} /></label>
          <label className="text-xs block">Commerciaux max (vide = illimité)<input type="number" className={champ} value={f.max} onChange={(x) => maj(f.code, 'max', x.target.value)} /></label>
          <label className="text-xs block">Utilisateurs inclus par rôle, hors commerciaux (vide = illimité)<input type="number" min="1" className={champ} value={f.inclus} onChange={(x) => maj(f.code, 'inclus', x.target.value)} /></label>
          <label className="text-xs block">Prix d'une place supplémentaire (F CFA / mois)<input type="number" min="0" className={champ} value={f.prixPlace} onChange={(x) => maj(f.code, 'prixPlace', x.target.value)} /></label>
          <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={f.actif} onChange={(x) => maj(f.code, 'actif', x.target.checked)} /> Proposée aux clients</label>
          <button className="btn-primary text-xs" onClick={() => enregistrer(f)}>Enregistrer</button>
          <Message {...(msg[f.code] || {})} />
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ Paramètres IA
function UnitesIA() {
  const [params, setParams] = useState([])
  const [msg, setMsg] = useState({})
  useEffect(() => { supabase.rpc('plateforme_parametres_liste').then(({ data }) => setParams((data || []).map((p) => ({ ...p, v: String(p.valeur) })))) }, [])
  async function enregistrer(p) {
    const { error } = await supabase.rpc('plateforme_modifier_parametre', { p_cle: p.cle, p_valeur: Number(p.v) })
    setMsg({ [p.cle]: error ? { erreur: traduireErreur(error.message) } : { ok: 'Enregistré.' } })
  }
  const [packs, setPacks] = useState([])
  useEffect(() => { supabase.from('ia_packs').select('*').order('ordre').then(({ data }) => setPacks(data || [])) }, [])
  async function enregistrerPack(p) {
    const { error } = await supabase.rpc('plateforme_modifier_pack', { p_code: p.code, p_nom: p.nom, p_unites: Number(p.unites), p_prix: Number(p.prix), p_actif: p.actif })
    setMsg({ [`pack-${p.code}`]: error ? { erreur: traduireErreur(error.message) } : { ok: 'Enregistré.' } })
  }
  const majPack = (code, cle, v) => setPacks(packs.map((p) => (p.code === code ? { ...p, [cle]: v } : p)))
  const taux = Number(params.find((p) => p.cle === 'taux_usd_fcfa')?.v || 620)
  const coef = Number(params.find((p) => p.cle === 'coefficient_marge_ia')?.v || 3)
  return (
    <div className="space-y-3">
      <div className="card p-3 text-sm space-y-1">
        <p><strong>Principe :</strong> 1 unité IA = 1 F CFA de valeur pour le client. Chaque appel d'IA débite le porte-monnaie de l'entreprise : coût réel (USD) × taux de change × coefficient de marge.</p>
        <p className="text-petrol-600">Exemple : une question à l'assistant coûtant 0,01 $ débite {Math.ceil(0.01 * taux * coef)} unités ({Math.ceil(0.01 * taux * coef)} F CFA), pour un coût réel d'environ {Math.round(0.01 * taux)} F CFA.</p>
        <p className="text-petrol-600">À zéro, l'IA est bloquée pour l'entreprise (le rapport PowerPoint est alors produit sans commentaires).</p>
      </div>
      <div className="card p-3 text-sm space-y-1">
        <p><strong>Impayés et rappels :</strong> chaque jour à 8 h, les rappels sont envoyés aux administrateurs (fin d'essai et échéance à J-7, J-3, J-1 ; impayé à J+1, J+7, J+14 ; unités IA basses ou épuisées).</p>
        <p className="text-petrol-600">Si <em>lecture_seule_auto</em> = 1 : lecture seule après <em>jours_grace</em> jours d'impayé ou d'essai expiré. Si <em>suspension_auto</em> = 1 : suspension après <em>jours_avant_suspension</em> jours. Les deux sont désactivées (0) par défaut. Levée automatique dès le paiement.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {params.map((p) => (
          <div key={p.cle} className="card p-3 space-y-1.5">
            <p className="text-sm font-medium">{p.cle}</p>
            <p className="text-[11px] text-petrol-500">{p.description}</p>
            <div className="flex gap-2">
              <input type="number" step="0.01" className="input-field !py-1.5 text-sm" value={p.v} onChange={(x) => setParams(params.map((q) => (q.cle === p.cle ? { ...q, v: x.target.value } : q)))} />
              <button className="btn-primary text-xs" onClick={() => enregistrer(p)}>OK</button>
            </div>
            <Message {...(msg[p.cle] || {})} />
          </div>
        ))}
      </div>
      <h3 className="text-sm font-semibold pt-2">Packs proposés aux clients (paiement en ligne)</h3>
      <div className="grid md:grid-cols-3 gap-3">
        {packs.map((p) => (
          <div key={p.code} className="card p-3 space-y-1.5">
            <p className="text-[11px] uppercase text-petrol-500">{p.code}</p>
            <input className="input-field !py-1.5 text-sm" value={p.nom} onChange={(x) => majPack(p.code, 'nom', x.target.value)} />
            <label className="text-xs block">Unités<input type="number" className="input-field !py-1.5 text-sm" value={p.unites} onChange={(x) => majPack(p.code, 'unites', x.target.value)} /></label>
            <label className="text-xs block">Prix (F CFA, multiple de 5)<input type="number" step="5" className="input-field !py-1.5 text-sm" value={p.prix} onChange={(x) => majPack(p.code, 'prix', x.target.value)} /></label>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={p.actif} onChange={(x) => majPack(p.code, 'actif', x.target.checked)} /> Proposé</label>
            <button className="btn-primary text-xs" onClick={() => enregistrerPack(p)}>Enregistrer</button>
            <Message {...(msg[`pack-${p.code}`] || {})} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Annonces
function Annonces() {
  const [liste, setListe] = useState([])
  const [a, setA] = useState({ titre: '', message: '', niveau: 'info', fin: '' })
  const [msg, setMsg] = useState({})
  const charger = () => supabase.from('annonces_plateforme').select('*').order('created_at', { ascending: false }).limit(30).then(({ data }) => setListe(data || []))
  useEffect(() => { charger() }, [])
  async function publier() {
    const { error } = await supabase.rpc('plateforme_publier_annonce', { p_titre: a.titre, p_message: a.message, p_niveau: a.niveau, p_fin: a.fin ? `${a.fin}T23:59:59` : null })
    if (error) { setMsg({ erreur: traduireErreur(error.message) }); return }
    setMsg({ ok: 'Annonce publiée : elle s\'affiche en haut de l\'app pour tous les utilisateurs.' })
    setA({ titre: '', message: '', niveau: 'info', fin: '' })
    charger()
  }
  const champ = 'input-field !py-1.5 text-sm'
  return (
    <div className="space-y-3">
      <div className="card p-3 space-y-2">
        <h3 className="font-semibold text-sm">Nouvelle annonce à tous les utilisateurs</h3>
        <input className={champ} placeholder="Titre (ex. Nouveau : l'assistant vocal)" value={a.titre} onChange={(x) => setA({ ...a, titre: x.target.value })} />
        <textarea className={`${champ} min-h-[80px]`} placeholder="Message" value={a.message} onChange={(x) => setA({ ...a, message: x.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <select className={champ} value={a.niveau} onChange={(x) => setA({ ...a, niveau: x.target.value })}>
            <option value="info">Information</option><option value="attention">Attention</option><option value="important">Important</option>
          </select>
          <label className="text-xs">Jusqu'au (facultatif)<input type="date" className={champ} value={a.fin} onChange={(x) => setA({ ...a, fin: x.target.value })} /></label>
        </div>
        <button className="btn-primary text-xs" onClick={publier}>Publier</button>
        <Message {...msg} />
      </div>
      {liste.map((x) => (
        <div key={x.id} className={`card p-3 text-sm ${x.actif ? '' : 'opacity-50'}`}>
          <div className="flex justify-between gap-2">
            <p className="font-medium">{x.titre} <span className="text-[11px] text-petrol-500">· {x.niveau} · {formatDate(x.created_at)}{x.fin ? ` → ${formatDate(x.fin)}` : ''}</span></p>
            {x.actif && <button className="text-xs text-red-700 underline" onClick={async () => { await supabase.rpc('plateforme_retirer_annonce', { p_id: x.id }); charger() }}>Retirer</button>}
          </div>
          <p className="text-xs text-petrol-600 mt-1">{x.message}</p>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ Journal
function Journal() {
  const [liste, setListe] = useState([])
  useEffect(() => { supabase.rpc('plateforme_journal_liste', { p_limite: 200 }).then(({ data }) => setListe(data || [])) }, [])
  return (
    <div className="card p-3 text-xs space-y-1">
      {liste.length === 0 ? <p className="text-petrol-400">Aucune action enregistrée.</p> : liste.map((j, i) => (
        <p key={i} className="border-b border-line py-1">
          <span className="text-petrol-500">{formatDateHeure(j.created_at)}</span> · <strong>{j.action}</strong>{j.entreprise ? ` · ${j.entreprise}` : ''} · {j.auteur}
          {j.details?.motif ? ` — ${j.details.motif}` : ''}
        </p>
      ))}
    </div>
  )
}

export default function ConsolePlateforme() {
  const { estSuperAdmin } = useAuth()
  const [onglet, setOnglet] = useState('bord')
  if (estSuperAdmin === false) return <Navigate to="/" replace />
  if (estSuperAdmin == null) return <p className="p-6 text-sm text-petrol-500">Chargement…</p>
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold">🛰️ Console de la plateforme</h1>
      <p className="text-sm text-petrol-500 mb-4">Espace réservé au promoteur de DistribPro : entreprises clientes, abonnements, unités IA, formules, annonces.</p>
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
        {ONGLETS.map(([k, l]) => (
          <button key={k} onClick={() => setOnglet(k)}
            className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap border ${onglet === k ? 'bg-petrol-800 text-white border-petrol-800' : 'bg-white border-line'}`}>{l}</button>
        ))}
      </div>
      {onglet === 'bord' && <TableauDeBord />}
      {onglet === 'entreprises' && <Entreprises />}
      {onglet === 'formules' && <Formules />}
      {onglet === 'ia' && <UnitesIA />}
      {onglet === 'annonces' && <Annonces />}
      {onglet === 'journal' && <Journal />}
    </div>
  )
}
