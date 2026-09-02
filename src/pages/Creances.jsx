import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { exporterExcel, exporterPDF, genererRecuPaiement, formatMontantPDF } from '../lib/export'

export default function Creances() {
  const { entreprise } = useAuth()
  const [searchParams] = useSearchParams()
  const filtreEchues = searchParams.get('filtre') === 'echues'
  const [creances, setCreances] = useState([])
  const [chargement, setChargement] = useState(true)

  const [venteOuverte, setVenteOuverte] = useState(null)
  const [detail, setDetail] = useState(null)
  const [chargementDetail, setChargementDetail] = useState(false)
  const [montantPaiement, setMontantPaiement] = useState('')
  const [envoiPaiement, setEnvoiPaiement] = useState(false)
  const [erreurPaiement, setErreurPaiement] = useState('')

  useEffect(() => {
    chargerCreances()
  }, [])

  async function chargerCreances() {
    setChargement(true)
    const { data, error } = await supabase
      .from('ventes')
      .select('id, total, montant_regle, date_echeance, created_at, clients(nom, telephone), profils!created_by(nom)')
      .eq('mode_paiement', 'credit')
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
    exporterPDF('creances', 'Créances clients', entreprise?.nom, COLONNES_EXPORT, donneesExport(), 'Total', formatMontantPDF(totalAffiche) + ' F CFA')
  }

  async function ouvrirDetail(venteId) {
    setVenteOuverte(venteId)
    setChargementDetail(true)
    setDetail(null)
    setMontantPaiement('')
    setErreurPaiement('')

    const [{ data: vente }, { data: lignes }, { data: paiements }] = await Promise.all([
      supabase
        .from('ventes')
        .select('id, total, montant_regle, date_echeance, created_at, clients(nom, telephone, adresse), profils!created_by(nom)')
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
    const { error } = await supabase.rpc('enregistrer_reglement', {
      p_vente_id: venteOuverte,
      p_montant: montant,
      p_mode: 'espece',
    })
    setEnvoiPaiement(false)
    if (error) {
      setErreurPaiement(`Erreur : ${error.message}`)
      return
    }

    const nouveauSolde = resteDu - montant
    const doc = genererRecuPaiement({
      entreprise,
      client: detail.vente.clients,
      montant,
      nouveauSolde,
      total: detail.vente.total,
      date: new Date().toISOString(),
    })
    doc.save(`recu-paiement-${venteOuverte.slice(0, 8)}-${Date.now()}.pdf`)

    await ouvrirDetail(venteOuverte)
    chargerCreances()
  }

  if (chargement) {
    return <div className="p-4 text-center text-petrol-500">Chargement des créances…</div>
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">Créances clients</h1>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" onClick={exportExcel} disabled={creancesAffichees.length === 0}>
            📊 Excel
          </button>
          <button className="btn-secondary text-xs" onClick={exportPDF} disabled={creancesAffichees.length === 0}>
            📄 PDF
          </button>
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
                <p className="font-medium text-sm">{v.clients?.nom || 'Client'}</p>
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
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="0"
                        className="flex-1 border rounded px-3 py-2 text-sm"
                        value={montantPaiement}
                        onChange={(e) => setMontantPaiement(e.target.value)}
                        placeholder="Montant en F CFA"
                      />
                      <button
                        onClick={enregistrerPaiement}
                        disabled={envoiPaiement}
                        className="bg-blue-600 text-white px-4 rounded text-sm disabled:opacity-50"
                      >
                        {envoiPaiement ? '…' : 'Valider'}
                      </button>
                    </div>
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
    </div>
  )
}

function formatXOF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0) + ' F CFA'
}
