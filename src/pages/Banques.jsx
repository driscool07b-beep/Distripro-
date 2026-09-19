import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { accesAutorise } from '../lib/accesRole'
import { formatXOF, formatDate, formatDateHeure } from '../lib/format'
import { traduireErreur } from '../lib/erreurs'

export default function Banques() {
  const { t } = useTranslation('banques')
  const { profil } = useAuth()

  const [onglet, setOnglet] = useState('banques')
  const [banques, setBanques] = useState([])
  const [soldes, setSoldes] = useState({})
  const [caisses, setCaisses] = useState([])
  const [chargement, setChargement] = useState(true)

  const [modalBanque, setModalBanque] = useState(false)
  const [banqueEnEdition, setBanqueEnEdition] = useState(null)
  const [nomBanque, setNomBanque] = useState('')
  const [numeroCompte, setNumeroCompte] = useState('')
  const [intituleCompte, setIntituleCompte] = useState('')
  const [envoiBanque, setEnvoiBanque] = useState(false)
  const [erreurBanque, setErreurBanque] = useState('')

  const [banqueGrandLivreId, setBanqueGrandLivreId] = useState('')
  const [grandLivre, setGrandLivre] = useState([])
  const [chargementGrandLivre, setChargementGrandLivre] = useState(false)
  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')

  const [modalTransfert, setModalTransfert] = useState(false)
  const [transfertBanqueId, setTransfertBanqueId] = useState('')
  const [transfertCaisseId, setTransfertCaisseId] = useState('')
  const [transfertMontant, setTransfertMontant] = useState('')
  const [transfertLibelle, setTransfertLibelle] = useState('')
  const [envoiTransfert, setEnvoiTransfert] = useState(false)
  const [erreurTransfert, setErreurTransfert] = useState('')
  const [transfertsSortants, setTransfertsSortants] = useState([])

  const [banqueRapproId, setBanqueRapproId] = useState('')
  const [periodeDebutRappro, setPeriodeDebutRappro] = useState('')
  const [periodeFinRappro, setPeriodeFinRappro] = useState('')
  const [ligneReleve, setLigneReleve] = useState([])
  const [fichierReleveNom, setFichierReleveNom] = useState('')
  const [envoiRappro, setEnvoiRappro] = useState(false)
  const [erreurRappro, setErreurRappro] = useState('')
  const [resultatRappro, setResultatRappro] = useState(null)

  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setChargement(true)
    const [{ data: banquesData }, { data: caissesData }] = await Promise.all([
      supabase.from('banques').select('id, nom, numero_compte, intitule_compte, actif').order('nom'),
      supabase.from('caisses').select('id, nom').eq('actif', true).order('nom'),
    ])
    setBanques(banquesData || [])
    setCaisses(caissesData || [])
    const soldesMap = {}
    await Promise.all(
      (banquesData || []).map(async (b) => {
        const { data } = await supabase.rpc('solde_banque', { p_banque_id: b.id })
        soldesMap[b.id] = data || 0
      })
    )
    setSoldes(soldesMap)
    if (banquesData?.length > 0) {
      setBanqueGrandLivreId((id) => id || banquesData[0].id)
      setBanqueRapproId((id) => id || banquesData[0].id)
      setTransfertBanqueId((id) => id || banquesData[0].id)
    }
    setChargement(false)
  }

  function ouvrirNouvelleBanque() {
    setBanqueEnEdition(null)
    setNomBanque('')
    setNumeroCompte('')
    setIntituleCompte('')
    setErreurBanque('')
    setModalBanque(true)
  }

  function ouvrirEditionBanque(b) {
    setBanqueEnEdition(b)
    setNomBanque(b.nom)
    setNumeroCompte(b.numero_compte || '')
    setIntituleCompte(b.intitule_compte || '')
    setErreurBanque('')
    setModalBanque(true)
  }

  async function enregistrerBanque(e) {
    e.preventDefault()
    setErreurBanque('')
    if (!nomBanque.trim()) {
      setErreurBanque(t('erreurs.nomRequis'))
      return
    }
    setEnvoiBanque(true)
    const { error } = banqueEnEdition
      ? await supabase.rpc('modifier_banque', {
          p_banque_id: banqueEnEdition.id, p_nom: nomBanque, p_numero_compte: numeroCompte, p_intitule_compte: intituleCompte, p_actif: banqueEnEdition.actif,
        })
      : await supabase.rpc('creer_banque', { p_nom: nomBanque, p_numero_compte: numeroCompte, p_intitule_compte: intituleCompte })
    setEnvoiBanque(false)
    if (error) {
      setErreurBanque(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    setModalBanque(false)
    charger()
  }

  async function basculerActifBanque(b) {
    await supabase.rpc('modifier_banque', {
      p_banque_id: b.id, p_nom: b.nom, p_numero_compte: b.numero_compte, p_intitule_compte: b.intitule_compte, p_actif: !b.actif,
    })
    charger()
  }

  async function chargerGrandLivre() {
    if (!banqueGrandLivreId) return
    setChargementGrandLivre(true)
    const { data } = await supabase.rpc('journal_banque', {
      p_banque_id: banqueGrandLivreId, p_date_debut: dateDebut || null, p_date_fin: dateFin || null,
    })
    setGrandLivre(data || [])
    setChargementGrandLivre(false)
  }
  useEffect(() => { if (onglet === 'grandLivre') chargerGrandLivre() }, [onglet, banqueGrandLivreId, dateDebut, dateFin])

  async function chargerTransfertsSortants() {
    if (!transfertBanqueId) return
    const { data } = await supabase
      .from('transferts_banque_caisse')
      .select('id, numero, montant, libelle, statut, created_at, caisse_destination:caisses!caisse_destination_id(nom)')
      .eq('banque_source_id', transfertBanqueId)
      .order('created_at', { ascending: false })
      .limit(20)
    setTransfertsSortants(data || [])
  }
  useEffect(() => { if (onglet === 'transferts') chargerTransfertsSortants() }, [onglet, transfertBanqueId])

  async function creerTransfertBanqueCaisse(e) {
    e.preventDefault()
    setErreurTransfert('')
    if (!transfertCaisseId) { setErreurTransfert(t('erreurs.caisseRequise')); return }
    if (!transfertMontant || Number(transfertMontant) <= 0) { setErreurTransfert(t('erreurs.montantInvalide')); return }
    setEnvoiTransfert(true)
    const { error } = await supabase.rpc('creer_transfert_banque_caisse', {
      p_banque_source_id: transfertBanqueId, p_caisse_destination_id: transfertCaisseId,
      p_montant: Number(transfertMontant), p_libelle: transfertLibelle,
    })
    setEnvoiTransfert(false)
    if (error) { setErreurTransfert(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`); return }
    setTransfertCaisseId(''); setTransfertMontant(''); setTransfertLibelle('')
    setModalTransfert(false)
    charger(); chargerTransfertsSortants()
  }

  function lireReleveExcel(e) {
    const fichier = e.target.files?.[0]
    if (!fichier) return
    setErreurRappro('')
    setResultatRappro(null)
    setFichierReleveNom(fichier.name)
    const lecteur = new FileReader()
    lecteur.onload = (event) => {
      try {
        const classeur = XLSX.read(event.target.result, { type: 'array' })
        const feuille = classeur.Sheets[classeur.SheetNames[0]]
        const lignes = XLSX.utils.sheet_to_json(feuille, {
          header: ['date', 'libelle', 'montant'],
          range: 1,
          defval: '',
        })
        const lignesValides = lignes
          .map((l) => ({
            date: l.date instanceof Date ? l.date.toISOString().split('T')[0] : String(l.date || '').trim(),
            libelle: String(l.libelle || '').trim(),
            montant: Number(l.montant),
          }))
          .filter((l) => l.libelle && !isNaN(l.montant) && l.montant !== 0)
        setLigneReleve(lignesValides)
        if (lignesValides.length === 0) setErreurRappro(t('erreurs.aucuneLigneReleve'))
      } catch {
        setErreurRappro(t('erreurs.fichierIllisible'))
      }
    }
    lecteur.readAsArrayBuffer(fichier)
  }

  function telechargerModeleReleve() {
    const feuille = XLSX.utils.aoa_to_sheet([
      [t('modele.date'), t('modele.libelle'), t('modele.montant')],
      ['2026-09-01', t('modele.exempleLibelle1'), 500000],
      ['2026-09-03', t('modele.exempleLibelle2'), -85000],
    ])
    const classeur = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(classeur, feuille, 'Releve')
    XLSX.writeFile(classeur, 'modele-releve-bancaire.xlsx')
  }

  async function lancerRapprochement() {
    setErreurRappro('')
    if (!periodeDebutRappro || !periodeFinRappro) { setErreurRappro(t('erreurs.periodeRequise')); return }
    if (ligneReleve.length === 0) { setErreurRappro(t('erreurs.releveRequis')); return }
    setEnvoiRappro(true)

    const { data: rapprochementId, error } = await supabase.rpc('creer_rapprochement', {
      p_banque_id: banqueRapproId, p_periode_debut: periodeDebutRappro, p_periode_fin: periodeFinRappro,
      p_lignes: ligneReleve,
    })
    if (error) {
      setEnvoiRappro(false)
      setErreurRappro(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`)
      return
    }

    const { data: nosMovements } = await supabase.rpc('journal_banque', {
      p_banque_id: banqueRapproId, p_date_debut: periodeDebutRappro, p_date_fin: periodeFinRappro,
    })

    // Rapprochement simple : appariement par montant exact (une ligne
    // du relevé consomme une ligne "chez nous" de même montant).
    // Crédit chez nous = montant positif ; débit chez nous = montant négatif
    // (pour matcher le signe du relevé, où sortie = négatif).
    const nosLignes = (nosMovements || []).map((m) => ({
      date: m.date_mouvement, libelle: m.libelle, montant: Number(m.credit) - Number(m.debit), rapprochee: false,
    }))
    const lignesReleveTravail = ligneReleve.map((l) => ({ ...l, rapprochee: false }))

    for (const ligneNous of nosLignes) {
      const idxMatch = lignesReleveTravail.findIndex((l) => !l.rapprochee && Math.abs(l.montant - ligneNous.montant) < 1)
      if (idxMatch !== -1) {
        lignesReleveTravail[idxMatch].rapprochee = true
        ligneNous.rapprochee = true
      }
    }

    setResultatRappro({
      rapprochees: nosLignes.filter((l) => l.rapprochee).length,
      chezNousNonRapproche: nosLignes.filter((l) => !l.rapprochee),
      banqueNonRapprochee: lignesReleveTravail.filter((l) => !l.rapprochee),
    })
    setEnvoiRappro(false)
  }

  if (!accesAutorise('banques', profil?.role)) {
    return <div className="p-4 max-w-2xl mx-auto"><p className="text-petrol-500">{t('accesRefuse')}</p></div>
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">{t('titre')}</h1>
        {onglet === 'banques' && (
          <button onClick={ouvrirNouvelleBanque} className="btn-primary text-xs">{t('nouvelleBanque')}</button>
        )}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {['banques', 'grandLivre', 'transferts', 'rapprochement'].map((o) => (
          <button
            key={o}
            onClick={() => setOnglet(o)}
            className={`text-sm px-3 py-1.5 rounded-full border ${onglet === o ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line'}`}
          >
            {t(`onglets.${o}`)}
          </button>
        ))}
      </div>

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : banques.length === 0 && onglet !== 'banques' ? (
        <p className="text-petrol-400 text-center py-12 text-sm">{t('aucuneBanque')}</p>
      ) : (
        <>
          {onglet === 'banques' && (
            <div className="space-y-2">
              {banques.map((b) => (
                <div key={b.id} className={`card p-4 ${!b.actif ? 'opacity-50' : ''}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">{b.nom}</p>
                      {b.numero_compte && <p className="text-xs text-petrol-500">{t('rib')} : {b.numero_compte}</p>}
                      {b.intitule_compte && <p className="text-xs text-petrol-500">{b.intitule_compte}</p>}
                    </div>
                    <span className="font-mono font-semibold">{formatXOF(soldes[b.id] || 0)}</span>
                  </div>
                  <div className="flex gap-3 mt-2">
                    <button onClick={() => ouvrirEditionBanque(b)} className="text-xs text-petrol-600 underline">{t('modifier')}</button>
                    <button onClick={() => basculerActifBanque(b)} className="text-xs text-petrol-600 underline">
                      {b.actif ? t('desactiver') : t('reactiver')}
                    </button>
                  </div>
                </div>
              ))}
              {banques.length === 0 && <p className="text-petrol-400 text-center py-12 text-sm">{t('aucuneBanque')}</p>}
            </div>
          )}

          {onglet === 'grandLivre' && banques.length > 0 && (
            <div>
              <div className="flex gap-2 mb-3 items-end flex-wrap">
                <div>
                  <label className="label">{t('banque')}</label>
                  <select className="input-field text-sm" value={banqueGrandLivreId} onChange={(e) => setBanqueGrandLivreId(e.target.value)}>
                    {banques.map((b) => <option key={b.id} value={b.id}>{b.nom}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{t('du')}</label>
                  <input type="date" className="input-field text-sm" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
                </div>
                <div>
                  <label className="label">{t('au')}</label>
                  <input type="date" className="input-field text-sm" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
                </div>
              </div>
              {chargementGrandLivre ? (
                <p className="text-sm text-petrol-500">{t('chargement')}</p>
              ) : (
                <div className="card overflow-x-auto">
                  <table className="w-full text-xs min-w-[560px]">
                    <thead>
                      <tr className="border-b border-line bg-canvas text-left text-petrol-600">
                        <th className="px-3 py-2 font-medium">{t('grandLivre.date')}</th>
                        <th className="px-3 py-2 font-medium">{t('grandLivre.numero')}</th>
                        <th className="px-3 py-2 font-medium">{t('grandLivre.libelle')}</th>
                        <th className="px-3 py-2 font-medium text-right">{t('grandLivre.debit')}</th>
                        <th className="px-3 py-2 font-medium text-right">{t('grandLivre.credit')}</th>
                        <th className="px-3 py-2 font-medium text-right">{t('grandLivre.solde')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grandLivre.map((ligne, i) => (
                        <tr key={i} className="border-b border-line last:border-0">
                          <td className="px-3 py-2 whitespace-nowrap">{formatDateHeure(ligne.date_mouvement, { day: '2-digit', month: '2-digit', year: 'numeric' })}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{ligne.numero}</td>
                          <td className="px-3 py-2">{ligne.libelle}</td>
                          <td className="px-3 py-2 text-right font-mono">{Number(ligne.debit) > 0 ? formatXOF(ligne.debit) : '—'}</td>
                          <td className="px-3 py-2 text-right font-mono text-green-700">{Number(ligne.credit) > 0 ? formatXOF(ligne.credit) : '—'}</td>
                          <td className="px-3 py-2 text-right font-mono font-medium">{formatXOF(ligne.solde)}</td>
                        </tr>
                      ))}
                      {grandLivre.length === 0 && (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-petrol-400">{t('grandLivre.aucunMouvement')}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {onglet === 'transferts' && banques.length > 0 && (
            <div>
              <div className="flex gap-2 mb-3 items-end flex-wrap">
                <div>
                  <label className="label">{t('banque')}</label>
                  <select className="input-field text-sm" value={transfertBanqueId} onChange={(e) => setTransfertBanqueId(e.target.value)}>
                    {banques.map((b) => <option key={b.id} value={b.id}>{b.nom}</option>)}
                  </select>
                </div>
                <button onClick={() => setModalTransfert(true)} className="btn-primary text-sm">{t('nouveauTransfert')}</button>
              </div>
              <p className="text-xs text-petrol-500 mb-3">{t('noteTransfertCaisseVersBanque')}</p>
              <div className="space-y-1.5">
                {transfertsSortants.map((tr) => (
                  <div key={tr.id} className="border border-line rounded-lg p-2.5 flex items-center justify-between text-sm">
                    <div>
                      <p>{tr.numero} — {t('versCaisse', { nom: tr.caisse_destination?.nom || '—' })}</p>
                      <p className="text-xs text-petrol-500">
                        {formatDate(tr.created_at)} — {tr.statut === 'receptionnee' ? t('receptionne') : t('enAttenteReception')}
                      </p>
                    </div>
                    <span className="font-mono">{formatXOF(tr.montant)}</span>
                  </div>
                ))}
                {transfertsSortants.length === 0 && <p className="text-petrol-400 text-center py-8 text-sm">{t('aucunTransfert')}</p>}
              </div>
            </div>
          )}

          {onglet === 'rapprochement' && banques.length > 0 && (
            <div>
              <div className="card p-4 mb-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                  <div>
                    <label className="label">{t('banque')}</label>
                    <select className="input-field text-sm" value={banqueRapproId} onChange={(e) => setBanqueRapproId(e.target.value)}>
                      {banques.map((b) => <option key={b.id} value={b.id}>{b.nom}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">{t('du')}</label>
                    <input type="date" className="input-field text-sm" value={periodeDebutRappro} onChange={(e) => setPeriodeDebutRappro(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">{t('au')}</label>
                    <input type="date" className="input-field text-sm" value={periodeFinRappro} onChange={(e) => setPeriodeFinRappro(e.target.value)} />
                  </div>
                </div>

                <label className="label">{t('releveExcel')}</label>
                <input type="file" accept=".xlsx,.xls" onChange={lireReleveExcel} className="text-sm mb-1" />
                <button type="button" onClick={telechargerModeleReleve} className="text-xs text-blue-600 underline block mb-2">
                  {t('telechargerModele')}
                </button>
                {fichierReleveNom && ligneReleve.length > 0 && (
                  <p className="text-xs text-green-700 mb-2">{t('lignesDetectees', { n: ligneReleve.length, fichier: fichierReleveNom })}</p>
                )}
                {erreurRappro && <p className="text-xs text-red-600 mb-2">{erreurRappro}</p>}
                <button onClick={lancerRapprochement} disabled={envoiRappro} className="btn-primary text-sm w-full">
                  {envoiRappro ? t('enCours') : t('lancerRapprochement')}
                </button>
              </div>

              {resultatRappro && (
                <div className="space-y-4">
                  <div className="card p-3 bg-green-50 border-green-200 text-sm text-green-800">
                    {t('resultat.rapprochees', { n: resultatRappro.rapprochees })}
                  </div>

                  <div>
                    <h3 className="font-semibold text-sm mb-2">{t('resultat.chezNousTitre', { n: resultatRappro.chezNousNonRapproche.length })}</h3>
                    <p className="text-xs text-petrol-500 mb-2">{t('resultat.chezNousAide')}</p>
                    <div className="space-y-1">
                      {resultatRappro.chezNousNonRapproche.map((l, i) => (
                        <div key={i} className="border border-amber-200 bg-amber-50 rounded-lg p-2 flex justify-between text-sm">
                          <span>{formatDate(l.date)} — {l.libelle}</span>
                          <span className="font-mono">{formatXOF(l.montant)}</span>
                        </div>
                      ))}
                      {resultatRappro.chezNousNonRapproche.length === 0 && <p className="text-xs text-petrol-400">{t('resultat.aucunEcart')}</p>}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold text-sm mb-2">{t('resultat.banqueTitre', { n: resultatRappro.banqueNonRapprochee.length })}</h3>
                    <p className="text-xs text-petrol-500 mb-2">{t('resultat.banqueAide')}</p>
                    <div className="space-y-1">
                      {resultatRappro.banqueNonRapprochee.map((l, i) => (
                        <div key={i} className="border border-red-200 bg-red-50 rounded-lg p-2 flex justify-between text-sm">
                          <span>{l.date ? formatDate(l.date) : '—'} — {l.libelle}</span>
                          <span className="font-mono">{formatXOF(l.montant)}</span>
                        </div>
                      ))}
                      {resultatRappro.banqueNonRapprochee.length === 0 && <p className="text-xs text-petrol-400">{t('resultat.aucunEcart')}</p>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {modalBanque && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-5 w-full max-w-sm">
            <h2 className="font-semibold text-lg mb-3">{banqueEnEdition ? t('modifierBanque') : t('nouvelleBanque')}</h2>
            <form onSubmit={enregistrerBanque} className="space-y-3">
              <div>
                <label className="label">{t('nomBanque')}</label>
                <input className="input-field" value={nomBanque} onChange={(e) => setNomBanque(e.target.value)} placeholder={t('nomBanquePlaceholder')} />
              </div>
              <div>
                <label className="label">{t('numeroCompte')}</label>
                <input className="input-field" value={numeroCompte} onChange={(e) => setNumeroCompte(e.target.value)} placeholder={t('numeroComptePlaceholder')} />
              </div>
              <div>
                <label className="label">{t('intituleCompte')}</label>
                <input className="input-field" value={intituleCompte} onChange={(e) => setIntituleCompte(e.target.value)} />
              </div>
              {erreurBanque && <p className="text-xs text-red-600">{erreurBanque}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setModalBanque(false)} className="btn-secondary flex-1">{t('annuler')}</button>
                <button type="submit" disabled={envoiBanque} className="btn-primary flex-1">{envoiBanque ? t('enCours') : t('enregistrer')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalTransfert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-5 w-full max-w-sm">
            <h2 className="font-semibold text-lg mb-3">{t('transfertVersCaisse')}</h2>
            <form onSubmit={creerTransfertBanqueCaisse} className="space-y-3">
              <div>
                <label className="label">{t('caisseDestination')}</label>
                <select className="input-field" value={transfertCaisseId} onChange={(e) => setTransfertCaisseId(e.target.value)}>
                  <option value="">{t('selectionner')}</option>
                  {caisses.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('montant')}</label>
                <input type="number" min="0" className="input-field" value={transfertMontant} onChange={(e) => setTransfertMontant(e.target.value)} />
              </div>
              <div>
                <label className="label">{t('libelleOptionnel')}</label>
                <input className="input-field" value={transfertLibelle} onChange={(e) => setTransfertLibelle(e.target.value)} />
              </div>
              {erreurTransfert && <p className="text-xs text-red-600">{erreurTransfert}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setModalTransfert(false)} className="btn-secondary flex-1">{t('annuler')}</button>
                <button type="submit" disabled={envoiTransfert} className="btn-primary flex-1">{envoiTransfert ? t('enCours') : t('envoyer')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
