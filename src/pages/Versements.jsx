import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { exporterExcel, exporterPDF, formatMontantPDF } from '../lib/export'

export default function Versements() {
  const { profil, entreprise } = useAuth()
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [chargement, setChargement] = useState(true)
  const [lignes, setLignes] = useState([])

  const autorise = ['admin', 'manager', 'comptable'].includes(profil?.role)

  useEffect(() => {
    if (autorise) charger()
  }, [date, autorise])

  async function charger() {
    setChargement(true)

    const { data: commerciaux } = await supabase.from('profils').select('id, nom').eq('role', 'commercial').order('nom')

    const { data: ventesCash } = await supabase
      .from('ventes')
      .select('montant_regle, commercial_id')
      .eq('mode_paiement', 'cash')
      .not('commercial_id', 'is', null)
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59.999`)

    const { data: recouvrements } = await supabase
      .from('reglements')
      .select('montant, created_by')
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59.999`)

    const resultat = (commerciaux || []).map((c) => {
      const cash = (ventesCash || [])
        .filter((v) => v.commercial_id === c.id)
        .reduce((s, v) => s + Number(v.montant_regle || 0), 0)
      const recouvre = (recouvrements || [])
        .filter((p) => p.created_by === c.id)
        .reduce((s, p) => s + Number(p.montant || 0), 0)
      return {
        commercial: c.nom,
        ventesCash: cash,
        recouvrement: recouvre,
        total: cash + recouvre,
      }
    })

    setLignes(resultat.filter((l) => l.total > 0))
    setChargement(false)
  }

  if (!autorise) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">Cette page est réservée à la comptabilité et à la direction.</p>
      </div>
    )
  }

  const totalGeneral = lignes.reduce((s, l) => s + l.total, 0)

  const COLONNES = [
    { cle: 'commercial', titre: 'Commercial' },
    { cle: 'ventesCash', titre: 'Ventes cash (F CFA)', alignDroite: true },
    { cle: 'recouvrement', titre: 'Recouvrement créances (F CFA)', alignDroite: true },
    { cle: 'total', titre: 'Total à verser (F CFA)', alignDroite: true },
  ]

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Montants à verser par commercial</h1>
      <p className="text-sm text-petrol-500 mb-4">
        {entreprise?.nom} — ventes cash et recouvrements de créances enregistrés dans la journée.
      </p>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input type="date" className="input-field max-w-xs" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn-secondary text-xs" disabled={lignes.length === 0} onClick={() => exporterExcel(`versements-${date}`, COLONNES, lignes)}>
          📊 Excel
        </button>
        <button
          className="btn-secondary text-xs"
          disabled={lignes.length === 0}
          onClick={() => exporterPDF(`versements-${date}`, 'Montants à verser', `${entreprise?.nom} — ${date}`, COLONNES, lignes, 'Total général', formatMontantPDF(totalGeneral) + ' F CFA')}
        >
          📄 PDF
        </button>
      </div>

      {chargement ? (
        <p className="text-sm text-petrol-500">Chargement…</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
                <th className="px-4 py-3 font-medium">Commercial</th>
                <th className="px-4 py-3 font-medium text-right">Ventes cash</th>
                <th className="px-4 py-3 font-medium text-right">Recouvrement créances</th>
                <th className="px-4 py-3 font-medium text-right">Total à verser</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{l.commercial}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatXOF(l.ventesCash)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatXOF(l.recouvrement)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{formatXOF(l.total)}</td>
                </tr>
              ))}
              {lignes.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-petrol-400">Aucun montant dû ce jour-là.</td></tr>
              )}
            </tbody>
            {lignes.length > 0 && (
              <tfoot>
                <tr className="bg-canvas font-semibold">
                  <td className="px-4 py-3" colSpan={3}>Total général</td>
                  <td className="px-4 py-3 text-right font-mono">{formatXOF(totalGeneral)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <p className="text-xs text-petrol-400 mt-3">
        Le recouvrement de créances est attribué au commercial ayant enregistré le paiement dans l'appli.
        Ces montants sont à rapprocher des sommes effectivement remises en caisse.
      </p>
    </div>
  )
}

function formatXOF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0) + ' F CFA'
}
