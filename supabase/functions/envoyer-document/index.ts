// supabase/functions/envoyer-document/index.ts
// Edge Function : envoie un document (reçu, facture FNE, proforma, avoir) au
// client par email, en pièce jointe PDF, via Resend.
// Secrets utilisés (déjà configurés pour les invitations) : RESEND_API_KEY,
// RESEND_FROM. À déployer via le tableau de bord Supabase (Edge Functions).
//
// Corps : { type_document, vente_id? , commande_id?, destinataire?, pdf_base64,
//           nom_fichier, automatique? }

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const reponse = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })

const TITRES: Record<string, string> = {
  recu: 'Votre reçu de vente', facture_fne: 'Votre facture normalisée (FNE)', proforma: 'Votre facture proforma', avoir: 'Votre facture d\'avoir',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) return reponse({ error: "Clé RESEND_API_KEY non configurée." }, 500)
    const authHeader = req.headers.get('Authorization') || ''
    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser()
    if (userError || !userData?.user) return reponse({ error: 'Utilisateur non authentifié.' }, 401)
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const corps = await req.json()
    const { type_document, vente_id, commande_id, pdf_base64, nom_fichier, automatique } = corps
    if (!TITRES[type_document] || !pdf_base64 || (!vente_id && !commande_id)) return reponse({ error: 'Requête invalide.' }, 400)
    if (pdf_base64.length > 8_000_000) return reponse({ error: 'Document trop volumineux.' }, 400)

    const { data: profil } = await supabase.from('profils').select('id, entreprise_id, actif').eq('id', userData.user.id).single()
    if (!profil || profil.actif === false) return reponse({ error: 'Compte inactif.' }, 403)
    const { data: entreprise } = await supabase.from('entreprises').select('nom, email, telephone').eq('id', profil.entreprise_id).single()

    // Le document doit appartenir à l'entreprise de l'utilisateur.
    let client: any = null
    let numero = ''
    if (vente_id) {
      const { data: v } = await supabase.from('ventes').select('numero_vente, entreprise_id, clients(nom, email)').eq('id', vente_id).single()
      if (!v || v.entreprise_id !== profil.entreprise_id) return reponse({ error: 'Vente introuvable.' }, 404)
      client = v.clients; numero = v.numero_vente || ''
    } else {
      const { data: c } = await supabase.from('commandes').select('numero, entreprise_id, clients(nom, email)').eq('id', commande_id).single()
      if (!c || c.entreprise_id !== profil.entreprise_id) return reponse({ error: 'Commande introuvable.' }, 404)
      client = c.clients; numero = c.numero || ''
    }
    const destinataire = String(corps.destinataire || client?.email || '').trim()
    const journal = (succes: boolean, erreur: string | null) => supabase.from('envois_documents').insert({
      entreprise_id: profil.entreprise_id, vente_id: vente_id || null, commande_id: commande_id || null,
      type_document, canal: 'email', destinataire: destinataire || null, succes, erreur, automatique: !!automatique, effectue_par: profil.id,
    })
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destinataire)) {
      await journal(false, 'adresse email du client absente ou invalide')
      return reponse({ error: "Le client n'a pas d'adresse email valide (à renseigner dans sa fiche)." }, 400)
    }

    const nomEntreprise = entreprise?.nom || 'DistribPro'
    const titre = TITRES[type_document]
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${nomEntreprise} <${(Deno.env.get('RESEND_FROM') || 'onboarding@resend.dev').replace(/^.*<|>$/g, '')}>`,
        to: [destinataire],
        ...(entreprise?.email ? { reply_to: entreprise.email } : {}),
        subject: `${titre}${numero ? ` ${numero}` : ''} — ${nomEntreprise}`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a2e35;">
            <h2 style="margin-bottom: 4px;">${nomEntreprise}</h2>
            <p>Bonjour ${client?.nom || ''},</p>
            <p>${titre}${numero ? ` <strong>${numero}</strong>` : ''} est en pièce jointe (PDF).</p>
            <p>Merci pour votre confiance.</p>
            <p style="color: #5b7580; font-size: 12px;">${nomEntreprise}${entreprise?.telephone ? ` — ${entreprise.telephone}` : ''}${entreprise?.email ? ` — ${entreprise.email}` : ''}</p>
          </div>`,
        attachments: [{ filename: nom_fichier || 'document.pdf', content: pdf_base64 }],
      }),
    })
    if (!r.ok) {
      const texte = await r.text()
      await journal(false, `Resend ${r.status} : ${texte.slice(0, 300)}`)
      return reponse({ error: `Envoi impossible (${r.status}).` }, 502)
    }
    await journal(true, null)
    return reponse({ ok: true, destinataire })
  } catch (e) {
    return reponse({ error: String(e?.message || e) }, 500)
  }
})
