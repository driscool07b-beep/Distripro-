import { useState } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export default function CreerEntreprise() {
  const { inscription, estConnecte } = useAuth()
  const [nomEntreprise, setNomEntreprise] = useState('')
  const [nomAdmin, setNomAdmin] = useState('')
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [erreur, setErreur] = useState('')
  const [chargement, setChargement] = useState(false)
  const [succes, setSucces] = useState(false)

  if (estConnecte) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setErreur('')

    if (!nomEntreprise.trim() || !nomAdmin.trim()) {
      setErreur("Le nom de l'entreprise et votre nom complet sont requis.")
      return
    }
    if (motDePasse.length < 6) {
      setErreur('Le mot de passe doit contenir au moins 6 caractères.')
      return
    }
    if (motDePasse !== confirmation) {
      setErreur('Les mots de passe ne correspondent pas.')
      return
    }

    setChargement(true)
    const { data, error } = await inscription(email.trim(), motDePasse, {
      nom_entreprise: nomEntreprise.trim(),
      nom_admin: nomAdmin.trim(),
    })

    if (error) {
      setChargement(false)
      setErreur(error.message?.includes('already registered') ? 'Un compte existe déjà avec cet email.' : `Erreur : ${error.message}`)
      return
    }

    if (data?.session) {
      const { error: erreurCreation } = await supabase.rpc('inscrire_entreprise', {
        p_nom_entreprise: nomEntreprise.trim(),
        p_nom_admin: nomAdmin.trim(),
      })
      setChargement(false)
      if (erreurCreation) {
        setErreur(`Erreur : ${erreurCreation.message}`)
        return
      }
      return
    }

    setChargement(false)
    setSucces(true)
  }

  if (succes) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-petrol-950 px-4">
        <div className="w-full max-w-sm card p-6 text-center">
          <h1 className="font-semibold text-lg mb-2">Compte créé</h1>
          <p className="text-sm text-petrol-600 mb-4">
            Vérifiez votre email pour confirmer votre compte, puis connectez-vous — votre entreprise sera automatiquement créée.
          </p>
          <Link to="/connexion" className="btn-primary inline-block">Aller à la connexion</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-petrol-950 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="font-display font-bold text-2xl text-white tracking-tight">DistribPro</div>
          <div className="text-sm text-white/50 mt-1">Créer votre entreprise</div>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <div>
            <label className="label">Nom de votre entreprise</label>
            <input
              required
              value={nomEntreprise}
              onChange={(e) => setNomEntreprise(e.target.value)}
              className="input-field"
              placeholder="Ex. Rama Cereal"
            />
          </div>
          <div>
            <label className="label">Votre nom complet</label>
            <input
              required
              value={nomAdmin}
              onChange={(e) => setNomAdmin(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="label">Adresse email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="label">Mot de passe</label>
            <input
              type="password"
              required
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              className="input-field"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">Confirmer le mot de passe</label>
            <input
              type="password"
              required
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              className="input-field"
              autoComplete="new-password"
            />
          </div>
          {erreur && <p className="text-sm text-red-600">{erreur}</p>}
          <button type="submit" disabled={chargement} className="btn-primary w-full">
            {chargement ? 'Création…' : 'Créer mon entreprise'}
          </button>
          <p className="text-xs text-center text-petrol-500">
            Invité(e) à rejoindre une équipe existante ? <Link to="/inscription" className="underline">Cliquez ici</Link>
          </p>
          <p className="text-xs text-center text-petrol-500">
            Déjà un compte ? <Link to="/connexion" className="underline">Se connecter</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
