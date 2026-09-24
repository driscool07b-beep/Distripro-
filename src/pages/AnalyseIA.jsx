import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { analyserTexte, exporterAnalysePDF, exporterAnalyseWord } from '../lib/exportAnalyse'
import { useAuth } from '../context/AuthContext'
import { traduireErreur } from '../lib/erreurs'

export default function AnalyseIA() {
  const { t } = useTranslation('analyseia')
  const { profil, entreprise } = useAuth()
  const [historique, setHistorique] = useState([])
  const [chargementHistorique, setChargementHistorique] = useState(true)
  const [analyseAffichee, setAnalyseAffichee] = useState(null)
  const [generation, setGeneration] = useState(false)
  const [erreur, setErreur] = useState('')
  const [exportEnCours, setExportEnCours] = useState('')

  async function telecharger(format) {
    if (!analyseAffichee) return
    const params = {
      entreprise,
      analyse: analyseAffichee,
      titre: t('export.titreDocument'),
      sousTitre: t('genereeLe', { date: new Date(analyseAffichee.created_at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) })
        + (analyseAffichee.profils?.nom ? ` ${t('par', { nom: analyseAffichee.profils.nom })}` : ''),
    }
    setExportEnCours(format)
    try {
      if (format === 'pdf') exporterAnalysePDF(params)
      else await exporterAnalyseWord(params)
    } catch (e) {
      alert(`${t('export.erreur')} (${e.message})`)
    }
    setExportEnCours('')
  }

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
      setErreur(data?.erreur || traduireErreur(error?.message) || t('erreurGeneration'))
      return
    }
    await chargerHistorique()
  }

  if (!autorise) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">
          {t('accesRefuse')}
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h1 className="text-xl font-bold">{t('titre')}</h1>
        <button onClick={genererAnalyse} disabled={generation} className="btn-primary text-sm">
          {generation ? t('generationEnCours') : t('genererNouvelleAnalyse')}
        </button>
      </div>
      <p className="text-sm text-petrol-500 mb-4">{entreprise?.nom}</p>

      {erreur && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-lg p-3 mb-4">
          {erreur}
          {erreur.includes('ANTHROPIC_API_KEY') && (
            <p className="mt-1 text-xs">
              {t('cleApiManquante')}
            </p>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-[200px_1fr] gap-4">
        <div>
          <p className="text-xs font-medium text-petrol-600 mb-2">{t('historique')}</p>
          {chargementHistorique ? (
            <p className="text-xs text-petrol-400">{t('chargement')}</p>
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
              {historique.length === 0 && <p className="text-xs text-petrol-400">{t('aucuneAnalyse')}</p>}
            </div>
          )}
        </div>

        <div className="card p-5">
          {analyseAffichee ? (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                <button data-aide="analyseia.export.pdf" onClick={() => telecharger('pdf')} disabled={!!exportEnCours} className="btn-secondary text-xs px-3 py-1.5">
                  📄 {exportEnCours === 'pdf' ? t('export.enCours') : t('export.pdf')}
                </button>
                <button data-aide="analyseia.export.word" onClick={() => telecharger('word')} disabled={!!exportEnCours} className="btn-secondary text-xs px-3 py-1.5">
                  📝 {exportEnCours === 'word' ? t('export.enCours') : t('export.word')}
                </button>
              </div>
              <p className="text-xs text-petrol-500 mb-3">
                {t('genereeLe', { date: new Date(analyseAffichee.created_at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) })}
                {analyseAffichee.profils?.nom ? ` ${t('par', { nom: analyseAffichee.profils.nom })}` : ''}
              </p>
              <div className="text-sm leading-relaxed space-y-2">
                {analyserTexte(analyseAffichee.contenu).map((b, i) =>
                  b.type === 'titre' ? (
                    <h3 key={i} className="font-semibold text-petrol-900 text-base pt-3 first:pt-0">{b.texte}</h3>
                  ) : (
                    <p key={i} className={b.type === 'puce' ? 'ps-5 relative before:content-["•"] before:absolute before:start-1.5 before:text-amber-600' : ''}>
                      {b.segments.map((sg, j) => (sg.gras ? <strong key={j}>{sg.texte}</strong> : <span key={j}>{sg.texte}</span>))}
                    </p>
                  )
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-petrol-400 text-center py-12">
              {t('aucuneAnalysePourLeMoment')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
