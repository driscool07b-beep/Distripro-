import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import i18n from '../lib/i18n'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profil, setProfil] = useState(null) // { id, nom, role, entreprise_id }
  const [entreprise, setEntreprise] = useState(null) // { id, nom, plan, statut }
  const [loading, setLoading] = useState(true)
  const [profilError, setProfilError] = useState('')

  const chargerProfil = useCallback(async (userId) => {
    setProfilError('')
    const delaiSecurite = (ms) =>
      new Promise((_, reject) => setTimeout(() => reject(new Error('Le serveur met trop de temps à répondre. Réessayez.')), ms))

    try {
      await Promise.race([chargerProfilInterne(userId), delaiSecurite(15000)])
    } catch (e) {
      // Panne réseau, requête qui a expiré, projet Supabase indisponible…
      // — dans tous les cas on ne doit jamais laisser l'appli bloquée sans
      // explication : on capture et on affiche l'erreur réelle.
      console.error('Exception chargement profil:', e)
      setProfilError(e?.message || 'Connexion au serveur impossible. Vérifiez votre réseau.')
      setProfil(null)
      setEntreprise(null)
    }
  }, [])

  async function chargerProfilInterne(userId) {
    let { data: profilData, error: profilError } = await supabase
      .from('profils')
      .select('id, nom, role, entreprise_id, actif, acces_etendu, lecture_seule, responsable_tournees, langue')
      .eq('id', userId)
      .single()

    if ((profilError || !profilData)) {
      // Peut-être une personne qui vient de finaliser son inscription et
      // n'a pas encore de profil créé — on tente d'abord de le générer
      // depuis une invitation en attente, sinon depuis une inscription de
      // nouvelle entreprise (métadonnées du compte), puis on relit.
      let finalise = false
      const { error: erreurFinalisation } = await supabase.rpc('finaliser_inscription')
      if (!erreurFinalisation) finalise = true

      if (!finalise) {
        const { error: erreurCreationEntreprise } = await supabase.rpc('finaliser_creation_entreprise')
        if (!erreurCreationEntreprise) finalise = true
      }

      if (finalise) {
        const retry = await supabase
          .from('profils')
          .select('id, nom, role, entreprise_id, actif, acces_etendu, lecture_seule, responsable_tournees, langue')
          .eq('id', userId)
          .single()
        profilData = retry.data
        profilError = retry.error
      }
    }

    if (profilError || !profilData) {
      console.error('Erreur chargement profil:', profilError)
      setProfilError(profilError?.message || 'Profil introuvable pour ce compte.')
      setProfil(null)
      setEntreprise(null)
      return
    }

    if (profilData.actif === false) {
      await supabase.auth.signOut()
      setProfil(null)
      setEntreprise(null)
      return
    }

    setProfil(profilData)
    if (profilData.langue && profilData.langue !== i18n.language) {
      i18n.changeLanguage(profilData.langue)
    }

    const { data: entrepriseData, error: entrepriseError } = await supabase
      .from('entreprises')
      .select('id, nom, plan, statut, photo_rapport_obligatoire, adresse, telephone, email, ncc, rccm, seuil_remise_pourcentage, justificatif_stock_obligatoire, assujetti_tva')
      .eq('id', profilData.entreprise_id)
      .single()

    if (entrepriseError) {
      console.error('Erreur chargement entreprise:', entrepriseError)
      setProfilError(entrepriseError.message || 'Impossible de charger les données de l\u2019entreprise.')
      return
    }
    setEntreprise(entrepriseData)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        await chargerProfil(session.user.id)
      }
      setLoading(false)
    }).catch((e) => {
      console.error('Erreur getSession:', e)
      setProfilError(e?.message || 'Connexion au serveur impossible.')
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session)
      if (session?.user) {
        await chargerProfil(session.user.id)
      } else {
        setProfil(null)
        setEntreprise(null)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [chargerProfil])

  const connexion = async (email, motDePasse) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse })
    return { error }
  }

  const inscription = async (email, motDePasse, metadata = {}) => {
    const { data, error } = await supabase.auth.signUp({ email, password: motDePasse, options: { data: metadata } })
    return { data, error }
  }

  const deconnexion = async () => {
    await supabase.auth.signOut()
  }

  const value = {
    session,
    profil,
    entreprise,
    loading,
    profilError,
    connexion,
    inscription,
    deconnexion,
    estConnecte: !!session,
    rechargerProfil: () => session?.user && chargerProfil(session.user.id),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider')
  return ctx
}
