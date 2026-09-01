// supabase/functions/analyse-ia/index.ts
// Edge Function : génère une analyse stratégique des données commerciales via l'API Anthropic.
// À déployer via le tableau de bord Supabase (Edge Functions > Deploy a new function > Via Editor).
// Nécessite le secret ANTHROPIC_API_KEY (Edge Functions > Secrets).

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')

    if (!anthropicKey) {
      return reponseErreur("Clé ANTHROPIC_API_KEY non configurée dans les secrets de l'Edge Function.", 500)
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
      .select('id, nom, role, entreprise_id')
      .eq('id', userData.user.id)
      .single()

    if (!profil || !['admin', 'manager'].includes(profil.role)) {
      return reponseErreur('Accès réservé aux responsables commerciaux et à la direction.', 403)
    }

    const entrepriseId = profil.entreprise_id
    const { data: entreprise } = await supabase.from('entreprises').select('nom').eq('id', entrepriseId).single()

    const maintenant = new Date()
    const il_y_a_30j = new Date(maintenant.getTime() - 30 * 86400000).toISOString()
    const il_y_a_60j = new Date(maintenant.getTime() - 60 * 86400000).toISOString()

    const { data: ruptures } = await supabase
      .from('stocks')
      .select('quantite, produits(nom, seuil_alerte)')
      .eq('entreprise_id', entrepriseId)

    const rupturesListe = (ruptures || [])
      .filter((s) => s.produits && s.quantite <= (s.produits.seuil_alerte ?? 0))
      .map((s) => ({ produit: s.produits.nom, stock: s.quantite, seuil: s.produits.seuil_alerte }))

    const { data: ventesRecentes } = await supabase
      .from('ventes')
      .select('total, created_at, clients(ville)')
      .eq('entreprise_id', entrepriseId)
      .gte('created_at', il_y_a_30j)

    const { data: ventesPeriodePrecedente } = await supabase
      .from('ventes')
      .select('total, clients(ville)')
      .eq('entreprise_id', entrepriseId)
      .gte('created_at', il_y_a_60j)
      .lt('created_at', il_y_a_30j)

    const agregerVentesParVille = (lignes) => {
      const groupes = {}
      ;(lignes || []).forEach((v) => {
        const ville = v.clients?.ville || 'Non précisée'
        if (!groupes[ville]) groupes[ville] = { ville, total: 0, nb: 0 }
        groupes[ville].total += Number(v.total || 0)
        groupes[ville].nb += 1
      })
      return Object.values(groupes)
    }

    const ventesParVilleRecent = agregerVentesParVille(ventesRecentes)
    const ventesParVillePrecedent = agregerVentesParVille(ventesPeriodePrecedente)

    const { data: relevesRecents } = await supabase
      .from('rapport_visite_produits')
      .select('produit_id, quantite_rayon, produits(nom), rapports_visite(created_at)')
      .eq('entreprise_id', entrepriseId)
      .gte('rapports_visite.created_at', il_y_a_60j)

    const agregerRelevesMoyens = (dateDebut, dateFin) => {
      const groupes = {}
      ;(relevesRecents || []).forEach((l) => {
        const dateReleve = l.rapports_visite?.created_at
        if (!dateReleve || dateReleve < dateDebut || dateReleve >= dateFin) return
        const nom = l.produits?.nom
        if (!nom) return
        if (!groupes[nom]) groupes[nom] = { produit: nom, somme: 0, n: 0 }
        groupes[nom].somme += l.quantite_rayon || 0
        groupes[nom].n += 1
      })
      return Object.values(groupes).map((g) => ({
        produit: g.produit,
        stock_rayon_moyen: Number((g.somme / g.n).toFixed(1)),
        observations: g.n,
      }))
    }

    const stockMoyenRecent = agregerRelevesMoyens(il_y_a_30j, maintenant.toISOString())
    const stockMoyenPrecedent = agregerRelevesMoyens(il_y_a_60j, il_y_a_30j)

    const { data: presenceConcurrents } = await supabase
      .from('rapport_visite_concurrents')
      .select('present, produits_concurrents(nom), rapports_visite(created_at)')
      .eq('entreprise_id', entrepriseId)
      .gte('rapports_visite.created_at', il_y_a_30j)

    const groupesPresenceConcurrents = {}
    ;(presenceConcurrents || []).forEach((l) => {
      const nom = l.produits_concurrents?.nom
      if (!nom) return
      if (!groupesPresenceConcurrents[nom]) groupesPresenceConcurrents[nom] = { total: 0, presents: 0 }
      groupesPresenceConcurrents[nom].total += 1
      if (l.present) groupesPresenceConcurrents[nom].presents += 1
    })
    const tauxPresenceConcurrents = Object.entries(groupesPresenceConcurrents).map(([nom, g]) => ({
      concurrent: nom,
      taux_presence_pct: Math.round((g.presents / g.total) * 100),
      observations: g.total,
    }))

    const { data: clients } = await supabase
      .from('clients')
      .select('id, nom, ville, limite_credit')
      .eq('entreprise_id', entrepriseId)
      .eq('actif', true)

    const { data: dernieresVisites } = await supabase
      .from('rapports_visite')
      .select('client_id, created_at')
      .eq('entreprise_id', entrepriseId)
      .order('created_at', { ascending: false })

    const derniereVisiteParClient = {}
    ;(dernieresVisites || []).forEach((r) => {
      if (!derniereVisiteParClient[r.client_id]) derniereVisiteParClient[r.client_id] = r.created_at
    })

    const clientsNonVisites = (clients || [])
      .map((c) => {
        const derniere = derniereVisiteParClient[c.id]
        const jours = derniere ? Math.floor((maintenant - new Date(derniere)) / 86400000) : null
        return {
          client: c.nom,
          ville: c.ville || 'Non précisée',
          limite_credit: c.limite_credit,
          jours_depuis_visite: jours,
        }
      })
      .filter((c) => c.jours_depuis_visite === null || c.jours_depuis_visite > 14)
      .sort((a, b) => (b.jours_depuis_visite ?? 9999) - (a.jours_depuis_visite ?? 9999))
      .slice(0, 25)

    const { data: creancesEchues } = await supabase
      .from('ventes')
      .select('total, montant_regle, date_echeance, clients(ville)')
      .eq('entreprise_id', entrepriseId)
      .eq('mode_paiement', 'credit')
      .lt('date_echeance', maintenant.toISOString().split('T')[0])

    const creancesParVille = {}
    ;(creancesEchues || []).forEach((v) => {
      if (Number(v.montant_regle) >= Number(v.total)) return
      const ville = v.clients?.ville || 'Non précisée'
      creancesParVille[ville] = (creancesParVille[ville] || 0) + (Number(v.total) - Number(v.montant_regle))
    })

    const donnees = {
      entreprise: entreprise?.nom,
      date_generation: maintenant.toISOString(),
      ruptures_de_stock_actuelles: rupturesListe,
      ventes_par_zone_30_derniers_jours: ventesParVilleRecent,
      ventes_par_zone_periode_precedente_30_60j: ventesParVillePrecedent,
      stock_rayon_moyen_par_produit_30_derniers_jours: stockMoyenRecent,
      stock_rayon_moyen_par_produit_periode_precedente: stockMoyenPrecedent,
      taux_presence_produits_concurrents_30_derniers_jours: tauxPresenceConcurrents,
      clients_non_visites_depuis_plus_de_14_jours: clientsNonVisites,
      creances_echues_par_zone: creancesParVille,
    }

    const systemPrompt = `Tu es analyste commercial senior pour une entreprise de distribution en Côte d'Ivoire (secteur FMCG/agroalimentaire).
On te fournit des données brutes agrégées de ${donnees.entreprise}. Rédige une analyse en français, claire et actionnable, structurée EXACTEMENT avec ces sections (utilise ces titres en gras) :

**1. Ruptures de stock** — produits en rupture ou proches, urgence de réapprovisionnement.
**2. Zones à risque** — zones commerciales en baisse de ventes, présence produit en baisse, ou concentration de créances échues.
**3. Zones à fort potentiel** — zones en croissance ou sous-exploitées (peu de visites récentes malgré de bons indicateurs).
**4. Produits à fort potentiel** — produits dont le stock rayon baisse vite (forte rotation) chez les clients, signe de bonne demande.
**5. Taux de présence en baisse** — où la présence des produits de l'entreprise recule face aux concurrents relevés.
**6. Clients à relancer en priorité** — parmi la liste des clients non visités récemment, cible les plus stratégiques (limite de crédit élevée notamment).
**7. Proposition de tournées commerciales** — regroupements géographiques suggérés pour optimiser les visites à venir.
**8. Répartition suggérée des objectifs commerciaux** — par zone et par produit, en fonction du potentiel observé (pas de chiffres inventés au hasard : justifie à partir des données fournies).
**9. Recommandations stratégiques** — 2 à 4 bonnes pratiques reconnues dans la distribution FMCG en Afrique de l'Ouest, applicables à ce contexte.

Sois concis par section (3-6 lignes maximum chacune). Si une donnée manque pour conclure sur un point, dis-le clairement plutôt que d'inventer. N'utilise que les données fournies ci-dessous.`

    const reponseClaude = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: JSON.stringify(donnees, null, 2) }],
      }),
    })

    if (!reponseClaude.ok) {
      const detail = await reponseClaude.text()
      return reponseErreur(`Erreur API Anthropic (${reponseClaude.status}) : ${detail}`, 502)
    }

    const resultatClaude = await reponseClaude.json()
    const texteAnalyse = resultatClaude.content?.[0]?.text || 'Analyse indisponible.'

    await supabase.from('analyses_ia').insert({
      entreprise_id: entrepriseId,
      contenu: texteAnalyse,
      genere_par: profil.id,
    })

    return new Response(JSON.stringify({ analyse: texteAnalyse }), {
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
