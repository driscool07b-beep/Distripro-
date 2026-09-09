// Nos propres messages d'erreur (écrits dans les fonctions RPC avec
// `raise exception '...'`) sont déjà en français. Mais certaines erreurs
// ne passent jamais par ce chemin : erreurs système Postgres (contraintes,
// syntaxe), erreurs PostgREST (fonction introuvable, aucune ligne
// trouvée), coupures réseau… Celles-là sortent en anglais par défaut.
// Cette fonction reconnaît les motifs les plus courants et les traduit ;
// si rien ne correspond, elle renvoie le message d'origine tel quel
// plutôt que d'inventer une traduction hasardeuse.

const MOTIFS = [
  [/duplicate key value violates unique constraint/i, 'Cet enregistrement existe déjà.'],
  [/violates foreign key constraint/i, "Cette action est impossible car l'élément est lié à d'autres données."],
  [/violates not-null constraint/i, 'Un champ obligatoire est manquant.'],
  [/violates check constraint/i, 'Une valeur saisie ne respecte pas les règles attendues.'],
  [/permission denied/i, 'Accès refusé.'],
  [/JWT expired/i, 'Votre session a expiré — reconnectez-vous.'],
  [/invalid JWT|invalid claim/i, 'Session invalide — reconnectez-vous.'],
  [/Failed to fetch|NetworkError|network request failed/i, 'Connexion au serveur impossible. Vérifiez votre réseau.'],
  [/Could not find the function/i, 'Une fonction attendue est introuvable côté serveur — contactez le support.'],
  [/relation "?[\w.]+"? does not exist/i, 'Un élément attendu est introuvable côté serveur — contactez le support.'],
  [/column "?[\w.]+"? does not exist/i, 'Un champ attendu est introuvable côté serveur — contactez le support.'],
  [/value too long for type/i, 'Une valeur saisie est trop longue.'],
  [/invalid input syntax/i, 'Format de donnée invalide.'],
  [/JSON object requested, multiple \(or no\) rows returned|0 rows|no rows/i, 'Aucun résultat trouvé.'],
  [/timeout|timed out/i, 'Le serveur met trop de temps à répondre. Réessayez.'],
  [/rate limit/i, 'Trop de tentatives — patientez un instant avant de réessayer.'],
  [/already registered/i, 'Un compte existe déjà avec cet email.'],
]

export function traduireErreur(message) {
  if (!message) return 'Erreur inconnue.'
  for (const [motif, traduction] of MOTIFS) {
    if (motif.test(message)) return traduction
  }
  return message
}
