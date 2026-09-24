import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Photo de profil (ou initiale sur fond coloré s'il n'y en a pas).
// Les liens des photos (stockage privé) sont mis en cache pour la session :
// une même photo n'est demandée qu'une fois, même si elle apparaît sur
// chaque message d'une conversation.

const cache = new Map() // chemin -> { url, expire }
const enAttente = new Map() // chemin -> Promise<url>

export async function urlPhoto(chemin) {
  if (!chemin) return null
  const c = cache.get(chemin)
  if (c && c.expire > Date.now()) return c.url
  if (enAttente.has(chemin)) return enAttente.get(chemin)
  const promesse = supabase.storage
    .from('photos-profil')
    .createSignedUrl(chemin, 3600)
    .then(({ data }) => {
      const url = data?.signedUrl || null
      if (url) cache.set(chemin, { url, expire: Date.now() + 55 * 60 * 1000 })
      enAttente.delete(chemin)
      return url
    })
  enAttente.set(chemin, promesse)
  return promesse
}

const COULEURS = ['bg-amber-100 text-amber-800', 'bg-sky-100 text-sky-800', 'bg-emerald-100 text-emerald-800', 'bg-violet-100 text-violet-800', 'bg-rose-100 text-rose-800', 'bg-teal-100 text-teal-800']

function couleurPour(nom = '') {
  let h = 0
  for (const ch of nom) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return COULEURS[h % COULEURS.length]
}

export default function Avatar({ nom, chemin, taille = 36, className = '' }) {
  const [url, setUrl] = useState(() => {
    const c = chemin && cache.get(chemin)
    return c && c.expire > Date.now() ? c.url : null
  })

  useEffect(() => {
    let actif = true
    if (!chemin) {
      setUrl(null)
      return
    }
    urlPhoto(chemin).then((u) => { if (actif) setUrl(u) })
    return () => { actif = false }
  }, [chemin])

  const style = { width: taille, height: taille, fontSize: Math.round(taille * 0.42) }
  if (url) {
    return <img src={url} alt={nom || ''} style={style} className={`shrink-0 rounded-full object-cover ring-2 ring-white ${className}`} />
  }
  return (
    <span style={style} className={`shrink-0 rounded-full inline-flex items-center justify-center font-semibold uppercase ring-2 ring-white ${couleurPour(nom)} ${className}`}>
      {(nom || '?').trim().charAt(0)}
    </span>
  )
}

// Recadre une photo en carré centré et la réduit (400 px) avant envoi.
export async function preparerPhotoProfil(fichier, taille = 400) {
  const image = await createImageBitmap(fichier)
  const cote = Math.min(image.width, image.height)
  const canvas = document.createElement('canvas')
  canvas.width = taille
  canvas.height = taille
  canvas.getContext('2d').drawImage(image, (image.width - cote) / 2, (image.height - cote) / 2, cote, cote, 0, 0, taille, taille)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' })
}
