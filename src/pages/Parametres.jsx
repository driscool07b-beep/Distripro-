import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import SelecteurCompte from '../components/SelecteurCompte'
import { SYSCOHADA_DEPART } from '../lib/syscohada'
import DiagnosticConnexion from '../components/DiagnosticConnexion'
import { useAuth } from '../context/AuthContext'
import { traduireErreur } from '../lib/erreurs'

const CHAMP_VIDE = { libelle: '', type_champ: 'texte', options: '' }

export default function Parametres() {
  const { t } = useTranslation('parametres')
  const { profil, entreprise, rechargerProfil } = useAuth()
  const TYPES_CHAMP = [
    { value: 'texte', label: t('typesChamp.texte') },
    { value: 'nombre', label: t('typesChamp.nombre') },
    { value: 'oui_non', label: t('typesChamp.oui_non') },
    { value: 'choix_multiple', label: t('typesChamp.choix_multiple') },
  ]
  const [infosLegales, setInfosLegales] = useState({ adresse: '', telephone: '', email: '', ncc: '', rccm: '' })
  const [seuilRemise, setSeuilRemise] = useState('15')
  const [enregistrementSeuil, setEnregistrementSeuil] = useState(false)
  const [erreurSeuil, setErreurSeuil] = useState('')
  const [confirmationSeuil, setConfirmationSeuil] = useState(false)
  const [justificatifObligatoire, setJustificatifObligatoire] = useState(true)
  const [enregistrementJustificatif, setEnregistrementJustificatif] = useState(false)
  const [confirmationJustificatif, setConfirmationJustificatif] = useState(false)
  const [caisses, setCaisses] = useState([])
  const [nouvelleCaisseNom, setNouvelleCaisseNom] = useState('')
  const [erreurCaisse, setErreurCaisse] = useState('')
  const [enregistrementInfos, setEnregistrementInfos] = useState(false)
  const [erreurInfos, setErreurInfos] = useState('')
  const [confirmationInfos, setConfirmationInfos] = useState(false)
  const [assujettiTva, setAssujettiTva] = useState(false)
  const [enregistrementTva, setEnregistrementTva] = useState(false)
  const [devise, setDevise] = useState('XOF')
  const [envoiFondConnexion, setEnvoiFondConnexion] = useState(false)
  const [confirmationFondConnexion, setConfirmationFondConnexion] = useState(false)
  const [erreurFondConnexion, setErreurFondConnexion] = useState('')
  const [enregistrementDevise, setEnregistrementDevise] = useState(false)
  const [seuilCaisse, setSeuilCaisse] = useState('')
  const [toujoursValider, setToujoursValider] = useState(true)
  const [frequenceInventaireStock, setFrequenceInventaireStock] = useState('')
  const [frequenceInventaireCaisse, setFrequenceInventaireCaisse] = useState('')
  const [enregistrementRappels, setEnregistrementRappels] = useState(false)
  const [confirmationRappels, setConfirmationRappels] = useState(false)
  const [justificatifTransfertRequis, setJustificatifTransfertRequis] = useState(false)
  const [enregistrementTransferts, setEnregistrementTransferts] = useState(false)
  const [confirmationTransferts, setConfirmationTransferts] = useState(false)
  const [tracabiliteLotsObligatoire, setTracabiliteLotsObligatoire] = useState(false)
  const [enregistrementTracabilite, setEnregistrementTracabilite] = useState(false)
  const [confirmationTracabilite, setConfirmationTracabilite] = useState(false)
  const [rolesRegularisation, setRolesRegularisation] = useState(['admin', 'manager'])
  const [enregistrementRegularisation, setEnregistrementRegularisation] = useState(false)
  const [confirmationRegularisation, setConfirmationRegularisation] = useState(false)
  const [planComptable, setPlanComptable] = useState([])
  const [chargementPlan, setChargementPlan] = useState(false)
  async function rechargerPlan() {
    const { data } = await supabase.from('plan_comptable').select('id, numero_compte, libelle').order('numero_compte')
    setPlanComptable(data || [])
  }
  async function chargerPlanDepart() {
    setChargementPlan(true)
    await supabase.rpc('importer_plan_comptable', { p_comptes: SYSCOHADA_DEPART })
    await rechargerPlan()
    setChargementPlan(false)
  }
  const [compteChargesId, setCompteChargesId] = useState('')
  const [compteClientsId, setCompteClientsId] = useState('')
  const [compteEcartsId, setCompteEcartsId] = useState('')
  const [compteApportsId, setCompteApportsId] = useState('')
  const [codeJournalCaisse, setCodeJournalCaisse] = useState('CA')
  const [codeJournalBanque, setCodeJournalBanque] = useState('BQ')
  const [enregistrementComptes, setEnregistrementComptes] = useState(false)
  const [confirmationComptes, setConfirmationComptes] = useState(false)
  const [poidsAssiduite, setPoidsAssiduite] = useState(40)
  const [poidsRapports, setPoidsRapports] = useState(35)
  const [poidsVersements, setPoidsVersements] = useState(25)
  const [enregistrementPonderation, setEnregistrementPonderation] = useState(false)
  const [confirmationPonderation, setConfirmationPonderation] = useState(false)
  const [erreurPonderation, setErreurPonderation] = useState('')
  const [rolesValidateurs, setRolesValidateurs] = useState(['admin', 'manager'])
  const [enregistrementCaisse, setEnregistrementCaisse] = useState(false)
  const [confirmationCaisse, setConfirmationCaisse] = useState(false)
  const [equipes, setEquipes] = useState([])
  const [commerciauxEtManagers, setCommerciauxEtManagers] = useState([])
  const [nouvelleEquipeNom, setNouvelleEquipeNom] = useState('')
  const [nouvelleEquipeManager, setNouvelleEquipeManager] = useState('')
  const [erreurEquipe, setErreurEquipe] = useState('')
  const [taxes, setTaxes] = useState([])
  const [nouvelleTaxe, setNouvelleTaxe] = useState({ nom: '', taux: '', base_calcul: 'ttc' })
  const [erreurTaxe, setErreurTaxe] = useState('')
  const [ajoutTaxeEnvoi, setAjoutTaxeEnvoi] = useState(false)

  useEffect(() => {
    if (entreprise) {
      setInfosLegales({
        adresse: entreprise.adresse || '',
        telephone: entreprise.telephone || '',
        email: entreprise.email || '',
        ncc: entreprise.ncc || '',
        rccm: entreprise.rccm || '',
      })
      setSeuilRemise(String(entreprise.seuil_remise_pourcentage ?? 15))
      setJustificatifObligatoire(entreprise.justificatif_stock_obligatoire ?? true)
      setAssujettiTva(entreprise.assujetti_tva ?? false)
      setDevise(entreprise.devise ?? 'XOF')
      setToujoursValider(entreprise.caisse_seuil_validation == null)
      setSeuilCaisse(entreprise.caisse_seuil_validation != null ? String(entreprise.caisse_seuil_validation) : '')
      setRolesValidateurs(entreprise.caisse_roles_validateurs || ['admin', 'manager'])
      setFrequenceInventaireStock(entreprise.frequence_inventaire_stock || '')
      setFrequenceInventaireCaisse(entreprise.frequence_inventaire_caisse || '')
      setJustificatifTransfertRequis(entreprise.justificatif_transfert_requis ?? false)
      setTracabiliteLotsObligatoire(entreprise.tracabilite_lots_obligatoire ?? false)
      setRolesRegularisation(entreprise.roles_regularisation_caisse || ['admin', 'manager'])
      setCompteChargesId(entreprise.compte_charges_decaissement_id || '')
      setCompteClientsId(entreprise.compte_clients_defaut_id || '')
      setCompteEcartsId(entreprise.compte_ecarts_caisse_id || '')
      setCompteApportsId(entreprise.compte_apports_defaut_id || '')
      setCodeJournalCaisse(entreprise.code_journal_caisse || 'CA')
      setCodeJournalBanque(entreprise.code_journal_banque || 'BQ')
      setPoidsAssiduite(entreprise.note_poids_assiduite ?? 40)
      setPoidsRapports(entreprise.note_poids_rapports ?? 35)
      setPoidsVersements(entreprise.note_poids_versements ?? 25)
    }
  }, [entreprise])
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState('')
  const [confirmation, setConfirmation] = useState(false)

  const [champs, setChamps] = useState([])
  const [chargementChamps, setChargementChamps] = useState(true)
  const [nouveauChamp, setNouveauChamp] = useState(CHAMP_VIDE)
  const [ajoutChampEnvoi, setAjoutChampEnvoi] = useState(false)
  const [erreurChamp, setErreurChamp] = useState('')

  const [concurrents, setConcurrents] = useState([])
  const [chargementConcurrents, setChargementConcurrents] = useState(true)
  const [nouveauConcurrent, setNouveauConcurrent] = useState({ nom: '', marque: '' })
  const [ajoutConcurrentEnvoi, setAjoutConcurrentEnvoi] = useState(false)
  const [erreurConcurrent, setErreurConcurrent] = useState('')

  useEffect(() => {
    if (profil?.role === 'admin') {
      chargerChamps()
      chargerConcurrents()
      chargerTaxes()
    }
    if (['admin', 'manager'].includes(profil?.role)) {
      chargerCaisses()
      chargerEquipes()
    }
    if (['admin', 'manager', 'comptable'].includes(profil?.role)) {
      rechargerPlan()
    }
  }, [profil])

  async function chargerEquipes() {
    const [{ data: eq }, { data: membres }] = await Promise.all([
      supabase.from('equipes').select('id, nom, manager_id, profils!manager_id(nom)').order('nom'),
      supabase.from('profils').select('id, nom, role, equipe_id').in('role', ['commercial', 'manager', 'admin']).order('nom'),
    ])
    setEquipes((eq || []).map((e) => ({ ...e, membres: (membres || []).filter((m) => m.equipe_id === e.id) })))
    setCommerciauxEtManagers(membres || [])
  }

  async function creerEquipe() {
    setErreurEquipe('')
    if (!nouvelleEquipeNom.trim()) {
      setErreurEquipe(t('organigramme.erreurNomEquipe'))
      return
    }
    const { error } = await supabase.rpc('creer_equipe', {
      p_nom: nouvelleEquipeNom.trim(),
      p_manager_id: nouvelleEquipeManager || null,
    })
    if (error) {
      setErreurEquipe(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    setNouvelleEquipeNom('')
    setNouvelleEquipeManager('')
    chargerEquipes()
  }

  async function supprimerEquipe(id) {
    await supabase.rpc('supprimer_equipe', { p_equipe_id: id })
    chargerEquipes()
  }

  async function affilier(profilId, equipeId) {
    await supabase.rpc('affilier_commercial_equipe', { p_profil_id: profilId, p_equipe_id: equipeId || null })
    chargerEquipes()
  }

  async function chargerCaisses() {
    const { data } = await supabase.from('caisses').select('id, nom, actif, compte_comptable_id, responsable_id').order('created_at')
    setCaisses(data || [])
  }

  async function basculerAssujettiTva(valeur) {
    setEnregistrementTva(true)
    const { error } = await supabase.rpc('configurer_assujettissement_tva', { p_assujetti: valeur })
    setEnregistrementTva(false)
    if (!error) {
      setAssujettiTva(valeur)
      rechargerProfil?.()
    }
  }

  function toggleRoleValidateur(role) {
    setRolesValidateurs((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }

  async function enregistrerParametrageCaisse() {
    setEnregistrementCaisse(true)
    const { error } = await supabase.rpc('modifier_parametrage_caisse', {
      p_seuil: toujoursValider ? null : (seuilCaisse === '' ? null : Number(seuilCaisse)),
      p_roles_validateurs: rolesValidateurs,
    })
    setEnregistrementCaisse(false)
    if (!error) {
      setConfirmationCaisse(true)
      setTimeout(() => setConfirmationCaisse(false), 2500)
      rechargerProfil?.()
    }
  }

  async function enregistrerRappelsInventaire() {
    setEnregistrementRappels(true)
    const { error } = await supabase.rpc('modifier_parametrage_inventaires', {
      p_frequence_stock: frequenceInventaireStock || null,
      p_frequence_caisse: frequenceInventaireCaisse || null,
    })
    setEnregistrementRappels(false)
    if (!error) {
      setConfirmationRappels(true)
      setTimeout(() => setConfirmationRappels(false), 2500)
      rechargerProfil?.()
    }
  }

  async function enregistrerParametrageTransferts() {
    setEnregistrementTransferts(true)
    const { error } = await supabase.rpc('modifier_parametrage_transferts', { p_justificatif_requis: justificatifTransfertRequis })
    setEnregistrementTransferts(false)
    if (!error) {
      setConfirmationTransferts(true)
      setTimeout(() => setConfirmationTransferts(false), 2500)
      rechargerProfil?.()
    }
  }

  async function enregistrerParametrageTracabilite() {
    setEnregistrementTracabilite(true)
    const { error } = await supabase.rpc('modifier_parametrage_tracabilite', { p_obligatoire: tracabiliteLotsObligatoire })
    setEnregistrementTracabilite(false)
    if (!error) {
      setConfirmationTracabilite(true)
      setTimeout(() => setConfirmationTracabilite(false), 2500)
      rechargerProfil?.()
    }
  }

  function toggleRoleRegularisation(role) {
    setRolesRegularisation((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }

  async function enregistrerParametrageRegularisation() {
    setEnregistrementRegularisation(true)
    const { error } = await supabase.rpc('modifier_parametrage_regularisation', { p_roles: rolesRegularisation })
    setEnregistrementRegularisation(false)
    if (!error) {
      setConfirmationRegularisation(true)
      setTimeout(() => setConfirmationRegularisation(false), 2500)
      rechargerProfil?.()
    }
  }

  async function enregistrerComptesParDefaut() {
    setEnregistrementComptes(true)
    const { error } = await supabase.rpc('modifier_comptes_par_defaut', {
      p_compte_charges_id: compteChargesId || null,
      p_compte_clients_id: compteClientsId || null,
      p_compte_ecarts_id: compteEcartsId || null,
      p_compte_apports_id: compteApportsId || null,
      p_code_journal_caisse: codeJournalCaisse,
      p_code_journal_banque: codeJournalBanque,
    })
    setEnregistrementComptes(false)
    if (!error) {
      setConfirmationComptes(true)
      setTimeout(() => setConfirmationComptes(false), 2500)
      rechargerProfil?.()
    }
  }

  async function affecterCompteCaisse(caisseId, compteId) {
    await supabase.rpc('affecter_compte_caisse', { p_caisse_id: caisseId, p_compte_id: compteId || null })
    chargerCaisses()
  }

  async function affecterResponsableCaisse(caisseId, responsableId) {
    await supabase.rpc('affecter_responsable_caisse', { p_caisse_id: caisseId, p_responsable_id: responsableId || null })
    chargerCaisses()
  }

  async function enregistrerPonderation() {
    setErreurPonderation('')
    const total = Number(poidsAssiduite) + Number(poidsRapports) + Number(poidsVersements)
    if (total !== 100) {
      setErreurPonderation(t('notation.erreurTotal', { total }))
      return
    }
    setEnregistrementPonderation(true)
    const { error } = await supabase.rpc('modifier_ponderation_notation', {
      p_poids_assiduite: Number(poidsAssiduite), p_poids_rapports: Number(poidsRapports), p_poids_versements: Number(poidsVersements),
    })
    setEnregistrementPonderation(false)
    if (error) { setErreurPonderation(`${t('erreur')} : ${traduireErreur(error.message)}`); return }
    setConfirmationPonderation(true)
    setTimeout(() => setConfirmationPonderation(false), 2500)
    rechargerProfil?.()
  }

  async function televerserFondConnexion(e) {
    const fichier = e.target.files?.[0]
    if (!fichier) return
    setErreurFondConnexion('')
    setEnvoiFondConnexion(true)
    const { error } = await supabase.storage
      .from('plateforme-publique')
      .upload('connexion-fond.jpg', fichier, { upsert: true, contentType: fichier.type })
    setEnvoiFondConnexion(false)
    if (error) {
      setErreurFondConnexion(`Erreur : ${traduireErreur(error.message)}`)
      return
    }
    setConfirmationFondConnexion(true)
    setTimeout(() => setConfirmationFondConnexion(false), 3000)
    e.target.value = ''
  }

  async function changerDevise(code) {
    setEnregistrementDevise(true)
    const { error } = await supabase.rpc('modifier_devise_entreprise', { p_devise: code })
    setEnregistrementDevise(false)
    if (!error) {
      setDevise(code)
      rechargerProfil?.()
    }
  }

  async function chargerTaxes() {
    const { data } = await supabase.from('taxes_entreprise').select('id, nom, taux, base_calcul, actif').order('created_at')
    setTaxes(data || [])
  }

  async function ajouterTaxe(e) {
    e.preventDefault()
    setErreurTaxe('')
    if (!nouvelleTaxe.nom.trim() || !nouvelleTaxe.taux) {
      setErreurTaxe(t('facturation.erreurNomTaux'))
      return
    }
    setAjoutTaxeEnvoi(true)
    const { error } = await supabase.rpc('creer_taxe_entreprise', {
      p_nom: nouvelleTaxe.nom.trim(),
      p_taux: Number(nouvelleTaxe.taux),
      p_base_calcul: nouvelleTaxe.base_calcul,
    })
    setAjoutTaxeEnvoi(false)
    if (error) {
      setErreurTaxe(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    setNouvelleTaxe({ nom: '', taux: '', base_calcul: 'ttc' })
    chargerTaxes()
  }

  async function basculerActifTaxe(taxe) {
    await supabase.rpc('modifier_taxe_entreprise', {
      p_taxe_id: taxe.id,
      p_nom: taxe.nom,
      p_taux: taxe.taux,
      p_base_calcul: taxe.base_calcul,
      p_actif: !taxe.actif,
    })
    chargerTaxes()
  }

  async function ajouterCaisse() {
    setErreurCaisse('')
    if (!nouvelleCaisseNom.trim()) return
    const { data, error } = await supabase
      .from('caisses')
      .insert({ entreprise_id: profil.entreprise_id, nom: nouvelleCaisseNom.trim() })
      .select('id, nom, actif')
      .single()
    if (error) {
      setErreurCaisse(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    setCaisses((prev) => [...prev, data])
    setNouvelleCaisseNom('')
  }

  async function basculerCaisseActive(caisse) {
    await supabase.from('caisses').update({ actif: !caisse.actif }).eq('id', caisse.id)
    setCaisses((prev) => prev.map((c) => (c.id === caisse.id ? { ...c, actif: !c.actif } : c)))
  }

  async function chargerConcurrents() {
    setChargementConcurrents(true)
    const { data, error } = await supabase
      .from('produits_concurrents')
      .select('*')
      .order('created_at', { ascending: true })
    if (!error) setConcurrents(data || [])
    setChargementConcurrents(false)
  }

  async function ajouterConcurrent(e) {
    e.preventDefault()
    setErreurConcurrent('')
    if (!nouveauConcurrent.nom.trim()) {
      setErreurConcurrent(t('concurrents.erreurNom'))
      return
    }
    setAjoutConcurrentEnvoi(true)
    const { error } = await supabase.from('produits_concurrents').insert({
      entreprise_id: entreprise.id,
      nom: nouveauConcurrent.nom.trim(),
      marque: nouveauConcurrent.marque.trim() || null,
    })
    setAjoutConcurrentEnvoi(false)
    if (error) {
      setErreurConcurrent(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    setNouveauConcurrent({ nom: '', marque: '' })
    chargerConcurrents()
  }

  async function basculerActifConcurrent(produit) {
    await supabase
      .from('produits_concurrents')
      .update({ actif: !produit.actif })
      .eq('id', produit.id)
    chargerConcurrents()
  }

  async function chargerChamps() {
    setChargementChamps(true)
    const { data, error } = await supabase
      .from('champs_personnalises_rapport')
      .select('*')
      .order('ordre', { ascending: true })
      .order('created_at', { ascending: true })
    if (!error) setChamps(data || [])
    setChargementChamps(false)
  }

  if (profil?.role !== 'admin') {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        <p className="text-petrol-500">
          {t('accesRefuse')}
        </p>
      </div>
    )
  }

  async function basculerValidationTournee() {
    setErreur('')
    setConfirmation(false)
    setEnregistrement(true)
    const { error } = await supabase
      .from('entreprises')
      .update({ validation_tournee_commercial: !entreprise.validation_tournee_commercial })
      .eq('id', entreprise.id)
    setEnregistrement(false)
    if (error) {
      setErreur(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    await rechargerProfil()
    setConfirmation(true)
    setTimeout(() => setConfirmation(false), 2500)
  }

  async function basculerPhotoObligatoire() {
    setErreur('')
    setConfirmation(false)
    setEnregistrement(true)
    const { error } = await supabase
      .from('entreprises')
      .update({ photo_rapport_obligatoire: !entreprise.photo_rapport_obligatoire })
      .eq('id', entreprise.id)
    setEnregistrement(false)
    if (error) {
      setErreur(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    await rechargerProfil()
    setConfirmation(true)
    setTimeout(() => setConfirmation(false), 2500)
  }

  async function enregistrerInfosLegales(e) {
    e.preventDefault()
    setErreurInfos('')
    setConfirmationInfos(false)
    setEnregistrementInfos(true)
    const { error } = await supabase
      .from('entreprises')
      .update({
        adresse: infosLegales.adresse.trim() || null,
        telephone: infosLegales.telephone.trim() || null,
        email: infosLegales.email.trim() || null,
        ncc: infosLegales.ncc.trim() || null,
        rccm: infosLegales.rccm.trim() || null,
      })
      .eq('id', entreprise.id)
    setEnregistrementInfos(false)
    if (error) {
      setErreurInfos(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    await rechargerProfil()
    setConfirmationInfos(true)
    setTimeout(() => setConfirmationInfos(false), 2500)
  }

  async function enregistrerSeuilRemise(e) {
    e.preventDefault()
    setErreurSeuil('')
    setConfirmationSeuil(false)
    const valeur = Number(seuilRemise)
    if (isNaN(valeur) || valeur < 0 || valeur > 100) {
      setErreurSeuil(t('remises.erreurSeuil'))
      return
    }
    setEnregistrementSeuil(true)
    const { error } = await supabase.from('entreprises').update({ seuil_remise_pourcentage: valeur }).eq('id', entreprise.id)
    setEnregistrementSeuil(false)
    if (error) {
      setErreurSeuil(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    await rechargerProfil()
    setConfirmationSeuil(true)
    setTimeout(() => setConfirmationSeuil(false), 2500)
  }

  async function basculerJustificatifObligatoire(valeur) {
    setJustificatifObligatoire(valeur)
    setEnregistrementJustificatif(true)
    const { error } = await supabase.from('entreprises').update({ justificatif_stock_obligatoire: valeur }).eq('id', entreprise.id)
    setEnregistrementJustificatif(false)
    if (!error) {
      await rechargerProfil()
      setConfirmationJustificatif(true)
      setTimeout(() => setConfirmationJustificatif(false), 2500)
    }
  }

  async function ajouterChamp(e) {
    e.preventDefault()
    setErreurChamp('')
    if (!nouveauChamp.libelle.trim()) {
      setErreurChamp(t('champsPersonnalises.erreurLibelle'))
      return
    }
    if (nouveauChamp.type_champ === 'choix_multiple' && !nouveauChamp.options.trim()) {
      setErreurChamp(t('champsPersonnalises.erreurOptions'))
      return
    }
    setAjoutChampEnvoi(true)
    const { error } = await supabase.from('champs_personnalises_rapport').insert({
      entreprise_id: entreprise.id,
      libelle: nouveauChamp.libelle.trim(),
      type_champ: nouveauChamp.type_champ,
      options:
        nouveauChamp.type_champ === 'choix_multiple'
          ? nouveauChamp.options.split(',').map((o) => o.trim()).filter(Boolean)
          : null,
      ordre: champs.length,
    })
    setAjoutChampEnvoi(false)
    if (error) {
      setErreurChamp(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }
    setNouveauChamp(CHAMP_VIDE)
    chargerChamps()
  }

  async function basculerActifChamp(champ) {
    await supabase
      .from('champs_personnalises_rapport')
      .update({ actif: !champ.actif })
      .eq('id', champ.id)
    chargerChamps()
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">{t('titre')}</h1>
        <p className="text-sm text-petrol-500">{entreprise?.nom}</p>
      </div>

      <div className="card p-4">
        <h2 className="font-semibold mb-1">{t('infosLegales.titre')}</h2>
        <p className="text-sm text-petrol-600 mb-4">
          {t('infosLegales.sousTitre')}
        </p>
        <form onSubmit={enregistrerInfosLegales} className="space-y-3">
          <div>
            <label className="label">{t('infosLegales.adresse')}</label>
            <input
              className="input-field"
              value={infosLegales.adresse}
              onChange={(e) => setInfosLegales({ ...infosLegales, adresse: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('infosLegales.telephone')}</label>
              <input
                className="input-field"
                value={infosLegales.telephone}
                onChange={(e) => setInfosLegales({ ...infosLegales, telephone: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t('infosLegales.email')}</label>
              <input
                type="email"
                className="input-field"
                value={infosLegales.email}
                onChange={(e) => setInfosLegales({ ...infosLegales, email: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('infosLegales.ncc')}</label>
              <input
                className="input-field"
                value={infosLegales.ncc}
                onChange={(e) => setInfosLegales({ ...infosLegales, ncc: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t('infosLegales.rccm')}</label>
              <input
                className="input-field"
                value={infosLegales.rccm}
                onChange={(e) => setInfosLegales({ ...infosLegales, rccm: e.target.value })}
              />
            </div>
          </div>
          {erreurInfos && <p className="text-xs text-red-600">{erreurInfos}</p>}
          {confirmationInfos && <p className="text-xs text-green-600">{t('enregistre')}</p>}
          <button type="submit" disabled={enregistrementInfos} className="btn-primary w-full">
            {enregistrementInfos ? t('enregistrement') : t('enregistrer')}
          </button>
        </form>
      </div>

      {['admin', 'manager'].includes(profil?.role) && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">{t('caisses.titre')}</h2>
          <p className="text-sm text-petrol-600 mb-3">
            {t('caisses.sousTitre')}
          </p>
          <div className="space-y-1 mb-3">
            {caisses.map((c) => (
              <div key={c.id} className="border border-line rounded px-3 py-2 text-sm">
                <div className="flex items-center justify-between mb-1.5">
                  <span className={c.actif ? '' : 'text-petrol-400 line-through'}>{c.nom}</span>
                  <button onClick={() => basculerCaisseActive(c)} className="text-xs text-petrol-600 underline">
                    {c.actif ? t('caisses.desactiver') : t('caisses.reactiver')}
                  </button>
                </div>
                {planComptable.length > 0 && (
                  <select
                    className="input-field text-xs py-1"
                    value={c.compte_comptable_id || ''}
                    onChange={(e) => affecterCompteCaisse(c.id, e.target.value)}
                  >
                    <option value="">{t('comptabilite.compteNonAffecte')}</option>
                    {planComptable.map((pc) => <option key={pc.id} value={pc.id}>{pc.numero_compte} — {pc.libelle}</option>)}
                  </select>
                )}
                <select
                  className="input-field text-xs py-1 mt-1.5"
                  value={c.responsable_id || ''}
                  onChange={(e) => affecterResponsableCaisse(c.id, e.target.value)}
                >
                  <option value="">{t('caisses.aucunResponsable')}</option>
                  {commerciauxEtManagers.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
                </select>
              </div>
            ))}
            {caisses.length === 0 && <p className="text-xs text-petrol-400">{t('caisses.aucuneCaisse')}</p>}
          </div>
          <div className="flex gap-2">
            <input
              className="input-field flex-1"
              placeholder={t('caisses.placeholder')}
              value={nouvelleCaisseNom}
              onChange={(e) => setNouvelleCaisseNom(e.target.value)}
            />
            <button data-aide="parametres.caisses.ajouter" onClick={ajouterCaisse} className="btn-secondary text-sm px-3">{t('caisses.ajouter')}</button>
          </div>
          {erreurCaisse && <p className="text-xs text-red-600 mt-2">{erreurCaisse}</p>}
        </div>
      )}

      {['admin', 'manager'].includes(profil?.role) && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">{t('remises.titre')}</h2>
          <p className="text-sm text-petrol-600 mb-3">
            {t('remises.sousTitre')}
          </p>
          <form onSubmit={enregistrerSeuilRemise} className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="label">{t('remises.seuil')}</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                className="input-field"
                value={seuilRemise}
                onChange={(e) => setSeuilRemise(e.target.value)}
              />
            </div>
            <button type="submit" disabled={enregistrementSeuil} className="btn-primary">
              {enregistrementSeuil ? '…' : t('enregistrer')}
            </button>
          </form>
          {erreurSeuil && <p className="text-xs text-red-600 mt-2">{erreurSeuil}</p>}
          {confirmationSeuil && <p className="text-xs text-green-600 mt-2">{t('enregistre')}</p>}
        </div>
      )}

      {['admin', 'manager'].includes(profil?.role) && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">{t('stock.titre')}</h2>
          <label className="flex items-center gap-2 text-sm mt-2">
            <input
              type="checkbox"
              checked={justificatifObligatoire}
              disabled={enregistrementJustificatif}
              onChange={(e) => basculerJustificatifObligatoire(e.target.checked)}
            />
            {t('stock.exigerJustificatif')}
          </label>
          {confirmationJustificatif && <p className="text-xs text-green-600 mt-2">{t('enregistre')}</p>}
        </div>
      )}

      {profil?.role === 'admin' && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">{t('devise.titre')}</h2>
          <p className="text-xs text-petrol-500 mb-3">
            {t('devise.sousTitre')}
          </p>
          <select
            className="input-field"
            value={devise}
            disabled={enregistrementDevise}
            onChange={(e) => changerDevise(e.target.value)}
          >
            <option value="XOF">Franc CFA (UEMOA) — F CFA</option>
            <option value="EUR">Euro — €</option>
            <option value="USD">Dollar américain — $</option>
            <option value="GBP">Livre sterling — £</option>
            <option value="GHS">Cedi ghanéen — GH₵</option>
            <option value="NGN">Naira nigérian — ₦</option>
          </select>
        </div>
      )}

      {profil?.role === 'admin' && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">{t('fondConnexion.titre')}</h2>
          <p className="text-xs text-petrol-500 mb-3">{t('fondConnexion.sousTitre')}</p>
          <input
            type="file"
            accept="image/*"
            onChange={televerserFondConnexion}
            disabled={envoiFondConnexion}
            className="text-sm"
          />
          {envoiFondConnexion && <p className="text-xs text-petrol-500 mt-2">{t('fondConnexion.envoi')}</p>}
          {confirmationFondConnexion && <p className="text-xs text-green-600 mt-2">{t('fondConnexion.confirmation')}</p>}
          {erreurFondConnexion && <p className="text-xs text-red-600 mt-2">{erreurFondConnexion}</p>}
        </div>
      )}

      {['admin', 'manager'].includes(profil?.role) && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">{t('organigramme.titre')}</h2>
          <p className="text-xs text-petrol-500 mb-3">
            {t('organigramme.sousTitre')}
          </p>

          <div className="space-y-3 mb-4">
            {equipes.map((e) => (
              <div key={e.id} className="border border-line rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium">{e.nom}</p>
                    <p className="text-xs text-petrol-500">
                      {t('organigramme.chefEquipe', { nom: e.profils?.nom || t('organigramme.aucun') })}
                    </p>
                  </div>
                  <button data-aide="parametres.organigramme.supprimer" onClick={() => supprimerEquipe(e.id)} className="text-xs text-red-600 underline">
                    {t('organigramme.supprimer')}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {e.membres.filter((m) => m.role === 'commercial').map((m) => (
                    <span key={m.id} className="text-xs bg-canvas border border-line rounded-full px-2 py-1 flex items-center gap-1.5">
                      {m.nom}
                      <button onClick={() => affilier(m.id, null)} className="text-petrol-400 hover:text-red-600">✕</button>
                    </span>
                  ))}
                  {e.membres.filter((m) => m.role === 'commercial').length === 0 && (
                    <span className="text-xs text-petrol-400">{t('organigramme.aucunCommercialAffilie')}</span>
                  )}
                </div>
              </div>
            ))}
            {equipes.length === 0 && <p className="text-xs text-petrol-400">{t('organigramme.aucuneEquipe')}</p>}
          </div>

          <div className="border-t border-line pt-3 mb-4">
            <p className="text-xs font-medium text-petrol-600 mb-2">{t('organigramme.affecterCommercial')}</p>
            <div className="space-y-1.5">
              {commerciauxEtManagers.filter((m) => m.role === 'commercial').map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{c.nom}</span>
                  <select
                    className="input-field w-auto text-xs py-1"
                    value={c.equipe_id || ''}
                    onChange={(ev) => affilier(c.id, ev.target.value || null)}
                  >
                    <option value="">{t('organigramme.aucuneEquipeOption')}</option>
                    {equipes.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-line pt-3">
            <p className="text-xs font-medium text-petrol-600 mb-2">{t('organigramme.nouvelleEquipe')}</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                className="input-field flex-1"
                placeholder={t('organigramme.nomPlaceholder')}
                value={nouvelleEquipeNom}
                onChange={(e) => setNouvelleEquipeNom(e.target.value)}
              />
              <select
                className="input-field sm:w-48"
                value={nouvelleEquipeManager}
                onChange={(e) => setNouvelleEquipeManager(e.target.value)}
              >
                <option value="">{t('organigramme.chefEquipeOptionnel')}</option>
                {commerciauxEtManagers.filter((m) => m.role === 'manager' || m.role === 'admin').map((m) => (
                  <option key={m.id} value={m.id}>{m.nom} — {m.role === 'manager' ? 'manager' : 'admin'}</option>
                ))}
              </select>
              <button data-aide="parametres.organigramme.creer" onClick={creerEquipe} className="btn-primary shrink-0">{t('organigramme.creer')}</button>
            </div>
            {erreurEquipe && <p className="text-xs text-red-600 mt-2">{erreurEquipe}</p>}
          </div>
        </div>
      )}

      {profil?.role === 'admin' && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">{t('journalCaisse.titre')}</h2>
          <p className="text-xs text-petrol-500 mb-3">{t('journalCaisse.sousTitre')}</p>

          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" checked={toujoursValider} onChange={(e) => setToujoursValider(e.target.checked)} />
            {t('journalCaisse.toujoursValider')}
          </label>

          {!toujoursValider && (
            <div className="mb-3">
              <label className="label">{t('journalCaisse.seuil')}</label>
              <input
                type="number"
                min="0"
                className="input-field max-w-xs"
                value={seuilCaisse}
                onChange={(e) => setSeuilCaisse(e.target.value)}
                placeholder={t('journalCaisse.seuilPlaceholder')}
              />
              <p className="text-xs text-petrol-500 mt-1">{t('journalCaisse.seuilAide')}</p>
            </div>
          )}

          <p className="text-xs font-medium text-petrol-600 mb-2 mt-4">{t('journalCaisse.rolesValidateurs')}</p>
          <div className="flex flex-wrap gap-3 mb-3">
            {['admin', 'manager', 'comptable'].map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={rolesValidateurs.includes(role)} onChange={() => toggleRoleValidateur(role)} />
                {t(`roles.${role}`, { ns: 'utilisateurs' })}
              </label>
            ))}
          </div>

          <button onClick={enregistrerParametrageCaisse} disabled={enregistrementCaisse} className="btn-primary text-sm">
            {enregistrementCaisse ? t('enregistrement') : t('enregistrer')}
          </button>
          {confirmationCaisse && <p className="text-xs text-green-600 mt-2">{t('enregistre')}</p>}
        </div>
      )}

      {profil?.role === 'admin' && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">{t('rappelsInventaire.titre')}</h2>
          <p className="text-xs text-petrol-500 mb-3">{t('rappelsInventaire.sousTitre')}</p>

          <div className="mb-3">
            <label className="label">{t('rappelsInventaire.frequenceStock')}</label>
            <select className="input-field max-w-xs" value={frequenceInventaireStock} onChange={(e) => setFrequenceInventaireStock(e.target.value)}>
              <option value="">{t('rappelsInventaire.desactive')}</option>
              <option value="hebdomadaire">{t('rappelsInventaire.hebdomadaire')}</option>
              <option value="mensuel">{t('rappelsInventaire.mensuel')}</option>
              <option value="trimestriel">{t('rappelsInventaire.trimestriel')}</option>
            </select>
          </div>

          <div className="mb-3">
            <label className="label">{t('rappelsInventaire.frequenceCaisse')}</label>
            <select className="input-field max-w-xs" value={frequenceInventaireCaisse} onChange={(e) => setFrequenceInventaireCaisse(e.target.value)}>
              <option value="">{t('rappelsInventaire.desactive')}</option>
              <option value="hebdomadaire">{t('rappelsInventaire.hebdomadaire')}</option>
              <option value="mensuel">{t('rappelsInventaire.mensuel')}</option>
              <option value="trimestriel">{t('rappelsInventaire.trimestriel')}</option>
            </select>
          </div>

          <button onClick={enregistrerRappelsInventaire} disabled={enregistrementRappels} className="btn-primary text-sm">
            {enregistrementRappels ? t('enregistrement') : t('enregistrer')}
          </button>
          {confirmationRappels && <p className="text-xs text-green-600 mt-2">{t('enregistre')}</p>}
        </div>
      )}

      {profil?.role === 'admin' && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">{t('transferts.titre')}</h2>
          <p className="text-xs text-petrol-500 mb-3">{t('transferts.sousTitre')}</p>
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={justificatifTransfertRequis} onChange={(e) => setJustificatifTransfertRequis(e.target.checked)} />
            {t('transferts.exigerJustificatif')}
          </label>
          <button onClick={enregistrerParametrageTransferts} disabled={enregistrementTransferts} className="btn-primary text-sm">
            {enregistrementTransferts ? t('enregistrement') : t('enregistrer')}
          </button>
          {confirmationTransferts && <p className="text-xs text-green-600 mt-2">{t('enregistre')}</p>}
        </div>
      )}

      {profil?.role === 'admin' && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">{t('tracabilite.titre')}</h2>
          <p className="text-xs text-petrol-500 mb-3">{t('tracabilite.sousTitre')}</p>
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={tracabiliteLotsObligatoire} onChange={(e) => setTracabiliteLotsObligatoire(e.target.checked)} />
            {t('tracabilite.rendreObligatoire')}
          </label>
          <button onClick={enregistrerParametrageTracabilite} disabled={enregistrementTracabilite} className="btn-primary text-sm">
            {enregistrementTracabilite ? t('enregistrement') : t('enregistrer')}
          </button>
          {confirmationTracabilite && <p className="text-xs text-green-600 mt-2">{t('enregistre')}</p>}
        </div>
      )}

      {profil?.role === 'admin' && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">{t('regularisation.titre')}</h2>
          <p className="text-xs text-petrol-500 mb-3">{t('regularisation.sousTitre')}</p>
          <div className="flex flex-wrap gap-3 mb-3">
            {['admin', 'manager', 'comptable'].map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={rolesRegularisation.includes(role)} onChange={() => toggleRoleRegularisation(role)} />
                {t(`roles.${role}`, { ns: 'utilisateurs' })}
              </label>
            ))}
          </div>
          <button onClick={enregistrerParametrageRegularisation} disabled={enregistrementRegularisation} className="btn-primary text-sm">
            {enregistrementRegularisation ? t('enregistrement') : t('enregistrer')}
          </button>
          {confirmationRegularisation && <p className="text-xs text-green-600 mt-2">{t('enregistre')}</p>}
        </div>
      )}

      {profil?.role === 'admin' && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">{t('comptabilite.titre')}</h2>
          <p className="text-xs text-petrol-500 mb-3">{t('comptabilite.sousTitre')}</p>
          {planComptable.length === 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 mb-3">
              <p className="text-xs text-amber-800 mb-2">{t('comptabilite.aucunPlanComptable')}</p>
              <button type="button" className="btn-secondary text-xs" disabled={chargementPlan} onClick={chargerPlanDepart}>
                {chargementPlan ? '…' : t('comptabilite.chargerPlanDepart')}
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
            <div>
              <label className="label">{t('comptabilite.compteCharges')}</label>
              <SelecteurCompte valeur={compteChargesId} onChange={setCompteChargesId} comptes={planComptable} onCree={rechargerPlan} aide={t('comptabilite.aideCharges')} />
            </div>
            <div>
              <label className="label">{t('comptabilite.compteClients')}</label>
              <SelecteurCompte valeur={compteClientsId} onChange={setCompteClientsId} comptes={planComptable} onCree={rechargerPlan} aide={t('comptabilite.aideClients')} />
            </div>
            <div>
              <label className="label">{t('comptabilite.compteEcarts')}</label>
              <SelecteurCompte valeur={compteEcartsId} onChange={setCompteEcartsId} comptes={planComptable} onCree={rechargerPlan} aide={t('comptabilite.aideEcarts')} />
            </div>
            <div>
              <label className="label">{t('comptabilite.compteApports')}</label>
              <SelecteurCompte valeur={compteApportsId} onChange={setCompteApportsId} comptes={planComptable} onCree={rechargerPlan} aide={t('comptabilite.aideApports')} />
            </div>
            <div>
              <label className="label">{t('comptabilite.codeJournalCaisse')}</label>
              <input className="input-field text-sm" value={codeJournalCaisse} onChange={(e) => setCodeJournalCaisse(e.target.value)} maxLength={3} />
              <p className="text-[11px] text-petrol-500 mt-1">{t('comptabilite.aideJournaux')}</p>
            </div>
            <div>
              <label className="label">{t('comptabilite.codeJournalBanque')}</label>
              <input className="input-field text-sm" value={codeJournalBanque} onChange={(e) => setCodeJournalBanque(e.target.value)} maxLength={3} />
            </div>
          </div>
          <button onClick={enregistrerComptesParDefaut} disabled={enregistrementComptes} className="btn-primary text-sm">
            {enregistrementComptes ? t('enregistrement') : t('enregistrer')}
          </button>
          {confirmationComptes && <p className="text-xs text-green-600 mt-2">{t('enregistre')}</p>}
        </div>
      )}

      {profil?.role === 'admin' && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">{t('notation.titre')}</h2>
          <p className="text-xs text-petrol-500 mb-3">{t('notation.sousTitre')}</p>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="label">{t('notation.assiduite')}</label>
              <input type="number" min="0" max="100" className="input-field text-sm" value={poidsAssiduite} onChange={(e) => setPoidsAssiduite(e.target.value)} />
            </div>
            <div>
              <label className="label">{t('notation.rapports')}</label>
              <input type="number" min="0" max="100" className="input-field text-sm" value={poidsRapports} onChange={(e) => setPoidsRapports(e.target.value)} />
            </div>
            <div>
              <label className="label">{t('notation.versements')}</label>
              <input type="number" min="0" max="100" className="input-field text-sm" value={poidsVersements} onChange={(e) => setPoidsVersements(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-petrol-400 mb-3">
            {t('notation.total', { total: Number(poidsAssiduite) + Number(poidsRapports) + Number(poidsVersements) })}
          </p>
          {erreurPonderation && <p className="text-xs text-red-600 mb-2">{erreurPonderation}</p>}
          <button onClick={enregistrerPonderation} disabled={enregistrementPonderation} className="btn-primary text-sm">
            {enregistrementPonderation ? t('enregistrement') : t('enregistrer')}
          </button>
          {confirmationPonderation && <p className="text-xs text-green-600 mt-2">{t('enregistre')}</p>}
        </div>
      )}

      {profil?.role === 'admin' && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">{t('facturation.titre')}</h2>
          <p className="text-xs text-petrol-500 mb-3">
            {t('facturation.sousTitre')}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={assujettiTva}
              disabled={enregistrementTva}
              onChange={(e) => basculerAssujettiTva(e.target.checked)}
            />
            {t('facturation.assujettiLabel')}
          </label>
          <p className="text-xs text-petrol-500 mt-1 mb-4">
            {t('facturation.assujettiAide')}
          </p>

          {assujettiTva && (
            <>
              <h3 className="text-sm font-medium mb-2">{t('facturation.autresTaxes')}</h3>
              <div className="space-y-2 mb-3">
                {taxes.length === 0 ? (
                  <p className="text-xs text-petrol-500">{t('facturation.aucuneTaxe')}</p>
                ) : (
                  taxes.map((t2) => (
                    <div key={t2.id} className="flex items-center justify-between border border-line rounded-lg px-3 py-2 text-sm">
                      <div>
                        <span className={t2.actif ? '' : 'text-petrol-400 line-through'}>{t2.nom} — {t2.taux}%</span>
                        <span className="text-xs text-petrol-500 ml-2">
                          ({t2.base_calcul === 'ht' ? t('facturation.surMontantHt') : t('facturation.surMontantTtc')})
                        </span>
                      </div>
                      <button type="button" onClick={() => basculerActifTaxe(t2)} className="text-xs text-petrol-600 underline">
                        {t2.actif ? t('facturation.desactiver') : t('facturation.activer')}
                      </button>
                    </div>
                  ))
                )}
              </div>
              <form onSubmit={ajouterTaxe} className="grid grid-cols-3 gap-2 items-end">
                <div>
                  <label className="label">{t('facturation.nom')}</label>
                  <input
                    className="input-field text-sm"
                    value={nouvelleTaxe.nom}
                    onChange={(e) => setNouvelleTaxe({ ...nouvelleTaxe, nom: e.target.value })}
                    placeholder={t('facturation.nomPlaceholder')}
                  />
                </div>
                <div>
                  <label className="label">{t('facturation.taux')}</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input-field text-sm"
                    value={nouvelleTaxe.taux}
                    onChange={(e) => setNouvelleTaxe({ ...nouvelleTaxe, taux: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">{t('facturation.calculeeSur')}</label>
                  <select
                    className="input-field text-sm"
                    value={nouvelleTaxe.base_calcul}
                    onChange={(e) => setNouvelleTaxe({ ...nouvelleTaxe, base_calcul: e.target.value })}
                  >
                    <option value="ttc">{t('facturation.montantPlusTva')}</option>
                    <option value="ht">{t('facturation.montantHt')}</option>
                  </select>
                </div>
                <div className="col-span-3">
                  <button type="submit" disabled={ajoutTaxeEnvoi} className="btn-secondary text-sm">
                    {ajoutTaxeEnvoi ? '…' : t('facturation.ajouterTaxe')}
                  </button>
                </div>
              </form>
              {erreurTaxe && <p className="text-xs text-red-600 mt-2">{erreurTaxe}</p>}
            </>
          )}
        </div>
      )}

      <div className="card p-4">
        <h2 className="font-semibold mb-1">{t('rapportsVisite.titre')}</h2>
        <p className="text-sm text-petrol-600 mb-4">
          {t('rapportsVisite.sousTitre')}
        </p>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-sm">{t('rapportsVisite.photoObligatoire')}</p>
            <p className="text-xs text-petrol-500">
              {entreprise?.photo_rapport_obligatoire
                ? t('rapportsVisite.activeTexte')
                : t('rapportsVisite.desactiveTexte')}
            </p>
          </div>
          <button
            type="button"
            onClick={basculerPhotoObligatoire}
            disabled={enregistrement}
            className={`shrink-0 w-12 h-7 rounded-full transition-colors relative disabled:opacity-50 ${
              entreprise?.photo_rapport_obligatoire ? 'bg-amber-500' : 'bg-line'
            }`}
          >
            <span
              className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${
                entreprise?.photo_rapport_obligatoire ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 mt-4 pt-4 border-t border-line">
          <div>
            <p className="font-medium text-sm">{t('tourneesValidation.titre')}</p>
            <p className="text-xs text-petrol-500">
              {entreprise?.validation_tournee_commercial ? t('tourneesValidation.active') : t('tourneesValidation.desactive')}
            </p>
          </div>
          <button
            type="button"
            onClick={basculerValidationTournee}
            disabled={enregistrement}
            className={`shrink-0 w-12 h-7 rounded-full transition-colors relative disabled:opacity-50 ${
              entreprise?.validation_tournee_commercial ? 'bg-amber-500' : 'bg-line'
            }`}
          >
            <span
              className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${
                entreprise?.validation_tournee_commercial ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {confirmation && <p className="text-xs text-green-600 mt-3">{t('enregistre')}</p>}
        {erreur && <p className="text-xs text-red-600 mt-3">{erreur}</p>}
      </div>

      <div className="card p-4">
        <h2 className="font-semibold mb-1">{t('champsPersonnalises.titre')}</h2>
        <p className="text-sm text-petrol-600 mb-4">
          {t('champsPersonnalises.sousTitre')}
        </p>

        {chargementChamps ? (
          <p className="text-sm text-petrol-500">{t('champsPersonnalises.chargement')}</p>
        ) : (
          <div className="space-y-2 mb-4">
            {champs.length === 0 && (
              <p className="text-sm text-petrol-400">{t('champsPersonnalises.aucunChamp')}</p>
            )}
            {champs.map((champ) => (
              <div
                key={champ.id}
                className="flex items-center justify-between gap-3 border border-line rounded-lg px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{champ.libelle}</p>
                  <p className="text-xs text-petrol-500">
                    {TYPES_CHAMP.find((tc) => tc.value === champ.type_champ)?.label}
                    {champ.options?.length ? ` — ${champ.options.join(', ')}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => basculerActifChamp(champ)}
                  className={`text-xs underline shrink-0 ${champ.actif ? 'text-petrol-600' : 'text-petrol-400'}`}
                >
                  {champ.actif ? t('champsPersonnalises.actif') : t('champsPersonnalises.desactive')}
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={ajouterChamp} className="border-t border-line pt-4 space-y-3">
          <div>
            <label className="label">{t('champsPersonnalises.libelle')}</label>
            <input
              className="input-field"
              value={nouveauChamp.libelle}
              onChange={(e) => setNouveauChamp({ ...nouveauChamp, libelle: e.target.value })}
              placeholder={t('champsPersonnalises.libellePlaceholder')}
            />
          </div>
          <div>
            <label className="label">{t('champsPersonnalises.typeReponse')}</label>
            <select
              className="input-field"
              value={nouveauChamp.type_champ}
              onChange={(e) => setNouveauChamp({ ...nouveauChamp, type_champ: e.target.value })}
            >
              {TYPES_CHAMP.map((tc) => (
                <option key={tc.value} value={tc.value}>{tc.label}</option>
              ))}
            </select>
          </div>
          {nouveauChamp.type_champ === 'choix_multiple' && (
            <div>
              <label className="label">{t('champsPersonnalises.options')}</label>
              <input
                className="input-field"
                value={nouveauChamp.options}
                onChange={(e) => setNouveauChamp({ ...nouveauChamp, options: e.target.value })}
                placeholder={t('champsPersonnalises.optionsPlaceholder')}
              />
            </div>
          )}
          {erreurChamp && <p className="text-xs text-red-600">{erreurChamp}</p>}
          <button type="submit" disabled={ajoutChampEnvoi} className="btn-primary w-full">
            {ajoutChampEnvoi ? t('ajout') : t('champsPersonnalises.ajouterQuestion')}
          </button>
        </form>
      </div>

      <div className="card p-4">
        <h2 className="font-semibold mb-1">{t('concurrents.titre')}</h2>
        <p className="text-sm text-petrol-600 mb-4">
          {t('concurrents.sousTitre')}
        </p>

        {chargementConcurrents ? (
          <p className="text-sm text-petrol-500">{t('concurrents.chargement')}</p>
        ) : (
          <div className="space-y-2 mb-4">
            {concurrents.length === 0 && (
              <p className="text-sm text-petrol-400">{t('concurrents.aucunProduit')}</p>
            )}
            {concurrents.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 border border-line rounded-lg px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{c.nom}</p>
                  {c.marque && <p className="text-xs text-petrol-500">{c.marque}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => basculerActifConcurrent(c)}
                  className={`text-xs underline shrink-0 ${c.actif ? 'text-petrol-600' : 'text-petrol-400'}`}
                >
                  {c.actif ? t('concurrents.actif') : t('concurrents.desactive')}
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={ajouterConcurrent} className="border-t border-line pt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('concurrents.nomProduit')}</label>
              <input
                className="input-field"
                value={nouveauConcurrent.nom}
                onChange={(e) => setNouveauConcurrent({ ...nouveauConcurrent, nom: e.target.value })}
                placeholder={t('concurrents.nomPlaceholder')}
              />
            </div>
            <div>
              <label className="label">{t('concurrents.marque')}</label>
              <input
                className="input-field"
                value={nouveauConcurrent.marque}
                onChange={(e) => setNouveauConcurrent({ ...nouveauConcurrent, marque: e.target.value })}
              />
            </div>
          </div>
          {erreurConcurrent && <p className="text-xs text-red-600">{erreurConcurrent}</p>}
          <button type="submit" disabled={ajoutConcurrentEnvoi} className="btn-primary w-full">
            {ajoutConcurrentEnvoi ? t('ajout') : t('concurrents.ajouterProduit')}
          </button>
        </form>
      </div>
      {profil?.role === 'admin' && <SectionReconciliation />}
      {profil?.role === 'admin' && <SectionConsommationIA />}
      {profil?.role === 'admin' && <DiagnosticConnexion />}
    </div>
  )
}

// Consommation de l'IA par l'entreprise ce mois-ci (nombre d'utilisations,
// par fonction et par personne). Les coûts restent côté plateforme.
function SectionConsommationIA() {
  const { t } = useTranslation('parametres')
  const [lignes, setLignes] = useState(null)

  useEffect(() => {
    const debut = new Date()
    debut.setDate(1)
    debut.setHours(0, 0, 0, 0)
    supabase
      .from('consommation_ia')
      .select('fonction, profil_id, profils(nom)')
      .gte('created_at', debut.toISOString())
      .then(({ data }) => setLignes(data || []))
  }, [])

  if (lignes === null) return null

  const parFonction = {}
  const parPersonne = {}
  lignes.forEach((l) => {
    parFonction[l.fonction] = (parFonction[l.fonction] || 0) + 1
    const nom = l.profils?.nom || '—'
    parPersonne[nom] = (parPersonne[nom] || 0) + 1
  })

  return (
    <div className="card p-4">
      <h2 className="font-semibold mb-1">{t('consommationIA.titre')}</h2>
      <p className="text-xs text-petrol-500 mb-3">{t('consommationIA.sousTitre')}</p>
      {lignes.length === 0 ? (
        <p className="text-sm text-petrol-400">{t('consommationIA.aucune')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs font-medium text-petrol-600 mb-1">{t('consommationIA.parFonction')}</p>
            {Object.entries(parFonction).map(([f, n]) => (
              <div key={f} className="flex justify-between py-0.5">
                <span>{t(`consommationIA.fonctions.${f}`, f)}</span><span className="font-mono">{n}</span>
              </div>
            ))}
            <div className="flex justify-between py-0.5 border-t border-line mt-1 font-semibold">
              <span>{t('consommationIA.total')}</span><span className="font-mono">{lignes.length}</span>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-petrol-600 mb-1">{t('consommationIA.parPersonne')}</p>
            {Object.entries(parPersonne).sort((a, b) => b[1] - a[1]).map(([nom, n]) => (
              <div key={nom} className="flex justify-between py-0.5">
                <span>{nom}</span><span className="font-mono">{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Paramètres de la réconciliation des commerciaux et des écritures.
function SectionReconciliation() {
  const { t } = useTranslation('parametres')
  const { entreprise, rechargerProfil } = useAuth()
  const [v, setV] = useState(null)
  const [message, setMessage] = useState('')
  const [erreur, setErreur] = useState('')
  const [plan, setPlan] = useState([])
  const chargerPlan = async () => {
    const { data } = await supabase.from('plan_comptable').select('id, numero_compte, libelle').order('numero_compte')
    setPlan(data || [])
  }
  useEffect(() => { chargerPlan() }, [])

  useEffect(() => {
    if (!entreprise) return
    setV({
      racine: entreprise.compte_racine_commerciaux || '471',
      valorisation: entreprise.valorisation_manquant || 'prix_vente',
      ventes: entreprise.compte_ventes_numero || '701',
      stock: entreprise.compte_stock_numero || '31',
      pertes: entreprise.compte_pertes_numero || '658',
      caisse: entreprise.compte_caisse_defaut_numero || '571',
      clients: entreprise.compte_clients_numero || '411',
      avances: entreprise.compte_racine_avances || '421',
      remuneration: entreprise.compte_remuneration_numero || '422',
      retenuesPar: entreprise.retenues_comptabilisees_par || 'paie',
      plafond: entreprise.plafond_retenue_mensuelle ?? '',
    })
  }, [entreprise])

  if (!v) return null
  // Racines (471, 421) : saisies en chiffres ; autres comptes : choisis dans le plan.
  const champ = (cle) => (
    <div key={cle}>
      <label className="label">{t(`reconciliation.${cle}`)}</label>
      {['racine', 'avances'].includes(cle) ? (
        <>
          <input className="input-field font-mono" value={v[cle]} onChange={(e) => setV({ ...v, [cle]: e.target.value })} />
          <p className="text-[11px] text-petrol-500 mt-1">{t(`reconciliation.aide_${cle}`)}</p>
        </>
      ) : (
        <SelecteurCompte mode="numero" valeur={v[cle]} onChange={(val) => setV({ ...v, [cle]: val })} comptes={plan} onCree={chargerPlan} aide={t(`reconciliation.aide_${cle}`)} />
      )}
    </div>
  )

  async function enregistrer() {
    setErreur(''); setMessage('')
    const { error } = await supabase.rpc('modifier_parametres_reconciliation', {
      p_racine: v.racine, p_valorisation: v.valorisation, p_ventes: v.ventes, p_stock: v.stock,
      p_pertes: v.pertes, p_caisse: v.caisse, p_clients: v.clients,
      p_racine_avances: v.avances, p_remuneration: v.remuneration,
      p_retenues_par: v.retenuesPar, p_plafond: v.plafond === '' ? null : Number(v.plafond),
    })
    if (error) { setErreur(traduireErreur(error.message)); return }
    await rechargerProfil()
    setMessage(t('enregistre'))
  }

  return (
    <div className="card p-4">
      <h2 className="font-semibold mb-1">{t('reconciliation.titre')}</h2>
      <p className="text-xs text-petrol-500 mb-3">{t('reconciliation.aide')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {champ('racine')}
        <div>
          <label className="label">{t('reconciliation.valorisation')}</label>
          <select className="input-field" value={v.valorisation} onChange={(e) => setV({ ...v, valorisation: e.target.value })}>
            <option value="prix_vente">{t('reconciliation.prixVente')}</option>
            <option value="prix_revient">{t('reconciliation.prixRevient')}</option>
          </select>
        </div>
        {['ventes', 'clients', 'stock', 'pertes', 'caisse'].map(champ)}
      </div>
      <h3 className="font-semibold text-sm mt-5 mb-1">{t('reconciliation.titreRetenues')}</h3>
      <p className="text-xs text-petrol-500 mb-3">{t('reconciliation.aideRetenues')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {champ('avances')}
        {champ('remuneration')}
        <div>
          <label className="label">{t('reconciliation.retenuesPar')}</label>
          <select className="input-field" value={v.retenuesPar} onChange={(e) => setV({ ...v, retenuesPar: e.target.value })}>
            <option value="paie">{t('reconciliation.parPaie')}</option>
            <option value="distribpro">{t('reconciliation.parDistribpro')}</option>
          </select>
        </div>
        <div>
          <label className="label">{t('reconciliation.plafond')}</label>
          <input type="number" min="0" className="input-field" value={v.plafond} onChange={(e) => setV({ ...v, plafond: e.target.value })} placeholder={t('reconciliation.sansPlafond')} />
        </div>
      </div>
      <button className="btn-primary text-sm mt-3" onClick={enregistrer}>{t('reconciliation.enregistrer')}</button>
      {message && <p className="text-xs text-green-600 mt-2">{message}</p>}
      {erreur && <p className="text-xs text-red-600 mt-2">{erreur}</p>}
    </div>
  )
}
