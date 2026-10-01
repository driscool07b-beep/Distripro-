import { supabase } from './supabase'

// Envoi des documents aux clients : email (pièce jointe PDF, via la fonction
// serveur « envoyer-document ») et WhatsApp (lien sécurisé vers le PDF).

function versBase64(doc) {
  // jsPDF : « data:application/pdf;filename=…;base64,XXXX » → XXXX
  return doc.output('datauristring').split('base64,')[1]
}

export async function envoyerParEmail({ doc, nomFichier, typeDocument, venteId, commandeId, destinataire, automatique = false }) {
  const { data, error } = await supabase.functions.invoke('envoyer-document', {
    body: {
      type_document: typeDocument, vente_id: venteId || null, commande_id: commandeId || null,
      destinataire: destinataire || null, pdf_base64: versBase64(doc), nom_fichier: nomFichier, automatique,
    },
  })
  if (error) {
    let message = error.message
    try { message = (await error.context?.json())?.error || message } catch { /* ignore */ }
    return { error: message }
  }
  return { data }
}

// Numéro au format international pour WhatsApp (Côte d'Ivoire par défaut).
export function numeroWhatsApp(telephone, indicatif = '225') {
  let n = String(telephone || '').replace(/[^0-9+]/g, '')
  if (!n) return ''
  if (n.startsWith('+')) return n.slice(1)
  if (n.startsWith('00')) return n.slice(2)
  if (n.length <= 10) return indicatif + n
  return n
}

// Dépose le PDF (dossier privé de l'entreprise) et crée un lien valable 7 jours.
async function lienPdf({ doc, nomFichier, entrepriseId }) {
  const chemin = `${entrepriseId}/documents-clients/${Date.now()}-${nomFichier.replace(/[^\w.-]/g, '_')}`
  const fichier = new File([doc.output('blob')], nomFichier, { type: 'application/pdf' })
  const { error } = await supabase.storage.from('pieces-jointes').upload(chemin, fichier, { upsert: false, contentType: 'application/pdf' })
  if (error) return { error: error.message }
  const { data, error: e2 } = await supabase.storage.from('pieces-jointes').createSignedUrl(chemin, 7 * 24 * 3600)
  if (e2) return { error: e2.message }
  return { url: data.signedUrl }
}

// Ouvre WhatsApp vers le client avec le message et le lien du PDF.
export async function partagerWhatsApp({ doc, nomFichier, telephone, message, typeDocument, venteId, commandeId, entrepriseId, profilId }) {
  const numero = numeroWhatsApp(telephone)
  if (!numero) return { error: 'numero' }
  // Fenêtre ouverte tout de suite (sinon le téléphone la bloque), puis dirigée vers WhatsApp.
  const fenetre = window.open('', '_blank')
  const { url, error } = await lienPdf({ doc, nomFichier, entrepriseId })
  if (error) { fenetre?.close(); return { error } }
  const texte = `${message}\n${url}`
  const lien = `https://wa.me/${numero}?text=${encodeURIComponent(texte)}`
  if (fenetre) fenetre.location.href = lien
  else window.location.href = lien
  await supabase.from('envois_documents').insert({
    entreprise_id: entrepriseId, vente_id: venteId || null, commande_id: commandeId || null,
    type_document: typeDocument, canal: 'whatsapp', destinataire: numero, succes: true, effectue_par: profilId,
  })
  return { ok: true }
}
