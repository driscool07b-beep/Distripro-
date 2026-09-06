import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const LIBELLES_TYPE = { entree: 'Entrée', sortie: 'Sortie' }

export default function MouvementsStock() {
  const { profil, entreprise } = useAuth()
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
        <p className="text-petrol-500">Cette page est réservée à la gestion de stock (admin, manager, gestionnaire de stock).</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Journal des mouvements de stock</h1>
      <p className="text-sm text-petrol-500 mb-4">200 derniers mouvements magasin (hors stock des commerciaux).</p>

      <div className="flex flex-wrap gap-2 mb-4">
        <select className="input-field w-auto" value={filtreDepot} onChange={(e) => setFiltreDepot(e.target.value)}>
          <option value="">Tous les dépôts</option>
          {depots.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
        </select>
        <select className="input-field w-auto" value={filtreType} onChange={(e) => setFiltreType(e.target.value)}>
          <option value="">Entrées et sorties</option>
          <option value="entree">Entrées seulement</option>
          <option value="sortie">Sorties seulement</option>
        </select>
      </div>

      {chargement ? (
        <p className="text-sm text-petrol-500">Chargement…</p>
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
                    📎 Voir le justificatif
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
                      {envoi ? 'Envoi…' : 'Joindre'}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setMouvementCiblé(m.id)} className="text-xs text-petrol-500 underline">
                    + Joindre un justificatif
                  </button>
                )}
              </div>
            </div>
          ))}
          {mouvements.length === 0 && <p className="text-petrol-400 text-center py-8 text-sm">Aucun mouvement.</p>}
        </div>
      )}
    </div>
  )
}
