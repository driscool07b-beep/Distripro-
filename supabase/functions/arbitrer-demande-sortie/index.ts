// supabase/functions/arbitrer-demande-sortie/index.ts
// Edge Function : aide le gestionnaire de stock (ou admin/manager) à décider
// combien accorder sur une demande de sortie d'un commercial. L'IA tient compte :
//   - du stock disponible au magasin choisi,
//   - des autres demandes en attente sur les mêmes produits (partage équitable),
//   - des commandes clients non livrées (stock à garder),
//   - du stock déjà en main du commercial,
//   - de ses ventes des 30 derniers jours et de son taux de retour
//     (marchandise sortie puis rapportée invendue).
// Ne crée RIEN : la proposition pré-remplit l'écran de traitement ; le
// gestionnaire ajuste puis accorde (RPC traiter_demande_sortie).
// Secrets : ANTHROPIC_API_KEY.
// Déploiement : supabase functions deploy arbitrer-demande-sortie

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
      .select('id, role, entreprise_id, actif, ia_active')
      .eq('id', userData.user.id)
      .single()
    if (!appelant || appelant.actif === false) return reponseErreur('Compte introuvable ou désactivé.', 403)
    if (appelant.ia_active === false) return reponseErreur("Les fonctions IA sont désactivées pour votre compte.", 403)
    if (!['admin', 'manager', 'gestionnaire_stock'].includes(appelant.role)) {
      return reponseErreur('Seuls le gestionnaire de stock, un manager ou un admin peuvent arbitrer une demande.', 403)
    }

    const { demande_id, depot_id, langue } = await req.json()
    if (!demande_id) return reponseErreur('demande_id est requis.', 400)

    const entrepriseId = appelant.entreprise_id
    const { data: soldeIa } = await supabase.rpc('ia_solde_disponible', { p_entreprise_id: entrepriseId })
    if (soldeIa != null && Number(soldeIa) <= 0) return reponseErreur("Crédit IA épuisé : rechargez vos unités IA (Paramètres → Mon abonnement) pour continuer à utiliser l'IA.", 402)

    const { data: demande } = await supabase.from('demandes_sortie')
      .select('id, numero, statut, commercial_id, depot_id, date_souhaitee, commentaire, synthese_ia, commercial:profils!commercial_id(nom, zone), demande_sortie_lignes(id, produit_id, quantite_demandee, raison_ia, produits(nom, unite))')
      .eq('id', demande_id).eq('entreprise_id', entrepriseId).maybeSingle()
    if (!demande) return reponseErreur('Demande introuvable.', 404)
    if (demande.statut !== 'en_attente') return reponseErreur('Cette demande a déjà été traitée.', 409)

    const depotId = depot_id || demande.depot_id
    const { data: depot } = await supabase.from('depots').select('id, nom')
      .eq('id', depotId).eq('entreprise_id', entrepriseId).maybeSingle()
    if (!depot) return reponseErreur('Magasin introuvable.', 404)
    if (appelant.role === 'gestionnaire_stock') {
      const { data: autorise } = await supabase.from('gestionnaire_depots').select('id')
        .eq('profil_id', appelant.id).eq('depot_id', depotId).maybeSingle()
      if (!autorise) return reponseErreur("Ce magasin ne vous est pas attribué.", 403)
    }

    const lignesDemande = demande.demande_sortie_lignes || []
    const produitIds = lignesDemande.map((l: any) => l.produit_id)
    if (!produitIds.length) return reponseErreur('La demande ne contient aucun article.', 400)
    const il_y_a_30j = new Date(Date.now() - 30 * 86400000).toISOString()

    const [{ data: stockMagasin }, { data: autres }, { data: commandes }, { data: enMain }, { data: ventes }, { data: sorties }] = await Promise.all([
      supabase.from('stocks').select('produit_id, quantite').eq('entreprise_id', entrepriseId).eq('depot_id', depotId).in('produit_id', produitIds),
      supabase.from('demandes_sortie')
        .select('id, date_souhaitee, created_at, commercial:profils!commercial_id(nom), demande_sortie_lignes(produit_id, quantite_demandee)')
        .eq('entreprise_id', entrepriseId).eq('depot_id', depotId).eq('statut', 'en_attente').neq('id', demande.id),
      supabase.from('commandes').select('id, date_livraison_souhaitee, commande_lignes(produit_id, quantite_commandee)')
        .eq('entreprise_id', entrepriseId).in('statut', ['recue', 'confirmee', 'en_preparation']),
      supabase.from('stock_commercial').select('produit_id, quantite').eq('commercial_id', demande.commercial_id).in('produit_id', produitIds),
      supabase.from('ventes').select('created_at, ventes_lignes(produit_id, quantite)')
        .eq('entreprise_id', entrepriseId).eq('created_by', demande.commercial_id).gte('created_at', il_y_a_30j),
      supabase.from('sorties_stock').select('statut, sortie_stock_lignes(produit_id, quantite_sortie, quantite_retournee)')
        .eq('entreprise_id', entrepriseId).eq('commercial_id', demande.commercial_id).eq('statut', 'cloturee').gte('created_at', il_y_a_30j),
    ])

    const dispo: Record<string, number> = Object.fromEntries((stockMagasin || []).map((s: any) => [s.produit_id, Number(s.quantite)]))
    const main: Record<string, number> = Object.fromEntries((enMain || []).map((s: any) => [s.produit_id, Number(s.quantite)]))

    const autresDemandes: Record<string, { quantite: number; demandes: number }> = {}
    ;(autres || []).forEach((d: any) => (d.demande_sortie_lignes || []).forEach((l: any) => {
      if (!produitIds.includes(l.produit_id)) return
      const g = (autresDemandes[l.produit_id] ||= { quantite: 0, demandes: 0 })
      g.quantite += Number(l.quantite_demandee || 0)
      g.demandes += 1
    }))

    const commandesEnAttente: Record<string, number> = {}
    ;(commandes || []).forEach((c: any) => (c.commande_lignes || []).forEach((l: any) => {
      if (produitIds.includes(l.produit_id)) commandesEnAttente[l.produit_id] = (commandesEnAttente[l.produit_id] || 0) + Number(l.quantite_commandee || 0)
    }))

    const joursActifs = new Set<string>()
    const vendu30j: Record<string, number> = {}
    ;(ventes || []).forEach((v: any) => {
      joursActifs.add(String(v.created_at).slice(0, 10))
      ;(v.ventes_lignes || []).forEach((l: any) => { vendu30j[l.produit_id] = (vendu30j[l.produit_id] || 0) + Number(l.quantite || 0) })
    })

    const sorti30j: Record<string, number> = {}
    const retourne30j: Record<string, number> = {}
    ;(sorties || []).forEach((s: any) => (s.sortie_stock_lignes || []).forEach((l: any) => {
      sorti30j[l.produit_id] = (sorti30j[l.produit_id] || 0) + Number(l.quantite_sortie || 0)
      retourne30j[l.produit_id] = (retourne30j[l.produit_id] || 0) + Number(l.quantite_retournee || 0)
    }))

    const donnees = lignesDemande.map((l: any) => ({
      ligne_id: l.id,
      produit: l.produits?.nom,
      unite: l.produits?.unite || null,
      quantite_demandee: l.quantite_demandee,
      raison_du_commercial_ou_ia: l.raison_ia || null,
      disponible_magasin: dispo[l.produit_id] ?? 0,
      autres_demandes_en_attente: autresDemandes[l.produit_id]?.quantite ?? 0,
      nombre_autres_demandes: autresDemandes[l.produit_id]?.demandes ?? 0,
      commandes_clients_non_livrees: commandesEnAttente[l.produit_id] ?? 0,
      deja_en_main_du_commercial: main[l.produit_id] ?? 0,
      ventes_du_commercial_30j: vendu30j[l.produit_id] ?? 0,
      sorti_30j: sorti30j[l.produit_id] ?? 0,
      rapporte_invendu_30j: retourne30j[l.produit_id] ?? 0,
    }))

    const nomLangue = LANGUES[langue] || LANGUES.fr
    const systemPrompt = `Tu es responsable de magasin dans une entreprise de distribution en Côte d'Ivoire.
Le commercial « ${demande.commercial?.nom || '—'} » demande des produits au magasin « ${depot.nom} » pour le ${demande.date_souhaitee}.
Il a ${joursActifs.size} jour(s) de vente sur les 30 derniers jours.${demande.commentaire ? `\nSon commentaire : « ${String(demande.commentaire).slice(0, 300)} »` : ''}
Pour chaque ligne, propose la quantité à ACCORDER :
- jamais plus que « disponible_magasin » ni plus que la quantité demandée ;
- si le stock ne suffit pas pour toutes les demandes en attente et les commandes clients non livrées, partage équitablement et garde de quoi servir les commandes clients ;
- si le commercial a déjà beaucoup en main, ou rapporte souvent beaucoup d'invendus, réduis ;
- si la demande est cohérente avec ses ventes et le stock est suffisant, accorde la quantité demandée.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni balises Markdown :
{"synthese": "2 phrases maximum", "motif": "motif court à proposer si tu n'accordes pas tout, sinon chaîne vide", "lignes": [{"ligne_id": "...", "quantite_accordee": 10, "raison": "raison courte et concrète (12 mots max), chiffres à l'appui"}]}
Rédige "synthese", "motif" et "raison" en ${nomLangue}. Utilise uniquement les ligne_id fournis. N'invente aucun chiffre.`

    const reponseClaude = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: JSON.stringify(donnees) }],
      }),
    })
    if (!reponseClaude.ok) {
      const detail = await reponseClaude.text()
      return reponseErreur(`Erreur API Anthropic (${reponseClaude.status}) : ${detail}`, 502)
    }
    const resultat = await reponseClaude.json()
    await enregistrerConsommation(supabase, { entrepriseId, profilId: appelant.id, fonction: 'arbitrage_demande_sortie', modele: MODELE, usage: resultat.usage })

    const texte = (resultat.content || []).map((b: any) => (b.type === 'text' ? b.text : '')).join('')
    let proposition: any
    try {
      proposition = JSON.parse(texte.replace(/```json|```/g, '').trim())
    } catch {
      return reponseErreur("Réponse de l'IA illisible, réessayez.", 502)
    }

    // --- Contrôle des quantités (calcul, pas IA) ----------------------------
    const parLigne = Object.fromEntries(lignesDemande.map((l: any) => [l.id, l]))
    const lignes = (proposition.lignes || [])
      .filter((l: any) => parLigne[l.ligne_id])
      .map((l: any) => {
        const ligne = parLigne[l.ligne_id]
        const max = Math.min(ligne.quantite_demandee, dispo[ligne.produit_id] ?? 0)
        return {
          ligne_id: l.ligne_id,
          quantite_accordee: Math.min(Math.max(Math.round(Number(l.quantite_accordee) || 0), 0), max),
          raison: String(l.raison || '').slice(0, 200),
        }
      })

    return new Response(JSON.stringify({
      synthese: String(proposition.synthese || '').slice(0, 600),
      motif: String(proposition.motif || '').slice(0, 300),
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
