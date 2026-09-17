import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { accesAutorise } from '../lib/accesRole'
import { formatXOF, formatDate } from '../lib/format'
import { genererBonCaisse } from '../lib/export'
import { traduireErreur } from '../lib/erreurs'

export default function JournalCaisse() {
  const { t } = useTranslation('journalcaisse')
  const { profil, entreprise } = useAuth()

  const [caisses, setCaisses] = useState([])
  const [caisseId, setCaisseId] = useState('')
  const [solde, setSolde] = useState(0)
  const [demandes, setDemandes] = useState([])
  const [chargement, setChargement] = useState(true)

  const [montantsAValider, setMontantsAValider] = useState({})
  const [refusEnCours, setRefusEnCours] = useState(null)
  const [motifRefus, setMotifRefus] = useState('')

  const [modalNouvelleDemande, setModalNouvelleDemande] = useState(false)
  const [libelle, setLibelle] = useState('')
  const [montant, setMontant] = useState('')
  const [fichier, setFichier] = useState(null)
  const [envoiDemande, setEnvoiDemande] = useState(false)
  const [erreurDemande, setErreurDemande] = useState('')

  const [envoiAction, setEnvoiAction] = useState(null)
  const [erreurAction, setErreurAction] = useState('')

  const peutCreer = ['admin', 'manager', 'comptable'].includes(profil?.role)
  const peutValider = (entreprise?.caisse_roles_validateurs || ['admin', 'manager']).includes(profil?.role)

  useEffect(() => {
    chargerCaisses()
  }, [])

  useEffect(() => {
    if (caisseId) charger()
  }, [caisseId])

  async function chargerCaisses() {
    const { data } = await supabase.from('caisses').select('id, nom, actif').eq('actif', true).order('nom')
    setCaisses(data || [])
    if (data && data.length > 0) setCaisseId(data[0].id)
    else setChargement(false)
  }

  async function charger() {
    setChargement(true)
    const [{ data: soldeData }, { data: demandesData }] = await Promise.all([
      supabase.rpc('solde_caisse', { p_caisse_id: caisseId }),
      supabase
        .from('demandes_decaissement')
        .select('id, libelle, montant_demande, montant_valide, statut, piece_justificative_path, piece_justificative_nom, motif_refus, created_at, valide_at, payee_at, demandeur:profils!demande_par(nom), validateur:profils!valide_par(nom), payeur:profils!payee_par(nom)')
        .eq('caisse_id', caisseId)
        .order('created_at', { ascending: false }),
    ])
    setSolde(soldeData || 0)
    setDemandes(demandesData || [])
    setChargement(false)
  }

  const enAttente = demandes.filter((d) => d.statut === 'en_attente')
  const aPayer = demandes.filter((d) => d.statut === 'validee')
  const historique = demandes.filter((d) => ['payee', 'refusee'].includes(d.statut))

  const totalAccorde = enAttente.reduce((s, d) => s + Number(montantsAValider[d.id] ?? d.montant_demande), 0)
  const soldeProjete = solde - totalAccorde - aPayer.reduce((s, d) => s + Number(d.montant_valide), 0)

  async function voirPieceJustificative(chemin) {
    const { data } = await supabase.storage.from('pieces-jointes').createSignedUrl(chemin, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function creerDemande(e) {
    e.preventDefault()
    setErreurDemande('')
    if (!libelle.trim()) {
      setErreurDemande(t('erreurs.libelleRequis'))
      return
    }
    if (!montant || Number(montant) <= 0) {
      setErreurDemande(t('erreurs.montantInvalide'))
      return
    }
    setEnvoiDemande(true)

    let cheminPiece = null
    let nomPiece = null
    if (fichier) {
      nomPiece = fichier.name
      cheminPiece = `${entreprise?.id}/decaissements/${caisseId}/${Date.now()}-${fichier.name}`
      const { error: erreurUpload } = await supabase.storage.from('pieces-jointes').upload(cheminPiece, fichier)
      if (erreurUpload) {
        setEnvoiDemande(false)
        setErreurDemande(`${t('erreurs.erreur')} : ${traduireErreur(erreurUpload.message)}`)
        return
      }
    }

    const { error } = await supabase.rpc('creer_demande_decaissement', {
      p_caisse_id: caisseId,
      p_libelle: libelle.trim(),
      p_montant: Number(montant),
      p_piece_path: cheminPiece,
      p_piece_nom: nomPiece,
    })

    setEnvoiDemande(false)
    if (error) {
      setErreurDemande(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    setLibelle('')
    setMontant('')
    setFichier(null)
    setModalNouvelleDemande(false)
    charger()
  }

  async function valider(demandeId) {
    setErreurAction('')
    setEnvoiAction(demandeId)
    const montantValide = Number(montantsAValider[demandeId] ?? demandes.find((d) => d.id === demandeId)?.montant_demande)
    const { error } = await supabase.rpc('valider_demande_decaissement', {
      p_demande_id: demandeId,
      p_montant_valide: montantValide,
    })
    setEnvoiAction(null)
    if (error) {
      setErreurAction(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    charger()
  }

  async function confirmerRefus(demandeId) {
    setErreurAction('')
    setEnvoiAction(demandeId)
    const { error } = await supabase.rpc('valider_demande_decaissement', {
      p_demande_id: demandeId,
      p_montant_valide: 0,
      p_motif_refus: motifRefus.trim() || null,
    })
    setEnvoiAction(null)
    if (error) {
      setErreurAction(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    setRefusEnCours(null)
    setMotifRefus('')
    charger()
  }

  async function payer(demande) {
    setErreurAction('')
    setEnvoiAction(demande.id)
    const { error } = await supabase.rpc('payer_demande_decaissement', { p_demande_id: demande.id })
    setEnvoiAction(null)
    if (error) {
      setErreurAction(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`)
      return
    }

    const caisse = caisses.find((c) => c.id === caisseId)
    const doc = genererBonCaisse({
      entreprise,
      demande: { ...demande, payee_at: new Date().toISOString() },
      caisse,
      demandePar: demande.demandeur,
      validePar: demande.validateur,
      payePar: profil,
    })
    doc.save(`bon-caisse-${demande.id.slice(0, 8)}.pdf`)

    charger()
  }

  if (!accesAutorise('journalCaisse', profil?.role)) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">{t('accesRefuse')}</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold">{t('titre')}</h1>
        {peutCreer && (
          <button onClick={() => setModalNouvelleDemande(true)} className="btn-primary text-sm">
            {t('nouvelleDemande')}
          </button>
        )}
      </div>

      <div className="mb-4">
        <label className="label">{t('caisse')}</label>
        <select className="input-field max-w-xs" value={caisseId} onChange={(e) => setCaisseId(e.target.value)}>
          {caisses.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
        {caisses.length === 0 && <p className="text-xs text-petrol-400 mt-1">{t('aucuneCaisse')}</p>}
      </div>

      {caisseId && (
        <>
          <div className="card p-4 mb-6">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-petrol-600">{t('soldeActuel')}</span>
              <span className="font-mono text-xl font-semibold">{formatXOF(solde)}</span>
            </div>
            {(enAttente.length > 0 || aPayer.length > 0) && (
              <div className="flex justify-between items-baseline mt-1">
                <span className="text-xs text-petrol-500">{t('soldeProjete')}</span>
                <span className={`font-mono text-sm font-medium ${soldeProjete < 0 ? 'text-red-600' : 'text-petrol-700'}`}>
                  {formatXOF(soldeProjete)}
                </span>
              </div>
            )}
            {soldeProjete < 0 && (
              <p className="text-xs text-red-600 mt-2">{t('avertissementSoldeNegatif')}</p>
            )}
          </div>

          {chargement ? (
            <p className="text-sm text-petrol-500">{t('chargement')}</p>
          ) : (
            <>
              {peutValider && enAttente.length > 0 && (
                <div className="mb-6">
                  <h2 className="font-semibold text-sm mb-2">{t('sections.aValider', { n: enAttente.length })}</h2>
                  <div className="space-y-2">
                    {enAttente.map((d) => (
                      <div key={d.id} className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="font-medium text-sm">{d.libelle}</p>
                            <p className="text-xs text-petrol-500">
                              {t('demandePar', { nom: d.demandeur?.nom || '—', date: formatDate(d.created_at) })}
                            </p>
                          </div>
                          <span className="font-mono text-sm shrink-0 ml-2">{formatXOF(d.montant_demande)}</span>
                        </div>
                        {d.piece_justificative_path && (
                          <button onClick={() => voirPieceJustificative(d.piece_justificative_path)} className="text-xs text-blue-600 underline mb-2 block">
                            📎 {d.piece_justificative_nom || t('pieceJustificative')}
                          </button>
                        )}

                        {refusEnCours === d.id ? (
                          <div className="mt-2 space-y-2">
                            <input
                              className="input-field text-sm"
                              placeholder={t('motifRefusPlaceholder')}
                              value={motifRefus}
                              onChange={(e) => setMotifRefus(e.target.value)}
                            />
                            <div className="flex gap-2">
                              <button onClick={() => setRefusEnCours(null)} className="btn-secondary text-xs flex-1">{t('annuler')}</button>
                              <button
                                onClick={() => confirmerRefus(d.id)}
                                disabled={envoiAction === d.id}
                                className="bg-red-600 text-white text-xs rounded-lg px-3 py-1.5 flex-1"
                              >
                                {t('confirmerRefus')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 mt-2">
                            <input
                              type="number"
                              min="0"
                              max={d.montant_demande}
                              className="input-field text-sm w-32"
                              value={montantsAValider[d.id] ?? d.montant_demande}
                              onChange={(e) => setMontantsAValider((prev) => ({ ...prev, [d.id]: e.target.value }))}
                            />
                            <span className="text-xs text-petrol-500">{t('aValiderSurDemande', { montant: formatXOF(d.montant_demande) })}</span>
                            <div className="flex-1" />
                            <button onClick={() => setRefusEnCours(d.id)} className="text-xs text-red-600 underline">
                              {t('refuser')}
                            </button>
                            <button
                              onClick={() => valider(d.id)}
                              disabled={envoiAction === d.id}
                              className="bg-green-600 text-white text-xs rounded-lg px-3 py-1.5"
                            >
                              {envoiAction === d.id ? '…' : t('valider')}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {erreurAction && <p className="text-xs text-red-600 mt-2">{erreurAction}</p>}
                </div>
              )}

              {aPayer.length > 0 && (
                <div className="mb-6">
                  <h2 className="font-semibold text-sm mb-2">{t('sections.aPayer', { n: aPayer.length })}</h2>
                  <div className="space-y-2">
                    {aPayer.map((d) => (
                      <div key={d.id} className="border border-green-200 bg-green-50 rounded-lg p-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-sm">{d.libelle}</p>
                          <p className="text-xs text-petrol-500">
                            {t('valideParLe', { nom: d.validateur?.nom || t('autoValide'), date: formatDate(d.valide_at) })}
                          </p>
                          <span className="font-mono text-sm">{formatXOF(d.montant_valide)}</span>
                        </div>
                        <button
                          onClick={() => payer(d)}
                          disabled={envoiAction === d.id}
                          className="bg-petrol-800 text-white text-sm rounded-lg px-4 py-2 shrink-0"
                        >
                          {envoiAction === d.id ? '…' : t('payerMontant')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h2 className="font-semibold text-sm mb-2">{t('sections.historique')}</h2>
                <div className="space-y-1.5">
                  {historique.map((d) => (
                    <div key={d.id} className="border border-line rounded-lg p-2.5 flex items-center justify-between text-sm">
                      <div>
                        <p className={d.statut === 'refusee' ? 'text-petrol-400 line-through' : ''}>{d.libelle}</p>
                        <p className="text-xs text-petrol-500">
                          {d.statut === 'payee'
                            ? t('payeParLe', { nom: d.payeur?.nom || '—', date: formatDate(d.payee_at) })
                            : t('refuseeMotif', { motif: d.motif_refus || t('sansMotif') })}
                        </p>
                      </div>
                      <span className={`font-mono ${d.statut === 'refusee' ? 'text-petrol-400' : ''}`}>
                        {formatXOF(d.statut === 'payee' ? d.montant_valide : d.montant_demande)}
                      </span>
                    </div>
                  ))}
                  {historique.length === 0 && enAttente.length === 0 && aPayer.length === 0 && (
                    <p className="text-petrol-400 text-center py-8 text-sm">{t('aucuneDemande')}</p>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {modalNouvelleDemande && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-5 w-full max-w-sm">
            <h2 className="font-semibold text-lg mb-3">{t('nouvelleDemande')}</h2>
            <form onSubmit={creerDemande} className="space-y-3">
              <div>
                <label className="label">{t('libelle')}</label>
                <input
                  className="input-field"
                  value={libelle}
                  onChange={(e) => setLibelle(e.target.value)}
                  placeholder={t('libellePlaceholder')}
                />
              </div>
              <div>
                <label className="label">{t('montant')}</label>
                <input
                  type="number"
                  min="0"
                  className="input-field"
                  value={montant}
                  onChange={(e) => setMontant(e.target.value)}
                />
              </div>
              <div>
                <label className="label">{t('pieceJustificativeOptionnelle')}</label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="text-sm"
                  onChange={(e) => setFichier(e.target.files?.[0] || null)}
                />
              </div>
              {erreurDemande && <p className="text-xs text-red-600">{erreurDemande}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setModalNouvelleDemande(false)} className="btn-secondary flex-1">
                  {t('annuler')}
                </button>
                <button type="submit" disabled={envoiDemande} className="btn-primary flex-1">
                  {envoiDemande ? t('envoi') : t('envoyerDemande')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
