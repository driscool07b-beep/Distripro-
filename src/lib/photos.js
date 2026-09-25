import { supabase } from './supabase'
import { compresserImage } from './justificatifs'

// Photos de visite : chaque photo est envoyée en deux versions —
//  - la photo « complète », réduite à 1600 px (≈ 200-400 Ko au lieu de 4-10 Mo),
//  - une miniature de 320 px (≈ 20-30 Ko) pour les listes et aperçus.
// La miniature porte le même nom suivi de « -mini.jpg ».
export function cheminMiniature(chemin) {
  return String(chemin).replace(/\.[^./]+$/, '') + '-mini.jpg'
}

export async function envoyerPhotoVisite(bucket, cheminBase, fichier) {
  const complete = await compresserImage(fichier, { largeurMax: 1600, qualite: 0.75 })
  const extension = (complete.name.split('.').pop() || 'jpg').toLowerCase()
  const chemin = `${cheminBase}.${extension}`
  const { error } = await supabase.storage.from(bucket).upload(chemin, complete, { upsert: false, contentType: complete.type || undefined })
  if (error) return { error }
  try {
    const mini = await compresserImage(fichier, { largeurMax: 320, qualite: 0.7, forcer: true })
    await supabase.storage.from(bucket).upload(cheminMiniature(chemin), mini, { upsert: false, contentType: 'image/jpeg' })
  } catch { /* la miniature est un confort : la photo complète suffit */ }
  return { chemin }
}

// Liens d'affichage : miniatures (rapides) + photo complète au clic.
// Les anciennes photos sans miniature s'affichent en version complète.
export async function liensPhotos(bucket, chemins) {
  if (!chemins?.length) return []
  const tous = [...chemins, ...chemins.map(cheminMiniature)]
  const { data } = await supabase.storage.from(bucket).createSignedUrls(tous, 3600)
  const url = Object.fromEntries((data || []).filter((d) => d.signedUrl && !d.error).map((d) => [d.path, d.signedUrl]))
  return chemins
    .map((c) => ({ complete: url[c], miniature: url[cheminMiniature(c)] || url[c] }))
    .filter((l) => l.complete)
}
