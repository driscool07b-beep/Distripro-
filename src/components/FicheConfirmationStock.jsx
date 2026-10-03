import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { traduireErreur } from '../lib/erreurs'
import { envoyerFichierJustificatif } from '../lib/justificatifs'
import CartePiece from './CartePiece'

// Fiches de confirmation de l'assistant pour le magasin : réception, sortie
// vers un commercial, transfert, préparation et livraison de commande.
// Rien n'est enregistré avant « Valider » ; mêmes fonctions et contrôles que
// les écrans Stock, Stock des commerciaux et Commandes.

const TITRES = {
  reception: '📥', sortie: '🚚', transfert: '🔁', commande_preparer: '📦', commande_livrer: '✅',
}

export default function FicheConfirmationStock({ action, onTermine, onNavigation }) {
  const { t } = useTranslation('assistant')
  const { profil, entreprise } = useAuth()
  const [lignes, setLignes] = useState(action.lignes || [])
  const [fichier, setFichier] = useState(null)
  const [endommage, setEndommage] = useState(!!action.endommage)
  const [depots, setDepots] = useState([])
  const [depotId, setDepotId] = useState(action.depot?.id || '')
  const [envoi, setEnvoi] = useState(false)
  const [progression, setProgression] = useState('')
  const [erreur, setErreur] = useState('')
  const [etat, setEtat] = useState('a_valider')

  useEffect(() => {
    if (action.type !== 'commande_livrer') return
    supabase.from('depots').select('id, nom').eq('actif', true).order('nom').then(({ data }) => {
      setDepots(data || [])
      if (!depotId && (data || []).length === 1) setDepotId(data[0].id)
    })
  }, [action.type])

  const maj = (i, cle, v) => setLignes(lignes.map((l, j) => (j === i ? { ...l, [cle]: v } : l)))
  const valides = lignes.filter((l) => Number(l.quantite) > 0)

  async function valider() {
    setErreur('')
    setEnvoi(true)
    try {
      if (action.type === 'reception') {
        if (entreprise?.justificatif_stock_obligatoire && !fichier) throw new Error(t('stock.justificatifObligatoire'))
        if (entreprise?.tracabilite_lots_obligatoire && valides.some((l) => !String(l.numero_lot || '').trim())) throw new Error(t('stock.lotObligatoire'))
        let n = 0
        for (const l of valides) {
          setProgression(`${++n} / ${valides.length}`)
          let info = null
          if (fichier) {
            const r = await envoyerFichierJustificatif({ entrepriseId: profil.entreprise_id, fichier })
            if (r.error) throw new Error(r.error)
            info = r.fichierInfo
          }
          const { error } = await supabase.rpc('ajuster_stock_manuel', {
            p_produit_id: l.produit_id, p_type: 'entree', p_quantite: Number(l.quantite),
            p_motif: `Réception${action.fournisseur ? ` — ${action.fournisseur}` : ''} (assistant IA)`,
            p_depot_id: action.depot.id, p_numero_lot: String(l.numero_lot || '').trim() || null, p_date_peremption: l.date_peremption || null,
            p_justificatif_chemin: info?.chemin || null, p_justificatif_nom: info?.nom || null,
            p_justificatif_taille: info?.taille || null, p_justificatif_type: info?.type || null,
            p_etat: endommage ? 'endommage' : 'bon', p_prix_achat: l.prix_achat ? Number(l.prix_achat) : null,
          })
          if (error) throw new Error(`${l.nom} : ${traduireErreur(error.message)}`)
        }
      } else if (action.type === 'sortie') {
        const { error } = await supabase.rpc('creer_sortie_stock', {
          p_commercial_id: action.commercial.id, p_depot_id: action.depot.id,
          p_lignes: valides.map((l) => ({ produit_id: l.produit_id, quantite: Number(l.quantite) })),
        })
        if (error) throw new Error(traduireErreur(error.message))
      } else if (action.type === 'transfert') {
        let n = 0
        for (const l of valides) {
          setProgression(`${++n} / ${valides.length}`)
          const { error } = await supabase.rpc('transferer_stock', {
            p_produit_id: l.produit_id, p_depot_source_id: action.depot.id, p_depot_destination_id: action.destination.id,
            p_quantite: Number(l.quantite), p_motif: action.fournisseur || 'Transfert (assistant IA)',
          })
          if (error) throw new Error(`${l.nom} : ${traduireErreur(error.message)}`)
        }
      } else if (action.type === 'commande_preparer') {
        if (action.commande.statut === 'confirmee') {
          const { error } = await supabase.rpc('changer_statut_commande', { p_commande_id: action.commande.id, p_nouveau_statut: 'en_preparation' })
          if (error) throw new Error(traduireErreur(error.message))
        }
      } else if (action.type === 'commande_livrer') {
        if (depots.length > 1 && !depotId) throw new Error(t('stock.choisirMagasin'))
        const { error } = await supabase.rpc('livrer_commande', {
          p_commande_id: action.commande.id,
          p_lignes_livrees: lignes.map((l) => ({ produit_id: l.produit_id, quantite_livree: Number(l.quantite || 0) })),
          p_montant_supplementaire_paye: 0, p_mode_paiement: action.commande.mode_paiement || 'credit',
          p_depot_id: depotId || null,
        })
        if (error) throw new Error(traduireErreur(error.message))
      }
      setEtat('valide')
      onTermine?.(t(`stock.ok.${action.type}`))
    } catch (e) {
      setErreur(e.message || String(e))
    } finally {
      setEnvoi(false)
      setProgression('')
    }
  }

  if (etat === 'valide') {
    return (
      <div className="space-y-1.5">
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 px-3 py-2 text-sm">✅ {t(`stock.ok.${action.type}`)}</div>
        {action.commande && <CartePiece piece={{ type: 'commande', id: action.commande.id, titre: action.commande.numero, detail: action.commande.client }} onAction={onNavigation} />}
      </div>
    )
  }
  if (etat === 'annule') return <div className="rounded-xl border border-line bg-canvas text-petrol-500 px-3 py-2 text-sm">✖ {t('fiche.annulee')}</div>

  const estCommande = action.type.startsWith('commande_')
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50/60 p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{TITRES[action.type]} {t(`stock.titres.${action.type}`)}</p>
        <span className="text-[10px] uppercase tracking-wide text-amber-700">{t('fiche.nonEnregistree')}</span>
      </div>
      <p className="text-xs text-petrol-700">
        {estCommande
          ? `${action.commande.numero} · ${action.commande.client || ''}`
          : <>🏬 {action.depot.nom}{action.destination && <> → 🏬 {action.destination.nom}</>}{action.commercial && <> → 👤 {action.commercial.nom}</>}{action.fournisseur && action.type === 'reception' && <> · {action.fournisseur}</>}</>}
      </p>
      {(action.alertes || []).length > 0 && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{action.alertes.map((a, i) => <p key={i}>⚠️ {a}</p>)}</div>
      )}

      {action.type !== 'commande_preparer' ? (
        <div className="space-y-1">
          {lignes.map((l, i) => (
            <div key={`${l.produit_id}-${i}`} className="bg-white rounded-lg border border-line px-2 py-1.5 space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate">{l.reference ? <span className="font-mono text-[11px] text-petrol-500">{l.reference} </span> : null}{l.nom}</span>
                {estCommande && <span className="text-[11px] text-petrol-500">{t('stock.commande')} {l.commande}</span>}
                {!estCommande && action.type !== 'reception' && <span className={`text-[11px] ${Number(l.quantite) > l.stock ? 'text-red-700' : 'text-petrol-500'}`}>{t('stock.dispo')} {l.stock}</span>}
                <input type="number" min="0" inputMode="numeric" className="w-16 text-right border border-line rounded px-1 py-0.5"
                  value={l.quantite} onChange={(e) => maj(i, 'quantite', e.target.value)} />
                {!estCommande && <button type="button" className="text-red-600 text-xs px-1" onClick={() => setLignes(lignes.filter((_, j) => j !== i))}>✕</button>}
              </div>
              {action.type === 'reception' && (
                <div className="grid grid-cols-3 gap-1">
                  <input className="border border-line rounded px-1.5 py-0.5 text-xs" placeholder={t('stock.lot')} value={l.numero_lot || ''} onChange={(e) => maj(i, 'numero_lot', e.target.value)} />
                  <input type="date" className="border border-line rounded px-1.5 py-0.5 text-xs" title={t('stock.peremption')} value={l.date_peremption || ''} onChange={(e) => maj(i, 'date_peremption', e.target.value)} />
                  <input type="number" min="0" className="border border-line rounded px-1.5 py-0.5 text-xs" placeholder={t('stock.prixAchat')} value={l.prix_achat || ''} onChange={(e) => maj(i, 'prix_achat', e.target.value)} />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-petrol-600">{t('stock.aPreparer')} : {lignes.map((l) => `${l.nom} × ${l.commande}`).join(' · ')}</p>
      )}

      {action.type === 'reception' && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={endommage} onChange={(e) => setEndommage(e.target.checked)} /> {t('stock.endommage')}</label>
          <label className="block text-xs">
            📎 {t('stock.justificatif')}{entreprise?.justificatif_stock_obligatoire ? ' *' : ''}
            <input type="file" accept="image/*,application/pdf" capture="environment" className="block mt-1 text-xs" onChange={(e) => setFichier(e.target.files?.[0] || null)} />
          </label>
        </div>
      )}
      {action.type === 'commande_livrer' && depots.length > 1 && (
        <select className="input-field !py-1.5 text-sm" value={depotId} onChange={(e) => setDepotId(e.target.value)}>
          <option value="">{t('fiche.magasin')}</option>
          {depots.map((d) => <option key={d.id} value={d.id}>🏬 {d.nom}</option>)}
        </select>
      )}
      {action.type === 'commande_livrer' && <p className="text-[11px] text-petrol-500">{t('stock.aideLivraison')}</p>}

      {erreur && <p className="text-xs text-red-600">{erreur}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1 text-sm" disabled={envoi} onClick={() => { setEtat('annule'); onTermine?.(null) }}>{t('fiche.annuler')}</button>
        <button type="button" className="btn-primary flex-1 text-sm" disabled={envoi || (action.type !== 'commande_preparer' && !valides.length && action.type !== 'commande_livrer')} onClick={valider}>
          {envoi ? (progression || '…') : `✓ ${t('fiche.valider')}`}
        </button>
      </div>
    </div>
  )
}
