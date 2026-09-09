// supabase/functions/envoyer-invitation/index.ts
// Edge Function : envoie l'email d'invitation à un collaborateur via Resend.
// À déployer via le tableau de bord Supabase (Edge Functions > Deploy a new
// function > Via Editor).
//
// Secrets nécessaires (Edge Functions > Secrets) :
//   RESEND_API_KEY  — clé API Resend (resend.com, gratuit jusqu'à 3000
//                     emails/mois). Sans domaine d'envoi vérifié dans
//                     Resend, l'expéditeur de test (onboarding@resend.dev)
//                     ne peut envoyer qu'à l'adresse email du compte Resend
//                     lui-même — pas à de vrais collaborateurs. Il faut
//                     vérifier un domaine (quelques enregistrements DNS)
//                     pour envoyer à n'importe quelle adresse.
//   APP_URL         — URL publique et stable de l'application (ex.
//                     https://distribpro.com). Tant que l'app ne tourne
//                     que dans l'environnement de développement, cette
//                     variable n'a pas d'adresse stable à pointer — le
//                     lien envoyé ne fonctionnera pas de façon fiable.

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LIBELLES_ROLE: Record<string, string> = {
  admin: 'Administrateur',
  manager: 'Manager',
  commercial: 'Commercial',
  comptable: 'Comptable',
  gestionnaire_stock: 'Gestionnaire de stock',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const appUrl = Deno.env.get('APP_URL')

    if (!resendApiKey) {
      return reponseErreur("Clé RESEND_API_KEY non configurée dans les secrets de l'Edge Function.", 500)
    }
    if (!appUrl) {
      return reponseErreur("Variable APP_URL non configurée dans les secrets de l'Edge Function.", 500)
    }

    const authHeader = req.headers.get('Authorization') || ''
    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser()
    if (userError || !userData?.user) {
      return reponseErreur('Utilisateur non authentifié.', 401)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: profil } = await supabase
      .from('profils')
      .select('id, role, entreprise_id')
      .eq('id', userData.user.id)
      .single()

    if (!profil || profil.role !== 'admin') {
      return reponseErreur('Accès réservé aux administrateurs.', 403)
    }

    const { invitation_id } = await req.json()
    if (!invitation_id) {
      return reponseErreur('invitation_id manquant.', 400)
    }

    const { data: invitation } = await supabase
      .from('invitations')
      .select('id, email, nom_complet, role, statut, entreprise_id')
      .eq('id', invitation_id)
      .eq('entreprise_id', profil.entreprise_id)
      .single()

    if (!invitation) {
      return reponseErreur('Invitation introuvable pour cette entreprise.', 404)
    }
    if (invitation.statut !== 'en_attente') {
      return reponseErreur('Cette invitation n\u2019est plus en attente.', 400)
    }

    const { data: entreprise } = await supabase
      .from('entreprises')
      .select('nom')
      .eq('id', profil.entreprise_id)
      .single()

    const lien = `${appUrl.replace(/\/$/, '')}/inscription?email=${encodeURIComponent(invitation.email)}`
    const nomEntreprise = entreprise?.nom || 'DistribPro'
    const libelleRole = LIBELLES_ROLE[invitation.role] || invitation.role

    const reponseResend = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('RESEND_FROM') || 'DistribPro <onboarding@resend.dev>',
        to: [invitation.email],
        subject: `Invitation à rejoindre ${nomEntreprise} sur DistribPro`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a2e35;">
            <h2 style="margin-bottom: 4px;">${nomEntreprise}</h2>
            <p style="color: #5b7580; font-size: 14px; margin-top: 0;">vous invite à rejoindre son espace DistribPro</p>
            <p>Bonjour ${invitation.nom_complet || ''},</p>
            <p>Vous avez été invité(e) en tant que <strong>${libelleRole}</strong>. Pour créer votre compte, cliquez sur le lien ci-dessous et utilisez exactement cette adresse email : <strong>${invitation.email}</strong></p>
            <p style="text-align: center; margin: 24px 0;">
              <a href="${lien}" style="background: #d69428; color: #1a2e35; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                Créer mon compte
              </a>
            </p>
            <p style="color: #5b7580; font-size: 12px;">Si le bouton ne fonctionne pas, copiez ce lien : ${lien}</p>
          </div>
        `,
      }),
    })

    if (!reponseResend.ok) {
      const detail = await reponseResend.text()
      return reponseErreur(`Erreur d'envoi (Resend, ${reponseResend.status}) : ${detail}`, 502)
    }

    return new Response(JSON.stringify({ succes: true }), {
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  } catch (err) {
    return reponseErreur(`Erreur inattendue : ${err.message}`, 500)
  }
})

function reponseErreur(message: string, statut: number) {
  return new Response(JSON.stringify({ erreur: message }), {
    status: statut,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}
