// supabase/functions/planifier-tournee-ia/index.ts
// Edge Function : propose la liste des clients à visiter pour une tournée
// (un commercial, une date), avec la raison de chaque choix.
// Ne crée RIEN : la proposition est renvoyée à l'écran, l'utilisateur la
// modifie puis la confirme (création via la RPC creer_tournee_optimisee).
// Secrets : ANTHROPIC_API_KEY.
// Déploiement : supabase functions deploy planifier-tournee-ia

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LANGUES: Record<string, string> = { fr: 'français', en: 'English', ar: 'العربية', zh: '中文' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) return reponseErreur("Clé ANTHROPIC_API_KEY non configurée.", 500)

    const authHeader = req.headers.get('Authorization') || ''
    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser()
    if (userError || !userData?.user) return reponseErreur('Utilisateur non authentifié.', 401)

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: appelant } = await supabase
      .from('profils')
      .select('id, role, entreprise_id, actif, ia_active, responsable_tournees')
      .eq('id', userData.user.id)
      .single()
    if (!appelant || appelant.actif === false) return reponseErreur('Compte introuvable ou désactivé.', 403)
    if (appelant.ia_active === false) return reponseErreur("Les fonctions IA sont désactivées pour votre compte.", 403)

    const { commercial_id, date_tournee, nb_clients, langue } = await req.json()
    if (!commercial_id || !date_tournee) return reponseErreur('commercial_id et date_tournee sont requis.', 400)

    const estResponsable = ['admin', 'manager'].includes(appelant.role) || appelant.responsable_tournees
    if (!estResponsable) {
      if (appelant.role !== 'commercial' || commercial_id !== appelant.id) {
        return reponseErreur('Un commercial ne peut planifier que sa propre tournée.', 403)
      }
    }

    const entrepriseId = appelant.entreprise_id
    const { data: commercial } = await supabase
      .from('profils')
      .select('id, nom, zone, actif')
      .eq('id', commercial_id)
      .eq('entreprise_id', entrepriseId)
      .single()
    if (!commercial || commercial.actif === false) return reponseErreur('Commercial introuvable ou désactivé.', 404)

    const nombre = Math.min(Math.max(Number(nb_clients) || 8, 3), 20)
    const maintenant = new Date(`${date_tournee}T08:00:00Z`)
    const il_y_a_90j = new Date(maintenant.getTime() - 90 * 86400000).toISOString()
    const il_y_a_60j = new Date(maintenant.getTime() - 60 * 86400000).toISOString()
    const jour = (d: string) => Math.floor((maintenant.getTime() - new Date(d).getTime()) / 86400000)

    // Clients candidats : ceux attribués à ce commercial + ceux sans commercial attribué.
    const { data: clientsBruts } = await supabase
      .from('clients')
      .select('id, nom, ville, adresse, segment, limite_credit, latitude, longitude, commercial_id')
      .eq('entreprise_id', entrepriseId)
      .eq('actif', true)
      .or(`commercial_id.eq.${commercial_id},commercial_id.is.null`)
    const clients = clientsBruts || []
    if (clients.length === 0) return reponseErreur('Aucun client disponible pour ce commercial.', 404)
    const ids = clients.map((c) => c.id)

    // Clients déjà prévus ce jour-là dans la tournée d'un autre commercial.
    const { data: tourneesDuJour } = await supabase
      .from('tournees')
      .select('id, tournee_lignes(client_id)')
      .eq('entreprise_id', entrepriseId)
      .eq('date_tournee', date_tournee)
      .neq('commercial_id', commercial_id)
    const dejaPrevus = new Set<string>()
    ;(tourneesDuJour || []).forEach((tr: any) => (tr.tournee_lignes || []).forEach((l: any) => dejaPrevus.add(l.client_id)))

    const [{ data: visites }, { data: ventes }, { data: credits }, { data: releves }] = await Promise.all([
      supabase.from('rapports_visite').select('client_id, created_at').eq('entreprise_id', entrepriseId)
        .in('client_id', ids).order('created_at', { ascending: false }),
      supabase.from('ventes').select('client_id, total, created_at').eq('entreprise_id', entrepriseId)
        .in('client_id', ids).gte('created_at', il_y_a_90j),
      supabase.from('ventes').select('client_id, total, montant_regle, date_echeance').eq('entreprise_id', entrepriseId)
        .in('client_id', ids).eq('mode_paiement', 'credit'),
      supabase.from('rapport_visite_produits')
        .select('quantite_rayon, quantite_reserve, produits(nom), rapports_visite!inner(id, client_id, created_at)')
        .eq('entreprise_id', entrepriseId)
        .gte('rapports_visite.created_at', il_y_a_60j),
    ])

    const derniereVisite: Record<string, string> = {}
    ;(visites || []).forEach((v) => { if (!derniereVisite[v.client_id]) derniereVisite[v.client_id] = v.created_at })

    const ventesParClient: Record<string, { nb: number; total: number; derniere: string | null }> = {}
    ;(ventes || []).forEach((v) => {
      const g = (ventesParClient[v.client_id] ||= { nb: 0, total: 0, derniere: null })
      g.nb += 1
      g.total += Number(v.total || 0)
      if (!g.derniere || v.created_at > g.derniere) g.derniere = v.created_at
    })

    const aujourdHui = date_tournee
    const creanceParClient: Record<string, { du: number; echu: number }> = {}
    ;(credits || []).forEach((v) => {
      const reste = Number(v.total || 0) - Number(v.montant_regle || 0)
      if (reste <= 0) return
      const g = (creanceParClient[v.client_id] ||= { du: 0, echu: 0 })
      g.du += reste
      if (v.date_echeance && v.date_echeance < aujourdHui) g.echu += reste
    })

    // Dernier relevé de stock par client : produits presque épuisés en rayon.
    const dernierRapport: Record<string, { id: string; date: string }> = {}
    ;(releves || []).forEach((l: any) => {
      const r = l.rapports_visite
      if (!r) return
      if (!dernierRapport[r.client_id] || r.created_at > dernierRapport[r.client_id].date) {
        dernierRapport[r.client_id] = { id: r.id, date: r.created_at }
      }
    })
    const stockBas: Record<string, string[]> = {}
    ;(releves || []).forEach((l: any) => {
      const r = l.rapports_visite
      if (!r || dernierRapport[r.client_id]?.id !== r.id) return
      const total = Number(l.quantite_rayon || 0) + Number(l.quantite_reserve || 0)
      if (total <= 3 && l.produits?.nom) (stockBas[r.client_id] ||= []).push(`${l.produits.nom} (${total})`)
    })

    const candidats = clients
      .filter((c) => !dejaPrevus.has(c.id))
      .map((c) => {
        const v = ventesParClient[c.id]
        const cr = creanceParClient[c.id]
        return {
          client_id: c.id,
          nom: c.nom,
          ville: c.ville || null,
          quartier_adresse: c.adresse || null,
          attribue_a_ce_commercial: c.commercial_id === commercial_id,
          gps_connu: c.latitude != null && c.longitude != null,
          segment: c.segment || null,
          jours_depuis_derniere_visite: derniereVisite[c.id] ? jour(derniereVisite[c.id]) : null,
          achats_90j_nombre: v?.nb || 0,
          achats_90j_montant: Math.round(v?.total || 0),
          jours_depuis_dernier_achat: v?.derniere ? jour(v.derniere) : null,
          creance_due: Math.round(cr?.du || 0),
          creance_echue: Math.round(cr?.echu || 0),
          produits_stock_bas_derniere_visite: stockBas[c.id] || [],
        }
      })
      // Pré-tri simple pour limiter la taille envoyée à l'IA.
      .sort((a, b) => score(b) - score(a))
      .slice(0, 120)

    if (candidats.length === 0) return reponseErreur('Tous les clients disponibles sont déjà prévus ce jour-là.', 404)

    const nomLangue = LANGUES[langue] || LANGUES.fr
    const systemPrompt = `Tu es chef des ventes dans une entreprise de distribution en Côte d'Ivoire.
Tu prépares la tournée du ${date_tournee} du commercial « ${commercial.nom} »${commercial.zone ? ` (zone : ${commercial.zone})` : ''}.
Choisis EXACTEMENT ${Math.min(nombre, candidats.length)} clients parmi la liste fournie, en priorisant :
1. les stocks bas relevés à la dernière visite (risque de rupture = vente à faire) ;
2. les créances échues à relancer ;
3. les bons clients qui n'ont pas été visités ou n'ont pas acheté depuis longtemps ;
4. les clients jamais visités mais attribués à ce commercial ;
5. la cohérence géographique : regroupe des clients d'une même ville/quartier pour limiter les déplacements.
Préfère les clients dont le GPS est connu (la visite est validée par GPS).
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni balises Markdown, de la forme :
{"synthese": "2 phrases maximum expliquant la logique de la tournée", "clients": [{"client_id": "...", "raison": "raison courte et concrète, chiffres à l'appui"}]}
Rédige "synthese" et chaque "raison" en ${nomLangue}. Utilise uniquement les client_id fournis. N'invente aucun chiffre.`

    const reponseClaude = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: JSON.stringify(candidats) }],
      }),
    })
    if (!reponseClaude.ok) {
      const detail = await reponseClaude.text()
      return reponseErreur(`Erreur API Anthropic (${reponseClaude.status}) : ${detail}`, 502)
    }
    const resultat = await reponseClaude.json()
    const texte = (resultat.content || []).map((b: any) => (b.type === 'text' ? b.text : '')).join('')
    let proposition: any
    try {
      proposition = JSON.parse(texte.replace(/```json|```/g, '').trim())
    } catch {
      return reponseErreur("Réponse de l'IA illisible, réessayez.", 502)
    }

    // On ne garde que des identifiants réellement candidats, sans doublon.
    const idsValides = new Set(candidats.map((c) => c.client_id))
    const vus = new Set<string>()
    const nomsParId = Object.fromEntries(candidats.map((c) => [c.client_id, c.nom]))
    const clientsProposes = (proposition.clients || [])
      .filter((c: any) => idsValides.has(c.client_id) && !vus.has(c.client_id) && vus.add(c.client_id))
      .map((c: any) => ({ client_id: c.client_id, nom: nomsParId[c.client_id], raison: String(c.raison || '').slice(0, 300) }))

    return new Response(JSON.stringify({ synthese: proposition.synthese || '', clients: clientsProposes }), {
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  } catch (err) {
    return reponseErreur(`Erreur inattendue : ${(err as Error).message}`, 500)
  }
})

function score(c: any) {
  let s = 0
  s += c.produits_stock_bas_derniere_visite.length * 30
  if (c.creance_echue > 0) s += 25
  if (c.jours_depuis_derniere_visite === null) s += c.attribue_a_ce_commercial ? 20 : 5
  else s += Math.min(c.jours_depuis_derniere_visite, 60) / 2
  s += Math.min(c.achats_90j_nombre, 10) * 2
  if (!c.gps_connu) s -= 15
  return s
}

function reponseErreur(message: string, statut: number) {
  return new Response(JSON.stringify({ erreur: message }), {
    status: statut,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}
