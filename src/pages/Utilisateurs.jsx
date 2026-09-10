import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { traduireErreur } from '../lib/erreurs'

function libellesRole(t) {
  return {
    admin: t('roles.admin'),
    manager: t('roles.manager'),
    commercial: t('roles.commercial'),
    comptable: t('roles.comptable'),
    gestionnaire_stock: t('roles.gestionnaire_stock'),
    agent_recouvrement: t('roles.agent_recouvrement'),
  }
}

export default function Utilisateurs() {
  const { t } = useTranslation('utilisateurs')
  const { profil, entreprise } = useAuth()
  const LIBELLES_ROLE = libellesRole(t)
  const [membres, setMembres] = useState([])
  const [invitationsEnAttente, setInvitationsEnAttente] = useState([])
  const [journal, setJournal] = useState([])
  const [depots, setDepots] = useState([])
  const [depotsParMembre, setDepotsParMembre] = useState({}) // { profil_id: [{id, nom}] }
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
  const [depotsMembre, setDepotsMembre] = useState([]) // array d'ids de dépôts sélectionnés
  const [telephoneMembre, setTelephoneMembre] = useState('')
  const [envoiMembre, setEnvoiMembre] = useState(false)
  const [renvoiEnCours, setRenvoiEnCours] = useState(null) // id de l'invitation en cours de renvoi
  const [erreurRenvoi, setErreurRenvoi] = useState('')
  const [erreurMembre, setErreurMembre] = useState('')

  useEffect(() => {
    if (profil?.role === 'admin') charger()
  }, [profil])

  async function charger() {
    setChargement(true)
    const [{ data: m }, { data: inv }, { data: j }, { data: d }, { data: gd }] = await Promise.all([
      supabase.from('profils').select('id, nom, nom_complet, role, zone, actif, telephone, acces_etendu, lecture_seule, responsable_tournees').order('nom'),
      supabase.from('invitations').select('id, email, nom_complet, role, zone, statut, created_at').eq('statut', 'en_attente').order('created_at', { ascending: false }),
      supabase
        .from('journal_administration')
        .select('id, action, details, created_at, effectue_par:profils!effectue_par(nom), cible:profils!cible_profil_id(nom)')
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('depots').select('id, nom').eq('actif', true).order('nom'),
      supabase.from('gestionnaire_depots').select('profil_id, depot:depots(id, nom)'),
    ])
    setMembres(m || [])
    setInvitationsEnAttente(inv || [])
    setJournal(j || [])
    setDepots(d || [])
    const carte = {}
    ;(gd || []).forEach((row) => {
      if (!row.depot) return
      if (!carte[row.profil_id]) carte[row.profil_id] = []
      carte[row.profil_id].push(row.depot)
    })
    setDepotsParMembre(carte)
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
      setErreur(t('erreurEmailNomRequis'))
      return
    }
    setEnvoi(true)

    let error
    let invitationId = invitationEnEdition?.id
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
      invitationId = resultat.data
    }

    if (error) {
      setEnvoi(false)
      setErreur(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }

    if (invitationId) {
      const { error: erreurEmail } = await supabase.functions.invoke('envoyer-invitation', {
        body: { invitation_id: invitationId },
      })
      if (erreurEmail) {
        console.error('Erreur envoi email invitation:', erreurEmail)
        setEnvoi(false)
        setErreur(t('invitationCreeeMaisEmailEchec'))
        charger()
        return
      }
    }

    setEnvoi(false)
    setModalOuvert(false)
    charger()
  }

  async function renvoyerEmailInvitation(id) {
    setErreurRenvoi('')
    setRenvoiEnCours(id)
    const { error } = await supabase.functions.invoke('envoyer-invitation', { body: { invitation_id: id } })
    setRenvoiEnCours(null)
    if (error) {
      setErreurRenvoi(t('impossibleEnvoyerEmail'))
    }
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
    setDepotsMembre((depotsParMembre[membre.id] || []).map((d) => d.id))
    setErreurMembre('')
    setModalMembreOuvert(true)
  }

  async function enregistrerMembre(e) {
    e.preventDefault()
    setErreurMembre('')
    if (!nomCompletMembre.trim()) {
      setErreurMembre(t('erreurNomCompletRequis'))
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
    if (error) {
      setEnvoiMembre(false)
      setErreurMembre(`${t('erreur')} : ${traduireErreur(error.message)}`)
      return
    }

    // Attribution des dépôts : seulement pertinent pour un gestionnaire de
    // stock. Si le rôle vient de changer et n'est plus gestionnaire_stock,
    // on nettoie les attributions existantes.
    if (roleMembre === 'gestionnaire_stock') {
      await supabase.rpc('assigner_depots_gestionnaire', {
        p_profil_id: membreEnEdition.id,
        p_depot_ids: depotsMembre,
      })
    } else if (membreEnEdition.role === 'gestionnaire_stock') {
      await supabase.rpc('assigner_depots_gestionnaire', {
        p_profil_id: membreEnEdition.id,
        p_depot_ids: [],
      })
    }

    setEnvoiMembre(false)
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
        <p className="text-petrol-500">{t('accesRefuse')}</p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h1 className="text-xl font-bold">{t('titre')}</h1>
        <button onClick={() => ouvrirModal(null)} className="btn-primary text-sm">
          {t('inviterCollaborateur')}
        </button>
      </div>
      <p className="text-sm text-petrol-500 mb-4">{entreprise?.nom}</p>

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <>
          {invitationsEnAttente.length > 0 && (
            <div className="mb-6">
              <p className="text-sm font-medium mb-2">{t('invitationsEnAttente')}</p>
              {erreurRenvoi && <p className="text-xs text-red-600 mb-2">{erreurRenvoi}</p>}
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
                      <button
                        onClick={() => renvoyerEmailInvitation(inv.id)}
                        disabled={renvoiEnCours === inv.id}
                        className="text-xs text-petrol-600 underline disabled:opacity-50"
                      >
                        {renvoiEnCours === inv.id ? t('envoi') : t('renvoyerEmail')}
                      </button>
                      <button onClick={() => ouvrirModal(inv)} className="text-xs text-petrol-600 underline">
                        {t('modifier')}
                      </button>
                      <button onClick={() => annulerInvitation(inv.id)} className="text-xs text-red-600 underline">
                        {t('annulerInvitation')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-sm font-medium mb-2">{t('membresEquipe')}</p>
          <div className="space-y-2">
            {membres.map((m) => (
              <div key={m.id} className={`border rounded-lg p-3 flex justify-between items-center ${m.actif ? 'border-line' : 'border-red-200 bg-red-50/40'}`}>
                <div>
                  <p className="text-sm font-medium">
                    {m.nom_complet || m.nom}
                    {!m.actif && <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{t('desactive')}</span>}
                    {m.role === 'commercial' && m.acces_etendu && (
                      <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{t('accesElargi')}</span>
                    )}
                    {m.lecture_seule && (
                      <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">{t('lectureSeule')}</span>
                    )}
                    {m.responsable_tournees && (
                      <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{t('responsableTournees')}</span>
                    )}
                    {m.role === 'gestionnaire_stock' && depots.length > 1 && (
                      <span className="ml-2 text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded">
                        {(depotsParMembre[m.id] || []).length === 0
                          ? t('aucunDepotAttribue')
                          : (depotsParMembre[m.id] || []).map((d) => d.nom).join(', ')}
                      </span>
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
                    {t('modifier')}
                  </button>
                  {m.id !== profil.id && (
                    <button onClick={() => basculerActif(m)} className="text-xs text-petrol-600 underline whitespace-nowrap">
                      {m.actif ? t('desactiver') : t('reactiver')}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {membres.length === 0 && <p className="text-xs text-petrol-400">{t('aucunMembre')}</p>}
          </div>

          {journal.length > 0 && (
            <div className="mt-8">
              <p className="text-sm font-medium mb-2">{t('journalAdministration')}</p>
              <div className="space-y-1.5">
                {journal.map((j) => (
                  <div key={j.id} className="text-xs text-petrol-600 border-b border-line pb-1.5">
                    <span className="text-petrol-400">
                      {new Date(j.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {' — '}
                    <strong>{j.effectue_par?.nom || '—'}</strong> {t('aModifie')} <strong>{j.cible?.nom || '—'}</strong>
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
            <h2 className="font-semibold text-lg mb-4">{invitationEnEdition ? t('modalInvitationModifier') : t('modalInvitationInviter')}</h2>
            <form onSubmit={envoyerInvitation} className="space-y-3">
              <div>
                <label className="label">{t('email')}</label>
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
                <label className="label">{t('nomComplet')}</label>
                <input
                  className="input-field"
                  value={nomComplet}
                  onChange={(e) => setNomComplet(e.target.value)}
                />
              </div>
              <div>
                <label className="label">{t('role')}</label>
                <select className="input-field" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="commercial">{t('roles.commercial')}</option>
                  <option value="manager">{t('roles.manager')}</option>
                  <option value="comptable">{t('roles.comptable')}</option>
                  <option value="gestionnaire_stock">{t('roles.gestionnaire_stock')}</option>
                  <option value="agent_recouvrement">{t('roles.agent_recouvrement')}</option>
                  <option value="admin">{t('roles.admin')}</option>
                </select>
              </div>
              <div>
                <label className="label">{t('zoneOptionnelle')}</label>
                <input
                  className="input-field"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  placeholder={t('zonePlaceholder')}
                />
              </div>
              <p className="text-xs text-petrol-500">
                {t('noteInscription')}
              </p>
              {erreur && <p className="text-sm text-red-600">{erreur}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setModalOuvert(false)}>
                  {t('annuler')}
                </button>
                <button type="submit" disabled={envoi} className="btn-primary flex-1">
                  {envoi ? t('envoi') : invitationEnEdition ? t('enregistrer') : t('inviter')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalMembreOuvert && membreEnEdition && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md">
            <h2 className="font-semibold text-lg mb-4">{t('modalMembreTitre')}</h2>
            <form onSubmit={enregistrerMembre} className="space-y-3">
              <div>
                <label className="label">{t('nomComplet')}</label>
                <input
                  className="input-field"
                  value={nomCompletMembre}
                  onChange={(e) => setNomCompletMembre(e.target.value)}
                />
              </div>
              <div>
                <label className="label">{t('telephone')}</label>
                <input
                  className="input-field"
                  value={telephoneMembre}
                  onChange={(e) => setTelephoneMembre(e.target.value)}
                />
              </div>
              <div>
                <label className="label">{t('role')}</label>
                <select className="input-field" value={roleMembre} onChange={(e) => setRoleMembre(e.target.value)}>
                  <option value="commercial">{t('roles.commercial')}</option>
                  <option value="manager">{t('roles.manager')}</option>
                  <option value="comptable">{t('roles.comptable')}</option>
                  <option value="gestionnaire_stock">{t('roles.gestionnaire_stock')}</option>
                  <option value="agent_recouvrement">{t('roles.agent_recouvrement')}</option>
                  <option value="admin">{t('roles.admin')}</option>
                </select>
              </div>
              <div>
                <label className="label">{t('zone')}</label>
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
                  {t('accesElargiLabel')}
                </label>
              )}
              {membreEnEdition?.id !== profil.id && (
                <label className="flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  <input
                    type="checkbox"
                    checked={lectureSeuleMembre}
                    onChange={(e) => setLectureSeuleMembre(e.target.checked)}
                  />
                  {t('lectureSeuleLabel')}
                </label>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={responsableTourneesMembre}
                  onChange={(e) => setResponsableTourneesMembre(e.target.checked)}
                />
                {t('responsableTourneesLabel')}
              </label>
              {roleMembre === 'gestionnaire_stock' && depots.length > 1 && (
                <div className="border border-line rounded-lg p-3">
                  <p className="label mb-2">{t('depotsAttribues')}</p>
                  <p className="text-xs text-petrol-500 mb-2">
                    {t('depotsAttribuesAide')}
                  </p>
                  <div className="space-y-1.5">
                    {depots.map((d) => (
                      <label key={d.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={depotsMembre.includes(d.id)}
                          onChange={(e) =>
                            setDepotsMembre((prev) =>
                              e.target.checked ? [...prev, d.id] : prev.filter((id) => id !== d.id)
                            )
                          }
                        />
                        {d.nom}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {erreurMembre && <p className="text-sm text-red-600">{erreurMembre}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setModalMembreOuvert(false)}>
                  {t('annuler')}
                </button>
                <button type="submit" disabled={envoiMembre} className="btn-primary flex-1">
                  {envoiMembre ? t('enregistrement') : t('enregistrer')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
