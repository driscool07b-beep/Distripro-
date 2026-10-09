// supabase/functions/certifier-fne/index.ts
// Edge Function : certification des ventes auprès de la plateforme FNE de la
// DGI (Côte d'Ivoire) — « Procédure d'interfaçage des entreprises par API »,
// mai 2025 : POST /external/invoices/sign (facture) et
// POST /external/invoices/{id}/refund (avoir), authentification Bearer.
// La clé API de chaque entreprise est lue dans fne_config (jamais exposée).
// À déployer via le tableau de bord Supabase (Edge Functions > certifier-fne).
//
// Corps attendu : { action: 'certifier' | 'avoir', vente_id: '…' }

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const reponse = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
const reponseErreur = (message: string, status = 400) => reponse({ error: message }, status)

// Téléphone : la DGI attend un numéro sans espaces ni indicatif (ex. 0709080765).
function telephoneDgi(t: string | null | undefined): string {
  let n = String(t || '').replace(/\D/g, '')
  if (n.startsWith('00225')) n = n.slice(5)
  else if (n.startsWith('225') && n.length > 10) n = n.slice(3)
  return n
}

// Modes de paiement : valeurs littérales attendues par l'API DGI.
const MODES: Record<string, string> = {
  espece: 'cash', cheque: 'check', mobile_money: 'mobile-money', virement: 'transfer', carte: 'card',
}

// Message d'erreur lisible à partir de la réponse de la DGI : la DGI précise
// souvent le champ refusé dans « errors » (ex. { establishment: { invalid: … } }).
const CHAMPS_DGI: Record<string, string> = {
  establishment: 'Établissement (Paramètres → FNE)', pointOfSale: 'Point de vente (Paramètres → FNE)',
  clientNcc: 'NCC du client', clientPhone: 'Téléphone du client', clientEmail: 'E-mail du client',
  clientCompanyName: 'Nom du client', paymentMethod: 'Mode de paiement', template: 'Type de facture (B2B/B2C)',
  items: 'Articles', taxes: 'Code TVA', customTaxes: 'Autres taxes', foreignCurrency: 'Devise', foreignCurrencyRate: 'Taux de change',
  quantity: 'Quantité', amount: 'Prix', description: 'Désignation', discount: 'Remise',
}
const MOTS_DGI: Record<string, string> = { invalid: 'invalide', required: 'obligatoire', isNotEmpty: 'obligatoire', notFound: 'introuvable' }
function messageDgi(json: any): string {
  if (!json) return 'erreur'
  const details: string[] = []
  const parcourir = (obj: any, chemin: string[]) => {
    if (!obj || typeof obj !== 'object') return
    for (const [cle, val] of Object.entries(obj)) {
      if (val && typeof val === 'object') parcourir(val, [...chemin, cle])
      else {
        const champ = chemin.filter((c) => !/^\d+$/.test(c)).pop() || cle
        details.push(`${CHAMPS_DGI[champ] || champ} : ${MOTS_DGI[cle] || String(val)}`)
      }
    }
  }
  parcourir(json.errors, [])
  if (details.length) return details.join(' ; ')
  if (json.error === 'invoice_signing_error') return 'la DGI n\'a pas pu signer la facture. Vérifiez le solde de stickers dans votre espace FNE (menu « Gestion des stickers »), rechargez-le si besoin, puis réessayez.'
  if (Array.isArray(json.message)) return json.message.join(' ; ')
  return json.message || 'erreur'
}

// Codes TVA DGI : TVA 18 %, TVAB 9 %, TVAC exonération conventionnelle, TVAD exonération légale.
// Le code TVA est OBLIGATOIRE sur chaque article (procédure DGI, mai 2025) :
// une entreprise non assujettie ou un article à 0 % est déclaré en TVAD.
function codeTva(taux: number | null, assujetti: boolean): string[] {
  if (!assujetti) return ['TVAD']
  if (Number(taux) === 18) return ['TVA']
  if (Number(taux) === 9) return ['TVAB']
  return ['TVAD']
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  const debut = Date.now()
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader = req.headers.get('Authorization') || ''
    const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser()
    if (userError || !userData?.user) return reponseErreur('Utilisateur non authentifié.', 401)
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { action, vente_id } = await req.json()
    if (!['certifier', 'avoir'].includes(action) || !vente_id) return reponseErreur('Requête invalide.')

    const { data: profil } = await supabase.from('profils')
      .select('id, nom, role, entreprise_id, actif, lecture_seule').eq('id', userData.user.id).single()
    if (!profil || profil.actif === false) return reponseErreur('Compte inactif.', 403)
    if (profil.lecture_seule) return reponseErreur('Votre compte est en lecture seule.', 403)

    const { data: config } = await supabase.from('fne_config').select('*').eq('entreprise_id', profil.entreprise_id).maybeSingle()
    if (!config?.actif || !config.api_key) return reponseErreur("La FNE n'est pas activée pour votre entreprise (Paramètres → FNE).")

    const { data: vente } = await supabase.from('ventes')
      .select('*, clients(nom, telephone, email, ncc, fne_template), commercial:profils!commercial_id(nom)')
      .eq('id', vente_id).eq('entreprise_id', profil.entreprise_id).single()
    if (!vente) return reponseErreur('Vente introuvable.', 404)

    const appelerDgi = async (chemin: string, corps: unknown) => {
      const controleur = new AbortController()
      const minuterie = setTimeout(() => controleur.abort(), 25000)
      try {
        const r = await fetch(`${String(config.base_url).replace(/\/$/, '')}${chemin}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${config.api_key}` },
          body: JSON.stringify(corps),
          signal: controleur.signal,
        })
        const texte = await r.text()
        let json: any = null
        try { json = texte ? JSON.parse(texte) : null } catch { json = { message: texte.slice(0, 500) } }
        return { ok: r.ok, status: r.status, json }
      } catch (e) {
        return { ok: false, status: 0, json: { message: e?.name === 'AbortError' ? 'la plateforme FNE ne répond pas (délai dépassé)' : String(e?.message || e) } }
      } finally {
        clearTimeout(minuterie)
      }
    }
    const journaliser = (operation: string, requete: unknown, res: { ok: boolean; status: number; json: unknown }) =>
      supabase.from('fne_journal').insert({
        entreprise_id: profil.entreprise_id, vente_id, operation, statut_http: res.status, succes: res.ok,
        requete, reponse: res.json, duree_ms: Date.now() - debut, created_by: profil.id,
      })

    // ------------------------------------------------------------------ avoir
    if (action === 'avoir') {
      if (vente.fne_statut !== 'certifiee' || !vente.fne_id) return reponse({ ignore: true, message: 'Vente non certifiée : aucun avoir FNE à émettre.' })
      if (vente.fne_avoir_reference) return reponse({ reference: vente.fne_avoir_reference, token: vente.fne_avoir_token })
      const { data: lignes } = await supabase.from('ventes_lignes').select('fne_item_id, quantite').eq('vente_id', vente_id)
      const corps = { items: (lignes || []).filter((l) => l.fne_item_id).map((l) => ({ id: l.fne_item_id, quantity: Number(l.quantite) })) }
      const res = await appelerDgi(`/external/invoices/${vente.fne_id}/refund`, corps)
      await journaliser('avoir', corps, res)
      if (!res.ok) return reponseErreur(`Avoir refusé par la DGI (${res.status}) : ${messageDgi(res.json)}`, 502)
      await supabase.from('ventes').update({ fne_avoir_reference: res.json?.reference, fne_avoir_token: res.json?.token }).eq('id', vente_id)
      return reponse({ reference: res.json?.reference, token: res.json?.token })
    }

    // ----------------------------------------------------------- certification
    if (vente.fne_statut === 'certifiee') return reponse({ reference: vente.fne_reference, token: vente.fne_token, deja: true })
    if (vente.statut === 'annulee') return reponseErreur('Une vente annulée ne peut pas être certifiée.')

    const [{ data: entreprise }, { data: lignes }, { data: taxes }] = await Promise.all([
      supabase.from('entreprises').select('assujetti_tva, devise').eq('id', profil.entreprise_id).single(),
      supabase.from('ventes_lignes').select('id, quantite, prix_unitaire, taux_tva, produits(nom, reference, unite)').eq('vente_id', vente_id).order('id'),
      supabase.from('taxes_entreprise').select('nom, taux').eq('entreprise_id', profil.entreprise_id).eq('actif', true),
    ])
    const client = vente.clients || {}
    const template = client.fne_template || (client.ncc ? 'B2B' : 'B2C')
    if (template === 'B2B' && !client.ncc) return reponseErreur("Client B2B : renseignez son NCC dans sa fiche avant de certifier.")
    // Téléphone et e-mail du client : obligatoires pour la DGI.
    const telephoneClient = telephoneDgi(client.telephone)
    const emailClient = String(client.email || '').trim()
    const manquants = [
      telephoneClient.length < 8 ? 'son téléphone' : null,
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClient) ? 'son e-mail' : null,
    ].filter(Boolean)
    if (manquants.length) {
      return reponseErreur(`La DGI exige le téléphone et l'e-mail du client : renseignez ${manquants.join(' et ')} dans la fiche de ${client.nom || 'ce client'}, puis certifiez à nouveau.`)
    }
    // Facturation en devise étrangère : devise et taux obligatoires (B2F notamment).
    const devise = String(entreprise?.devise || 'XOF')
    let devisePourDgi = { foreignCurrency: '', foreignCurrencyRate: 0 }
    if (devise !== 'XOF') {
      let taux: number | null = null
      if (devise === 'EUR') taux = 655.957 // parité fixe euro / F CFA
      else if (devise === 'USD') {
        const { data: p } = await supabase.from('plateforme_parametres').select('valeur').eq('cle', 'taux_usd_fcfa').maybeSingle()
        taux = p?.valeur ? Number(p.valeur) : null
      }
      if (!taux) return reponseErreur(`Taux de change ${devise} / F CFA indisponible : la certification FNE en ${devise} n'est pas encore prise en charge.`)
      devisePourDgi = { foreignCurrency: devise, foreignCurrencyRate: taux }
    }
    const sousTotal = (lignes || []).reduce((s, l) => s + Number(l.quantite) * Number(l.prix_unitaire), 0)
    const remisePct = sousTotal > 0 ? Math.round((Number(vente.remise_montant || 0) / sousTotal) * 10000) / 100 : 0
    const paiement = vente.mode_paiement === 'credit' && Number(vente.montant_regle || 0) === 0
      ? 'deferred' : (MODES[vente.mode_reglement] || 'cash')

    const corps = {
      invoiceType: 'sale',
      paymentMethod: paiement,
      template,
      isRne: false,
      rne: null,
      ...(client.ncc ? { clientNcc: client.ncc } : {}),
      clientCompanyName: client.nom || 'Client',
      clientPhone: telephoneClient,
      clientEmail: emailClient,
      clientSellerName: vente.commercial?.nom || profil.nom || '',
      pointOfSale: config.point_de_vente,
      establishment: config.etablissement,
      commercialMessage: vente.numero_vente ? `Vente ${vente.numero_vente}` : undefined,
      ...devisePourDgi,
      items: (lignes || []).map((l) => ({
        // Référence (code article) et unité de mesure : champs prévus par la DGI.
        ...(l.produits?.reference ? { reference: l.produits.reference } : {}),
        ...(l.produits?.unite ? { measurementUnit: l.produits.unite } : {}),
        description: l.produits?.nom || 'Article',
        quantity: Number(l.quantite),
        amount: Number(l.prix_unitaire),
        taxes: codeTva(l.taux_tva, !!entreprise?.assujetti_tva),
      })),
      customTaxes: (taxes || []).map((t) => ({ name: t.nom, amount: Number(t.taux) })),
      ...(remisePct > 0 ? { discount: remisePct } : {}),
    }
    const res = await appelerDgi('/external/invoices/sign', corps)
    await journaliser('certification', corps, res)

    if (!res.ok) {
      const message = messageDgi(res.json)
      await supabase.from('ventes').update({ fne_demandee: true, fne_statut: 'erreur', fne_erreur: `DGI (${res.status}) : ${message}` }).eq('id', vente_id)
      return reponseErreur(`Certification refusée par la DGI (${res.status}) : ${message}`, 502)
    }

    await supabase.from('ventes').update({
      fne_demandee: true, fne_statut: 'certifiee', fne_reference: res.json?.reference, fne_token: res.json?.token,
      fne_id: res.json?.invoice?.id || null, fne_certifiee_at: new Date().toISOString(), fne_erreur: null,
    }).eq('id', vente_id)
    // Identifiants DGI des lignes (nécessaires pour un avoir), dans le même ordre.
    const itemsDgi = res.json?.invoice?.items || []
    for (let i = 0; i < Math.min(itemsDgi.length, (lignes || []).length); i++) {
      await supabase.from('ventes_lignes').update({ fne_item_id: itemsDgi[i].id }).eq('id', lignes![i].id)
    }
    return reponse({
      reference: res.json?.reference, token: res.json?.token,
      avertissement_stickers: res.json?.warning ? res.json?.balance_sticker : null,
    })
  } catch (e) {
    return reponseErreur(String(e?.message || e), 500)
  }
})
