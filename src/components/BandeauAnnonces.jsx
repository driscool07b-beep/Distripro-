import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const CLE = 'distribpro-annonces-fermees'
const STYLES = {
  info: 'bg-sky-50 border-sky-200 text-sky-900',
  attention: 'bg-amber-50 border-amber-300 text-amber-900',
  important: 'bg-red-50 border-red-300 text-red-900',
}

// Annonces du promoteur à tous les utilisateurs (nouveautés, maintenance…),
// chacune masquable une fois lue.
export default function BandeauAnnonces() {
  const [annonces, setAnnonces] = useState([])
  const [fermees, setFermees] = useState(() => { try { return JSON.parse(localStorage.getItem(CLE) || '[]') } catch { return [] } })

  useEffect(() => {
    supabase.from('annonces_plateforme').select('id, titre, message, niveau').order('created_at', { ascending: false }).limit(5)
      .then(({ data }) => setAnnonces(data || []))
  }, [])

  const visibles = annonces.filter((a) => !fermees.includes(a.id))
  if (!visibles.length) return null
  const fermer = (id) => {
    const suite = [...fermees, id].slice(-50)
    setFermees(suite)
    try { localStorage.setItem(CLE, JSON.stringify(suite)) } catch { /* ignore */ }
  }
  return (
    <div className="no-print space-y-2 px-4 pt-3 sm:px-6 lg:px-8">
      {visibles.map((a) => (
        <div key={a.id} className={`rounded-xl border px-3 py-2 text-sm flex items-start gap-2 ${STYLES[a.niveau] || STYLES.info}`}>
          <span>📣</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold">{a.titre}</p>
            <p className="text-xs whitespace-pre-line">{a.message}</p>
          </div>
          <button onClick={() => fermer(a.id)} className="text-xs opacity-60 hover:opacity-100 px-1" aria-label="Fermer">✕</button>
        </div>
      ))}
    </div>
  )
}
