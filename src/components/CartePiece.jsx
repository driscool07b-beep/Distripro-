import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatDate } from '../lib/format'

const ICONES = { vente: '🧾', commande: '📦', encaissement: '💵', reconciliation: '⚖️', client: '👤', produit: '🏷️', versement: '🏦', reglement_groupe: '🏢' }

// Actions possibles selon le type de pièce : chaque bouton ouvre la page de la
// pièce, qui exécute l'action (mêmes fonctions que les boutons de la page).
function actions(piece, fneActive) {
  const venteId = piece.type === 'encaissement' ? piece.cible_id : piece.id
  switch (piece.type) {
    case 'vente':
    case 'encaissement':
      return [
        ['ouvrir', `/ventes?vente=${venteId}`], ['pdf', `/ventes?vente=${venteId}&action=pdf`],
        ['imprimer', `/ventes?vente=${venteId}&action=imprimer`], ['bl', `/ventes?vente=${venteId}&action=bl`],
        ['whatsapp', `/ventes?vente=${venteId}&action=whatsapp`], ['email', `/ventes?vente=${venteId}&action=email`],
        ...(fneActive ? [['fne', `/ventes?vente=${venteId}&action=fne`]] : []),
      ]
    case 'commande':
      return [
        ['ouvrir', `/commandes?commande=${piece.id}`], ['proforma', `/commandes?commande=${piece.id}&action=proforma`],
        ['whatsapp', `/commandes?commande=${piece.id}&action=whatsapp`], ['email', `/commandes?commande=${piece.id}&action=email`],
      ]
    case 'reconciliation': return [['ouvrir', `/reconciliations?fiche=${piece.id}`]]
    case 'client': return [['grandLivre', `/grand-livre?client=${piece.id}`]]
    case 'produit': return [['ouvrir', `/stock?produit=${piece.id}`]]
    case 'versement': return [['ouvrir', `/versements?date=${String(piece.date_doc || '').slice(0, 10)}`]]
    default: return [['ouvrir', '/creances']]
  }
}

export default function CartePiece({ piece, fneActive, onAction }) {
  const { t } = useTranslation('assistant')
  const navigate = useNavigate()
  return (
    <div className="rounded-xl border border-line bg-white p-2.5 text-sm">
      <p className="font-medium">{ICONES[piece.type] || '•'} {piece.titre}</p>
      {(piece.detail || piece.date_doc) && (
        <p className="text-xs text-petrol-500">{piece.detail}{piece.date_doc && !['client', 'produit'].includes(piece.type) ? ` · ${formatDate(piece.date_doc)}` : ''}</p>
      )}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {actions(piece, fneActive).map(([cle, lien]) => (
          <button key={cle} type="button" onClick={() => { onAction?.(); navigate(lien) }}
            className={`text-xs rounded-full px-2.5 py-1 border ${cle === 'whatsapp' ? 'border-green-300 bg-green-50 text-green-800' : cle === 'fne' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-line bg-canvas hover:border-amber-400'}`}>
            {t(`pieces.${cle}`)}
          </button>
        ))}
      </div>
    </div>
  )
}
