import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'

// Ordre d'affichage des publics de tutoriels
const PUBLICS = ['admin', 'commercial', 'magasin', 'direction']

function Tutoriels({ requete }) {
  const { t } = useTranslation('aide')
  const { profil } = useAuth()
  const role = profil?.role
  const [voirTous, setVoirTous] = useState(false)
  const [ouvert, setOuvert] = useState(null)

  const tuto = t('tutoriels', { returnObjects: true })
  if (!tuto || !Array.isArray(tuto.liste)) return null

  const correspond = (it) =>
    !requete ||
    [it.titre, it.intro, ...(it.etapes || [])].some((x) => x?.toLowerCase().includes(requete))

  const miens = tuto.liste.filter((it) => it.roles?.includes(role))
  // Avec une recherche, on cherche dans tous les tutoriels
  const visibles = (requete || voirTous ? tuto.liste : miens).filter(correspond)
  if (requete && visibles.length === 0) return null

  const groupes = PUBLICS.map((p) => ({ p, items: visibles.filter((it) => it.public === p) })).filter((g) => g.items.length)
  const afficherGroupes = requete || voirTous || new Set(miens.map((it) => it.public)).size > 1

  return (
    <section className="mb-6">
      <h2 className="font-semibold mb-1">{tuto.titre}</h2>
      <p className="text-xs text-petrol-500 mb-3">{tuto.sousTitre}</p>

      {visibles.length === 0 && <p className="text-sm text-petrol-500 mb-3">{tuto.aucunPourRole}</p>}

      <div className="space-y-4">
        {groupes.map(({ p, items }) => (
          <div key={p}>
            {afficherGroupes && (
              <p className="text-[11px] uppercase tracking-wide text-petrol-400 font-semibold mb-2">{tuto.publics?.[p]}</p>
            )}
            <div className="space-y-2">
              {items.map((it) => {
                const deplie = requete ? true : ouvert === it.id
                return (
                  <div key={it.id} className={`card overflow-hidden ${deplie ? 'border-amber-300' : ''}`}>
                    <button
                      onClick={() => setOuvert(deplie && !requete ? null : it.id)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <span className="text-sm font-medium text-petrol-800">{it.titre}</span>
                      <span className="shrink-0 text-[11px] text-petrol-400">
                        {t('tutoriels.minutes', { n: it.duree })} {deplie ? '▲' : '▼'}
                      </span>
                    </button>
                    {deplie && (
                      <div className="border-t border-line px-4 py-3">
                        {it.intro && <p className="text-sm text-petrol-600 mb-3 leading-relaxed">{it.intro}</p>}
                        <ol className="space-y-2">
                          {it.etapes.map((e, i) => (
                            <li key={i} className="flex gap-3 text-sm text-petrol-700 leading-relaxed">
                              <span
                                aria-label={`${tuto.etape} ${i + 1}`}
                                className="shrink-0 w-6 h-6 rounded-full bg-amber-50 border border-amber-300 text-amber-800 text-xs font-semibold flex items-center justify-center"
                              >
                                {i + 1}
                              </span>
                              <span className="pt-0.5">{e}</span>
                            </li>
                          ))}
                        </ol>
                        {it.lien && (
                          <Link to={it.lien} className="inline-block mt-3 text-sm font-medium text-amber-700 underline">
                            {tuto.ouvrirPage}
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {!requete && miens.length < tuto.liste.length && (
        <button onClick={() => setVoirTous(!voirTous)} className="mt-3 text-xs text-petrol-500 underline">
          {voirTous ? tuto.masquerTous : tuto.voirTous}
        </button>
      )}

      <h2 className="font-semibold mt-6">{tuto.faqTitre}</h2>
    </section>
  )
}

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

      <Tutoriels requete={requete} />

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
      <p className="text-xs text-petrol-500 text-center mt-8 space-x-3">
        <a href="/legal/cgu" className="underline">{t('commun:legal.cgu')}</a>
        <a href="/legal/confidentialite" className="underline">{t('commun:legal.confidentialite')}</a>
        <a href="/legal/mentions" className="underline">{t('commun:legal.mentions')}</a>
      </p>
    </div>
  )
}
