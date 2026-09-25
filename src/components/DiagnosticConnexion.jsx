import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Diagnostic : mesure chaque étape d'un envoi (session, base de données,
// stockage) pour savoir exactement laquelle bloque ou échoue.
function avecDelai(promesse, ms) {
  let minuterie
  return Promise.race([
    promesse,
    new Promise((_, rejet) => { minuterie = setTimeout(() => rejet(new Error(`aucune réponse après ${ms / 1000} s`)), ms) }),
  ]).finally(() => clearTimeout(minuterie))
}

export default function DiagnosticConnexion() {
  const { entreprise, profil, profilError } = useAuth()
  const [lignes, setLignes] = useState([])
  const [enCours, setEnCours] = useState(false)

  async function etape(nom, fn) {
    const debut = performance.now()
    try {
      const detail = await avecDelai(fn(), 20000)
      const ms = Math.round(performance.now() - debut)
      setLignes((l) => [...l, { nom, ok: true, texte: `${ms} ms${detail ? ` — ${detail}` : ''}` }])
      return true
    } catch (e) {
      const ms = Math.round(performance.now() - debut)
      setLignes((l) => [...l, { nom, ok: false, texte: `${ms} ms — ${e?.message || e}` }])
      return false
    }
  }

  async function lancer() {
    setLignes([])
    setEnCours(true)
    try {
      await lancerEtapes()
    } catch (e) {
      setLignes((l) => [...l, { nom: 'Erreur inattendue', ok: false, texte: e?.message || String(e) }])
    }
    setEnCours(false)
  }

  async function lancerEtapes() {
    const infos = `${navigator.onLine ? 'en ligne' : 'HORS LIGNE'} · ${navigator.connection?.effectiveType || '?'}`
    setLignes([
      { nom: 'Appareil', ok: true, texte: infos },
      { nom: 'Fiche entreprise', ok: !!entreprise, texte: entreprise ? 'chargée' : `NON chargée${profilError ? ` — ${profilError}` : ''}` },
    ])
    await etape('1. Session', async () => {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      if (!data.session) throw new Error('aucune session')
      const reste = Math.round((data.session.expires_at * 1000 - Date.now()) / 60000)
      return `valide encore ${reste} min`
    })
    await etape('2. Base de données', async () => {
      const { error } = await supabase.from('depots').select('id').limit(1)
      if (error) throw error
    })
    const chemin = `${profil.entreprise_id}/mouvements-stock/diagnostic/${Date.now()}.txt`
    const envoiOk = await etape('3. Envoi d\'un petit fichier (stockage)', async () => {
      const fichier = new Blob([`diagnostic ${new Date().toISOString()}`], { type: 'text/plain' })
      const { error } = await supabase.storage.from('justificatifs-stock').upload(chemin, fichier, { upsert: false, contentType: 'text/plain' })
      if (error) throw new Error(`${error.message}${error.statusCode ? ` (code ${error.statusCode})` : ''}`)
    })
    if (envoiOk) {
      await etape('4. Lecture du fichier envoyé', async () => {
        const { error } = await supabase.storage.from('justificatifs-stock').createSignedUrl(chemin, 60)
        if (error) throw error
      })
    }
    await etape('5. Fonction serveur (RPC)', async () => {
      const { error } = await supabase.rpc('mon_compte_lecture_seule')
      if (error) throw error
    })
    setEnCours(false)
  }

  return (
    <div className="card p-4">
      <h2 className="font-semibold mb-1">🩺 Diagnostic de connexion</h2>
      <p className="text-xs text-petrol-500 mb-3">
        Teste une par une les étapes d'un envoi de fichier. Envoyez une capture du résultat à l'assistance en cas de blocage.
      </p>
      <button className="btn-secondary text-sm" disabled={enCours} onClick={lancer}>
        {enCours ? 'Test en cours…' : 'Lancer le diagnostic'}
      </button>
      {lignes.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {lignes.map((l, i) => (
            <li key={i} className={l.ok ? 'text-emerald-700' : 'text-red-600'}>
              {l.ok ? '✅' : '❌'} <strong>{l.nom}</strong> : {l.texte}
            </li>
          ))}
          {enCours && <li className="text-petrol-500">⏳ …</li>}
        </ul>
      )}
    </div>
  )
}
