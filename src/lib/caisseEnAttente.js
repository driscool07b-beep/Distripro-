import { supabase } from './supabase'

// Compte, caisse par caisse, les éléments qui attendent une action dans le
// Journal de caisse : demandes à valider (si l'utilisateur peut valider),
// demandes validées à payer, transferts entrants (caisse→caisse et
// banque→caisse) à confirmer. Seules les caisses ACTIVES sont prises en
// compte — ce sont les seules que la page permet de sélectionner, donc les
// seules où l'utilisateur peut effectivement traiter l'élément.
// Sert à la fois au badge du menu et au sélecteur de caisse de la page,
// pour que les deux affichent toujours exactement la même chose.
export async function compterEnAttenteParCaisse(peutValider) {
  const { data: caisses } = await supabase.from('caisses').select('id').eq('actif', true)
  const ids = (caisses || []).map((c) => c.id)
  if (ids.length === 0) return { parCaisse: {}, total: 0 }

  const requetes = [
    supabase.from('demandes_decaissement').select('caisse_id').eq('statut', 'validee').in('caisse_id', ids),
    supabase.from('caisse_transferts').select('caisse_destination_id').eq('statut', 'en_attente').in('caisse_destination_id', ids),
    supabase.from('transferts_banque_caisse').select('caisse_destination_id').eq('statut', 'en_attente').in('caisse_destination_id', ids),
  ]
  if (peutValider) {
    requetes.push(supabase.from('demandes_decaissement').select('caisse_id').eq('statut', 'en_attente').in('caisse_id', ids))
  }
  const resultats = await Promise.all(requetes)

  const parCaisse = {}
  let total = 0
  resultats.forEach(({ data }) => {
    ;(data || []).forEach((ligne) => {
      const id = ligne.caisse_id || ligne.caisse_destination_id
      if (!id) return
      parCaisse[id] = (parCaisse[id] || 0) + 1
      total += 1
    })
  })
  return { parCaisse, total }
}
