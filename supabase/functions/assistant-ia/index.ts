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
    name: 'rechercher_depots',
    description: 'Liste les magasins / dépôts de l\'entreprise (identifiants et noms). À appeler pour identifier un magasin dicté.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'rechercher_commerciaux',
    description: 'Liste les commerciaux actifs (identifiants et noms), pour une sortie de stock.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'commandes_a_traiter',
    description: "Commandes clients à traiter par le magasin (confirmées ou en préparation), les plus urgentes d'abord, avec leurs articles et quantités commandées.",
    input_schema: { type: 'object', properties: { numero: { type: 'string', description: 'Numéro précis (CMD-…), facultatif' } }, required: [] },
  },
  {
    name: 'demandes_sortie',
    description: "Demandes de produits des commerciaux au magasin. Pour le gestionnaire de stock / manager / admin : demandes en attente à traiter (les plus urgentes d'abord). Pour un commercial : ses propres demandes récentes et leur statut (accordée, en partie, refusée avec motif).",
    input_schema: { type: 'object', properties: { statut: { type: 'string', enum: ['en_attente', 'toutes'], description: 'en_attente par défaut' } }, required: [] },
  },
  {
    name: 'preparer_reception',
    description: "PRÉPARE (sans l'enregistrer) une réception de marchandise (entrée en stock) dans un magasin, avec lot et péremption si dictés. L'utilisateur valide sur une fiche (photo du bon fournisseur si exigée).",
    input_schema: {
      type: 'object',
      properties: {
        depot_id: { type: 'string' },
        lignes: { type: 'array', items: { type: 'object', properties: {
          produit_id: { type: 'string' }, quantite: { type: 'integer', minimum: 1 },
          numero_lot: { type: 'string' }, date_peremption: { type: 'string', description: 'AAAA-MM-JJ' }, prix_achat: { type: 'number' },
        }, required: ['produit_id', 'quantite'] } },
        fournisseur: { type: 'string' }, endommage: { type: 'boolean', description: 'true si la marchandise arrive abîmée' },
      },
      required: ['depot_id', 'lignes'],
    },
  },
  {
    name: 'preparer_demande_sortie',
    description: "PRÉPARE (sans l'envoyer) la demande de produits d'un COMMERCIAL au magasin pour sa tournée. Le commercial vérifie la fiche puis l'envoie au gestionnaire de stock. Réservé au rôle commercial.",
    input_schema: {
      type: 'object',
      properties: {
        depot_id: { type: 'string' },
        date_souhaitee: { type: 'string', description: 'AAAA-MM-JJ ; demain si « pour demain », aujourd’hui par défaut' },
        lignes: SCHEMA_LIGNES,
        commentaire: { type: 'string' },
      },
      required: ['depot_id', 'lignes'],
    },
  },
  {
    name: 'preparer_sortie_commercial',
    description: "PRÉPARE (sans l'enregistrer) une sortie de stock d'un magasin vers un commercial (marchandise pour sa tournée).",
    input_schema: { type: 'object', properties: { commercial_id: { type: 'string' }, depot_id: { type: 'string' }, lignes: SCHEMA_LIGNES }, required: ['commercial_id', 'depot_id', 'lignes'] },
  },
  {
    name: 'preparer_transfert',
    description: "PRÉPARE (sans l'enregistrer) un transfert de marchandise entre deux magasins.",
    input_schema: { type: 'object', properties: { depot_source_id: { type: 'string' }, depot_destination_id: { type: 'string' }, lignes: SCHEMA_LIGNES, motif: { type: 'string' } }, required: ['depot_source_id', 'depot_destination_id', 'lignes'] },
  },
  {
    name: 'preparer_traitement_commande',
    description: "PRÉPARE (sans l'enregistrer) le traitement d'une commande : 'preparer' (la passer en préparation) ou 'livrer' (livraison, quantités livrées éventuellement inférieures en cas de rupture).",
    input_schema: {
      type: 'object',
      properties: {
        commande_id: { type: 'string' }, action: { type: 'string', enum: ['preparer', 'livrer'] }, depot_id: { type: 'string' },
        manquants: { type: 'array', description: 'Seulement les articles livrés en quantité inférieure', items: { type: 'object', properties: { produit_id: { type: 'string' }, quantite_livree: { type: 'integer', minimum: 0 } }, required: ['produit_id', 'quantite_livree'] } },
      },
      required: ['commande_id', 'action'],
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
        remise_pourcentage: { type: 'number', description: "Remise dictée en pourcentage (ex. « remise de 5 % » → 5). Calculée sur le total HT des articles." },
        remise_montant: { type: 'number', description: "Remise dictée en montant (ex. « remise de 2 000 F » → 2000), seulement si elle n'est pas donnée en pourcentage." },
        motif_remise: { type: 'string', description: 'Motif de la remise si dicté (ex. « client fidèle », « grosse quantité »).' },
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
    const { data: entreprise } = await supabase.from('entreprises').select('nom, devise, seuil_remise_pourcentage').eq('id', profil.entreprise_id).single()

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
- Remise dictée sur une vente (« avec 5 % de remise », « fais-lui 2 000 F de remise ») : applique-la TOUJOURS via remise_pourcentage ou remise_montant de preparer_vente, avec le motif s'il est donné. Le seuil autorisé de l'entreprise est de ${entreprise?.seuil_remise_pourcentage ?? 15} % ; ${['admin', 'manager'].includes(profil.role) ? "ton utilisateur (administrateur ou manager) peut le dépasser" : "au-delà, la remise est refusée : explique-le et propose le maximum autorisé"}. Mentionne la remise dans ta phrase de récapitulatif. Les commandes n'acceptent pas de remise : elle s'applique au moment de la vente.
- Une vente part du stock en main du commercial s'il est commercial ; signale un stock en main insuffisant.
- Encaissement dicté (« X a payé 50 000 ») : retrouve le client, puis preparer_encaissement ; la répartition sur les factures se fait automatiquement (plus anciennes d'abord). Si le montant dépasse ce qui est dû, signale-le.
- Nouveau client dicté : vérifie d'abord avec rechercher_clients ; s'il existe déjà un client très proche, demande confirmation avant preparer_client.
- Visite dictée (« visite chez X, le gérant était absent ») : preparer_visite avec les observations reformulées clairement.
- Dès que tout est clair, appelle l'outil preparer_… correspondant : une fiche de confirmation s'affiche à l'utilisateur, qui seul peut valider. Réponds alors en UNE phrase courte récapitulant (client, nombre d'articles, total approximatif) et invite à vérifier puis valider. Ne dis jamais que c'est déjà enregistré.
- Demande de produits au magasin dictée par un commercial (« demande pour demain : 50 Farine Soleil et 20 Huile Palmeraie ») : rechercher_depots (si un seul magasin, utilise-le, sinon demande lequel) + produits, puis preparer_demande_sortie. Ne l'utilise que si l'utilisateur est commercial ; s'il ne précise pas les quantités, propose-lui le bouton « ✨ Proposer ma demande » de la page Mon stock en main.
Assistant du magasin (gestionnaire de stock) :
- Réception (« réception de 200 Bacca mil au dépôt principal, lot L2510, périme le 30/03/2027 ») : identifie le magasin (rechercher_depots) et les produits, puis preparer_reception. Si un seul magasin existe, utilise-le.
- Sortie vers un commercial : rechercher_commerciaux + rechercher_depots + produits, puis preparer_sortie_commercial.
- Transfert entre magasins : preparer_transfert (source et destination).
- Demandes de produits des commerciaux : demandes_sortie pour lister celles à traiter (« quelles demandes dois-je traiter ? ») ou, pour un commercial, savoir où en est sa demande. Pour décider des quantités à accorder, invite à ouvrir la demande dans Stock des commerciaux → Demandes des commerciaux et à utiliser « ✨ Proposer un arbitrage ».
- Commandes : commandes_a_traiter pour lister ou retrouver une commande (par numéro ou client) ; preparer_traitement_commande avec action 'preparer' ou 'livrer' ; pour une livraison incomplète, indique seulement les articles manquants dans « manquants ».
- Signale toujours un stock insuffisant ; ne prépare jamais un mouvement avec un magasin ou un produit incertain.
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
      // Remise dictée (ventes seulement) : même règle que le formulaire et que
      // creer_vente — au-delà du seuil de l'entreprise, seuls l'administrateur
      // et le manager peuvent l'appliquer.
      let remisePourcentage = 0
      if (type === 'vente') {
        if (Number(e.remise_pourcentage) > 0) remisePourcentage = Number(e.remise_pourcentage)
        else if (Number(e.remise_montant) > 0 && totalHT > 0) remisePourcentage = (Number(e.remise_montant) / totalHT) * 100
        remisePourcentage = Math.round(Math.min(remisePourcentage, 100) * 100) / 100
        const seuil = Number(entreprise?.seuil_remise_pourcentage ?? 15)
        if (remisePourcentage > seuil && !['admin', 'manager'].includes(profil.role)) {
          return { erreur: `remise de ${remisePourcentage} % refusée : elle dépasse le seuil autorisé de ${seuil} % pour ton rôle. Propose à l'utilisateur une remise de ${seuil} % au plus, ou de faire valider la remise par un manager ou un administrateur.` }
        }
      }
      return {
        type, client: { id: client.id, nom: client.nom }, lignes,
        paiement: type === 'vente' ? (['comptant', 'credit', 'partiel'].includes(e.paiement) ? e.paiement : 'comptant') : null,
        mode_reglement: ['espece', 'mobile_money', 'cheque', 'virement'].includes(e.mode_reglement) ? e.mode_reglement : 'espece',
        montant_paye: Number(e.montant_paye || e.acompte || 0) || null,
        date_livraison: /^\d{4}-\d{2}-\d{2}$/.test(e.date_livraison || '') ? e.date_livraison : null,
        note: String(e.note || '').slice(0, 300) || null,
        remise_pourcentage: remisePourcentage || null,
        motif_remise: remisePourcentage ? (String(e.motif_remise || '').trim().slice(0, 200) || 'Remise commerciale') : null,
        resume: `${client.nom} — ${lignes.length} article(s) — environ ${Math.round(totalHT)} F CFA HT${remisePourcentage ? ` — remise ${remisePourcentage} % (≈ ${Math.round(totalHT * remisePourcentage / 100)} F CFA)` : ''}`,
      }
    }

    // Brouillons de mouvements de stock (réception, sortie, transfert) :
    // contrôlés ici (magasins, commercial, produits), enrichis du stock
    // disponible ; jamais enregistrés.
    const preparerMouvementStock = async (outil: string, e: any) => {
      const lignesDemandees = (Array.isArray(e.lignes) ? e.lignes : [])
        .map((l: any) => ({ ...l, produit_id: String(l.produit_id || ''), quantite: Math.round(Number(l.quantite)) }))
        .filter((l: any) => l.produit_id && l.quantite > 0)
      if (!lignesDemandees.length) return { erreur: 'aucun article valide' }
      const { data: depots } = await supabaseUtilisateur.from('depots').select('id, nom').eq('actif', true)
      const depot = (id: string) => (depots || []).find((d: any) => d.id === id)
      if (outil === 'preparer_demande_sortie' && profil.role !== 'commercial') return { erreur: 'seul un commercial peut demander une sortie de produits' }
      const source = depot(outil === 'preparer_transfert' ? e.depot_source_id : e.depot_id)
      if (!source) return { erreur: 'magasin introuvable : utilise rechercher_depots' }
      const destination = outil === 'preparer_transfert' ? depot(e.depot_destination_id) : null
      if (outil === 'preparer_transfert' && (!destination || destination.id === source.id)) return { erreur: 'magasin de destination invalide' }
      let commercial = null
      if (outil === 'preparer_sortie_commercial') {
        const { data } = await supabaseUtilisateur.from('profils').select('id, nom').eq('id', e.commercial_id).eq('role', 'commercial').maybeSingle()
        if (!data) return { erreur: 'commercial introuvable : utilise rechercher_commerciaux' }
        commercial = data
      }
      const ids = [...new Set(lignesDemandees.map((l: any) => l.produit_id))]
      const { data: produits } = await supabaseUtilisateur.from('produits').select('id, nom, reference').in('id', ids)
      const { data: stocks } = await supabaseUtilisateur.from('stocks').select('produit_id, quantite').eq('depot_id', source.id).in('produit_id', ids)
      const disponible = Object.fromEntries((stocks || []).map((x: any) => [x.produit_id, Number(x.quantite)]))
      const lignes = []
      const alertes = []
      for (const l of lignesDemandees) {
        const p = (produits || []).find((x: any) => x.id === l.produit_id)
        if (!p) return { erreur: `produit introuvable (${l.produit_id}) : recherche-le d'abord` }
        const stock = disponible[p.id] ?? 0
        if (outil !== 'preparer_reception' && l.quantite > stock) alertes.push(`${p.nom} : ${l.quantite} demandés, ${stock} disponibles à ${source.nom}`)
        lignes.push({
          produit_id: p.id, nom: p.nom, reference: p.reference, quantite: l.quantite, stock,
          numero_lot: String(l.numero_lot || '').slice(0, 60) || null,
          date_peremption: /^\d{4}-\d{2}-\d{2}$/.test(l.date_peremption || '') ? l.date_peremption : null,
          prix_achat: Number(l.prix_achat) > 0 ? Number(l.prix_achat) : null,
        })
      }
      const type = outil === 'preparer_reception' ? 'reception' : outil === 'preparer_sortie_commercial' ? 'sortie' : outil === 'preparer_demande_sortie' ? 'demande_sortie' : 'transfert'
      const dateSouhaitee = /^\d{4}-\d{2}-\d{2}$/.test(e.date_souhaitee || '') && e.date_souhaitee >= aujourdHui ? e.date_souhaitee : aujourdHui
      return {
        type, depot: source, destination, commercial, lignes, alertes,
        fournisseur: String(e.fournisseur || e.motif || '').slice(0, 120) || null, endommage: !!e.endommage,
        date_souhaitee: type === 'demande_sortie' ? dateSouhaitee : null,
        commentaire: type === 'demande_sortie' ? (String(e.commentaire || '').slice(0, 300) || null) : null,
        resume: `${type} — ${source.nom}${destination ? ' → ' + destination.nom : ''}${commercial ? ' → ' + commercial.nom : ''} — ${lignes.length} article(s)`,
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
        case 'rechercher_depots': {
          const { data } = await supabaseUtilisateur.from('depots').select('id, nom').eq('actif', true).order('nom')
          return data || []
        }
        case 'rechercher_commerciaux': {
          const { data } = await supabaseUtilisateur.from('profils').select('id, nom').eq('role', 'commercial').neq('actif', false).order('nom')
          return data || []
        }
        case 'commandes_a_traiter': {
          let q = supabaseUtilisateur.from('commandes')
            .select('id, numero, statut, date_livraison_souhaitee, created_at, clients(nom), lignes_commande(produit_id, quantite, produits(nom, reference))')
            .in('statut', ['confirmee', 'en_preparation']).order('date_livraison_souhaitee', { ascending: true, nullsFirst: false }).limit(15)
          if (entree.numero) q = q.ilike('numero', `%${String(entree.numero).trim()}%`)
          const { data, error } = await q
          if (error) return { erreur: error.message }
          return (data || []).map((c: any) => ({
            id: c.id, numero: c.numero, statut: c.statut, client: c.clients?.nom, livraison_souhaitee: c.date_livraison_souhaitee,
            articles: (c.lignes_commande || []).map((l: any) => `${l.produits?.nom} × ${l.quantite}`),
          }))
        }
        case 'demandes_sortie': {
          let q = supabaseUtilisateur.from('demandes_sortie')
            .select('numero, statut, date_souhaitee, created_at, commentaire, motif_traitement, proposee_par_ia, commercial:profils!commercial_id(nom), depots(nom), demande_sortie_lignes(quantite_demandee, quantite_accordee, produits(nom))')
            .order('date_souhaitee', { ascending: true }).limit(20)
          if (entree.statut !== 'toutes') q = q.eq('statut', 'en_attente')
          const { data, error } = await q
          if (error) return { erreur: error.message }
          return (data || []).map((d: any) => ({
            numero: d.numero, statut: d.statut, pour_le: d.date_souhaitee, commercial: d.commercial?.nom, magasin: d.depots?.nom,
            commentaire: d.commentaire || null, motif: d.motif_traitement || null, proposee_par_ia: d.proposee_par_ia,
            articles: (d.demande_sortie_lignes || []).map((l: any) => `${l.produits?.nom} × ${l.quantite_demandee}${l.quantite_accordee != null ? ` (accordé ${l.quantite_accordee})` : ''}`),
          }))
        }
        case 'preparer_reception':
        case 'preparer_demande_sortie':
        case 'preparer_sortie_commercial':
        case 'preparer_transfert': {
          const brouillon = await preparerMouvementStock(nom, entree)
          if (brouillon.erreur) return brouillon
          actionPreparee = brouillon
          return { statut: 'fiche affichée — en attente de validation', resume: brouillon.resume, alertes: brouillon.alertes }
        }
        case 'preparer_traitement_commande': {
          const { data: c } = await supabaseUtilisateur.from('commandes')
            .select('id, numero, statut, mode_paiement, clients(nom), lignes_commande(produit_id, quantite, produits(nom, reference))').eq('id', entree.commande_id).maybeSingle()
          if (!c) return { erreur: 'commande introuvable : utilise commandes_a_traiter' }
          if (!['confirmee', 'en_preparation'].includes(c.statut)) return { erreur: `commande au statut « ${c.statut} » : rien à préparer ni à livrer` }
          const manquants = Object.fromEntries((entree.manquants || []).map((m: any) => [m.produit_id, Math.max(0, Math.round(Number(m.quantite_livree)))]))
          const { data: depots } = await supabaseUtilisateur.from('depots').select('id, nom').eq('actif', true)
          const depot = (depots || []).find((d: any) => d.id === entree.depot_id) || ((depots || []).length === 1 ? depots![0] : null)
          actionPreparee = {
            type: entree.action === 'livrer' ? 'commande_livrer' : 'commande_preparer',
            commande: { id: c.id, numero: c.numero, statut: c.statut, client: (c as any).clients?.nom, mode_paiement: c.mode_paiement },
            depot, lignes: (c.lignes_commande || []).map((l: any) => ({
              produit_id: l.produit_id, nom: l.produits?.nom, reference: l.produits?.reference, commande: Number(l.quantite),
              quantite: manquants[l.produit_id] ?? Number(l.quantite),
            })),
          }
          return { statut: 'fiche affichée — en attente de validation', commande: c.numero }
        }
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
    // Rapidité : les outils (identiques à chaque appel) sont mis en cache chez
    // le fournisseur d'IA ; budget de temps global pour toujours répondre avant
    // la limite d'exécution du serveur.
    const outilsEnCache = OUTILS.map((o: any, i: number) => (i === OUTILS.length - 1 ? { ...o, cache_control: { type: 'ephemeral' } } : o))
    const debut = Date.now()
    const BUDGET_MS = 100_000
    for (let tour = 0; tour < 8; tour++) {
      const reste = BUDGET_MS - (Date.now() - debut)
      if (reste < 8_000) {
        texteFinal = texteFinal || "Votre demande prend plus de temps que prévu. Pouvez-vous la reformuler plus simplement, ou la découper en plusieurs questions ?"
        break
      }
      let r: Response
      try {
        r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: MODELE, max_tokens: 1500, system: systeme, tools: outilsEnCache, messages: conversation }),
          signal: AbortSignal.timeout(Math.min(60_000, reste)),
        })
      } catch (_) {
        return reponse({ error: "Le service d'IA n'a pas répondu à temps. Réessayez dans un instant." }, 504)
      }
      if (!r.ok) {
        const detail = await r.text().catch(() => '')
        console.error('Anthropic', r.status, detail.slice(0, 500))
        return reponse({ error: `Service IA indisponible (${r.status}).` }, 502)
      }
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
