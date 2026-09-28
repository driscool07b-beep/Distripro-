import { supabase } from './supabase'

// Fiches de réconciliation qui attendent une action de l'utilisateur :
//  - caisse     : fiches à valider par la caisse (direction, comptable,
//                 responsable de caisse) — sauf ses propres fiches
//  - comptable  : fiches validées par la caisse, à clôturer (admin, comptable)
//  - justifier  : pour un commercial, ses fiches avec écart sans justification
export async function compterReconciliationsATraiter(profil) {
  const vide = { total: 0, caisse: 0, comptable: 0, justifier: 0 }
  if (!profil) return vide
  const role = profil.role
  const { data: caisses } = await supabase.from('caisses').select('responsable_id').eq('actif', true)
  const valideurCaisse = ['admin', 'manager', 'comptable'].includes(role) || (caisses || []).some((c) => c.responsable_id === profil.id)
  const comptable = ['admin', 'comptable'].includes(role)

  const { data } = await supabase
    .from('reconciliations_commercial')
    .select('id, statut, commercial_id, ecart_argent, valeur_manquant, justification')
    .in('statut', ['brouillon', 'validee_caisse'])
  const fiches = data || []
  const res = { ...vide }
  if (valideurCaisse) res.caisse = fiches.filter((f) => f.statut === 'brouillon' && f.commercial_id !== profil.id).length
  if (comptable) res.comptable = fiches.filter((f) => f.statut === 'validee_caisse' && f.commercial_id !== profil.id).length
  if (role === 'commercial') {
    res.justifier = fiches.filter((f) => f.commercial_id === profil.id && !f.justification
      && (Number(f.ecart_argent) > 0 || Number(f.valeur_manquant) > 0)).length
  }
  res.total = res.caisse + res.comptable + res.justifier
  return res
}
