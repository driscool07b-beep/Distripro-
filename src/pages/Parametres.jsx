import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { traduireErreur } from '../lib/erreurs'

const TYPES_CHAMP = [
  { value: 'texte', label: 'Texte libre' },
  { value: 'nombre', label: 'Nombre' },
  { value: 'oui_non', label: 'Oui / Non' },
  { value: 'choix_multiple', label: 'Choix parmi une liste' },
]

const CHAMP_VIDE = { libelle: '', type_champ: 'texte', options: '' }

export default function Parametres() {
  const { profil, entreprise, rechargerProfil } = useAuth()
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
  const [enregistrementDevise, setEnregistrementDevise] = useState(false)
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
    }
  }, [profil])

  async function chargerCaisses() {
    const { data } = await supabase.from('caisses').select('id, nom, actif').order('created_at')
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
      setErreurTaxe('Le nom et le taux sont requis.')
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
      setErreurTaxe(`Erreur : ${traduireErreur(error.message)}`)
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
      setErreurCaisse(`Erreur : ${traduireErreur(error.message)}`)
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
      setErreurConcurrent('Le nom du produit est requis.')
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
      setErreurConcurrent(`Erreur : ${traduireErreur(error.message)}`)
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
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">
          Cette page est réservée aux administrateurs de l'entreprise.
        </p>
      </div>
    )
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
      setErreur(`Erreur : ${traduireErreur(error.message)}`)
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
      setErreurInfos(`Erreur : ${traduireErreur(error.message)}`)
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
      setErreurSeuil('Le seuil doit être un pourcentage entre 0 et 100.')
      return
    }
    setEnregistrementSeuil(true)
    const { error } = await supabase.from('entreprises').update({ seuil_remise_pourcentage: valeur }).eq('id', entreprise.id)
    setEnregistrementSeuil(false)
    if (error) {
      setErreurSeuil(`Erreur : ${traduireErreur(error.message)}`)
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
      setErreurChamp('Le libellé est requis.')
      return
    }
    if (nouveauChamp.type_champ === 'choix_multiple' && !nouveauChamp.options.trim()) {
      setErreurChamp('Indiquez au moins une option, séparée par des virgules.')
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
      setErreurChamp(`Erreur : ${traduireErreur(error.message)}`)
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
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Paramètres</h1>
        <p className="text-sm text-petrol-500">{entreprise?.nom}</p>
      </div>

      <div className="card p-4">
        <h2 className="font-semibold mb-1">Informations légales</h2>
        <p className="text-sm text-petrol-600 mb-4">
          Affichées sur tous les documents générés (factures, reçus, bons de livraison, proforma).
        </p>
        <form onSubmit={enregistrerInfosLegales} className="space-y-3">
          <div>
            <label className="label">Adresse</label>
            <input
              className="input-field"
              value={infosLegales.adresse}
              onChange={(e) => setInfosLegales({ ...infosLegales, adresse: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Téléphone</label>
              <input
                className="input-field"
                value={infosLegales.telephone}
                onChange={(e) => setInfosLegales({ ...infosLegales, telephone: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Email</label>
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
              <label className="label">NCC (numéro de compte contribuable)</label>
              <input
                className="input-field"
                value={infosLegales.ncc}
                onChange={(e) => setInfosLegales({ ...infosLegales, ncc: e.target.value })}
              />
            </div>
            <div>
              <label className="label">RCCM (registre de commerce)</label>
              <input
                className="input-field"
                value={infosLegales.rccm}
                onChange={(e) => setInfosLegales({ ...infosLegales, rccm: e.target.value })}
              />
            </div>
          </div>
          {erreurInfos && <p className="text-xs text-red-600">{erreurInfos}</p>}
          {confirmationInfos && <p className="text-xs text-green-600">Enregistré.</p>}
          <button type="submit" disabled={enregistrementInfos} className="btn-primary w-full">
            {enregistrementInfos ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </form>
      </div>

      {['admin', 'manager'].includes(profil?.role) && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">Caisses</h2>
          <p className="text-sm text-petrol-600 mb-3">
            Où les commerciaux remettent leurs versements (espèces et autres modes de règlement encaissés).
          </p>
          <div className="space-y-1 mb-3">
            {caisses.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm border border-line rounded px-3 py-2">
                <span className={c.actif ? '' : 'text-petrol-400 line-through'}>{c.nom}</span>
                <button onClick={() => basculerCaisseActive(c)} className="text-xs text-petrol-600 underline">
                  {c.actif ? 'Désactiver' : 'Réactiver'}
                </button>
              </div>
            ))}
            {caisses.length === 0 && <p className="text-xs text-petrol-400">Aucune caisse créée.</p>}
          </div>
          <div className="flex gap-2">
            <input
              className="input-field flex-1"
              placeholder="Ex. Caisse 1"
              value={nouvelleCaisseNom}
              onChange={(e) => setNouvelleCaisseNom(e.target.value)}
            />
            <button onClick={ajouterCaisse} className="btn-secondary text-sm px-3">+ Ajouter</button>
          </div>
          {erreurCaisse && <p className="text-xs text-red-600 mt-2">{erreurCaisse}</p>}
        </div>
      )}

      {['admin', 'manager'].includes(profil?.role) && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">Politique de remises</h2>
          <p className="text-sm text-petrol-600 mb-3">
            Au-delà de ce seuil, un commercial ne peut plus valider seul la remise — seuls un manager
            ou un administrateur peuvent l'appliquer.
          </p>
          <form onSubmit={enregistrerSeuilRemise} className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="label">Seuil (%)</label>
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
              {enregistrementSeuil ? '…' : 'Enregistrer'}
            </button>
          </form>
          {erreurSeuil && <p className="text-xs text-red-600 mt-2">{erreurSeuil}</p>}
          {confirmationSeuil && <p className="text-xs text-green-600 mt-2">Enregistré.</p>}
        </div>
      )}

      {['admin', 'manager'].includes(profil?.role) && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">Politique de stock</h2>
          <label className="flex items-center gap-2 text-sm mt-2">
            <input
              type="checkbox"
              checked={justificatifObligatoire}
              disabled={enregistrementJustificatif}
              onChange={(e) => basculerJustificatifObligatoire(e.target.checked)}
            />
            Exiger un justificatif (photo/PDF) pour tout ajustement manuel de stock
          </label>
          {confirmationJustificatif && <p className="text-xs text-green-600 mt-2">Enregistré.</p>}
        </div>
      )}

      {profil?.role === 'admin' && (
        <div className="card p-4">
          <h2 className="font-semibold mb-1">Devise</h2>
          <p className="text-xs text-petrol-500 mb-3">
            S'applique à tous les montants affichés dans l'app (ventes, stock, créances, reçus…).
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
          <h2 className="font-semibold mb-1">Facturation & taxes</h2>
          <p className="text-xs text-petrol-500 mb-3">
            À vérifier avec ton comptable avant de t'appuyer sur ces calculs pour de vraies factures.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={assujettiTva}
              disabled={enregistrementTva}
              onChange={(e) => basculerAssujettiTva(e.target.checked)}
            />
            Mon entreprise facture la TVA (régime réel normal ou simplifié)
          </label>
          <p className="text-xs text-petrol-500 mt-1 mb-4">
            Une fois activé, chaque produit doit être configuré individuellement (TVA applicable ou non, et à quel
            taux) depuis la page Stock — le taux varie souvent selon la nature de la marchandise.
          </p>

          {assujettiTva && (
            <>
              <h3 className="text-sm font-medium mb-2">Autres taxes (ex. AIRSI)</h3>
              <div className="space-y-2 mb-3">
                {taxes.length === 0 ? (
                  <p className="text-xs text-petrol-500">Aucune autre taxe configurée.</p>
                ) : (
                  taxes.map((t) => (
                    <div key={t.id} className="flex items-center justify-between border border-line rounded-lg px-3 py-2 text-sm">
                      <div>
                        <span className={t.actif ? '' : 'text-petrol-400 line-through'}>{t.nom} — {t.taux}%</span>
                        <span className="text-xs text-petrol-500 ml-2">
                          (sur {t.base_calcul === 'ht' ? 'le montant HT' : 'le montant + TVA'})
                        </span>
                      </div>
                      <button type="button" onClick={() => basculerActifTaxe(t)} className="text-xs text-petrol-600 underline">
                        {t.actif ? 'Désactiver' : 'Activer'}
                      </button>
                    </div>
                  ))
                )}
              </div>
              <form onSubmit={ajouterTaxe} className="grid grid-cols-3 gap-2 items-end">
                <div>
                  <label className="label">Nom</label>
                  <input
                    className="input-field text-sm"
                    value={nouvelleTaxe.nom}
                    onChange={(e) => setNouvelleTaxe({ ...nouvelleTaxe, nom: e.target.value })}
                    placeholder="Ex. AIRSI"
                  />
                </div>
                <div>
                  <label className="label">Taux (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input-field text-sm"
                    value={nouvelleTaxe.taux}
                    onChange={(e) => setNouvelleTaxe({ ...nouvelleTaxe, taux: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Calculée sur</label>
                  <select
                    className="input-field text-sm"
                    value={nouvelleTaxe.base_calcul}
                    onChange={(e) => setNouvelleTaxe({ ...nouvelleTaxe, base_calcul: e.target.value })}
                  >
                    <option value="ttc">Montant + TVA</option>
                    <option value="ht">Montant HT</option>
                  </select>
                </div>
                <div className="col-span-3">
                  <button type="submit" disabled={ajoutTaxeEnvoi} className="btn-secondary text-sm">
                    {ajoutTaxeEnvoi ? '…' : '+ Ajouter cette taxe'}
                  </button>
                </div>
              </form>
              {erreurTaxe && <p className="text-xs text-red-600 mt-2">{erreurTaxe}</p>}
            </>
          )}
        </div>
      )}

      <div className="card p-4">
        <h2 className="font-semibold mb-1">Rapports de visite commerciale</h2>
        <p className="text-sm text-petrol-600 mb-4">
          Lorsqu'un commercial valide une visite pendant une tournée, il peut saisir l'état
          du stock chez le client (rayon et réserve) avec jusqu'à 3 photos à l'appui.
        </p>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-sm">Photo obligatoire pour valider le rapport</p>
            <p className="text-xs text-petrol-500">
              {entreprise?.photo_rapport_obligatoire
                ? 'Activé : au moins une photo doit être ajoutée.'
                : 'Désactivé : le rapport peut être envoyé sans photo.'}
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

        {confirmation && <p className="text-xs text-green-600 mt-3">Réglage enregistré.</p>}
        {erreur && <p className="text-xs text-red-600 mt-3">{erreur}</p>}
      </div>

      <div className="card p-4">
        <h2 className="font-semibold mb-1">Informations supplémentaires à collecter</h2>
        <p className="text-sm text-petrol-600 mb-4">
          Ajoutez vos propres questions pour votre étude commerciale — elles apparaîtront
          automatiquement dans le formulaire de rapport de visite des commerciaux.
        </p>

        {chargementChamps ? (
          <p className="text-sm text-petrol-500">Chargement…</p>
        ) : (
          <div className="space-y-2 mb-4">
            {champs.length === 0 && (
              <p className="text-sm text-petrol-400">Aucun champ personnalisé pour le moment.</p>
            )}
            {champs.map((champ) => (
              <div
                key={champ.id}
                className="flex items-center justify-between gap-3 border border-line rounded-lg px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{champ.libelle}</p>
                  <p className="text-xs text-petrol-500">
                    {TYPES_CHAMP.find((t) => t.value === champ.type_champ)?.label}
                    {champ.options?.length ? ` — ${champ.options.join(', ')}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => basculerActifChamp(champ)}
                  className={`text-xs underline shrink-0 ${champ.actif ? 'text-petrol-600' : 'text-petrol-400'}`}
                >
                  {champ.actif ? 'Actif' : 'Désactivé'}
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={ajouterChamp} className="border-t border-line pt-4 space-y-3">
          <div>
            <label className="label">Libellé de la question</label>
            <input
              className="input-field"
              value={nouveauChamp.libelle}
              onChange={(e) => setNouveauChamp({ ...nouveauChamp, libelle: e.target.value })}
              placeholder="Ex : Présence de la PLV en vitrine ?"
            />
          </div>
          <div>
            <label className="label">Type de réponse</label>
            <select
              className="input-field"
              value={nouveauChamp.type_champ}
              onChange={(e) => setNouveauChamp({ ...nouveauChamp, type_champ: e.target.value })}
            >
              {TYPES_CHAMP.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {nouveauChamp.type_champ === 'choix_multiple' && (
            <div>
              <label className="label">Options (séparées par des virgules)</label>
              <input
                className="input-field"
                value={nouveauChamp.options}
                onChange={(e) => setNouveauChamp({ ...nouveauChamp, options: e.target.value })}
                placeholder="Bonne, Moyenne, Mauvaise"
              />
            </div>
          )}
          {erreurChamp && <p className="text-xs text-red-600">{erreurChamp}</p>}
          <button type="submit" disabled={ajoutChampEnvoi} className="btn-primary w-full">
            {ajoutChampEnvoi ? 'Ajout…' : '+ Ajouter cette question'}
          </button>
        </form>
      </div>

      <div className="card p-4">
        <h2 className="font-semibold mb-1">Produits concurrents</h2>
        <p className="text-sm text-petrol-600 mb-4">
          Enregistrez les produits concurrents à surveiller — les commerciaux pourront cocher
          leur présence en rayon chez chaque client visité, pour calculer votre taux de présence.
        </p>

        {chargementConcurrents ? (
          <p className="text-sm text-petrol-500">Chargement…</p>
        ) : (
          <div className="space-y-2 mb-4">
            {concurrents.length === 0 && (
              <p className="text-sm text-petrol-400">Aucun produit concurrent pour le moment.</p>
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
                  {c.actif ? 'Actif' : 'Désactivé'}
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={ajouterConcurrent} className="border-t border-line pt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Nom du produit</label>
              <input
                className="input-field"
                value={nouveauConcurrent.nom}
                onChange={(e) => setNouveauConcurrent({ ...nouveauConcurrent, nom: e.target.value })}
                placeholder="Ex : Céréale XYZ 400g"
              />
            </div>
            <div>
              <label className="label">Marque (optionnel)</label>
              <input
                className="input-field"
                value={nouveauConcurrent.marque}
                onChange={(e) => setNouveauConcurrent({ ...nouveauConcurrent, marque: e.target.value })}
              />
            </div>
          </div>
          {erreurConcurrent && <p className="text-xs text-red-600">{erreurConcurrent}</p>}
          <button type="submit" disabled={ajoutConcurrentEnvoi} className="btn-primary w-full">
            {ajoutConcurrentEnvoi ? 'Ajout…' : '+ Ajouter ce produit concurrent'}
          </button>
        </form>
      </div>
    </div>
  )
}
