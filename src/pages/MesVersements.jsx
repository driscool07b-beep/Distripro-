import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function MesVersements() {
  const { t } = useTranslation('mesversements')
  const { profil } = useAuth()
  const [chargement, setChargement] = useState(true)
  const [detailJour, setDetailJour] = useState({ ventesCash: 0, recouvrements: 0, deposeAujourdhui: 0 })
  const [historique, setHistorique] = useState([])

  useEffect(() => {
    if (profil?.id) charger()
  }, [profil?.id])

  async function charger() {
    setChargement(true)

    const debutJour = new Date()
    debutJour.setHours(0, 0, 0, 0)
    const finJourISO = new Date(debutJour.getTime() + 86400000).toISOString()
    const aujourdhui = new Date().toISOString().split('T')[0]

    const [{ data: ventesJour }, { data: reglementsJour }, { data: versements }] = await Promise.all([
      supabase
        .from('ventes')
        .select('montant_regle, mode_paiement')
        .eq('commercial_id', profil.id)
        .neq('statut', 'annulee')
        .gte('created_at', debutJour.toISOString())
        .lt('created_at', finJourISO),
      supabase
        .from('reglements')
        .select('montant')
        .eq('commercial_id', profil.id)
        .gte('created_at', debutJour.toISOString())
        .lt('created_at', finJourISO),
      supabase
        .from('versements_caisse')
        .select('id, montant, date_versement, created_at, caisses(nom), recu_par:profils!recu_par(nom)')
        .eq('commercial_id', profil.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    const ventesCash = (ventesJour || []).filter((v) => v.mode_paiement === 'cash').reduce((s, v) => s + Number(v.montant_regle || 0), 0)
    const recouvrements = (reglementsJour || []).reduce((s, p) => s + Number(p.montant || 0), 0)
    const deposeAujourdhui = (versements || [])
      .filter((v) => v.date_versement === aujourdhui)
      .reduce((s, v) => s + Number(v.montant || 0), 0)

    setDetailJour({ ventesCash, recouvrements, deposeAujourdhui })
    setHistorique(versements || [])
    setChargement(false)
  }

  const totalDuAujourdhui = detailJour.ventesCash + detailJour.recouvrements
  const resteAVerser = Math.max(0, totalDuAujourdhui - detailJour.deposeAujourdhui)

  return (
    <div className="p-4 sm:p-8 max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{t('titre')}</h1>
        <p className="text-sm text-petrol-700 mt-1">{t('sousTitre')}</p>
      </header>

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <>
          <div className="card p-5 mb-6 space-y-2">
            <h2 className="font-semibold mb-1 text-sm">{t('aujourdhui')}</h2>
            <div className="flex justify-between text-sm">
              <span className="text-petrol-600">{t('ventesEspeces')}</span>
              <span className="font-mono">{formatXOF(detailJour.ventesCash)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-petrol-600">{t('recouvrements')}</span>
              <span className="font-mono">{formatXOF(detailJour.recouvrements)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-line pt-2">
              <span className="text-petrol-600">{t('totalDu')}</span>
              <span className="font-mono font-medium">{formatXOF(totalDuAujourdhui)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-petrol-600">{t('dejaVerse')}</span>
              <span className="font-mono text-green-700">{formatXOF(detailJour.deposeAujourdhui)}</span>
            </div>
            <div className="flex justify-between text-base border-t border-line pt-2">
              <span className="font-medium">{t('resteAVerser')}</span>
              <span className={`font-mono font-semibold ${resteAVerser > 0 ? 'text-amber-600' : 'text-green-700'}`}>
                {formatXOF(resteAVerser)}
              </span>
            </div>
            {resteAVerser > 0 && (
              <p className="text-xs text-petrol-500 pt-1">
                {t('remettreSomme')}
              </p>
            )}
          </div>

          <div className="card overflow-x-auto">
            <div className="px-4 py-3 border-b border-line">
              <h2 className="font-semibold text-sm">{t('historiqueTitre')}</h2>
            </div>
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
                  <th className="px-4 py-2 font-medium">{t('date')}</th>
                  <th className="px-4 py-2 font-medium">{t('caisse')}</th>
                  <th className="px-4 py-2 font-medium">{t('recuPar')}</th>
                  <th className="px-4 py-2 font-medium text-right">{t('montant')}</th>
                </tr>
              </thead>
              <tbody>
                {historique.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-petrol-500">{t('aucunVersement')}</td></tr>
                ) : (
                  historique.map((v) => (
                    <tr key={v.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 text-petrol-700">
                        {new Date(v.date_versement).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-2 text-petrol-700">{v.caisses?.nom || '—'}</td>
                      <td className="px-4 py-2 text-petrol-700">{v.recu_par?.nom || '—'}</td>
                      <td className="px-4 py-2 font-mono text-right">{formatXOF(v.montant)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function formatXOF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0) + ' F CFA'
}
