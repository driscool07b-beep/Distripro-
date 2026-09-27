// Edge Function : réinitialisation du mot de passe d'un membre de
// l'équipe, à la demande d'un admin — sans que l'admin ne voie
// jamais le mot de passe (ni l'ancien, ni le nouveau : celui-ci n'est
// retourné qu'une fois, dans la réponse de cet appel, jamais stocké
// en clair nulle part).
//
// Nécessite la clé service_role pour appeler l'API Admin de Supabase
// Auth (auth.admin.updateUserById) — c'est pour ça que ça passe par
// une Edge Function et pas un appel direct depuis le client.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Mot de passe provisoire robuste : 12 caractères, avec au moins une
// majuscule, une minuscule, un chiffre et un symbole (règles de sécurité
// éventuelles du projet), tirés au hasard de façon cryptographique.
function genererMotDePasseTemporaire() {
  const groupes = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '@#$%&*!?']
  const tous = groupes.join('')
  const hasard = (n: number) => {
    const t = new Uint32Array(1)
    crypto.getRandomValues(t)
    return t[0] % n
  }
  const car = groupes.map((g) => g[hasard(g.length)])
  while (car.length < 12) car.push(tous[hasard(tous.length)])
  for (let i = car.length - 1; i > 0; i--) {
    const j = hasard(i + 1)
    ;[car[i], car[j]] = [car[j], car[i]]
  }
  return car.join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { profil_id } = await req.json()
    if (!profil_id) throw new Error('profil_id requis')

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('non authentifié')

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Vérifie que l'appelant est bien admin, dans la même entreprise
    // que la cible — jamais faire confiance à un rôle envoyé par le
    // client, toujours revérifier côté serveur.
    const supabaseCaller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user: appelant } } = await supabaseCaller.auth.getUser()
    if (!appelant) throw new Error('session invalide')

    const { data: profilAppelant } = await supabaseAdmin
      .from('profils')
      .select('role, entreprise_id')
      .eq('id', appelant.id)
      .single()

    if (!profilAppelant || profilAppelant.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'accès refusé : réservé aux administrateurs' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profilCible } = await supabaseAdmin
      .from('profils')
      .select('id, entreprise_id, nom, nom_complet')
      .eq('id', profil_id)
      .single()

    if (!profilCible || profilCible.entreprise_id !== profilAppelant.entreprise_id) {
      return new Response(JSON.stringify({ error: 'utilisateur introuvable dans votre entreprise' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: compte } = await supabaseAdmin.auth.admin.getUserById(profil_id)
    const email = compte?.user?.email
    const { data: entreprise } = await supabaseAdmin
      .from('entreprises').select('nom').eq('id', profilAppelant.entreprise_id).single()

    const nouveauMotDePasse = genererMotDePasseTemporaire()

    const { error: erreurMaj } = await supabaseAdmin.auth.admin.updateUserById(profil_id, {
      password: nouveauMotDePasse,
    })
    if (erreurMaj) throw erreurMaj

    await supabaseAdmin.from('profils').update({ doit_changer_mot_de_passe: true }).eq('id', profil_id)

    // Envoi du mot de passe provisoire directement à l'utilisateur, avec le
    // lien de connexion : l'administrateur n'a pas à le voir ni à le transmettre.
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const appUrl = (Deno.env.get('APP_URL') || '').replace(/\/$/, '')
    let erreurEmail = ''
    if (!email) erreurEmail = 'adresse email introuvable'
    else if (!resendApiKey || !appUrl) erreurEmail = 'envoi d\'email non configuré (RESEND_API_KEY / APP_URL)'
    else {
      const lien = `${appUrl}/connexion`
      const nom = profilCible.nom_complet || profilCible.nom || ''
      const nomEntreprise = entreprise?.nom || 'DistribPro'
      const reponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: Deno.env.get('RESEND_FROM') || 'DistribPro <onboarding@resend.dev>',
          to: [email],
          subject: `Votre mot de passe provisoire — ${nomEntreprise} sur DistribPro`,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a2e35;">
              <h2 style="margin-bottom: 4px;">${nomEntreprise}</h2>
              <p style="color: #5b7580; font-size: 14px; margin-top: 0;">Réinitialisation de votre mot de passe DistribPro</p>
              <p>Bonjour ${nom},</p>
              <p>Votre administrateur a réinitialisé votre mot de passe. Voici votre mot de passe provisoire :</p>
              <p style="text-align: center; margin: 20px 0;">
                <span style="font-family: monospace; font-size: 20px; letter-spacing: 2px; background: #f3efe6; padding: 10px 16px; border-radius: 8px; display: inline-block;">${nouveauMotDePasse}</span>
              </p>
              <p>Connectez-vous avec votre adresse <strong>${email}</strong> et ce mot de passe. Il vous sera demandé d'en choisir un nouveau dès la connexion.</p>
              <p style="text-align: center; margin: 24px 0;">
                <a href="${lien}" style="background: #d69428; color: #1a2e35; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Me connecter</a>
              </p>
              <p style="color: #5b7580; font-size: 12px;">Si vous n'êtes pas à l'origine de cette demande, prévenez votre administrateur. Lien : ${lien}</p>
            </div>
          `,
        }),
      })
      if (!reponse.ok) erreurEmail = `envoi impossible (${reponse.status}) : ${await reponse.text()}`
    }

    // Email envoyé : le mot de passe n'est PAS renvoyé à l'administrateur.
    // Échec d'envoi : il lui est affiché en secours, avec la raison.
    const corps = erreurEmail
      ? { ok: true, email_envoye: false, erreur_email: erreurEmail, mot_de_passe_temporaire: nouveauMotDePasse }
      : { ok: true, email_envoye: true, email }
    return new Response(JSON.stringify(corps), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
