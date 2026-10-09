// Icône de micro (trait fin, même style que WhatsApp ou Claude).
export default function IconeMicro({ taille = 20, className = '' }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  )
}

// Carré « arrêter » affiché pendant la dictée.
export function IconeStop({ taille = 16, className = '' }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}
