import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profil, setProfil] = useState(null) // { id, nom, role, entreprise_id }
  const [entreprise, setEntreprise] = useState(null) // { id, nom, plan, statut }
  const [loading, setLoading] = useState(true)

  const chargerProfil = useCallback(async (userId) => {
    let { data: profilData, error: profilError } = await supabase
      .from('profils')
      .select('id, nom, role, entreprise_id, actif')
      .eq('id', userId)
      .single()

    if ((profilError || !profilData)) {
      // Peut-être une personne qui vient de finaliser son inscription et
      // n'a pas encore de profil créé — on tente de le générer depuis son
      // invitation en attente, puis on relit une fois.
      const { error: erreurFinalisation } = await supabase.rpc('finaliser_inscription')
      if (!erreurFinalisation) {
        const retry = await supabase
          .from('profils')
          .select('id, nom, role, entreprise_id, actif')
          .eq('id', userId)
          .single()
        profilData = retry.data
        profilError = retry.error
      }
    }

    if (profilError || !profilData) {
      console.error('Erreur chargement profil:', profilError)
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

    const { data: entrepriseData, error: entrepriseError } = await supabase
      .from('entreprises')
      .select('id, nom, plan, statut, photo_rapport_obligatoire, adresse, telephone, email, ncc, rccm')
      .eq('id', profilData.entreprise_id)
      .single()

    if (entrepriseError) {
      console.error('Erreur chargement entreprise:', entrepriseError)
      return
    }
    setEntreprise(entrepriseData)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        await chargerProfil(session.user.id)
      }
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

  const inscription = async (email, motDePasse) => {
    const { data, error } = await supabase.auth.signUp({ email, password: motDePasse })
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
