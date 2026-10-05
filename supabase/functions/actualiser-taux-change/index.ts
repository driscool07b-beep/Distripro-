// supabase/functions/actualiser-taux-change/index.ts
// Edge Function : actualise le taux dollar / F CFA utilisé pour décompter les
// unités IA. Le F CFA étant arrimé à l'euro (1 EUR = 655,957 XOF), le taux
// se déduit exactement du cours EUR/USD de la BCE (Frankfurter, gratuit).
// Source de secours : open.er-api.com (taux XOF direct).
// Appelée chaque jour par la planification (secret partagé), ou depuis la
// console par le promoteur (bouton « Actualiser maintenant »).

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-rapport-secret',
}
const reponse = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
const XOF_PAR_EUR = 655.957

async function tauxBce(): Promise<{ taux: number; date: string; source: string }> {
  const r = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR')
  if (!r.ok) throw new Error(`Frankfurter HTTP ${r.status}`)
  const d = await r.json()
  const eurParUsd = Number(d?.rates?.EUR)
  if (!(eurParUsd > 0)) throw new Error('Frankfurter : réponse sans cours EUR')
  return { taux: eurParUsd * XOF_PAR_EUR, date: String(d.date || ''), source: 'BCE (Frankfurter) × parité fixe 655,957' }
}

async function tauxSecours(): Promise<{ taux: number; date: string; source: string }> {
  const r = await fetch('https://open.er-api.com/v6/latest/USD')
  if (!r.ok) throw new Error(`open.er-api HTTP ${r.status}`)
  const d = await r.json()
  const xof = Number(d?.rates?.XOF)
  if (!(xof > 0)) throw new Error('open.er-api : réponse sans cours XOF')
  return { taux: xof, date: String(d.time_last_update_utc || '').slice(5, 16), source: 'open.er-api (secours)' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    // Autorisé : la planification (secret partagé) ou le promoteur connecté.
    const { data: secret } = await supabase.from('plateforme_secrets').select('valeur').eq('cle', 'rapport_mensuel').maybeSingle()
    const parPlanification = !!secret?.valeur && req.headers.get('x-rapport-secret') === secret.valeur
    if (!parPlanification) {
      const client = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
        global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
      })
      const { data: estPromoteur } = await client.rpc('est_super_admin')
      if (estPromoteur !== true) return reponse({ error: 'accès refusé' }, 403)
    }

    let cours
    const erreurs: string[] = []
    try { cours = await tauxBce() } catch (e) { erreurs.push(String((e as Error).message)) }
    if (!cours) {
      try { cours = await tauxSecours() } catch (e) { erreurs.push(String((e as Error).message)) }
    }
    if (!cours) return reponse({ error: `Aucune source de taux disponible : ${erreurs.join(' ; ')}` }, 502)

    const { data, error } = await supabase.rpc('enregistrer_taux_change', { p_taux: cours.taux, p_date_cours: cours.date, p_source: cours.source })
    if (error) return reponse({ error: error.message }, 500)
    return reponse({ statut: data, taux: Math.round(cours.taux * 100) / 100, date_cours: cours.date, source: cours.source, avertissements: erreurs })
  } catch (e) {
    return reponse({ error: String((e as Error)?.message || e) }, 500)
  }
})
