import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import jsPDF from 'jspdf'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatXOF, formatDate, formatDateHeure } from '../lib/format'
import { traduireErreur } from '../lib/erreurs'

// « Mon abonnement » : formule, échéance, quota de commerciaux, porte-monnaie
// d'unités IA (solde, consommation), paiements. Direction et comptable.
export default function MonAbonnement() {
  const { t } = useTranslation('abonnement')
  const { profil, entreprise, rechargerProfil } = useAuth()
  const [d, setD] = useState(null)
  const [packs, setPacks] = useState([])
  const [erreur, setErreur] = useState('')
  const [cycle, setCycle] = useState('mensuel')
  const [envoi, setEnvoi] = useState('')
  const [retour, setRetour] = useState(null) // résultat après paiement
  const [parametres, setParametres] = useSearchParams()
  const peutPayer = ['admin', 'comptable'].includes(profil?.role)

  const [places, setPlaces] = useState(null)
  const [nbPlaces, setNbPlaces] = useState(1)
  const charger = () => {
    supabase.rpc('mes_places').then(({ data }) => setPlaces(data || null))
    supabase.rpc('mon_abonnement').then(({ data, error }) => (error ? setErreur(traduireErreur(error.message)) : setD(data)))
    supabase.from('ia_packs').select('*').eq('actif', true).order('ordre').then(({ data }) => setPacks(data || []))
  }
  useEffect(() => { charger() }, [])

  // Retour du client après paiement (?paiement=…) : confirmation auprès de
  // CinetPay ; quelques nouvelles tentatives si le paiement est encore en cours.
  useEffect(() => {
    const transaction = parametres.get('paiement')
    if (!transaction) return
    let essais = 0
    let arret = false
    const verifier = async () => {
      const { data } = await supabase.functions.invoke('paiement-cinetpay', { body: { action: 'verifier', transaction_id: transaction } })
      if (arret) return
      const statut = data?.statut || 'en_attente'
      setRetour({ statut, objet: data?.objet })
      if (statut === 'reussi') { charger(); rechargerProfil?.() }
      if (statut === 'en_attente' && essais++ < 12) setTimeout(verifier, 5000)
    }
    verifier()
    return () => { arret = true }
  }, [parametres])

  async function payer(corps) {
    setErreur('')
    setEnvoi(JSON.stringify(corps))
    const { data, error } = await supabase.functions.invoke('paiement-cinetpay', { body: { action: 'initier', ...corps } })
    if (error || !data?.lien) {
      let message = error?.message || t('paiementImpossible')
      try { message = (await error?.context?.json())?.error || message } catch { /* ignore */ }
      setErreur(message)
      setEnvoi('')
      return
    }
    window.location.href = data.lien // page de paiement sécurisée CinetPay
  }

  // Reçu de paiement d'abonnement (émis par DistribPro).
  function recu(p) {
    const doc = new jsPDF()
    doc.setFontSize(18); doc.text('DistribPro', 14, 20)
    doc.setFontSize(9); doc.setTextColor(110); doc.text('Gestion commerciale & distribution · distribpro.com · contact@distribpro.com', 14, 26)
    doc.setTextColor(0); doc.setFontSize(14); doc.text(t('recu.titre'), 14, 42)
    doc.setFontSize(10)
    const lignes = [
      [t('recu.client'), entreprise?.nom || ''],
      [t('recu.date'), formatDate(p.created_at)],
      [t('recu.objet'), `${t('formule')} ${p.plan_code} — ${t(`cycles.${p.cycle}`)}`],
      [t('recu.periode'), p.periode_debut ? `${formatDate(p.periode_debut)} → ${formatDate(p.periode_fin)}` : '—'],
      [t('recu.moyen'), p.moyen_paiement || '—'],
      [t('recu.montant'), formatXOF(p.montant)],
    ]
    lignes.forEach(([a, b], i) => { doc.text(`${a} :`, 14, 54 + i * 8); doc.text(String(b), 70, 54 + i * 8) })
    doc.setFontSize(8); doc.setTextColor(120); doc.text(t('recu.mention'), 14, 112)
    doc.save(`recu-abonnement-${formatDate(p.created_at).replace(/\//g, '-')}.pdf`)
  }

  if (erreur) return <div className="p-6 text-sm text-red-600">{erreur}</div>
  if (!d) return <div className="p-6 text-sm text-petrol-500">{t('chargement')}</div>

  const formule = d.formule || {}
  const aujourdhui = new Date().toISOString().slice(0, 10)
  const essaiExpire = d.statut === 'essai' && d.date_fin_essai && d.date_fin_essai < aujourdhui
  const soldeBas = Number(d.solde_ia) < Number(d.seuil_alerte_ia || 0)
  const quotaDepasse = formule.max_commerciaux != null && Number(d.nb_commerciaux) > Number(formule.max_commerciaux)
  const nb = (n) => Math.round(Number(n || 0)).toLocaleString('fr-FR')

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">💳 {t('titre')}</h1>
        <p className="text-sm text-petrol-500">{t('sousTitre')}</p>
      </div>

      {retour && (
        <div className={`rounded-xl border px-3 py-2 text-sm flex items-start justify-between gap-2 ${retour.statut === 'reussi' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : retour.statut === 'en_attente' ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-red-300 bg-red-50 text-red-700'}`}>
          <span>{t(`retour.${['reussi', 'en_attente'].includes(retour.statut) ? retour.statut : 'echoue'}`, { objet: t(`objets.${retour.objet || 'abonnement'}`) })}</span>
          <button className="text-xs opacity-60" onClick={() => { setRetour(null); parametres.delete('paiement'); setParametres(parametres) }}>✕</button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <div className={`card p-4 space-y-1 ${essaiExpire || d.statut === 'suspendu' ? 'border-amber-300 bg-amber-50/60' : ''}`}>
          <p className="text-[11px] uppercase tracking-wide text-petrol-500">{t('formule')}</p>
          <p className="text-2xl font-bold">{formule.nom || d.plan}</p>
          <p className="text-sm">{t(`statuts.${d.statut}`)}{d.cycle ? ` · ${t(`cycles.${d.cycle}`)}` : ''}</p>
          {d.statut === 'essai' && d.date_fin_essai && <p className={`text-sm ${essaiExpire ? 'text-red-700 font-medium' : 'text-petrol-600'}`}>{t(essaiExpire ? 'essaiTermine' : 'finEssai', { date: formatDate(d.date_fin_essai) })}</p>}
          {d.statut === 'actif' && d.date_prochaine_echeance && <p className="text-sm text-petrol-600">{t('echeance', { date: formatDate(d.date_prochaine_echeance) })}</p>}
          <p className={`text-sm ${quotaDepasse ? 'text-red-700 font-medium' : 'text-petrol-600'}`}>{t('commerciaux', { n: d.nb_commerciaux, max: formule.max_commerciaux ?? '∞' })}</p>
          {quotaDepasse && <p className="text-xs text-red-700">{t('quotaDepasse')}</p>}
        </div>
        <div className={`card p-4 space-y-1 ${soldeBas ? 'border-amber-300 bg-amber-50/60' : ''}`}>
          <p className="text-[11px] uppercase tracking-wide text-petrol-500">✨ {t('unitesIa')}</p>
          <p className={`text-2xl font-bold ${Number(d.solde_ia) <= 0 ? 'text-red-700' : ''}`}>{nb(d.solde_ia)}</p>
          <p className="text-xs text-petrol-500">{t('uniteValeur')}</p>
          {Number(d.solde_ia) <= 0 ? <p className="text-sm text-red-700 font-medium">{t('iaBloquee')}</p> : soldeBas && <p className="text-sm text-amber-800">{t('soldeBas')}</p>}
          {(d.conso_ia_30j || []).length > 0 && (
            <p className="text-xs text-petrol-600">{t('conso30j')} : {d.conso_ia_30j.map((c) => `${t(`fonctions.${c.fonction}`, { defaultValue: c.fonction })} ${nb(c.unites)}`).join(' · ')}</p>
          )}
        </div>
      </div>

      {places && (
        <div className="card p-4 text-sm space-y-3">
          <div>
            <h2 className="font-semibold">👥 {t('places.titre')}</h2>
            <p className="text-xs text-petrol-500">{places.inclus_par_role == null ? t('places.illimite') : t('places.aide', { n: places.inclus_par_role, prix: formatXOF(places.prix_place) })}</p>
          </div>
          {places.inclus_par_role != null && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {['admin', 'manager', 'comptable', 'gestionnaire_stock', 'agent_recouvrement'].map((r) => {
                  const n = Number(places.roles?.[r] || 0)
                  const depasse = n > places.inclus_par_role
                  return (
                    <div key={r} className={`rounded-lg border px-3 py-2 ${depasse ? 'border-amber-300 bg-amber-50' : 'border-line bg-white'}`}>
                      <p className="text-[11px] text-petrol-500">{t(`places.roles.${r}`)}</p>
                      <p className="font-semibold">{n} / {places.inclus_par_role}</p>
                    </div>
                  )
                })}
              </div>
              <p className="text-sm">
                {t('places.achetees', { n: places.places_achetees })} · {t('places.utilisees', { n: places.depassement })}
                {places.depassement > places.places_achetees && <span className="text-red-700"> · {t('places.manque', { n: places.depassement - places.places_achetees })}</span>}
              </p>
              {places.essai ? (
                <p className="text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded px-2 py-1">{t('places.essai', { n: places.depassement })}</p>
              ) : places.prorata_une_place?.possible && peutPayer ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input type="number" min="1" max="50" className="input-field !py-1.5 text-sm w-20" value={nbPlaces} onChange={(e) => setNbPlaces(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
                  <button className="btn-primary text-xs" disabled={!!envoi} onClick={() => payer({ objet: 'places', places: nbPlaces })}>
                    {envoi === JSON.stringify({ objet: 'places', places: nbPlaces }) ? '…' : t('places.ajouter')}
                  </button>
                  <span className="text-xs text-petrol-500">{t('places.prorata', { montant: formatXOF(Math.max(Number(places.prorata_une_place.montant) * nbPlaces, 100)), jours: places.prorata_une_place.jours })}</span>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      <div className="card p-4 text-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{t('payerTitre')}</h2>
          <div className="flex rounded-full border border-line overflow-hidden text-xs">
            {['mensuel', 'annuel'].map((c) => (
              <button key={c} onClick={() => setCycle(c)} className={`px-3 py-1 ${cycle === c ? 'bg-petrol-800 text-white' : 'bg-white'}`}>{t(`cycleCourt.${c}`)}</button>
            ))}
          </div>
        </div>
        <p className="text-petrol-600 text-xs">{t('payerTexte')}</p>
        <div className="grid sm:grid-cols-3 gap-2">
          {(d.formules || []).map((f) => (
            <div key={f.code} className={`rounded-xl border p-3 flex flex-col ${f.code === d.plan ? 'border-amber-400 bg-amber-50/50' : 'border-line bg-white'}`}>
              <p className="font-semibold">{f.nom}{f.code === d.plan && <span className="ms-1 text-[10px] text-amber-700">({t('actuelle')})</span>}</p>
              <p className="text-lg font-bold">{formatXOF(cycle === 'annuel' ? f.prix_annuel : f.prix_mensuel)}<span className="text-xs font-normal text-petrol-500"> / {t(cycle === 'annuel' ? 'an' : 'mois')}</span></p>
              {cycle === 'mensuel' && <p className="text-xs text-petrol-500">{t('ouAnnuel', { prix: formatXOF(f.prix_annuel) })}</p>}
              {places && Math.max(places.places_achetees || 0, places.depassement || 0) > 0 && f.code === d.plan && (
                <p className="text-xs text-amber-800">{t('places.plusPlaces', { n: Math.max(places.places_achetees || 0, places.depassement || 0), prix: formatXOF((f.prix_place_supp || places.prix_place) * (cycle === 'annuel' ? 12 * 0.8 : 1)) })}</p>
              )}
              <p className="text-xs text-petrol-600 mt-1 flex-1">{t('jusquA', { n: f.max_commerciaux ?? '∞' })}</p>
              {peutPayer && (
                <button className="btn-primary text-xs mt-2" disabled={!!envoi} onClick={() => payer({ objet: 'abonnement', plan: f.code, cycle })}>
                  {envoi === JSON.stringify({ objet: 'abonnement', plan: f.code, cycle }) ? '…' : t(f.code === d.plan ? 'renouveler' : 'choisir')}
                </button>
              )}
            </div>
          ))}
        </div>
        <div>
          <h3 className="font-semibold text-sm mb-1.5">✨ {t('packsTitre')}</h3>
          <div className="grid sm:grid-cols-3 gap-2">
            {packs.map((p) => (
              <div key={p.code} className="rounded-xl border border-line bg-white p-3 flex flex-col">
                <p className="font-semibold">{p.nom}</p>
                <p className="text-lg font-bold">{nb(p.unites)} <span className="text-xs font-normal text-petrol-500">{t('unites')}</span></p>
                <p className="text-xs text-petrol-600 flex-1">{formatXOF(p.prix)}{p.prix < p.unites && <span className="text-emerald-700"> · {t('bonus', { n: nb(p.unites - p.prix) })}</span>}</p>
                {peutPayer && (
                  <button className="btn-secondary text-xs mt-2" disabled={!!envoi} onClick={() => payer({ objet: 'unites', pack: p.code })}>
                    {envoi === JSON.stringify({ objet: 'unites', pack: p.code }) ? '…' : t('acheter')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        {!peutPayer && <p className="text-xs text-petrol-500">{t('reservePaiement')}</p>}
        <p className="text-xs text-petrol-500">🔒 {t('securite')}</p>
      </div>

      <div className="card p-4">
        <h2 className="font-semibold text-sm mb-2">{t('mouvementsIa')}</h2>
        <div className="text-xs space-y-0.5">
          {(d.mouvements_ia || []).length === 0 ? <p className="text-petrol-400">—</p> : d.mouvements_ia.map((m, i) => (
            <p key={i} className="flex justify-between gap-2 border-b border-line py-1">
              <span>{formatDateHeure(m.created_at)} · {t(`types.${m.type}`, { defaultValue: m.type })}{m.fonction ? ` (${t(`fonctions.${m.fonction}`, { defaultValue: m.fonction })})` : ''}{m.motif ? ` — ${m.motif}` : ''}</span>
              <span className={`font-mono ${Number(m.unites) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{Number(m.unites) > 0 ? '+' : ''}{nb(m.unites)}</span>
            </p>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <h2 className="font-semibold text-sm mb-2">{t('paiements')}</h2>
        <div className="text-xs space-y-0.5">
          {(d.paiements || []).length === 0 ? <p className="text-petrol-400">{t('aucunPaiement')}</p> : d.paiements.map((p, i) => (
            <p key={i} className="flex justify-between gap-2 border-b border-line py-1">
              <span>{formatDate(p.created_at)} · {p.plan_code} · {t(`cycles.${p.cycle}`)}{p.periode_fin ? ` · ${formatDate(p.periode_debut)} → ${formatDate(p.periode_fin)}` : ''}</span>
              <span className="flex items-center gap-2">
                <span className="font-mono">{formatXOF(p.montant)}</span>
                {p.statut === 'reussi' && <button className="underline text-petrol-700" onClick={() => recu(p)}>{t('recu.bouton')}</button>}
              </span>
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}
