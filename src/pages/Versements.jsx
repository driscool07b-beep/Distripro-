import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { exporterExcel, exporterPDF, genererAccuseVersement, formatMontantPDF } from '../lib/export'
import { traduireErreur } from '../lib/erreurs'

export default function Versements() {
  const { t } = useTranslation('versements')
  const { profil, entreprise } = useAuth()
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [chargement, setChargement] = useState(true)
  const [lignes, setLignes] = useState([])
  const [caisses, setCaisses] = useState([])

  const [modalOuvert, setModalOuvert] = useState(false)
  const [commercialVersement, setCommercialVersement] = useState(null)
  const [caisseId, setCaisseId] = useState('')
  const [montantVersement, setMontantVersement] = useState('')
  const [envoiVersement, setEnvoiVersement] = useState(false)
  const [erreurVersement, setErreurVersement] = useState('')

  const autorise = ['admin', 'manager', 'comptable'].includes(profil?.role)

  useEffect(() => {
    if (autorise) {
      charger()
      supabase.from('caisses').select('id, nom').eq('actif', true).order('nom').then(({ data }) => setCaisses(data || []))
    }
  }, [date, autorise])

  async function charger() {
    setChargement(true)

    // Tout profil pouvant encaisser une vente ou un recouvrement (cf. rôles
    // autorisés dans creer_vente / enregistrer_reglement), pas seulement les
    // commerciaux de terrain — le dirigeant doit voir toutes les entrées
    // d'argent, y compris celles faites au bureau en son absence.
    const { data: personnel } = await supabase
      .from('profils')
      .select('id, nom, role')
      .in('role', ['commercial', 'admin', 'manager', 'comptable'])
      .order('nom')

    const { data: ventesCash } = await supabase
      .from('ventes')
      .select('montant_regle, commercial_id, created_by')
      .eq('mode_paiement', 'cash')
      .neq('statut', 'annulee')
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59.999`)

    const { data: recouvrements } = await supabase
      .from('reglements')
      .select('montant, commercial_id, created_by')
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59.999`)

    const { data: versementsFaits } = await supabase
      .from('versements_caisse')
      .select('montant, commercial_id')
      .eq('date_versement', date)

    const resultat = (personnel || []).map((c) => {
      const cash = (ventesCash || [])
        .filter((v) => (v.commercial_id || v.created_by) === c.id)
        .reduce((s, v) => s + Number(v.montant_regle || 0), 0)
      const recouvre = (recouvrements || [])
        .filter((p) => (p.commercial_id || p.created_by) === c.id)
        .reduce((s, p) => s + Number(p.montant || 0), 0)
      const dejaVerse = (versementsFaits || [])
        .filter((v) => v.commercial_id === c.id)
        .reduce((s, v) => s + Number(v.montant || 0), 0)
      const total = cash + recouvre
      return {
        commercialId: c.id,
        commercial: c.nom,
        role: c.role,
        ventesCash: cash,
        recouvrement: recouvre,
        total,
        dejaVerse,
        resteAVerser: total - dejaVerse,
      }
    })

    setLignes(resultat.filter((l) => l.total > 0))
    setChargement(false)
  }

  function ouvrirModalVersement(ligne) {
    setCommercialVersement(ligne)
    setCaisseId(caisses.length === 1 ? caisses[0].id : '')
    setMontantVersement(String(ligne.resteAVerser))
    setErreurVersement('')
    setModalOuvert(true)
  }

  async function confirmerVersement() {
    setErreurVersement('')
    const montant = Number(montantVersement)
    if (!caisseId) {
      setErreurVersement(t('erreurSelectionnerCaisse'))
      return
    }
    if (!montant || montant <= 0) {
      setErreurVersement(t('erreurMontantValide'))
      return
    }
    setEnvoiVersement(true)
    const { data: versementId, error } = await supabase.rpc('enregistrer_versement_caisse', {
      p_commercial_id: commercialVersement.commercialId,
      p_caisse_id: caisseId,
      p_montant: montant,
      p_date_versement: date,
    })
    setEnvoiVersement(false)
    if (error) {
      setErreurVersement(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }

    const { data: versement } = await supabase
      .from('versements_caisse')
      .select('numero, montant, date_versement, profils!recu_par(nom)')
      .eq('id', versementId)
      .single()
    const caisse = caisses.find((c) => c.id === caisseId)

    const doc = genererAccuseVersement({
      entreprise,
      versement,
      commercial: { nom: commercialVersement.commercial },
      caisse,
      recuPar: versement?.profils,
    })
    doc.save(`${versement?.numero || 'accuse-versement'}.pdf`)

    setModalOuvert(false)
    charger()
  }

  if (!autorise) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">{t('accesRefuse')}</p>
      </div>
    )
  }

  const totalGeneral = lignes.reduce((s, l) => s + l.total, 0)
  const totalResteAVerser = lignes.reduce((s, l) => s + Math.max(l.resteAVerser, 0), 0)

  const COLONNES = [
    { cle: 'commercial', titre: 'Commercial' },
    { cle: 'ventesCash', titre: 'Ventes cash (F CFA)', alignDroite: true },
    { cle: 'recouvrement', titre: 'Recouvrement créances (F CFA)', alignDroite: true },
    { cle: 'total', titre: 'Total à verser (F CFA)', alignDroite: true },
    { cle: 'resteAVerser', titre: 'Reste à verser (F CFA)', alignDroite: true },
  ]

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-1">{t('titre')}</h1>
      <p className="text-sm text-petrol-500 mb-4">
        {t('sousTitre', { entreprise: entreprise?.nom })}
      </p>

      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <input type="date" className="input-field max-w-xs" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn-secondary text-xs" disabled={lignes.length === 0} onClick={() => exporterExcel(`versements-${date}`, COLONNES, lignes)}>
          📊 {t('excel')}
        </button>
        <button
          className="btn-secondary text-xs"
          disabled={lignes.length === 0}
          onClick={() => exporterPDF(`versements-${date}`, t('titre'), date, COLONNES, lignes, t('totalGeneral'), formatMontantPDF(totalGeneral) + ' F CFA', entreprise)}
        >
          📄 {t('pdf')}
        </button>
      </div>

      {totalResteAVerser > 0 && (
        <p className="text-xs text-amber-700 mb-4">
          {t('resteEnCaisse', { montant: formatXOF(totalResteAVerser) })}
        </p>
      )}

      {caisses.length === 0 && (
        <p className="text-xs text-red-600 mb-4">
          {t('aucuneCaisse')}
        </p>
      )}

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
                <th className="px-4 py-3 font-medium">{t('commercial')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('ventesCash')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('recouvrement')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('totalDu')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('resteAVerser')}</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">
                    {l.commercial}
                    {l.role !== 'commercial' && (
                      <span className="ml-2 text-xs bg-petrol-100 text-petrol-600 px-1.5 py-0.5 rounded">{t('bureau')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{formatXOF(l.ventesCash)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatXOF(l.recouvrement)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{formatXOF(l.total)}</td>
                  <td className={`px-4 py-3 text-right font-mono ${l.resteAVerser > 0 ? 'text-amber-600 font-semibold' : 'text-green-600'}`}>
                    {l.resteAVerser > 0 ? formatXOF(l.resteAVerser) : t('solde')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {l.resteAVerser > 0 && (
                      <button
                        onClick={() => ouvrirModalVersement(l)}
                        disabled={caisses.length === 0}
                        className="text-xs text-blue-600 underline whitespace-nowrap"
                      >
                        {t('enregistrer')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {lignes.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-petrol-400">{t('aucunMontantDu')}</td></tr>
              )}
            </tbody>
            {lignes.length > 0 && (
              <tfoot>
                <tr className="bg-canvas font-semibold">
                  <td className="px-4 py-3" colSpan={3}>{t('totalGeneral')}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatXOF(totalGeneral)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatXOF(totalResteAVerser)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <p className="text-xs text-petrol-400 mt-3">
        {t('notePied')}
      </p>

      {modalOuvert && commercialVersement && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md">
            <h2 className="font-semibold text-lg mb-1">{t('modalTitre')}</h2>
            <p className="text-sm text-petrol-600 mb-4">{commercialVersement.commercial}</p>

            <div className="space-y-3">
              <div>
                <label className="label">{t('caisse')}</label>
                <select className="input-field" value={caisseId} onChange={(e) => setCaisseId(e.target.value)}>
                  <option value="">{t('selectionner')}</option>
                  {caisses.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('montantRemis')}</label>
                <input
                  type="number"
                  min="0"
                  className="input-field"
                  value={montantVersement}
                  onChange={(e) => setMontantVersement(e.target.value)}
                />
                <p className="text-xs text-petrol-500 mt-1">{t('resteDu', { montant: formatXOF(commercialVersement.resteAVerser) })}</p>
              </div>
              {erreurVersement && <p className="text-sm text-red-600">{erreurVersement}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setModalOuvert(false)}>
                  {t('annuler')}
                </button>
                <button onClick={confirmerVersement} disabled={envoiVersement} className="btn-primary flex-1">
                  {envoiVersement ? t('enregistrement') : t('validerGenererAccuse')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatXOF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0) + ' F CFA'
}
