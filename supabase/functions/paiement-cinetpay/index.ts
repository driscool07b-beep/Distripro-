// supabase/functions/paiement-cinetpay/index.ts
// Edge Function : paiement en ligne via CinetPay (API checkout v2).
//   - initier : abonnement (formule + cycle) ou pack d'unités IA ; le montant
//     est calculé ICI depuis la base, jamais reçu du navigateur ;
//   - verifier : au retour du client dans l'app ;
//   - notification CinetPay (POST cpm_trans_id) ;
//   - verifier_en_attente : appelée toutes les 15 min par la planification.
// Toute validation repasse par /v2/payment/check (statut réel chez CinetPay),
// puis par finaliser_paiement_en_ligne (idempotente, contrôle du montant).
// Secrets requis : CINETPAY_APIKEY, CINETPAY_SITE_ID (compte marchand DistribPro),
// APP_URL (déjà configuré).

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-rapport-secret',
}
const reponse = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
const API = 'https://api-checkout.cinetpay.com/v2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const apikey = Deno.env.get('CINETPAY_APIKEY')
  const siteId = Deno.env.get('CINETPAY_SITE_ID')
  const appUrl = (Deno.env.get('APP_URL') || '').replace(/\/$/, '')

  // Statut réel chez CinetPay, puis validation unique en base.
  const verifierEtFinaliser = async (transactionId: string) => {
    const r = await fetch(`${API}/payment/check`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey, site_id: siteId, transaction_id: transactionId }),
    })
    const json = await r.json().catch(() => ({}))
    const statut = json?.data?.status
    if (statut !== 'ACCEPTED' && statut !== 'REFUSED') return { statut: 'en_attente', detail: json?.message || statut || null }
    const { data, error } = await supabase.rpc('finaliser_paiement_en_ligne', {
      p_transaction_id: transactionId, p_accepte: statut === 'ACCEPTED', p_montant: Number(json?.data?.amount || 0),
      p_moyen: json?.data?.payment_method || null, p_reponse: json?.data || {},
    })
    if (error) return { statut: 'erreur', detail: error.message }
    return { statut: data }
  }

  try {
    if (!apikey || !siteId) return reponse({ error: 'Paiement en ligne non configuré (CINETPAY_APIKEY / CINETPAY_SITE_ID).' }, 500)

    // ------------------------------------------- notification CinetPay (formulaire)
    const typeContenu = req.headers.get('content-type') || ''
    if (typeContenu.includes('application/x-www-form-urlencoded') || typeContenu.includes('multipart/form-data')) {
      const formulaire = await req.formData()
      const transactionId = String(formulaire.get('cpm_trans_id') || '')
      if (transactionId && String(formulaire.get('cpm_site_id') || siteId) === siteId) await verifierEtFinaliser(transactionId)
      return new Response('OK', { status: 200, headers: CORS_HEADERS })
    }

    const corps = await req.json().catch(() => ({}))

    // ------------------------------------------- vérification planifiée
    if (corps.action === 'verifier_en_attente') {
      const { data: secret } = await supabase.from('plateforme_secrets').select('valeur').eq('cle', 'rapport_mensuel').maybeSingle()
      if (!secret?.valeur || req.headers.get('x-rapport-secret') !== secret.valeur) return reponse({ error: 'accès refusé' }, 403)
      const { data: enAttente } = await supabase.from('paiements_en_ligne').select('transaction_id, created_at')
        .eq('statut', 'initie').gt('created_at', new Date(Date.now() - 2 * 86400000).toISOString())
      const bilan = []
      for (const p of enAttente || []) {
        const r = await verifierEtFinaliser(p.transaction_id)
        // Plus d'un jour sans réponse définitive : la tentative est abandonnée.
        if (r.statut === 'en_attente' && Date.now() - new Date(p.created_at).getTime() > 86400000) {
          await supabase.from('paiements_en_ligne').update({ statut: 'expire', finalise_at: new Date().toISOString() })
            .eq('transaction_id', p.transaction_id).eq('statut', 'initie')
        }
        bilan.push({ transaction: p.transaction_id, ...r })
      }
      return reponse({ bilan })
    }

    // ------------------------------------------- actions de l'utilisateur
    const authHeader = req.headers.get('Authorization') || ''
    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser()
    if (userError || !userData?.user) return reponse({ error: 'Utilisateur non authentifié.' }, 401)
    const { data: profil } = await supabase.from('profils').select('id, nom, role, entreprise_id, actif').eq('id', userData.user.id).single()
    if (!profil || profil.actif === false) return reponse({ error: 'Compte inactif.' }, 403)

    if (corps.action === 'verifier') {
      const { data: p } = await supabase.from('paiements_en_ligne').select('entreprise_id, statut, objet')
        .eq('transaction_id', String(corps.transaction_id || '')).maybeSingle()
      if (!p || p.entreprise_id !== profil.entreprise_id) return reponse({ error: 'Paiement introuvable.' }, 404)
      if (p.statut !== 'initie') return reponse({ statut: p.statut, objet: p.objet })
      const r = await verifierEtFinaliser(String(corps.transaction_id))
      return reponse({ ...r, objet: p.objet })
    }

    if (corps.action !== 'initier') return reponse({ error: 'Action inconnue.' }, 400)
    if (!['admin', 'comptable'].includes(profil.role)) return reponse({ error: "Paiement réservé à l'administrateur et au comptable." }, 403)

    // Montant calculé côté serveur.
    let montant = 0
    let description = ''
    const ligne: any = { entreprise_id: profil.entreprise_id, objet: corps.objet, cree_par: profil.id }
    if (corps.objet === 'abonnement') {
      const cycle = corps.cycle === 'annuel' ? 'annuel' : 'mensuel'
      const { data: formule } = await supabase.from('plans').select('code, nom, prix_mensuel, prix_annuel, actif').eq('code', corps.plan).maybeSingle()
      if (!formule || !formule.actif) return reponse({ error: 'Formule indisponible.' }, 400)
      // Places supplémentaires incluses : celles déjà achetées, ou au moins
      // celles qu'exige l'équipe actuelle (cas d'une fin d'essai).
      const { data: situation } = await supabase.rpc('situation_places', { p_entreprise_id: profil.entreprise_id })
      const places = Math.max(Number(situation?.places_achetees || 0), Number(situation?.depassement || 0))
      const { data: total } = await supabase.rpc('montant_abonnement', { p_entreprise_id: profil.entreprise_id, p_plan: formule.code, p_cycle: cycle, p_places: places })
      montant = Number(total ?? (cycle === 'annuel' ? formule.prix_annuel : formule.prix_mensuel))
      description = `Abonnement DistribPro ${formule.nom} ${cycle}${places ? ` et ${places} place(s) supplementaire(s)` : ''}`
      Object.assign(ligne, { plan_code: formule.code, cycle, places })
    } else if (corps.objet === 'places') {
      const n = Math.round(Number(corps.places))
      if (!(n >= 1 && n <= 50)) return reponse({ error: 'Nombre de places invalide.' }, 400)
      const { data: prorata } = await supabase.rpc('prix_places_prorata', { p_entreprise_id: profil.entreprise_id, p_places: n })
      if (!prorata?.possible) return reponse({ error: "L'ajout de places se fait sur un abonnement actif : renouvelez d'abord votre abonnement." }, 400)
      montant = Number(prorata.montant)
      description = `${n} place(s) supplementaire(s) DistribPro jusqu'au ${prorata.echeance}`
      Object.assign(ligne, { places: n })
    } else if (corps.objet === 'unites') {
      const { data: pack } = await supabase.from('ia_packs').select('code, nom, unites, prix, actif').eq('code', corps.pack).maybeSingle()
      if (!pack || !pack.actif) return reponse({ error: 'Pack indisponible.' }, 400)
      montant = Number(pack.prix)
      description = `Unites IA DistribPro pack ${pack.nom} ${pack.unites} unites`
      Object.assign(ligne, { pack_code: pack.code, unites: pack.unites })
    } else {
      return reponse({ error: 'Objet de paiement invalide.' }, 400)
    }
    montant = Math.ceil(montant / 5) * 5 // CinetPay : multiple de 5
    const transactionId = `DP${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    ligne.montant = montant
    ligne.transaction_id = transactionId
    const { error: erreurInsertion } = await supabase.from('paiements_en_ligne').insert(ligne)
    if (erreurInsertion) return reponse({ error: erreurInsertion.message }, 500)

    const { data: clePublique } = await supabase.from('plateforme_secrets').select('valeur').eq('cle', 'cle_publique').maybeSingle()
    const { data: entreprise } = await supabase.from('entreprises').select('nom, telephone, email').eq('id', profil.entreprise_id).single()
    const r = await fetch(`${API}/payment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey, site_id: siteId, transaction_id: transactionId, amount: montant, currency: 'XOF',
        description: description.replace(/[#/$&_]/g, ' '),
        notify_url: `${supabaseUrl}/functions/v1/paiement-cinetpay${clePublique?.valeur ? `?apikey=${clePublique.valeur}` : ''}`,
        return_url: `${appUrl}/abonnement?paiement=${transactionId}`,
        channels: 'ALL', lang: 'fr', metadata: profil.entreprise_id,
        customer_name: String(entreprise?.nom || profil.nom || 'Client').slice(0, 60),
        customer_surname: String(profil.nom || 'DistribPro').slice(0, 60),
        customer_email: userData.user.email || entreprise?.email || undefined,
        customer_phone_number: entreprise?.telephone || undefined,
        customer_country: 'CI', customer_city: 'Abidjan', customer_address: 'CI', customer_state: 'CI', customer_zip_code: '00225',
      }),
    })
    const json = await r.json().catch(() => ({}))
    if (String(json?.code) !== '201' || !json?.data?.payment_url) {
      await supabase.from('paiements_en_ligne').update({ statut: 'echoue', reponse_operateur: json, finalise_at: new Date().toISOString() }).eq('transaction_id', transactionId)
      return reponse({ error: `CinetPay : ${json?.description || json?.message || 'initialisation refusée'}` }, 502)
    }
    await supabase.from('paiements_en_ligne').update({ lien_paiement: json.data.payment_url }).eq('transaction_id', transactionId)
    return reponse({ lien: json.data.payment_url, transaction_id: transactionId, montant })
  } catch (e) {
    return reponse({ error: String((e as Error)?.message || e) }, 500)
  }
})
