import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function Aide() {
  const { t } = useTranslation('aide')
  const [recherche, setRecherche] = useState('')
  const [categorieOuverte, setCategorieOuverte] = useState(null)
  const [itemOuvert, setItemOuvert] = useState(null)

  const categories = t('categories', { returnObjects: true })
  const requete = recherche.trim().toLowerCase()

  const categoriesFiltrees = requete
    ? categories
        .map((cat) => ({
          ...cat,
          items: cat.items.filter(
            (it) => it.q.toLowerCase().includes(requete) || it.r.toLowerCase().includes(requete)
          ),
        }))
        .filter((cat) => cat.items.length > 0)
    : categories

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-1">{t('titre')}</h1>

      <input
        className="input-field mb-4"
        placeholder={t('rechercher')}
        value={recherche}
        onChange={(e) => {
          setRecherche(e.target.value)
          setCategorieOuverte(null)
        }}
      />

      {categoriesFiltrees.length === 0 ? (
        <p className="text-petrol-400 text-center py-12 text-sm">{t('aucunResultat')}</p>
      ) : (
        <div className="space-y-2">
          {categoriesFiltrees.map((cat, iCat) => {
            const ouverte = requete ? true : categorieOuverte === iCat
            return (
              <div key={iCat} className="card overflow-hidden">
                <button
                  onClick={() => setCategorieOuverte(ouverte && !requete ? null : iCat)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <span className="font-semibold text-sm">{cat.titre}</span>
                  <span className="text-petrol-400 text-xs">{ouverte ? '▲' : '▼'}</span>
                </button>
                {ouverte && (
                  <div className="border-t border-line divide-y divide-line">
                    {cat.items.map((it, iItem) => {
                      const cle = `${iCat}-${iItem}`
                      const deplie = requete ? true : itemOuvert === cle
                      return (
                        <div key={iItem} className="px-4 py-3">
                          <button
                            onClick={() => setItemOuvert(deplie && !requete ? null : cle)}
                            className="w-full text-left text-sm font-medium text-petrol-800 flex items-start justify-between gap-2"
                          >
                            <span>{it.q}</span>
                            <span className="text-petrol-400 text-xs shrink-0 mt-0.5">{deplie ? '−' : '+'}</span>
                          </button>
                          {deplie && <p className="text-sm text-petrol-600 mt-2 leading-relaxed">{it.r}</p>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-petrol-400 text-center mt-6">{t('contact')}</p>
    </div>
  )
}
