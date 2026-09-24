import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { accesAutorise } from '../lib/accesRole'
import { traduireErreur } from '../lib/erreurs'
import { genererRapportNotesUtilisation } from '../lib/export'

function moisCourant() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default function NotesUtilisation() {
  const { t } = useTranslation('notesutilisation')
  const { profil, entreprise } = useAuth()

  const [mois, setMois] = useState(moisCourant())
  const [notes, setNotes] = useState([])
  const [chargement, setChargement] = useState(true)
  const [envoiCalcul, setEnvoiCalcul] = useState(false)
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    charger()
  }, [mois])

  async function charger() {
    setChargement(true)
    const { data } = await supabase
      .from('notes_utilisation')
      .select('id, profil_id, jours_ouvres, jours_actifs, score_assiduite, visites_prevues, visites_avec_rapport, score_rapports, jours_avec_vente_cash, jours_avec_versement, score_versements, score_total, calcule_at, profils!profil_id(nom)')
      .eq('mois', mois)
      .order('score_total', { ascending: false })
    setNotes(data || [])
    setChargement(false)
  }

  async function calculerLeMois() {
    setErreur('')
    setEnvoiCalcul(true)
    const { data, error } = await supabase.rpc('calculer_notes_utilisation_mois', { p_mois: mois })
    setEnvoiCalcul(false)
    if (error) { setErreur(`${t('erreur')} : ${traduireErreur(error.message)}`); return }
    charger()
    return data
  }

  function exporterPDF() {
    const doc = genererRapportNotesUtilisation({ entreprise, notes, mois })
    doc.save(`notes-utilisation-${mois}.pdf`)
  }

  if (!accesAutorise('notesUtilisation', profil?.role)) {
    return <div className="p-4 max-w-2xl mx-auto"><p className="text-petrol-500">{t('accesRefuse')}</p></div>
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-1">{t('titre')}</h1>
      <p className="text-xs text-petrol-500 mb-4">{t('sousTitre')}</p>

      <div className="flex flex-wrap gap-2 items-end mb-4">
        <div>
          <label className="label">{t('mois')}</label>
          <input type="month" className="input-field text-sm" value={mois.slice(0, 7)} onChange={(e) => setMois(`${e.target.value}-01`)} />
        </div>
        <button onClick={calculerLeMois} disabled={envoiCalcul} className="btn-primary text-sm">
          {envoiCalcul ? t('calculEnCours') : t('calculerLeMois')}
        </button>
        {notes.length > 0 && (
          <button data-aide="notesutilisation.exporterPdf" onClick={exporterPDF} className="btn-secondary text-sm">{t('exporterPdf')}</button>
        )}
      </div>
      {erreur && <p className="text-xs text-red-600 mb-3">{erreur}</p>}

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : notes.length === 0 ? (
        <p className="text-petrol-400 text-center py-12 text-sm">{t('aucuneNote')}</p>
      ) : (
        <div className="space-y-2">
          {notes.map((n, i) => (
            <div key={n.id} className="card p-3">
              <div className="flex justify-between items-start mb-2">
                <p className="font-semibold text-sm">
                  {i === 0 && '🥇 '}{i === 1 && '🥈 '}{i === 2 && '🥉 '}{n.profils?.nom || '—'}
                </p>
                <span className="font-mono font-bold text-lg">{n.score_total}<span className="text-xs text-petrol-400"> / 100</span></span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-petrol-500">{t('assiduite')}</p>
                  <p className="font-mono">{n.score_assiduite} — {n.jours_actifs}/{n.jours_ouvres}j</p>
                </div>
                <div>
                  <p className="text-petrol-500">{t('rapports')}</p>
                  <p className="font-mono">
                    {n.score_rapports} — {n.visites_prevues > 0 ? `${n.visites_avec_rapport}/${n.visites_prevues}` : t('nonApplicable')}
                  </p>
                </div>
                <div>
                  <p className="text-petrol-500">{t('versements')}</p>
                  <p className="font-mono">
                    {n.score_versements} — {n.jours_avec_vente_cash > 0 ? `${n.jours_avec_versement}/${n.jours_avec_vente_cash}` : t('nonApplicable')}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
