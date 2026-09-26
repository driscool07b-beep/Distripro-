import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { traduireErreur } from '../lib/erreurs'

// Liste déroulante des comptes du plan comptable, avec la possibilité de
// créer un compte ou un sous-compte manquant sans quitter la page.
//  - mode 'id'     : la valeur est l'identifiant du compte
//  - mode 'numero' : la valeur est le numéro du compte (ex. « 701100 »)
export default function SelecteurCompte({ valeur, onChange, comptes, mode = 'id', onCree, aide }) {
  const { t } = useTranslation('parametres')
  const [creation, setCreation] = useState(null) // { parent, numero, libelle }
  const [erreur, setErreur] = useState('')
  const [envoi, setEnvoi] = useState(false)

  const cle = (c) => (mode === 'id' ? c.id : c.numero_compte)
  const valeurInconnue = mode === 'numero' && valeur && !comptes.some((c) => c.numero_compte === valeur)

  async function creer() {
    setErreur('')
    const numero = creation.numero.trim()
    if (!/^[0-9]{2,12}$/.test(numero)) { setErreur(t('selecteurCompte.numeroInvalide')); return }
    if (creation.parent && (!numero.startsWith(creation.parent) || numero.length <= creation.parent.length)) {
      setErreur(t('selecteurCompte.sousCompteInvalide', { parent: creation.parent }))
      return
    }
    if (comptes.some((c) => c.numero_compte === numero)) { setErreur(t('selecteurCompte.existeDeja')); return }
    if (!creation.libelle.trim()) { setErreur(t('selecteurCompte.libelleObligatoire')); return }
    setEnvoi(true)
    const { data: id, error } = await supabase.rpc('creer_compte_comptable', { p_numero_compte: numero, p_libelle: creation.libelle.trim() })
    setEnvoi(false)
    if (error) { setErreur(traduireErreur(error.message)); return }
    await onCree?.()
    onChange(mode === 'id' ? id : numero)
    setCreation(null)
  }

  return (
    <div>
      <select
        className="input-field text-sm"
        value={valeur || ''}
        onChange={(e) => {
          if (e.target.value === '__creer__') { setErreur(''); setCreation({ parent: '', numero: '', libelle: '' }); return }
          onChange(e.target.value)
        }}
      >
        <option value="">{t('comptabilite.nonDefini')}</option>
        {valeurInconnue && <option value={valeur}>{valeur} — {t('selecteurCompte.horsPlan')}</option>}
        {comptes.map((c) => <option key={c.id} value={cle(c)}>{c.numero_compte} — {c.libelle}</option>)}
        <option value="__creer__">➕ {t('selecteurCompte.creer')}</option>
      </select>
      {aide && <p className="text-[11px] text-petrol-500 mt-1 leading-snug">{aide}</p>}

      {creation && (
        <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50/60 p-3 space-y-2">
          <p className="text-xs font-semibold">{t('selecteurCompte.titre')}</p>
          <select
            className="input-field text-sm"
            value={creation.parent}
            onChange={(e) => setCreation({ ...creation, parent: e.target.value, numero: e.target.value })}
          >
            <option value="">{t('selecteurCompte.compteRacine')}</option>
            {comptes.map((c) => <option key={c.id} value={c.numero_compte}>{t('selecteurCompte.sousCompteDe')} {c.numero_compte} — {c.libelle}</option>)}
          </select>
          <div className="grid grid-cols-3 gap-2">
            <input className="input-field text-sm font-mono" value={creation.numero} onChange={(e) => setCreation({ ...creation, numero: e.target.value })} placeholder={t('selecteurCompte.numero')} />
            <input className="input-field text-sm col-span-2" value={creation.libelle} onChange={(e) => setCreation({ ...creation, libelle: e.target.value })} placeholder={t('selecteurCompte.libelle')} />
          </div>
          {creation.parent && <p className="text-[11px] text-petrol-500">{t('selecteurCompte.aideSousCompte', { parent: creation.parent })}</p>}
          {erreur && <p className="text-xs text-red-600">{erreur}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-primary text-xs px-3 py-1.5" disabled={envoi} onClick={creer}>{envoi ? '…' : t('selecteurCompte.creerBouton')}</button>
            <button type="button" className="btn-secondary text-xs px-3 py-1.5" onClick={() => setCreation(null)}>{t('selecteurCompte.annuler')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
