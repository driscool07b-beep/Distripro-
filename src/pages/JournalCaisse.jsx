import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { accesAutorise } from '../lib/accesRole'
import { formatXOF, formatDate, formatDateHeure } from '../lib/format'
import { genererBonCaisse, exporterExcel, exporterPDF } from '../lib/export'
import { traduireErreur } from '../lib/erreurs'
import i18n from '../lib/i18n'

export default function JournalCaisse() {
  const { t } = useTranslation('journalcaisse')
  const { profil, entreprise } = useAuth()

  const [onglet, setOnglet] = useState('demandes')
  const [caisses, setCaisses] = useState([])
  const [caisseId, setCaisseId] = useState('')
  const [solde, setSolde] = useState(0)
  const [demandes, setDemandes] = useState([])
  const [transfertsEntrants, setTransfertsEntrants] = useState([])
  const [chargement, setChargement] = useState(true)

  const [montantsAValider, setMontantsAValider] = useState({})
  const [refusEnCours, setRefusEnCours] = useState(null)
  const [motifRefus, setMotifRefus] = useState('')
  const [editionEnCours, setEditionEnCours] = useState(null)
  const [editLibelle, setEditLibelle] = useState('')
  const [editMontant, setEditMontant] = useState('')
  const [editBeneficiaire, setEditBeneficiaire] = useState('')

  const [modalNouvelleDemande, setModalNouvelleDemande] = useState(false)
  const [libelle, setLibelle] = useState('')
  const [montant, setMontant] = useState('')
  const [beneficiaire, setBeneficiaire] = useState('')
  const [fichier, setFichier] = useState(null)
  const [envoiDemande, setEnvoiDemande] = useState(false)
  const [erreurDemande, setErreurDemande] = useState('')

  const [modalApprovisionnement, setModalApprovisionnement] = useState(false)
  const [approSource, setApproSource] = useState('banque')
  const [approLibelle, setApproLibelle] = useState('')
  const [approMontant, setApproMontant] = useState('')
  const [approReference, setApproReference] = useState('')
  const [envoiAppro, setEnvoiAppro] = useState(false)
  const [erreurAppro, setErreurAppro] = useState('')

  const [modalTransfert, setModalTransfert] = useState(false)
  const [transfertDestinationType, setTransfertDestinationType] = useState('caisse')
  const [transfertCaisseDestId, setTransfertCaisseDestId] = useState('')
  const [transfertBanqueDestId, setTransfertBanqueDestId] = useState('')
  const [banquesDisponibles, setBanquesDisponibles] = useState([])
  const [transfertMontant, setTransfertMontant] = useState('')
  const [transfertLibelle, setTransfertLibelle] = useState('')
  const [transfertReference, setTransfertReference] = useState('')
  const [envoiTransfert, setEnvoiTransfert] = useState(false)
  const [erreurTransfert, setErreurTransfert] = useState('')

  const [modalRetourFonds, setModalRetourFonds] = useState(false)
  const [retourMontant, setRetourMontant] = useState('')
  const [retourMotif, setRetourMotif] = useState('')
  const [retourDemandeId, setRetourDemandeId] = useState('')
  const [envoiRetour, setEnvoiRetour] = useState(false)
  const [erreurRetour, setErreurRetour] = useState('')

  const [grandLivre, setGrandLivre] = useState([])
  const [chargementGrandLivre, setChargementGrandLivre] = useState(true)
  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')

  const [envoiAction, setEnvoiAction] = useState(null)
  const [erreurAction, setErreurAction] = useState('')

  const peutCreer = ['admin', 'manager', 'comptable'].includes(profil?.role)
  const peutValider = (entreprise?.caisse_roles_validateurs || ['admin', 'manager']).includes(profil?.role)

  const [pinConfigure, setPinConfigure] = useState(false)
  const [pinDoitChanger, setPinDoitChanger] = useState(false)
  const [deverrouille, setDeverrouille] = useState(false)
  const [saisiePin, setSaisiePin] = useState('')
  const [nouveauPin, setNouveauPin] = useState('')
  const [confirmationPin, setConfirmationPin] = useState('')
  const [erreurPin, setErreurPin] = useState('')
  const [envoiPin, setEnvoiPin] = useState(false)

  useEffect(() => {
    if (peutValider) {
      supabase.rpc('statut_pin_validation').then(({ data }) => {
        const ligne = Array.isArray(data) ? data[0] : data
        setPinConfigure(!!ligne?.pin_configure)
        setPinDoitChanger(!!ligne?.doit_changer)
        setDeverrouille(!ligne?.pin_configure)
      })
    }
  }, [peutValider])

  useEffect(() => {
    if (!deverrouille || !pinConfigure) return
    let minuteur = setTimeout(() => setDeverrouille(false), 60000)
    function reinitialiserMinuteur() {
      clearTimeout(minuteur)
      minuteur = setTimeout(() => setDeverrouille(false), 60000)
    }
    window.addEventListener('mousemove', reinitialiserMinuteur)
    window.addEventListener('keydown', reinitialiserMinuteur)
    window.addEventListener('click', reinitialiserMinuteur)
    return () => {
      clearTimeout(minuteur)
      window.removeEventListener('mousemove', reinitialiserMinuteur)
      window.removeEventListener('keydown', reinitialiserMinuteur)
      window.removeEventListener('click', reinitialiserMinuteur)
    }
  }, [deverrouille, pinConfigure])

  async function verifierPin() {
    setErreurPin('')
    setEnvoiPin(true)
    const { data, error } = await supabase.rpc('verifier_pin_validation', { p_pin: saisiePin })
    setEnvoiPin(false)
    if (error || !data) {
      setErreurPin(t('pin.codeIncorrect'))
      return
    }
    setSaisiePin('')
    setDeverrouille(true)
  }

  async function definirNouveauPin(e) {
    e.preventDefault()
    setErreurPin('')
    if (nouveauPin.length < 4) { setErreurPin(t('pin.erreurLongueur')); return }
    if (nouveauPin !== confirmationPin) { setErreurPin(t('pin.erreurConfirmation')); return }
    setEnvoiPin(true)
    const { error } = await supabase.rpc('definir_pin_validation', { p_pin: nouveauPin })
    setEnvoiPin(false)
    if (error) { setErreurPin(t('pin.erreurEnregistrement')); return }
    setNouveauPin(''); setConfirmationPin('')
    setPinDoitChanger(false)
    setPinConfigure(true)
    setDeverrouille(true)
  }

  useEffect(() => {
    chargerCaisses()
  }, [])

  useEffect(() => {
    if (caisseId) {
      charger()
      chargerGrandLivre()
    }
  }, [caisseId])

  async function chargerCaisses() {
    const { data } = await supabase.from('caisses').select('id, nom, actif').eq('actif', true).order('nom')
    setCaisses(data || [])
    if (data && data.length > 0) setCaisseId(data[0].id)
    else setChargement(false)
    supabase.from('banques').select('id, nom').eq('actif', true).order('nom').then(({ data }) => setBanquesDisponibles(data || []))
  }

  async function charger() {
    setChargement(true)
    const [{ data: soldeData }, { data: demandesData }, { data: transfertsCaisseData }, { data: transfertsBanqueData }] = await Promise.all([
      supabase.rpc('solde_caisse', { p_caisse_id: caisseId }),
      supabase
        .from('demandes_decaissement')
        .select('id, numero, libelle, montant_demande, montant_valide, beneficiaire, statut, piece_justificative_path, piece_justificative_nom, motif_refus, created_at, valide_at, payee_at, demande_par, demandeur:profils!demande_par(nom), validateur:profils!valide_par(nom), payeur:profils!payee_par(nom)')
        .eq('caisse_id', caisseId)
        .order('created_at', { ascending: false }),
      supabase
        .from('caisse_transferts')
        .select('id, numero, montant, libelle, created_at, caisse_source:caisses!caisse_source_id(nom), auteur:profils!created_by(nom)')
        .eq('caisse_destination_id', caisseId)
        .eq('statut', 'en_attente')
        .order('created_at', { ascending: false }),
      supabase
        .from('transferts_banque_caisse')
        .select('id, numero, montant, libelle, created_at, banque_source:banques!banque_source_id(nom), auteur:profils!created_by(nom)')
        .eq('caisse_destination_id', caisseId)
        .eq('statut', 'en_attente')
        .order('created_at', { ascending: false }),
    ])
    setSolde(soldeData || 0)
    setDemandes(demandesData || [])
    setTransfertsEntrants([
      ...(transfertsCaisseData || []).map((tr) => ({ ...tr, origine: 'caisse', nomOrigine: tr.caisse_source?.nom })),
      ...(transfertsBanqueData || []).map((tr) => ({ ...tr, origine: 'banque', nomOrigine: tr.banque_source?.nom })),
    ])
    setChargement(false)
  }

  async function chargerGrandLivre() {
    setChargementGrandLivre(true)
    const { data } = await supabase.rpc('journal_caisse', {
      p_caisse_id: caisseId,
      p_date_debut: dateDebut || null,
      p_date_fin: dateFin || null,
    })
    setGrandLivre(data || [])
    setChargementGrandLivre(false)
  }

  const colonnesGrandLivre = [
    { cle: 'date', titre: t('grandLivre.date') },
    { cle: 'numero', titre: t('grandLivre.numero') },
    { cle: 'libelle', titre: t('grandLivre.libelle') },
    { cle: 'debit', titre: t('grandLivre.debit'), alignDroite: true },
    { cle: 'credit', titre: t('grandLivre.credit'), alignDroite: true },
    { cle: 'solde', titre: t('grandLivre.solde'), alignDroite: true },
  ]

  function lignesGrandLivrePourExport() {
    return grandLivre.map((l) => ({
      date: formatDateHeure(l.date_mouvement, { day: '2-digit', month: '2-digit', year: 'numeric' }),
      numero: l.numero,
      libelle: l.libelle,
      debit: Number(l.debit) > 0 ? Number(l.debit) : '',
      credit: Number(l.credit) > 0 ? Number(l.credit) : '',
      solde: Number(l.solde),
    }))
  }

  function exporterGrandLivreExcel() {
    const nomCaisse = caisses.find((c) => c.id === caisseId)?.nom || 'caisse'
    exporterExcel(`grand-livre-${nomCaisse}`, colonnesGrandLivre, lignesGrandLivrePourExport())
  }

  function exporterGrandLivrePDF() {
    const nomCaisse = caisses.find((c) => c.id === caisseId)?.nom || ''
    const soldeFinal = grandLivre.length > 0 ? Number(grandLivre[grandLivre.length - 1].solde) : 0
    exporterPDF(
      `grand-livre-${nomCaisse}`,
      t('grandLivreTitrePdf', { nom: nomCaisse }),
      dateDebut && dateFin ? t('periodePdf', { debut: formatDate(dateDebut), fin: formatDate(dateFin) }) : '',
      colonnesGrandLivre,
      lignesGrandLivrePourExport(),
      t('soldeFinalPdf'),
      formatXOF(soldeFinal),
      entreprise
    )
  }

  const demandesEnAttente = demandes.filter((d) => d.statut === 'en_attente')
  const demandesAPayer = demandes.filter((d) => d.statut === 'validee')
  const demandesHistorique = demandes.filter((d) => ['payee', 'refusee', 'annulee'].includes(d.statut))
  const demandesPayees = demandes.filter((d) => d.statut === 'payee')

  const totalAccorde = demandesEnAttente.reduce((s, d) => s + Number(montantsAValider[d.id] ?? d.montant_demande), 0)
  const soldeProjete = solde - totalAccorde - demandesAPayer.reduce((s, d) => s + Number(d.montant_valide), 0)

  async function voirPieceJustificative(chemin) {
    const { data } = await supabase.storage.from('pieces-jointes').createSignedUrl(chemin, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function creerDemande(e) {
    e.preventDefault()
    setErreurDemande('')
    if (!libelle.trim()) { setErreurDemande(t('erreurs.libelleRequis')); return }
    if (!montant || Number(montant) <= 0) { setErreurDemande(t('erreurs.montantInvalide')); return }
    setEnvoiDemande(true)

    let cheminPiece = null
    let nomPiece = null
    if (fichier) {
      nomPiece = fichier.name
      cheminPiece = `${entreprise?.id}/decaissements/${caisseId}/${Date.now()}-${fichier.name}`
      const { error: erreurUpload } = await supabase.storage.from('pieces-jointes').upload(cheminPiece, fichier)
      if (erreurUpload) {
        setEnvoiDemande(false)
        setErreurDemande(`${t('erreurs.erreur')} : ${traduireErreur(erreurUpload.message)}`)
        return
      }
    }

    const { error } = await supabase.rpc('creer_demande_decaissement', {
      p_caisse_id: caisseId,
      p_libelle: libelle.trim(),
      p_montant: Number(montant),
      p_piece_path: cheminPiece,
      p_piece_nom: nomPiece,
      p_beneficiaire: beneficiaire.trim() || null,
    })

    setEnvoiDemande(false)
    if (error) { setErreurDemande(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`); return }
    setLibelle(''); setMontant(''); setBeneficiaire(''); setFichier(null)
    setModalNouvelleDemande(false)
    charger()
  }

  function ouvrirEdition(d) {
    setEditionEnCours(d.id)
    setEditLibelle(d.libelle)
    setEditMontant(String(d.montant_demande))
    setEditBeneficiaire(d.beneficiaire || '')
  }

  async function enregistrerEdition(demandeId) {
    setEnvoiAction(demandeId)
    setErreurAction('')
    const { error } = await supabase.rpc('modifier_demande_decaissement', {
      p_demande_id: demandeId,
      p_libelle: editLibelle.trim(),
      p_montant: Number(editMontant),
      p_beneficiaire: editBeneficiaire.trim() || null,
    })
    setEnvoiAction(null)
    if (error) { setErreurAction(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`); return }
    setEditionEnCours(null)
    charger()
  }

  async function annulerDemande(demandeId) {
    setEnvoiAction(demandeId)
    setErreurAction('')
    const { error } = await supabase.rpc('annuler_demande_decaissement', { p_demande_id: demandeId })
    setEnvoiAction(null)
    if (error) { setErreurAction(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`); return }
    charger()
  }

  async function valider(demandeId) {
    setErreurAction(''); setEnvoiAction(demandeId)
    const montantValide = Number(montantsAValider[demandeId] ?? demandes.find((d) => d.id === demandeId)?.montant_demande)
    const { error } = await supabase.rpc('valider_demande_decaissement', { p_demande_id: demandeId, p_montant_valide: montantValide })
    setEnvoiAction(null)
    if (error) { setErreurAction(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`); return }
    charger()
  }

  async function confirmerRefus(demandeId) {
    setErreurAction(''); setEnvoiAction(demandeId)
    const { error } = await supabase.rpc('valider_demande_decaissement', {
      p_demande_id: demandeId, p_montant_valide: 0, p_motif_refus: motifRefus.trim() || null,
    })
    setEnvoiAction(null)
    if (error) { setErreurAction(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`); return }
    setRefusEnCours(null); setMotifRefus('')
    charger()
  }

  async function payer(demande) {
    setErreurAction(''); setEnvoiAction(demande.id)
    const { error } = await supabase.rpc('payer_demande_decaissement', { p_demande_id: demande.id })
    setEnvoiAction(null)
    if (error) { setErreurAction(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`); return }

    const caisse = caisses.find((c) => c.id === caisseId)
    const doc = genererBonCaisse({
      entreprise,
      demande: { ...demande, payee_at: new Date().toISOString() },
      caisse,
      demandePar: demande.demandeur,
      validePar: demande.validateur,
      payePar: profil,
    })
    doc.save(`${demande.numero || 'bon-caisse'}.pdf`)
    charger()
  }

  async function creerApprovisionnement(e) {
    e.preventDefault()
    setErreurAppro('')
    if (!approLibelle.trim()) { setErreurAppro(t('erreurs.libelleRequis')); return }
    if (!approMontant || Number(approMontant) <= 0) { setErreurAppro(t('erreurs.montantInvalide')); return }
    setEnvoiAppro(true)
    const { error } = await supabase.rpc('creer_approvisionnement', {
      p_caisse_id: caisseId, p_source: approSource, p_libelle: approLibelle.trim(),
      p_montant: Number(approMontant), p_reference: approReference.trim() || null,
    })
    setEnvoiAppro(false)
    if (error) { setErreurAppro(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`); return }
    setApproLibelle(''); setApproMontant(''); setApproReference('')
    setModalApprovisionnement(false)
    charger(); chargerGrandLivre()
  }

  async function creerTransfert(e) {
    e.preventDefault()
    setErreurTransfert('')
    if (!transfertMontant || Number(transfertMontant) <= 0) { setErreurTransfert(t('erreurs.montantInvalide')); return }
    if (transfertDestinationType === 'caisse' && !transfertCaisseDestId) { setErreurTransfert(t('erreurs.destinationRequise')); return }
    if (transfertDestinationType === 'banque' && !transfertBanqueDestId) { setErreurTransfert(t('erreurs.destinationRequise')); return }
    setEnvoiTransfert(true)
    const { error } = await supabase.rpc('creer_transfert_caisse', {
      p_caisse_source_id: caisseId,
      p_caisse_destination_id: transfertDestinationType === 'caisse' ? transfertCaisseDestId : null,
      p_banque_destination_id: transfertDestinationType === 'banque' ? transfertBanqueDestId : null,
      p_montant: Number(transfertMontant),
      p_libelle: transfertLibelle.trim() || null,
      p_reference_bancaire: transfertReference.trim() || null,
    })
    setEnvoiTransfert(false)
    if (error) { setErreurTransfert(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`); return }
    setTransfertCaisseDestId(''); setTransfertBanqueDestId(''); setTransfertMontant(''); setTransfertLibelle(''); setTransfertReference('')
    setModalTransfert(false)
    charger(); chargerGrandLivre()
  }

  async function receptionnerTransfert(transfertId, origine) {
    setEnvoiAction(transfertId)
    const nomFonction = origine === 'banque' ? 'receptionner_transfert_banque_caisse' : 'receptionner_transfert_caisse'
    const { error } = await supabase.rpc(nomFonction, { p_transfert_id: transfertId })
    setEnvoiAction(null)
    if (error) { setErreurAction(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`); return }
    charger(); chargerGrandLivre()
  }

  async function creerRetourFonds(e) {
    e.preventDefault()
    setErreurRetour('')
    if (!retourMontant || Number(retourMontant) <= 0) { setErreurRetour(t('erreurs.montantInvalide')); return }
    if (!retourMotif.trim()) { setErreurRetour(t('erreurs.motifRequis')); return }
    setEnvoiRetour(true)
    const { error } = await supabase.rpc('creer_retour_fonds', {
      p_caisse_id: caisseId, p_montant: Number(retourMontant), p_motif: retourMotif.trim(),
      p_demande_id: retourDemandeId || null,
    })
    setEnvoiRetour(false)
    if (error) { setErreurRetour(`${t('erreurs.erreur')} : ${traduireErreur(error.message)}`); return }
    setRetourMontant(''); setRetourMotif(''); setRetourDemandeId('')
    setModalRetourFonds(false)
    charger(); chargerGrandLivre()
  }

  if (!accesAutorise('journalCaisse', profil?.role)) {
    return <div className="p-4 max-w-2xl mx-auto"><p className="text-petrol-500">{t('accesRefuse')}</p></div>
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold">{t('titre')}</h1>
        {peutCreer && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setModalRetourFonds(true)} className="btn-secondary text-xs">{t('retourFonds')}</button>
            <button onClick={() => setModalTransfert(true)} className="btn-secondary text-xs">{t('transfert')}</button>
            <button onClick={() => setModalApprovisionnement(true)} className="btn-secondary text-xs">{t('approvisionnement')}</button>
            <button onClick={() => setModalNouvelleDemande(true)} className="btn-primary text-xs">{t('nouvelleDemande')}</button>
          </div>
        )}
      </div>

      <div className="mb-4">
        <label className="label">{t('caisse')}</label>
        <select className="input-field max-w-xs" value={caisseId} onChange={(e) => setCaisseId(e.target.value)}>
          {caisses.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
        {caisses.length === 0 && <p className="text-xs text-petrol-400 mt-1">{t('aucuneCaisse')}</p>}
      </div>

      {caisseId && (
        <>
          <div className="card p-4 mb-4">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-petrol-600">{t('soldeActuel')}</span>
              <span className="font-mono text-xl font-semibold">{formatXOF(solde)}</span>
            </div>
            {(demandesEnAttente.length > 0 || demandesAPayer.length > 0) && (
              <div className="flex justify-between items-baseline mt-1">
                <span className="text-xs text-petrol-500">{t('soldeProjete')}</span>
                <span className={`font-mono text-sm font-medium ${soldeProjete < 0 ? 'text-red-600' : 'text-petrol-700'}`}>
                  {formatXOF(soldeProjete)}
                </span>
              </div>
            )}
            {soldeProjete < 0 && <p className="text-xs text-red-600 mt-2">{t('avertissementSoldeNegatif')}</p>}
          </div>

          {transfertsEntrants.length > 0 && (
            <div className="card p-4 mb-4 border-blue-200 bg-blue-50">
              <p className="text-sm font-semibold text-blue-800 mb-2">{t('transfertsEnAttente', { n: transfertsEntrants.length })}</p>
              <div className="space-y-2">
                {transfertsEntrants.map((tr) => (
                  <div key={tr.id} className="flex items-center justify-between bg-white rounded-lg border border-blue-200 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">
                        {tr.numero} — {tr.origine === 'banque' ? t('depuisBanque', { nom: tr.nomOrigine || '—' }) : t('depuisCaisse', { nom: tr.nomOrigine || '—' })}
                      </p>
                      <p className="text-xs text-petrol-500">{tr.libelle} — {t('envoyeParLe', { nom: tr.auteur?.nom || '—', date: formatDate(tr.created_at) })}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono">{formatXOF(tr.montant)}</span>
                      <button
                        onClick={() => receptionnerTransfert(tr.id, tr.origine)}
                        disabled={envoiAction === tr.id}
                        className="bg-blue-600 text-white text-xs rounded-lg px-3 py-1.5"
                      >
                        {t('receptionner')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 mb-4">
            {['demandes', 'grandLivre'].map((o) => (
              <button
                key={o}
                onClick={() => setOnglet(o)}
                className={`text-sm px-3 py-1.5 rounded-full border ${onglet === o ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line'}`}
              >
                {t(`onglets.${o}`)}
              </button>
            ))}
          </div>

          {onglet === 'demandes' && (
            chargement ? <p className="text-sm text-petrol-500">{t('chargement')}</p> : (
              <>
                {peutValider && demandesEnAttente.length > 0 && pinConfigure && pinDoitChanger && (
                  <div className="mb-6 card p-4 border-amber-300 bg-amber-50">
                    <p className="text-sm font-semibold mb-1">{t('pin.nouveauPinRequis')}</p>
                    <p className="text-xs text-petrol-600 mb-3">{t('pin.nouveauPinRequisAide')}</p>
                    <form onSubmit={definirNouveauPin} className="space-y-2">
                      <input
                        type="password" inputMode="numeric" className="input-field text-sm"
                        placeholder={t('pin.nouveauCode')} value={nouveauPin} onChange={(e) => setNouveauPin(e.target.value)}
                      />
                      <input
                        type="password" inputMode="numeric" className="input-field text-sm"
                        placeholder={t('pin.confirmerCode')} value={confirmationPin} onChange={(e) => setConfirmationPin(e.target.value)}
                      />
                      {erreurPin && <p className="text-xs text-red-600">{erreurPin}</p>}
                      <button type="submit" disabled={envoiPin} className="btn-primary text-sm w-full">
                        {envoiPin ? '…' : t('pin.definirLeCode')}
                      </button>
                    </form>
                  </div>
                )}

                {peutValider && demandesEnAttente.length > 0 && pinConfigure && !pinDoitChanger && !deverrouille && (
                  <div className="mb-6 card p-5 text-center">
                    <p className="text-2xl mb-2">🔒</p>
                    <p className="text-sm font-semibold mb-1">{t('pin.verrouille')}</p>
                    <p className="text-xs text-petrol-500 mb-3">{t('pin.verrouilleAide')}</p>
                    <input
                      type="password" inputMode="numeric" className="input-field text-sm max-w-[160px] mx-auto text-center tracking-widest"
                      placeholder="••••" value={saisiePin} onChange={(e) => setSaisiePin(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && verifierPin()}
                      autoFocus
                    />
                    {erreurPin && <p className="text-xs text-red-600 mt-2">{erreurPin}</p>}
                    <button onClick={verifierPin} disabled={envoiPin} className="btn-primary text-sm mt-3">
                      {envoiPin ? '…' : t('pin.deverrouiller')}
                    </button>
                  </div>
                )}

                {peutValider && demandesEnAttente.length > 0 && (!pinConfigure || (deverrouille && !pinDoitChanger)) && (
                  <div className="mb-6">
                    <h2 className="font-semibold text-sm mb-2">{t('sections.aValider', { n: demandesEnAttente.length })}</h2>
                    <div className="space-y-2">
                      {demandesEnAttente.map((d) => (
                        <div key={d.id} className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <p className="font-medium text-sm">{d.numero} — {d.libelle}</p>
                              <p className="text-xs text-petrol-500">{t('demandePar', { nom: d.demandeur?.nom || '—', date: formatDate(d.created_at) })}</p>
                              {d.beneficiaire && <p className="text-xs text-petrol-500">{t('beneficiaireLabel', { nom: d.beneficiaire })}</p>}
                            </div>
                            <span className="font-mono text-sm shrink-0 ml-2">{formatXOF(d.montant_demande)}</span>
                          </div>
                          {d.piece_justificative_path && (
                            <button onClick={() => voirPieceJustificative(d.piece_justificative_path)} className="text-xs text-blue-600 underline mb-2 block">
                              📎 {d.piece_justificative_nom || t('pieceJustificative')}
                            </button>
                          )}
                          {d.demande_par === profil?.id && (
                            <button onClick={() => annulerDemande(d.id)} disabled={envoiAction === d.id} className="text-xs text-red-600 underline mb-2 block">
                              {t('annulerMaDemande')}
                            </button>
                          )}

                          {refusEnCours === d.id ? (
                            <div className="mt-2 space-y-2">
                              <input className="input-field text-sm" placeholder={t('motifRefusPlaceholder')} value={motifRefus} onChange={(e) => setMotifRefus(e.target.value)} />
                              <div className="flex gap-2">
                                <button onClick={() => setRefusEnCours(null)} className="btn-secondary text-xs flex-1">{t('annuler')}</button>
                                <button onClick={() => confirmerRefus(d.id)} disabled={envoiAction === d.id} className="bg-red-600 text-white text-xs rounded-lg px-3 py-1.5 flex-1">{t('confirmerRefus')}</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <input
                                type="number" min="0" max={d.montant_demande}
                                className="input-field text-sm w-32"
                                value={montantsAValider[d.id] ?? d.montant_demande}
                                onChange={(e) => setMontantsAValider((prev) => ({ ...prev, [d.id]: e.target.value }))}
                              />
                              <span className="text-xs text-petrol-500">{t('aValiderSurDemande', { montant: formatXOF(d.montant_demande) })}</span>
                              <div className="flex-1" />
                              <button onClick={() => setRefusEnCours(d.id)} className="text-xs text-red-600 underline">{t('refuser')}</button>
                              <button onClick={() => valider(d.id)} disabled={envoiAction === d.id} className="bg-green-600 text-white text-xs rounded-lg px-3 py-1.5">
                                {envoiAction === d.id ? '…' : t('valider')}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!peutValider && demandesEnAttente.length > 0 && (
                  <div className="mb-6">
                    <h2 className="font-semibold text-sm mb-2">{t('sections.mesDemandesEnAttente', { n: demandesEnAttente.length })}</h2>
                    <div className="space-y-2">
                      {demandesEnAttente.map((d) => (
                        <div key={d.id} className="border border-line rounded-lg p-3">
                          {editionEnCours === d.id ? (
                            <div className="space-y-2">
                              <input className="input-field text-sm" value={editLibelle} onChange={(e) => setEditLibelle(e.target.value)} placeholder={t('libelle')} />
                              <input type="number" min="0" className="input-field text-sm" value={editMontant} onChange={(e) => setEditMontant(e.target.value)} placeholder={t('montant')} />
                              <input className="input-field text-sm" value={editBeneficiaire} onChange={(e) => setEditBeneficiaire(e.target.value)} placeholder={t('beneficiaire')} />
                              <div className="flex gap-2">
                                <button onClick={() => setEditionEnCours(null)} className="btn-secondary text-xs flex-1">{t('annuler')}</button>
                                <button onClick={() => enregistrerEdition(d.id)} disabled={envoiAction === d.id} className="btn-primary text-xs flex-1">{t('enregistrer')}</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="font-medium text-sm">{d.numero} — {d.libelle}</p>
                                  <p className="text-xs text-petrol-500">{t('enAttenteDeValidation')}</p>
                                </div>
                                <span className="font-mono text-sm">{formatXOF(d.montant_demande)}</span>
                              </div>
                              <div className="flex gap-3 mt-2">
                                <button onClick={() => ouvrirEdition(d)} className="text-xs text-petrol-600 underline">{t('corriger')}</button>
                                <button onClick={() => annulerDemande(d.id)} disabled={envoiAction === d.id} className="text-xs text-red-600 underline">{t('annulerMaDemande')}</button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {erreurAction && <p className="text-xs text-red-600 mb-4">{erreurAction}</p>}

                {demandesAPayer.length > 0 && (
                  <div className="mb-6">
                    <h2 className="font-semibold text-sm mb-2">{t('sections.aPayer', { n: demandesAPayer.length })}</h2>
                    <div className="space-y-2">
                      {demandesAPayer.map((d) => (
                        <div key={d.id} className="border border-green-200 bg-green-50 rounded-lg p-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-sm">{d.numero} — {d.libelle}</p>
                            <p className="text-xs text-petrol-500">{t('valideParLe', { nom: d.validateur?.nom || t('autoValide'), date: formatDate(d.valide_at) })}</p>
                            <span className="font-mono text-sm">{formatXOF(d.montant_valide)}</span>
                          </div>
                          <button onClick={() => payer(d)} disabled={envoiAction === d.id} className="bg-petrol-800 text-white text-sm rounded-lg px-4 py-2 shrink-0">
                            {envoiAction === d.id ? '…' : t('payerMontant')}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h2 className="font-semibold text-sm mb-2">{t('sections.historique')}</h2>
                  <div className="space-y-1.5">
                    {demandesHistorique.map((d) => (
                      <div key={d.id} className="border border-line rounded-lg p-2.5 flex items-center justify-between text-sm">
                        <div>
                          <p className={d.statut !== 'payee' ? 'text-petrol-400 line-through' : ''}>{d.numero} — {d.libelle}</p>
                          <p className="text-xs text-petrol-500">
                            {d.statut === 'payee' && t('payeParLe', { nom: d.payeur?.nom || '—', date: formatDate(d.payee_at) })}
                            {d.statut === 'refusee' && t('refuseeMotif', { motif: d.motif_refus || t('sansMotif') })}
                            {d.statut === 'annulee' && t('annuleeParDemandeur')}
                          </p>
                        </div>
                        <span className={`font-mono ${d.statut !== 'payee' ? 'text-petrol-400' : ''}`}>
                          {formatXOF(d.statut === 'payee' ? d.montant_valide : d.montant_demande)}
                        </span>
                      </div>
                    ))}
                    {demandesHistorique.length === 0 && demandesEnAttente.length === 0 && demandesAPayer.length === 0 && (
                      <p className="text-petrol-400 text-center py-8 text-sm">{t('aucuneDemande')}</p>
                    )}
                  </div>
                </div>
              </>
            )
          )}

          {onglet === 'grandLivre' && (
            <div>
              <div className="flex gap-2 mb-3 items-end flex-wrap">
                <div>
                  <label className="label">{t('du')}</label>
                  <input type="date" lang={i18n.language} className="input-field text-sm" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
                </div>
                <div>
                  <label className="label">{t('au')}</label>
                  <input type="date" lang={i18n.language} className="input-field text-sm" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
                </div>
                <button onClick={chargerGrandLivre} className="btn-secondary text-sm">{t('filtrer')}</button>
                <div className="flex-1" />
                <button onClick={exporterGrandLivreExcel} className="btn-secondary text-sm no-print">{t('excel')}</button>
                <button onClick={exporterGrandLivrePDF} className="btn-secondary text-sm no-print">{t('pdf')}</button>
                <button onClick={() => window.print()} className="btn-secondary text-sm no-print">{t('imprimer')}</button>
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
                          <td className="px-3 py-2 text-petrol-600 whitespace-nowrap">{formatDateHeure(ligne.date_mouvement, { day: '2-digit', month: '2-digit', year: 'numeric' })}</td>
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
        </>
      )}

      {modalNouvelleDemande && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-5 w-full max-w-sm max-h-[85vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-3">{t('nouvelleDemande')}</h2>
            <form onSubmit={creerDemande} className="space-y-3">
              <div>
                <label className="label">{t('libelle')}</label>
                <input className="input-field" value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder={t('libellePlaceholder')} />
              </div>
              <div>
                <label className="label">{t('montant')}</label>
                <input type="number" min="0" className="input-field" value={montant} onChange={(e) => setMontant(e.target.value)} />
              </div>
              <div>
                <label className="label">{t('beneficiaireOptionnel')}</label>
                <input className="input-field" value={beneficiaire} onChange={(e) => setBeneficiaire(e.target.value)} placeholder={t('beneficiairePlaceholder')} />
              </div>
              <div>
                <label className="label">{t('pieceJustificativeOptionnelle')}</label>
                <input type="file" accept="image/*,application/pdf" className="text-sm" onChange={(e) => setFichier(e.target.files?.[0] || null)} />
              </div>
              {erreurDemande && <p className="text-xs text-red-600">{erreurDemande}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setModalNouvelleDemande(false)} className="btn-secondary flex-1">{t('annuler')}</button>
                <button type="submit" disabled={envoiDemande} className="btn-primary flex-1">{envoiDemande ? t('envoi') : t('envoyerDemande')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalApprovisionnement && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-5 w-full max-w-sm">
            <h2 className="font-semibold text-lg mb-3">{t('approvisionnement')}</h2>
            <form onSubmit={creerApprovisionnement} className="space-y-3">
              <div>
                <label className="label">{t('source')}</label>
                <select className="input-field" value={approSource} onChange={(e) => setApproSource(e.target.value)}>
                  <option value="banque">{t('sourceBanque')}</option>
                  <option value="pret">{t('sourcePret')}</option>
                  <option value="autre">{t('sourceAutre')}</option>
                </select>
              </div>
              <div>
                <label className="label">{t('libelle')}</label>
                <input className="input-field" value={approLibelle} onChange={(e) => setApproLibelle(e.target.value)} placeholder={t('approLibellePlaceholder')} />
              </div>
              <div>
                <label className="label">{t('montant')}</label>
                <input type="number" min="0" className="input-field" value={approMontant} onChange={(e) => setApproMontant(e.target.value)} />
              </div>
              <div>
                <label className="label">{t('referenceOptionnelle')}</label>
                <input className="input-field" value={approReference} onChange={(e) => setApproReference(e.target.value)} />
              </div>
              {erreurAppro && <p className="text-xs text-red-600">{erreurAppro}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setModalApprovisionnement(false)} className="btn-secondary flex-1">{t('annuler')}</button>
                <button type="submit" disabled={envoiAppro} className="btn-primary flex-1">{envoiAppro ? t('envoi') : t('enregistrer')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalTransfert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-5 w-full max-w-sm">
            <h2 className="font-semibold text-lg mb-3">{t('transfert')}</h2>
            <form onSubmit={creerTransfert} className="space-y-3">
              <p className="text-xs text-petrol-500">{t('depuisCaisse', { nom: caisses.find((c) => c.id === caisseId)?.nom || '' })}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setTransfertDestinationType('caisse')} className={`flex-1 text-sm px-3 py-2 rounded-lg border ${transfertDestinationType === 'caisse' ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line'}`}>
                  {t('versAutreCaisse')}
                </button>
                <button type="button" onClick={() => setTransfertDestinationType('banque')} className={`flex-1 text-sm px-3 py-2 rounded-lg border ${transfertDestinationType === 'banque' ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line'}`}>
                  {t('versBanque')}
                </button>
              </div>
              {transfertDestinationType === 'caisse' ? (
                <div>
                  <label className="label">{t('caisseDestination')}</label>
                  <select className="input-field" value={transfertCaisseDestId} onChange={(e) => setTransfertCaisseDestId(e.target.value)}>
                    <option value="">{t('selectionner')}</option>
                    {caisses.filter((c) => c.id !== caisseId).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="label">{t('nomBanque')}</label>
                  <select className="input-field" value={transfertBanqueDestId} onChange={(e) => setTransfertBanqueDestId(e.target.value)}>
                    <option value="">{t('selectionner')}</option>
                    {banquesDisponibles.map((b) => <option key={b.id} value={b.id}>{b.nom}</option>)}
                  </select>
                  {banquesDisponibles.length === 0 && <p className="text-xs text-petrol-400 mt-1">{t('aucuneBanqueCreee')}</p>}
                </div>
              )}
              <div>
                <label className="label">{t('montant')}</label>
                <input type="number" min="0" className="input-field" value={transfertMontant} onChange={(e) => setTransfertMontant(e.target.value)} />
              </div>
              <div>
                <label className="label">{t('libelleOptionnel')}</label>
                <input className="input-field" value={transfertLibelle} onChange={(e) => setTransfertLibelle(e.target.value)} />
              </div>
              {transfertDestinationType === 'banque' && (
                <div>
                  <label className="label">{t('referenceBancaireOptionnelle')}</label>
                  <input className="input-field" value={transfertReference} onChange={(e) => setTransfertReference(e.target.value)} />
                </div>
              )}
              {erreurTransfert && <p className="text-xs text-red-600">{erreurTransfert}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setModalTransfert(false)} className="btn-secondary flex-1">{t('annuler')}</button>
                <button type="submit" disabled={envoiTransfert} className="btn-primary flex-1">{envoiTransfert ? t('envoi') : t('envoyer')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalRetourFonds && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-5 w-full max-w-sm">
            <h2 className="font-semibold text-lg mb-3">{t('retourFonds')}</h2>
            <form onSubmit={creerRetourFonds} className="space-y-3">
              <div>
                <label className="label">{t('demandeLieeOptionnelle')}</label>
                <select className="input-field" value={retourDemandeId} onChange={(e) => setRetourDemandeId(e.target.value)}>
                  <option value="">{t('aucuneDemandeLiee')}</option>
                  {demandesPayees.map((d) => <option key={d.id} value={d.id}>{d.numero} — {d.libelle}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('montant')}</label>
                <input type="number" min="0" className="input-field" value={retourMontant} onChange={(e) => setRetourMontant(e.target.value)} />
              </div>
              <div>
                <label className="label">{t('motif')}</label>
                <input className="input-field" value={retourMotif} onChange={(e) => setRetourMotif(e.target.value)} placeholder={t('motifRetourPlaceholder')} />
              </div>
              {erreurRetour && <p className="text-xs text-red-600">{erreurRetour}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setModalRetourFonds(false)} className="btn-secondary flex-1">{t('annuler')}</button>
                <button type="submit" disabled={envoiRetour} className="btn-primary flex-1">{envoiRetour ? t('envoi') : t('enregistrer')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
