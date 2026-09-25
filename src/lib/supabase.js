import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Variables d\'environnement Supabase manquantes. Vérifiez votre fichier .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

// ---------------------------------------------------------------------------
// Envoi de fichiers : remplacement de supabase.storage.from(...).upload(...).
// La méthode d'envoi de la bibliothèque bloquait (voire faisait planter le
// navigateur sur certains téléphones Android) : on envoie désormais le fichier
// directement à l'API de stockage Supabase avec un simple fetch, avec un délai
// maximum. Même format de réponse ({ data, error }) : aucune page n'a besoin
// d'être modifiée.
// ---------------------------------------------------------------------------
async function televerser(bucket, chemin, fichier, options = {}) {
  const { upsert = false, contentType, cacheControl = '3600' } = options
  const controleur = new AbortController()
  const minuterie = setTimeout(() => controleur.abort(), 90000)
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const jeton = session?.access_token || supabaseAnonKey
    const cheminEncode = String(chemin).split('/').map(encodeURIComponent).join('/')
    const reponse = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${cheminEncode}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jeton}`,
        apikey: supabaseAnonKey,
        'x-upsert': upsert ? 'true' : 'false',
        'cache-control': `max-age=${cacheControl}`,
        'content-type': contentType || fichier?.type || 'application/octet-stream',
      },
      body: fichier,
      signal: controleur.signal,
    })
    const texte = await reponse.text()
    let json = {}
    try { json = JSON.parse(texte) } catch { /* réponse non JSON */ }
    if (!reponse.ok) {
      return { data: null, error: { message: json.message || json.error || texte || `erreur ${reponse.status}`, statusCode: reponse.status } }
    }
    return { data: { path: chemin, fullPath: json.Key || `${bucket}/${chemin}` }, error: null }
  } catch (e) {
    const message = e?.name === 'AbortError' ? 'délai dépassé (90 s) — connexion trop lente ou serveur indisponible' : (e?.message || String(e))
    return { data: null, error: { message } }
  } finally {
    clearTimeout(minuterie)
  }
}

const storageFromOriginal = supabase.storage.from.bind(supabase.storage)
supabase.storage.from = (bucket) => {
  const api = storageFromOriginal(bucket)
  api.upload = (chemin, fichier, options) => televerser(bucket, chemin, fichier, options)
  return api
}
