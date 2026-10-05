import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { traduireErreur } from '../lib/erreurs'
import { formatDate } from '../lib/format'

// Demandes de sortie de produits : le commercial demande au magasin la
// marchandise de sa tournée (avec une proposition de l'IA s'il le souhaite) ;
// le gestionnaire de stock accorde tout ou partie, ou refuse avec un motif.
// Accorder crée la sortie de stock habituelle (RPC traiter_demande_sortie).

const STYLES_STATUT = {
  en_attente: 'bg-amber-50 text-amber-700 border-amber-200',
  accordee: 'bg-green-50 text-green-700 border-green-200',
  partielle: 'bg-sky-50 text-sky-700 border-sky-200',
  refusee: 'bg-red-50 text-red-700 border-red-200',
  annulee: 'bg-canvas text-petrol-500 border-line',
}

const SELECT_DEMANDE = 'id, numero, statut, date_souhaitee, commentaire, proposee_par_ia, synthese_ia, motif_traitement, traite_le, created_at, commercial_id, depot_id, sortie_id, commercial:profils!commercial_id(nom), traitant:profils!traite_par(nom), depots(nom), demande_sortie_lignes(id, produit_id, quantite_demandee, quantite_accordee, raison_ia, produits(nom, reference))'

function notifier(demandeId, evenement) {
  supabase.functions.invoke('envoyer-notification-demande-sortie', { body: { demande_id: demandeId, evenement } }).catch(() => {})
}

function demain() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('fr-CA')
}

async function lireErreurFonction(error, data, defaut) {
  let message = data?.erreur
  if (!message && error?.context?.json) {
    try { message = (await error.context.json()).erreur } catch { /* ignore */ }
  }
  return message || error?.message || defaut
}

function PastilleStatut({ statut }) {
  const { t } = useTranslation('stockcommercial')
  return (
    <span className={`text-xs px-2 py-1 rounded-full border whitespace-nowrap ${STYLES_STATUT[statut] || ''}`}>
      {t(`demandes.statuts.${statut}`)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Côté commercial : mes demandes + nouvelle demande (avec IA)
// ---------------------------------------------------------------------------
export function MesDemandesSortie() {
  const { t } = useTranslation('stockcommercial')
  const { profil } = useAuth()
  const [demandes, setDemandes] = useState([])
  const [chargement, setChargement] = useState(true)
  const [formulaire, setFormulaire] = useState(false)
  const [ouverte, setOuverte] = useState(null)
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    charger()
    const canal = supabase
      .channel('mes-demandes-sortie')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'demandes_sortie' }, () => charger())
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [])

  async function charger() {
    const { data } = await supabase.from('demandes_sortie').select(SELECT_DEMANDE)
      .eq('commercial_id', profil?.id).order('created_at', { ascending: false }).limit(30)
    setDemandes(data || [])
    setChargement(false)
  }

  async function annuler(d) {
    if (!window.confirm(t('demandes.confirmerAnnulation', { numero: d.numero }))) return
    setErreur('')
    const { error } = await supabase.rpc('annuler_demande_sortie', { p_demande_id: d.id })
    if (error) setErreur(traduireErreur(error.message))
    charger()
  }

  return (
    <div>
      <button data-aide="stockcommercial.nouvelleDemande" onClick={() => setFormulaire(true)} className="btn-primary text-sm mb-4">
        {t('demandes.nouvelle')}
      </button>
      {erreur && <p className="text-sm text-red-600 mb-2">{erreur}</p>}

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <div className="space-y-2">
          {demandes.map((d) => {
            const deplie = ouverte === d.id
            return (
              <div key={d.id} className="border border-line rounded-lg">
                <button onClick={() => setOuverte(deplie ? null : d.id)} className="w-full text-left p-3 flex justify-between items-center gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{d.numero} {d.proposee_par_ia && <span title={t('demandes.parIA')}>✨</span>}</p>
                    <p className="text-xs text-petrol-500">
                      {t('demandes.pourLe', { date: formatDate(d.date_souhaitee) })} — {d.depots?.nom} — {t('articles', { n: d.demande_sortie_lignes?.length || 0 })}
                    </p>
                  </div>
                  <PastilleStatut statut={d.statut} />
                </button>
                {deplie && (
                  <div className="border-t border-line px-3 py-2 text-sm space-y-2">
                    <table className="w-full text-xs" data-tableau-classique>
                      <thead>
                        <tr className="text-petrol-500">
                          <th className="py-1 text-left font-medium">{t('produit')}</th>
                          <th className="py-1 text-right font-medium">{t('demandes.demande')}</th>
                          <th className="py-1 text-right font-medium">{t('demandes.accorde')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.demande_sortie_lignes.map((l) => (
                          <tr key={l.id} className="border-t border-line">
                            <td className="py-1">{l.produits?.nom}</td>
                            <td className="py-1 text-right font-mono">{l.quantite_demandee}</td>
                            <td className={`py-1 text-right font-mono ${l.quantite_accordee != null && l.quantite_accordee < l.quantite_demandee ? 'text-red-700' : ''}`}>
                              {l.quantite_accordee ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {d.commentaire && <p className="text-xs text-petrol-600">💬 {d.commentaire}</p>}
                    {d.motif_traitement && <p className="text-xs text-petrol-700">📌 {t('demandes.motif')} : {d.motif_traitement}</p>}
                    {d.traite_le && d.statut !== 'annulee' && (
                      <p className="text-[11px] text-petrol-400">{t('demandes.traitePar', { nom: d.traitant?.nom || '—', date: formatDate(d.traite_le) })}</p>
                    )}
                    {d.statut === 'en_attente' && (
                      <button onClick={() => annuler(d)} className="text-xs text-red-600 underline">{t('demandes.annuler')}</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {demandes.length === 0 && <p className="text-petrol-400 text-center py-8 text-sm">{t('demandes.aucune')}</p>}
        </div>
      )}

      {formulaire && <FormulaireDemande onFermer={() => setFormulaire(false)} onEnvoyee={() => { setFormulaire(false); charger() }} />}
    </div>
  )
}

function FormulaireDemande({ onFermer, onEnvoyee }) {
  const { t, i18n } = useTranslation('stockcommercial')
  const { profil } = useAuth()
  const [depots, setDepots] = useState([])
  const [produits, setProduits] = useState([])
  const [stocks, setStocks] = useState({})
  const [enMain, setEnMain] = useState({})
  const [depotId, setDepotId] = useState('')
  const [date, setDate] = useState(demain())
  const [commentaire, setCommentaire] = useState('')
  const [lignes, setLignes] = useState([{ produit_id: '', quantite: 1, raison_ia: '' }])
  const [consignes, setConsignes] = useState('')
  const [synthese, setSynthese] = useState('')
  const [parIA, setParIA] = useState(false)
  const [chargementIA, setChargementIA] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')
  const iaDisponible = profil?.ia_active !== false

  useEffect(() => {
    Promise.all([
      supabase.from('depots').select('id, nom').eq('actif', true).order('nom'),
      supabase.from('produits').select('id, nom, reference').eq('actif', true).order('nom'),
      supabase.from('stock_commercial').select('produit_id, quantite').eq('commercial_id', profil?.id),
    ]).then(([{ data: dep }, { data: prod }, { data: main }]) => {
      setDepots(dep || [])
      if ((dep || []).length === 1) setDepotId(dep[0].id)
      setProduits(prod || [])
      setEnMain(Object.fromEntries((main || []).map((m) => [m.produit_id, m.quantite])))
    })
  }, [])

  useEffect(() => {
    if (!depotId) { setStocks({}); return }
    supabase.from('stocks').select('produit_id, quantite').eq('depot_id', depotId)
      .then(({ data }) => setStocks(Object.fromEntries((data || []).map((s) => [s.produit_id, s.quantite]))))
  }, [depotId])

  const maj = (i, champ, val) => setLignes((prev) => prev.map((l, j) => (j === i ? { ...l, [champ]: val } : l)))

  async function proposerIA() {
    setErreur('')
    if (!depotId) { setErreur(t('demandes.choisirMagasin')); return }
    setChargementIA(true)
    const { data, error } = await supabase.functions.invoke('proposer-demande-sortie', {
      body: { depot_id: depotId, date_souhaitee: date, consignes, langue: i18n.language },
    })
    setChargementIA(false)
    if (error || data?.erreur) {
      setErreur(await lireErreurFonction(error, data, t('demandes.ia.erreur')))
      return
    }
    if (!data?.lignes?.length) {
      setErreur(t('demandes.ia.vide'))
      return
    }
    setLignes(data.lignes.map((l) => ({ produit_id: l.produit_id, quantite: l.quantite, raison_ia: l.raison })))
    const base = data.source === 'tournee'
      ? t('demandes.ia.baseTournee', { n: data.nb_clients })
      : t('demandes.ia.basePortefeuille', { n: data.nb_clients })
    setSynthese(`${base} ${data.synthese || ''}`.trim())
    setParIA(true)
  }

  async function envoyer(e) {
    e.preventDefault()
    setErreur('')
    if (!depotId) { setErreur(t('demandes.choisirMagasin')); return }
    const valides = lignes.filter((l) => l.produit_id && Number(l.quantite) > 0)
    if (!valides.length) { setErreur(t('erreurAuMoinsUnArticle')); return }
    setEnvoi(true)
    const { data: demandeId, error } = await supabase.rpc('creer_demande_sortie', {
      p_depot_id: depotId,
      p_date_souhaitee: date,
      p_lignes: valides.map((l) => ({ produit_id: l.produit_id, quantite: Number(l.quantite), raison_ia: l.raison_ia || null })),
      p_commentaire: commentaire || null,
      p_proposee_par_ia: parIA,
      p_synthese_ia: parIA ? synthese : null,
    })
    setEnvoi(false)
    if (error) { setErreur(`${t('erreur')} : ${traduireErreur(error.message)}`); return }
    notifier(demandeId, 'creation')
    onEnvoyee()
  }

  return (
    <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
      <div className="card bg-white p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="font-semibold text-lg mb-1">{t('demandes.titreFormulaire')}</h2>
        <p className="text-xs text-petrol-500 mb-4">{t('demandes.aideFormulaire')}</p>
        <form onSubmit={envoyer} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('depotSource')}</label>
              <select className="input-field" value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                <option value="">{t('selectionner')}</option>
                {depots.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('demandes.dateSouhaitee')}</label>
              <input type="date" className="input-field" min={new Date().toLocaleDateString('fr-CA')} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          {iaDisponible && (
            <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 space-y-2">
              <p className="text-sm font-medium">✨ {t('demandes.ia.titre')}</p>
              <p className="text-xs text-petrol-600">{t('demandes.ia.aide')}</p>
              <input className="input-field !py-1.5 text-sm" placeholder={t('demandes.ia.consignes')} value={consignes} onChange={(e) => setConsignes(e.target.value)} />
              <button type="button" onClick={proposerIA} disabled={chargementIA} className="btn-secondary text-sm w-full">
                {chargementIA ? t('demandes.ia.enCours') : t('demandes.ia.bouton')}
              </button>
              {synthese && <p className="text-xs text-petrol-700 leading-relaxed">{synthese}</p>}
            </div>
          )}

          <div>
            <label className="label">{t('demandes.articles')}</label>
            <div className="space-y-2">
              {lignes.map((l, i) => (
                <div key={i}>
                  <div className="flex gap-2 items-start">
                    <select className="input-field flex-1" value={l.produit_id} onChange={(e) => maj(i, 'produit_id', e.target.value)}>
                      <option value="">{t('produitPlaceholder')}</option>
                      {produits
                        .filter((p) => p.id === l.produit_id || !lignes.some((x, j) => j !== i && x.produit_id === p.id))
                        .map((p) => <option key={p.id} value={p.id}>{p.reference ? `${p.reference} · ` : ''}{p.nom}</option>)}
                    </select>
                    <input type="number" min="1" inputMode="numeric" className="input-field w-20" value={l.quantite} onChange={(e) => maj(i, 'quantite', e.target.value)} />
                    {lignes.length > 1 && (
                      <button type="button" onClick={() => setLignes(lignes.filter((_, j) => j !== i))} className="text-red-600 text-sm px-1">✕</button>
                    )}
                  </div>
                  {l.produit_id && (
                    <p className="text-[11px] text-petrol-500 mt-0.5 ps-1">
                      <span className={depotId && Number(l.quantite) > (stocks[l.produit_id] ?? 0) ? 'text-red-700' : ''}>
                        {t('demandes.dispoMagasin', { n: depotId ? (stocks[l.produit_id] ?? 0) : '—' })}
                      </span>
                      {' · '}{t('demandes.enMain', { n: enMain[l.produit_id] ?? 0 })}
                      {l.raison_ia && <> · ✨ {l.raison_ia}</>}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setLignes([...lignes, { produit_id: '', quantite: 1, raison_ia: '' }])} className="text-sm text-amber-700 mt-2">
              {t('ajouterArticle')}
            </button>
          </div>

          <div>
            <label className="label">{t('demandes.commentaire')}</label>
            <input className="input-field" placeholder={t('demandes.commentairePlaceholder')} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} />
          </div>

          {erreur && <p className="text-sm text-red-600">{erreur}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onFermer} className="btn-secondary flex-1">{t('annuler')}</button>
            <button type="submit" disabled={envoi} className="btn-primary flex-1">{envoi ? t('enregistrement') : t('demandes.envoyer')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Côté magasin : demandes à traiter (gestionnaire de stock, admin, manager)
// ---------------------------------------------------------------------------
export function DemandesSortieATraiter() {
  const { t } = useTranslation('stockcommercial')
  const { profil } = useAuth()
  const [filtre, setFiltre] = useState('en_attente')
  const [demandes, setDemandes] = useState([])
  const [chargement, setChargement] = useState(true)
  const [depots, setDepots] = useState([])
  const [enCours, setEnCours] = useState(null)

  useEffect(() => {
    chargerDepots()
  }, [])

  useEffect(() => {
    charger()
    const canal = supabase
      .channel(`demandes-sortie-${filtre}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'demandes_sortie' }, () => charger())
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [filtre])

  async function chargerDepots() {
    const { data } = await supabase.from('depots').select('id, nom').eq('actif', true).order('nom')
    let liste = data || []
    if (profil?.role === 'gestionnaire_stock') {
      const { data: miens } = await supabase.from('gestionnaire_depots').select('depot_id').eq('profil_id', profil.id)
      const ids = new Set((miens || []).map((m) => m.depot_id))
      if (ids.size) liste = liste.filter((d) => ids.has(d.id))
    }
    setDepots(liste)
  }

  async function charger() {
    setChargement(true)
    let q = supabase.from('demandes_sortie').select(SELECT_DEMANDE)
    q = filtre === 'en_attente'
      ? q.eq('statut', 'en_attente').order('date_souhaitee', { ascending: true })
      : q.neq('statut', 'en_attente').order('created_at', { ascending: false }).limit(40)
    const { data } = await q
    setDemandes(data || [])
    setChargement(false)
  }

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {['en_attente', 'traitees'].map((f) => (
          <button key={f} onClick={() => setFiltre(f)}
            className={`text-xs px-3 py-1 rounded-full border ${filtre === f ? 'bg-amber-500 text-petrol-950 border-amber-500' : 'border-line'}`}>
            {t(`demandes.filtres.${f}`)}
          </button>
        ))}
      </div>

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <div className="space-y-2">
          {demandes.map((d) => (
            <button key={d.id} onClick={() => setEnCours(d)}
              className="w-full text-left border border-line rounded-lg p-3 flex justify-between items-center gap-2 hover:bg-canvas/60">
              <div className="min-w-0">
                <p className="font-medium text-sm">{d.commercial?.nom} {d.proposee_par_ia && <span title={t('demandes.parIA')}>✨</span>}</p>
                <p className="text-xs text-petrol-500">
                  {d.numero} — {t('demandes.pourLe', { date: formatDate(d.date_souhaitee) })} — {d.depots?.nom} — {t('articles', { n: d.demande_sortie_lignes?.length || 0 })}
                </p>
              </div>
              <PastilleStatut statut={d.statut} />
            </button>
          ))}
          {demandes.length === 0 && (
            <p className="text-petrol-400 text-center py-8 text-sm">
              {filtre === 'en_attente' ? t('demandes.aucuneATraiter') : t('demandes.aucune')}
            </p>
          )}
        </div>
      )}

      {enCours && (
        <TraitementDemande demande={enCours} depots={depots}
          onFermer={() => setEnCours(null)}
          onTraitee={() => { setEnCours(null); charger() }} />
      )}
    </div>
  )
}

function TraitementDemande({ demande, depots, onFermer, onTraitee }) {
  const { t, i18n } = useTranslation('stockcommercial')
  const { profil } = useAuth()
  const modifiable = demande.statut === 'en_attente'
  const depotParDefaut = depots.some((d) => d.id === demande.depot_id) ? demande.depot_id : (depots[0]?.id || demande.depot_id)
  const [depotId, setDepotId] = useState(depotParDefaut)
  const [stocks, setStocks] = useState({})
  const [enMain, setEnMain] = useState({})
  const [accordees, setAccordees] = useState({})
  const [motif, setMotif] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')
  const [chargementIA, setChargementIA] = useState(false)
  const [avisIA, setAvisIA] = useState(null) // { synthese, raisons: { ligne_id: raison } }

  async function arbitrerIA() {
    setErreur('')
    setChargementIA(true)
    const { data, error } = await supabase.functions.invoke('arbitrer-demande-sortie', {
      body: { demande_id: demande.id, depot_id: depotId, langue: i18n.language?.slice(0, 2) },
    })
    setChargementIA(false)
    if (error || !data?.lignes) {
      setErreur(await lireErreurFonction(error, data, t('demandes.arbitrage.erreur')))
      return
    }
    setAccordees((prev) => ({ ...prev, ...Object.fromEntries(data.lignes.map((l) => [l.ligne_id, l.quantite_accordee])) }))
    if (data.motif && !motif.trim()) setMotif(data.motif)
    setAvisIA({ synthese: data.synthese, raisons: Object.fromEntries(data.lignes.map((l) => [l.ligne_id, l.raison])) })
  }

  useEffect(() => {
    supabase.from('stock_commercial').select('produit_id, quantite').eq('commercial_id', demande.commercial_id)
      .then(({ data }) => setEnMain(Object.fromEntries((data || []).map((m) => [m.produit_id, m.quantite]))))
  }, [demande.id])

  useEffect(() => {
    if (!depotId) return
    setAvisIA(null)
    supabase.from('stocks').select('produit_id, quantite').eq('depot_id', depotId).then(({ data }) => {
      const s = Object.fromEntries((data || []).map((x) => [x.produit_id, x.quantite]))
      setStocks(s)
      if (modifiable) {
        // Pré-rempli : la quantité demandée, plafonnée au stock du magasin.
        setAccordees(Object.fromEntries(demande.demande_sortie_lignes.map((l) => [l.id, Math.min(l.quantite_demandee, s[l.produit_id] ?? 0)])))
      }
    })
  }, [depotId])

  const lignesValeur = demande.demande_sortie_lignes.map((l) => ({ ligne_id: l.id, quantite_accordee: Math.max(0, Number(accordees[l.id] ?? 0)) }))
  const total = lignesValeur.reduce((s, l) => s + l.quantite_accordee, 0)
  const complet = demande.demande_sortie_lignes.every((l) => Number(accordees[l.id] ?? 0) >= l.quantite_demandee)

  async function traiter(refus) {
    setErreur('')
    if ((refus || !complet) && !motif.trim()) {
      setErreur(refus ? t('demandes.motifRefusObligatoire') : t('demandes.motifPartielObligatoire'))
      return
    }
    setEnvoi(true)
    const { error } = await supabase.rpc('traiter_demande_sortie', {
      p_demande_id: demande.id,
      p_depot_id: depotId,
      p_lignes: refus ? lignesValeur.map((l) => ({ ...l, quantite_accordee: 0 })) : lignesValeur,
      p_motif: motif.trim() || null,
    })
    setEnvoi(false)
    if (error) { setErreur(`${t('erreur')} : ${traduireErreur(error.message)}`); return }
    notifier(demande.id, 'traitement')
    onTraitee()
  }

  return (
    <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
      <div className="card bg-white p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-3">
        <div className="flex justify-between items-start gap-2">
          <div>
            <h2 className="font-semibold text-lg">{demande.numero}</h2>
            <p className="text-xs text-petrol-500">
              👤 {demande.commercial?.nom} — {t('demandes.pourLe', { date: formatDate(demande.date_souhaitee) })}
            </p>
          </div>
          <PastilleStatut statut={demande.statut} />
        </div>

        {demande.commentaire && <p className="text-sm text-petrol-700">💬 {demande.commentaire}</p>}
        {demande.proposee_par_ia && (
          <p className="text-xs text-petrol-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            ✨ {t('demandes.parIA')}{demande.synthese_ia ? ` — ${demande.synthese_ia}` : ''}
          </p>
        )}

        {modifiable && (
          <div>
            <label className="label">{t('depotSource')}</label>
            <select className="input-field" value={depotId} onChange={(e) => setDepotId(e.target.value)}>
              {depots.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
            </select>
          </div>
        )}

        {modifiable && profil?.ia_active !== false && (
          <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 space-y-2">
            <p className="text-xs text-petrol-600">{t('demandes.arbitrage.aide')}</p>
            <button type="button" onClick={arbitrerIA} disabled={chargementIA} className="btn-secondary text-sm w-full">
              {chargementIA ? t('demandes.arbitrage.enCours') : t('demandes.arbitrage.bouton')}
            </button>
            {avisIA?.synthese && <p className="text-xs text-petrol-700">✨ {avisIA.synthese}</p>}
          </div>
        )}

        <table className="w-full text-xs" data-tableau-classique>
          <thead>
            <tr className="text-petrol-500">
              <th className="py-1 text-left font-medium">{t('produit')}</th>
              <th className="py-1 text-right font-medium">{t('demandes.demande')}</th>
              {modifiable && <th className="py-1 text-right font-medium">{t('demandes.dispo')}</th>}
              <th className="py-1 text-right font-medium">{t('demandes.accorde')}</th>
            </tr>
          </thead>
          <tbody>
            {demande.demande_sortie_lignes.map((l) => (
              <tr key={l.id} className="border-t border-line align-top">
                <td className="py-1.5">
                  {l.produits?.nom}
                  <span className="block text-[10px] text-petrol-400">
                    {t('demandes.enMain', { n: enMain[l.produit_id] ?? 0 })}{l.raison_ia ? ` · ✨ ${l.raison_ia}` : ''}
                  </span>
                  {avisIA?.raisons?.[l.id] && (
                    <span className="block text-[10px] text-amber-800">⚖️ {avisIA.raisons[l.id]}</span>
                  )}
                </td>
                <td className="py-1.5 text-right font-mono">{l.quantite_demandee}</td>
                {modifiable && (
                  <td className={`py-1.5 text-right font-mono ${(stocks[l.produit_id] ?? 0) < l.quantite_demandee ? 'text-red-700' : 'text-petrol-500'}`}>
                    {stocks[l.produit_id] ?? 0}
                  </td>
                )}
                <td className="py-1.5 text-right">
                  {modifiable ? (
                    <input type="number" min="0" inputMode="numeric" className="w-16 text-right border border-line rounded px-1 py-0.5"
                      value={accordees[l.id] ?? ''} onChange={(e) => setAccordees({ ...accordees, [l.id]: e.target.value })} />
                  ) : (
                    <span className="font-mono">{l.quantite_accordee ?? '—'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {modifiable ? (
          <>
            <div>
              <label className="label">{t('demandes.motif')}{!complet ? ' *' : ''}</label>
              <input className="input-field" placeholder={t('demandes.motifPlaceholder')} value={motif} onChange={(e) => setMotif(e.target.value)} />
            </div>
            <p className="text-[11px] text-petrol-500">{t('demandes.aideTraitement')}</p>
            {erreur && <p className="text-sm text-red-600">{erreur}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={onFermer} className="btn-secondary flex-1">{t('annuler')}</button>
              <button type="button" disabled={envoi} onClick={() => traiter(true)} className="btn-secondary flex-1 !text-red-700">{t('demandes.refuser')}</button>
              <button type="button" disabled={envoi || total === 0} onClick={() => traiter(false)} className="btn-primary flex-1">
                {envoi ? t('enregistrement') : complet ? t('demandes.accorder') : t('demandes.accorderPartiel')}
              </button>
            </div>
          </>
        ) : (
          <>
            {demande.motif_traitement && <p className="text-xs text-petrol-700">📌 {t('demandes.motif')} : {demande.motif_traitement}</p>}
            {demande.traite_le && (
              <p className="text-[11px] text-petrol-400">{t('demandes.traitePar', { nom: demande.traitant?.nom || '—', date: formatDate(demande.traite_le) })}</p>
            )}
            <button type="button" onClick={onFermer} className="btn-secondary w-full">{t('demandes.fermer')}</button>
          </>
        )}
      </div>
    </div>
  )
}
