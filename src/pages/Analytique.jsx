import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { exporterExcel, exporterPDF } from '../lib/export'

export default function Analytique() {
  const { t } = useTranslation('analytique')
  const { profil, entreprise } = useAuth()
  const [onglet, setOnglet] = useState('recap')

  const ONGLETS = [
    { id: 'recap', label: t('onglets.recap') },
    { id: 'rotation', label: t('onglets.rotation') },
    { id: 'presence', label: t('onglets.presence') },
    { id: 'manque', label: t('onglets.manque') },
  ]

  if (!['admin', 'manager'].includes(profil?.role)) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">
          {t('accesRefuse')}
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-1">{t('titre')}</h1>
      <p className="text-sm text-petrol-500 mb-4">{entreprise?.nom}</p>

      <div className="flex gap-2 mb-4 flex-wrap">
        {ONGLETS.map((o) => (
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

      {onglet === 'recap' && <RecapQuotidien entreprise={entreprise} />}
      {onglet === 'rotation' && <TauxRotation entreprise={entreprise} />}
      {onglet === 'presence' && <TauxPresence entreprise={entreprise} />}
      {onglet === 'manque' && <ManqueAGagner entreprise={entreprise} />}
    </div>
  )
}

function RecapQuotidien({ entreprise }) {
  const { t } = useTranslation('analytique')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [chargement, setChargement] = useState(true)
  const [lignes, setLignes] = useState([])

  useEffect(() => {
    charger()
  }, [date])

  async function charger() {
    setChargement(true)
    const { data: commerciaux } = await supabase.from('profils').select('id, nom').eq('role', 'commercial').order('nom')

    const { data: tournees } = await supabase
      .from('tournees')
      .select('id, commercial_id, distance_totale_km')
      .eq('date_tournee', date)

    const tourneeIds = (tournees || []).map((t) => t.id)
    let tourneeLignes = []
    if (tourneeIds.length > 0) {
      const { data } = await supabase.from('tournee_lignes').select('tournee_id, statut').in('tournee_id', tourneeIds)
      tourneeLignes = data || []
    }

    const { data: rapports } = await supabase
      .from('rapports_visite')
      .select('commercial_id')
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59.999`)

    const resultat = (commerciaux || []).map((c) => {
      const tourneesDuCommercial = (tournees || []).filter((t) => t.commercial_id === c.id)
      const idsCommercial = tourneesDuCommercial.map((t) => t.id)
      const lignesCommercial = tourneeLignes.filter((l) => idsCommercial.includes(l.tournee_id))
      const distanceTotale = tourneesDuCommercial.reduce((s, t) => s + Number(t.distance_totale_km || 0), 0)
      const nbRapports = (rapports || []).filter((r) => r.commercial_id === c.id).length

      return {
        commercial: c.nom,
        visitesPrevues: lignesCommercial.length,
        visitesFaites: lignesCommercial.filter((l) => l.statut === 'visite').length,
        distanceKm: distanceTotale,
        rapports: nbRapports,
      }
    })

    setLignes(resultat)
    setChargement(false)
  }

  const COLONNES = [
    { cle: 'commercial', titre: 'Commercial' },
    { cle: 'visitesFaites', titre: 'Visites faites', alignDroite: true },
    { cle: 'visitesPrevues', titre: 'Visites prévues', alignDroite: true },
    { cle: 'distanceKm', titre: 'Distance (km)', alignDroite: true },
    { cle: 'rapports', titre: 'Rapports envoyés', alignDroite: true },
  ]

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input type="date" className="input-field max-w-xs" value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          className="btn-secondary text-xs"
          disabled={lignes.length === 0}
          onClick={() => exporterExcel(`recap-${date}`, COLONNES, lignes)}
        >
          📊 {t('excel')}
        </button>
        <button
          className="btn-secondary text-xs"
          disabled={lignes.length === 0}
          onClick={() => exporterPDF(`recap-${date}`, t('onglets.recap'), date, COLONNES, lignes, undefined, undefined, entreprise)}
        >
          📄 {t('pdf')}
        </button>
      </div>

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
                <th className="px-4 py-3 font-medium">{t('recap.commercial')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('recap.visitesFaites')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('recap.visitesPrevues')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('recap.distanceKm')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('recap.rapports')}</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{l.commercial}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {l.visitesFaites}
                    {l.visitesPrevues > 0 && l.visitesFaites < l.visitesPrevues && (
                      <span className="text-amber-600"> ⚠</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{l.visitesPrevues}</td>
                  <td className="px-4 py-3 text-right font-mono">{l.distanceKm.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-mono">{l.rapports}</td>
                </tr>
              ))}
              {lignes.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-petrol-400">{t('recap.aucunCommercial')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TauxRotation({ entreprise }) {
  const { t } = useTranslation('analytique')
  const [chargement, setChargement] = useState(true)
  const [lignes, setLignes] = useState([])

  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setChargement(true)
    const { data, error } = await supabase
      .from('rapport_visite_produits')
      .select('produit_id, quantite_rayon, produits(nom), rapports_visite(created_at, client_id)')
      .not('quantite_rayon', 'is', null)

    if (error || !data) {
      setChargement(false)
      return
    }

    const groupes = {}
    data.forEach((l) => {
      if (!l.rapports_visite) return
      const cle = `${l.produit_id}__${l.rapports_visite.client_id}`
      if (!groupes[cle]) groupes[cle] = { nom: l.produits?.nom, points: [] }
      groupes[cle].points.push({ date: new Date(l.rapports_visite.created_at), qte: l.quantite_rayon })
    })

    const rotationsParProduit = {}
    Object.values(groupes).forEach((g) => {
      g.points.sort((a, b) => a.date - b.date)
      for (let i = 1; i < g.points.length; i++) {
        const jours = (g.points[i].date - g.points[i - 1].date) / 86400000
        const baisse = g.points[i - 1].qte - g.points[i].qte
        if (jours > 0 && baisse > 0) {
          const rotationJour = baisse / jours
          if (!rotationsParProduit[g.nom]) rotationsParProduit[g.nom] = []
          rotationsParProduit[g.nom].push(rotationJour)
        }
      }
    })

    const resultat = Object.entries(rotationsParProduit)
      .map(([nom, valeurs]) => ({
        produit: nom,
        observations: valeurs.length,
        rotationMoyenne: Number((valeurs.reduce((s, v) => s + v, 0) / valeurs.length).toFixed(2)),
      }))
      .sort((a, b) => b.rotationMoyenne - a.rotationMoyenne)

    setLignes(resultat)
    setChargement(false)
  }

  const COLONNES = [
    { cle: 'produit', titre: 'Produit' },
    { cle: 'observations', titre: 'Observations', alignDroite: true },
    { cle: 'rotationMoyenne', titre: 'Rotation moy. (unités/jour)', alignDroite: true },
  ]

  return (
    <div>
      <p className="text-xs text-petrol-500 mb-3">
        {t('rotation.explication')}
      </p>
      <div className="flex gap-2 mb-4">
        <button className="btn-secondary text-xs" disabled={lignes.length === 0} onClick={() => exporterExcel('taux-rotation', COLONNES, lignes)}>
          📊 {t('excel')}
        </button>
        <button className="btn-secondary text-xs" disabled={lignes.length === 0} onClick={() => exporterPDF('taux-rotation', t('onglets.rotation'), null, COLONNES, lignes, undefined, undefined, entreprise)}>
          📄 {t('pdf')}
        </button>
      </div>

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
                <th className="px-4 py-3 font-medium">{t('rotation.produit')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('rotation.observations')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('rotation.rotationMoyenne')}</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{l.produit}</td>
                  <td className="px-4 py-3 text-right font-mono">{l.observations}</td>
                  <td className="px-4 py-3 text-right font-mono">{l.rotationMoyenne}</td>
                </tr>
              ))}
              {lignes.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-petrol-400">{t('rotation.pasAssezDeDonnees')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TauxPresence({ entreprise }) {
  const { t } = useTranslation('analytique')
  const [chargement, setChargement] = useState(true)
  const [propres, setPropres] = useState([])
  const [concurrents, setConcurrents] = useState([])

  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setChargement(true)
    const [{ data: dataPropres }, { data: dataConcurrents }] = await Promise.all([
      supabase.from('rapport_visite_produits').select('produit_id, quantite_rayon, produits(nom)'),
      supabase.from('rapport_visite_concurrents').select('produit_concurrent_id, present, produits_concurrents(nom)'),
    ])

    const groupesPropres = {}
    ;(dataPropres || []).forEach((l) => {
      const nom = l.produits?.nom
      if (!nom) return
      if (!groupesPropres[nom]) groupesPropres[nom] = { total: 0, presents: 0 }
      groupesPropres[nom].total += 1
      if (l.quantite_rayon > 0) groupesPropres[nom].presents += 1
    })

    const groupesConcurrents = {}
    ;(dataConcurrents || []).forEach((l) => {
      const nom = l.produits_concurrents?.nom
      if (!nom) return
      if (!groupesConcurrents[nom]) groupesConcurrents[nom] = { total: 0, presents: 0 }
      groupesConcurrents[nom].total += 1
      if (l.present) groupesConcurrents[nom].presents += 1
    })

    const versLignes = (groupes) =>
      Object.entries(groupes)
        .map(([nom, g]) => ({ produit: nom, visites: g.total, taux: Math.round((g.presents / g.total) * 100) }))
        .sort((a, b) => b.taux - a.taux)

    setPropres(versLignes(groupesPropres))
    setConcurrents(versLignes(groupesConcurrents))
    setChargement(false)
  }

  const COLONNES = [
    { cle: 'produit', titre: 'Produit' },
    { cle: 'visites', titre: 'Visites où relevé', alignDroite: true },
    { cle: 'taux', titre: 'Taux de présence (%)', alignDroite: true },
  ]

  return (
    <div>
      <p className="text-xs text-petrol-500 mb-4">
        {t('presence.explication')}
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-sm">{t('presence.nosProduits')}</h2>
            <div className="flex gap-1">
              <button className="text-xs text-petrol-600 underline" disabled={propres.length === 0} onClick={() => exporterExcel('presence-nos-produits', COLONNES, propres)}>{t('excel')}</button>
              <span className="text-petrol-300">·</span>
              <button className="text-xs text-petrol-600 underline" disabled={propres.length === 0} onClick={() => exporterPDF('presence-nos-produits', `${t('onglets.presence')} — ${t('presence.nosProduits')}`, null, COLONNES, propres, undefined, undefined, entreprise)}>{t('pdf')}</button>
            </div>
          </div>
          <TableauPresence lignes={propres} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-sm">{t('presence.produitsConcurrents')}</h2>
            <div className="flex gap-1">
              <button className="text-xs text-petrol-600 underline" disabled={concurrents.length === 0} onClick={() => exporterExcel('presence-concurrents', COLONNES, concurrents)}>{t('excel')}</button>
              <span className="text-petrol-300">·</span>
              <button className="text-xs text-petrol-600 underline" disabled={concurrents.length === 0} onClick={() => exporterPDF('presence-concurrents', `${t('onglets.presence')} — ${t('presence.produitsConcurrents')}`, null, COLONNES, concurrents, undefined, undefined, entreprise)}>{t('pdf')}</button>
            </div>
          </div>
          <TableauPresence lignes={concurrents} />
        </div>
      </div>

      {chargement && <p className="text-sm text-petrol-500 mt-4">{t('chargement')}</p>}
    </div>
  )
}

function TableauPresence({ lignes }) {
  const { t } = useTranslation('analytique')
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
            <th className="px-3 py-2 font-medium">{t('presence.produit')}</th>
            <th className="px-3 py-2 font-medium text-right">{t('presence.taux')}</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              <td className="px-3 py-2">{l.produit}</td>
              <td className="px-3 py-2 text-right font-mono">
                <span className={l.taux >= 70 ? 'text-green-700' : l.taux >= 40 ? 'text-amber-600' : 'text-red-600'}>
                  {l.taux}%
                </span>
                <span className="text-petrol-400 text-xs"> ({l.visites})</span>
              </td>
            </tr>
          ))}
          {lignes.length === 0 && (
            <tr><td colSpan={2} className="px-3 py-6 text-center text-petrol-400 text-xs">{t('presence.aucuneDonnee')}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function ManqueAGagner({ entreprise }) {
  const { t } = useTranslation('analytique')
  const [chargement, setChargement] = useState(true)
  const [annulees, setAnnulees] = useState([])
  const [livraisonsPartielles, setLivraisonsPartielles] = useState([])
  const [delais, setDelais] = useState([])

  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setChargement(true)

    const [{ data: commandesAnnulees }, { data: lignesLivrees }, { data: commandesLivrees }, { data: historique }] = await Promise.all([
      supabase.from('commandes').select('id, numero, montant_ttc, created_at, clients(nom)').eq('statut', 'annulee'),
      supabase
        .from('lignes_commande')
        .select('quantite, quantite_livree, prix_unitaire, produits(nom), commandes!inner(numero, statut, clients(nom))')
        .eq('commandes.statut', 'livree'),
      supabase.from('commandes').select('id, numero, date_livraison_souhaitee, clients(nom)').eq('statut', 'livree').not('date_livraison_souhaitee', 'is', null),
      supabase.from('commande_historique').select('commande_id, created_at').eq('nouveau_statut', 'livree'),
    ])

    setAnnulees(
      (commandesAnnulees || []).map((c) => ({
        numero: c.numero,
        client: c.clients?.nom || '—',
        montant: Number(c.montant_ttc || 0),
        date: new Date(c.created_at).toLocaleDateString('fr-FR'),
      }))
    )

    const ecarts = (lignesLivrees || [])
      .map((l) => {
        const livree = l.quantite_livree ?? l.quantite
        const manque = l.quantite - livree
        return {
          numero: l.commandes?.numero,
          client: l.commandes?.clients?.nom || '—',
          produit: l.produits?.nom,
          manqueQte: manque,
          manqueValeur: manque * Number(l.prix_unitaire || 0),
        }
      })
      .filter((l) => l.manqueQte > 0)
    setLivraisonsPartielles(ecarts)

    const dateLivraisonParCommande = {}
    ;(historique || []).forEach((h) => {
      if (!dateLivraisonParCommande[h.commande_id]) dateLivraisonParCommande[h.commande_id] = h.created_at
    })
    const delaisCalcules = (commandesLivrees || [])
      .map((c) => {
        const dateEffective = dateLivraisonParCommande[c.id]
        if (!dateEffective) return null
        const jours = Math.round((new Date(dateEffective) - new Date(c.date_livraison_souhaitee)) / 86400000)
        return { numero: c.numero, client: c.clients?.nom || '—', jours }
      })
      .filter(Boolean)
      .sort((a, b) => b.jours - a.jours)
    setDelais(delaisCalcules)

    setChargement(false)
  }

  const totalAnnule = annulees.reduce((s, c) => s + c.montant, 0)
  const totalManque = livraisonsPartielles.reduce((s, l) => s + l.manqueValeur, 0)
  const retardMoyen = delais.length > 0 ? Math.round(delais.reduce((s, d) => s + d.jours, 0) / delais.length) : null
  const enRetard = delais.filter((d) => d.jours > 0).length

  const COLONNES_ANNULEES = [
    { cle: 'numero', titre: 'Commande' },
    { cle: 'client', titre: 'Client' },
    { cle: 'date', titre: 'Date' },
    { cle: 'montant', titre: 'Montant perdu (F CFA)', alignDroite: true },
  ]
  const COLONNES_ECARTS = [
    { cle: 'numero', titre: 'Commande' },
    { cle: 'client', titre: 'Client' },
    { cle: 'produit', titre: 'Produit' },
    { cle: 'manqueQte', titre: 'Qté manquante', alignDroite: true },
    { cle: 'manqueValeur', titre: 'Valeur manquante (F CFA)', alignDroite: true },
  ]

  if (chargement) return <p className="text-sm text-petrol-500">{t('chargement')}</p>

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-sm">{t('manque.commandesAnnulees')}</h2>
          <div className="flex gap-2">
            <button className="text-xs text-petrol-600 underline" disabled={annulees.length === 0} onClick={() => exporterExcel('commandes-annulees', COLONNES_ANNULEES, annulees)}>{t('excel')}</button>
            <button className="text-xs text-petrol-600 underline" disabled={annulees.length === 0} onClick={() => exporterPDF('commandes-annulees', t('manque.commandesAnnulees'), null, COLONNES_ANNULEES, annulees, t('manque.valeurTotalePerdue'), formatXOF(totalAnnule), entreprise)}>{t('pdf')}</button>
          </div>
        </div>
        <p className="text-xs text-petrol-500 mb-2">{t('manque.valeurTotalePerdue')} : <span className="font-semibold text-red-600">{formatXOF(totalAnnule)}</span></p>
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-petrol-600">
                <th className="px-3 py-2">{t('manque.commande')}</th>
                <th className="px-3 py-2">{t('manque.client')}</th>
                <th className="px-3 py-2">{t('manque.date')}</th>
                <th className="px-3 py-2 text-right">{t('manque.montant')}</th>
              </tr>
            </thead>
            <tbody>
              {annulees.map((c, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">{c.numero}</td>
                  <td className="px-3 py-2">{c.client}</td>
                  <td className="px-3 py-2">{c.date}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatXOF(c.montant)}</td>
                </tr>
              ))}
              {annulees.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-petrol-400">{t('manque.aucuneCommandeAnnulee')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-sm">{t('manque.livraisonsPartielles')}</h2>
          <div className="flex gap-2">
            <button className="text-xs text-petrol-600 underline" disabled={livraisonsPartielles.length === 0} onClick={() => exporterExcel('livraisons-partielles', COLONNES_ECARTS, livraisonsPartielles)}>{t('excel')}</button>
            <button className="text-xs text-petrol-600 underline" disabled={livraisonsPartielles.length === 0} onClick={() => exporterPDF('livraisons-partielles', t('manque.livraisonsPartielles'), null, COLONNES_ECARTS, livraisonsPartielles, t('manque.manqueAGagnerTotal'), formatXOF(totalManque), entreprise)}>{t('pdf')}</button>
          </div>
        </div>
        <p className="text-xs text-petrol-500 mb-2">{t('manque.manqueAGagnerTotal')} : <span className="font-semibold text-amber-600">{formatXOF(totalManque)}</span></p>
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-petrol-600">
                <th className="px-3 py-2">{t('manque.commande')}</th>
                <th className="px-3 py-2">{t('manque.client')}</th>
                <th className="px-3 py-2">{t('manque.produit')}</th>
                <th className="px-3 py-2 text-right">{t('manque.qteManquante')}</th>
                <th className="px-3 py-2 text-right">{t('manque.valeur')}</th>
              </tr>
            </thead>
            <tbody>
              {livraisonsPartielles.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">{l.numero}</td>
                  <td className="px-3 py-2">{l.client}</td>
                  <td className="px-3 py-2">{l.produit}</td>
                  <td className="px-3 py-2 text-right font-mono">{l.manqueQte}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatXOF(l.manqueValeur)}</td>
                </tr>
              ))}
              {livraisonsPartielles.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-petrol-400">{t('manque.aucuneRupture')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="font-semibold text-sm mb-2">{t('manque.delaisLivraison')}</h2>
        {retardMoyen !== null && (
          <p className="text-xs text-petrol-500 mb-2">
            {t('manque.retardMoyen')} : <span className={`font-semibold ${retardMoyen > 0 ? 'text-red-600' : 'text-green-600'}`}>{retardMoyen > 0 ? `+${retardMoyen}` : retardMoyen} {t('manque.jours')}</span>
            {' — '}{t('manque.commandesLivreesEnRetard', { enRetard, total: delais.length })}
          </p>
        )}
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-petrol-600">
                <th className="px-3 py-2">{t('manque.commande')}</th>
                <th className="px-3 py-2">{t('manque.client')}</th>
                <th className="px-3 py-2 text-right">{t('manque.ecartVsSouhaite')}</th>
              </tr>
            </thead>
            <tbody>
              {delais.map((d, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">{d.numero}</td>
                  <td className="px-3 py-2">{d.client}</td>
                  <td className={`px-3 py-2 text-right font-mono ${d.jours > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {d.jours > 0 ? `+${d.jours} j` : d.jours === 0 ? t('manque.aTemps') : `${d.jours} j`}
                  </td>
                </tr>
              ))}
              {delais.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-petrol-400">{t('manque.pasAssezDeDonneesDelai')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function formatXOF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0) + ' F CFA'
}
