import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function NotFound() {
  const { t } = useTranslation('commun')
  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
      <div className="text-center">
        <div className="font-display text-5xl font-bold text-petrol-900 mb-2">404</div>
        <p className="text-petrol-700 mb-6">{t('notFound.pageInexistante')}</p>
        <Link to="/" className="btn-primary inline-block">
          {t('notFound.retourTableauDeBord')}
        </Link>
      </div>
    </div>
  )
}
