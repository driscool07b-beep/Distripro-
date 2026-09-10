import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function libellesType(t) {
  return { entree: t('entree'), sortie: t('sortie') }
}

export default function MouvementsStock() {
  const { t } = useTranslation('mouvementsstock')
  const { profil, entreprise } = useAuth()
  const LIBELLES_TYPE = libellesType(t)
  const [mouvements, setMouvements] = useState([])
  const [chargement, setChargement] = useState(true)
  const [depots, setDepots] = useState([])
  const [filtreDepot, setFiltreDepot] = useState('')
  const [filtreType, setFiltreType] = useState('')

  const [fichierEnCours, setFichierEnCours] = useState(null)
  const [mouvementCiblé, setMouvementCiblé] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  const autorise = ['admin', 'manager', 'gestionnaire_stock'].includes(profil?.role)

  useEffect(() => {
    if (autorise) {
      charger()
      supabase.from('depots').select('id, nom').order('nom').then(({ data }) => setDepots(data || []))
    }
  }, [autorise, filtreDepot, filtreType])

  async function charger() {
    setChargement(true)
    let requete = supabase
      .from('mouvements_stock')
      .select('id, type_mouvement, quantite, motif, reference_doc, created_at, produits(nom), depots(nom), profils!effectue_par(nom)')
      .order('created_at', { ascending: false })
      .limit(200)

    if (filtreDepot) requete = requete.eq('depot_id', filtreDepot)
    if (filtreType) requete = requete.eq('type_mouvement', filtreType)

    const { data } = await requete
    setMouvements(data || [])
    setChargement(false)
  }

  async function voirJustificatif(chemin) {
    const { data } = await supabase.storage.from('justificatifs-stock').createSignedUrl(chemin, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function joindreApresCoup(mouvementId, fichier) {
    if (!fichier) return
    setEnvoi(true)
    const extension = fichier.name.split('.').pop()
    const chemin = `${entreprise.id}/mouvements-stock/${mouvementId}.${extension}`
    const { error } = await supabase.storage.from('justificatifs-stock').upload(chemin, fichier, { upsert: true })
    if (!error) {
      await supabase.rpc('attacher_justificatif_mouvement', { p_mouvement_id: mouvementId, p_chemin: chemin })
      charger()
    }
    setEnvoi(false)
    setMouvementCiblé(null)
    setFichierEnCours(null)
  }

  if (!autorise) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">{t('accesRefuse')}</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-1">{t('titre')}</h1>
      <p className="text-sm text-petrol-500 mb-4">{t('sousTitre')}</p>

      <div className="flex flex-wrap gap-2 mb-4">
        <select className="input-field w-auto" value={filtreDepot} onChange={(e) => setFiltreDepot(e.target.value)}>
          <option value="">{t('tousLesDepots')}</option>
          {depots.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
        </select>
        <select className="input-field w-auto" value={filtreType} onChange={(e) => setFiltreType(e.target.value)}>
          <option value="">{t('entreesEtSorties')}</option>
          <option value="entree">{t('entreesSeulement')}</option>
          <option value="sortie">{t('sortiesSeulement')}</option>
        </select>
      </div>

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <div className="space-y-2">
          {mouvements.map((m) => (
            <div key={m.id} className="border border-line rounded-lg p-3">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium">
                    {m.produits?.nom}
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${m.type_mouvement === 'entree' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {LIBELLES_TYPE[m.type_mouvement]} — {m.quantite}
                    </span>
                  </p>
                  <p className="text-xs text-petrol-500 mt-0.5">
                    {m.depots?.nom} — {m.profils?.nom || '—'} —{' '}
                    {new Date(m.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  {m.motif && <p className="text-xs text-petrol-600 mt-1">{m.motif}</p>}
                </div>
              </div>

              <div className="mt-2 flex items-center gap-3">
                {m.reference_doc ? (
                  <button onClick={() => voirJustificatif(m.reference_doc)} className="text-xs text-blue-600 underline">
                    {t('voirJustificatif')}
                  </button>
                ) : mouvementCiblé === m.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setFichierEnCours(e.target.files?.[0] || null)}
                      className="text-xs"
                    />
                    <button
                      disabled={!fichierEnCours || envoi}
                      onClick={() => joindreApresCoup(m.id, fichierEnCours)}
                      className="text-xs text-petrol-700 underline"
                    >
                      {envoi ? t('envoi') : t('joindre')}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setMouvementCiblé(m.id)} className="text-xs text-petrol-500 underline">
                    {t('joindreJustificatif')}
                  </button>
                )}
              </div>
            </div>
          ))}
          {mouvements.length === 0 && <p className="text-petrol-400 text-center py-8 text-sm">{t('aucunMouvement')}</p>}
        </div>
      )}
    </div>
  )
}
