import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatXOF, formatDate } from '../lib/format'
import { traduireErreur } from '../lib/erreurs'

// Détail du stock d'un produit : répartition par magasin, lots (quantités,
// date d'entrée, péremption, réceptionné par, état), stock sans numéro de
// lot, et — pour la direction, le comptable et le magasin — prix de revient
// et marge. Un commercial ne voit jamais les prix d'achat.
export default function DetailStockProduit({ produit, depots, depotFiltre, onFermer, onModifie }) {
  const { t } = useTranslation('stock')
  const { profil } = useAuth()
  const [lots, setLots] = useState([])
  const [cout, setCout] = useState(null)
  const [historique, setHistorique] = useState([])
  const [chargement, setChargement] = useState(true)
  const [prixSaisi, setPrixSaisi] = useState('')
  const [etatEnCours, setEtatEnCours] = useState(null) // { lot, etat }
  const [motifEtat, setMotifEtat] = useState('')
  const [erreur, setErreur] = useState('')
  const [envoi, setEnvoi] = useState(false)

  const voitCouts = ['admin', 'manager', 'comptable', 'gestionnaire_stock'].includes(profil?.role)
  const voitMarges = ['admin', 'manager', 'comptable'].includes(profil?.role)
  const peutFixerPrix = ['admin', 'manager'].includes(profil?.role)
  const peutChangerEtat = ['admin', 'manager', 'gestionnaire_stock'].includes(profil?.role)
  const nomDepot = (id) => depots.find((d) => d.id === id)?.nom || '—'

  async function charger() {
    setChargement(true)
    let requete = supabase
      .from('lots')
      .select('id, numero_lot, depot_id, quantite_initiale, quantite_restante, date_peremption, created_at, etat, etat_motif, etat_modifie_at, recepteur:profils!created_by(nom), modificateur:profils!etat_modifie_par(nom)')
      .eq('produit_id', produit.id)
      .order('created_at', { ascending: false })
    if (depotFiltre) requete = requete.eq('depot_id', depotFiltre)
    const [{ data: lotsData }, coutRes, histRes] = await Promise.all([
      requete,
      voitCouts ? supabase.from('produits_couts').select('prix_achat_moyen, maj_at').eq('produit_id', produit.id).maybeSingle() : Promise.resolve({ data: null }),
      voitCouts
        ? supabase.from('historique_couts_achat').select('quantite, prix_unitaire, prix_moyen_apres, source, created_at, auteur:profils!created_by(nom)').eq('produit_id', produit.id).order('created_at', { ascending: false }).limit(8)
        : Promise.resolve({ data: [] }),
    ])
    setLots(lotsData || [])
    setCout(coutRes.data || null)
    setHistorique(histRes.data || [])
    setChargement(false)
  }

  useEffect(() => { charger() }, [produit.id, depotFiltre])

  async function fixerPrix() {
    setErreur('')
    setEnvoi(true)
    const { error } = await supabase.rpc('definir_prix_achat', { p_produit_id: produit.id, p_prix: Number(prixSaisi) })
    setEnvoi(false)
    if (error) { setErreur(traduireErreur(error.message)); return }
    setPrixSaisi('')
    charger()
    onModifie?.()
  }

  async function validerEtat() {
    setErreur('')
    setEnvoi(true)
    const { error } = await supabase.rpc('changer_etat_lot', { p_lot_id: etatEnCours.lot.id, p_etat: etatEnCours.etat, p_motif: motifEtat })
    setEnvoi(false)
    if (error) { setErreur(traduireErreur(error.message)); return }
    setEtatEnCours(null)
    setMotifEtat('')
    charger()
  }

  // Répartition par magasin et stock sans numéro de lot.
  const parDepot = (produit.stocks || [])
    .filter((s) => !depotFiltre || s.depot_id === depotFiltre)
    .map((s) => {
      const enLots = lots.filter((l) => l.depot_id === s.depot_id).reduce((n, l) => n + Number(l.quantite_restante), 0)
      const endommage = lots.filter((l) => l.depot_id === s.depot_id && l.etat === 'endommage').reduce((n, l) => n + Number(l.quantite_restante), 0)
      return { depot_id: s.depot_id, quantite: Number(s.quantite || 0), sansLot: Math.max(0, Number(s.quantite || 0) - enLots), endommage }
    })
  const totalEndommage = parDepot.reduce((n, d) => n + d.endommage, 0)
  const prixAchat = cout ? Number(cout.prix_achat_moyen) : null
  const margeUnitaire = prixAchat != null ? Number(produit.prix_vente || 0) - prixAchat : null
  const tauxMarge = margeUnitaire != null && Number(produit.prix_vente) > 0 ? (margeUnitaire / Number(produit.prix_vente)) * 100 : null
  const lotsActifs = lots.filter((l) => Number(l.quantite_restante) > 0)
  const lotsEpuises = lots.filter((l) => Number(l.quantite_restante) <= 0)
  const aujourdhui = new Date().toISOString().slice(0, 10)

  const ligneLot = (l) => (
    <tr key={l.id} className="border-b border-line last:border-0 align-top">
      <td className="px-2 py-2 font-mono">{l.numero_lot}</td>
      <td className="px-2 py-2">{nomDepot(l.depot_id)}</td>
      <td className="px-2 py-2 text-right font-mono">{Number(l.quantite_restante)} / {Number(l.quantite_initiale)}</td>
      <td className="px-2 py-2 whitespace-nowrap">{formatDate(l.created_at)}</td>
      <td className={`px-2 py-2 whitespace-nowrap ${l.date_peremption && l.date_peremption < aujourdhui ? 'text-red-600 font-medium' : ''}`}>
        {l.date_peremption ? formatDate(l.date_peremption) : '—'}
      </td>
      <td className="px-2 py-2">{l.recepteur?.nom || '—'}</td>
      <td className="px-2 py-2">
        <span className={`text-xs px-2 py-0.5 rounded-full ${l.etat === 'endommage' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {l.etat === 'endommage' ? t('detail.etatEndommage') : t('detail.etatBon')}
        </span>
        {l.etat_motif && <span className="block text-[11px] text-petrol-500 mt-0.5">{l.etat_motif}{l.modificateur?.nom ? ` — ${l.modificateur.nom}` : ''}</span>}
        {peutChangerEtat && Number(l.quantite_restante) > 0 && (
          <button className="block text-[11px] underline text-amber-700 mt-0.5" onClick={() => { setEtatEnCours({ lot: l, etat: l.etat === 'endommage' ? 'bon' : 'endommage' }); setMotifEtat('') }}>
            {l.etat === 'endommage' ? t('detail.marquerBon') : t('detail.marquerEndommage')}
          </button>
        )}
      </td>
    </tr>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={onFermer}>
      <div className="card w-full max-w-4xl max-h-[92vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold text-lg">{produit.nom}</h2>
            <p className="text-xs text-petrol-500">
              {produit.categorie || '—'} · {t('detail.prixVente')} {formatXOF(produit.prix_vente)}
              {depotFiltre ? ` · ${nomDepot(depotFiltre)}` : ` · ${t('tousLesMagasins')}`}
            </p>
          </div>
          <button data-fermer className="btn-secondary text-sm px-3 py-1.5" onClick={onFermer}>{t('detail.fermer')}</button>
        </div>

        {chargement ? (
          <p className="text-sm text-petrol-500">{t('table.chargement')}</p>
        ) : (
          <div className="space-y-5">
            {/* Répartition par magasin */}
            <div>
              <h3 className="text-sm font-semibold mb-2">📍 {t('detail.parMagasin')}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {parDepot.map((d) => (
                  <div key={d.depot_id} className="rounded-xl border border-line p-3">
                    <p className="text-sm font-medium">{nomDepot(d.depot_id)}</p>
                    <p className="font-mono text-xl font-semibold">{d.quantite}</p>
                    {d.endommage > 0 && <p className="text-xs text-rose-700">{t('detail.dontEndommages', { n: d.endommage })}</p>}
                    {d.sansLot > 0 && <p className="text-xs text-petrol-500">{t('detail.sansLot', { n: d.sansLot })}</p>}
                  </div>
                ))}
              </div>
              {totalEndommage > 0 && <p className="text-xs text-rose-700 mt-2">⚠️ {t('detail.alerteEndommage', { n: totalEndommage })}</p>}
            </div>

            {/* Lots */}
            <div>
              <h3 className="text-sm font-semibold mb-1">🏷️ {t('detail.lots')}</h3>
              <p className="text-xs text-petrol-500 mb-2">{t('detail.lotsAide')}</p>
              {lotsActifs.length === 0 ? (
                <p className="text-sm text-petrol-400">{t('detail.aucunLot')}</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full text-xs min-w-[720px]" data-tableau-classique>
                    <thead>
                      <tr className="bg-canvas text-left text-petrol-600">
                        <th className="px-2 py-2">{t('detail.numeroLot')}</th>
                        <th className="px-2 py-2">{t('detail.magasin')}</th>
                        <th className="px-2 py-2 text-right">{t('detail.restantInitial')}</th>
                        <th className="px-2 py-2">{t('detail.dateEntree')}</th>
                        <th className="px-2 py-2">{t('detail.peremption')}</th>
                        <th className="px-2 py-2">{t('detail.receptionnePar')}</th>
                        <th className="px-2 py-2">{t('detail.etat')}</th>
                      </tr>
                    </thead>
                    <tbody>{lotsActifs.map(ligneLot)}</tbody>
                  </table>
                </div>
              )}
              {lotsEpuises.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-petrol-500 cursor-pointer">{t('detail.lotsEpuises', { n: lotsEpuises.length })}</summary>
                  <div className="overflow-x-auto rounded-xl border border-line mt-2 opacity-70">
                    <table className="w-full text-xs min-w-[720px]" data-tableau-classique><tbody>{lotsEpuises.map(ligneLot)}</tbody></table>
                  </div>
                </details>
              )}
            </div>

            {etatEnCours && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
                <p className="text-sm">
                  {etatEnCours.etat === 'endommage' ? t('detail.confirmerEndommage', { lot: etatEnCours.lot.numero_lot }) : t('detail.confirmerBon', { lot: etatEnCours.lot.numero_lot })}
                </p>
                <input className="input-field" value={motifEtat} onChange={(e) => setMotifEtat(e.target.value)} placeholder={t('detail.motifPlaceholder')} />
                <div className="flex gap-2">
                  <button className="btn-primary text-xs px-3 py-1.5" disabled={envoi || motifEtat.trim().length < 3} onClick={validerEtat}>{t('detail.valider')}</button>
                  <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => setEtatEnCours(null)}>{t('detail.annuler')}</button>
                </div>
              </div>
            )}

            {/* Coûts et marge (jamais visibles par un commercial) */}
            {voitCouts && (
              <div>
                <h3 className="text-sm font-semibold mb-2">💰 {t('detail.coutMarge')}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-xs text-petrol-500">{t('detail.prixRevient')}</p>
                    <p className="font-mono font-semibold">{prixAchat != null ? formatXOF(prixAchat) : '—'}</p>
                  </div>
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-xs text-petrol-500">{t('detail.prixVente')}</p>
                    <p className="font-mono font-semibold">{formatXOF(produit.prix_vente)}</p>
                  </div>
                  {voitMarges && (
                    <>
                      <div className="rounded-xl border border-line p-3">
                        <p className="text-xs text-petrol-500">{t('detail.margeUnitaire')}</p>
                        <p className={`font-mono font-semibold ${margeUnitaire != null && margeUnitaire < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{margeUnitaire != null ? formatXOF(margeUnitaire) : '—'}</p>
                      </div>
                      <div className="rounded-xl border border-line p-3">
                        <p className="text-xs text-petrol-500">{t('detail.tauxMarge')}</p>
                        <p className="font-mono font-semibold">{tauxMarge != null ? `${tauxMarge.toFixed(1)} %` : '—'}</p>
                      </div>
                    </>
                  )}
                </div>
                {prixAchat == null && <p className="text-xs text-petrol-500 mt-2">{t('detail.prixNonRenseigne')}</p>}
                {peutFixerPrix && (
                  <div className="flex flex-wrap gap-2 items-end mt-3">
                    <div>
                      <label className="label">{t('detail.fixerPrix')}</label>
                      <input type="number" min="0" className="input-field w-40" value={prixSaisi} onChange={(e) => setPrixSaisi(e.target.value)} placeholder="0" />
                    </div>
                    <button className="btn-secondary text-sm" disabled={envoi || prixSaisi === ''} onClick={fixerPrix}>{t('detail.enregistrer')}</button>
                  </div>
                )}
                {historique.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-xs text-petrol-500 cursor-pointer">{t('detail.historiqueCouts', { n: historique.length })}</summary>
                    <ul className="mt-2 space-y-1 text-xs">
                      {historique.map((h, i) => (
                        <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-line pb-1">
                          <span>{formatDate(h.created_at)} — {h.source === 'entree' ? t('detail.sourceEntree', { q: Number(h.quantite) }) : t('detail.sourceManuel')} — {h.auteur?.nom || '—'}</span>
                          <span className="font-mono">{formatXOF(h.prix_unitaire)} → {t('detail.moyen')} {formatXOF(h.prix_moyen_apres)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
            {erreur && <p className="text-sm text-red-600">{erreur}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
