import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '../lib/supabase'
import { formatXOF, formatDate } from '../lib/format'
import { traduireErreur } from '../lib/erreurs'
import { ecrireEnTeteEntreprise } from '../lib/export'

// Règlement groupé : un paiement du siège d'un groupe réparti sur les
// factures impayées de ses membres (les plus anciennes d'abord, modifiable).
export default function ReglementGroupe({ entreprise, onFermer, onEnregistre }) {
  const { t } = useTranslation('creances')
  const [groupes, setGroupes] = useState([])
  const [banques, setBanques] = useState([])
  const [groupeId, setGroupeId] = useState('')
  const [factures, setFactures] = useState([])
  const [parts, setParts] = useState({})
  const [montant, setMontant] = useState('')
  const [mode, setMode] = useState('virement')
  const [reference, setReference] = useState('')
  const [banqueId, setBanqueId] = useState('')
  const [clientExcedent, setClientExcedent] = useState('')
  const [erreur, setErreur] = useState('')
  const [envoi, setEnvoi] = useState(false)

  useEffect(() => {
    supabase.from('groupes_clients').select('id, nom, compte_numero').order('nom').then(({ data }) => setGroupes(data || []))
    supabase.from('banques').select('id, nom').order('nom').then(({ data }) => setBanques(data || []))
  }, [])

  useEffect(() => {
    if (!groupeId) { setFactures([]); return }
    supabase
      .from('ventes')
      .select('id, numero_vente, total, montant_regle, date_echeance, created_at, statut, clients!inner(id, nom, groupe_id, compte_numero)')
      .eq('clients.groupe_id', groupeId)
      .order('created_at')
      .then(({ data }) => {
        const ouvertes = (data || [])
          .filter((v) => v.statut !== 'annulee' && Number(v.total) - Number(v.montant_regle) > 0)
          .sort((a, b) => (a.date_echeance || a.created_at).localeCompare(b.date_echeance || b.created_at))
        setFactures(ouvertes)
        setParts({})
      })
  }, [groupeId])

  const reste = (f) => Number(f.total) - Number(f.montant_regle)
  const totalParts = Object.values(parts).reduce((s, v) => s + Number(v || 0), 0)
  const excedent = Math.max(Number(montant || 0) - totalParts, 0)
  const membres = [...new Map(factures.map((f) => [f.clients.id, f.clients])).values()]

  // Répartition automatique : les échéances les plus anciennes d'abord.
  function repartirAuto() {
    let disponible = Number(montant || 0)
    const nouvelles = {}
    factures.forEach((f) => {
      const p = Math.min(reste(f), disponible)
      if (p > 0) { nouvelles[f.id] = p; disponible -= p }
    })
    setParts(nouvelles)
  }

  async function valider() {
    setErreur('')
    if (totalParts > Number(montant || 0)) { setErreur(t('groupe.erreurDepasse')); return }
    setEnvoi(true)
    const { data: id, error } = await supabase.rpc('enregistrer_reglement_groupe', {
      p_groupe_id: groupeId,
      p_montant: Number(montant),
      p_mode: mode,
      p_repartition: Object.entries(parts).filter(([, v]) => Number(v) > 0).map(([vente_id, v]) => ({ vente_id, montant: Number(v) })),
      p_reference: reference || null,
      p_banque_id: ['virement', 'cheque'].includes(mode) ? (banqueId || null) : null,
      p_client_excedent_id: excedent > 0 ? (clientExcedent || null) : null,
    })
    setEnvoi(false)
    if (error) { setErreur(traduireErreur(error.message)); return }
    const { data: rg } = await supabase.from('reglements_groupes').select('numero').eq('id', id).single()
    imprimerRecu(rg?.numero || '')
    onEnregistre?.()
  }

  function imprimerRecu(numero) {
    const groupe = groupes.find((g) => g.id === groupeId)
    const doc = new jsPDF()
    const y = ecrireEnTeteEntreprise(doc, entreprise)
    doc.setFontSize(14)
    doc.text(`${t('groupe.recuTitre')} ${numero}`, 14, y + 6)
    doc.setFontSize(10)
    doc.text(`${t('groupe.groupe')} : ${groupe?.nom || ''}${groupe?.compte_numero ? ` (${groupe.compte_numero})` : ''} — ${formatDate(new Date())}`, 14, y + 13)
    doc.text(`${t('groupe.montantRecu')} : ${formatXOF(Number(montant))} — ${t(`groupe.modes.${mode}`)}${reference ? ` — ${reference}` : ''}`, 14, y + 19)
    autoTable(doc, {
      startY: y + 25,
      head: [[t('groupe.client'), t('groupe.compte'), t('groupe.facture'), t('groupe.regle')]],
      body: factures.filter((f) => Number(parts[f.id]) > 0).map((f) => [f.clients.nom, f.clients.compte_numero || '', f.numero_vente || '', formatXOF(Number(parts[f.id]))]),
      styles: { fontSize: 9 },
    })
    let y2 = doc.lastAutoTable.finalY + 8
    if (excedent > 0) {
      doc.text(t('groupe.excedentRecu', { montant: formatXOF(excedent), client: membres.find((m) => m.id === clientExcedent)?.nom || '' }), 14, y2)
      y2 += 8
    }
    doc.save(`${numero || 'reglement-groupe'}.pdf`)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={onFermer}>
      <div className="card bg-white w-full max-w-3xl max-h-[92vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <div>
            <h2 className="font-semibold text-lg">{t('groupe.titre')}</h2>
            <p className="text-xs text-petrol-500">{t('groupe.aide')}</p>
          </div>
          <button data-fermer className="btn-secondary text-sm px-3 py-1.5" onClick={onFermer}>{t('groupe.fermer')}</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">{t('groupe.groupe')}</label>
            <select className="input-field" value={groupeId} onChange={(e) => setGroupeId(e.target.value)}>
              <option value="">{t('groupe.choisir')}</option>
              {groupes.map((g) => <option key={g.id} value={g.id}>{g.nom}{g.compte_numero ? ` — ${g.compte_numero}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('groupe.montantRecu')}</label>
            <input type="number" min="0" className="input-field" value={montant} onChange={(e) => setMontant(e.target.value)} />
          </div>
          <div>
            <label className="label">{t('groupe.mode')}</label>
            <select className="input-field" value={mode} onChange={(e) => setMode(e.target.value)}>
              {['virement', 'cheque', 'mobile_money', 'espece'].map((m) => <option key={m} value={m}>{t(`groupe.modes.${m}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('groupe.reference')}</label>
            <input className="input-field" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('groupe.referencePlaceholder')} />
          </div>
          {['virement', 'cheque'].includes(mode) && banques.length > 0 && (
            <div>
              <label className="label">{t('groupe.banque')}</label>
              <select className="input-field" value={banqueId} onChange={(e) => setBanqueId(e.target.value)}>
                <option value="">{t('groupe.choisir')}</option>
                {banques.map((b) => <option key={b.id} value={b.id}>{b.nom}</option>)}
              </select>
            </div>
          )}
        </div>

        {groupeId && (
          <div>
            <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
              <p className="text-sm font-medium">{t('groupe.factures', { n: factures.length })}</p>
              <button className="btn-secondary text-xs" disabled={!Number(montant)} onClick={repartirAuto}>⚡ {t('groupe.repartirAuto')}</button>
            </div>
            {factures.length === 0 ? <p className="text-sm text-petrol-400">{t('groupe.aucuneFacture')}</p> : (
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-xs min-w-[560px]" data-tableau-classique>
                  <thead>
                    <tr className="bg-canvas text-left text-petrol-600">
                      <th className="px-2 py-2">{t('groupe.client')}</th>
                      <th className="px-2 py-2">{t('groupe.facture')}</th>
                      <th className="px-2 py-2">{t('groupe.echeance')}</th>
                      <th className="px-2 py-2 text-right">{t('groupe.resteDu')}</th>
                      <th className="px-2 py-2 text-right">{t('groupe.regle')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {factures.map((f) => (
                      <tr key={f.id} className="border-t border-line">
                        <td className="px-2 py-1.5">{f.clients.nom}<span className="block font-mono text-[10px] text-petrol-400">{f.clients.compte_numero}</span></td>
                        <td className="px-2 py-1.5">{f.numero_vente}</td>
                        <td className="px-2 py-1.5">{f.date_echeance ? formatDate(f.date_echeance) : '—'}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatXOF(reste(f))}</td>
                        <td className="px-2 py-1.5 text-right">
                          <input type="number" min="0" max={reste(f)} className="input-field !py-1 !px-2 w-28 text-right"
                            value={parts[f.id] ?? ''} onChange={(e) => setParts({ ...parts, [f.id]: Math.min(Number(e.target.value || 0), reste(f)) || '' })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="text-sm mt-2 space-y-1">
              <p>{t('groupe.totalReparti')} : <span className="font-mono font-semibold">{formatXOF(totalParts)}</span></p>
              {excedent > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 space-y-1">
                  <p className="text-amber-800">{t('groupe.excedent', { montant: formatXOF(excedent) })}</p>
                  <select className="input-field text-sm" value={clientExcedent} onChange={(e) => setClientExcedent(e.target.value)}>
                    <option value="">{t('groupe.choisirClientExcedent')}</option>
                    {membres.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}

        {erreur && <p className="text-sm text-red-600">{erreur}</p>}
        <button className="btn-primary w-full" disabled={envoi || !groupeId || !Number(montant) || totalParts <= 0 || (excedent > 0 && !clientExcedent)} onClick={valider}>
          {envoi ? '…' : t('groupe.valider')}
        </button>
      </div>
    </div>
  )
}
