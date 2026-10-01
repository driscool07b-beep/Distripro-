import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import RapportPowerPoint from '../components/RapportPowerPoint'
import ConversationAssistant from '../components/ConversationAssistant'

// Page de l'assistant : rapport PowerPoint + conversation (chiffres, aide,
// saisie dictée de ventes et commandes avec confirmation).
export default function AssistantIA() {
  const { t } = useTranslation('assistant')
  const { profil } = useAuth()

  if (profil?.ia_active === false) {
    return <div className="p-6 text-sm text-petrol-500">{t('iaDesactivee')}</div>
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto flex flex-col" style={{ minHeight: 'calc(100vh - 7rem)' }}>
      <h1 className="text-xl font-bold mb-1">✨ {t('titre')}</h1>
      <p className="text-sm text-petrol-500 mb-4">{t('sousTitre')}</p>
      {['admin', 'manager', 'comptable', 'commercial'].includes(profil?.role) && (
        <div className="mb-4"><RapportPowerPoint /></div>
      )}
      <div className="flex-1 flex flex-col">
        <ConversationAssistant />
      </div>
      <p className="text-[11px] text-petrol-400 text-center mt-2">{t('avertissement')}</p>
    </div>
  )
}
