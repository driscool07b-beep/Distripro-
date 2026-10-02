import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// « Premiers pas » : liste guidée pour qu'une nouvelle entreprise soit
// opérationnelle pendant son essai. Chaque étape est détectée automatiquement.
const ETAPES = [
  ['infos', '/parametres', (e) => e.infos],
  ['logo', '/parametres', (e) => e.logo],
  ['magasin', '/depots', (e) => e.magasin],
  ['produits', '/stock', (e) => e.produits > 0],
  ['stock', '/stock', (e) => e.stock],
  ['clients', '/clients', (e) => e.clients > 0],
  ['equipe', '/utilisateurs', (e) => e.equipe],
  ['vente', '/ventes', (e) => e.vente],
  ['assistant', '/assistant', (e) => e.assistant],
]

export default function PremiersPas() {
  const { t } = useTranslation('dashboard')
  const { entreprise } = useAuth()
  const cle = `distribpro-premiers-pas-${entreprise?.id}`
  const [etat, setEtat] = useState(null)
  const [masque, setMasque] = useState(() => { try { return localStorage.getItem(cle) === 'masque' } catch { return false } })

  useEffect(() => {
    if (masque || !entreprise?.id) return
    supabase.rpc('etat_demarrage').then(({ data }) => setEtat(data || null))
  }, [masque, entreprise?.id])

  if (masque || !etat) return null
  const faites = ETAPES.filter(([, , ok]) => ok(etat)).length
  if (faites === ETAPES.length) return null
  const pourcentage = Math.round((faites / ETAPES.length) * 100)
  const prochaine = ETAPES.find(([, , ok]) => !ok(etat))?.[0]

  return (
    <section className="card p-4 mb-6 border-amber-300">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">🚀 {t('premiersPas.titre')}</h2>
          <p className="text-xs text-petrol-500">{t('premiersPas.sousTitre', { faites, total: ETAPES.length })}</p>
        </div>
        <button className="text-xs text-petrol-500 underline" onClick={() => { try { localStorage.setItem(cle, 'masque') } catch { /* ignore */ } setMasque(true) }}>
          {t('premiersPas.masquer')}
        </button>
      </div>
      <div className="h-2 bg-canvas rounded-full overflow-hidden my-3">
        <div className="h-full bg-amber-500 transition-all" style={{ width: `${pourcentage}%` }} />
      </div>
      <ol className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {ETAPES.map(([id, lien, ok], i) => {
          const fait = ok(etat)
          return (
            <li key={id}>
              <Link to={lien} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm h-full ${fait ? 'border-emerald-200 bg-emerald-50/60 text-emerald-900' : id === prochaine ? 'border-amber-400 bg-amber-50 font-medium' : 'border-line bg-white hover:border-amber-300'}`}>
                <span className={`shrink-0 w-5 h-5 rounded-full text-[11px] flex items-center justify-center ${fait ? 'bg-emerald-600 text-white' : 'bg-canvas border border-line'}`}>{fait ? '✓' : i + 1}</span>
                <span>
                  <span className="block">{t(`premiersPas.etapes.${id}.titre`)}</span>
                  {!fait && <span className="block text-[11px] text-petrol-500 font-normal">{t(`premiersPas.etapes.${id}.aide`)}</span>}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
