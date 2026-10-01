import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/format'

const ICONES = {
  vente: '🧾', commande: '📦', encaissement: '💵', versement: '🏦', reconciliation: '⚖️',
  reglement_groupe: '🏢', client: '👤', produit: '🏷️',
}

// Où mène chaque type de résultat.
function lien(r) {
  switch (r.type) {
    case 'vente': return `/ventes?vente=${r.id}`
    case 'encaissement': return r.cible_id ? `/ventes?vente=${r.cible_id}` : '/creances'
    case 'commande': return `/commandes?commande=${r.id}`
    case 'versement': return `/versements?date=${String(r.date_doc || '').slice(0, 10)}`
    case 'reconciliation': return `/reconciliations?fiche=${r.id}`
    case 'reglement_groupe': return '/creances'
    case 'client': return `/grand-livre?client=${r.id}`
    case 'produit': return `/stock?produit=${r.id}`
    default: return '/'
  }
}

// Recherche générale : une référence, un nom, un téléphone… parmi les
// documents que l'utilisateur a le droit de voir (contrôlé par le serveur).
export default function RechercheGlobale({ ouvert, onFermer }) {
  const { t } = useTranslation('commun')
  const navigate = useNavigate()
  const [terme, setTerme] = useState('')
  const [resultats, setResultats] = useState([])
  const [enCours, setEnCours] = useState(false)
  const [actif, setActif] = useState(0)
  const champ = useRef(null)

  useEffect(() => {
    if (ouvert) { setTerme(''); setResultats([]); setActif(0); setTimeout(() => champ.current?.focus(), 30) }
  }, [ouvert])

  useEffect(() => {
    const q = terme.trim()
    if (q.length < 2) { setResultats([]); return }
    setEnCours(true)
    const minuterie = setTimeout(async () => {
      const { data } = await supabase.rpc('recherche_globale', { p_terme: q })
      setResultats(data || [])
      setActif(0)
      setEnCours(false)
    }, 280)
    return () => clearTimeout(minuterie)
  }, [terme])

  if (!ouvert) return null

  const ouvrir = (r) => { onFermer(); navigate(lien(r)) }
  const surTouche = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActif((a) => Math.min(a + 1, resultats.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActif((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && resultats[actif]) { e.preventDefault(); ouvrir(resultats[actif]) }
    else if (e.key === 'Escape') { e.preventDefault(); onFermer() }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center p-3 pt-[10vh]" onClick={onFermer}>
      <div className="card bg-white w-full max-w-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
          <span className="text-petrol-400">🔍</span>
          <input ref={champ} value={terme} onChange={(e) => setTerme(e.target.value)} onKeyDown={surTouche}
            placeholder={t('rechercheGlobale.placeholder')} className="flex-1 bg-transparent outline-none text-sm py-1" />
          <button data-fermer className="text-xs text-petrol-400 border border-line rounded px-1.5 py-0.5" onClick={onFermer}>Échap</button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {terme.trim().length < 2 ? (
            <p className="text-xs text-petrol-500 px-4 py-4">{t('rechercheGlobale.aide')}</p>
          ) : enCours && resultats.length === 0 ? (
            <p className="text-xs text-petrol-500 px-4 py-4">{t('rechercheGlobale.enCours')}</p>
          ) : resultats.length === 0 ? (
            <p className="text-sm text-petrol-500 px-4 py-4">{t('rechercheGlobale.aucun', { terme: terme.trim() })}</p>
          ) : (
            <ul className="py-1">
              {resultats.map((r, i) => (
                <li key={`${r.type}-${r.id}`}>
                  <button onMouseEnter={() => setActif(i)} onClick={() => ouvrir(r)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-2.5 ${i === actif ? 'bg-amber-50' : ''}`}>
                    <span className="text-lg shrink-0">{ICONES[r.type] || '•'}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{r.titre}</span>
                      <span className="block text-xs text-petrol-500 truncate">{r.detail}</span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-[10px] uppercase tracking-wide text-petrol-400">{t(`rechercheGlobale.types.${r.type}`)}</span>
                      {r.date_doc && !['client', 'produit'].includes(r.type) && <span className="block text-[10px] text-petrol-400">{formatDate(r.date_doc)}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-[10px] text-petrol-400 px-4 py-2 border-t border-line">{t('rechercheGlobale.pied')}</p>
      </div>
    </div>
  )
}
