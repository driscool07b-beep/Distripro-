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

// Modes de paiement : valeurs littérales attendues par l'API DGI.
const MODES: Record<string, string> = {
  espece: 'cash', cheque: 'check', mobile_money: 'mobile-money', virement: 'transfer', carte: 'card',
}

// Codes TVA DGI : TVA 18 %, TVAB 9 %, TVAC exonération conventionnelle, TVAD exonération légale.
function codeTva(taux: number | null, assujetti: boolean): string[] {
  if (!assujetti) return []
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
      if (!res.ok) return reponseErreur(`DGI (${res.status}) : ${res.json?.message || 'erreur'}`, 502)
      await supabase.from('ventes').update({ fne_avoir_reference: res.json?.reference, fne_avoir_token: res.json?.token }).eq('id', vente_id)
      return reponse({ reference: res.json?.reference, token: res.json?.token })
    }

    // ----------------------------------------------------------- certification
    if (vente.fne_statut === 'certifiee') return reponse({ reference: vente.fne_reference, token: vente.fne_token, deja: true })
    if (vente.statut === 'annulee') return reponseErreur('Une vente annulée ne peut pas être certifiée.')

    const [{ data: entreprise }, { data: lignes }, { data: taxes }] = await Promise.all([
      supabase.from('entreprises').select('assujetti_tva').eq('id', profil.entreprise_id).single(),
      supabase.from('ventes_lignes').select('id, quantite, prix_unitaire, taux_tva, produits(nom)').eq('vente_id', vente_id).order('id'),
      supabase.from('taxes_entreprise').select('nom, taux').eq('entreprise_id', profil.entreprise_id).eq('actif', true),
    ])
    const client = vente.clients || {}
    const template = client.fne_template || (client.ncc ? 'B2B' : 'B2C')
    if (template === 'B2B' && !client.ncc) return reponseErreur("Client B2B : renseignez son NCC dans sa fiche avant de certifier.")
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
      clientPhone: client.telephone || '',
      clientEmail: client.email || '',
      clientSellerName: vente.commercial?.nom || profil.nom || '',
      pointOfSale: config.point_de_vente,
      establishment: config.etablissement,
      commercialMessage: vente.numero_vente ? `Vente ${vente.numero_vente}` : undefined,
      items: (lignes || []).map((l) => ({
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
      const message = res.json?.message ? (Array.isArray(res.json.message) ? res.json.message.join(' ; ') : res.json.message) : 'erreur'
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
