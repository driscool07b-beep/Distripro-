import QRCode from 'qrcode'
import { supabase } from './supabase'

// Facture Normalisée Électronique (DGI) : appels à la fonction serveur
// « certifier-fne », qui seule détient la clé API de l'entreprise.

export async function lireConfigFne() {
  const { data } = await supabase.rpc('lire_config_fne')
  return data || { actif: false, fne_par_defaut: false }
}

async function appeler(action, venteId) {
  const { data, error } = await supabase.functions.invoke('certifier-fne', { body: { action, vente_id: venteId } })
  if (error) {
    // Le message utile de la DGI est dans le corps de la réponse d'erreur.
    let message = error.message
    try { message = (await error.context?.json())?.error || message } catch { /* ignore */ }
    return { error: message }
  }
  return { data }
}

export const certifierVenteFne = (venteId) => appeler('certifier', venteId)
export const emettreAvoirFne = (venteId) => appeler('avoir', venteId)

// QR code de vérification (lien « token » renvoyé par la DGI).
export async function qrCodeFne(token) {
  if (!token) return null
  try { return await QRCode.toDataURL(token, { margin: 1, width: 240 }) } catch { return null }
}
