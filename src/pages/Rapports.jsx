import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { exporterExcel, exporterPDF } from '../lib/export'

export default function Rapports() {
  const { profil, entreprise } = useAuth()
  const [rapports, setRapports] = useState([])
  const [chargement, setChargement] = useState(true)
  const [rapportOuvert, setRapportOuvert] = useState(null)
  const [detail, setDetail] = useState(null)
  const [chargementDetail, setChargementDetail] = useState(false)
  const [photosUrls, setPhotosUrls] = useState([])

  const voitTout = profil?.role === 'admin' || profil?.role === 'manager'

  const COLONNES_EXPORT = [
    { cle: 'client', titre: 'Client' },
    { cle: 'commercial', titre: 'Commercial' },
    { cle: 'date', titre: 'Date' },
    { cle: 'notesRayon', titre: 'Notes rayon' },
    { cle: 'notesReserve', titre: 'Notes réserve' },
  ]
  function donneesExport() {
    return rapports.map((r) => ({
      client: r.clients?.nom || '—',
      commercial: r.profils?.nom || '—',
      date: new Date(r.created_at).toLocaleDateString('fr-FR'),
      notesRayon: r.notes_rayon || '—',
      notesReserve: r.notes_reserve || '—',
    }))
  }
  function exportExcel() {
    exporterExcel('rapports-visite', COLONNES_EXPORT, donneesExport())
  }
  function exportPDF() {
    exporterPDF('rapports-visite', 'Rapports de visite', null, COLONNES_EXPORT, donneesExport(), undefined, undefined, entreprise)
  }

  useEffect(() => {
    if (profil) chargerRapports()
  }, [profil])

  async function chargerRapports() {
    setChargement(true)
    let requete = supabase
      .from('rapports_visite')
      .select('id, notes_rayon, notes_reserve, photos_paths, created_at, clients(nom), profils(nom)')
      .order('created_at', { ascending: false })

    if (!voitTout) requete = requete.eq('commercial_id', profil.id)

    const { data, error } = await requete
    if (!error) setRapports(data || [])
    setChargement(false)
  }

  async function ouvrirDetail(rapport) {
    setRapportOuvert(rapport.id)
    setChargementDetail(true)
    setDetail(null)
    setPhotosUrls([])

    const [{ data: lignesProduits }, { data: valeursChamps }, { data: presencesConcurrents }] = await Promise.all([
      supabase
        .from('rapport_visite_produits')
        .select('quantite_rayon, quantite_reserve, produits(nom)')
        .eq('rapport_id', rapport.id),
      supabase
        .from('rapport_visite_champs_valeurs')
        .select('valeur, champs_personnalises_rapport(libelle)')
        .eq('rapport_id', rapport.id),
      supabase
        .from('rapport_visite_concurrents')
        .select('present, produits_concurrents(nom, marque)')
        .eq('rapport_id', rapport.id),
    ])

    setDetail({
      lignesProduits: lignesProduits || [],
      valeursChamps: valeursChamps || [],
      presencesConcurrents: presencesConcurrents || [],
    })
    setChargementDetail(false)

    if (rapport.photos_paths?.length) {
      const urls = await Promise.all(
        rapport.photos_paths.map(async (chemin) => {
          const { data } = await supabase.storage.from('client-photos').createSignedUrl(chemin, 3600)
          return data?.signedUrl
        })
      )
      setPhotosUrls(urls.filter(Boolean))
    }
  }

  function fermerDetail() {
    setRapportOuvert(null)
    setDetail(null)
    setPhotosUrls([])
  }

  if (chargement) {
    return <div className="p-4 text-center text-petrol-500">Chargement des rapports…</div>
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">Rapports de visite</h1>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" onClick={exportExcel} disabled={rapports.length === 0}>
            📊 Excel
          </button>
          <button className="btn-secondary text-xs" onClick={exportPDF} disabled={rapports.length === 0}>
            📄 PDF
          </button>
        </div>
      </div>
      <p className="text-sm text-petrol-500 mb-4">
        {voitTout ? 'Tous les commerciaux' : 'Vos visites'} — {rapports.length} rapport(s)
      </p>

      <div className="space-y-2">
        {rapports.map((r) => (
          <div key={r.id} className="border border-line rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => (rapportOuvert === r.id ? fermerDetail() : ouvrirDetail(r))}
              className="w-full text-left p-3 hover:bg-canvas/60 flex justify-between items-center"
            >
              <div>
                <p className="font-medium text-sm">{r.clients?.nom || 'Client'}</p>
                <p className="text-xs text-petrol-500">
                  {voitTout && r.profils?.nom ? `${r.profils.nom} — ` : ''}
                  {new Date(r.created_at).toLocaleString('fr-FR', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              </div>
              <span className="text-petrol-400 text-sm">{rapportOuvert === r.id ? '▲' : '▼'}</span>
            </button>

            {rapportOuvert === r.id && (
              <div className="border-t border-line p-3 space-y-3 bg-canvas/40">
                {chargementDetail ? (
                  <p className="text-sm text-petrol-500">Chargement du détail…</p>
                ) : (
                  <>
                    {r.notes_rayon && (
                      <div>
                        <p className="text-xs font-medium text-petrol-600">Stock rayon (notes)</p>
                        <p className="text-sm">{r.notes_rayon}</p>
                      </div>
                    )}
                    {r.notes_reserve && (
                      <div>
                        <p className="text-xs font-medium text-petrol-600">Stock réserve (notes)</p>
                        <p className="text-sm">{r.notes_reserve}</p>
                      </div>
                    )}

                    {detail?.lignesProduits.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-petrol-600 mb-1">Stock par produit</p>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-petrol-500">
                              <th className="font-medium pb-1">Produit</th>
                              <th className="font-medium pb-1">Rayon</th>
                              <th className="font-medium pb-1">Réserve</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.lignesProduits.map((l, i) => (
                              <tr key={i} className="border-t border-line">
                                <td className="py-1">{l.produits?.nom || '—'}</td>
                                <td className="py-1">{l.quantite_rayon ?? '—'}</td>
                                <td className="py-1">{l.quantite_reserve ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {detail?.valeursChamps.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-petrol-600 mb-1">Autres informations</p>
                        {detail.valeursChamps.map((v, i) => (
                          <p key={i} className="text-sm">
                            <span className="text-petrol-500">
                              {v.champs_personnalises_rapport?.libelle} :
                            </span>{' '}
                            {v.valeur}
                          </p>
                        ))}
                      </div>
                    )}

                    {detail?.presencesConcurrents.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-petrol-600 mb-1">Produits concurrents en rayon</p>
                        {detail.presencesConcurrents.map((p, i) => (
                          <p key={i} className="text-sm flex justify-between">
                            <span>
                              {p.produits_concurrents?.nom}
                              {p.produits_concurrents?.marque ? ` (${p.produits_concurrents.marque})` : ''}
                            </span>
                            <span className={p.present ? 'text-red-600' : 'text-green-600'}>
                              {p.present ? 'Présent' : 'Absent'}
                            </span>
                          </p>
                        ))}
                      </div>
                    )}

                    {photosUrls.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-petrol-600 mb-1">Photos</p>
                        <div className="flex gap-2 flex-wrap">
                          {photosUrls.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt="" className="w-20 h-20 object-cover rounded border" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {!r.notes_rayon &&
                      !r.notes_reserve &&
                      detail?.lignesProduits.length === 0 &&
                      detail?.valeursChamps.length === 0 &&
                      detail?.presencesConcurrents.length === 0 &&
                      photosUrls.length === 0 && (
                        <p className="text-sm text-petrol-400">Rapport vide (visite validée sans détail).</p>
                      )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        {rapports.length === 0 && (
          <p className="text-petrol-400 text-center py-8">Aucun rapport pour le moment.</p>
        )}
      </div>
    </div>
  )
}
