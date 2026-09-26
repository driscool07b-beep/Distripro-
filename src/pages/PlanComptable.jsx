import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { SYSCOHADA_DEPART } from '../lib/syscohada'
import { useAuth } from '../context/AuthContext'
import { accesAutorise } from '../lib/accesRole'
import { traduireErreur } from '../lib/erreurs'


export default function PlanComptable() {
  const { t } = useTranslation('plancomptable')
  const { profil } = useAuth()

  const [comptes, setComptes] = useState([])
  const [chargement, setChargement] = useState(true)
  const [recherche, setRecherche] = useState('')

  const [modalCompte, setModalCompte] = useState(false)
  const [numeroCompte, setNumeroCompte] = useState('')
  const [libelleCompte, setLibelleCompte] = useState('')
  const [envoiCompte, setEnvoiCompte] = useState(false)
  const [erreurCompte, setErreurCompte] = useState('')

  const [envoiSyscohada, setEnvoiSyscohada] = useState(false)
  const [envoiImport, setEnvoiImport] = useState(false)
  const [resultatImport, setResultatImport] = useState('')

  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setChargement(true)
    const { data } = await supabase.from('plan_comptable').select('id, numero_compte, libelle').order('numero_compte')
    setComptes(data || [])
    setChargement(false)
  }

  async function ajouterCompte(e) {
    e.preventDefault()
    setErreurCompte('')
    if (!numeroCompte.trim() || !libelleCompte.trim()) {
      setErreurCompte(t('erreurs.champsRequis'))
      return
    }
    setEnvoiCompte(true)
    const { error } = await supabase.rpc('creer_compte_comptable', { p_numero_compte: numeroCompte, p_libelle: libelleCompte })
    setEnvoiCompte(false)
    if (error) {
      setErreurCompte(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    setNumeroCompte(''); setLibelleCompte('')
    setModalCompte(false)
    charger()
  }

  async function supprimerCompte(id) {
    if (!window.confirm(t('confirmerSuppression'))) return
    await supabase.rpc('supprimer_compte_comptable', { p_compte_id: id })
    charger()
  }

  async function chargerSyscohada() {
    if (!window.confirm(t('confirmerSyscohada'))) return
    setEnvoiSyscohada(true)
    await supabase.rpc('importer_plan_comptable', { p_comptes: SYSCOHADA_DEPART })
    setEnvoiSyscohada(false)
    charger()
  }

  function lireFichierImport(e) {
    const fichier = e.target.files?.[0]
    if (!fichier) return
    setResultatImport('')
    const lecteur = new FileReader()
    lecteur.onload = async (event) => {
      try {
        const classeur = XLSX.read(event.target.result, { type: 'array' })
        const feuille = classeur.Sheets[classeur.SheetNames[0]]
        const lignes = XLSX.utils.sheet_to_json(feuille, { header: ['numero_compte', 'libelle'], range: 1, defval: '' })
        const lignesValides = lignes
          .map((l) => ({ numero_compte: String(l.numero_compte || '').trim(), libelle: String(l.libelle || '').trim() }))
          .filter((l) => l.numero_compte && l.libelle)

        if (lignesValides.length === 0) {
          setResultatImport(t('erreurs.aucuneLigne'))
          return
        }
        setEnvoiImport(true)
        const { data, error } = await supabase.rpc('importer_plan_comptable', { p_comptes: lignesValides })
        setEnvoiImport(false)
        if (error) {
          setResultatImport(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`)
          return
        }
        setResultatImport(t('lignesImportees', { n: data }))
        charger()
      } catch {
        setResultatImport(t('erreurs.fichierIllisible'))
      }
    }
    lecteur.readAsArrayBuffer(fichier)
  }

  function telechargerModele() {
    const feuille = XLSX.utils.aoa_to_sheet([
      [t('modele.numeroCompte'), t('modele.libelle')],
      ['571000', 'Caisse'],
      ['521000', 'Banques locales'],
    ])
    const classeur = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(classeur, feuille, 'PlanComptable')
    XLSX.writeFile(classeur, 'modele-plan-comptable.xlsx')
  }

  const comptesFiltres = comptes.filter(
    (c) => !recherche || c.numero_compte.includes(recherche) || c.libelle.toLowerCase().includes(recherche.toLowerCase())
  )

  if (!accesAutorise('planComptable', profil?.role)) {
    return <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto"><p className="text-petrol-500">{t('accesRefuse')}</p></div>
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold mb-1">{t('titre')}</h1>
      <p className="text-xs text-petrol-500 mb-4">{t('sousTitre')}</p>

      <div className="flex flex-wrap gap-2 mb-4">
        <button data-aide="plancomptable.nouveauCompte" onClick={() => setModalCompte(true)} className="btn-primary text-sm">{t('nouveauCompte')}</button>
        {comptes.length === 0 && (
          <button onClick={chargerSyscohada} disabled={envoiSyscohada} className="btn-secondary text-sm">
            {envoiSyscohada ? '…' : t('chargerSyscohada')}
          </button>
        )}
        <label className="btn-secondary text-sm cursor-pointer">
          {envoiImport ? '…' : t('importerFichier')}
          <input type="file" accept=".xlsx,.xls" onChange={lireFichierImport} className="hidden" disabled={envoiImport} />
        </label>
        <button data-aide="plancomptable.telechargerModele" onClick={telechargerModele} className="text-xs text-blue-600 underline self-center">{t('telechargerModele')}</button>
      </div>
      {resultatImport && <p className="text-xs text-petrol-600 mb-3">{resultatImport}</p>}

      <input
        className="input-field mb-4"
        placeholder={t('rechercherPlaceholder')}
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
      />

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <div className="space-y-1.5">
          {comptesFiltres.map((c) => (
            <div key={c.id} className="border border-line rounded-lg px-3 py-2 flex items-center justify-between text-sm">
              <div>
                <span className="font-mono font-medium">{c.numero_compte}</span>
                <span className="text-petrol-600"> — {c.libelle}</span>
              </div>
              <button data-aide="plancomptable.supprimer" onClick={() => supprimerCompte(c.id)} className="text-xs text-red-600 underline shrink-0 ml-2">{t('supprimer')}</button>
            </div>
          ))}
          {comptesFiltres.length === 0 && <p className="text-petrol-400 text-center py-12 text-sm">{t('aucunCompte')}</p>}
        </div>
      )}

      {modalCompte && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-5 w-full max-w-sm">
            <h2 className="font-semibold text-lg mb-3">{t('nouveauCompte')}</h2>
            <form onSubmit={ajouterCompte} className="space-y-3">
              <div>
                <label className="label">{t('numeroCompte')}</label>
                <input className="input-field" value={numeroCompte} onChange={(e) => setNumeroCompte(e.target.value)} placeholder="571000" />
              </div>
              <div>
                <label className="label">{t('libelleCompte')}</label>
                <input className="input-field" value={libelleCompte} onChange={(e) => setLibelleCompte(e.target.value)} placeholder="Caisse" />
              </div>
              {erreurCompte && <p className="text-xs text-red-600">{erreurCompte}</p>}
              <div className="flex gap-2 pt-2">
                <button data-aide="plancomptable.annuler" type="button" onClick={() => setModalCompte(false)} className="btn-secondary flex-1">{t('annuler')}</button>
                <button type="submit" disabled={envoiCompte} className="btn-primary flex-1">{envoiCompte ? t('enCours') : t('enregistrer')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
