import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profil, setProfil] = useState(null) // { id, nom, role, entreprise_id }
  const [entreprise, setEntreprise] = useState(null) // { id, nom, plan, statut }
  const [loading, setLoading] = useState(true)

  const chargerProfil = useCallback(async (userId) => {
    const { data: profilData, error: profilError } = await supabase
      .from('profils')
      .select('id, nom, role, entreprise_id')
      .eq('id', userId)
      .single()

    if (profilError || !profilData) {
      console.error('Erreur chargement profil:', profilError)
      setProfil(null)
      setEntreprise(null)
      return
    }
    setProfil(profilData)

    const { data: entrepriseData, error: entrepriseError } = await supabase
      .from('entreprises')
      .select('id, nom, plan, statut')
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

  const deconnexion = async () => {
    await supabase.auth.signOut()
  }

  const value = {
    session,
    profil,
    entreprise,
    loading,
    connexion,
    deconnexion,
    estConnecte: !!session,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider')
  return ctx
}
