import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { accesAutorise } from '../lib/accesRole'
import { exporterExcel, exporterPDF } from '../lib/export'
import { formatXOF } from '../lib/format'

export default function Groupes() {
  const { t } = useTranslation('groupes')
  const { entreprise, profil } = useAuth()
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
      const magasin = l.ventes?.clients?.nom || t('inconnu')
      const produit = l.produits?.nom || t('inconnu')
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

  if (!accesAutorise('groupes', profil?.role)) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">{t('accesRefuse')}</p>
      </div>
    )
  }

  if (chargement) return <div className="p-4 text-center text-petrol-500">{t('chargement')}</div>

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-1">{t('titre')}</h1>
      <p className="text-sm text-petrol-500 mb-4">
        {t('sousTitre')}
      </p>

      <div className="card p-4 mb-4">
        <label className="label">{t('groupe')}</label>
        <select className="input-field" value={groupeSelectionne} onChange={(e) => selectionnerGroupe(e.target.value)}>
          <option value="">{t('selectionnerGroupe')}</option>
          {groupes.map((g) => (
            <option key={g.id} value={g.id}>{g.nom} ({t('magasins', { n: g.clients?.length || 0 })})</option>
          ))}
        </select>
        {groupes.length === 0 && (
          <p className="text-xs text-petrol-400 mt-2">
            {t('aucunGroupe')}
          </p>
        )}
      </div>

      {groupeSelectionne && (
        <>
          <div className="card p-4 mb-4">
            <p className="text-sm font-medium mb-2">{t('magasinsDuGroupe')}</p>
            <div className="flex flex-wrap gap-2">
              {membres.map((m) => (
                <span key={m.id} className="text-xs bg-canvas border border-line rounded-full px-2 py-1">
                  {m.nom}{m.ville ? ` — ${m.ville}` : ''}
                </span>
              ))}
              {membres.length === 0 && <p className="text-xs text-petrol-400">{t('aucunMagasinRattache')}</p>}
            </div>
          </div>

          <div className="card p-4 mb-4">
            <p className="text-sm font-medium mb-2">{t('recapLivraisons')}</p>
            <div className="flex gap-2 items-end mb-3">
              <div className="flex-1">
                <label className="label">{t('du')}</label>
                <input type="date" className="input-field" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className="label">{t('au')}</label>
                <input type="date" className="input-field" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
              </div>
              <button onClick={genererRapport} disabled={chargementRapport} className="btn-primary">
                {chargementRapport ? '…' : t('generer')}
              </button>
            </div>

            {rapport && (
              <>
                <div className="flex gap-2 mb-3">
                  <button className="btn-secondary text-xs" disabled={rapport.length === 0} onClick={() => exporterExcel(`groupe-${groupeNom}-${dateDebut}-${dateFin}`, COLONNES, rapport)}>
                    📊 {t('excel')}
                  </button>
                  <button
                    className="btn-secondary text-xs"
                    disabled={rapport.length === 0}
                    onClick={() => exporterPDF(`groupe-${groupeNom}-${dateDebut}-${dateFin}`, t('recapLivraisonsTitre', { groupe: groupeNom }), t('periode', { debut: dateDebut, fin: dateFin }), COLONNES, rapport, t('total'), formatXOF(totalValeur), entreprise)}
                  >
                    📄 {t('pdf')}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
                        <th className="px-3 py-2">{t('magasin')}</th>
                        <th className="px-3 py-2">{t('produit')}</th>
                        <th className="px-3 py-2 text-right">{t('quantite')}</th>
                        <th className="px-3 py-2 text-right">{t('valeur')}</th>
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
                        <tr><td colSpan={4} className="px-3 py-6 text-center text-petrol-400">{t('aucuneLivraison')}</td></tr>
                      )}
                    </tbody>
                    {rapport.length > 0 && (
                      <tfoot>
                        <tr className="bg-canvas font-semibold">
                          <td className="px-3 py-2" colSpan={3}>{t('total')}</td>
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

