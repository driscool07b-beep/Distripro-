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

function genererMotDePasseTemporaire() {
  const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let mdp = ''
  for (let i = 0; i < 12; i++) {
    mdp += caracteres[Math.floor(Math.random() * caracteres.length)]
  }
  return mdp
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
      .select('id, entreprise_id')
      .eq('id', profil_id)
      .single()

    if (!profilCible || profilCible.entreprise_id !== profilAppelant.entreprise_id) {
      return new Response(JSON.stringify({ error: 'utilisateur introuvable dans votre entreprise' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const nouveauMotDePasse = genererMotDePasseTemporaire()

    const { error: erreurMaj } = await supabaseAdmin.auth.admin.updateUserById(profil_id, {
      password: nouveauMotDePasse,
    })
    if (erreurMaj) throw erreurMaj

    await supabaseAdmin.from('profils').update({ doit_changer_mot_de_passe: true }).eq('id', profil_id)

    return new Response(JSON.stringify({ ok: true, mot_de_passe_temporaire: nouveauMotDePasse }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
