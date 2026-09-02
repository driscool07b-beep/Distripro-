import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

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
  const [enregistrementInfos, setEnregistrementInfos] = useState(false)
  const [erreurInfos, setErreurInfos] = useState('')
  const [confirmationInfos, setConfirmationInfos] = useState(false)

  useEffect(() => {
    if (entreprise) {
      setInfosLegales({
        adresse: entreprise.adresse || '',
        telephone: entreprise.telephone || '',
        email: entreprise.email || '',
        ncc: entreprise.ncc || '',
        rccm: entreprise.rccm || '',
      })
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
    }
  }, [profil])

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
      setErreurConcurrent(`Erreur : ${error.message}`)
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
      setErreur(`Erreur : ${error.message}`)
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
      setErreurInfos(`Erreur : ${error.message}`)
      return
    }
    await rechargerProfil()
    setConfirmationInfos(true)
    setTimeout(() => setConfirmationInfos(false), 2500)
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
      setErreurChamp(`Erreur : ${error.message}`)
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
