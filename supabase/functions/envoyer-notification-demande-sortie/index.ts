// Edge Function : notifications push sur le cycle de vie d'une demande
// de sortie de produits — création (alerte le(s) gestionnaire(s) du
// magasin) et traitement (alerte le commercial demandeur).
// Appelée par le client (StockCommercial.jsx) juste après l'action.
// Secrets requis (déjà configurés pour la messagerie) : VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// Déploiement : supabase functions deploy envoyer-notification-demande-sortie

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

async function envoyerAUnProfil(supabaseAdmin, profilId, titre, corps) {
  const { data: abonnements } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('profil_id', profilId)

  let envoyes = 0
  for (const abonnement of abonnements || []) {
    try {
      await webpush.sendNotification(
        { endpoint: abonnement.endpoint, keys: { p256dh: abonnement.p256dh, auth: abonnement.auth } },
        JSON.stringify({ title: titre, body: corps, url: '/stock-commercial' })
      )
      envoyes++
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', abonnement.id)
      }
    }
  }
  return envoyes
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY non configurées côté serveur.')
    }

    const { demande_id, evenement } = await req.json()
    if (!demande_id || !['creation', 'traitement'].includes(evenement)) {
      throw new Error('demande_id et evenement (creation|traitement) requis')
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // L'appelant doit appartenir à l'entreprise de la demande.
    const authHeader = req.headers.get('Authorization') || ''
    const { data: userData } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    ).auth.getUser()
    const { data: appelant } = userData?.user
      ? await supabaseAdmin.from('profils').select('entreprise_id').eq('id', userData.user.id).single()
      : { data: null }

    const { data: demande } = await supabaseAdmin
      .from('demandes_sortie')
      .select('id, numero, statut, entreprise_id, commercial_id, depot_id, date_souhaitee, motif_traitement, commercial:profils!commercial_id(nom), depots(nom), demande_sortie_lignes(id)')
      .eq('id', demande_id)
      .single()

    if (!demande || !appelant || appelant.entreprise_id !== demande.entreprise_id) {
      return new Response(JSON.stringify({ error: 'demande introuvable' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let envoyes = 0
    const nbArticles = (demande.demande_sortie_lignes || []).length

    if (evenement === 'creation') {
      // 1) les gestionnaires attribués à ce magasin ; 2) à défaut, tous les
      // gestionnaires de stock ; 3) à défaut, les admin et managers.
      const { data: attribues } = await supabaseAdmin
        .from('gestionnaire_depots').select('profil_id').eq('depot_id', demande.depot_id)
      let destinataires = (attribues || []).map((a) => a.profil_id)
      if (!destinataires.length) {
        const { data: gestionnaires } = await supabaseAdmin.from('profils').select('id')
          .eq('entreprise_id', demande.entreprise_id).eq('role', 'gestionnaire_stock').neq('actif', false)
        destinataires = (gestionnaires || []).map((g) => g.id)
      }
      if (!destinataires.length) {
        const { data: direction } = await supabaseAdmin.from('profils').select('id')
          .eq('entreprise_id', demande.entreprise_id).in('role', ['admin', 'manager']).neq('actif', false)
        destinataires = (direction || []).map((g) => g.id)
      }

      const titre = `Demande de sortie — ${demande.commercial?.nom || ''}`
      const corps = `${demande.numero} — ${nbArticles} article(s) — ${demande.depots?.nom || ''} — pour le ${demande.date_souhaitee}`
      for (const id of destinataires) {
        envoyes += await envoyerAUnProfil(supabaseAdmin, id, titre, corps)
      }
    } else {
      const titres: Record<string, string> = {
        accordee: 'Demande de sortie accordée',
        partielle: 'Demande de sortie accordée en partie',
        refusee: 'Demande de sortie refusée',
      }
      if (!titres[demande.statut]) {
        return new Response(JSON.stringify({ ok: true, envoyes: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const corps = `${demande.numero}${demande.motif_traitement ? ' — ' + demande.motif_traitement : ''}`
      envoyes = await envoyerAUnProfil(supabaseAdmin, demande.commercial_id, titres[demande.statut], corps)
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
