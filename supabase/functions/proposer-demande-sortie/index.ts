// supabase/functions/proposer-demande-sortie/index.ts
// Edge Function : propose au commercial les produits et quantités à demander
// au magasin pour sa tournée, à partir de :
//   - les clients de sa tournée à la date souhaitée (sinon ses clients actifs),
//   - le stock relevé chez ces clients à la dernière visite (rayon + réserve),
//   - leurs achats des 90 derniers jours par produit,
//   - ses propres ventes des 30 derniers jours,
//   - son stock en main et le stock disponible au magasin.
// L'IA décide des quantités (avec la raison) ; les quantités sont ensuite
// contrôlées ici (produits de l'entreprise, plafond = stock du magasin).
// Ne crée RIEN : la proposition est renvoyée à l'écran, le commercial la
// modifie puis l'envoie (RPC creer_demande_sortie).
// Secrets : ANTHROPIC_API_KEY.
// Déploiement : supabase functions deploy proposer-demande-sortie

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LANGUES: Record<string, string> = { fr: 'français', en: 'English', ar: 'العربية', zh: '中文' }
const MODELE = 'claude-sonnet-5'

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
      .select('id, nom, role, zone, entreprise_id, actif, ia_active')
      .eq('id', userData.user.id)
      .single()
    if (!appelant || appelant.actif === false) return reponseErreur('Compte introuvable ou désactivé.', 403)
    if (appelant.ia_active === false) return reponseErreur("Les fonctions IA sont désactivées pour votre compte.", 403)
    if (appelant.role !== 'commercial') return reponseErreur('Seul un commercial peut préparer une demande de sortie.', 403)

    const { depot_id, date_souhaitee, consignes, langue } = await req.json()
    if (!depot_id || !/^\d{4}-\d{2}-\d{2}$/.test(String(date_souhaitee || ''))) {
      return reponseErreur('depot_id et date_souhaitee (AAAA-MM-JJ) sont requis.', 400)
    }

    const entrepriseId = appelant.entreprise_id
    const { data: soldeIa } = await supabase.rpc('ia_solde_disponible', { p_entreprise_id: entrepriseId })
    if (soldeIa != null && Number(soldeIa) <= 0) return reponseErreur("Crédit IA épuisé : rechargez vos unités IA (Paramètres → Mon abonnement) pour continuer à utiliser l'IA.", 402)

    const { data: depot } = await supabase.from('depots').select('id, nom')
      .eq('id', depot_id).eq('entreprise_id', entrepriseId).maybeSingle()
    if (!depot) return reponseErreur('Magasin introuvable.', 404)

    const reference = new Date(`${date_souhaitee}T08:00:00Z`)
    const il_y_a_90j = new Date(reference.getTime() - 90 * 86400000).toISOString()
    const il_y_a_30j = new Date(reference.getTime() - 30 * 86400000).toISOString()
    const il_y_a_60j = new Date(reference.getTime() - 60 * 86400000).toISOString()

    // --- Clients à servir : la tournée du jour souhaité, sinon le portefeuille
    const { data: tournees } = await supabase.from('tournees').select('id')
      .eq('entreprise_id', entrepriseId).eq('commercial_id', appelant.id).eq('date_tournee', date_souhaitee)
    let clientIds: string[] = []
    let source = 'tournee'
    if (tournees?.length) {
      const { data: lignes } = await supabase.from('tournee_lignes').select('client_id')
        .in('tournee_id', tournees.map((t) => t.id))
      clientIds = [...new Set((lignes || []).map((l) => l.client_id))]
    }
    if (clientIds.length === 0) {
      source = 'portefeuille'
      const { data: portefeuille } = await supabase.from('clients').select('id')
        .eq('entreprise_id', entrepriseId).eq('commercial_id', appelant.id).eq('actif', true).limit(150)
      clientIds = (portefeuille || []).map((c) => c.id)
    }

    const [{ data: produits }, { data: stockMagasin }, { data: enMain }, { data: mesVentes }, { data: ventesClients }, { data: releves }, { data: clients }] = await Promise.all([
      supabase.from('produits').select('id, nom, reference, unite').eq('entreprise_id', entrepriseId).eq('actif', true),
      supabase.from('stocks').select('produit_id, quantite').eq('entreprise_id', entrepriseId).eq('depot_id', depot_id),
      supabase.from('stock_commercial').select('produit_id, quantite').eq('commercial_id', appelant.id),
      supabase.from('ventes').select('created_at, ventes_lignes(produit_id, quantite)')
        .eq('entreprise_id', entrepriseId).eq('created_by', appelant.id).gte('created_at', il_y_a_30j),
      clientIds.length
        ? supabase.from('ventes').select('client_id, created_at, ventes_lignes(produit_id, quantite)')
          .eq('entreprise_id', entrepriseId).in('client_id', clientIds).gte('created_at', il_y_a_90j)
        : Promise.resolve({ data: [] }),
      clientIds.length
        ? supabase.from('rapport_visite_produits')
          .select('produit_id, quantite_rayon, quantite_reserve, rapports_visite!inner(id, client_id, created_at)')
          .eq('entreprise_id', entrepriseId).in('rapports_visite.client_id', clientIds)
          .gte('rapports_visite.created_at', il_y_a_60j)
        : Promise.resolve({ data: [] }),
      clientIds.length
        ? supabase.from('clients').select('id, nom').in('id', clientIds)
        : Promise.resolve({ data: [] }),
    ])

    const catalogue = Object.fromEntries((produits || []).map((p) => [p.id, p]))
    if (!Object.keys(catalogue).length) return reponseErreur('Aucun produit actif dans le catalogue.', 404)
    const dispo: Record<string, number> = Object.fromEntries((stockMagasin || []).map((s) => [s.produit_id, Number(s.quantite)]))
    const main: Record<string, number> = Object.fromEntries((enMain || []).map((s) => [s.produit_id, Number(s.quantite)]))

    // Ses ventes des 30 derniers jours, par produit (et nombre de jours actifs)
    const joursActifs = new Set<string>()
    const vendu30j: Record<string, number> = {}
    ;(mesVentes || []).forEach((v: any) => {
      joursActifs.add(String(v.created_at).slice(0, 10))
      ;(v.ventes_lignes || []).forEach((l: any) => { vendu30j[l.produit_id] = (vendu30j[l.produit_id] || 0) + Number(l.quantite || 0) })
    })

    // Achats habituels des clients à servir
    const achatsClients: Record<string, { quantite: number; achats: number }> = {}
    ;(ventesClients || []).forEach((v: any) => {
      ;(v.ventes_lignes || []).forEach((l: any) => {
        const g = (achatsClients[l.produit_id] ||= { quantite: 0, achats: 0 })
        g.quantite += Number(l.quantite || 0)
        g.achats += 1
      })
    })

    // Stock relevé chez chaque client à sa dernière visite
    const dernier: Record<string, { id: string; date: string }> = {}
    ;(releves || []).forEach((l: any) => {
      const r = l.rapports_visite
      if (r && (!dernier[r.client_id] || r.created_at > dernier[r.client_id].date)) dernier[r.client_id] = { id: r.id, date: r.created_at }
    })
    const stockChezClients: Record<string, { total: number; clients_bas: number }> = {}
    ;(releves || []).forEach((l: any) => {
      const r = l.rapports_visite
      if (!r || dernier[r.client_id]?.id !== r.id) return
      const total = Number(l.quantite_rayon || 0) + Number(l.quantite_reserve || 0)
      const g = (stockChezClients[l.produit_id] ||= { total: 0, clients_bas: 0 })
      g.total += total
      if (total <= 3) g.clients_bas += 1
    })

    const donnees = Object.values(catalogue).map((p: any) => ({
      produit_id: p.id,
      nom: p.nom,
      unite: p.unite || null,
      disponible_magasin: dispo[p.id] ?? 0,
      deja_en_main: main[p.id] ?? 0,
      mes_ventes_30j: vendu30j[p.id] ?? 0,
      achats_90j_clients_a_servir: achatsClients[p.id]?.quantite ?? 0,
      nombre_achats_90j_clients_a_servir: achatsClients[p.id]?.achats ?? 0,
      stock_total_chez_clients_derniere_visite: stockChezClients[p.id]?.total ?? null,
      clients_en_stock_bas: stockChezClients[p.id]?.clients_bas ?? 0,
    })).filter((d) => d.disponible_magasin > 0 || d.mes_ventes_30j > 0 || d.achats_90j_clients_a_servir > 0)

    if (!donnees.length) {
      return reponseErreur("Pas assez d'historique pour proposer une demande : saisissez-la vous-même cette fois.", 404)
    }

    const nomLangue = LANGUES[langue] || LANGUES.fr
    const consignesTexte = typeof consignes === 'string' && consignes.trim()
      ? `\nConsignes du commercial (à respecter en priorité) : « ${consignes.trim().slice(0, 300)} »`
      : ''
    const contexte = source === 'tournee'
      ? `sa tournée du ${date_souhaitee} compte ${clientIds.length} client(s)`
      : `il n'a pas de tournée programmée le ${date_souhaitee} : base-toi sur ses ${clientIds.length} client(s) actifs et sur son rythme de vente`
    const systemPrompt = `Tu es chef des ventes dans une entreprise de distribution en Côte d'Ivoire.
Le commercial « ${appelant.nom} »${appelant.zone ? ` (zone : ${appelant.zone})` : ''} prépare sa demande de produits au magasin « ${depot.nom} » ; ${contexte}.
Il a ${joursActifs.size} jour(s) de vente sur les 30 derniers jours.
Pour chaque produit, décide la quantité à demander pour UNE journée de tournée :
- estime ce qu'il va vendre (ses ventes moyennes par jour actif, les achats habituels de ces clients, les clients en stock bas à la dernière visite) ;
- retire ce qu'il a déjà en main ;
- ajoute une petite marge de sécurité, sans surcharger (la marchandise non vendue doit être rapportée) ;
- ne dépasse jamais « disponible_magasin » ;
- n'inclus pas les produits à 0.${consignesTexte}
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni balises Markdown :
{"synthese": "2 phrases maximum expliquant la logique", "lignes": [{"produit_id": "...", "quantite": 12, "raison": "raison courte et concrète (12 mots max), chiffres à l'appui"}]}
Rédige "synthese" et "raison" en ${nomLangue}. Utilise uniquement les produit_id fournis. N'invente aucun chiffre.`

    const reponseClaude = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: 'user', content: JSON.stringify(donnees.slice(0, 150)) }],
      }),
    })
    if (!reponseClaude.ok) {
      const detail = await reponseClaude.text()
      return reponseErreur(`Erreur API Anthropic (${reponseClaude.status}) : ${detail}`, 502)
    }
    const resultat = await reponseClaude.json()
    await enregistrerConsommation(supabase, { entrepriseId, profilId: appelant.id, fonction: 'demande_sortie', modele: MODELE, usage: resultat.usage })

    const texte = (resultat.content || []).map((b: any) => (b.type === 'text' ? b.text : '')).join('')
    let proposition: any
    try {
      proposition = JSON.parse(texte.replace(/```json|```/g, '').trim())
    } catch {
      return reponseErreur("Réponse de l'IA illisible, réessayez.", 502)
    }

    // --- Contrôle des quantités (calcul, pas IA) --------------------------
    const vus = new Set<string>()
    const lignes = (proposition.lignes || [])
      .filter((l: any) => catalogue[l.produit_id] && !vus.has(l.produit_id) && vus.add(l.produit_id))
      .map((l: any) => {
        const max = dispo[l.produit_id] ?? 0
        const quantite = Math.min(Math.max(Math.round(Number(l.quantite) || 0), 0), max)
        return {
          produit_id: l.produit_id,
          nom: catalogue[l.produit_id].nom,
          reference: catalogue[l.produit_id].reference || null,
          quantite,
          disponible: max,
          en_main: main[l.produit_id] ?? 0,
          raison: String(l.raison || '').slice(0, 200),
        }
      })
      .filter((l: any) => l.quantite > 0)

    return new Response(JSON.stringify({
      synthese: String(proposition.synthese || '').slice(0, 600),
      source,
      nb_clients: clientIds.length,
      noms_clients: (clients || []).slice(0, 8).map((c: any) => c.nom),
      lignes,
    }), { headers: { ...CORS_HEADERS, 'content-type': 'application/json' } })
  } catch (err) {
    return reponseErreur(`Erreur inattendue : ${(err as Error).message}`, 500)
  }
})

function reponseErreur(message: string, statut: number) {
  return new Response(JSON.stringify({ erreur: message }), {
    status: statut,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}

// Enregistre la consommation réelle d'un appel IA (tokens renvoyés par Anthropic)
// et son coût au tarif en vigueur. Ne bloque jamais la réponse en cas d'échec.
async function enregistrerConsommation(supabase: any, p: {
  entrepriseId: string; profilId: string; fonction: string; modele: string; usage: any
}) {
  try {
    const entree = Number(p.usage?.input_tokens || 0) + Number(p.usage?.cache_creation_input_tokens || 0) + Number(p.usage?.cache_read_input_tokens || 0)
    const sortie = Number(p.usage?.output_tokens || 0)
    const { data: tarif } = await supabase.from('tarifs_ia').select('*').eq('modele', p.modele).maybeSingle()
    const cout = tarif
      ? (entree * Number(tarif.prix_entree_usd_par_million) + sortie * Number(tarif.prix_sortie_usd_par_million)) / 1_000_000
      : 0
    await supabase.from('consommation_ia').insert({
      entreprise_id: p.entrepriseId, profil_id: p.profilId, fonction: p.fonction,
      modele: p.modele, tokens_entree: entree, tokens_sortie: sortie, cout_usd: cout,
    })
  } catch (_) { /* la mesure ne doit jamais faire échouer l'appel */ }
}
