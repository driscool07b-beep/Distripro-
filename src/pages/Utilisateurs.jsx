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
  const [journal, setJournal] = useState([])
  const [chargement, setChargement] = useState(true)

  const [modalOuvert, setModalOuvert] = useState(false)
  const [invitationEnEdition, setInvitationEnEdition] = useState(null) // null = création
  const [email, setEmail] = useState('')
  const [nomComplet, setNomComplet] = useState('')
  const [role, setRole] = useState('commercial')
  const [zone, setZone] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')

  const [membreEnEdition, setMembreEnEdition] = useState(null)
  const [modalMembreOuvert, setModalMembreOuvert] = useState(false)
  const [nomCompletMembre, setNomCompletMembre] = useState('')
  const [roleMembre, setRoleMembre] = useState('commercial')
  const [zoneMembre, setZoneMembre] = useState('')
  const [accesEtenduMembre, setAccesEtenduMembre] = useState(false)
  const [lectureSeuleMembre, setLectureSeuleMembre] = useState(false)
  const [responsableTourneesMembre, setResponsableTourneesMembre] = useState(false)
  const [telephoneMembre, setTelephoneMembre] = useState('')
  const [envoiMembre, setEnvoiMembre] = useState(false)
  const [erreurMembre, setErreurMembre] = useState('')

  useEffect(() => {
    if (profil?.role === 'admin') charger()
  }, [profil])

  async function charger() {
    setChargement(true)
    const [{ data: m }, { data: inv }, { data: j }] = await Promise.all([
      supabase.from('profils').select('id, nom, nom_complet, role, zone, actif, telephone, acces_etendu, lecture_seule, responsable_tournees').order('nom'),
      supabase.from('invitations').select('id, email, nom_complet, role, zone, statut, created_at').eq('statut', 'en_attente').order('created_at', { ascending: false }),
      supabase
        .from('journal_administration')
        .select('id, action, details, created_at, effectue_par:profils!effectue_par(nom), cible:profils!cible_profil_id(nom)')
        .order('created_at', { ascending: false })
        .limit(30),
    ])
    setMembres(m || [])
    setInvitationsEnAttente(inv || [])
    setJournal(j || [])
    setChargement(false)
  }

  function ouvrirModal(invitation) {
    if (invitation) {
      setInvitationEnEdition(invitation)
      setEmail(invitation.email)
      setNomComplet(invitation.nom_complet || '')
      setRole(invitation.role)
      setZone(invitation.zone || '')
    } else {
      setInvitationEnEdition(null)
      setEmail('')
      setNomComplet('')
      setRole('commercial')
      setZone('')
    }
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

    let error
    if (invitationEnEdition) {
      const resultat = await supabase
        .from('invitations')
        .update({ email: email.trim(), nom_complet: nomComplet.trim(), role, zone: zone.trim() || null })
        .eq('id', invitationEnEdition.id)
      error = resultat.error
    } else {
      const resultat = await supabase.rpc('creer_invitation', {
        p_email: email.trim(),
        p_nom_complet: nomComplet.trim(),
        p_role: role,
        p_zone: zone.trim() || null,
      })
      error = resultat.error
    }

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

  function ouvrirModalMembre(membre) {
    setMembreEnEdition(membre)
    setNomCompletMembre(membre.nom_complet || membre.nom || '')
    setRoleMembre(membre.role)
    setZoneMembre(membre.zone || '')
    setTelephoneMembre(membre.telephone || '')
    setAccesEtenduMembre(membre.acces_etendu || false)
    setLectureSeuleMembre(membre.lecture_seule || false)
    setResponsableTourneesMembre(membre.responsable_tournees || false)
    setErreurMembre('')
    setModalMembreOuvert(true)
  }

  async function enregistrerMembre(e) {
    e.preventDefault()
    setErreurMembre('')
    if (!nomCompletMembre.trim()) {
      setErreurMembre('Le nom complet est requis.')
      return
    }
    setEnvoiMembre(true)
    const { error } = await supabase.rpc('modifier_membre_equipe', {
      p_profil_id: membreEnEdition.id,
      p_nom_complet: nomCompletMembre.trim(),
      p_telephone: telephoneMembre.trim() || null,
      p_role: roleMembre,
      p_zone: zoneMembre.trim() || null,
      p_acces_etendu: accesEtenduMembre,
      p_actif: membreEnEdition.actif,
      p_lecture_seule: lectureSeuleMembre,
      p_responsable_tournees: responsableTourneesMembre,
    })
    setEnvoiMembre(false)
    if (error) {
      setErreurMembre(`Erreur : ${error.message}`)
      return
    }
    setModalMembreOuvert(false)
    charger()
  }

  async function basculerActif(membre) {
    await supabase.rpc('modifier_membre_equipe', {
      p_profil_id: membre.id,
      p_nom_complet: membre.nom_complet || membre.nom,
      p_telephone: membre.telephone || null,
      p_role: membre.role,
      p_zone: membre.zone || null,
      p_acces_etendu: membre.acces_etendu || false,
      p_actif: !membre.actif,
      p_lecture_seule: membre.lecture_seule || false,
      p_responsable_tournees: membre.responsable_tournees || false,
    })
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
        <button onClick={() => ouvrirModal(null)} className="btn-primary text-sm">
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
                    <div className="flex gap-3 shrink-0">
                      <button onClick={() => ouvrirModal(inv)} className="text-xs text-petrol-600 underline">
                        Modifier
                      </button>
                      <button onClick={() => annulerInvitation(inv.id)} className="text-xs text-red-600 underline">
                        Annuler
                      </button>
                    </div>
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
                    {m.role === 'commercial' && m.acces_etendu && (
                      <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Accès élargi</span>
                    )}
                    {m.lecture_seule && (
                      <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Lecture seule</span>
                    )}
                    {m.responsable_tournees && (
                      <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Responsable tournées</span>
                    )}
                  </p>
                  <p className="text-xs text-petrol-500">
                    {LIBELLES_ROLE[m.role] || m.role}
                    {m.zone ? ` — ${m.zone}` : ''}
                    {m.telephone ? ` — ${m.telephone}` : ''}
                  </p>
                </div>
                <div className="flex gap-3 shrink-0">
                  <button onClick={() => ouvrirModalMembre(m)} className="text-xs text-petrol-600 underline whitespace-nowrap">
                    Modifier
                  </button>
                  {m.id !== profil.id && (
                    <button onClick={() => basculerActif(m)} className="text-xs text-petrol-600 underline whitespace-nowrap">
                      {m.actif ? 'Désactiver' : 'Réactiver'}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {membres.length === 0 && <p className="text-xs text-petrol-400">Aucun membre.</p>}
          </div>

          {journal.length > 0 && (
            <div className="mt-8">
              <p className="text-sm font-medium mb-2">Journal d'administration</p>
              <div className="space-y-1.5">
                {journal.map((j) => (
                  <div key={j.id} className="text-xs text-petrol-600 border-b border-line pb-1.5">
                    <span className="text-petrol-400">
                      {new Date(j.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {' — '}
                    <strong>{j.effectue_par?.nom || '—'}</strong> a modifié <strong>{j.cible?.nom || '—'}</strong>
                    {j.details ? ` : ${j.details}` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {modalOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md">
            <h2 className="font-semibold text-lg mb-4">{invitationEnEdition ? 'Modifier l\u2019invitation' : 'Inviter un collaborateur'}</h2>
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
                  {envoi ? 'Envoi…' : invitationEnEdition ? 'Enregistrer' : 'Inviter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalMembreOuvert && membreEnEdition && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md">
            <h2 className="font-semibold text-lg mb-4">Modifier le membre</h2>
            <form onSubmit={enregistrerMembre} className="space-y-3">
              <div>
                <label className="label">Nom complet</label>
                <input
                  className="input-field"
                  value={nomCompletMembre}
                  onChange={(e) => setNomCompletMembre(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Téléphone</label>
                <input
                  className="input-field"
                  value={telephoneMembre}
                  onChange={(e) => setTelephoneMembre(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Rôle</label>
                <select className="input-field" value={roleMembre} onChange={(e) => setRoleMembre(e.target.value)}>
                  <option value="commercial">Commercial</option>
                  <option value="manager">Manager</option>
                  <option value="comptable">Comptable</option>
                  <option value="gestionnaire_stock">Gestionnaire de stock</option>
                  <option value="admin">Administrateur</option>
                </select>
              </div>
              <div>
                <label className="label">Zone</label>
                <input
                  className="input-field"
                  value={zoneMembre}
                  onChange={(e) => setZoneMembre(e.target.value)}
                />
              </div>
              {roleMembre === 'commercial' && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={accesEtenduMembre}
                    onChange={(e) => setAccesEtenduMembre(e.target.checked)}
                  />
                  Accès élargi (voit l'activité de toute l'entreprise, pas seulement la sienne)
                </label>
              )}
              {membreEnEdition?.id !== profil.id && (
                <label className="flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  <input
                    type="checkbox"
                    checked={lectureSeuleMembre}
                    onChange={(e) => setLectureSeuleMembre(e.target.checked)}
                  />
                  Lecture seule (peut tout consulter, ne peut plus rien enregistrer ni modifier)
                </label>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={responsableTourneesMembre}
                  onChange={(e) => setResponsableTourneesMembre(e.target.checked)}
                />
                Responsable des tournées (peut programmer et modifier les tournées des commerciaux)
              </label>
              {erreurMembre && <p className="text-sm text-red-600">{erreurMembre}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setModalMembreOuvert(false)}>
                  Annuler
                </button>
                <button type="submit" disabled={envoiMembre} className="btn-primary flex-1">
                  {envoiMembre ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
