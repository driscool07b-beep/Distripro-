import { useState, useRef, useEffect } from 'react'

/**
 * Liste déroulante avec recherche : tape pour filtrer les options, clique
 * pour sélectionner. Remplace un <select> classique quand la liste est
 * longue (clients, produits...).
 */
export default function SelectRecherche({
  options,
  value,
  onChange,
  placeholder = 'Rechercher…',
  libelleCle = 'nom',
  valeurCle = 'id',
  disabled = false,
  className = '',
}) {
  const [ouvert, setOuvert] = useState(false)
  const [texte, setTexte] = useState('')
  const ref = useRef(null)

  const selectionne = options.find((o) => o[valeurCle] === value)

  useEffect(() => {
    function fermerSiExterieur(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOuvert(false)
        setTexte('')
      }
    }
    document.addEventListener('mousedown', fermerSiExterieur)
    return () => document.removeEventListener('mousedown', fermerSiExterieur)
  }, [])

  const filtres = texte.trim()
    ? options.filter((o) => (o[libelleCle] || '').toLowerCase().includes(texte.trim().toLowerCase()))
    : options

  return (
    <div className={`relative ${className}`} ref={ref}>
      <input
        type="text"
        className="input-field"
        placeholder={placeholder}
        disabled={disabled}
        value={ouvert ? texte : selectionne ? selectionne[libelleCle] || '' : ''}
        onFocus={() => {
          setOuvert(true)
          setTexte('')
        }}
        onChange={(e) => setTexte(e.target.value)}
      />
      {ouvert && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-line rounded-lg shadow-lg">
          {filtres.length === 0 && <p className="text-xs text-petrol-400 px-3 py-2">Aucun résultat.</p>}
          {filtres.map((o) => (
            <button
              key={o[valeurCle]}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm hover:bg-canvas ${o[valeurCle] === value ? 'bg-canvas font-medium' : ''}`}
              onClick={() => {
                onChange(o[valeurCle])
                setOuvert(false)
                setTexte('')
              }}
            >
              {o[libelleCle]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
