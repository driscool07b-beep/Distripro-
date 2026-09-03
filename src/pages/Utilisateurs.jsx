import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const LIBELLES_ROLE = {
  admin: 'Administrateur',
  manager: 'Manager',
  commercial: 'Commercial',
  comptable: 'Comptable',
  gestionnaire_stock: 'Gestionnaire de stock',
}

export default function Utilisateurs() {
  const { profil, entreprise } = useAuth()
  const [membres, setMembres] = useState([])
  const [invitationsEnAttente, setInvitationsEnAttente] = useState([])
  const [chargement, setChargement] = useState(true)

  const [modalOuvert, setModalOuvert] = useState(false)
  const [email, setEmail] = useState('')
  const [nomComplet, setNomComplet] = useState('')
  const [role, setRole] = useState('commercial')
  const [zone, setZone] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    if (profil?.role === 'admin') charger()
  }, [profil])

  async function charger() {
    setChargement(true)
    const [{ data: m }, { data: inv }] = await Promise.all([
      supabase.from('profils').select('id, nom, nom_complet, role, zone, actif, telephone').order('nom'),
      supabase.from('invitations').select('id, email, nom_complet, role, zone, statut, created_at').eq('statut', 'en_attente').order('created_at', { ascending: false }),
    ])
    setMembres(m || [])
    setInvitationsEnAttente(inv || [])
    setChargement(false)
  }

  function ouvrirModal() {
    setEmail('')
    setNomComplet('')
    setRole('commercial')
    setZone('')
    setErreur('')
    setModalOuvert(true)
  }

  async function envoyerInvitation(e) {
    e.preventDefault()
    setErreur('')
    if (!email.trim() || !nomComplet.trim()) {
      setErreur('Email et nom complet sont requis.')
      return
    }
    setEnvoi(true)
    const { error } = await supabase.rpc('creer_invitation', {
      p_email: email.trim(),
      p_nom_complet: nomComplet.trim(),
      p_role: role,
      p_zone: zone.trim() || null,
    })
    setEnvoi(false)
    if (error) {
      setErreur(`Erreur : ${error.message}`)
      return
    }
    setModalOuvert(false)
    charger()
  }

  async function annulerInvitation(id) {
    await supabase.from('invitations').delete().eq('id', id)
    charger()
  }

  async function basculerActif(membre) {
    await supabase.from('profils').update({ actif: !membre.actif }).eq('id', membre.id)
    charger()
  }

  if (profil?.role !== 'admin') {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">Cette page est réservée à l'administrateur.</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h1 className="text-xl font-bold">Équipe</h1>
        <button onClick={ouvrirModal} className="btn-primary text-sm">
          + Inviter un collaborateur
        </button>
      </div>
      <p className="text-sm text-petrol-500 mb-4">{entreprise?.nom}</p>

      {chargement ? (
        <p className="text-sm text-petrol-500">Chargement…</p>
      ) : (
        <>
          {invitationsEnAttente.length > 0 && (
            <div className="mb-6">
              <p className="text-sm font-medium mb-2">Invitations en attente</p>
              <div className="space-y-2">
                {invitationsEnAttente.map((inv) => (
                  <div key={inv.id} className="border border-amber-200 bg-amber-50 rounded-lg p-3 flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">{inv.nom_complet || inv.email}</p>
                      <p className="text-xs text-petrol-500">
                        {inv.email} — {LIBELLES_ROLE[inv.role] || inv.role}
                        {inv.zone ? ` — ${inv.zone}` : ''}
                      </p>
                    </div>
                    <button onClick={() => annulerInvitation(inv.id)} className="text-xs text-red-600 underline">
                      Annuler
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-sm font-medium mb-2">Membres de l'équipe</p>
          <div className="space-y-2">
            {membres.map((m) => (
              <div key={m.id} className={`border rounded-lg p-3 flex justify-between items-center ${m.actif ? 'border-line' : 'border-red-200 bg-red-50/40'}`}>
                <div>
                  <p className="text-sm font-medium">
                    {m.nom_complet || m.nom}
                    {!m.actif && <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Désactivé</span>}
                  </p>
                  <p className="text-xs text-petrol-500">
                    {LIBELLES_ROLE[m.role] || m.role}
                    {m.zone ? ` — ${m.zone}` : ''}
                    {m.telephone ? ` — ${m.telephone}` : ''}
                  </p>
                </div>
                {m.id !== profil.id && (
                  <button onClick={() => basculerActif(m)} className="text-xs text-petrol-600 underline whitespace-nowrap">
                    {m.actif ? 'Désactiver' : 'Réactiver'}
                  </button>
                )}
              </div>
            ))}
            {membres.length === 0 && <p className="text-xs text-petrol-400">Aucun membre.</p>}
          </div>
        </>
      )}

      {modalOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md">
            <h2 className="font-semibold text-lg mb-4">Inviter un collaborateur</h2>
            <form onSubmit={envoyerInvitation} className="space-y-3">
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  required
                  className="input-field"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="collaborateur@exemple.com"
                />
              </div>
              <div>
                <label className="label">Nom complet</label>
                <input
                  className="input-field"
                  value={nomComplet}
                  onChange={(e) => setNomComplet(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Rôle</label>
                <select className="input-field" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="commercial">Commercial</option>
                  <option value="manager">Manager</option>
                  <option value="comptable">Comptable</option>
                  <option value="gestionnaire_stock">Gestionnaire de stock</option>
                  <option value="admin">Administrateur</option>
                </select>
              </div>
              <div>
                <label className="label">Zone (optionnel, pour un commercial)</label>
                <input
                  className="input-field"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  placeholder="Ex. Abidjan Nord"
                />
              </div>
              <p className="text-xs text-petrol-500">
                La personne devra s'inscrire elle-même sur la page d'inscription avec cet email exact.
              </p>
              {erreur && <p className="text-sm text-red-600">{erreur}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setModalOuvert(false)}>
                  Annuler
                </button>
                <button type="submit" disabled={envoi} className="btn-primary flex-1">
                  {envoi ? 'Envoi…' : 'Inviter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
