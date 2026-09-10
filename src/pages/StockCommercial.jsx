import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { traduireErreur } from '../lib/erreurs'

export default function StockCommercial() {
  const { t } = useTranslation('stockcommercial')
  const { profil } = useAuth()
  const [onglet, setOnglet] = useState('enmain')

  const gestionComplete = ['admin', 'manager', 'gestionnaire_stock'].includes(profil?.role)
  const lectureSeuleCommercial = profil?.role === 'commercial'

  if (!gestionComplete && !lectureSeuleCommercial) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">
          {t('accesRefuse')}
        </p>
      </div>
    )
  }

  if (lectureSeuleCommercial) {
    return (
      <div className="p-4 max-w-3xl mx-auto">
        <h1 className="text-xl font-bold mb-4">{t('monStockEnMain')}</h1>
        <StockEnMain />
      </div>
    )
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-4">{t('stockDesCommerciaux')}</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { id: 'enmain', label: t('ongletStockEnMain') },
          { id: 'sorties', label: t('ongletSortiesRetours') },
        ].map((o) => (
          <button
            key={o.id}
            onClick={() => setOnglet(o.id)}
            className={`text-sm px-3 py-1.5 rounded-full border ${
              onglet === o.id ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {onglet === 'enmain' && <StockEnMain />}
      {onglet === 'sorties' && <SortiesRetours />}
    </div>
  )
}

function StockEnMain() {
  const { t } = useTranslation('stockcommercial')
  const [chargement, setChargement] = useState(true)
  const [lignes, setLignes] = useState([])

  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setChargement(true)
    const { data } = await supabase
      .from('stock_commercial')
      .select('quantite, profils!commercial_id(nom), produits(nom, prix_vente)')
      .gt('quantite', 0)
    setLignes(data || [])
    setChargement(false)
  }

  const groupes = {}
  lignes.forEach((l) => {
    const nom = l.profils?.nom || t('inconnu')
    if (!groupes[nom]) groupes[nom] = { lignes: [], valeur: 0 }
    const valeur = l.quantite * (l.produits?.prix_vente || 0)
    groupes[nom].lignes.push({ produit: l.produits?.nom, quantite: l.quantite, valeur })
    groupes[nom].valeur += valeur
  })

  if (chargement) return <p className="text-sm text-petrol-500">{t('chargement')}</p>

  return (
    <div className="space-y-4">
      {Object.entries(groupes).map(([nom, g]) => (
        <div key={nom} className="card p-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="font-semibold text-sm">{nom}</h2>
            <span className="font-mono text-sm font-medium">{formatXOF(g.valeur)}</span>
          </div>
          <table className="w-full text-xs">
            <tbody>
              {g.lignes.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5">{l.produit}</td>
                  <td className="py-1.5 text-right font-mono">{l.quantite}</td>
                  <td className="py-1.5 text-right font-mono text-petrol-500">{formatXOF(l.valeur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {Object.keys(groupes).length === 0 && (
        <p className="text-petrol-400 text-center py-8 text-sm">{t('aucunStockEnMain')}</p>
      )}
    </div>
  )
}

function SortiesRetours() {
  const { t } = useTranslation('stockcommercial')
  const [sorties, setSorties] = useState([])
  const [chargement, setChargement] = useState(true)
  const [modalOuvert, setModalOuvert] = useState(false)
  const [commerciaux, setCommerciaux] = useState([])
  const [depots, setDepots] = useState([])
  const [produits, setProduits] = useState([])
  const [commercialId, setCommercialId] = useState('')
  const [depotId, setDepotId] = useState('')
  const [lignesSortie, setLignesSortie] = useState([{ produit_id: '', quantite: 1 }])
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState('')

  const [sortieOuverte, setSortieOuverte] = useState(null)
  const [detail, setDetail] = useState(null)
  const [quantitesRetour, setQuantitesRetour] = useState({})
  const [reconciliation, setReconciliation] = useState(null)
  const [actionEnvoi, setActionEnvoi] = useState(false)
  const [erreurAction, setErreurAction] = useState('')

  useEffect(() => {
    chargerSorties()
  }, [])

  async function chargerSorties() {
    setChargement(true)
    const { data } = await supabase
      .from('sorties_stock')
      .select('id, statut, date_sortie, created_at, profils!commercial_id(nom), sortie_stock_lignes(id)')
      .order('created_at', { ascending: false })
      .limit(50)
    setSorties(data || [])
    setChargement(false)
  }

  async function ouvrirModalSortie() {
    setErreur('')
    setCommercialId('')
    setDepotId('')
    setLignesSortie([{ produit_id: '', quantite: 1 }])
    const [{ data: com }, { data: dep }, { data: prod }] = await Promise.all([
      supabase.from('profils').select('id, nom').eq('role', 'commercial').order('nom'),
      supabase.from('depots').select('id, nom').eq('actif', true).order('nom'),
      supabase.from('produits').select('id, nom').eq('actif', true).order('nom'),
    ])
    setCommerciaux(com || [])
    setDepots(dep || [])
    if (dep && dep.length === 1) setDepotId(dep[0].id)
    setProduits(prod || [])
    setModalOuvert(true)
  }

  function ajouterLigneSortie() {
    setLignesSortie((prev) => [...prev, { produit_id: '', quantite: 1 }])
  }
  function majLigneSortie(i, champ, val) {
    setLignesSortie((prev) => prev.map((l, idx) => (idx === i ? { ...l, [champ]: val } : l)))
  }
  function retirerLigneSortie(i) {
    setLignesSortie((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function validerSortie(e) {
    e.preventDefault()
    setErreur('')
    if (!commercialId || !depotId) {
      setErreur(t('erreurCommercialDepot'))
      return
    }
    const valides = lignesSortie.filter((l) => l.produit_id && Number(l.quantite) > 0)
    if (valides.length === 0) {
      setErreur(t('erreurAuMoinsUnArticle'))
      return
    }
    setEnregistrement(true)
    const { error } = await supabase.rpc('creer_sortie_stock', {
      p_commercial_id: commercialId,
      p_depot_id: depotId,
      p_lignes: valides.map((l) => ({ produit_id: l.produit_id, quantite: Number(l.quantite) })),
    })
    setEnregistrement(false)
    if (error) {
      setErreur(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    setModalOuvert(false)
    chargerSorties()
  }

  async function ouvrirDetailSortie(sortieId) {
    setSortieOuverte(sortieId)
    setDetail(null)
    setReconciliation(null)
    setErreurAction('')

    const { data: sortie } = await supabase
      .from('sorties_stock')
      .select('id, statut, commercial_id, date_sortie, depot_id, profils!commercial_id(nom), sortie_stock_lignes(id, produit_id, quantite_sortie, prix_unitaire, quantite_retournee, produits(nom))')
      .eq('id', sortieId)
      .single()

    setDetail(sortie)
    const init = {}
    ;(sortie?.sortie_stock_lignes || []).forEach((l) => { init[l.produit_id] = l.quantite_retournee ?? l.quantite_sortie })
    setQuantitesRetour(init)

    if (sortie?.statut === 'cloturee') {
      const { data: ventes } = await supabase
        .from('ventes')
        .select('id, ventes_lignes(produit_id, quantite)')
        .eq('commercial_id', sortie.commercial_id)
        .gte('created_at', `${sortie.date_sortie}T00:00:00`)
        .lt('created_at', `${sortie.date_sortie}T23:59:59.999`)

      const venduSelonVentes = {}
      ;(ventes || []).forEach((v) => {
        ;(v.ventes_lignes || []).forEach((l) => {
          venduSelonVentes[l.produit_id] = (venduSelonVentes[l.produit_id] || 0) + l.quantite
        })
      })

      const lignesRecon = (sortie.sortie_stock_lignes || []).map((l) => {
        const venduImplicite = l.quantite_sortie - (l.quantite_retournee ?? 0)
        const venduReel = venduSelonVentes[l.produit_id] || 0
        return {
          produit: l.produits?.nom,
          venduImplicite,
          venduReel,
          ecart: venduImplicite - venduReel,
        }
      })
      setReconciliation(lignesRecon)
    }
  }

  function fermerDetail() {
    setSortieOuverte(null)
    setDetail(null)
    setReconciliation(null)
  }

  async function validerRetour() {
    setActionEnvoi(true)
    setErreurAction('')
    const lignes = (detail.sortie_stock_lignes || []).map((l) => ({
      produit_id: l.produit_id,
      quantite_retournee: Number(quantitesRetour[l.produit_id] ?? 0),
    }))
    const { error } = await supabase.rpc('retourner_stock', {
      p_sortie_id: sortieOuverte,
      p_lignes_retour: lignes,
    })
    setActionEnvoi(false)
    if (error) {
      setErreurAction(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    await ouvrirDetailSortie(sortieOuverte)
    chargerSorties()
  }

  return (
    <div>
      <button onClick={ouvrirModalSortie} className="btn-primary text-sm mb-4">
        {t('nouvelleSortie')}
      </button>

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <div className="space-y-2">
          {sorties.map((s) => (
            <button
              key={s.id}
              onClick={() => ouvrirDetailSortie(s.id)}
              className="w-full text-left border border-line rounded-lg p-3 flex justify-between items-center hover:bg-canvas/60"
            >
              <div>
                <p className="font-medium text-sm">{s.profils?.nom || t('commercial')}</p>
                <p className="text-xs text-petrol-500">
                  {new Date(s.date_sortie).toLocaleDateString('fr-FR')} — {t('articles', { n: s.sortie_stock_lignes?.length || 0 })}
                </p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full border ${s.statut === 'ouverte' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                {s.statut === 'ouverte' ? t('enTournee') : t('cloturee')}
              </span>
            </button>
          ))}
          {sorties.length === 0 && <p className="text-petrol-400 text-center py-8 text-sm">{t('aucuneSortie')}</p>}
        </div>
      )}

      {modalOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-4">{t('modalTitre')}</h2>
            <form onSubmit={validerSortie} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('commercial')}</label>
                  <select className="input-field" value={commercialId} onChange={(e) => setCommercialId(e.target.value)}>
                    <option value="">{t('selectionner')}</option>
                    {commerciaux.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{t('depotSource')}</label>
                  <select className="input-field" value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                    <option value="">{t('selectionner')}</option>
                    {depots.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">{t('articlesASortir')}</label>
                <div className="space-y-2">
                  {lignesSortie.map((l, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <select
                        className="input-field flex-1"
                        value={l.produit_id}
                        onChange={(e) => majLigneSortie(i, 'produit_id', e.target.value)}
                      >
                        <option value="">{t('produitPlaceholder')}</option>
                        {produits.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
                      </select>
                      <input
                        type="number"
                        min="1"
                        className="input-field w-20"
                        value={l.quantite}
                        onChange={(e) => majLigneSortie(i, 'quantite', e.target.value)}
                      />
                      {lignesSortie.length > 1 && (
                        <button type="button" onClick={() => retirerLigneSortie(i)} className="text-red-600 text-sm px-1">✕</button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={ajouterLigneSortie} className="text-xs text-petrol-600 underline mt-2">
                  {t('ajouterArticle')}
                </button>
              </div>

              {erreur && <p className="text-sm text-red-600">{erreur}</p>}

              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setModalOuvert(false)}>{t('annuler')}</button>
                <button type="submit" disabled={enregistrement} className="btn-primary flex-1">
                  {enregistrement ? t('enregistrement') : t('emettreSortie')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {sortieOuverte && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-3">
            {!detail ? (
              <p className="text-sm text-petrol-500 text-center py-8">{t('chargement')}</p>
            ) : (
              <>
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="font-semibold text-lg">{detail.profils?.nom}</h2>
                    <p className="text-xs text-petrol-500">{new Date(detail.date_sortie).toLocaleDateString('fr-FR')}</p>
                  </div>
                  <button onClick={fermerDetail} className="text-petrol-400 text-xl leading-none">✕</button>
                </div>

                {detail.statut === 'ouverte' ? (
                  <div>
                    <p className="text-sm font-medium mb-2">{t('quantitesRetournees')}</p>
                    <div className="space-y-2">
                      {(detail.sortie_stock_lignes || []).map((l) => (
                        <div key={l.id} className="flex items-center justify-between gap-3">
                          <span className="text-sm">{l.produits?.nom} <span className="text-petrol-400">({t('sorti', { n: l.quantite_sortie })})</span></span>
                          <input
                            type="number"
                            min="0"
                            max={l.quantite_sortie}
                            className="w-20 border rounded px-2 py-1 text-sm"
                            value={quantitesRetour[l.produit_id] ?? l.quantite_sortie}
                            onChange={(e) => setQuantitesRetour((prev) => ({ ...prev, [l.produit_id]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                    {erreurAction && <p className="text-sm text-red-600 mt-2">{erreurAction}</p>}
                    <button
                      onClick={validerRetour}
                      disabled={actionEnvoi}
                      className="bg-green-600 text-white px-4 py-2 rounded text-sm mt-3 w-full"
                    >
                      {actionEnvoi ? t('envoi') : t('validerRetourCloturer')}
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium mb-2">{t('reconciliationTitre')}</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-petrol-500 border-b border-line">
                          <th className="pb-1">{t('produit')}</th>
                          <th className="pb-1 text-right">{t('venduImplicite')}</th>
                          <th className="pb-1 text-right">{t('venduReel')}</th>
                          <th className="pb-1 text-right">{t('ecart')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(reconciliation || []).map((r, i) => (
                          <tr key={i} className="border-b border-line last:border-0">
                            <td className="py-1.5">{r.produit}</td>
                            <td className="py-1.5 text-right font-mono">{r.venduImplicite}</td>
                            <td className="py-1.5 text-right font-mono">{r.venduReel}</td>
                            <td className={`py-1.5 text-right font-mono font-medium ${r.ecart !== 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {r.ecart > 0 ? `+${r.ecart}` : r.ecart}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(reconciliation || []).some((r) => r.ecart !== 0) && (
                      <p className="text-xs text-red-600 mt-2">
                        {t('ecartDetecte')}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function formatXOF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0) + ' F CFA'
}
