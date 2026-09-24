import { supabase } from './supabase'

// Réduit une photo avant envoi (une photo de téléphone fait souvent 4 à 10 Mo :
// c'est la principale cause de lenteur sur le réseau mobile). Les PDF et les
// petites images sont envoyés tels quels.
export async function compresserImage(fichier, { largeurMax = 1600, qualite = 0.75 } = {}) {
  if (!fichier?.type?.startsWith('image/') || fichier.type === 'image/gif' || fichier.size < 350 * 1024) return fichier
  try {
    const image = await createImageBitmap(fichier)
    const echelle = Math.min(1, largeurMax / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * echelle)
    canvas.height = Math.round(image.height * echelle)
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualite))
    if (!blob || blob.size >= fichier.size) return fichier
    const nom = fichier.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], nom, { type: 'image/jpeg' })
  } catch {
    return fichier
  }
}

// Envoie le justificatif d'un mouvement de stock et l'enregistre dans son
// historique. Chaque envoi a un chemin unique : un fichier déjà déposé n'est
// jamais écrasé (traçabilité). motifRemplacement est requis si le mouvement
// a déjà un justificatif. Renvoie { error } (message lisible) ou {}.
export async function envoyerJustificatifMouvement({ entrepriseId, mouvementId, fichier, motifRemplacement = null }) {
  const fichierFinal = await compresserImage(fichier)
  const extension = (fichierFinal.name.split('.').pop() || 'bin').toLowerCase()
  const chemin = `${entrepriseId}/mouvements-stock/${mouvementId}/${Date.now()}.${extension}`
  const { error: erreurEnvoi } = await supabase.storage
    .from('justificatifs-stock')
    .upload(chemin, fichierFinal, { upsert: false, contentType: fichierFinal.type || undefined })
  if (erreurEnvoi) return { error: erreurEnvoi.message }
  const { error } = await supabase.rpc('attacher_justificatif_mouvement', {
    p_mouvement_id: mouvementId,
    p_chemin: chemin,
    p_nom_fichier: fichier.name,
    p_taille_octets: fichierFinal.size,
    p_type_mime: fichierFinal.type || null,
    p_motif_remplacement: motifRemplacement,
  })
  return error ? { error: error.message } : {}
}

// Ouvre un justificatif. La fenêtre est ouverte AVANT l'appel réseau : sinon
// les navigateurs (surtout sur téléphone) bloquent l'ouverture comme pop-up.
export async function ouvrirJustificatif(chemin) {
  const fenetre = window.open('', '_blank')
  const { data, error } = await supabase.storage.from('justificatifs-stock').createSignedUrl(chemin, 300)
  if (error || !data?.signedUrl) {
    fenetre?.close()
    return { error: error?.message || 'lien indisponible' }
  }
  if (fenetre) fenetre.location.href = data.signedUrl
  else window.location.href = data.signedUrl
  return {}
}
