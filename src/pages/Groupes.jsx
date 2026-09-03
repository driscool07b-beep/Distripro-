import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { exporterExcel, exporterPDF } from '../lib/export'

export default function Groupes() {
  const { entreprise } = useAuth()
  const [groupes, setGroupes] = useState([])
  const [chargement, setChargement] = useState(true)
  const [groupeSelectionne, setGroupeSelectionne] = useState('')
  const [membres, setMembres] = useState([])
  const [dateDebut, setDateDebut] = useState(premierJourDuMois())
  const [dateFin, setDateFin] = useState(new Date().toISOString().split('T')[0])
  const [rapport, setRapport] = useState(null)
  const [chargementRapport, setChargementRapport] = useState(false)

  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setChargement(true)
    const { data } = await supabase
      .from('groupes_clients')
      .select('id, nom, clients(id)')
      .order('nom')
    setGroupes(data || [])
    setChargement(false)
  }

  async function selectionnerGroupe(id) {
    setGroupeSelectionne(id)
    setRapport(null)
    if (!id) {
      setMembres([])
      return
    }
    const { data } = await supabase.from('clients').select('id, nom, ville').eq('groupe_id', id).order('nom')
    setMembres(data || [])
  }

  async function genererRapport() {
    if (!groupeSelectionne) return
    setChargementRapport(true)
    setRapport(null)

    const idsClients = membres.map((m) => m.id)
    if (idsClients.length === 0) {
      setRapport([])
      setChargementRapport(false)
      return
    }

    const { data } = await supabase
      .from('ventes_lignes')
      .select('quantite, sous_total, produits(nom), ventes!inner(created_at, client_id, statut, clients(nom))')
      .in('ventes.client_id', idsClients)
      .neq('ventes.statut', 'annulee')
      .gte('ventes.created_at', `${dateDebut}T00:00:00`)
      .lt('ventes.created_at', `${dateFin}T23:59:59.999`)

    const groupesMagasinProduit = {}
    ;(data || []).forEach((l) => {
      const magasin = l.ventes?.clients?.nom || 'Inconnu'
      const produit = l.produits?.nom || 'Inconnu'
      const cle = `${magasin}__${produit}`
      if (!groupesMagasinProduit[cle]) {
        groupesMagasinProduit[cle] = { magasin, produit, quantite: 0, valeur: 0 }
      }
      groupesMagasinProduit[cle].quantite += l.quantite
      groupesMagasinProduit[cle].valeur += Number(l.sous_total || 0)
    })

    const lignes = Object.values(groupesMagasinProduit).sort((a, b) => a.magasin.localeCompare(b.magasin) || a.produit.localeCompare(b.produit))
    setRapport(lignes)
    setChargementRapport(false)
  }

  const totalValeur = (rapport || []).reduce((s, l) => s + l.valeur, 0)
  const groupeNom = groupes.find((g) => g.id === groupeSelectionne)?.nom || ''

  const COLONNES = [
    { cle: 'magasin', titre: 'Magasin' },
    { cle: 'produit', titre: 'Produit' },
    { cle: 'quantite', titre: 'Quantité', alignDroite: true },
    { cle: 'valeur', titre: 'Valeur (F CFA)', alignDroite: true },
  ]

  if (chargement) return <div className="p-4 text-center text-petrol-500">Chargement…</div>

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Groupes de clients</h1>
      <p className="text-sm text-petrol-500 mb-4">
        Chaînes de magasins livrées individuellement, facturées globalement après récap.
      </p>

      <div className="card p-4 mb-4">
        <label className="label">Groupe</label>
        <select className="input-field" value={groupeSelectionne} onChange={(e) => selectionnerGroupe(e.target.value)}>
          <option value="">— Sélectionner un groupe —</option>
          {groupes.map((g) => (
            <option key={g.id} value={g.id}>{g.nom} ({g.clients?.length || 0} magasin(s))</option>
          ))}
        </select>
        {groupes.length === 0 && (
          <p className="text-xs text-petrol-400 mt-2">
            Aucun groupe créé. Vous pouvez en créer un depuis la fiche d'un client (section "Groupe").
          </p>
        )}
      </div>

      {groupeSelectionne && (
        <>
          <div className="card p-4 mb-4">
            <p className="text-sm font-medium mb-2">Magasins du groupe</p>
            <div className="flex flex-wrap gap-2">
              {membres.map((m) => (
                <span key={m.id} className="text-xs bg-canvas border border-line rounded-full px-2 py-1">
                  {m.nom}{m.ville ? ` — ${m.ville}` : ''}
                </span>
              ))}
              {membres.length === 0 && <p className="text-xs text-petrol-400">Aucun magasin rattaché à ce groupe.</p>}
            </div>
          </div>

          <div className="card p-4 mb-4">
            <p className="text-sm font-medium mb-2">Récap des livraisons</p>
            <div className="flex gap-2 items-end mb-3">
              <div className="flex-1">
                <label className="label">Du</label>
                <input type="date" className="input-field" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className="label">Au</label>
                <input type="date" className="input-field" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
              </div>
              <button onClick={genererRapport} disabled={chargementRapport} className="btn-primary">
                {chargementRapport ? '…' : 'Générer'}
              </button>
            </div>

            {rapport && (
              <>
                <div className="flex gap-2 mb-3">
                  <button className="btn-secondary text-xs" disabled={rapport.length === 0} onClick={() => exporterExcel(`groupe-${groupeNom}-${dateDebut}-${dateFin}`, COLONNES, rapport)}>
                    📊 Excel
                  </button>
                  <button
                    className="btn-secondary text-xs"
                    disabled={rapport.length === 0}
                    onClick={() => exporterPDF(`groupe-${groupeNom}-${dateDebut}-${dateFin}`, `Récap livraisons — ${groupeNom}`, `${dateDebut} au ${dateFin}`, COLONNES, rapport, 'Total', formatXOF(totalValeur), entreprise)}
                  >
                    📄 PDF
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
                        <th className="px-3 py-2">Magasin</th>
                        <th className="px-3 py-2">Produit</th>
                        <th className="px-3 py-2 text-right">Quantité</th>
                        <th className="px-3 py-2 text-right">Valeur</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rapport.map((l, i) => (
                        <tr key={i} className="border-b border-line last:border-0">
                          <td className="px-3 py-2">{l.magasin}</td>
                          <td className="px-3 py-2">{l.produit}</td>
                          <td className="px-3 py-2 text-right font-mono">{l.quantite}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatXOF(l.valeur)}</td>
                        </tr>
                      ))}
                      {rapport.length === 0 && (
                        <tr><td colSpan={4} className="px-3 py-6 text-center text-petrol-400">Aucune livraison sur cette période.</td></tr>
                      )}
                    </tbody>
                    {rapport.length > 0 && (
                      <tfoot>
                        <tr className="bg-canvas font-semibold">
                          <td className="px-3 py-2" colSpan={3}>Total</td>
                          <td className="px-3 py-2 text-right font-mono">{formatXOF(totalValeur)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function premierJourDuMois() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
}

function formatXOF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0).replace(/[\u202F\u00A0]/g, ' ') + ' F CFA'
}
