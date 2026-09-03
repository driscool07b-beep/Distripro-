import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import * as XLSX from 'xlsx'

const COULEURS_SEGMENT = {
  actif: 'bg-green-50 text-green-700 border-green-200',
  vip: 'bg-green-50 text-green-700 border-green-200',
  nouveau: 'bg-blue-50 text-blue-700 border-blue-200',
  a_relancer: 'bg-amber-50 text-amber-700 border-amber-200',
  inactif: 'bg-red-50 text-red-700 border-red-200',
}

const CLIENT_VIDE = {
  nom: '',
  telephone: '',
  email: '',
  adresse: '',
  ville: '',
  type_client: '',
  segment: 'nouveau',
  limite_credit: '',
  notes: '',
  latitude: '',
  longitude: '',
}

export default function Clients() {
  const { profil } = useAuth()
  const [clients, setClients] = useState([])
  const [recherche, setRecherche] = useState('')
  const [chargement, setChargement] = useState(true)
  const [modalOuvert, setModalOuvert] = useState(false)
  const [formulaire, setFormulaire] = useState(CLIENT_VIDE)
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState('')
  const [captureGps, setCaptureGps] = useState('idle') // idle | en_cours | ok | echec
  const [typesClient, setTypesClient] = useState([])
  const [ajoutTypeOuvert, setAjoutTypeOuvert] = useState(false)
  const [nouveauType, setNouveauType] = useState('')
  const [clientEnEdition, setClientEnEdition] = useState(null) // null = création, sinon id du client
  const [tarifs, setTarifs] = useState([])
  const [groupes, setGroupes] = useState([])
  const [groupeId, setGroupeId] = useState('')
  const [nouveauGroupeNom, setNouveauGroupeNom] = useState('')
  const [modalImportOuvert, setModalImportOuvert] = useState(false)
  const [clientASupprimer, setClientASupprimer] = useState(null)
  const [erreurSuppression, setErreurSuppression] = useState('')
  const [suppressionEnCours, setSuppressionEnCours] = useState(false)
  const [lignesImport, setLignesImport] = useState([])
  const [erreurImport, setErreurImport] = useState('')
  const [importEnCours, setImportEnCours] = useState(false)
  const [resultatImport, setResultatImport] = useState(null)
  const [produitsCatalogue, setProduitsCatalogue] = useState([])
  const [nouveauTarifProduit, setNouveauTarifProduit] = useState('')
  const [nouveauTarifPrix, setNouveauTarifPrix] = useState('')
  const [erreurTarif, setErreurTarif] = useState('')
  const [photoPath, setPhotoPath] = useState(null)
  const [photoUrl, setPhotoUrl] = useState(null)
  const [photoEnvoi, setPhotoEnvoi] = useState(false)
  const [photoErreur, setPhotoErreur] = useState('')

  function capturerPositionActuelle() {
    if (!navigator.geolocation) {
      setCaptureGps('echec')
      return
    }
    setCaptureGps('en_cours')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFormulaire((f) => ({
          ...f,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        }))
        setCaptureGps('ok')
      },
      () => setCaptureGps('echec'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  function ouvrirNouveauClient() {
    setClientEnEdition(null)
    setFormulaire(CLIENT_VIDE)
    setErreur('')
    setPhotoPath(null)
    setPhotoUrl(null)
    setPhotoErreur('')
    setGroupeId('')
    setNouveauGroupeNom('')
    setModalOuvert(true)
    capturerPositionActuelle()
  }

  function ouvrirEditionClient(client) {
    setClientEnEdition(client.id)
    setFormulaire({
      nom: client.nom || '',
      telephone: client.telephone || '',
      email: client.email || '',
      adresse: client.adresse || '',
      ville: client.ville || '',
      type_client: client.type_client || '',
      segment: client.segment || 'nouveau',
      limite_credit: client.limite_credit != null ? String(client.limite_credit) : '',
      notes: client.notes || '',
      latitude: client.latitude != null ? String(client.latitude) : '',
      longitude: client.longitude != null ? String(client.longitude) : '',
    })
    setErreur('')
    setCaptureGps('idle')
    setGroupeId(client.groupe_id || '')
    setNouveauGroupeNom('')
    setPhotoPath(client.photo_devanture_path || null)
    setPhotoUrl(null)
    setPhotoErreur('')
    if (client.photo_devanture_path) chargerUrlPhoto(client.photo_devanture_path)
    setNouveauTarifProduit('')
    setNouveauTarifPrix('')
    setErreurTarif('')
    if (profil?.role === 'admin' || profil?.role === 'manager') chargerTarifs(client.id)
    setModalOuvert(true)
  }

  async function chargerTarifs(clientId) {
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from('tarifs_client').select('id, produit_id, prix_negocie, produits(nom)').eq('client_id', clientId).order('created_at'),
      supabase.from('produits').select('id, nom, prix_vente').eq('actif', true).order('nom'),
    ])
    setTarifs(t || [])
    setProduitsCatalogue(p || [])
  }

  async function ajouterTarif() {
    setErreurTarif('')
    if (!nouveauTarifProduit || !nouveauTarifPrix) {
      setErreurTarif('Choisissez un produit et un prix.')
      return
    }
    const { data, error } = await supabase
      .from('tarifs_client')
      .upsert(
        { entreprise_id: profil.entreprise_id, client_id: clientEnEdition, produit_id: nouveauTarifProduit, prix_negocie: Number(nouveauTarifPrix) },
        { onConflict: 'client_id,produit_id' }
      )
      .select('id, produit_id, prix_negocie, produits(nom)')
      .single()
    if (error) {
      setErreurTarif(`Erreur : ${error.message}`)
      return
    }
    setTarifs((prev) => [...prev.filter((t) => t.produit_id !== nouveauTarifProduit), data])
    setNouveauTarifProduit('')
    setNouveauTarifPrix('')
  }

  async function retirerTarif(tarifId) {
    await supabase.from('tarifs_client').delete().eq('id', tarifId)
    setTarifs((prev) => prev.filter((t) => t.id !== tarifId))
  }

  async function chargerUrlPhoto(path) {
    const { data } = await supabase.storage.from('client-photos').createSignedUrl(path, 3600)
    if (data?.signedUrl) setPhotoUrl(data.signedUrl)
  }

  async function envoyerPhotoDevanture(e) {
    const fichier = e.target.files?.[0]
    if (!fichier || !clientEnEdition || !profil?.entreprise_id) return
    setPhotoErreur('')
    setPhotoEnvoi(true)

    const extension = fichier.name.split('.').pop() || 'jpg'
    const chemin = `${profil.entreprise_id}/${clientEnEdition}.${extension}`

    const { error: erreurUpload } = await supabase.storage
      .from('client-photos')
      .upload(chemin, fichier, { upsert: true })

    if (erreurUpload) {
      setPhotoEnvoi(false)
      setPhotoErreur(`Erreur envoi photo : ${erreurUpload.message}`)
      return
    }

    const { error: erreurMaj } = await supabase
      .from('clients')
      .update({ photo_devanture_path: chemin })
      .eq('id', clientEnEdition)

    setPhotoEnvoi(false)
    if (erreurMaj) {
      setPhotoErreur(`Erreur enregistrement : ${erreurMaj.message}`)
      return
    }
    setPhotoPath(chemin)
    chargerUrlPhoto(chemin)
  }

  function ouvrirItineraire(client) {
    if (client.latitude == null || client.longitude == null) return
    const url = `https://www.google.com/maps/dir/?api=1&destination=${client.latitude},${client.longitude}`
    window.open(url, '_blank')
  }

  useEffect(() => {
    chargerClients()
    chargerTypesClient()
    chargerGroupes()
  }, [])

  async function chargerGroupes() {
    const { data } = await supabase.from('groupes_clients').select('id, nom').order('nom')
    setGroupes(data || [])
  }

  function ouvrirModalImport() {
    setLignesImport([])
    setErreurImport('')
    setResultatImport(null)
    setModalImportOuvert(true)
  }

  function telechargerModeleImport() {
    const feuille = XLSX.utils.aoa_to_sheet([
      ['Nom', 'Téléphone', 'Email', 'Adresse', 'Ville', 'Type'],
      ['Boutique Exemple', '0700000000', 'contact@exemple.ci', 'Rue 12, Cocody', 'Abidjan', 'Boutique'],
    ])
    const classeur = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(classeur, feuille, 'Clients')
    XLSX.writeFile(classeur, 'modele-import-clients.xlsx')
  }

  function lireFichierImport(e) {
    const fichier = e.target.files?.[0]
    if (!fichier) return
    setErreurImport('')
    setResultatImport(null)

    const lecteur = new FileReader()
    lecteur.onload = (event) => {
      try {
        const classeur = XLSX.read(event.target.result, { type: 'array' })
        const feuille = classeur.Sheets[classeur.SheetNames[0]]
        const lignes = XLSX.utils.sheet_to_json(feuille, {
          header: ['nom', 'telephone', 'email', 'adresse', 'ville', 'type_client'],
          range: 1,
          defval: '',
        })
        const lignesValides = lignes
          .map((l) => ({
            nom: String(l.nom || '').trim(),
            telephone: String(l.telephone || '').trim(),
            email: String(l.email || '').trim(),
            adresse: String(l.adresse || '').trim(),
            ville: String(l.ville || '').trim(),
            type_client: String(l.type_client || '').trim(),
          }))
          .filter((l) => l.nom)
        setLignesImport(lignesValides)
        if (lignesValides.length === 0) setErreurImport('Aucune ligne valide trouvée (le nom est obligatoire).')
      } catch (err) {
        setErreurImport(`Fichier illisible : ${err.message}`)
      }
    }
    lecteur.readAsArrayBuffer(fichier)
  }

  async function confirmerImport() {
    if (lignesImport.length === 0 || !profil?.entreprise_id) return
    setImportEnCours(true)
    setErreurImport('')

    const donnees = lignesImport.map((l) => ({
      entreprise_id: profil.entreprise_id,
      commercial_id: profil.id,
      nom: l.nom,
      telephone: l.telephone || null,
      email: l.email || null,
      adresse: l.adresse || null,
      ville: l.ville || null,
      type_client: l.type_client || null,
      segment: 'nouveau',
      limite_credit: 0,
    }))

    const { data, error } = await supabase.from('clients').insert(donnees).select('id')

    setImportEnCours(false)
    if (error) {
      setErreurImport(`Erreur : ${error.message}`)
      return
    }
    setResultatImport({ importes: data?.length || 0, total: lignesImport.length })
    setLignesImport([])
    chargerClients()
  }

  async function chargerTypesClient() {
    const { data, error } = await supabase
      .from('types_client')
      .select('id, libelle')
      .eq('actif', true)
      .order('libelle')
    if (!error) setTypesClient(data || [])
  }

  async function ajouterTypeClient() {
    const libelle = nouveauType.trim()
    if (!libelle || !profil?.entreprise_id) return
    const { data, error } = await supabase
      .from('types_client')
      .insert({ entreprise_id: profil.entreprise_id, libelle })
      .select('id, libelle')
      .single()
    if (!error && data) {
      setTypesClient((prev) => [...prev, data].sort((a, b) => a.libelle.localeCompare(b.libelle)))
      setFormulaire((f) => ({ ...f, type_client: data.libelle }))
    }
    setNouveauType('')
    setAjoutTypeOuvert(false)
  }

  async function chargerClients() {
    setChargement(true)
    const { data, error } = await supabase
      .from('clients')
      .select('id, nom, telephone, email, adresse, ville, type_client, segment, limite_credit, notes, latitude, longitude, photo_devanture_path, created_at, groupe_id, groupes_clients(nom)')
      .order('created_at', { ascending: false })
    if (!error) setClients(data || [])
    setChargement(false)
  }

  async function enregistrerClient(e) {
    e.preventDefault()
    setErreur('')
    if (!formulaire.nom.trim()) {
      setErreur('Le nom du client est requis.')
      return
    }
    if (!profil?.entreprise_id) {
      setErreur('Profil non chargé. Réessayez dans un instant.')
      return
    }
    setEnregistrement(true)

    let groupeIdFinal = groupeId || null
    if (nouveauGroupeNom.trim()) {
      const { data: nouveauGroupe, error: erreurGroupe } = await supabase
        .from('groupes_clients')
        .insert({ entreprise_id: profil.entreprise_id, nom: nouveauGroupeNom.trim() })
        .select('id, nom')
        .single()
      if (erreurGroupe) {
        setEnregistrement(false)
        setErreur(`Erreur création du groupe : ${erreurGroupe.message}`)
        return
      }
      groupeIdFinal = nouveauGroupe.id
      setGroupes((prev) => [...prev, nouveauGroupe].sort((a, b) => a.nom.localeCompare(b.nom)))
    }

    const donneesCommunes = {
      nom: formulaire.nom.trim(),
      telephone: formulaire.telephone.trim() || null,
      email: formulaire.email.trim() || null,
      adresse: formulaire.adresse.trim() || null,
      ville: formulaire.ville.trim() || null,
      type_client: formulaire.type_client || null,
      segment: formulaire.segment || null,
      limite_credit: formulaire.limite_credit ? Number(formulaire.limite_credit) : 0,
      notes: formulaire.notes.trim() || null,
      latitude: formulaire.latitude ? Number(formulaire.latitude) : null,
      longitude: formulaire.longitude ? Number(formulaire.longitude) : null,
      groupe_id: groupeIdFinal,
    }

    const { error } = clientEnEdition
      ? await supabase.from('clients').update(donneesCommunes).eq('id', clientEnEdition)
      : await supabase.from('clients').insert({
          entreprise_id: profil.entreprise_id,
          commercial_id: profil.id,
          ...donneesCommunes,
        })

    setEnregistrement(false)
    if (error) {
      console.error('Erreur enregistrement client:', error)
      setErreur(`Erreur : ${error.message || 'inconnue'}`)
      return
    }
    setModalOuvert(false)
    setFormulaire(CLIENT_VIDE)
    setCaptureGps('idle')
    setAjoutTypeOuvert(false)
    setClientEnEdition(null)
    setPhotoPath(null)
    setPhotoUrl(null)
    setPhotoErreur('')
    chargerClients()
  }

  const clientsFiltres = clients.filter((c) =>
    c.nom.toLowerCase().includes(recherche.toLowerCase())
  )

  return (
    <div className="p-8 max-w-6xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="text-sm text-petrol-700 mt-1">{clients.length} client(s) enregistré(s)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={ouvrirModalImport}>
            📥 Importer
          </button>
          <button className="btn-primary" onClick={ouvrirNouveauClient}>
            + Nouveau client
          </button>
        </div>
      </header>

      <input
        type="text"
        placeholder="Rechercher un client…"
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        className="input-field max-w-sm mb-4"
      />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
              <th className="px-4 py-3 font-medium">Nom</th>
              <th className="px-4 py-3 font-medium">Téléphone</th>
              <th className="px-4 py-3 font-medium">Ville</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Segment</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {chargement ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-petrol-500">Chargement…</td></tr>
            ) : clientsFiltres.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-petrol-500">Aucun client trouvé.</td></tr>
            ) : (
              clientsFiltres.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                  <td className="px-4 py-3 font-medium">{c.nom}</td>
                  <td className="px-4 py-3 font-mono text-petrol-700">{c.telephone || '—'}</td>
                  <td className="px-4 py-3 text-petrol-700">{c.ville || '—'}</td>
                  <td className="px-4 py-3 text-petrol-700 capitalize">{c.type_client || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full border capitalize ${COULEURS_SEGMENT[c.segment] || 'bg-petrol-50 text-petrol-500 border-line'}`}>
                      {c.segment || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => ouvrirEditionClient(c)}
                        className="text-petrol-700 underline"
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => ouvrirItineraire(c)}
                        disabled={c.latitude == null || c.longitude == null}
                        className={
                          c.latitude == null || c.longitude == null
                            ? 'text-petrol-500 cursor-not-allowed'
                            : 'text-blue-600 underline'
                        }
                        title={c.latitude == null ? 'Pas de position GPS enregistrée' : 'Ouvrir dans Google Maps'}
                      >
                        📍 Itinéraire
                      </button>
                      <Link to={`/grand-livre?client=${c.id}`} className="text-petrol-700 underline">
                        Grand livre
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-4">
              {clientEnEdition ? 'Modifier le client' : 'Nouveau client'}
            </h2>
            <form onSubmit={enregistrerClient} className="space-y-3">
              <div>
                <label className="label">Nom *</label>
                <input
                  className="input-field"
                  value={formulaire.nom}
                  onChange={(e) => setFormulaire({ ...formulaire, nom: e.target.value })}
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Téléphone</label>
                <input
                  className="input-field"
                  value={formulaire.telephone}
                  onChange={(e) => setFormulaire({ ...formulaire, telephone: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Adresse</label>
                <input
                  className="input-field"
                  value={formulaire.adresse}
                  onChange={(e) => setFormulaire({ ...formulaire, adresse: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    className="input-field"
                    value={formulaire.email}
                    onChange={(e) => setFormulaire({ ...formulaire, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Ville</label>
                  <input
                    className="input-field"
                    value={formulaire.ville}
                    onChange={(e) => setFormulaire({ ...formulaire, ville: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Type de client</label>
                  {!ajoutTypeOuvert ? (
                    <select
                      className="input-field"
                      value={formulaire.type_client}
                      onChange={(e) => {
                        if (e.target.value === '__nouveau__') {
                          setAjoutTypeOuvert(true)
                        } else {
                          setFormulaire({ ...formulaire, type_client: e.target.value })
                        }
                      }}
                    >
                      <option value="">— Sélectionner —</option>
                      {typesClient.map((t) => (
                        <option key={t.id} value={t.libelle}>{t.libelle}</option>
                      ))}
                      <option value="__nouveau__">+ Ajouter un type…</option>
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        className="input-field"
                        autoFocus
                        placeholder="Nom du nouveau type"
                        value={nouveauType}
                        onChange={(e) => setNouveauType(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), ajouterTypeClient())}
                      />
                      <button type="button" className="btn-secondary" onClick={ajouterTypeClient}>
                        OK
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setAjoutTypeOuvert(false)
                          setNouveauType('')
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <label className="label">Segment</label>
                  <select
                    className="input-field"
                    value={formulaire.segment}
                    onChange={(e) => setFormulaire({ ...formulaire, segment: e.target.value })}
                  >
                    <option value="nouveau">Nouveau</option>
                    <option value="actif">Actif</option>
                    <option value="vip">VIP</option>
                    <option value="a_relancer">À relancer</option>
                    <option value="inactif">Inactif</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Groupe (chaîne de magasins, optionnel)</label>
                <div className="flex gap-2">
                  <select
                    className="input-field flex-1"
                    value={groupeId}
                    onChange={(e) => { setGroupeId(e.target.value); setNouveauGroupeNom('') }}
                    disabled={!!nouveauGroupeNom}
                  >
                    <option value="">— Aucun —</option>
                    {groupes.map((g) => <option key={g.id} value={g.id}>{g.nom}</option>)}
                  </select>
                  <input
                    className="input-field flex-1"
                    placeholder="Ou créer un nouveau groupe"
                    value={nouveauGroupeNom}
                    onChange={(e) => { setNouveauGroupeNom(e.target.value); setGroupeId('') }}
                  />
                </div>
                <p className="text-xs text-petrol-500 mt-1">
                  Regrouper les magasins d'une même enseigne pour un récap de livraisons consolidé.
                </p>
              </div>
              <div>
                <label className="label">Limite de crédit (F CFA)</label>
                <input
                  type="number"
                  min="0"
                  className="input-field"
                  value={formulaire.limite_credit}
                  onChange={(e) => setFormulaire({ ...formulaire, limite_credit: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input-field"
                  rows={2}
                  value={formulaire.notes}
                  onChange={(e) => setFormulaire({ ...formulaire, notes: e.target.value })}
                />
              </div>
              {clientEnEdition && (profil?.role === 'admin' || profil?.role === 'manager') && (
                <div>
                  <label className="label">Tarifs négociés (remise contractuelle)</label>
                  {tarifs.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {tarifs.map((t) => (
                        <div key={t.id} className="flex items-center justify-between text-xs border border-line rounded px-2 py-1.5">
                          <span>{t.produits?.nom}</span>
                          <span className="flex items-center gap-2">
                            <span className="font-mono">{Number(t.prix_negocie).toLocaleString('fr-FR')} F CFA</span>
                            <button type="button" onClick={() => retirerTarif(t.id)} className="text-red-600">✕</button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <select
                      className="input-field flex-1"
                      value={nouveauTarifProduit}
                      onChange={(e) => setNouveauTarifProduit(e.target.value)}
                    >
                      <option value="">— Produit —</option>
                      {produitsCatalogue.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
                    </select>
                    <input
                      type="number"
                      min="0"
                      placeholder="Prix"
                      className="input-field w-24"
                      value={nouveauTarifPrix}
                      onChange={(e) => setNouveauTarifPrix(e.target.value)}
                    />
                    <button type="button" onClick={ajouterTarif} className="btn-secondary text-xs px-2">+</button>
                  </div>
                  {erreurTarif && <p className="text-xs text-red-600 mt-1">{erreurTarif}</p>}
                </div>
              )}
              {clientEnEdition ? (
                <div>
                  <label className="label">Photo de la devanture / enseigne</label>
                  {photoUrl && (
                    <img
                      src={photoUrl}
                      alt="Devanture du client"
                      className="w-full h-40 object-cover rounded-lg mb-2 border border-line"
                    />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={envoyerPhotoDevanture}
                    disabled={photoEnvoi}
                    className="text-sm"
                  />
                  {photoEnvoi && <p className="text-xs text-petrol-600 mt-1">Envoi en cours…</p>}
                  {photoErreur && <p className="text-xs text-red-600 mt-1">{photoErreur}</p>}
                </div>
              ) : (
                <p className="text-xs text-petrol-500">
                  📷 La photo de la devanture pourra être ajoutée après l'enregistrement, via "Modifier".
                </p>
              )}
              <div className="text-xs flex items-center gap-2 flex-wrap">
                {captureGps === 'en_cours' && (
                  <span className="text-petrol-600">📍 Capture de votre position en cours…</span>
                )}
                {captureGps === 'ok' && (
                  <span className="text-green-600">📍 Position capturée automatiquement.</span>
                )}
                {captureGps === 'echec' && (
                  <span className="text-amber-600">⚠️ Position indisponible — saisissez-la manuellement.</span>
                )}
                {captureGps !== 'en_cours' && (
                  <button type="button" onClick={capturerPositionActuelle} className="underline text-petrol-600">
                    {clientEnEdition ? '📍 Recapturer ma position actuelle' : 'Réessayer la capture'}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Latitude</label>
                  <input
                    className="input-field font-mono"
                    value={formulaire.latitude}
                    onChange={(e) => setFormulaire({ ...formulaire, latitude: e.target.value })}
                    placeholder="5.3097"
                  />
                </div>
                <div>
                  <label className="label">Longitude</label>
                  <input
                    className="input-field font-mono"
                    value={formulaire.longitude}
                    onChange={(e) => setFormulaire({ ...formulaire, longitude: e.target.value })}
                    placeholder="-4.0126"
                  />
                </div>
              </div>

              {erreur && <div className="text-sm text-red-600">{erreur}</div>}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  className="btn-secondary flex-1"
                  onClick={() => {
                    setModalOuvert(false)
                    setFormulaire(CLIENT_VIDE)
                    setErreur('')
                    setCaptureGps('idle')
                    setAjoutTypeOuvert(false)
                    setClientEnEdition(null)
                    setPhotoPath(null)
                    setPhotoUrl(null)
                    setPhotoErreur('')
                  }}
                >
                  Annuler
                </button>
                <button type="submit" disabled={enregistrement} className="btn-primary flex-1">
                  {enregistrement
                    ? 'Enregistrement…'
                    : clientEnEdition
                    ? 'Modifier'
                    : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalImportOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="font-semibold text-lg">Importer des clients (Excel)</h2>
              <button onClick={() => setModalImportOuvert(false)} className="text-petrol-400 text-xl leading-none">✕</button>
            </div>

            <p className="text-sm text-petrol-600 mb-3">
              Téléchargez le modèle, remplissez-le en gardant l'ordre des colonnes, puis importez-le.
            </p>
            <button onClick={telechargerModeleImport} className="btn-secondary text-sm mb-4">
              📄 Télécharger le modèle
            </button>

            <div className="mb-4">
              <label className="label">Fichier Excel (.xlsx)</label>
              <input type="file" accept=".xlsx,.xls" onChange={lireFichierImport} className="text-sm" />
            </div>

            {erreurImport && <p className="text-sm text-red-600 mb-3">{erreurImport}</p>}

            {lignesImport.length > 0 && (
              <>
                <p className="text-sm font-medium mb-2">{lignesImport.length} client(s) prêt(s) à importer</p>
                <div className="border border-line rounded-lg overflow-y-auto max-h-48 mb-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-canvas text-left">
                        <th className="px-2 py-1.5">Nom</th>
                        <th className="px-2 py-1.5">Téléphone</th>
                        <th className="px-2 py-1.5">Ville</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignesImport.slice(0, 20).map((l, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="px-2 py-1.5">{l.nom}</td>
                          <td className="px-2 py-1.5">{l.telephone || '—'}</td>
                          <td className="px-2 py-1.5">{l.ville || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {lignesImport.length > 20 && (
                    <p className="text-xs text-petrol-400 text-center py-1.5">… et {lignesImport.length - 20} de plus</p>
                  )}
                </div>
                <button onClick={confirmerImport} disabled={importEnCours} className="btn-primary w-full">
                  {importEnCours ? 'Import en cours…' : `Importer ${lignesImport.length} client(s)`}
                </button>
              </>
            )}

            {resultatImport && (
              <p className="text-sm text-green-700 mt-3">
                ✓ {resultatImport.importes} client(s) importé(s) sur {resultatImport.total}.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
