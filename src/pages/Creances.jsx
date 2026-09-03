import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { exporterExcel, exporterPDF, genererRecuPaiement, formatMontantPDF } from '../lib/export'
import * as XLSX from 'xlsx'

export default function Creances() {
  const { entreprise, profil } = useAuth()
  const [searchParams] = useSearchParams()
  const filtreEchues = searchParams.get('filtre') === 'echues'
  const [creances, setCreances] = useState([])
  const [chargement, setChargement] = useState(true)

  const [venteOuverte, setVenteOuverte] = useState(null)
  const [modalImportOuvert, setModalImportOuvert] = useState(false)
  const [lignesImport, setLignesImport] = useState([])
  const [erreurImport, setErreurImport] = useState('')
  const [importEnCours, setImportEnCours] = useState(false)
  const [progressionImport, setProgressionImport] = useState(0)
  const [resultatImport, setResultatImport] = useState(null)
  const [detail, setDetail] = useState(null)
  const [chargementDetail, setChargementDetail] = useState(false)
  const [montantPaiement, setMontantPaiement] = useState('')
  const [modePaiementCreance, setModePaiementCreance] = useState('espece')
  const [commercialRecouvrement, setCommercialRecouvrement] = useState('')
  const [commerciaux, setCommerciaux] = useState([])
  const [envoiPaiement, setEnvoiPaiement] = useState(false)
  const [erreurPaiement, setErreurPaiement] = useState('')

  useEffect(() => {
    chargerCreances()
    supabase.from('profils').select('id, nom').eq('role', 'commercial').order('nom').then(({ data }) => setCommerciaux(data || []))
  }, [])

  async function chargerCreances() {
    setChargement(true)
    const { data, error } = await supabase
      .from('ventes')
      .select('id, total, montant_regle, date_echeance, created_at, solde_report, clients(nom, telephone), profils!created_by(nom)')
      .eq('mode_paiement', 'credit')
      .neq('statut', 'annulee')
      .order('date_echeance', { ascending: true, nullsFirst: false })

    if (!error) {
      const ouvertes = (data || []).filter((v) => Number(v.montant_regle) < Number(v.total))
      setCreances(ouvertes)
    }
    setChargement(false)
  }

  const aujourdhui = new Date().toISOString().split('T')[0]
  const estEchue = (v) => v.date_echeance && v.date_echeance < aujourdhui

  const creancesAffichees = filtreEchues ? creances.filter(estEchue) : creances
  const totalAffiche = creancesAffichees.reduce((s, v) => s + (Number(v.total) - Number(v.montant_regle)), 0)

  const COLONNES_EXPORT = [
    { cle: 'client', titre: 'Client' },
    { cle: 'commercial', titre: 'Commercial' },
    { cle: 'echeance', titre: 'Échéance' },
    { cle: 'statut', titre: 'Statut' },
    { cle: 'resteDu', titre: 'Reste dû (F CFA)', alignDroite: true },
  ]
  function donneesExport() {
    return creancesAffichees.map((v) => ({
      client: v.clients?.nom || '—',
      commercial: v.profils?.nom || '—',
      echeance: v.date_echeance ? new Date(v.date_echeance).toLocaleDateString('fr-FR') : '—',
      statut: estEchue(v) ? 'En retard' : 'En cours',
      resteDu: Number(v.total) - Number(v.montant_regle),
    }))
  }
  function exportExcel() {
    exporterExcel('creances', COLONNES_EXPORT, donneesExport())
  }
  function exportPDF() {
    exporterPDF('creances', 'Créances clients', null, COLONNES_EXPORT, donneesExport(), 'Total', formatMontantPDF(totalAffiche) + ' F CFA', entreprise)
  }

  async function ouvrirDetail(venteId) {
    setVenteOuverte(venteId)
    setChargementDetail(true)
    setDetail(null)
    setMontantPaiement('')
    setModePaiementCreance('espece')
    setCommercialRecouvrement(profil?.role === 'commercial' ? profil.id : '')
    setErreurPaiement('')

    const [{ data: vente }, { data: lignes }, { data: paiements }] = await Promise.all([
      supabase
        .from('ventes')
        .select('id, numero_vente, total, montant_regle, date_echeance, created_at, solde_report, notes, clients(nom, telephone, adresse), profils!created_by(nom)')
        .eq('id', venteId)
        .single(),
      supabase.from('ventes_lignes').select('quantite, prix_unitaire, sous_total, produits(nom)').eq('vente_id', venteId),
      supabase.from('reglements').select('montant, mode, created_at').eq('vente_id', venteId).order('created_at'),
    ])

    setDetail({ vente, lignes: lignes || [], paiements: paiements || [] })
    setChargementDetail(false)
  }

  function fermerDetail() {
    setVenteOuverte(null)
    setDetail(null)
  }

  function ouvrirModalImport() {
    setLignesImport([])
    setErreurImport('')
    setResultatImport(null)
    setProgressionImport(0)
    setModalImportOuvert(true)
  }

  function telechargerModeleImport() {
    const feuille = XLSX.utils.aoa_to_sheet([
      ['Client (nom exact)', 'Montant dû', 'Échéance (AAAA-MM-JJ, optionnel)', 'Notes'],
      ['Boutique Exemple', 150000, '2026-10-15', 'Solde au 01/09/2026 — ancien logiciel'],
    ])
    const classeur = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(classeur, feuille, 'Soldes')
    XLSX.writeFile(classeur, 'modele-import-soldes-creances.xlsx')
  }

  async function lireFichierImport(e) {
    const fichier = e.target.files?.[0]
    if (!fichier) return
    setErreurImport('')
    setResultatImport(null)

    const { data: tousClients } = await supabase.from('clients').select('id, nom')
    const parNom = {}
    ;(tousClients || []).forEach((c) => { parNom[c.nom.trim().toLowerCase()] = c.id })

    const lecteur = new FileReader()
    lecteur.onload = (event) => {
      try {
        const classeur = XLSX.read(event.target.result, { type: 'array' })
        const feuille = classeur.Sheets[classeur.SheetNames[0]]
        const lignes = XLSX.utils.sheet_to_json(feuille, {
          header: ['client_nom', 'montant', 'echeance', 'notes'],
          range: 1,
          defval: '',
        })
        const lignesTraitees = lignes
          .filter((l) => String(l.client_nom || '').trim())
          .map((l) => {
            const nomTrim = String(l.client_nom).trim()
            const clientId = parNom[nomTrim.toLowerCase()]
            return {
              clientNom: nomTrim,
              clientId: clientId || null,
              montant: Number(l.montant) || 0,
              echeance: String(l.echeance || '').trim() || null,
              notes: String(l.notes || '').trim() || null,
            }
          })
        setLignesImport(lignesTraitees)
        if (lignesTraitees.length === 0) setErreurImport('Aucune ligne valide trouvée.')
      } catch (err) {
        setErreurImport(`Fichier illisible : ${err.message}`)
      }
    }
    lecteur.readAsArrayBuffer(fichier)
  }

  async function confirmerImport() {
    const lignesValides = lignesImport.filter((l) => l.clientId && l.montant > 0)
    if (lignesValides.length === 0) return
    setImportEnCours(true)
    setErreurImport('')
    let reussis = 0
    const echecs = []

    for (let i = 0; i < lignesValides.length; i++) {
      const l = lignesValides[i]
      const { error } = await supabase.rpc('importer_solde_creance', {
        p_client_id: l.clientId,
        p_montant: l.montant,
        p_date_echeance: l.echeance,
        p_notes: l.notes,
      })
      if (error) echecs.push(`${l.clientNom} : ${error.message}`)
      else reussis++
      setProgressionImport(i + 1)
    }

    setImportEnCours(false)
    setResultatImport({ reussis, total: lignesValides.length, echecs })
    setLignesImport([])
    chargerCreances()
  }

  async function enregistrerPaiement() {
    setErreurPaiement('')
    const montant = Number(montantPaiement)
    if (!montant || montant <= 0) {
      setErreurPaiement('Indiquez un montant valide.')
      return
    }
    const resteDu = Number(detail.vente.total) - Number(detail.vente.montant_regle)
    if (montant > resteDu) {
      setErreurPaiement(`Le montant dépasse le solde restant dû (${formatXOF(resteDu)}).`)
      return
    }
    setEnvoiPaiement(true)
    const { data: reglementId, error } = await supabase.rpc('enregistrer_reglement', {
      p_vente_id: venteOuverte,
      p_montant: montant,
      p_mode: modePaiementCreance,
      p_commercial_id: commercialRecouvrement || null,
    })
    setEnvoiPaiement(false)
    if (error) {
      setErreurPaiement(`Erreur : ${error.message}`)
      return
    }

    const { data: reglement } = await supabase.from('reglements').select('numero').eq('id', reglementId).single()

    const nouveauSolde = resteDu - montant
    const doc = genererRecuPaiement({
      entreprise,
      client: detail.vente.clients,
      montant,
      nouveauSolde,
      total: detail.vente.total,
      date: new Date().toISOString(),
      numero: reglement?.numero,
      venteNumero: detail.vente.numero_vente,
    })
    doc.save(`${reglement?.numero || 'recu-paiement-' + venteOuverte.slice(0, 8)}.pdf`)

    await ouvrirDetail(venteOuverte)
    chargerCreances()
  }

  if (chargement) {
    return <div className="p-4 text-center text-petrol-500">Chargement des créances…</div>
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h1 className="text-xl font-bold">Créances clients</h1>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary text-xs" onClick={exportExcel} disabled={creancesAffichees.length === 0}>
            📊 Excel
          </button>
          <button className="btn-secondary text-xs" onClick={exportPDF} disabled={creancesAffichees.length === 0}>
            📄 PDF
          </button>
          {['admin', 'manager'].includes(profil?.role) && (
            <button className="btn-secondary text-xs" onClick={ouvrirModalImport}>
              📥 Importer
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-petrol-500 mb-4">
        {filtreEchues ? 'Créances échues' : 'Toutes les créances en cours'} — {creancesAffichees.length} —{' '}
        <span className="font-mono font-medium">{formatXOF(totalAffiche)}</span>
      </p>

      <div className="space-y-2">
        {creancesAffichees.map((v) => {
          const echue = estEchue(v)
          const resteDu = Number(v.total) - Number(v.montant_regle)
          return (
            <button
              key={v.id}
              onClick={() => ouvrirDetail(v.id)}
              className={`w-full text-left border rounded-lg p-3 flex justify-between items-center ${
                echue ? 'border-red-300 bg-red-50' : 'border-line bg-white'
              }`}
            >
              <div>
                <p className="font-medium text-sm">
                  {v.clients?.nom || 'Client'}
                  {v.solde_report && <span className="ml-2 text-xs bg-petrol-100 text-petrol-600 px-1.5 py-0.5 rounded">Solde reporté</span>}
                </p>
                <p className="text-xs text-petrol-500">
                  Commercial : {v.profils?.nom || '—'}
                  {v.date_echeance && (
                    <>
                      {' '}— Échéance : {new Date(v.date_echeance).toLocaleDateString('fr-FR')}
                      {echue && <span className="text-red-600 font-medium"> (en retard)</span>}
                    </>
                  )}
                </p>
              </div>
              <span className="font-mono text-sm font-medium shrink-0 ml-2">{formatXOF(resteDu)}</span>
            </button>
          )
        })}
        {creancesAffichees.length === 0 && (
          <p className="text-petrol-400 text-center py-8">Aucune créance {filtreEchues ? 'échue' : ''} pour le moment.</p>
        )}
      </div>

      {venteOuverte && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-5 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-3">
            {chargementDetail ? (
              <p className="text-sm text-petrol-500 text-center py-8">Chargement…</p>
            ) : detail ? (
              <>
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="font-semibold text-lg">{detail.vente?.clients?.nom}</h2>
                    <p className="text-xs text-petrol-500">
                      Vente du {new Date(detail.vente?.created_at).toLocaleDateString('fr-FR')} — Commercial : {detail.vente?.profils?.nom || '—'}
                    </p>
                  </div>
                  <button onClick={fermerDetail} className="text-petrol-400 hover:text-petrol-700 text-xl leading-none">✕</button>
                </div>

                {detail.vente?.solde_report ? (
                  <div className="border border-line rounded-lg p-3 bg-canvas">
                    <p className="text-sm font-medium">Solde reporté (import)</p>
                    {detail.vente?.notes && <p className="text-xs text-petrol-500 mt-1">{detail.vente.notes}</p>}
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-petrol-500 border-b border-line">
                        <th className="font-medium pb-2">Produit</th>
                        <th className="font-medium pb-2 text-right">Qté</th>
                        <th className="font-medium pb-2 text-right">Sous-total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lignes.map((l, i) => (
                        <tr key={i} className="border-b border-line last:border-0">
                          <td className="py-1.5">{l.produits?.nom}</td>
                          <td className="py-1.5 text-right font-mono">{l.quantite}</td>
                          <td className="py-1.5 text-right font-mono">{formatXOF(l.sous_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <div className="flex justify-between text-sm border-t border-line pt-2">
                  <span>Total</span>
                  <span className="font-mono font-medium">{formatXOF(detail.vente?.total)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Déjà réglé</span>
                  <span className="font-mono">{formatXOF(detail.vente?.montant_regle)}</span>
                </div>
                <div className="flex justify-between text-sm font-medium text-amber-700">
                  <span>Reste dû</span>
                  <span className="font-mono">
                    {formatXOF(Number(detail.vente?.total) - Number(detail.vente?.montant_regle))}
                  </span>
                </div>

                {detail.paiements.length > 0 && (
                  <div className="border-t border-line pt-2">
                    <p className="text-xs font-medium text-petrol-600 mb-1">Paiements reçus</p>
                    {detail.paiements.map((p, i) => (
                      <p key={i} className="text-xs text-petrol-600 flex justify-between">
                        <span>{new Date(p.created_at).toLocaleDateString('fr-FR')}</span>
                        <span className="font-mono">{formatXOF(p.montant)}</span>
                      </p>
                    ))}
                  </div>
                )}

                {Number(detail.vente?.montant_regle) < Number(detail.vente?.total) && (
                  <div className="border-t border-line pt-3">
                    <label className="block text-sm font-medium mb-1">Enregistrer un paiement</label>
                    <div className="flex gap-2 mb-2">
                      <input
                        type="number"
                        min="0"
                        className="flex-1 border rounded px-3 py-2 text-sm"
                        value={montantPaiement}
                        onChange={(e) => setMontantPaiement(e.target.value)}
                        placeholder="Montant en F CFA"
                      />
                      <select
                        className="border rounded px-2 py-2 text-sm"
                        value={modePaiementCreance}
                        onChange={(e) => setModePaiementCreance(e.target.value)}
                      >
                        <option value="espece">Espèces</option>
                        <option value="cheque">Chèque</option>
                        <option value="mobile_money">Mobile Money</option>
                        <option value="virement">Virement</option>
                      </select>
                    </div>
                    <div className="mb-2">
                      <label className="text-xs text-petrol-500">Recouvrement effectué par (commercial, optionnel)</label>
                      {profil?.role === 'commercial' ? (
                        <p className="text-sm text-petrol-600 border border-line rounded px-2 py-1.5 mt-1">Vous-même</p>
                      ) : (
                        <select
                          className="input-field mt-1"
                          value={commercialRecouvrement}
                          onChange={(e) => setCommercialRecouvrement(e.target.value)}
                        >
                          <option value="">Aucun (recouvrement de bureau)</option>
                          {commerciaux.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                        </select>
                      )}
                    </div>
                    <button
                      onClick={enregistrerPaiement}
                      disabled={envoiPaiement}
                      className="bg-blue-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50 w-full"
                    >
                      {envoiPaiement ? '…' : 'Valider'}
                    </button>
                    {erreurPaiement && <p className="text-xs text-red-600 mt-1">{erreurPaiement}</p>}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-red-600 text-center py-8">Impossible de charger le détail.</p>
            )}
          </div>
        </div>
      )}

      {modalImportOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="font-semibold text-lg">Importer des soldes de créances</h2>
              <button onClick={() => setModalImportOuvert(false)} className="text-petrol-400 text-xl leading-none">✕</button>
            </div>

            <p className="text-sm text-petrol-600 mb-3">
              Le nom du client doit correspondre exactement à un client déjà enregistré. Créez d'abord les clients
              manquants (page Clients) avant l'import.
            </p>
            <button onClick={telechargerModeleImport} className="btn-secondary text-sm mb-4">
              📄 Télécharger le modèle
            </button>

            <div className="mb-4">
              <label className="label">Fichier Excel (.xlsx)</label>
              <input type="file" accept=".xlsx,.xls" onChange={lireFichierImport} className="text-sm" />
            </div>

            {erreurImport && <p className="text-sm text-red-600 mb-3">{erreurImport}</p>}

            {lignesImport.length > 0 && (
              <>
                <p className="text-sm font-medium mb-2">
                  {lignesImport.filter((l) => l.clientId).length} client(s) reconnu(s) sur {lignesImport.length}
                </p>
                <div className="border border-line rounded-lg overflow-y-auto max-h-48 mb-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-canvas text-left">
                        <th className="px-2 py-1.5">Client</th>
                        <th className="px-2 py-1.5 text-right">Montant</th>
                        <th className="px-2 py-1.5">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignesImport.map((l, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="px-2 py-1.5">{l.clientNom}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{l.montant}</td>
                          <td className="px-2 py-1.5">
                            {l.clientId ? (
                              <span className="text-green-600">✓ trouvé</span>
                            ) : (
                              <span className="text-red-600">✗ client introuvable</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={confirmerImport}
                  disabled={importEnCours || lignesImport.filter((l) => l.clientId).length === 0}
                  className="btn-primary w-full"
                >
                  {importEnCours
                    ? `Import en cours… (${progressionImport}/${lignesImport.filter((l) => l.clientId).length})`
                    : `Importer ${lignesImport.filter((l) => l.clientId).length} solde(s)`}
                </button>
              </>
            )}

            {resultatImport && (
              <div className="mt-3">
                <p className="text-sm text-green-700">
                  ✓ {resultatImport.reussis} solde(s) importé(s) sur {resultatImport.total}.
                </p>
                {resultatImport.echecs.length > 0 && (
                  <div className="text-xs text-red-600 mt-2">
                    {resultatImport.echecs.map((e, i) => <p key={i}>{e}</p>)}
                  </div>
                )}
              </div>
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
