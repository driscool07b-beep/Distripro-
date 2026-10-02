// supabase/functions/rappels-abonnement/index.ts
// Edge Function appelée chaque jour à 8 h par la planification (pg_cron) :
//   1. applique les règles d'impayé (lecture seule, suspension) si elles
//      sont activées dans la console du promoteur ;
//   2. envoie aux administrateurs de chaque entreprise les rappels du jour
//      (fin d'essai, échéance, impayé, unités IA basses ou épuisées), une
//      seule fois chacun.
// Protégée par le secret partagé de la planification. Secrets utilisés :
// RESEND_API_KEY, RESEND_FROM, APP_URL (déjà configurés).

import { createClient } from 'npm:@supabase/supabase-js@2'

const reponse = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } })

const fmt = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '')
const nb = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR')

// Contenu de chaque rappel.
function contenu(r: any, lien: string) {
  const jours = Number(String(r.type).replace(/\D/g, '') || 0)
  switch (true) {
    case r.type.startsWith('essai_j'):
      return {
        sujet: jours === 0 ? `Votre essai DistribPro se termine aujourd'hui` : `Votre essai DistribPro se termine dans ${jours} jour${jours > 1 ? 's' : ''}`,
        texte: `Votre période d'essai de DistribPro prend fin le <strong>${fmt(r.date_reference)}</strong>. Pour continuer sans interruption avec toutes vos données (ventes, stock, clients, commerciaux), choisissez votre formule et réglez en quelques secondes par Mobile Money ou carte.`,
        bouton: 'Choisir ma formule',
      }
    case r.type.startsWith('echeance_j'):
      return {
        sujet: `Votre abonnement DistribPro arrive à échéance dans ${jours} jour${jours > 1 ? 's' : ''}`,
        texte: `Votre abonnement arrive à échéance le <strong>${fmt(r.date_reference)}</strong>. Pensez à le renouveler pour éviter toute interruption de service.`,
        bouton: 'Renouveler mon abonnement',
      }
    case r.type === 'impaye':
      return {
        sujet: `Action requise : régularisez votre abonnement DistribPro`,
        texte: `Votre abonnement (ou votre période d'essai) a expiré le <strong>${fmt(r.date_reference)}</strong>. Sans régularisation, votre espace peut passer en lecture seule, puis être suspendu. Vos données restent conservées.`,
        bouton: 'Régulariser maintenant',
      }
    case r.type === 'ia_epuise':
      return {
        sujet: `Vos unités IA DistribPro sont épuisées`,
        texte: `Le solde de vos unités IA est épuisé : l'assistant, la saisie dictée, les analyses et les rapports commentés par l'IA sont en pause. Rechargez un pack pour les réactiver immédiatement.`,
        bouton: 'Recharger mes unités IA',
      }
    default:
      return {
        sujet: `Votre solde d'unités IA DistribPro est bas`,
        texte: `Il vous reste <strong>${nb(r.solde)} unités IA</strong>. Pensez à recharger pour que vos équipes continuent d'utiliser l'assistant et la saisie dictée sans interruption.`,
        bouton: 'Recharger mes unités IA',
      }
  }
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    const { data: secret } = await supabase.from('plateforme_secrets').select('valeur').eq('cle', 'rapport_mensuel').maybeSingle()
    if (!secret?.valeur || req.headers.get('x-rapport-secret') !== secret.valeur) return reponse({ error: 'accès refusé' }, 403)

    // 1. Règles d'impayé (actives seulement si le promoteur les a activées).
    const { data: regles, error: erreurRegles } = await supabase.rpc('appliquer_regles_abonnement')

    // 2. Rappels du jour.
    const { data: param } = await supabase.from('plateforme_parametres').select('valeur').eq('cle', 'rappels_auto').maybeSingle()
    if (Number(param?.valeur ?? 1) !== 1) return reponse({ regles, rappels: 'désactivés' })
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) return reponse({ regles, error: 'RESEND_API_KEY manquant' }, 500)
    const lien = `${(Deno.env.get('APP_URL') || '').replace(/\/$/, '')}/abonnement`
    const expediteur = (Deno.env.get('RESEND_FROM') || 'onboarding@resend.dev').replace(/^.*<|>$/g, '')

    const { data: rappels } = await supabase.rpc('rappels_a_envoyer')
    const bilan: any[] = []
    for (const r of rappels || []) {
      // Destinataires : administrateurs actifs de l'entreprise.
      const { data: admins } = await supabase.from('profils').select('id').eq('entreprise_id', r.entreprise_id).eq('role', 'admin').neq('actif', false)
      const emails: string[] = []
      for (const a of admins || []) {
        const { data: u } = await supabase.auth.admin.getUserById(a.id)
        if (u?.user?.email) emails.push(u.user.email)
      }
      if (!emails.length) { bilan.push({ entreprise: r.nom, type: r.type, envoye: false, motif: 'aucun administrateur' }); continue }
      const c = contenu(r, lien)
      const envoi = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `DistribPro <${expediteur}>`,
          to: emails,
          subject: `${c.sujet} — ${r.nom}`,
          html: `<div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1a2e35;">
            <h2 style="margin-bottom: 4px;">DistribPro</h2>
            <p style="color: #5b7580; margin-top: 0;">${r.nom}</p>
            <p>Bonjour,</p>
            <p>${c.texte}</p>
            <p style="text-align: center; margin: 24px 0;">
              <a href="${lien}" style="background: #d69428; color: #1a2e35; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">${c.bouton}</a>
            </p>
            <p style="color: #5b7580; font-size: 12px;">Une question ? Répondez simplement à cet email. — L'équipe DistribPro</p>
          </div>`,
        }),
      })
      if (envoi.ok) await supabase.from('rappels_envoyes').insert({ entreprise_id: r.entreprise_id, cle: r.cle })
      bilan.push({ entreprise: r.nom, type: r.type, envoye: envoi.ok })
    }
    return reponse({ regles, erreur_regles: erreurRegles?.message || null, rappels: bilan })
  } catch (e) {
    return reponse({ error: String((e as Error)?.message || e) }, 500)
  }
})
