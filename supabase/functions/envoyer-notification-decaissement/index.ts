// Edge Function : notifications push sur le cycle de vie d'une demande
// de décaissement — création (alerte les validateurs) et
// validation/refus (alerte le demandeur d'origine).
//
// Appelée par le client (JournalCaisse.jsx) juste après l'insertion
// ou la mise à jour de la demande. Utilise la clé service_role en
// interne — c'est elle qui décide qui reçoit quoi, pas le client.
//
// Secrets requis (déjà configurés si les notifications de messagerie
// fonctionnent) : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.

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
        JSON.stringify({ title: titre, body: corps, url: '/journal-caisse' })
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
    if (!demande_id || !['creation', 'validation'].includes(evenement)) {
      throw new Error('demande_id et evenement (creation|validation) requis')
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: demande, error: erreurDemande } = await supabaseAdmin
      .from('demandes_decaissement')
      .select('id, numero, libelle, montant_demande, montant_valide, statut, entreprise_id, demande_par, demandeur:profils!demande_par(nom), validateur:profils!valide_par(nom), caisse_id, caisses(nom)')
      .eq('id', demande_id)
      .single()

    if (erreurDemande || !demande) {
      return new Response(JSON.stringify({ error: 'demande introuvable' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let envoyes = 0

    if (evenement === 'creation') {
      const { data: entreprise } = await supabaseAdmin
        .from('entreprises')
        .select('caisse_roles_validateurs')
        .eq('id', demande.entreprise_id)
        .single()

      const roles = entreprise?.caisse_roles_validateurs || ['admin', 'manager']

      const { data: validateurs } = await supabaseAdmin
        .from('profils')
        .select('id')
        .eq('entreprise_id', demande.entreprise_id)
        .in('role', roles)
        .neq('id', demande.demande_par)

      const titre = `Décaissement à valider — ${demande.caisses?.nom || ''}`
      const corps = `${demande.numero} — ${demande.libelle} — ${demande.montant_demande} (${demande.demandeur?.nom || '—'})`

      for (const v of validateurs || []) {
        envoyes += await envoyerAUnProfil(supabaseAdmin, v.id, titre, corps)
      }
    } else if (evenement === 'validation') {
      const accepte = demande.statut === 'validee'
      const titre = accepte ? 'Décaissement validé' : 'Décaissement refusé'
      const corps = accepte
        ? `${demande.numero} — ${demande.libelle} — ${demande.montant_valide} accordé par ${demande.validateur?.nom || '—'}`
        : `${demande.numero} — ${demande.libelle} — refusé par ${demande.validateur?.nom || '—'}`

      envoyes = await envoyerAUnProfil(supabaseAdmin, demande.demande_par, titre, corps)
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
