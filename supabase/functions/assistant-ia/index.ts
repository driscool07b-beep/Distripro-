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

const SCHEMA_LIGNES = {
  type: 'array',
  description: 'Articles : identifiants trouvés par rechercher_produits et quantités dictées.',
  items: {
    type: 'object',
    properties: { produit_id: { type: 'string' }, quantite: { type: 'integer', minimum: 1 } },
    required: ['produit_id', 'quantite'],
  },
}

const OUTILS = [
  {
    name: 'rechercher_clients',
    description: "Retrouve un client à partir d'un nom ou d'un téléphone dicté (tolère accents et fautes). À appeler avant toute préparation de vente ou de commande.",
    input_schema: { type: 'object', properties: { texte: { type: 'string' } }, required: ['texte'] },
  },
  {
    name: 'rechercher_produits',
    description: "Retrouve un produit du catalogue à partir d'un nom dicté (ex. « bacca mil 350 »), avec le prix applicable au client et le stock (en main pour un commercial, et en magasin).",
    input_schema: { type: 'object', properties: { texte: { type: 'string' }, client_id: { type: 'string' } }, required: ['texte'] },
  },
  {
    name: 'trouver_pieces',
    description: "Retrouve des pièces (vente/facture, commande, encaissement, réconciliation, client, produit) par référence (VTE-…, CMD-…, REC-…), nom de client ou téléphone, pour les ouvrir, les imprimer, les exporter en PDF, les envoyer par WhatsApp ou email, ou lancer la FNE. Des boutons d'action s'affichent alors à l'utilisateur.",
    input_schema: { type: 'object', properties: { texte: { type: 'string', description: 'Référence ou nom à chercher' } }, required: ['texte'] },
  },
  {
    name: 'preparer_encaissement',
    description: "PRÉPARE (sans l'enregistrer) l'encaissement d'un paiement reçu d'un client sur ses factures impayées (les plus anciennes d'abord, ou la facture précisée). L'utilisateur valide sur une fiche.",
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        montant: { type: 'number' },
        mode: { type: 'string', enum: ['espece', 'mobile_money', 'cheque', 'virement'] },
        reference: { type: 'string', description: 'N° de chèque ou de transaction si dicté' },
        numero_facture: { type: 'string', description: 'Seulement si une facture précise est dictée (VTE-…)' },
      },
      required: ['client_id', 'montant'],
    },
  },
  {
    name: 'preparer_client',
    description: "PRÉPARE (sans l'enregistrer) la création d'un nouveau client. Vérifie d'abord avec rechercher_clients qu'il n'existe pas déjà.",
    input_schema: {
      type: 'object',
      properties: {
        nom: { type: 'string' }, telephone: { type: 'string' }, ville: { type: 'string' },
        adresse: { type: 'string', description: 'Quartier, repère' }, type_client: { type: 'string', description: 'Boutique, supermarché, grossiste…' },
        note: { type: 'string' },
      },
      required: ['nom'],
    },
  },
  {
    name: 'preparer_visite',
    description: "PRÉPARE (sans l'enregistrer) un rapport de visite chez un client (observations, absence du gérant, prochaine action…).",
    input_schema: {
      type: 'object',
      properties: { client_id: { type: 'string' }, observations: { type: 'string' } },
      required: ['client_id', 'observations'],
    },
  },
  {
    name: 'preparer_vente',
    description: "PRÉPARE (sans l'enregistrer) une vente que l'utilisateur validera lui-même sur une fiche de confirmation. À n'utiliser que si l'utilisateur demande clairement d'enregistrer une vente, avec un client et des produits identifiés sans ambiguïté.",
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        lignes: SCHEMA_LIGNES,
        paiement: { type: 'string', enum: ['comptant', 'credit', 'partiel'], description: 'comptant = payé en totalité ; credit = rien payé ; partiel = acompte' },
        mode_reglement: { type: 'string', enum: ['espece', 'mobile_money', 'cheque', 'virement'] },
        montant_paye: { type: 'number', description: 'Seulement pour un paiement partiel' },
        note: { type: 'string' },
      },
      required: ['client_id', 'lignes', 'paiement'],
    },
  },
  {
    name: 'preparer_commande',
    description: "PRÉPARE (sans l'enregistrer) une commande client à livrer plus tard, que l'utilisateur validera sur une fiche de confirmation.",
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        lignes: SCHEMA_LIGNES,
        date_livraison: { type: 'string', description: 'AAAA-MM-JJ si une date est dictée' },
        acompte: { type: 'number' },
        note: { type: 'string' },
      },
      required: ['client_id', 'lignes'],
    },
  },
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
    // Porte-monnaie d'unités IA : pas d'appel à l'IA si le solde est épuisé.
    const { data: soldeIa } = await supabase.rpc('ia_solde_disponible', { p_entreprise_id: profil.entreprise_id })
    if (soldeIa != null && Number(soldeIa) <= 0) return reponse({ error: "Crédit IA épuisé : rechargez vos unités IA (Paramètres → Mon abonnement) pour continuer à utiliser l'IA." }, 402)
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

    // Catalogue (noms) : aide à reconnaître les produits dans une dictée.
    const { data: catalogue } = await supabaseUtilisateur.from('produits').select('nom').order('nom').limit(200)
    const listeProduits = (catalogue || []).map((p: any) => p.nom).join(' ; ')

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
Assistant de saisie (ventes et commandes dictées, souvent par un commercial pressé sur le terrain) :
- Retrouve TOUJOURS le client puis chaque produit avec les outils de recherche ; n'invente jamais un identifiant.
- Si un client ou un produit est ambigu (plusieurs résultats proches) ou introuvable, pose UNE question courte en proposant les choix ; ne prépare rien.
- Le texte vient souvent d'une DICTÉE VOCALE : des mots qui se prononcent pareil peuvent être mal transcrits. En particulier « mil » (la céréale) est souvent écrit « mille » ou « 1000 » ; « maïs » peut devenir « mais » ; « riz » peut devenir « ri » ou « rit ». Compare toujours avec le catalogue ci-dessous : si « Bacca 1000 350 » ne correspond à aucun produit mais que « Bacca mil 350g » existe, c'est ce produit, et 1000 n'est PAS une quantité. En cas de doute réel sur une quantité, demande confirmation.
- Catalogue des produits : ${listeProduits || '—'}
- Quantités : comprends les nombres dictés en lettres (« dix », « une douzaine » = 12, « un carton » seulement si le catalogue le précise, sinon demande).
- Paiement non précisé pour une vente : considère « comptant » en espèces et dis-le dans ta réponse.
- Une vente part du stock en main du commercial s'il est commercial ; signale un stock en main insuffisant.
- Encaissement dicté (« X a payé 50 000 ») : retrouve le client, puis preparer_encaissement ; la répartition sur les factures se fait automatiquement (plus anciennes d'abord). Si le montant dépasse ce qui est dû, signale-le.
- Nouveau client dicté : vérifie d'abord avec rechercher_clients ; s'il existe déjà un client très proche, demande confirmation avant preparer_client.
- Visite dictée (« visite chez X, le gérant était absent ») : preparer_visite avec les observations reformulées clairement.
- Dès que tout est clair, appelle l'outil preparer_… correspondant : une fiche de confirmation s'affiche à l'utilisateur, qui seul peut valider. Réponds alors en UNE phrase courte récapitulant (client, nombre d'articles, total approximatif) et invite à vérifier puis valider. Ne dis jamais que c'est déjà enregistré.
Pièces existantes (ouvrir, imprimer, PDF, bon de livraison, WhatsApp, email, FNE, proforma) :
- Appelle trouver_pieces avec la référence ou le nom : des boutons d'action s'affichent sous ta réponse. Tu ne peux pas envoyer ni imprimer toi-même : invite l'utilisateur à appuyer sur le bouton voulu, en une phrase courte.
Assistance technique (questions « comment faire… ? », « pourquoi je ne peux pas… ? ») :
- Appuie-toi UNIQUEMENT sur les extraits du guide d'utilisation ci-dessous ; donne le chemin dans les menus et les étapes, simplement.
- Si le guide ne couvre pas la question, dis-le franchement et conseille de contacter l'administrateur de l'entreprise ou le support DistribPro ; n'invente pas de fonctionnalité.
- Certaines actions dépendent du rôle : si l'utilisateur ne voit pas un bouton, explique que c'est peut-être réservé à un autre rôle (rôle actuel : ${profil.role}).
${pageCourante ? `Page consultée juste avant : ${pageCourante}.` : ''}
${extraitsAide ? `Extraits du guide d'utilisation :\n${extraitsAide}` : ''}`

    // Brouillon de vente / commande : contrôlé ici (client et produits de
    // l'entreprise, quantités), enrichi des noms et prix ; JAMAIS enregistré.
    let actionPreparee: any = null
    const preparerBrouillon = async (type: string, e: any) => {
      const lignesDemandees = (Array.isArray(e.lignes) ? e.lignes : [])
        .map((l: any) => ({ produit_id: String(l.produit_id || ''), quantite: Math.round(Number(l.quantite)) }))
        .filter((l: any) => l.produit_id && l.quantite > 0)
      if (!lignesDemandees.length) return { erreur: 'aucun article valide' }
      const { data: client } = await supabaseUtilisateur.from('clients').select('id, nom').eq('id', e.client_id).maybeSingle()
      if (!client) return { erreur: 'client introuvable : recherche-le d\'abord' }
      const ids = [...new Set(lignesDemandees.map((l: any) => l.produit_id))]
      const { data: produits } = await supabaseUtilisateur.from('produits').select('id, nom, prix_vente').in('id', ids)
      const { data: tarifs } = await supabaseUtilisateur.from('tarifs_client').select('produit_id, prix_negocie').eq('client_id', client.id).in('produit_id', ids)
      const prixClient = Object.fromEntries((tarifs || []).map((t: any) => [t.produit_id, Number(t.prix_negocie)]))
      const lignes = []
      for (const l of lignesDemandees) {
        const p = (produits || []).find((x: any) => x.id === l.produit_id)
        if (!p) return { erreur: `produit introuvable (${l.produit_id}) : recherche-le d'abord` }
        lignes.push({ produit_id: p.id, nom: p.nom, quantite: l.quantite, prix_unitaire: prixClient[p.id] ?? Number(p.prix_vente) })
      }
      const totalHT = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0)
      return {
        type, client: { id: client.id, nom: client.nom }, lignes,
        paiement: type === 'vente' ? (['comptant', 'credit', 'partiel'].includes(e.paiement) ? e.paiement : 'comptant') : null,
        mode_reglement: ['espece', 'mobile_money', 'cheque', 'virement'].includes(e.mode_reglement) ? e.mode_reglement : 'espece',
        montant_paye: Number(e.montant_paye || e.acompte || 0) || null,
        date_livraison: /^\d{4}-\d{2}-\d{2}$/.test(e.date_livraison || '') ? e.date_livraison : null,
        note: String(e.note || '').slice(0, 300) || null,
        resume: `${client.nom} — ${lignes.length} article(s) — environ ${Math.round(totalHT)} F CFA HT`,
      }
    }

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
        case 'rechercher_clients': return appel('assistant_rechercher_clients', { p_texte: String(entree.texte || '') })
        case 'rechercher_produits': return appel('assistant_rechercher_produits', { p_texte: String(entree.texte || ''), p_client_id: entree.client_id || null })
        case 'trouver_pieces': {
          const resultats: any = await appel('recherche_globale', { p_terme: String(entree.texte || '') })
          if (!Array.isArray(resultats)) return resultats
          const pieces = resultats.slice(0, 5)
          if (pieces.length) actionPreparee = { type: 'pieces', pieces }
          return { nombre: pieces.length, pieces: pieces.map((p: any) => `${p.type} ${p.titre} — ${p.detail}`) }
        }
        case 'preparer_encaissement': {
          const { data: client } = await supabaseUtilisateur.from('clients').select('id, nom').eq('id', entree.client_id).maybeSingle()
          if (!client) return { erreur: 'client introuvable : recherche-le d\'abord' }
          const montant = Math.round(Number(entree.montant))
          if (!(montant > 0)) return { erreur: 'montant invalide' }
          const factures: any = await appel('assistant_factures_ouvertes', { p_client_id: client.id })
          if (!Array.isArray(factures) || !factures.length) return { erreur: 'aucune facture impayée pour ce client (rien à encaisser)' }
          const totalDu = factures.reduce((n: number, f: any) => n + Number(f.reste), 0)
          // Répartition : la facture dictée d'abord, puis les plus anciennes.
          const ordre = entree.numero_facture
            ? [...factures.filter((f: any) => String(f.numero || '').toUpperCase() === String(entree.numero_facture).toUpperCase()), ...factures.filter((f: any) => String(f.numero || '').toUpperCase() !== String(entree.numero_facture).toUpperCase())]
            : factures
          let reste = montant
          const repartition = ordre.map((f: any) => { const part = Math.min(Number(f.reste), Math.max(reste, 0)); reste -= part; return { ...f, part } })
          actionPreparee = {
            type: 'encaissement', client, montant,
            mode: ['espece', 'mobile_money', 'cheque', 'virement'].includes(entree.mode) ? entree.mode : 'espece',
            reference: String(entree.reference || '').slice(0, 60) || null, factures: repartition, total_du: totalDu,
          }
          return { statut: 'fiche affichée — en attente de validation', total_du: totalDu, montant, depassement: montant > totalDu }
        }
        case 'preparer_client': {
          const nom = String(entree.nom || '').trim().slice(0, 120)
          if (nom.length < 2) return { erreur: 'nom du client manquant' }
          const doublons: any = await appel('assistant_rechercher_clients', { p_texte: `${nom} ${entree.telephone || ''}` })
          actionPreparee = {
            type: 'client', nom,
            telephone: String(entree.telephone || '').replace(/[^0-9+ ]/g, '').trim() || null,
            ville: String(entree.ville || '').slice(0, 80) || null, adresse: String(entree.adresse || '').slice(0, 200) || null,
            type_client: String(entree.type_client || '').slice(0, 60) || null, note: String(entree.note || '').slice(0, 300) || null,
            doublons: Array.isArray(doublons) ? doublons.filter((d: any) => d.score >= 2).slice(0, 3) : [],
          }
          return { statut: 'fiche affichée — en attente de validation', clients_proches: actionPreparee.doublons.map((d: any) => d.nom) }
        }
        case 'preparer_visite': {
          const { data: client } = await supabaseUtilisateur.from('clients').select('id, nom').eq('id', entree.client_id).maybeSingle()
          if (!client) return { erreur: 'client introuvable : recherche-le d\'abord' }
          actionPreparee = { type: 'visite', client, observations: String(entree.observations || '').slice(0, 1500) }
          return { statut: 'fiche affichée — en attente de validation' }
        }
        case 'preparer_vente':
        case 'preparer_commande': {
          const brouillon = await preparerBrouillon(nom === 'preparer_vente' ? 'vente' : 'commande', entree)
          if (brouillon.erreur) return brouillon
          actionPreparee = brouillon
          return { statut: 'fiche de confirmation affichée — en attente de validation par l\'utilisateur', resume: brouillon.resume }
        }
        default: return { erreur: 'outil inconnu' }
      }
    }

    const conversation: any[] = [...historique]
    const usageTotal = { input_tokens: 0, output_tokens: 0 }
    let texteFinal = ''
    for (let tour = 0; tour < 8; tour++) {
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
    return reponse({
      reponse: texteFinal || "Je n'ai pas pu formuler de réponse. Pouvez-vous reformuler la question ?",
      action: actionPreparee,
    })
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
