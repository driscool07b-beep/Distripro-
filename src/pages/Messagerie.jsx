import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatDateHeure } from '../lib/format'

export default function Messagerie() {
  const { t } = useTranslation('messagerie')
  const { profil, entreprise } = useAuth()
  const [conversations, setConversations] = useState([])
  const [chargement, setChargement] = useState(true)
  const [conversationOuverte, setConversationOuverte] = useState(null)
  const [modalNouvelleConv, setModalNouvelleConv] = useState(false)
  const [modalNouveauCanal, setModalNouveauCanal] = useState(false)
  const [collegues, setCollegues] = useState([])

  useEffect(() => {
    charger()
    chargerCollegues()
  }, [])

  async function charger() {
    setChargement(true)
    const { data } = await supabase.rpc('mes_conversations')
    setConversations(data || [])
    setChargement(false)
  }

  async function chargerCollegues() {
    const { data } = await supabase
      .from('profils')
      .select('id, nom')
      .neq('id', profil?.id)
      .order('nom')
    setCollegues(data || [])
  }

  async function ouvrirConversationDirecte(autreId) {
    const { data, error } = await supabase.rpc('demarrer_conversation_directe', { p_autre_profil_id: autreId })
    if (error) return
    setModalNouvelleConv(false)
    setConversationOuverte(data)
    charger()
  }

  async function creerCanal(nom, membresIds) {
    const { data, error } = await supabase.rpc('creer_canal_groupe', { p_nom: nom, p_membres_ids: membresIds })
    if (error) return
    setModalNouveauCanal(false)
    setConversationOuverte(data)
    charger()
  }

  if (conversationOuverte) {
    return (
      <FilConversation
        conversationId={conversationOuverte}
        onRetour={async () => {
          // On s'assure que le marquage "lu" est bien terminé côté
          // serveur avant de rafraîchir la liste — sinon, en cas de
          // retour rapide, la liste peut se recharger juste avant que
          // la mise à jour soit enregistrée, et le badge "non lu"
          // reste affiché à tort.
          await supabase.rpc('marquer_conversation_lue', { p_conversation_id: conversationOuverte })
          setConversationOuverte(null)
          charger()
        }}
      />
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">{t('titre')}</h1>
        <div className="flex gap-2">
          <button data-aide="messagerie.nouveauCanal" onClick={() => setModalNouveauCanal(true)} className="btn-secondary text-sm">
            {t('nouveauCanal')}
          </button>
          <button data-aide="messagerie.nouvelleConversation" onClick={() => setModalNouvelleConv(true)} className="btn-primary text-sm">
            {t('nouvelleConversation')}
          </button>
        </div>
      </div>

      {chargement ? (
        <p className="text-sm text-petrol-500">{t('chargement')}</p>
      ) : (
        <div className="space-y-2">
          {conversations.map((c) => (
            <button
              key={c.conversation_id}
              onClick={() => setConversationOuverte(c.conversation_id)}
              className="w-full text-left border border-line rounded-lg p-3 flex items-center justify-between hover:bg-canvas/60"
            >
              <div className="min-w-0">
                <p className="font-medium text-sm flex items-center gap-2">
                  {c.type === 'groupe' ? '# ' : ''}
                  {c.type === 'groupe' ? c.nom : c.autre_membre_nom || t('utilisateurSupprime')}
                  {c.non_lus > 0 && (
                    <span className="bg-blue-600 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">{c.non_lus}</span>
                  )}
                </p>
                <p className="text-xs text-petrol-500 truncate">
                  {c.dernier_message
                    ? `${c.dernier_expediteur_nom ? c.dernier_expediteur_nom + ' : ' : ''}${c.dernier_message}`
                    : c.dernier_message_a_piece_jointe
                    ? t('piecesJointe')
                    : t('aucunMessage')}
                </p>
              </div>
              {c.dernier_message_at && (
                <span className="text-xs text-petrol-400 shrink-0 ml-2">
                  {formatDateHeure(c.dernier_message_at, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </button>
          ))}
          {conversations.length === 0 && (
            <p className="text-petrol-400 text-center py-12 text-sm">{t('aucuneConversation')}</p>
          )}
        </div>
      )}

      {modalNouvelleConv && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-5 w-full max-w-sm max-h-[80vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-3">{t('choisirCollegue')}</h2>
            <div className="space-y-1">
              {collegues.map((col) => (
                <button
                  key={col.id}
                  onClick={() => ouvrirConversationDirecte(col.id)}
                  className="w-full text-left px-3 py-2 rounded hover:bg-canvas text-sm"
                >
                  {col.nom}
                </button>
              ))}
              {collegues.length === 0 && <p className="text-sm text-petrol-400">{t('aucunCollegue')}</p>}
            </div>
            <button data-aide="messagerie.annuler" onClick={() => setModalNouvelleConv(false)} className="btn-secondary w-full mt-3">
              {t('annuler')}
            </button>
          </div>
        </div>
      )}

      {modalNouveauCanal && (
        <ModalNouveauCanal
          collegues={collegues}
          onAnnuler={() => setModalNouveauCanal(false)}
          onCreer={creerCanal}
        />
      )}
    </div>
  )
}

function ModalNouveauCanal({ collegues, onAnnuler, onCreer }) {
  const { t } = useTranslation('messagerie')
  const [nom, setNom] = useState('')
  const [selection, setSelection] = useState([])
  const [erreur, setErreur] = useState('')

  function toggleMembre(id) {
    setSelection((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function valider() {
    if (!nom.trim()) {
      setErreur(t('erreurNomCanal'))
      return
    }
    onCreer(nom.trim(), selection)
  }

  return (
    <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
      <div className="card bg-white p-5 w-full max-w-sm max-h-[80vh] overflow-y-auto">
        <h2 className="font-semibold text-lg mb-3">{t('nouveauCanal')}</h2>
        <label className="label">{t('nomCanal')}</label>
        <input
          className="input-field mb-3"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder={t('nomCanalPlaceholder')}
        />
        <label className="label">{t('membres')}</label>
        <div className="space-y-1 mb-3 max-h-48 overflow-y-auto">
          {collegues.map((col) => (
            <label key={col.id} className="flex items-center gap-2 text-sm px-1 py-1">
              <input type="checkbox" checked={selection.includes(col.id)} onChange={() => toggleMembre(col.id)} />
              {col.nom}
            </label>
          ))}
        </div>
        {erreur && <p className="text-xs text-red-600 mb-2">{erreur}</p>}
        <div className="flex gap-2">
          <button data-aide="messagerie.annuler" onClick={onAnnuler} className="btn-secondary flex-1">{t('annuler')}</button>
          <button data-aide="messagerie.creerLeCanal" onClick={valider} className="btn-primary flex-1">{t('creerLeCanal')}</button>
        </div>
      </div>
    </div>
  )
}

function FilConversation({ conversationId, onRetour }) {
  const { t } = useTranslation('messagerie')
  const { profil, entreprise } = useAuth()
  const [messages, setMessages] = useState([])
  const [chargement, setChargement] = useState(true)
  const [texte, setTexte] = useState('')
  const [fichier, setFichier] = useState(null)
  const [envoi, setEnvoi] = useState(false)
  const [urlsPieces, setUrlsPieces] = useState({})
  const [enTete, setEnTete] = useState(null)
  const finListe = useRef(null)

  useEffect(() => {
    charger()
    supabase.rpc('marquer_conversation_lue', { p_conversation_id: conversationId })

    const canal = supabase
      .channel(`messages-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new])
          supabase.rpc('marquer_conversation_lue', { p_conversation_id: conversationId })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [conversationId])

  useEffect(() => {
    finListe.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function charger() {
    setChargement(true)
    const { data: convs } = await supabase.rpc('mes_conversations')
    const info = (convs || []).find((c) => c.conversation_id === conversationId)
    setEnTete(info)

    const { data } = await supabase
      .from('messages')
      .select('id, contenu, piece_jointe_path, piece_jointe_nom, piece_jointe_type, expediteur_id, created_at, profils(nom)')
      .eq('conversation_id', conversationId)
      .order('created_at')
    setMessages(data || [])
    setChargement(false)

    for (const m of data || []) {
      if (m.piece_jointe_path && m.piece_jointe_type?.startsWith('image/')) {
        const { data: signed } = await supabase.storage.from('pieces-jointes').createSignedUrl(m.piece_jointe_path, 3600)
        if (signed?.signedUrl) setUrlsPieces((prev) => ({ ...prev, [m.id]: signed.signedUrl }))
      }
    }
  }

  async function envoyer() {
    if (!texte.trim() && !fichier) return
    setEnvoi(true)

    let cheminPiece = null
    let nomPiece = null
    let typePiece = null
    if (fichier) {
      typePiece = fichier.type
      nomPiece = fichier.name
      cheminPiece = `${entreprise?.id}/messagerie/${conversationId}/${Date.now()}-${fichier.name}`
      const { error: erreurUpload } = await supabase.storage.from('pieces-jointes').upload(cheminPiece, fichier)
      if (erreurUpload) {
        setEnvoi(false)
        return
      }
    }

    const { data: messageId } = await supabase.rpc('envoyer_message', {
      p_conversation_id: conversationId,
      p_contenu: texte,
      p_piece_jointe_path: cheminPiece,
      p_piece_jointe_nom: nomPiece,
      p_piece_jointe_type: typePiece,
    })

    if (messageId) {
      // Notification push aux autres membres — best-effort, on n'attend
      // pas le résultat (le message est déjà bien enregistré même si
      // ça échoue, ex. Edge Function pas encore déployée).
      supabase.functions.invoke('envoyer-notification-push', { body: { message_id: messageId } }).catch(() => {})
    }

    setTexte('')
    setFichier(null)
    setEnvoi(false)
  }

  async function ouvrirPieceJointe(m) {
    if (urlsPieces[m.id]) {
      window.open(urlsPieces[m.id], '_blank')
      return
    }
    const { data } = await supabase.storage.from('pieces-jointes').createSignedUrl(m.piece_jointe_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const titre = enTete?.type === 'groupe' ? `# ${enTete.nom}` : enTete?.autre_membre_nom || t('conversation')

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-4xl mx-auto">
      <div className="flex items-center gap-3 p-3 border-b border-line shrink-0">
        <button onClick={onRetour} className="text-petrol-500">←</button>
        <h1 className="font-semibold">{titre}</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {chargement ? (
          <p className="text-sm text-petrol-500 text-center">{t('chargement')}</p>
        ) : (
          <>
            {messages.map((m) => {
              const estMoi = m.expediteur_id === profil?.id
              return (
                <div key={m.id} className={`flex ${estMoi ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${estMoi ? 'bg-petrol-800 text-white' : 'bg-canvas border border-line'}`}>
                    {!estMoi && <p className="text-xs font-medium text-petrol-500 mb-0.5">{m.profils?.nom}</p>}
                    {m.contenu && <p className="whitespace-pre-wrap break-words">{m.contenu}</p>}
                    {m.piece_jointe_path && (
                      m.piece_jointe_type?.startsWith('image/') && urlsPieces[m.id] ? (
                        <button onClick={() => ouvrirPieceJointe(m)}>
                          <img src={urlsPieces[m.id]} alt="" className="rounded mt-1 max-h-48 object-cover" />
                        </button>
                      ) : (
                        <button onClick={() => ouvrirPieceJointe(m)} className={`flex items-center gap-1 mt-1 underline text-xs ${estMoi ? 'text-white' : 'text-blue-600'}`}>
                          📎 {m.piece_jointe_nom || t('piecesJointe')}
                        </button>
                      )
                    )}
                    <p className={`text-xs mt-1 ${estMoi ? 'text-petrol-200' : 'text-petrol-400'}`}>
                      {formatDateHeure(m.created_at, { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              )
            })}
            {messages.length === 0 && <p className="text-petrol-400 text-center text-sm py-8">{t('debutConversation')}</p>}
            <div ref={finListe} />
          </>
        )}
      </div>

      <div className="p-3 border-t border-line shrink-0">
        {fichier && (
          <div className="flex items-center justify-between bg-canvas rounded px-2 py-1 mb-2 text-xs">
            <span className="truncate">📎 {fichier.name}</span>
            <button onClick={() => setFichier(null)} className="text-red-600 ml-2">✕</button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <label className="shrink-0 cursor-pointer text-petrol-500 p-2">
            📎
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => setFichier(e.target.files?.[0] || null)}
            />
          </label>
          <textarea
            className="flex-1 border rounded-lg px-3 py-2 text-sm resize-none"
            rows={1}
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            placeholder={t('ecrireMessage')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                envoyer()
              }
            }}
          />
          <button
            onClick={envoyer}
            disabled={envoi || (!texte.trim() && !fichier)}
            className="bg-petrol-800 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-40 shrink-0"
          >
            {envoi ? '…' : t('envoyer')}
          </button>
        </div>
      </div>
    </div>
  )
}
