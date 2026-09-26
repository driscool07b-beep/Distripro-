import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { traduireErreur } from '../lib/erreurs'
import { formatXOF, formatDate } from '../lib/format'
import i18n from '../lib/i18n'

export default function Objectifs() {
  const { t } = useTranslation('objectifs')
  const { profil } = useAuth()
  const [objectifs, setObjectifs] = useState([])
  const [chargement, setChargement] = useState(true)
  const [commerciaux, setCommerciaux] = useState([])
  const [produits, setProduits] = useState([])

  const [modalOuvert, setModalOuvert] = useState(false)
  const [typeCible, setTypeCible] = useState('commercial')
  const [commercialId, setCommercialId] = useState('')
  const [zone, setZone] = useState('')
  const [produitId, setProduitId] = useState('')
  const [periodeDebut, setPeriodeDebut] = useState(premierJourDuMois())
  const [periodeFin, setPeriodeFin] = useState(dernierJourDuMois())
  const [montantCible, setMontantCible] = useState('')
  const [quantiteCible, setQuantiteCible] = useState('')
  const [notes, setNotes] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')

  const autorise = ['admin', 'manager'].includes(profil?.role)

  useEffect(() => {
    if (autorise) charger()
  }, [autorise])

  async function charger() {
    setChargement(true)
    const { data } = await supabase
      .from('objectifs')
      .select('id, commercial_id, zone, cible_bureau, produit_id, periode_debut, periode_fin, montant_cible, quantite_cible, notes, profils!commercial_id(nom, role), produits(nom)')
      .order('periode_debut', { ascending: false })

    const avecProgression = await Promise.all(
      (data || []).map(async (o) => {
        const progression = await calculerProgression(o)
        return { ...o, ...progression }
      })
    )
    setObjectifs(avecProgression)
    setChargement(false)
  }

  async function calculerProgression(o) {
    let ventes
    if (o.commercial_id && o.profils?.role === 'manager') {
      const { data: equipesGerees } = await supabase.from('equipes').select('id').eq('manager_id', o.commercial_id)
      const idsEquipes = (equipesGerees || []).map((e) => e.id)
      const { data: membres } = idsEquipes.length
        ? await supabase.from('profils').select('id').in('equipe_id', idsEquipes)
        : { data: [] }
      const idsCommerciaux = (membres || []).map((m) => m.id)
      const { data } = idsCommerciaux.length
        ? await supabase
            .from('ventes')
            .select('id, total, ventes_lignes(produit_id, quantite)')
            .neq('statut', 'annulee')
            .in('commercial_id', idsCommerciaux)
            .gte('created_at', `${o.periode_debut}T00:00:00`)
            .lt('created_at', `${o.periode_fin}T23:59:59.999`)
        : { data: [] }
      ventes = data
    } else if (o.commercial_id && o.profils?.role === 'admin') {
      const { data } = await supabase
        .from('ventes')
        .select('id, total, ventes_lignes(produit_id, quantite)')
        .neq('statut', 'annulee')
        .gte('created_at', `${o.periode_debut}T00:00:00`)
        .lt('created_at', `${o.periode_fin}T23:59:59.999`)
      ventes = data
    } else if (o.commercial_id) {
      const { data } = await supabase
        .from('ventes')
        .select('id, total, ventes_lignes(produit_id, quantite)')
        .neq('statut', 'annulee')
        .eq('commercial_id', o.commercial_id)
        .gte('created_at', `${o.periode_debut}T00:00:00`)
        .lt('created_at', `${o.periode_fin}T23:59:59.999`)
      ventes = data
    } else if (o.zone) {
      const { data } = await supabase
        .from('ventes')
        .select('id, total, ventes_lignes(produit_id, quantite), clients!inner(ville)')
        .neq('statut', 'annulee')
        .eq('clients.ville', o.zone)
        .gte('created_at', `${o.periode_debut}T00:00:00`)
        .lt('created_at', `${o.periode_fin}T23:59:59.999`)
      ventes = data
    } else if (o.cible_bureau) {
      const { data } = await supabase
        .from('ventes')
        .select('id, total, ventes_lignes(produit_id, quantite)')
        .neq('statut', 'annulee')
        .is('commercial_id', null)
        .gte('created_at', `${o.periode_debut}T00:00:00`)
        .lt('created_at', `${o.periode_fin}T23:59:59.999`)
      ventes = data
    }

    const montantRealise = (ventes || []).reduce((s, v) => s + Number(v.total || 0), 0)
    let quantiteRealisee = 0
    if (o.produit_id) {
      ;(ventes || []).forEach((v) => {
        ;(v.ventes_lignes || []).forEach((l) => {
          if (l.produit_id === o.produit_id) quantiteRealisee += l.quantite
        })
      })
    }

    return { montantRealise, quantiteRealisee }
  }

  async function chargerListes() {
    const [{ data: com }, { data: prod }] = await Promise.all([
      supabase.from('profils').select('id, nom, role').in('role', ['commercial', 'manager', 'admin']).order('nom'),
      supabase.from('produits').select('id, nom').eq('actif', true).order('nom'),
    ])
    setCommerciaux(com || [])
    setProduits(prod || [])
  }

  function ouvrirModal() {
    setTypeCible('commercial')
    setCommercialId('')
    setZone('')
    setProduitId('')
    setPeriodeDebut(premierJourDuMois())
    setPeriodeFin(dernierJourDuMois())
    setMontantCible('')
    setQuantiteCible('')
    setNotes('')
    setErreur('')
    chargerListes()
    setModalOuvert(true)
  }

  async function enregistrerObjectif(e) {
    e.preventDefault()
    setErreur('')

    if (typeCible === 'commercial' && !commercialId) {
      setErreur(t('erreurSelectionnerCommercial'))
      return
    }
    if (typeCible === 'zone' && !zone.trim()) {
      setErreur(t('erreurIndiquerZone'))
      return
    }
    if (!montantCible && !quantiteCible) {
      setErreur(t('erreurMontantOuQuantite'))
      return
    }
    if (quantiteCible && !produitId) {
      setErreur(t('erreurQuantiteSansProduit'))
      return
    }

    setEnvoi(true)
    const { error } = await supabase.from('objectifs').insert({
      entreprise_id: profil.entreprise_id,
      commercial_id: typeCible === 'commercial' ? commercialId : null,
      zone: typeCible === 'zone' ? zone.trim() : null,
      cible_bureau: typeCible === 'bureau',
      produit_id: produitId || null,
      periode_debut: periodeDebut,
      periode_fin: periodeFin,
      montant_cible: montantCible ? Number(montantCible) : null,
      quantite_cible: quantiteCible ? Number(quantiteCible) : null,
      notes: notes.trim() || null,
      created_by: profil.id,
    })
    setEnvoi(false)
    if (error) {
      setErreur(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    setModalOuvert(false)
    charger()
  }

  async function supprimerObjectif(id) {
    const motif = window.prompt(t('motifSuppression'))
    if (motif === null) return
    const { error } = await supabase.rpc('supprimer_objectif', { p_objectif_id: id, p_motif: motif })
    if (error) { alert(traduireErreur(error.message)); return }
    charger()
  }

  if (!autorise) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
        <p className="text-petrol-500">{t('accesRefuse')}</p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold">{t('titre')}</h1>
        <button data-aide="objectifs.nouvelObjectif" onClick={ouvrirModal} className="btn-primary text-sm">
          {t('nouvelObjectif')}
        </button>
      </div>

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <div className="space-y-3">
          {objectifs.map((o) => (
            <CarteObjectif key={o.id} objectif={o} onSupprimer={() => supprimerObjectif(o.id)} onModifie={charger} />
          ))}
          {objectifs.length === 0 && <p className="text-petrol-400 text-center py-8 text-sm">{t('aucunObjectif')}</p>}
        </div>
      )}

      {modalOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-4">{t('modalTitre')}</h2>
            <form onSubmit={enregistrerObjectif} className="space-y-3">
              <div>
                <label className="label">{t('cible')}</label>
                <div className="flex gap-2 mb-2">
                  <button data-aide="objectifs.unePersonne"
                    type="button"
                    onClick={() => setTypeCible('commercial')}
                    className={`flex-1 text-sm px-3 py-2 rounded-lg border ${typeCible === 'commercial' ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line'}`}
                  >
                    {t('unePersonne')}
                  </button>
                  <button data-aide="objectifs.uneZone"
                    type="button"
                    onClick={() => setTypeCible('zone')}
                    className={`flex-1 text-sm px-3 py-2 rounded-lg border ${typeCible === 'zone' ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line'}`}
                  >
                    {t('uneZone')}
                  </button>
                  <button data-aide="objectifs.leBureau"
                    type="button"
                    onClick={() => setTypeCible('bureau')}
                    className={`flex-1 text-sm px-3 py-2 rounded-lg border ${typeCible === 'bureau' ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line'}`}
                  >
                    {t('leBureau')}
                  </button>
                </div>
                {typeCible === 'commercial' ? (
                  <>
                    <select className="input-field" value={commercialId} onChange={(e) => setCommercialId(e.target.value)}>
                      <option value="">{t('selectionner')}</option>
                      {commerciaux.map((c) => (
                        <option key={c.id} value={c.id}>{c.nom} — {t(`roles.${c.role}`)}</option>
                      ))}
                    </select>
                    {commercialId && commerciaux.find((c) => c.id === commercialId)?.role === 'manager' && (
                      <p className="text-xs text-petrol-500 mt-1">{t('noteRealiseManager')}</p>
                    )}
                    {commercialId && commerciaux.find((c) => c.id === commercialId)?.role === 'admin' && (
                      <p className="text-xs text-petrol-500 mt-1">{t('noteRealiseAdmin')}</p>
                    )}
                  </>
                ) : typeCible === 'zone' ? (
                  <input
                    className="input-field"
                    value={zone}
                    onChange={(e) => setZone(e.target.value)}
                    placeholder={t('zonePlaceholder')}
                  />
                ) : (
                  <p className="text-xs text-petrol-500">{t('noteRealiseBureau')}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('debutPeriode')}</label>
                  <input type="date" lang={i18n.language} className="input-field" value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} />
                </div>
                <div>
                  <label className="label">{t('finPeriode')}</label>
                  <input type="date" lang={i18n.language} className="input-field" value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="label">{t('montantCible')}</label>
                <input
                  type="number"
                  min="0"
                  className="input-field"
                  value={montantCible}
                  onChange={(e) => setMontantCible(e.target.value)}
                  placeholder={t('montantPlaceholder')}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('produitPourQuantite')}</label>
                  <select className="input-field" value={produitId} onChange={(e) => setProduitId(e.target.value)}>
                    <option value="">{t('aucun')}</option>
                    {produits.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{t('quantiteCible')}</label>
                  <input
                    type="number"
                    min="0"
                    className="input-field"
                    value={quantiteCible}
                    onChange={(e) => setQuantiteCible(e.target.value)}
                    placeholder={t('quantitePlaceholder')}
                  />
                </div>
              </div>

              <div>
                <label className="label">{t('notes')}</label>
                <textarea className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              {erreur && <p className="text-sm text-red-600">{erreur}</p>}

              <div className="flex gap-2 pt-2">
                <button data-aide="objectifs.annuler" type="button" className="btn-secondary flex-1" onClick={() => setModalOuvert(false)}>{t('annuler')}</button>
                <button type="submit" disabled={envoi} className="btn-primary flex-1">
                  {envoi ? t('enregistrement') : t('creerObjectif')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function CarteObjectif({ objectif: o, onSupprimer, onModifie }) {
  const { t } = useTranslation('objectifs')
  const [edition, setEdition] = useState(null)
  const [historique, setHistorique] = useState(null)
  const [erreurEdition, setErreurEdition] = useState('')
  const [envoiEdition, setEnvoiEdition] = useState(false)

  function ouvrirEdition() {
    setErreurEdition('')
    setEdition({
      periode_debut: o.periode_debut, periode_fin: o.periode_fin,
      montant_cible: o.montant_cible ?? '', quantite_cible: o.quantite_cible ?? '',
      notes: o.notes || '', motif: '',
    })
  }

  async function enregistrerEdition() {
    setErreurEdition('')
    setEnvoiEdition(true)
    const { error } = await supabase.rpc('modifier_objectif', {
      p_objectif_id: o.id,
      p_periode_debut: edition.periode_debut,
      p_periode_fin: edition.periode_fin,
      p_montant_cible: edition.montant_cible === '' ? null : Number(edition.montant_cible),
      p_quantite_cible: edition.quantite_cible === '' ? null : Number(edition.quantite_cible),
      p_notes: edition.notes,
      p_motif: edition.motif,
    })
    setEnvoiEdition(false)
    if (error) { setErreurEdition(traduireErreur(error.message)); return }
    setEdition(null)
    setHistorique(null)
    onModifie()
  }

  async function basculerHistorique() {
    if (historique) { setHistorique(null); return }
    const { data } = await supabase
      .from('historique_objectifs')
      .select('action, avant, apres, motif, created_at, auteur:profils!effectue_par(nom)')
      .eq('objectif_id', o.id)
      .order('created_at', { ascending: false })
    setHistorique(data || [])
  }

  const champsSuivis = [
    ['periode_debut', t('historique.debut'), (v) => (v ? formatDate(v) : '—')],
    ['periode_fin', t('historique.fin'), (v) => (v ? formatDate(v) : '—')],
    ['montant_cible', t('historique.montant'), (v) => (v != null ? formatXOF(v) : '—')],
    ['quantite_cible', t('historique.quantite'), (v) => (v != null ? v : '—')],
    ['notes', t('historique.notes'), (v) => v || '—'],
  ]
  const cible = o.profils?.nom || o.zone || (o.cible_bureau ? t('leBureau') : '')
  const roleCible = o.profils?.role && o.profils.role !== 'commercial' ? t(`roles.${o.profils.role}`) : null
  const pctMontant = o.montant_cible ? Math.min(100, Math.round((o.montantRealise / o.montant_cible) * 100)) : null
  const pctQuantite = o.quantite_cible ? Math.min(100, Math.round((o.quantiteRealisee / o.quantite_cible) * 100)) : null

  return (
    <div className="card p-4">
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="font-medium text-sm">
            {cible}
            {roleCible && <span className="ml-1.5 text-xs bg-petrol-100 text-petrol-600 px-1.5 py-0.5 rounded">{roleCible}</span>}
          </p>
          <p className="text-xs text-petrol-500">
            {formatDate(o.periode_debut)} — {formatDate(o.periode_fin)}
            {o.produits?.nom ? ` — ${o.produits.nom}` : ''}
          </p>
        </div>
        <div className="flex gap-3 shrink-0">
          <button data-aide="objectifs.modifier" onClick={ouvrirEdition} className="text-xs text-petrol-700 underline">{t('modifier')}</button>
          <button data-aide="objectifs.historiqueBouton" onClick={basculerHistorique} className="text-xs text-petrol-500 underline">🕘 {t('historique.bouton')}</button>
          <button data-aide="objectifs.supprimer" onClick={onSupprimer} className="text-xs text-red-600 underline">{t('supprimer')}</button>
        </div>
      </div>

      {o.montant_cible != null && (
        <div className="mb-2">
          <div className="flex justify-between text-xs text-petrol-600 mb-1">
            <span>{t('montantLabel', { realise: formatXOF(o.montantRealise), cible: formatXOF(o.montant_cible) })}</span>
            <span className="font-medium">{pctMontant}%</span>
          </div>
          <BarreProgression pct={pctMontant} />
        </div>
      )}

      {o.quantite_cible != null && (
        <div>
          <div className="flex justify-between text-xs text-petrol-600 mb-1">
            <span>{t('quantiteLabel', { realise: o.quantiteRealisee, cible: o.quantite_cible })}</span>
            <span className="font-medium">{pctQuantite}%</span>
          </div>
          <BarreProgression pct={pctQuantite} />
        </div>
      )}

      {o.notes && <p className="text-xs text-petrol-500 mt-2">{o.notes}</p>}

      {edition && (
        <div className="mt-3 border-t border-line pt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">{t('historique.debut')}</label>
              <input type="date" className="input-field" value={edition.periode_debut} onChange={(e) => setEdition({ ...edition, periode_debut: e.target.value })} />
            </div>
            <div>
              <label className="label">{t('historique.fin')}</label>
              <input type="date" className="input-field" value={edition.periode_fin} onChange={(e) => setEdition({ ...edition, periode_fin: e.target.value })} />
            </div>
            <div>
              <label className="label">{t('historique.montant')}</label>
              <input type="number" min="0" className="input-field" value={edition.montant_cible} onChange={(e) => setEdition({ ...edition, montant_cible: e.target.value })} />
            </div>
            <div>
              <label className="label">{t('historique.quantite')}</label>
              <input type="number" min="0" className="input-field" value={edition.quantite_cible} onChange={(e) => setEdition({ ...edition, quantite_cible: e.target.value })} disabled={!o.produit_id} />
            </div>
          </div>
          <input className="input-field" value={edition.notes} onChange={(e) => setEdition({ ...edition, notes: e.target.value })} placeholder={t('historique.notes')} />
          <input className="input-field" value={edition.motif} onChange={(e) => setEdition({ ...edition, motif: e.target.value })} placeholder={t('motifModification')} />
          {erreurEdition && <p className="text-xs text-red-600">{erreurEdition}</p>}
          <div className="flex gap-2">
            <button className="btn-primary text-xs px-3 py-1.5" disabled={envoiEdition || edition.motif.trim().length < 3} onClick={enregistrerEdition}>
              {envoiEdition ? t('enregistrement') : t('enregistrerModification')}
            </button>
            <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => setEdition(null)}>{t('annuler')}</button>
          </div>
        </div>
      )}

      {historique && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs font-semibold text-petrol-600 mb-2">{t('historique.titre')}</p>
          {historique.length === 0 && <p className="text-xs text-petrol-400">{t('historique.vide')}</p>}
          <ul className="space-y-2">
            {historique.map((h, i) => (
              <li key={i} className="text-xs bg-canvas rounded-lg p-2">
                <p className="font-medium">
                  {t(`historique.actions.${h.action}`)} — {h.auteur?.nom || '—'} — {new Date(h.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                </p>
                {h.motif && <p className="text-amber-700">« {h.motif} »</p>}
                {h.action === 'modification' && champsSuivis
                  .filter(([cle]) => JSON.stringify(h.avant?.[cle] ?? null) !== JSON.stringify(h.apres?.[cle] ?? null))
                  .map(([cle, libelle, format]) => (
                    <p key={cle} className="text-petrol-600">{libelle} : <span className="line-through">{format(h.avant?.[cle])}</span> → <strong>{format(h.apres?.[cle])}</strong></p>
                  ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function BarreProgression({ pct }) {
  const couleur = pct >= 100 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-400'
  return (
    <div className="w-full bg-canvas rounded-full h-2">
      <div className={`h-2 rounded-full ${couleur}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function premierJourDuMois() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
}
function dernierJourDuMois() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]
}
