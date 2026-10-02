import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { formatXOF, formatDate, formatDateHeure } from '../lib/format'
import { traduireErreur } from '../lib/erreurs'

// « Mon abonnement » : formule, échéance, quota de commerciaux, porte-monnaie
// d'unités IA (solde, consommation), paiements. Direction et comptable.
export default function MonAbonnement() {
  const { t } = useTranslation('abonnement')
  const [d, setD] = useState(null)
  const [erreur, setErreur] = useState('')
  useEffect(() => {
    supabase.rpc('mon_abonnement').then(({ data, error }) => (error ? setErreur(traduireErreur(error.message)) : setD(data)))
  }, [])

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

      <div className="card p-4 text-sm space-y-2">
        <h2 className="font-semibold">{t('payerTitre')}</h2>
        <p className="text-petrol-600">{t('payerTexte')}</p>
        <div className="grid sm:grid-cols-3 gap-2">
          {(d.formules || []).map((f) => (
            <div key={f.code} className={`rounded-xl border p-3 ${f.code === d.plan ? 'border-amber-400 bg-amber-50/50' : 'border-line bg-white'}`}>
              <p className="font-semibold">{f.nom}</p>
              <p className="text-lg font-bold">{formatXOF(f.prix_mensuel)}<span className="text-xs font-normal text-petrol-500"> / {t('mois')}</span></p>
              <p className="text-xs text-petrol-500">{t('ouAnnuel', { prix: formatXOF(f.prix_annuel) })}</p>
              <p className="text-xs text-petrol-600 mt-1">{t('jusquA', { n: f.max_commerciaux ?? '∞' })}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-petrol-500">{t('contact')}</p>
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
              <span className="font-mono">{formatXOF(p.montant)}</span>
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}
