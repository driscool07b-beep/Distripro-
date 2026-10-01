import { supabase } from './supabase'

// Logo de l'entreprise : préparation, dépôt et chargement pour les documents.
const DOSSIER = 'logos-entreprises'
const CLE_EN_ATTENTE = 'distribpro-logo-en-attente'

// Redimensionne (600 × 300 px max) en conservant la transparence des PNG/WebP.
export function preparerLogo(fichier) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(fichier?.type || '')) { reject(new Error('format')); return }
    const img = new Image()
    const url = URL.createObjectURL(fichier)
    img.onload = () => {
      const echelle = Math.min(1, 600 / img.naturalWidth, 300 / img.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * echelle))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * echelle))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      const png = fichier.type !== 'image/jpeg'
      const type = png ? 'image/png' : 'image/jpeg'
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('conversion')); return }
        resolve({ blob, type, extension: png ? 'png' : 'jpg', dataUrl: canvas.toDataURL(type, 0.92), ratio: canvas.width / canvas.height })
      }, type, 0.92)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('lecture')) }
    img.src = url
  })
}

export async function televerserLogo(entrepriseId, prepare) {
  const chemin = `${entrepriseId}/logo-${Date.now()}.${prepare.extension}`
  const fichier = new File([prepare.blob], `logo.${prepare.extension}`, { type: prepare.type })
  const { error } = await supabase.storage.from(DOSSIER).upload(chemin, fichier, { upsert: false, contentType: prepare.type })
  if (error) return { error: error.message }
  const { error: e2 } = await supabase.rpc('definir_logo_entreprise', { p_path: chemin })
  if (e2) return { error: e2.message }
  return { chemin }
}

export async function retirerLogo() {
  const { error } = await supabase.rpc('definir_logo_entreprise', { p_path: null })
  return { error: error?.message }
}

export function urlLogo(chemin) {
  if (!chemin) return null
  return supabase.storage.from(DOSSIER).getPublicUrl(chemin).data?.publicUrl || null
}

// Image du logo prête pour jsPDF (data URL) + proportions.
export async function chargerLogoDocuments(chemin) {
  const url = urlLogo(chemin)
  if (!url) return null
  try {
    const reponse = await fetch(url)
    if (!reponse.ok) return null
    const blob = await reponse.blob()
    const dataUrl = await new Promise((resolve) => {
      const lecteur = new FileReader()
      lecteur.onload = () => resolve(lecteur.result)
      lecteur.readAsDataURL(blob)
    })
    const ratio = await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img.naturalWidth / img.naturalHeight || 2)
      img.onerror = () => resolve(2)
      img.src = dataUrl
    })
    return { dataUrl, ratio }
  } catch {
    return null
  }
}

// Logo choisi à l'inscription quand l'email doit d'abord être confirmé :
// conservé sur l'appareil, puis déposé à la première connexion.
export function memoriserLogoEnAttente(email, prepare) {
  try { localStorage.setItem(CLE_EN_ATTENTE, JSON.stringify({ email: email.toLowerCase(), dataUrl: prepare.dataUrl, type: prepare.type, extension: prepare.extension })) } catch { /* ignore */ }
}

export async function deposerLogoEnAttente(email, entreprise, role) {
  let attente = null
  try { attente = JSON.parse(localStorage.getItem(CLE_EN_ATTENTE) || 'null') } catch { /* ignore */ }
  if (!attente || role !== 'admin' || entreprise?.logo_path || attente.email !== String(email || '').toLowerCase()) return null
  const blob = await (await fetch(attente.dataUrl)).blob()
  const { chemin, error } = await televerserLogo(entreprise.id, { blob, type: attente.type, extension: attente.extension })
  if (!error) localStorage.removeItem(CLE_EN_ATTENTE)
  return chemin || null
}
