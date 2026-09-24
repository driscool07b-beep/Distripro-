import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { traduireErreur } from '../lib/erreurs'
import { envoyerJustificatifMouvement, ouvrirJustificatif } from '../lib/justificatifs'

function libellesType(t) {
  return { entree: t('entree'), sortie: t('sortie') }
}

const formatDateHeure = (d) =>
  new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function MouvementsStock() {
  const { t } = useTranslation('mouvementsstock')
  const { profil, entreprise } = useAuth()
  const LIBELLES_TYPE = libellesType(t)
  const [mouvements, setMouvements] = useState([])
  const [chargement, setChargement] = useState(true)
  const [depots, setDepots] = useState([])
  const [filtreDepot, setFiltreDepot] = useState('')
  const [filtreType, setFiltreType] = useState('')
  const [filtreJustificatif, setFiltreJustificatif] = useState('') // '' | 'avec' | 'sans'
  const [versions, setVersions] = useState({}) // mouvement_id -> justificatifs (du plus récent au plus ancien)
  const [historiqueOuvert, setHistoriqueOuvert] = useState(null)
  // Envoi en cours : { mouvementId, remplacement: bool }
  const [formulaire, setFormulaire] = useState(null)
  const [fichier, setFichier] = useState(null)
  const [motif, setMotif] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [etape, setEtape] = useState('')
  const [erreur, setErreur] = useState('')

  const autorise = ['admin', 'manager', 'gestionnaire_stock', 'comptable'].includes(profil?.role)
  const peutJoindre = ['admin', 'manager', 'gestionnaire_stock'].includes(profil?.role)

  useEffect(() => {
    if (autorise) {
      charger()
      supabase.from('depots').select('id, nom').order('nom').then(({ data }) => setDepots(data || []))
    }
  }, [autorise, filtreDepot, filtreType, filtreJustificatif])

  async function charger() {
    setChargement(true)
    let requete = supabase
      .from('mouvements_stock')
      .select('id, type_mouvement, quantite, motif, reference_doc, created_at, produits(nom), depots(nom), profils!effectue_par(nom)')
      .order('created_at', { ascending: false })
      .limit(200)

    if (filtreDepot) requete = requete.eq('depot_id', filtreDepot)
    if (filtreType) requete = requete.eq('type_mouvement', filtreType)
    if (filtreJustificatif === 'avec') requete = requete.not('reference_doc', 'is', null)
    if (filtreJustificatif === 'sans') requete = requete.is('reference_doc', null)

    const { data } = await requete
    setMouvements(data || [])
    setChargement(false)

    const ids = (data || []).filter((m) => m.reference_doc).map((m) => m.id)
    if (ids.length > 0) {
      const { data: lignes } = await supabase
        .from('justificatifs_mouvements')
        .select('id, mouvement_id, chemin, nom_fichier, taille_octets, created_at, remplace_le, motif_remplacement, ajoute:profils!ajoute_par(nom), remplacant:profils!remplace_par(nom)')
        .in('mouvement_id', ids)
        .order('created_at', { ascending: false })
      const parMouvement = {}
      ;(lignes || []).forEach((l) => { (parMouvement[l.mouvement_id] ||= []).push(l) })
      setVersions(parMouvement)
    } else {
      setVersions({})
    }
  }

  async function voir(chemin) {
    const { error } = await ouvrirJustificatif(chemin)
    if (error) alert(`${t('erreurOuverture')} (${traduireErreur(error)})`)
  }

  function ouvrirFormulaire(mouvementId, remplacement) {
    setFormulaire({ mouvementId, remplacement })
    setFichier(null)
    setMotif('')
    setErreur('')
  }

  async function envoyer() {
    if (!fichier || !formulaire) return
    if (formulaire.remplacement && !motif.trim()) {
      setErreur(t('motifObligatoire'))
      return
    }
    setEnvoi(true)
    setErreur('')
    let resultat
    try {
      resultat = await envoyerJustificatifMouvement({
        entrepriseId: entreprise.id,
        mouvementId: formulaire.mouvementId,
        fichier,
        motifRemplacement: formulaire.remplacement ? motif.trim() : null,
        onEtape: setEtape,
      })
    } finally {
      setEnvoi(false)
      setEtape('')
    }
    const { error } = resultat || {}
    if (error) {
      setErreur(`${t('erreurEnvoi')} — ${error}`)
      return
    }
    setFormulaire(null)
    charger()
  }

  if (!autorise) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
        <p className="text-petrol-500">{t('accesRefuse')}</p>
      </div>
    )
  }

  const formulaireEnvoi = (m) => (
    <div className="mt-2 border border-line rounded-xl p-3 bg-canvas space-y-2">
      {formulaire.remplacement && (
        <>
          <p className="text-xs text-amber-700">{t('remplacementInfo')}</p>
          <input
            className="input-field"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            placeholder={t('motifPlaceholder')}
          />
        </>
      )}
      <input
        type="file"
        accept="image/*,application/pdf"
        onChange={(e) => setFichier(e.target.files?.[0] || null)}
        className="text-xs w-full"
      />
      {fichier && (
        <p className="text-xs text-petrol-500">
          {fichier.name} — {(fichier.size / 1024 / 1024).toFixed(1)} Mo
          {fichier.type.startsWith('image/') && fichier.size > 350 * 1024 && ` · ${t('seraCompressee')}`}
        </p>
      )}
      {erreur && <p className="text-xs text-red-600">{erreur}</p>}
      <div className="flex gap-2">
        <button data-aide="mouvementsstock.envoyer" className="btn-primary text-xs px-3 py-1.5" disabled={!fichier || envoi} onClick={envoyer}>
          {envoi ? (etape ? t(`etapes.${etape}`) : t('envoi')) : formulaire.remplacement ? t('remplacer') : t('joindre')}
        </button>
        <button className="btn-secondary text-xs px-3 py-1.5" disabled={envoi} onClick={() => setFormulaire(null)}>
          {t('annuler')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
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
        <select className="input-field w-auto" value={filtreJustificatif} onChange={(e) => setFiltreJustificatif(e.target.value)}>
          <option value="">{t('filtreJustificatif.tous')}</option>
          <option value="avec">{t('filtreJustificatif.avec')}</option>
          <option value="sans">{t('filtreJustificatif.sans')}</option>
        </select>
      </div>

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <div className="space-y-2">
          {mouvements.map((m) => {
            const liste = versions[m.id] || []
            const remplaces = liste.filter((v) => v.remplace_le)
            const actuel = liste.find((v) => !v.remplace_le)
            return (
              <div key={m.id} className="card p-3">
                <p className="text-sm font-medium">
                  {m.produits?.nom}
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${m.type_mouvement === 'entree' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {LIBELLES_TYPE[m.type_mouvement]} — {m.quantite}
                  </span>
                </p>
                <p className="text-xs text-petrol-500 mt-0.5">
                  {m.depots?.nom} — {m.profils?.nom || '—'} — {formatDateHeure(m.created_at)}
                </p>
                {m.motif && <p className="text-xs text-petrol-600 mt-1">{m.motif}</p>}

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {m.reference_doc ? (
                    <>
                      <button data-aide="mouvementsstock.voirJustificatif" onClick={() => voir(m.reference_doc)} className="text-xs text-petrol-700 font-medium underline">
                        📎 {t('voirJustificatif')}
                      </button>
                      {actuel && (
                        <span className="text-xs text-petrol-400">
                          {t('deposePar', { nom: actuel.ajoute?.nom || '—', date: formatDateHeure(actuel.created_at) })}
                        </span>
                      )}
                      {peutJoindre && formulaire?.mouvementId !== m.id && (
                        <button data-aide="mouvementsstock.remplacer" onClick={() => ouvrirFormulaire(m.id, true)} className="text-xs text-amber-700 underline">
                          {t('remplacer')}
                        </button>
                      )}
                      {remplaces.length > 0 && (
                        <button onClick={() => setHistoriqueOuvert(historiqueOuvert === m.id ? null : m.id)} className="text-xs text-petrol-500 underline">
                          🕘 {t('historique', { n: remplaces.length })}
                        </button>
                      )}
                    </>
                  ) : peutJoindre && formulaire?.mouvementId !== m.id ? (
                    <button data-aide="mouvementsstock.joindreJustificatif" onClick={() => ouvrirFormulaire(m.id, false)} className="text-xs text-petrol-500 underline">
                      {t('joindreJustificatif')}
                    </button>
                  ) : !m.reference_doc && !peutJoindre ? (
                    <span className="text-xs text-petrol-400">{t('sansJustificatif')}</span>
                  ) : null}
                </div>

                {formulaire?.mouvementId === m.id && formulaireEnvoi(m)}

                {historiqueOuvert === m.id && (
                  <div className="mt-2 border-t border-line pt-2 space-y-1.5">
                    <p className="text-xs font-semibold text-petrol-600">{t('historiqueTitre')}</p>
                    {remplaces.map((v) => (
                      <div key={v.id} className="text-xs text-petrol-600 bg-canvas rounded-lg p-2">
                        <button onClick={() => voir(v.chemin)} className="underline text-petrol-700">
                          {v.nom_fichier || t('fichier')}
                        </button>
                        {' — '}{t('deposePar', { nom: v.ajoute?.nom || '—', date: formatDateHeure(v.created_at) })}
                        <span className="block text-amber-700">
                          {t('remplaceLe', { nom: v.remplacant?.nom || '—', date: formatDateHeure(v.remplace_le) })} « {v.motif_remplacement} »
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {mouvements.length === 0 && <p className="text-petrol-400 text-center py-8 text-sm">{t('aucunMouvement')}</p>}
        </div>
      )}
    </div>
  )
}
