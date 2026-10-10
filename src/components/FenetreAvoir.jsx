import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatXOF } from '../lib/format'
import { traduireErreur } from '../lib/erreurs'
import { emettreAvoirFne, qrCodeFne, visuelFne } from '../lib/fne'
import { genererFactureAvoir } from '../lib/export'

// Avoir sur une vente : retour de marchandise ligne par ligne (quantités au
// choix) ou correction de prix. Le serveur (creer_avoir_vente) contrôle tout
// et calcule le montant ; l'écran montre un aperçu avant validation.
// Réservé à l'administrateur, au manager et au comptable.
export default function FenetreAvoir({ vente, lignes, depots, onTermine, onFermer }) {
  const { t } = useTranslation('ventes')
  const { entreprise } = useAuth()
  const certifieeFne = vente.fne_statut === 'certifiee'
  const modeAbime = entreprise?.avoir_marchandise_abimee || 'perte'

  const [type, setType] = useState('retour')
  const [dejaRendu, setDejaRendu] = useState({}) // vente_ligne_id → quantité déjà rendue
  const [saisie, setSaisie] = useState({}) // vente_ligne_id → { quantite, etat, prix }
  const [commerciaux, setCommerciaux] = useState([])
  const [destination, setDestination] = useState('')
  const [depotAbime, setDepotAbime] = useState('')
  const [motif, setMotif] = useState('')
  const [apercu, setApercu] = useState(null)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    const ids = lignes.map((l) => l.id)
    Promise.all([
      ids.length
        ? supabase.from('avoirs_lignes').select('vente_ligne_id, quantite, avoirs!inner(type_avoir)').in('vente_ligne_id', ids)
        : Promise.resolve({ data: [] }),
      supabase.from('profils').select('id, nom').eq('role', 'commercial').order('nom'),
    ]).then(([{ data: rendus }, { data: com }]) => {
      const cumul = {}
      ;(rendus || []).forEach((r) => {
        if (r.avoirs?.type_avoir === 'prix') return
        cumul[r.vente_ligne_id] = (cumul[r.vente_ligne_id] || 0) + Number(r.quantite)
      })
      setDejaRendu(cumul)
      setCommerciaux(com || [])
    })
    // Destination par défaut : là d'où venait la marchandise.
    const venaitDuCommercial = lignes.some((l) => l.source_stock === 'commercial') || !vente.depot_id
    if (venaitDuCommercial && vente.commercial_id) setDestination(`commercial:${vente.commercial_id}`)
    else if (vente.depot_id) setDestination(`depot:${vente.depot_id}`)
    else if (depots.length === 1) setDestination(`depot:${depots[0].id}`)
  }, [vente.id])

  const rendable = (l) => Math.max(Number(l.quantite) - (dejaRendu[l.id] || 0), 0)
  const majLigne = (id, champ, valeur) => setSaisie((s) => ({ ...s, [id]: { etat: 'bon', ...s[id], [champ]: valeur } }))
  const toutRendre = () => setSaisie(Object.fromEntries(lignes.filter((l) => rendable(l) > 0).map((l) => [l.id, { quantite: String(rendable(l)), etat: saisie[l.id]?.etat || 'bon' }])))

  const lignesDemandees = useMemo(() => lignes
    .map((l) => {
      const s = saisie[l.id] || {}
      const q = Number(s.quantite || 0)
      if (!(q > 0)) return null
      return type === 'prix'
        ? { vente_ligne_id: l.id, quantite: q, prix_corrige: s.prix === '' || s.prix == null ? null : Number(s.prix) }
        : { vente_ligne_id: l.id, quantite: q, etat: s.etat || 'bon' }
    })
    .filter(Boolean), [saisie, type, lignes])

  const toutRendu = type === 'retour' && lignes.every((l) => {
    const q = Number(saisie[l.id]?.quantite || 0)
    return rendable(l) - q <= 0
  }) && lignesDemandees.length > 0
  const auMoinsUnAbime = type === 'retour' && lignesDemandees.some((l) => l.etat === 'abime')
  const destType = destination.split(':')[0]
  const besoinDepotAbime = auMoinsUnAbime && modeAbime === 'stock_endommage' && destType !== 'depot'

  // Aperçu du montant, calculé par le serveur avec la même règle que l'avoir.
  useEffect(() => {
    setApercu(null)
    if (!lignesDemandees.length) return undefined
    const minuterie = setTimeout(async () => {
      const { data, error } = await supabase.rpc('calculer_avoir_vente', { p_vente_id: vente.id, p_type: type, p_lignes: lignesDemandees })
      if (error) return
      const somme = (data || []).reduce((n, l) => n + Number(l.montant || 0), 0)
      setApercu(Math.min(toutRendu ? Number(vente.total) : somme, Number(vente.total)))
    }, 350)
    return () => clearTimeout(minuterie)
  }, [lignesDemandees, toutRendu])

  const resteDu = Math.max(Number(vente.total) - Number(vente.montant_regle || 0), 0)
  const reduction = apercu != null ? Math.min(apercu, resteDu) : 0
  const tropPercu = apercu != null ? apercu - reduction : 0

  async function valider() {
    setErreur('')
    if (!lignesDemandees.length) { setErreur(t('avoir.erreurAucuneLigne')); return }
    if (motif.trim().length < 3) { setErreur(t('avoir.erreurMotif')); return }
    if (type === 'retour' && destType !== 'aucune' && !destination) { setErreur(t('avoir.erreurDestination')); return }
    if (besoinDepotAbime && !depotAbime) { setErreur(t('avoir.erreurDepotAbime')); return }
    setEnvoi(true)
    const [dt, did] = destination.split(':')
    const { data: res, error } = await supabase.rpc('creer_avoir_vente', {
      p_vente_id: vente.id,
      p_type: type,
      p_lignes: lignesDemandees,
      p_motif: motif.trim(),
      p_destination: type === 'prix' ? 'aucune' : (dt || 'depot'),
      p_depot_id: dt === 'depot' ? did : (besoinDepotAbime ? depotAbime : null),
      p_commercial_id: dt === 'commercial' ? did : null,
    })
    if (error) { setEnvoi(false); setErreur(traduireErreur(error.message)); return }

    // Vente certifiée FNE : l'avoir (retour) est certifié auprès de la DGI.
    let fneReference = null
    let fneToken = null
    let alerte = null
    if (res?.certifier_fne) {
      const { data: fne, error: erreurFne } = await emettreAvoirFne(vente.id, res.avoir_id)
      if (erreurFne) alerte = t('fne.echecAvoir', { message: erreurFne })
      else { fneReference = fne?.reference; fneToken = fne?.token }
    }

    // Facture d'avoir (PDF) avec les seules lignes de cet avoir.
    const { data: lignesAvoir } = await supabase.from('avoirs_lignes')
      .select('quantite, prix_unitaire, prix_corrige, montant, etat, produits(nom, reference, unite)').eq('avoir_id', res.avoir_id)
    const doc = genererFactureAvoir({
      entreprise,
      client: vente.clients,
      vente,
      lignes: (lignesAvoir || []).map((l) => ({ ...l, sous_total: l.montant })),
      motif: motif.trim(),
      montant: res.montant,
      date: new Date().toISOString(),
      reference: res.numero,
      fneReference,
      typeAvoir: type,
      qrFne: fneToken ? await qrCodeFne(fneToken) : null,
      visuelFne: fneReference ? await visuelFne() : null,
    })
    doc.save(`${res.numero}.pdf`)
    setEnvoi(false)
    onTermine?.({ ...res, alerte })
  }

  return (
    <div className="no-print border border-red-200 bg-red-50/60 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-red-800">{t('avoir.titre')}</p>
        <button type="button" onClick={onFermer} className="text-xs underline text-petrol-600">{t('detail.retour')}</button>
      </div>

      <div className="inline-flex rounded-lg border border-line bg-white p-0.5 text-xs">
        {[['retour', t('avoir.typeRetour')], ['prix', t('avoir.typePrix')]].map(([k, l]) => (
          <button key={k} type="button" disabled={k === 'prix' && certifieeFne}
            onClick={() => { setType(k); setSaisie({}) }}
            className={`px-3 py-1.5 rounded-md ${type === k ? 'bg-petrol-800 text-white' : 'text-petrol-700'} disabled:opacity-40`}>{l}</button>
        ))}
      </div>
      {certifieeFne && <p className="text-[11px] text-petrol-600">{t('avoir.prixFneImpossible')}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-petrol-500">
              <th className="py-1 pr-2">{t('detail.produit')}</th>
              <th className="py-1 pr-2 text-right">{t('avoir.vendu')}</th>
              <th className="py-1 pr-2 text-right">{t('avoir.dejaRendu')}</th>
              <th className="py-1 pr-2">{type === 'prix' ? t('avoir.quantiteConcernee') : t('avoir.quantiteRendue')}</th>
              <th className="py-1">{type === 'prix' ? t('avoir.nouveauPrix') : t('avoir.etat')}</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => {
              const max = rendable(l)
              const s = saisie[l.id] || {}
              return (
                <tr key={l.id} className="border-t border-red-100">
                  <td className="py-1.5 pr-2">{l.produits?.nom}<span className="block text-[10px] text-petrol-400">{formatXOF(l.prix_unitaire)}</span></td>
                  <td className="py-1.5 pr-2 text-right font-mono">{l.quantite}</td>
                  <td className="py-1.5 pr-2 text-right font-mono">{dejaRendu[l.id] || 0}</td>
                  <td className="py-1.5 pr-2">
                    <input type="number" min="0" max={max} step="1" inputMode="numeric" disabled={max === 0}
                      className="input-field text-xs py-1 w-20" value={s.quantite ?? ''} placeholder="0"
                      onChange={(e) => majLigne(l.id, 'quantite', e.target.value === '' ? '' : String(Math.min(Math.max(Math.floor(Number(e.target.value)), 0), max)))} />
                  </td>
                  <td className="py-1.5">
                    {type === 'prix' ? (
                      <input type="number" min="0" step="1" className="input-field text-xs py-1 w-24" value={s.prix ?? ''}
                        placeholder={String(l.prix_unitaire)} onChange={(e) => majLigne(l.id, 'prix', e.target.value)} />
                    ) : (
                      <select className="input-field text-xs py-1" value={s.etat || 'bon'} onChange={(e) => majLigne(l.id, 'etat', e.target.value)}>
                        <option value="bon">{t('avoir.etatBon')}</option>
                        <option value="abime">{t('avoir.etatAbime')}</option>
                      </select>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {type === 'retour' && (
        <button type="button" onClick={toutRendre} className="text-xs underline text-red-700">{t('avoir.toutRendre')}</button>
      )}

      {type === 'retour' && (
        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-petrol-700">{t('avoir.destination')}</label>
            <select className="input-field text-sm" value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="">{t('detail.choisirMagasin')}</option>
              <optgroup label={t('avoir.magasins')}>
                {depots.map((d) => <option key={d.id} value={`depot:${d.id}`}>🏬 {d.nom}</option>)}
              </optgroup>
              <optgroup label={t('avoir.stockCommercial')}>
                {commerciaux.map((c) => <option key={c.id} value={`commercial:${c.id}`}>🚚 {c.nom}</option>)}
              </optgroup>
              <option value="aucune">{t('avoir.resteChezClient')}</option>
            </select>
            <p className="text-[11px] text-petrol-500 mt-0.5">{t('avoir.aideDestination')}</p>
          </div>
          {besoinDepotAbime && (
            <div>
              <label className="text-xs font-medium text-petrol-700">{t('avoir.magasinAbime')}</label>
              <select className="input-field text-sm" value={depotAbime} onChange={(e) => setDepotAbime(e.target.value)}>
                <option value="">{t('detail.choisirMagasin')}</option>
                {depots.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
      {auMoinsUnAbime && (
        <p className="text-[11px] text-petrol-600">{modeAbime === 'stock_endommage' ? t('avoir.abimeStock') : t('avoir.abimePerte')}</p>
      )}

      <div>
        <label className="text-xs font-medium text-petrol-700">{t('avoir.motif')}</label>
        <textarea className="input-field text-sm" rows={2} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder={t('avoir.motifPlaceholder')} />
      </div>

      {apercu != null && (
        <div className="rounded-lg bg-white border border-line p-2.5 text-xs space-y-1">
          <p className="text-sm">{t('avoir.montant')} : <strong className="font-mono">{formatXOF(apercu)}</strong></p>
          {reduction > 0 && <p>{t('avoir.effetReduction', { montant: formatXOF(reduction) })}</p>}
          {tropPercu > 0 && <p>{vente.client_id || vente.clients ? t('avoir.effetCredit', { montant: formatXOF(tropPercu) }) : t('avoir.effetRembourser', { montant: formatXOF(tropPercu) })}</p>}
          {toutRendu && <p className="text-red-700">{t('avoir.venteSeraAnnulee')}</p>}
          {certifieeFne && type === 'retour' && <p className="text-emerald-700">{t('avoir.seraCertifie')}</p>}
        </div>
      )}

      {erreur && <p className="text-xs text-red-700" role="alert">{erreur}</p>}
      <button type="button" onClick={valider} disabled={envoi || !lignesDemandees.length}
        className="w-full bg-red-600 text-white text-sm rounded-lg px-3 py-2.5 font-semibold disabled:opacity-50">
        {envoi ? t('detail.envoi') : t('avoir.valider')}
      </button>
    </div>
  )
}
