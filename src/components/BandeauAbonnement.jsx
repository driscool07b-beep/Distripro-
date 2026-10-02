import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Situation de l'abonnement visible dans toute l'app : lecture seule (tous),
// fin d'essai proche ou dépassée, unités IA épuisées (direction et comptable).
export default function BandeauAbonnement() {
  const { t } = useTranslation('abonnement')
  const { entreprise, profil } = useAuth()
  const [soldeIa, setSoldeIa] = useState(null)
  const direction = ['admin', 'manager', 'comptable'].includes(profil?.role)

  useEffect(() => {
    if (!direction || !entreprise?.id) return
    supabase.from('ia_portefeuilles').select('solde').eq('entreprise_id', entreprise.id).maybeSingle()
      .then(({ data }) => setSoldeIa(data ? Number(data.solde) : null))
  }, [direction, entreprise?.id])

  if (!entreprise) return null
  const aujourdhui = new Date().toISOString().slice(0, 10)
  const joursEssai = entreprise.statut === 'essai' && entreprise.date_fin_essai
    ? Math.round((new Date(entreprise.date_fin_essai) - new Date(aujourdhui)) / 86400000) : null
  const lien = direction && <Link to="/abonnement" className="underline font-medium whitespace-nowrap">{t('bandeau.lien')} →</Link>

  let message = null
  let style = 'bg-amber-50 border-amber-300 text-amber-900'
  if (entreprise.lecture_seule_abonnement) {
    message = t(direction ? 'bandeau.lectureSeule' : 'bandeau.lectureSeuleMembre')
    style = 'bg-red-50 border-red-300 text-red-800'
  } else if (direction && joursEssai != null && joursEssai < 0) {
    message = t('bandeau.essaiExpire')
    style = 'bg-red-50 border-red-300 text-red-800'
  } else if (direction && joursEssai != null && joursEssai <= 7) {
    message = joursEssai === 0 ? t('bandeau.essaiAujourdhui') : t('bandeau.essaiBientot', { count: joursEssai })
  } else if (direction && soldeIa != null && soldeIa <= 0) {
    message = t('bandeau.iaEpuisee')
  }
  if (!message) return null
  return (
    <div className={`no-print mx-4 mt-3 sm:mx-6 lg:mx-8 rounded-xl border px-3 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-1 ${style}`}>
      <span className="flex-1 min-w-[200px]">⚠️ {message}</span>
      {lien}
    </div>
  )
}
