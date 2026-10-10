import QRCode from 'qrcode'
import { supabase } from './supabase'

// Facture Normalisée Électronique (DGI) : appels à la fonction serveur
// « certifier-fne », qui seule détient la clé API de l'entreprise.

export async function lireConfigFne() {
  const { data } = await supabase.rpc('lire_config_fne')
  return data || { actif: false, fne_par_defaut: false }
}

async function appeler(action, venteId, extra = {}) {
  const { data, error } = await supabase.functions.invoke('certifier-fne', { body: { action, vente_id: venteId, ...extra } })
  if (error) {
    // Le message utile de la DGI est dans le corps de la réponse d'erreur.
    let message = error.message
    try { message = (await error.context?.json())?.error || message } catch { /* ignore */ }
    return { error: message }
  }
  return { data }
}

export const certifierVenteFne = (venteId) => appeler('certifier', venteId)
// avoirId : avoir partiel ou total créé par creer_avoir_vente (lignes et quantités rendues).
export const emettreAvoirFne = (venteId, avoirId) => appeler('avoir', venteId, avoirId ? { avoir_id: avoirId } : {})

// QR code de vérification (lien « token » renvoyé par la DGI).
export async function qrCodeFne(token) {
  if (!token) return null
  try { return await QRCode.toDataURL(token, { margin: 1, width: 240 }) } catch { return null }
}

// Visuel officiel FNE (fichier public/fne-visuel.png), apposé sur les factures
// et avoirs certifiés avec le QR code et le numéro DGI — les trois éléments de
// la signature électronique exigés par la procédure de la DGI.
let visuelEnCache
export async function visuelFne() {
  if (visuelEnCache !== undefined) return visuelEnCache
  try {
    const r = await fetch('/fne-visuel.png', { cache: 'force-cache' })
    if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) { visuelEnCache = null; return null }
    const blob = await r.blob()
    visuelEnCache = await new Promise((resolve) => {
      const lecteur = new FileReader()
      lecteur.onload = () => resolve(lecteur.result)
      lecteur.onerror = () => resolve(null)
      lecteur.readAsDataURL(blob)
    })
  } catch { visuelEnCache = null }
  return visuelEnCache
}
