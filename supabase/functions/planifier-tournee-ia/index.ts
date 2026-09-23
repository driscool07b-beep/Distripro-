// supabase/functions/planifier-tournee-ia/index.ts
// Edge Function : propose le planning des tournées d'un commercial sur une
// période (1 jour à 1 mois), à partir de son portefeuille client et d'un
// objectif de visites par jour. L'IA décide qui visiter et à quelle
// fréquence (avec la raison) ; la répartition jour par jour est ensuite
// calculée ici en regroupant les clients proches géographiquement.
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

    const { commercial_id, date_debut, duree_jours, visites_par_jour, inclure_dimanche, consignes, langue } = await req.json()
    if (!commercial_id || !date_debut) return reponseErreur('commercial_id et date_debut sont requis.', 400)

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

    const parJour = Math.min(Math.max(Number(visites_par_jour) || 8, 1), 30)
    const duree = Math.min(Math.max(Number(duree_jours) || 1, 1), 31)

    // Jours de travail de la période (dimanche exclu sauf demande), en
    // écartant les dates où ce commercial a déjà une tournée.
    const { data: tourneesExistantes } = await supabase
      .from('tournees').select('date_tournee').eq('commercial_id', commercial_id).gte('date_tournee', date_debut)
    const datesPrises = new Set((tourneesExistantes || []).map((t) => t.date_tournee))
    const dates: string[] = []
    const datesIgnorees: string[] = []
    for (let i = 0; i < duree; i++) {
      const d = new Date(`${date_debut}T12:00:00Z`)
      d.setUTCDate(d.getUTCDate() + i)
      const iso = d.toISOString().split('T')[0]
      if (d.getUTCDay() === 0 && !inclure_dimanche) continue
      if (datesPrises.has(iso)) { datesIgnorees.push(iso); continue }
      dates.push(iso)
    }
    if (dates.length === 0) return reponseErreur('Aucun jour disponible sur cette période (tournées déjà programmées).', 400)
    const capacite = dates.length * parJour

    const reference = new Date(`${date_debut}T08:00:00Z`)
    const il_y_a_90j = new Date(reference.getTime() - 90 * 86400000).toISOString()
    const il_y_a_60j = new Date(reference.getTime() - 60 * 86400000).toISOString()
    const jour = (d: string) => Math.floor((reference.getTime() - new Date(d).getTime()) / 86400000)

    // Portefeuille du commercial uniquement.
    const { data: clientsBruts } = await supabase
      .from('clients')
      .select('id, nom, ville, adresse, segment, limite_credit, latitude, longitude')
      .eq('entreprise_id', entrepriseId)
      .eq('actif', true)
      .eq('commercial_id', commercial_id)
    const clients = clientsBruts || []
    if (clients.length === 0) {
      return reponseErreur("Le portefeuille de ce commercial est vide : attribuez-lui des clients dans la page Clients.", 404)
    }
    const ids = clients.map((c) => c.id)

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

    const creanceParClient: Record<string, { du: number; echu: number }> = {}
    ;(credits || []).forEach((v) => {
      const reste = Number(v.total || 0) - Number(v.montant_regle || 0)
      if (reste <= 0) return
      const g = (creanceParClient[v.client_id] ||= { du: 0, echu: 0 })
      g.du += reste
      if (v.date_echeance && v.date_echeance < date_debut) g.echu += reste
    })

    const dernierRapport: Record<string, { id: string; date: string }> = {}
    ;(releves || []).forEach((l: any) => {
      const r = l.rapports_visite
      if (!r || !ids.includes(r.client_id)) return
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
      .map((c) => {
        const v = ventesParClient[c.id]
        const cr = creanceParClient[c.id]
        return {
          client_id: c.id,
          nom: c.nom,
          ville: c.ville || null,
          quartier_adresse: c.adresse || null,
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
      .sort((a, b) => score(b) - score(a))
      .slice(0, 200)

    const nomLangue = LANGUES[langue] || LANGUES.fr
    const consignesTexte = typeof consignes === 'string' && consignes.trim()
      ? `\nConsignes du responsable (à respecter en priorité) : « ${consignes.trim().slice(0, 500)} »`
      : ''
    const systemPrompt = `Tu es chef des ventes dans une entreprise de distribution en Côte d'Ivoire.
Tu planifies les visites du commercial « ${commercial.nom} »${commercial.zone ? ` (zone : ${commercial.zone})` : ''} sur ${dates.length} jour(s) de travail à partir du ${date_debut}, avec un objectif de ${parJour} visites par jour, soit une capacité totale de ${capacite} visites.
Pour chaque client de son portefeuille, décide combien de fois le visiter sur la période (0 = pas cette fois, maximum ${dates.length}), en t'appuyant sur les données :
- stocks bas relevés à la dernière visite, créances échues et gros acheteurs réguliers → visites plus fréquentes ;
- clients jamais visités ou pas visités depuis longtemps → au moins une visite ;
- petits clients récemment visités et sans enjeu → moins souvent.
Le total des visites doit se rapprocher de ${capacite} sans le dépasser.${consignesTexte}
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni balises Markdown :
{"synthese": "2 à 3 phrases expliquant la logique du planning", "clients": [{"client_id": "...", "visites": 1, "priorite": 3, "raison": "raison courte et concrète (15 mots max), chiffres à l'appui"}]}
"priorite" va de 1 (faible) à 5 (urgent). N'inclus pas les clients à 0 visite. Rédige "synthese" et "raison" en ${nomLangue}. Utilise uniquement les client_id fournis. N'invente aucun chiffre.`

    const reponseClaude = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 8000,
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

    // --- Répartition des visites jour par jour (calcul, pas IA) -------------
    const infos = Object.fromEntries(clients.map((c) => [c.id, c]))
    const vus = new Set<string>()
    const choix = (proposition.clients || [])
      .filter((c: any) => infos[c.client_id] && !vus.has(c.client_id) && vus.add(c.client_id))
      .map((c: any) => {
        const n = Math.min(Math.max(Math.round(Number(c.visites) || 1), 1), dates.length)
        return {
          id: c.client_id as string,
          priorite: Math.min(Math.max(Number(c.priorite) || 3, 1), 5),
          raison: String(c.raison || '').slice(0, 200),
          restantes: n,
          intervalle: Math.max(1, Math.floor(dates.length / n)),
          prochainJour: 0,
        }
      })

    const distance = (a: any, b: any) => {
      if (a.latitude == null || b.latitude == null) return a.ville && a.ville === b.ville ? 3000 : 50000
      const R = 6371000, rad = Math.PI / 180
      const dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2
      return 2 * R * Math.asin(Math.sqrt(h))
    }

    const jours: any[] = []
    dates.forEach((date, indexJour) => {
      const eligibles = choix.filter((c) => c.restantes > 0 && c.prochainJour <= indexJour)
      if (eligibles.length === 0) return
      // Point de départ : le plus prioritaire (puis celui qui a le plus de visites restantes).
      eligibles.sort((a, b) => b.priorite - a.priorite || b.restantes - a.restantes)
      const duJour = [eligibles.shift()!]
      // Puis on complète avec les clients éligibles les plus proches du groupe du jour,
      // en favorisant légèrement les plus prioritaires.
      while (duJour.length < parJour && eligibles.length > 0) {
        let meilleur = 0, meilleurCout = Infinity
        eligibles.forEach((c, i) => {
          const d = Math.min(...duJour.map((x) => distance(infos[x.id], infos[c.id])))
          const cout = d * (1 - (c.priorite - 1) * 0.1)
          if (cout < meilleurCout) { meilleurCout = cout; meilleur = i }
        })
        duJour.push(eligibles.splice(meilleur, 1)[0])
      }
      duJour.forEach((c) => { c.restantes -= 1; c.prochainJour = indexJour + c.intervalle })
      jours.push({
        date,
        clients: duJour.map((c) => ({ client_id: c.id, nom: infos[c.id].nom, raison: c.raison })),
      })
    })
    const nonPlanifiees = choix.reduce((s, c) => s + c.restantes, 0)

    return new Response(JSON.stringify({
      synthese: proposition.synthese || '',
      jours,
      dates_ignorees: datesIgnorees,
      visites_non_planifiees: nonPlanifiees,
    }), { headers: { ...CORS_HEADERS, 'content-type': 'application/json' } })
  } catch (err) {
    return reponseErreur(`Erreur inattendue : ${(err as Error).message}`, 500)
  }
})

function score(c: any) {
  let s = 0
  s += c.produits_stock_bas_derniere_visite.length * 30
  if (c.creance_echue > 0) s += 25
  if (c.jours_depuis_derniere_visite === null) s += 20
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
