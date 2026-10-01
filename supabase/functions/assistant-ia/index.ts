// supabase/functions/assistant-ia/index.ts
// Edge Function : assistant conversationnel de DistribPro.
// L'IA ne lit pas la base directement : elle appelle des outils (fonctions
// SQL ia_*) exécutés AVEC LES DROITS DE L'UTILISATEUR (un commercial ne voit
// que ses propres chiffres). Elle ne doit jamais inventer un chiffre.
// Secret requis : ANTHROPIC_API_KEY (déjà configuré pour l'Analyse IA).
//
// Corps : { messages: [{ role: 'user' | 'assistant', content: string }] }

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const reponse = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })

const MODELE = 'claude-sonnet-5'

const OUTILS = [
  {
    name: 'indicateurs',
    description: "Indicateurs clés du moment : date du jour, CA du jour et du mois, CA du mois précédent, créances totales et échues, nombre de produits en alerte de stock.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ventes',
    description: "Ventes (hors annulées) sur une période, regroupées par jour, mois, commercial, client, produit ou magasin. Renvoie nombre de ventes, montant TTC, montant encaissé (ou quantité pour les produits).",
    input_schema: {
      type: 'object',
      properties: {
        debut: { type: 'string', description: 'Date de début AAAA-MM-JJ' },
        fin: { type: 'string', description: 'Date de fin AAAA-MM-JJ (incluse)' },
        groupement: { type: 'string', enum: ['jour', 'mois', 'commercial', 'client', 'produit', 'magasin'] },
        limite: { type: 'integer', description: 'Nombre maximum de lignes (défaut 20)' },
      },
      required: ['debut', 'fin', 'groupement'],
    },
  },
  {
    name: 'creances',
    description: "Créances clients (restes à payer), les plus importantes d'abord, avec échéance et jours de retard.",
    input_schema: {
      type: 'object',
      properties: {
        seulement_echues: { type: 'boolean', description: 'true = seulement les échéances dépassées' },
        limite: { type: 'integer' },
      },
      required: [],
    },
  },
  {
    name: 'stock',
    description: "Stock par produit et par magasin, avec le seuil d'alerte.",
    input_schema: {
      type: 'object',
      properties: {
        alertes_seulement: { type: 'boolean', description: 'true = seulement les produits sous le seuil' },
        magasin: { type: 'string', description: 'Nom (ou partie du nom) du magasin' },
      },
      required: [],
    },
  },
  {
    name: 'stock_commerciaux',
    description: 'Stock actuellement en main chez chaque commercial, par produit.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) return reponse({ error: "Clé ANTHROPIC_API_KEY non configurée." }, 500)

    const authHeader = req.headers.get('Authorization') || ''
    // Client « utilisateur » : les outils s'exécutent avec SES droits.
    const supabaseUtilisateur = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userError } = await supabaseUtilisateur.auth.getUser()
    if (userError || !userData?.user) return reponse({ error: 'Utilisateur non authentifié.' }, 401)
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: profil } = await supabase.from('profils')
      .select('id, nom, role, entreprise_id, ia_active, actif').eq('id', userData.user.id).single()
    if (!profil || profil.actif === false) return reponse({ error: 'Compte inactif.' }, 403)
    if (profil.ia_active === false) return reponse({ error: 'Les fonctions IA sont désactivées pour votre compte.' }, 403)
    const { data: entreprise } = await supabase.from('entreprises').select('nom, devise').eq('id', profil.entreprise_id).single()

    const { messages, aide, page } = await req.json()
    // Assistance technique : passages du guide d'utilisation choisis par l'app.
    const extraitsAide = (Array.isArray(aide) ? aide : []).slice(0, 8)
      .map((a: any) => `• [${String(a.rubrique || '').slice(0, 60)}] ${String(a.question || '').slice(0, 200)}\n  ${String(a.reponse || '').slice(0, 1200)}`)
      .join('\n')
    const pageCourante = String(page || '').slice(0, 80)
    if (!Array.isArray(messages) || messages.length === 0) return reponse({ error: 'Aucune question.' }, 400)
    // Historique limité (les 16 derniers échanges), textes bornés.
    const historique = messages.slice(-16).map((m: any) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 4000),
    }))

    const aujourdHui = new Date().toLocaleDateString('fr-CA', { timeZone: 'Africa/Abidjan' })
    const systeme = `Tu es l'assistant de gestion de DistribPro pour l'entreprise « ${entreprise?.nom || ''} » (Côte d'Ivoire).
Date du jour : ${aujourdHui}. Utilisateur : ${profil.nom} (rôle : ${profil.role}). Devise : ${entreprise?.devise || 'XOF'} (F CFA).
Règles :
- Pour TOUT chiffre, appelle d'abord les outils. N'invente jamais un montant, une quantité ou un nom.
- Si les outils ne permettent pas de répondre, dis-le simplement et propose ce que tu peux calculer.
- Les outils respectent les droits de l'utilisateur : si un résultat est vide pour un commercial, c'est qu'il ne voit que ses propres données.
- Réponds dans la langue de la question, de façon concise et concrète : chiffres clés d'abord, puis une courte analyse ou une recommandation utile.
- Montants arrondis, avec séparateur de milliers et « F CFA ». Dates au format JJ/MM/AAAA.
- Mise en forme simple : titres courts, listes à puces, **gras** pour les chiffres clés. Pas de tableau Markdown. Pas de jargon technique (ne parle pas d'« outils » ni de base de données).
Assistance technique (questions « comment faire… ? », « pourquoi je ne peux pas… ? ») :
- Appuie-toi UNIQUEMENT sur les extraits du guide d'utilisation ci-dessous ; donne le chemin dans les menus et les étapes, simplement.
- Si le guide ne couvre pas la question, dis-le franchement et conseille de contacter l'administrateur de l'entreprise ou le support DistribPro ; n'invente pas de fonctionnalité.
- Certaines actions dépendent du rôle : si l'utilisateur ne voit pas un bouton, explique que c'est peut-être réservé à un autre rôle (rôle actuel : ${profil.role}).
${pageCourante ? `Page consultée juste avant : ${pageCourante}.` : ''}
${extraitsAide ? `Extraits du guide d'utilisation :\n${extraitsAide}` : ''}`

    const executerOutil = async (nom: string, entree: any) => {
      const appel = async (fn: string, params: Record<string, unknown>) => {
        const { data, error } = await supabaseUtilisateur.rpc(fn, params)
        return error ? { erreur: error.message } : data
      }
      switch (nom) {
        case 'indicateurs': return appel('ia_indicateurs', {})
        case 'ventes': return appel('ia_ventes', { p_debut: entree.debut, p_fin: entree.fin, p_groupement: entree.groupement, p_limite: entree.limite || 20 })
        case 'creances': return appel('ia_creances', { p_seulement_echues: !!entree.seulement_echues, p_limite: entree.limite || 20 })
        case 'stock': return appel('ia_stock', { p_alertes_seulement: !!entree.alertes_seulement, p_magasin: entree.magasin || null })
        case 'stock_commerciaux': return appel('ia_stock_commerciaux', {})
        default: return { erreur: 'outil inconnu' }
      }
    }

    const conversation: any[] = [...historique]
    const usageTotal = { input_tokens: 0, output_tokens: 0 }
    let texteFinal = ''
    for (let tour = 0; tour < 6; tour++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODELE, max_tokens: 1500, system: systeme, tools: OUTILS, messages: conversation }),
      })
      if (!r.ok) return reponse({ error: `Service IA indisponible (${r.status}).` }, 502)
      const resultat = await r.json()
      usageTotal.input_tokens += Number(resultat.usage?.input_tokens || 0)
      usageTotal.output_tokens += Number(resultat.usage?.output_tokens || 0)
      conversation.push({ role: 'assistant', content: resultat.content })

      const appels = (resultat.content || []).filter((b: any) => b.type === 'tool_use')
      if (resultat.stop_reason !== 'tool_use' || appels.length === 0) {
        texteFinal = (resultat.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
        break
      }
      const reponsesOutils = []
      for (const a of appels) {
        const donnees = await executerOutil(a.name, a.input || {})
        reponsesOutils.push({ type: 'tool_result', tool_use_id: a.id, content: JSON.stringify(donnees).slice(0, 20000) })
      }
      conversation.push({ role: 'user', content: reponsesOutils })
    }

    await enregistrerConsommation(supabase, { entrepriseId: profil.entreprise_id, profilId: profil.id, usage: usageTotal })
    return reponse({ reponse: texteFinal || "Je n'ai pas pu formuler de réponse. Pouvez-vous reformuler la question ?" })
  } catch (e) {
    return reponse({ error: String((e as Error)?.message || e) }, 500)
  }
})

// Consommation réelle (tokens) et coût au tarif en vigueur. Ne bloque jamais.
async function enregistrerConsommation(supabase: any, p: { entrepriseId: string; profilId: string; usage: any }) {
  try {
    const entree = Number(p.usage?.input_tokens || 0)
    const sortie = Number(p.usage?.output_tokens || 0)
    const { data: tarif } = await supabase.from('tarifs_ia').select('*').eq('modele', MODELE).maybeSingle()
    const cout = tarif ? (entree * Number(tarif.prix_entree_usd_par_million) + sortie * Number(tarif.prix_sortie_usd_par_million)) / 1_000_000 : 0
    await supabase.from('consommation_ia').insert({
      entreprise_id: p.entrepriseId, profil_id: p.profilId, fonction: 'assistant_ia',
      modele: MODELE, tokens_entree: entree, tokens_sortie: sortie, cout_usd: cout,
    })
  } catch (_) { /* la mesure ne doit jamais faire échouer l'appel */ }
}
