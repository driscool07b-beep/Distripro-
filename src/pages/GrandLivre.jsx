import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatXOF, formatDate } from '../lib/format'
import { exporterExcel, exporterPDF } from '../lib/export'
import { useColonnesRedimensionnables } from '../lib/useColonnesRedimensionnables'

// Grand livre client — même présentation que les grands livres de caisse et
// de banque : période, solde reporté, n° de pièce, colonnes redimensionnables,
// exports Excel / PDF et impression.
const COLONNES = [
  { cle: 'date', titre: 'date', largeur: 100 },
  { cle: 'numero', titre: 'numero', largeur: 150 },
  { cle: 'libelle', titre: 'libelle', largeur: 260 },
  { cle: 'debit', titre: 'debit', largeur: 130, alignDroite: true },
  { cle: 'credit', titre: 'credit', largeur: 130, alignDroite: true },
  { cle: 'solde', titre: 'solde', largeur: 130, alignDroite: true },
]

export default function GrandLivre() {
  const { t, i18n } = useTranslation('grandlivre')
  const { entreprise } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const clientId = searchParams.get('client')
  const { largeurs, PoigneeRedim, largeurTotale } = useColonnesRedimensionnables('grandLivreClient', COLONNES)

  const [clients, setClients] = useState([])
  const [client, setClient] = useState(null)
  const [toutesLignes, setToutesLignes] = useState([])
  const [chargement, setChargement] = useState(false)
  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')

  useEffect(() => {
    supabase.from('clients').select('id, nom').order('nom').then(({ data }) => setClients(data || []))
  }, [])

  useEffect(() => {
    if (clientId) chargerGrandLivre(clientId)
    else {
      setClient(null)
      setToutesLignes([])
    }
  }, [clientId])

  async function chargerGrandLivre(id) {
    setChargement(true)
    const [{ data: clientData }, { data: ventes }] = await Promise.all([
      supabase.from('clients').select('nom, telephone, adresse, ville, limite_credit').eq('id', id).single(),
      supabase
        .from('ventes')
        .select('id, numero_vente, total, mode_paiement, montant_regle, statut, created_at')
        .eq('client_id', id)
        .order('created_at'),
    ])

    const venteIds = (ventes || []).map((v) => v.id)
    let paiements = []
    if (venteIds.length > 0) {
      const { data } = await supabase
        .from('reglements')
        .select('numero, vente_id, montant, created_at')
        .in('vente_id', venteIds)
        .order('created_at')
      paiements = data || []
    }
    const numeroVente = Object.fromEntries((ventes || []).map((v) => [v.id, v.numero_vente]))

    const lignes = []
    ;(ventes || []).forEach((v) => {
      lignes.push({
        date: v.created_at,
        numero: v.numero_vente || '',
        libelle: v.mode_paiement === 'credit' ? t('venteCredit') : t('venteComptant'),
        debit: Number(v.total),
        credit: 0,
      })
      // Vente au comptant : réglée sur le moment.
      if (v.mode_paiement === 'cash' && Number(v.montant_regle) > 0) {
        lignes.push({ date: v.created_at, numero: v.numero_vente || '', libelle: t('reglementComptant'), debit: 0, credit: Number(v.montant_regle) })
      }
      // Vente annulée par avoir : elle reste visible (traçabilité) mais ne
      // doit plus peser sur le solde du client.
      if (v.statut === 'annulee') {
        lignes.push({ date: v.created_at, numero: v.numero_vente || '', libelle: t('annulationAvoir'), debit: 0, credit: Number(v.total) })
      }
    })
    paiements.forEach((p) => {
      lignes.push({
        date: p.created_at,
        numero: p.numero || '',
        libelle: numeroVente[p.vente_id] ? t('paiementRecuSur', { numero: numeroVente[p.vente_id] }) : t('paiementRecu'),
        debit: 0,
        credit: Number(p.montant),
      })
    })
    lignes.sort((a, b) => new Date(a.date) - new Date(b.date))

    setClient(clientData)
    setToutesLignes(lignes)
    setChargement(false)
  }

  // Filtre de période : les mouvements antérieurs forment le « solde reporté ».
  const { lignes, soldeReporte } = useMemo(() => {
    const debut = dateDebut ? new Date(`${dateDebut}T00:00:00`) : null
    const fin = dateFin ? new Date(`${dateFin}T23:59:59`) : null
    let reporte = 0
    const resultat = []
    toutesLignes.forEach((l) => {
      const d = new Date(l.date)
      if (debut && d < debut) { reporte += l.debit - l.credit; return }
      if (fin && d > fin) return
      resultat.push(l)
    })
    let solde = reporte
    return { soldeReporte: reporte, lignes: resultat.map((l) => { solde += l.debit - l.credit; return { ...l, solde } }) }
  }, [toutesLignes, dateDebut, dateFin])

  const soldeFinal = lignes.length > 0 ? lignes[lignes.length - 1].solde : soldeReporte
  const totalDebit = lignes.reduce((s, l) => s + l.debit, 0)
  const totalCredit = lignes.reduce((s, l) => s + l.credit, 0)

  const colonnesExport = COLONNES.map((c) => ({ cle: c.cle, titre: t(c.titre) }))
  function lignesExport() {
    const base = lignes.map((l) => ({
      date: formatDate(l.date), numero: l.numero, libelle: l.libelle,
      debit: l.debit > 0 ? l.debit : '', credit: l.credit > 0 ? l.credit : '', solde: l.solde,
    }))
    return dateDebut ? [{ date: formatDate(dateDebut), numero: '', libelle: t('soldeReporte'), debit: '', credit: '', solde: soldeReporte }, ...base] : base
  }
  const nomFichier = `grand-livre-${(client?.nom || 'client').replace(/\s+/g, '-')}`
  const periode = dateDebut || dateFin ? t('periode', { debut: dateDebut ? formatDate(dateDebut) : '…', fin: dateFin ? formatDate(dateFin) : '…' }) : ''

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="no-print flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h1 className="text-xl font-bold">{t('titre')}</h1>
      </div>

      <div className="no-print flex gap-2 mb-4 items-end flex-wrap">
        <div className="min-w-[220px]">
          <label className="label">{t('choisirClient')}</label>
          <select
            className="input-field"
            value={clientId || ''}
            onChange={(e) => setSearchParams(e.target.value ? { client: e.target.value } : {})}
          >
            <option value="">{t('selectionner')}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </div>
        {client && (
          <>
            <div>
              <label className="label">{t('du')}</label>
              <input type="date" lang={i18n.language} className="input-field text-sm" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
            </div>
            <div>
              <label className="label">{t('au')}</label>
              <input type="date" lang={i18n.language} className="input-field text-sm" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
            </div>
            <div className="flex-1" />
            <button data-aide="grandlivre.excel" onClick={() => exporterExcel(nomFichier, colonnesExport, lignesExport())} className="btn-secondary text-sm">📊 {t('excel')}</button>
            <button
              data-aide="grandlivre.pdf"
              onClick={() => exporterPDF(nomFichier, t('titrePdf', { nom: client.nom }), periode, colonnesExport, lignesExport(), t('soldeFinal'), formatXOF(soldeFinal), entreprise)}
              className="btn-secondary text-sm"
            >📄 {t('pdf')}</button>
            <button data-aide="grandlivre.imprimer" onClick={() => window.print()} className="btn-secondary text-sm">🖨️ {t('imprimer')}</button>
          </>
        )}
      </div>

      {chargement && <p className="text-sm text-petrol-500">{t('chargement')}</p>}

      {client && !chargement && (
        <div>
          <div className="card p-4 mb-4 flex flex-wrap justify-between gap-4">
            <div>
              <p className="text-xs text-petrol-500">{entreprise?.nom} — {t('releveDeCompte')}</p>
              <p className="font-semibold text-lg">{client.nom}</p>
              {client.telephone && <p className="text-sm text-petrol-600">{client.telephone}</p>}
              {client.adresse && <p className="text-sm text-petrol-600">{client.adresse}{client.ville ? `, ${client.ville}` : ''}</p>}
              {periode && <p className="text-xs text-petrol-500 mt-1">{periode}</p>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div><p className="text-xs text-petrol-500">{t('totalDebit')}</p><p className="font-mono font-semibold">{formatXOF(totalDebit)}</p></div>
              <div><p className="text-xs text-petrol-500">{t('totalCredit')}</p><p className="font-mono font-semibold text-green-700">{formatXOF(totalCredit)}</p></div>
              <div><p className="text-xs text-petrol-500">{t('soldeFinal')}</p><p className={`font-mono font-semibold ${soldeFinal > 0 ? 'text-amber-700' : ''}`}>{formatXOF(soldeFinal)}</p></div>
              {client.limite_credit > 0 && (
                <div><p className="text-xs text-petrol-500">{t('plafond')}</p><p className="font-mono font-semibold">{formatXOF(client.limite_credit)}</p></div>
              )}
            </div>
          </div>

          <div className="card overflow-x-auto">
            <table className="text-xs" style={{ tableLayout: 'fixed', width: `max(${largeurTotale}px, 100%)` }}>
              <colgroup>
                {COLONNES.map((c) => <col key={c.cle} style={{ width: largeurs[c.cle] }} />)}
              </colgroup>
              <thead>
                <tr className="border-b border-line bg-canvas text-left text-petrol-600">
                  {COLONNES.map((c) => (
                    <th key={c.cle} className={`relative px-3 py-2 font-medium ${c.alignDroite ? 'text-right' : ''}`}>
                      {t(c.titre)}
                      <PoigneeRedim cle={c.cle} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dateDebut && (
                  <tr className="border-b border-line bg-canvas/60 italic">
                    <td className="px-3 py-2 text-petrol-600">{formatDate(dateDebut)}</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2">{t('soldeReporte')}</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right font-mono font-medium">{formatXOF(soldeReporte)}</td>
                  </tr>
                )}
                {lignes.map((l, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 text-petrol-600 whitespace-nowrap overflow-hidden text-ellipsis">{formatDate(l.date)}</td>
                    <td className="px-3 py-2 whitespace-nowrap overflow-hidden text-ellipsis">{l.numero}</td>
                    <td className="px-3 py-2 overflow-hidden text-ellipsis">{l.libelle}</td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{l.debit > 0 ? formatXOF(l.debit) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-green-700 whitespace-nowrap">{l.credit > 0 ? formatXOF(l.credit) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono font-medium whitespace-nowrap">{formatXOF(l.solde)}</td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-petrol-400">{t('aucunMouvement')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!client && !chargement && <p className="text-petrol-400 text-sm no-print">{t('selectionnezClient')}</p>}
    </div>
  )
}
