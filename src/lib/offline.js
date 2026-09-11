// File d'attente hors-ligne. Quand une action (vente, visite, rapport)
// ne peut pas atteindre Supabase — coupure réseau en tournée, sous-sol
// d'un magasin, etc. — elle est stockée ici (IndexedDB, persiste même
// si l'onglet/l'app est fermée) plutôt que perdue. Dès que la connexion
// revient, la file est rejouée dans l'ordre chronologique.
//
// Important : ceci ne met PAS en cache les appels réseau eux-mêmes
// (contrairement au service worker qui ne cache que les fichiers de
// l'app) — c'est une file d'actions explicites, avec leur propre
// logique de rejeu par type.

import { supabase } from './supabase'

const DB_NAME = 'distripro-offline'
const DB_VERSION = 1
const STORE = 'file_attente'

function ouvrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('created_at', 'created_at')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function generateId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

export async function ajouterActionEnAttente(type, payload, resume) {
  const db = await ouvrirDB()
  const action = {
    id: generateId(),
    type,
    payload,
    resume: resume || '',
    statut: 'en_attente',
    erreur: null,
    created_at: new Date().toISOString(),
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).add(action)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  notifierEcouteurs()
  return action.id
}

export async function listerActionsEnAttente() {
  const db = await ouvrirDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.created_at.localeCompare(b.created_at)))
    req.onerror = () => reject(req.error)
  })
}

async function supprimerAction(id) {
  const db = await ouvrirDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function majStatutAction(id, statut, erreur = null) {
  const db = await ouvrirDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req = store.get(id)
    req.onsuccess = () => {
      const action = req.result
      if (action) {
        action.statut = statut
        action.erreur = erreur
        store.put(action)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function retirerActionManuellement(id) {
  await supprimerAction(id)
  notifierEcouteurs()
}

// ---------------------------------------------------------------------
// Abonnement des composants React aux changements de la file (pour
// afficher le badge "N actions en attente" sans repasser par IndexedDB
// à chaque rendu).
// ---------------------------------------------------------------------
const ecouteurs = new Set()
function notifierEcouteurs() {
  ecouteurs.forEach((fn) => fn())
}
export function ecouterFileAttente(fn) {
  ecouteurs.add(fn)
  return () => ecouteurs.delete(fn)
}

// ---------------------------------------------------------------------
// Exécuteurs : comment rejouer chaque type d'action une fois en ligne.
// Chacun lève une exception si ça échoue (l'action reste en file,
// marquée "echoue", pour être retentée au prochain passage).
// ---------------------------------------------------------------------
const EXECUTEURS = {
  creer_vente: async (payload) => {
    const { error } = await supabase.rpc('creer_vente', payload)
    if (error) throw error
  },

  valider_visite: async (payload) => {
    const { data, error } = await supabase.rpc('valider_visite', payload)
    if (error) throw error
    if (!data?.succes) {
      throw new Error(data?.message || 'Visite refusée par le serveur (hors zone du client ?)')
    }
  },

  rapport_visite: async (payload) => {
    const {
      entrepriseId, tourneeLigneId, clientId, commercialId,
      notesRayon, notesReserve, lignesProduits, valeursChamps, presenceConcurrents, photos,
    } = payload

    const cheminsPhotos = []
    for (let i = 0; i < (photos || []).length; i++) {
      const file = photos[i]
      const extension = (file.name || 'jpg').split('.').pop() || 'jpg'
      const chemin = `${entrepriseId}/rapports/${tourneeLigneId}/${Date.now()}-${i}.${extension}`
      const { error: erreurUpload } = await supabase.storage.from('client-photos').upload(chemin, file, { upsert: true })
      if (erreurUpload) throw erreurUpload
      cheminsPhotos.push(chemin)
    }

    const { data: rapportCree, error } = await supabase
      .from('rapports_visite')
      .insert({
        entreprise_id: entrepriseId,
        tournee_ligne_id: tourneeLigneId,
        client_id: clientId,
        commercial_id: commercialId,
        notes_rayon: notesRayon || null,
        notes_reserve: notesReserve || null,
        photos_paths: cheminsPhotos,
      })
      .select('id')
      .single()
    if (error) throw error

    if ((lignesProduits || []).length > 0) {
      const lignes = lignesProduits.map((l) => ({
        entreprise_id: entrepriseId,
        rapport_id: rapportCree.id,
        produit_id: l.produit_id,
        quantite_rayon: l.quantite_rayon === '' ? null : Number(l.quantite_rayon),
        quantite_reserve: l.quantite_reserve === '' ? null : Number(l.quantite_reserve),
      }))
      const { error: e1 } = await supabase.from('rapport_visite_produits').insert(lignes)
      if (e1) throw e1
    }

    const valeursSaisies = Object.entries(valeursChamps || {}).filter(([, v]) => v !== '' && v != null)
    if (valeursSaisies.length > 0) {
      const lignesChamps = valeursSaisies.map(([champId, valeur]) => ({
        entreprise_id: entrepriseId,
        rapport_id: rapportCree.id,
        champ_id: champId,
        valeur: String(valeur),
      }))
      const { error: e2 } = await supabase.from('rapport_visite_champs_valeurs').insert(lignesChamps)
      if (e2) throw e2
    }

    const presencesSaisies = Object.entries(presenceConcurrents || {})
    if (presencesSaisies.length > 0) {
      const lignesConcurrents = presencesSaisies.map(([produitConcurrentId, present]) => ({
        entreprise_id: entrepriseId,
        rapport_id: rapportCree.id,
        produit_concurrent_id: produitConcurrentId,
        present,
      }))
      const { error: e3 } = await supabase.from('rapport_visite_concurrents').insert(lignesConcurrents)
      if (e3) throw e3
    }
  },
}

// ---------------------------------------------------------------------
// Synchronisation : rejoue la file dans l'ordre, dès que la connexion
// est là (au retour du réseau, et à chaque chargement de l'app).
// ---------------------------------------------------------------------
let synchronisationEnCours = false

export async function synchroniser() {
  if (synchronisationEnCours || typeof navigator !== 'undefined' && !navigator.onLine) return
  synchronisationEnCours = true
  try {
    const actions = await listerActionsEnAttente()
    for (const action of actions) {
      const executeur = EXECUTEURS[action.type]
      if (!executeur) continue
      try {
        await executeur(action.payload)
        await supprimerAction(action.id)
      } catch (err) {
        await majStatutAction(action.id, 'echoue', err.message || String(err))
      }
      notifierEcouteurs()
    }
  } finally {
    synchronisationEnCours = false
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { synchroniser() })
  // Un passage à la connexion au chargement de l'app aussi (au cas où
  // des actions étaient restées en attente d'une session précédente).
  if (navigator.onLine) synchroniser()
}
