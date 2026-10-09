// supabase/functions/demande-contact/index.ts
// Edge Function PUBLIQUE (sans connexion) : reçoit le formulaire de contact /
// demande de démonstration du site vitrine, l'enregistre dans
// demandes_contact, prévient le promoteur par email et envoie un accusé de
// réception au prospect.
//
// Déploiement : Edge Functions > Deploy a new function > Via Editor, nom
// « demande-contact », puis dans ses réglages DÉSACTIVER « Verify JWT »
// (le visiteur du site n'est pas connecté).
//
// Secrets utilisés (déjà configurés pour les invitations) :
//   RESEND_API_KEY, RESEND_FROM (ex. DistribPro <noreply@distribpro.com>)
// Facultatif :
//   CONTACT_EMAIL — adresse qui reçoit les demandes (défaut contact@distribpro.com)

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUJETS: Record<string, string> = {
  demo: 'Demande de démonstration',
  tarifs: 'Tarifs et devis',
  migration: 'Reprise de mes données existantes',
  partenariat: 'Partenariat / revendeur',
  assistance: 'Assistance (déjà client)',
  autre: 'Autre demande',
}

const MAX_PAR_HEURE = 3

function json(corps: unknown, statut = 200) {
  return new Response(JSON.stringify(corps), { status: statut, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const nettoyer = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const echapper = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

async function empreinte(texte: string) {
  const octets = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte))
  return Array.from(new Uint8Array(octets)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function envoyerEmail(cle: string, corps: Record<string, unknown>) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  })
  if (!r.ok) console.error('Resend', r.status, await r.text())
  return r.ok
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erreur: 'Méthode non autorisée.' }, 405)

  let d: Record<string, unknown>
  try { d = await req.json() } catch { return json({ erreur: 'Demande illisible.' }, 400) }

  // Pièges à robots : champ invisible rempli, ou formulaire envoyé trop vite.
  // On répond « OK » sans rien faire, pour ne pas renseigner le robot.
  if (nettoyer(d.site_web, 200) !== '' || Number(d.duree_ms) < 2500) return json({ ok: true })

  const demande = {
    nom: nettoyer(d.nom, 120),
    entreprise: nettoyer(d.entreprise, 160) || null,
    telephone: nettoyer(d.telephone, 40),
    email: nettoyer(d.email, 160).toLowerCase(),
    ville: nettoyer(d.ville, 80) || null,
    taille_equipe: nettoyer(d.taille_equipe, 40) || null,
    sujet: SUJETS[String(d.sujet)] ? String(d.sujet) : 'autre',
    message: String(d.message ?? '').trim().slice(0, 3000) || null,
    source: nettoyer(d.source, 40) || 'formulaire',
  }

  if (demande.nom.length < 2) return json({ erreur: 'Indiquez votre nom.' }, 400)
  if (demande.telephone.replace(/\D/g, '').length < 8) return json({ erreur: 'Indiquez un numéro de téléphone valide (8 chiffres au moins).' }, 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(demande.email)) return json({ erreur: 'Indiquez une adresse e-mail valide.' }, 400)
  if (d.consentement !== true) return json({ erreur: 'Merci d’accepter d’être recontacté.' }, 400)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Limite anti-abus : quelques demandes par heure et par adresse IP.
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'inconnue'
  const ip_hash = await empreinte(`distribpro:${ip}`)
  const { count } = await supabase
    .from('demandes_contact')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ip_hash)
    .gte('created_at', new Date(Date.now() - 3600_000).toISOString())
  if ((count ?? 0) >= MAX_PAR_HEURE) {
    return json({ erreur: 'Vous avez déjà envoyé plusieurs demandes. Nous revenons vers vous très vite ; vous pouvez aussi nous écrire à contact@distribpro.com.' }, 429)
  }

  const { error } = await supabase.from('demandes_contact').insert({ ...demande, ip_hash })
  if (error) {
    console.error(error)
    return json({ erreur: 'Enregistrement impossible pour le moment. Écrivez-nous à contact@distribpro.com.' }, 500)
  }

  const cle = Deno.env.get('RESEND_API_KEY')
  const expediteur = Deno.env.get('RESEND_FROM') || 'DistribPro <noreply@distribpro.com>'
  const destinataire = Deno.env.get('CONTACT_EMAIL') || 'contact@distribpro.com'
  if (cle) {
    const lignes: [string, string | null][] = [
      ['Sujet', SUJETS[demande.sujet]], ['Nom', demande.nom], ['Entreprise', demande.entreprise],
      ['Téléphone', demande.telephone], ['E-mail', demande.email], ['Ville', demande.ville],
      ['Taille de l’équipe', demande.taille_equipe], ['Origine', demande.source],
    ]
    const tableau = lignes.filter(([, v]) => v).map(([k, v]) =>
      `<tr><td style="padding:4px 12px 4px 0;color:#4a646b">${k}</td><td style="padding:4px 0"><strong>${echapper(String(v))}</strong></td></tr>`).join('')
    const wa = demande.telephone.replace(/\D/g, '')

    await envoyerEmail(cle, {
      from: expediteur,
      to: [destinataire],
      reply_to: demande.email,
      subject: `[Site] ${SUJETS[demande.sujet]} — ${demande.nom}${demande.entreprise ? ` (${demande.entreprise})` : ''}`,
      html: `<div style="font-family:Arial,sans-serif;color:#0a1f26;max-width:560px">
        <h2 style="margin:0 0 12px">Nouvelle demande depuis distribpro.com</h2>
        <table style="font-size:14px;border-collapse:collapse">${tableau}</table>
        ${demande.message ? `<p style="margin:16px 0 4px;color:#4a646b">Message</p><p style="white-space:pre-wrap;margin:0;padding:12px;background:#f5f6f4;border-radius:8px">${echapper(demande.message)}</p>` : ''}
        <p style="margin-top:18px"><a href="https://wa.me/${wa}">Répondre sur WhatsApp</a> · Répondez à cet e-mail pour écrire directement au prospect.</p>
        <p style="color:#4a646b;font-size:12px">Suivi : Console plateforme → Prospects.</p></div>`,
    })

    await envoyerEmail(cle, {
      from: expediteur,
      to: [demande.email],
      reply_to: destinataire,
      subject: 'DistribPro — nous avons bien reçu votre demande',
      html: `<div style="font-family:Arial,sans-serif;color:#0a1f26;max-width:560px;line-height:1.55">
        <p>Bonjour ${echapper(demande.nom)},</p>
        <p>Merci pour votre intérêt pour DistribPro. Votre demande (« ${SUJETS[demande.sujet]} ») a bien été reçue :
        nous vous recontactons au ${echapper(demande.telephone)} sous un jour ouvré.</p>
        <p>Sans attendre, vous pouvez ouvrir un espace d'essai gratuit de 21 jours, sans carte bancaire :
        <a href="https://distribpro.com/creer-entreprise">distribpro.com/creer-entreprise</a></p>
        <p>À très bientôt,<br>L'équipe DistribPro</p></div>`,
    })
  }

  return json({ ok: true })
})
