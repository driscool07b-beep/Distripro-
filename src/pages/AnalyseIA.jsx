import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function AnalyseIA() {
  const { profil, entreprise } = useAuth()
  const [historique, setHistorique] = useState([])
  const [chargementHistorique, setChargementHistorique] = useState(true)
  const [analyseAffichee, setAnalyseAffichee] = useState(null)
  const [generation, setGeneration] = useState(false)
  const [erreur, setErreur] = useState('')

  const autorise = ['admin', 'manager'].includes(profil?.role)

  useEffect(() => {
    if (autorise) chargerHistorique()
  }, [autorise])

  async function chargerHistorique() {
    setChargementHistorique(true)
    const { data, error } = await supabase
      .from('analyses_ia')
      .select('id, contenu, created_at, profils(nom)')
      .order('created_at', { ascending: false })
      .limit(20)
    if (!error) {
      setHistorique(data || [])
      if (data && data.length > 0) setAnalyseAffichee(data[0])
    }
    setChargementHistorique(false)
  }

  async function genererAnalyse() {
    setGeneration(true)
    setErreur('')
    const { data, error } = await supabase.functions.invoke('analyse-ia')
    setGeneration(false)
    if (error || data?.erreur) {
      setErreur(data?.erreur || error?.message || 'Erreur lors de la génération.')
      return
    }
    await chargerHistorique()
  }

  if (!autorise) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">
          Cette page est réservée aux responsables commerciaux et à la direction.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">Analyse stratégique (IA)</h1>
        <button onClick={genererAnalyse} disabled={generation} className="btn-primary text-sm">
          {generation ? 'Génération en cours… (peut prendre 30s)' : '✨ Générer une nouvelle analyse'}
        </button>
      </div>
      <p className="text-sm text-petrol-500 mb-4">{entreprise?.nom}</p>

      {erreur && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-lg p-3 mb-4">
          {erreur}
          {erreur.includes('ANTHROPIC_API_KEY') && (
            <p className="mt-1 text-xs">
              La fonction serveur n'a pas encore été configurée avec une clé API. Voir les instructions de déploiement.
            </p>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-[200px_1fr] gap-4">
        <div>
          <p className="text-xs font-medium text-petrol-600 mb-2">Historique</p>
          {chargementHistorique ? (
            <p className="text-xs text-petrol-400">Chargement…</p>
          ) : (
            <div className="space-y-1">
              {historique.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAnalyseAffichee(a)}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded ${
                    analyseAffichee?.id === a.id ? 'bg-petrol-800 text-white' : 'hover:bg-canvas text-petrol-600'
                  }`}
                >
                  {new Date(a.created_at).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
                  <br />
                  <span className="opacity-70">{a.profils?.nom || '—'}</span>
                </button>
              ))}
              {historique.length === 0 && <p className="text-xs text-petrol-400">Aucune analyse générée.</p>}
            </div>
          )}
        </div>

        <div className="card p-5">
          {analyseAffichee ? (
            <>
              <p className="text-xs text-petrol-500 mb-3">
                Générée le {new Date(analyseAffichee.created_at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}
                {analyseAffichee.profils?.nom ? ` par ${analyseAffichee.profils.nom}` : ''}
              </p>
              <div className="text-sm whitespace-pre-wrap leading-relaxed">{analyseAffichee.contenu}</div>
            </>
          ) : (
            <p className="text-sm text-petrol-400 text-center py-12">
              Aucune analyse pour le moment. Cliquez sur "Générer une nouvelle analyse" pour commencer.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
