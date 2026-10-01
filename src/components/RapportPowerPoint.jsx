import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Périodes proposées (calculées au moment du clic).
function periode(choix) {
  const a = new Date()
  const y = a.getFullYear()
  const m = a.getMonth()
  switch (choix) {
    case 'mois': return [iso(new Date(y, m, 1)), iso(a)]
    case 'moisDernier': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))]
    case 'trimestre': { const q = Math.floor(m / 3) * 3; return [iso(new Date(y, q, 1)), iso(a)] }
    case 'trimestreDernier': { const q = Math.floor(m / 3) * 3; return [iso(new Date(y, q - 3, 1)), iso(new Date(y, q, 0))] }
    case 'annee': return [iso(new Date(y, 0, 1)), iso(a)]
    default: return null
  }
}

// Rapport d'activité commerciale en PowerPoint (chiffres réels + commentaires IA).
export default function RapportPowerPoint() {
  const { t } = useTranslation('assistant')
  const [choix, setChoix] = useState('moisDernier')
  const [debut, setDebut] = useState(iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [fin, setFin] = useState(iso(new Date()))
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState('')

  async function generer() {
    setErreur('')
    const [d, f] = periode(choix) || [debut, fin]
    if (!d || !f || f < d) { setErreur(t('rapport.periodeInvalide')); return }
    setEnCours(true)
    const { data, error } = await supabase.functions.invoke('rapport-activite', { body: { mode: 'manuel', debut: d, fin: f } })
    setEnCours(false)
    if (error || !data?.fichier) {
      let message = error?.message || t('rapport.echec')
      try { message = (await error?.context?.json())?.error || message } catch { /* ignore */ }
      setErreur(message)
      return
    }
    // Téléchargement du fichier .pptx reçu (base64).
    const octets = Uint8Array.from(atob(data.fichier), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([octets], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }))
    const lien = document.createElement('a')
    lien.href = url
    lien.download = data.nom || 'rapport-activite.pptx'
    document.body.appendChild(lien)
    lien.click()
    lien.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h2 className="font-semibold">📊 {t('rapport.titre')}</h2>
        <p className="text-xs text-petrol-500">{t('rapport.aide')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {['moisDernier', 'mois', 'trimestreDernier', 'trimestre', 'annee', 'libre'].map((c) => (
          <button key={c} type="button" onClick={() => setChoix(c)}
            className={`px-3 py-1.5 rounded-full text-xs border ${choix === c ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line bg-white'}`}>
            {t(`rapport.periodes.${c}`)}
          </button>
        ))}
      </div>
      {choix === 'libre' && (
        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
          <div><label className="label">{t('rapport.du')}</label><input type="date" className="input-field" value={debut} max={fin} onChange={(e) => setDebut(e.target.value)} /></div>
          <div><label className="label">{t('rapport.au')}</label><input type="date" className="input-field" value={fin} min={debut} onChange={(e) => setFin(e.target.value)} /></div>
        </div>
      )}
      <button className="btn-primary text-sm" disabled={enCours} onClick={generer}>
        {enCours ? t('rapport.enCours') : t('rapport.generer')}
      </button>
      {enCours && <p className="text-xs text-petrol-500">{t('rapport.patience')}</p>}
      {erreur && <p className="text-xs text-red-600">{erreur}</p>}
    </div>
  )
}
