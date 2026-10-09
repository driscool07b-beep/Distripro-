import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Bouton « Enregistrer » qui montre en permanence l'état de la section :
//   • rien de modifié depuis le dernier enregistrement → bouton gris « ✓ Enregistré » ;
//   • un champ modifié → bouton foncé « Enregistrer » + « Modifications non enregistrées ».
// Il surveille lui-même les champs de sa section (la carte .card ou le
// formulaire qui le contient) : aucun branchement à faire champ par champ.
// onClick doit renvoyer true quand l'enregistrement a réussi.
// Un champ enregistré immédiatement (sans passer par ce bouton) se marque
// avec l'attribut data-enregistrement-immediat pour être ignoré.
export default function BoutonEnregistrer({ onClick, enCours = false, className = '', type = 'button', libelle }) {
  const { t } = useTranslation()
  const bouton = useRef(null)
  const [modifie, setModifie] = useState(false)
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    const zone = bouton.current?.closest('[data-zone-enregistrement], form, .card')
    if (!zone) return undefined
    const surModification = (e) => {
      if (e.target === bouton.current || e.target.closest?.('[data-enregistrement-immediat]')) return
      setModifie(true)
    }
    zone.addEventListener('input', surModification)
    zone.addEventListener('change', surModification)
    return () => {
      zone.removeEventListener('input', surModification)
      zone.removeEventListener('change', surModification)
    }
  }, [])

  async function clic(e) {
    setOccupe(true)
    try {
      const resultat = await onClick?.(e)
      if (resultat === true) setModifie(false)
    } finally {
      setOccupe(false)
    }
  }

  const travail = occupe || enCours
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        ref={bouton}
        type={type}
        onClick={clic}
        disabled={travail || !modifie}
        className={`${modifie || travail ? 'btn-primary' : 'btn-secondary opacity-70 cursor-default'} ${className}`}
      >
        {travail ? t('actions.enregistrementEnCours') : modifie ? (libelle || t('actions.enregistrer')) : t('actions.enregistreOk')}
      </button>
      {modifie && !travail && <span className="text-xs text-amber-700">● {t('actions.nonEnregistre')}</span>}
    </span>
  )
}
