import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatXOF } from '../lib/format'
import { traduireErreur } from '../lib/erreurs'
import CartePiece from './CartePiece'

// Fiche de confirmation d'une vente ou d'une commande PRÉPARÉE par l'assistant.
// Rien n'est enregistré tant que l'utilisateur n'a pas appuyé sur « Valider » ;
// l'enregistrement passe par les mêmes fonctions et contrôles que les formulaires.
export default function FicheConfirmationAction({ action, onTermine, fneActive, onNavigation }) {
  const { t } = useTranslation('assistant')
  const { profil, entreprise } = useAuth()
  const estCommercial = profil?.role === 'commercial'
  const [lignes, setLignes] = useState(action.lignes || [])
  const [paiement, setPaiement] = useState(action.paiement || 'comptant')
  const [modeReglement, setModeReglement] = useState(action.mode_reglement || 'espece')
  const [montantPaye, setMontantPaye] = useState(action.montant_paye ? String(action.montant_paye) : '')
  const [dateLivraison, setDateLivraison] = useState(action.date_livraison || '')
  const [depots, setDepots] = useState([])
  const [depotId, setDepotId] = useState('')
  const [totaux, setTotaux] = useState(null)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')
  const [etat, setEtat] = useState('a_valider') // a_valider | valide | annule
  const [pieceCreee, setPieceCreee] = useState(null)
  // Remise dictée (ventes) : en pourcentage du total HT des articles, comme le formulaire de vente.
  const [remisePct, setRemisePct] = useState(action.remise_pourcentage ? String(action.remise_pourcentage) : '')
  const [motifRemise, setMotifRemise] = useState(action.motif_remise || '')
  const seuilRemise = Number(entreprise?.seuil_remise_pourcentage ?? 15)
  const peutDepasserSeuil = ['admin', 'manager'].includes(profil?.role)

  const lignesValides = useMemo(() => lignes.filter((l) => Number(l.quantite) > 0), [lignes])
  const sousTotal = lignesValides.reduce((s, l) => s + Number(l.quantite) * Number(l.prix_unitaire), 0)
  const remisePctEffectif = action.type === 'vente' ? Math.min(Math.max(Number(remisePct || 0), 0), 100) : 0
  const remiseMontant = Math.round(sousTotal * (remisePctEffectif / 100))
  const remiseHorsSeuil = remisePctEffectif > seuilRemise && !peutDepasserSeuil

  // Vente hors commercial : choisir le magasin d'où part la marchandise.
  useEffect(() => {
    if (action.type !== 'vente' || estCommercial) return
    supabase.from('depots').select('id, nom').order('nom').then(({ data }) => {
      setDepots(data || [])
      if ((data || []).length === 1) setDepotId(data[0].id)
    })
  }, [action.type, estCommercial])

  // Totaux exacts (TVA, autres taxes) calculés par le serveur.
  useEffect(() => {
    if (!lignesValides.length) { setTotaux(null); return }
    const minuterie = setTimeout(async () => {
      const { data } = await supabase.rpc('calculer_totaux_vente', {
        p_lignes: lignesValides.map((l) => ({ produit_id: l.produit_id, quantite: Number(l.quantite), prix_unitaire: Number(l.prix_unitaire) })),
        p_remise_montant: remiseMontant,
      })
      setTotaux(data || null)
    }, 250)
    return () => clearTimeout(minuterie)
  }, [lignesValides, remiseMontant])

  const total = totaux ? Number(totaux.total) : sousTotal - remiseMontant

  async function valider() {
    setErreur('')
    if (!lignesValides.length) { setErreur(t('fiche.aucunArticle')); return }
    if (action.type === 'vente' && !estCommercial && !depotId) { setErreur(t('fiche.choisirMagasin')); return }
    const p = paiement === 'comptant' ? total : paiement === 'credit' ? 0 : Math.min(Number(montantPaye || 0), total)
    if (paiement === 'partiel' && !(p > 0)) { setErreur(t('fiche.montantPartiel')); return }
    if (remiseHorsSeuil) { setErreur(t('fiche.remiseHorsSeuil', { pct: remisePctEffectif, seuil: seuilRemise })); return }
    if (remiseMontant > 0 && !motifRemise.trim()) { setErreur(t('fiche.motifRemiseRequis')); return }
    setEnvoi(true)
    const lignesEnvoi = lignesValides.map((l) => ({ produit_id: l.produit_id, quantite: Number(l.quantite), prix_unitaire: Number(l.prix_unitaire) }))
    const { data: idCree, error } = action.type === 'vente'
      ? await supabase.rpc('creer_vente', {
          p_client_id: action.client.id,
          p_lignes: lignesEnvoi,
          p_mode_paiement: p < total ? 'credit' : 'cash',
          p_montant_paye: p,
          p_mode_reglement: modeReglement,
          p_date_echeance: null,
          p_commercial_id: estCommercial ? profil.id : null,
          p_remise_montant: remiseMontant,
          p_motif_remise: remiseMontant > 0 ? motifRemise.trim() : null,
          p_depot_id: estCommercial ? null : depotId,
          p_credit_utilise: 0,
          p_source_stock: estCommercial ? null : 'depot',
        })
      : await supabase.rpc('creer_commande', {
          p_client_id: action.client.id,
          p_lignes: lignesEnvoi,
          p_commercial_id: estCommercial ? profil.id : null,
          p_depot_id: null,
          // Valeurs acceptées par creer_commande : 'cash' ou 'credit' (acompte éventuel à part).
          p_mode_paiement: 'credit',
          p_montant_paye: Number(montantPaye || 0) > 0 ? Number(montantPaye) : null,
          p_date_livraison_souhaitee: dateLivraison || null,
          p_notes: action.note || t('fiche.noteAssistant'),
          p_latitude: null,
          p_longitude: null,
        })
    setEnvoi(false)
    if (error) { setErreur(traduireErreur(error.message)); return }
    setEtat('valide')
    setPieceCreee(idCree ? { type: action.type, id: idCree, titre: action.client.nom, detail: formatXOF(total) } : null)
    onTermine?.(t(action.type === 'vente' ? 'fiche.venteEnregistree' : 'fiche.commandeEnregistree', { client: action.client.nom, total: formatXOF(total) }))
  }

  if (etat === 'valide' && pieceCreee) {
    return (
      <div className="space-y-1.5">
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 px-3 py-2 text-sm">
          ✅ {t(action.type === 'vente' ? 'fiche.venteEnregistreeCourt' : 'fiche.commandeEnregistreeCourt')} — {t('pieces.etMaintenant')}
        </div>
        <CartePiece piece={pieceCreee} fneActive={fneActive} onAction={onNavigation} />
      </div>
    )
  }

  if (etat !== 'a_valider') {
    return (
      <div className={`rounded-xl border px-3 py-2 text-sm ${etat === 'valide' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-line bg-canvas text-petrol-500'}`}>
        {etat === 'valide' ? `✅ ${t(action.type === 'vente' ? 'fiche.venteEnregistreeCourt' : 'fiche.commandeEnregistreeCourt')}` : `✖ ${t('fiche.annulee')}`}
      </div>
    )
  }

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50/60 p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{action.type === 'vente' ? `🧾 ${t('fiche.venteAValider')}` : `📦 ${t('fiche.commandeAValider')}`}</p>
        <span className="text-[10px] uppercase tracking-wide text-amber-700">{t('fiche.nonEnregistree')}</span>
      </div>
      <p><span className="text-petrol-500">{t('fiche.client')} :</span> <strong>{action.client.nom}</strong></p>

      <div className="space-y-1">
        {lignes.map((l, i) => (
          <div key={`${l.produit_id}-${i}`} className="flex items-center gap-2 bg-white rounded-lg border border-line px-2 py-1.5">
            <span className="flex-1 min-w-0 truncate">{l.nom}</span>
            <input type="number" min="0" inputMode="numeric" className="w-16 text-right border border-line rounded px-1 py-0.5"
              value={l.quantite} onChange={(e) => setLignes(lignes.map((x, j) => (j === i ? { ...x, quantite: e.target.value } : x)))} />
            <span className="w-24 text-right font-mono text-xs">{formatXOF(Number(l.quantite || 0) * Number(l.prix_unitaire))}</span>
            <button type="button" className="text-red-600 text-xs px-1" title={t('fiche.retirer')} onClick={() => setLignes(lignes.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>

      {action.type === 'vente' && (
        <div className="grid grid-cols-3 gap-2 items-center">
          <label className="text-xs text-petrol-600 col-span-1">{t('fiche.remise')}
            <input type="number" min="0" max="100" step="0.5" inputMode="decimal" className="input-field !py-1.5 text-sm mt-0.5"
              placeholder="0" value={remisePct} onChange={(e) => setRemisePct(e.target.value)} />
          </label>
          {remiseMontant > 0 ? (
            <label className="text-xs text-petrol-600 col-span-2">{t('fiche.motifRemise')}
              <input type="text" className="input-field !py-1.5 text-sm mt-0.5" value={motifRemise} onChange={(e) => setMotifRemise(e.target.value)} />
            </label>
          ) : <span className="col-span-2" />}
          {remiseMontant > 0 && (
            <p className="col-span-3 text-xs text-blue-700 text-right">{t('fiche.remiseAppliquee', { pct: remisePctEffectif, montant: formatXOF(remiseMontant) })}</p>
          )}
          {remiseHorsSeuil && (
            <p className="col-span-3 text-xs text-amber-800 bg-amber-100 border border-amber-300 rounded px-2 py-1">{t('fiche.remiseHorsSeuil', { pct: remisePctEffectif, seuil: seuilRemise })}</p>
          )}
        </div>
      )}

      {totaux && Number(totaux.total) !== Number(totaux.ht) && (
        <p className="text-xs text-petrol-500 text-right">{t('fiche.ht')} {formatXOF(totaux.ht)} · {t('fiche.taxes')} {formatXOF(Number(totaux.total) - Number(totaux.ht))}</p>
      )}
      <p className="text-right text-base"><span className="text-petrol-500 text-sm">{t('fiche.total')} :</span> <strong className="font-mono">{formatXOF(total)}</strong></p>

      {action.type === 'vente' ? (
        <div className="grid grid-cols-2 gap-2">
          <select className="input-field !py-1.5 text-sm" value={paiement} onChange={(e) => setPaiement(e.target.value)}>
            <option value="comptant">{t('fiche.comptant')}</option>
            <option value="partiel">{t('fiche.partiel')}</option>
            <option value="credit">{t('fiche.credit')}</option>
          </select>
          <select className="input-field !py-1.5 text-sm" value={modeReglement} onChange={(e) => setModeReglement(e.target.value)} disabled={paiement === 'credit'}>
            {['espece', 'mobile_money', 'cheque', 'virement'].map((m) => <option key={m} value={m}>{t(`fiche.modes.${m}`)}</option>)}
          </select>
          {paiement === 'partiel' && (
            <input type="number" min="0" className="input-field !py-1.5 text-sm col-span-2" placeholder={t('fiche.montantPaye')} value={montantPaye} onChange={(e) => setMontantPaye(e.target.value)} />
          )}
          {!estCommercial && (
            <select className="input-field !py-1.5 text-sm col-span-2" value={depotId} onChange={(e) => setDepotId(e.target.value)}>
              <option value="">{t('fiche.magasin')}</option>
              {depots.map((d) => <option key={d.id} value={d.id}>🏬 {d.nom}</option>)}
            </select>
          )}
          {estCommercial && <p className="col-span-2 text-xs text-petrol-500">🚚 {t('fiche.stockTerrain')}</p>}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-petrol-600">{t('fiche.livraison')}
            <input type="date" className="input-field !py-1.5 text-sm mt-0.5" value={dateLivraison} onChange={(e) => setDateLivraison(e.target.value)} />
          </label>
          <label className="text-xs text-petrol-600">{t('fiche.acompte')}
            <input type="number" min="0" className="input-field !py-1.5 text-sm mt-0.5" value={montantPaye} onChange={(e) => setMontantPaye(e.target.value)} />
          </label>
        </div>
      )}

      {erreur && <p className="text-xs text-red-600">{erreur}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1 text-sm" disabled={envoi} onClick={() => { setEtat('annule'); onTermine?.(null) }}>{t('fiche.annuler')}</button>
        <button type="button" className="btn-primary flex-1 text-sm" disabled={envoi || !lignesValides.length} onClick={valider}>
          {envoi ? '…' : `✓ ${t('fiche.valider')}`}
        </button>
      </div>
    </div>
  )
}
