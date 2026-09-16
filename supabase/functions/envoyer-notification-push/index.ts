// Edge Function : envoie une notification push (Web Push / VAPID) aux
// membres d'une conversation (sauf l'expéditeur) quand un message est
// envoyé dans la messagerie interne.
//
// Appelée par le client (Messagerie.jsx) juste après l'insertion du
// message. Utilise la clé service_role en interne, donc n'est pas
// soumise à la RLS — c'est elle qui décide qui reçoit quoi, pas le
// client (qui ne fournit que l'id du message).
//
// Secrets requis (Project Settings → Edge Functions → Secrets) :
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont déjà fournis
// automatiquement par Supabase à toutes les Edge Functions.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contact@example.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY non configurées côté serveur.')
    }

    const { message_id } = await req.json()
    if (!message_id) throw new Error('message_id requis')

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: message, error: erreurMessage } = await supabaseAdmin
      .from('messages')
      .select('id, contenu, piece_jointe_path, conversation_id, expediteur_id, profils!expediteur_id(nom), conversations(type, nom)')
      .eq('id', message_id)
      .single()

    if (erreurMessage || !message) {
      return new Response(JSON.stringify({ error: 'message introuvable' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: membres } = await supabaseAdmin
      .from('conversations_membres')
      .select('profil_id')
      .eq('conversation_id', message.conversation_id)
      .neq('profil_id', message.expediteur_id)

    const idsDestinataires = (membres || []).map((m) => m.profil_id)
    if (idsDestinataires.length === 0) {
      return new Response(JSON.stringify({ ok: true, envoyes: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: abonnements } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('profil_id', idsDestinataires)

    const nomExpediteur = message.profils?.nom || 'Quelqu\'un'
    const titre = message.conversations?.type === 'groupe'
      ? `${nomExpediteur} — ${message.conversations?.nom}`
      : nomExpediteur
    const corps = message.contenu || (message.piece_jointe_path ? '📎 Pièce jointe' : 'Nouveau message')

    let envoyes = 0
    for (const abonnement of abonnements || []) {
      try {
        await webpush.sendNotification(
          { endpoint: abonnement.endpoint, keys: { p256dh: abonnement.p256dh, auth: abonnement.auth } },
          JSON.stringify({ title: titre, body: corps, url: '/messagerie' })
        )
        envoyes++
      } catch (err) {
        // Abonnement expiré/révoqué côté navigateur : on le retire
        // silencieusement pour ne pas réessayer indéfiniment.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', abonnement.id)
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, envoyes }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
