import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

// Sélecteur de logo avec aperçu (PNG, JPEG ou WebP).
export default function ChoixLogo({ apercu, onChoisir, onRetirer, desactive }) {
  const { t } = useTranslation('commun')
  const champ = useRef(null)
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 h-14 rounded-lg border border-dashed border-line bg-white flex items-center justify-center overflow-hidden shrink-0">
        {apercu ? <img src={apercu} alt={t('logo.alt')} className="max-w-full max-h-full object-contain" /> : <span className="text-[11px] text-petrol-400">{t('logo.aucun')}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-xs" disabled={desactive} onClick={() => champ.current?.click()}>
          {apercu ? t('logo.changer') : t('logo.choisir')}
        </button>
        {apercu && onRetirer && <button type="button" className="text-xs text-red-600 underline" disabled={desactive} onClick={onRetirer}>{t('logo.retirer')}</button>}
      </div>
      <input ref={champ} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onChoisir(f) }} />
    </div>
  )
}
