import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function GrandLivre() {
  const { entreprise } = useAuth()
  const [searchParams] = useSearchParams()
  const clientId = searchParams.get('client')

  const [clients, setClients] = useState([])
  const [client, setClient] = useState(null)
  const [mouvements, setMouvements] = useState([])
  const [chargement, setChargement] = useState(false)

  useEffect(() => {
    supabase.from('clients').select('id, nom').order('nom').then(({ data }) => setClients(data || []))
  }, [])

  useEffect(() => {
    if (clientId) chargerGrandLivre(clientId)
    else {
      setClient(null)
      setMouvements([])
    }
  }, [clientId])

  async function chargerGrandLivre(id) {
    setChargement(true)

    const [{ data: clientData }, { data: ventes }] = await Promise.all([
      supabase.from('clients').select('nom, telephone, adresse, ville, limite_credit').eq('id', id).single(),
      supabase
        .from('ventes')
        .select('id, total, mode_paiement, montant_regle, created_at')
        .eq('client_id', id)
        .order('created_at'),
    ])

    const venteIds = (ventes || []).map((v) => v.id)
    let paiements = []
    if (venteIds.length > 0) {
      const { data: paiementsData } = await supabase
        .from('reglements')
        .select('vente_id, montant, created_at')
        .in('vente_id', venteIds)
        .order('created_at')
      paiements = paiementsData || []
    }

    const lignesVentes = (ventes || []).map((v) => ({
      type: 'vente',
      date: v.created_at,
      libelle: `Vente${v.mode_paiement === 'credit' ? ' (crédit)' : ' (comptant)'}`,
      debit: Number(v.total),
      credit: 0,
    }))
    // Les ventes cash sont réglées immédiatement : on ajoute la ligne de règlement
    // correspondante datée du même jour, pour que le solde reflète uniquement les impayés.
    const lignesReglementsComptant = (ventes || [])
      .filter((v) => v.mode_paiement === 'cash' && Number(v.montant_regle) > 0)
      .map((v) => ({
        type: 'paiement',
        date: v.created_at,
        libelle: 'Règlement comptant',
        debit: 0,
        credit: Number(v.montant_regle),
      }))
    const lignesPaiements = paiements.map((p) => ({
      type: 'paiement',
      date: p.created_at,
      libelle: 'Paiement reçu',
      debit: 0,
      credit: Number(p.montant),
    }))

    const tout = [...lignesVentes, ...lignesReglementsComptant, ...lignesPaiements].sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    )

    let solde = 0
    const avecSolde = tout.map((l) => {
      solde += l.debit - l.credit
      return { ...l, solde }
    })

    setClient(clientData)
    setMouvements(avecSolde)
    setChargement(false)
  }

  const soldeFinal = mouvements.length > 0 ? mouvements[mouvements.length - 1].solde : 0

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="no-print flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Grand livre client</h1>
        {client && (
          <button onClick={() => window.print()} className="btn-secondary text-sm">
            🖨️ Imprimer
          </button>
        )}
      </div>

      <div className="no-print mb-4">
        <label className="label">Choisir un client</label>
        <select
          className="input-field max-w-sm"
          value={clientId || ''}
          onChange={(e) => {
            const url = e.target.value ? `/grand-livre?client=${e.target.value}` : '/grand-livre'
            window.location.href = url
          }}
        >
          <option value="">— Sélectionner —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.nom}</option>
          ))}
        </select>
      </div>

      {chargement && <p className="text-sm text-petrol-500">Chargement…</p>}

      {client && !chargement && (
        <div>
          <div className="mb-4 pb-4 border-b border-line">
            <h2 className="font-semibold text-lg">{entreprise?.nom}</h2>
            <p className="text-xs text-petrol-500 mb-2">Relevé de compte</p>
            <p className="font-medium">{client.nom}</p>
            {client.telephone && <p className="text-sm text-petrol-600">{client.telephone}</p>}
            {client.adresse && <p className="text-sm text-petrol-600">{client.adresse}{client.ville ? `, ${client.ville}` : ''}</p>}
            {client.limite_credit > 0 && (
              <p className="text-xs text-petrol-500 mt-1">Limite de crédit : {formatXOF(client.limite_credit)}</p>
            )}
          </div>

          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="text-left text-xs text-petrol-500 border-b border-line">
                <th className="font-medium pb-2">Date</th>
                <th className="font-medium pb-2">Libellé</th>
                <th className="font-medium pb-2 text-right">Débit</th>
                <th className="font-medium pb-2 text-right">Crédit</th>
                <th className="font-medium pb-2 text-right">Solde</th>
              </tr>
            </thead>
            <tbody>
              {mouvements.map((m, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="py-2 text-petrol-600">{new Date(m.date).toLocaleDateString('fr-FR')}</td>
                  <td className="py-2">{m.libelle}</td>
                  <td className="py-2 text-right font-mono">{m.debit > 0 ? formatXOF(m.debit) : '—'}</td>
                  <td className="py-2 text-right font-mono text-green-700">{m.credit > 0 ? formatXOF(m.credit) : '—'}</td>
                  <td className="py-2 text-right font-mono">{formatXOF(m.solde)}</td>
                </tr>
              ))}
              {mouvements.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-petrol-400">Aucun mouvement pour ce client.</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="flex justify-end">
            <div className="text-right">
              <p className="text-xs text-petrol-500">Solde final</p>
              <p className={`font-mono text-xl font-semibold ${soldeFinal > 0 ? 'text-amber-700' : 'text-petrol-900'}`}>
                {formatXOF(soldeFinal)}
              </p>
            </div>
          </div>
        </div>
      )}

      {!client && !chargement && (
        <p className="text-petrol-400 text-sm no-print">Sélectionnez un client pour voir son historique.</p>
      )}
    </div>
  )
}

function formatXOF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0) + ' F CFA'
}
