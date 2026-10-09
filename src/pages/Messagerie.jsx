import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import Avatar from '../components/Avatar'
import ZoneTexteAuto from '../components/ZoneTexteAuto'
import IconeMicro from '../components/IconeMicro'
import { useAuth } from '../context/AuthContext'
import { formatDateHeure } from '../lib/format'

// Marque une conversation comme lue, puis prévient le menu (badge) et retire
// les notifications du téléphone qui concernent cette conversation.
async function marquerLue(conversationId) {
  await supabase.rpc('marquer_conversation_lue', { p_conversation_id: conversationId })
  window.dispatchEvent(new Event('messagerie-lue'))
  try {
    const reg = await navigator.serviceWorker?.ready
    const notifs = (await reg?.getNotifications?.()) || []
    notifs
      .filter((n) => n.tag === `conv-${conversationId}` || (!n.tag && n.data?.url === '/messagerie'))
      .forEach((n) => n.close())
  } catch { /* notifications non disponibles : sans importance */ }
}

// Format d'enregistrement vocal pris en charge par le navigateur
// (WebM/Opus sur Android et ordinateur, MP4/AAC sur iPhone).
function formatVocal() {
  if (typeof MediaRecorder === 'undefined') return null
  for (const f of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(f)) return f
  }
  return ''
}
const VOCAL_MAX_S = 300 // 5 minutes au plus
const duree = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// Libellé du jour pour les séparateurs du fil (« Aujourd'hui », « Hier », date).
function libelleJour(date, t) {
  const d = new Date(date)
  const auj = new Date()
  const hier = new Date(); hier.setDate(auj.getDate() - 1)
  const meme = (a, b) => a.toDateString() === b.toDateString()
  if (meme(d, auj)) return t('aujourdhui')
  if (meme(d, hier)) return t('hier')
  return formatDateHeure(d, { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== auj.getFullYear() ? { year: 'numeric' } : {}) })
}

// Heure du dernier message dans la liste, façon WhatsApp :
// l'heure aujourd'hui, « Hier », sinon la date.
function libelleListe(date, t) {
  const d = new Date(date)
  const auj = new Date()
  const hier = new Date(); hier.setDate(auj.getDate() - 1)
  if (d.toDateString() === auj.toDateString()) return formatDateHeure(d, { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === hier.toDateString()) return t('hier')
  return formatDateHeure(d, { day: '2-digit', month: '2-digit', ...(d.getFullYear() !== auj.getFullYear() ? { year: '2-digit' } : {}) })
}

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

  // Liste ouverte : un nouveau message (ou une suppression) met à jour
  // les compteurs « non lus » et les aperçus sans recharger la page.
  useEffect(() => {
    if (conversationOuverte) return
    const canal = supabase
      .channel('messagerie-liste')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => charger(true))
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [conversationOuverte])

  async function charger(silencieux = false) {
    if (!silencieux) setChargement(true)
    const { data } = await supabase.rpc('mes_conversations')
    setConversations(data || [])
    setChargement(false)
  }

  async function chargerCollegues() {
    const { data } = await supabase
      .from('profils')
      .select('id, nom, photo_path')
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
          await marquerLue(conversationOuverte)
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
          {conversations.map((c) => {
            const nonLus = Number(c.non_lus) || 0
            return (
            <button
              key={c.conversation_id}
              onClick={() => setConversationOuverte(c.conversation_id)}
              className={`w-full text-left border rounded-lg p-3 flex items-center gap-3 hover:bg-canvas/60 ${nonLus > 0 ? 'border-emerald-300 bg-emerald-50/50' : 'border-line'}`}
            >
              {c.type === 'groupe' ? (
                <span className="shrink-0 w-10 h-10 rounded-full bg-petrol-800 text-white inline-flex items-center justify-center font-semibold">#</span>
              ) : (
                <Avatar nom={c.autre_membre_nom} chemin={c.autre_membre_photo} taille={40} />
              )}
              <div className="min-w-0 flex-1">
                <p className={`text-sm truncate ${nonLus > 0 ? 'font-bold' : 'font-medium'}`}>
                  {c.type === 'groupe' ? `# ${c.nom}` : c.autre_membre_nom || t('utilisateurSupprime')}
                </p>
                <p className={`text-xs truncate ${nonLus > 0 ? 'text-petrol-900 font-semibold' : 'text-petrol-500'}`}>
                  {c.dernier_message_supprime
                    ? `🚫 ${t('messageSupprime')}`
                    : c.dernier_message
                    ? `${c.dernier_expediteur_nom ? c.dernier_expediteur_nom + ' : ' : ''}${c.dernier_message}`
                    : c.dernier_message_a_piece_jointe
                    ? t('piecesJointe')
                    : t('aucunMessage')}
                </p>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1 ml-1">
                {c.dernier_message_at && (
                  <span className={`text-xs ${nonLus > 0 ? 'text-emerald-700 font-semibold' : 'text-petrol-400'}`}>
                    {libelleListe(c.dernier_message_at, t)}
                  </span>
                )}
                {nonLus > 0 ? (
                  <span
                    className="min-w-[1.375rem] h-[1.375rem] px-1.5 rounded-full bg-emerald-600 text-white text-xs font-bold inline-flex items-center justify-center"
                    aria-label={t('nonLus', { count: nonLus })}
                  >
                    {nonLus > 99 ? '99+' : nonLus}
                  </span>
                ) : (
                  <span className="h-[1.375rem]" aria-hidden="true" />
                )}
              </div>
            </button>
            )
          })}
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
                  className="w-full text-left px-3 py-2 rounded hover:bg-canvas text-sm flex items-center gap-2.5"
                >
                  <Avatar nom={col.nom} chemin={col.photo_path} taille={30} />
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
              <Avatar nom={col.nom} chemin={col.photo_path} taille={24} />
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
  const [messageChoisi, setMessageChoisi] = useState(null) // message dont on ouvre le menu « Supprimer »
  const [erreurSuppression, setErreurSuppression] = useState('')
  // Message vocal (façon WhatsApp) : enregistrement, puis envoi ou annulation.
  const [vocal, setVocal] = useState(null) // null | { secondes }
  const [erreurVocal, setErreurVocal] = useState('')
  const enregistreur = useRef(null)
  const morceaux = useRef([])
  const minuterieVocal = useRef(null)
  const vocalDisponible = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && formatVocal() !== null
  const finListe = useRef(null)

  useEffect(() => {
    charger()
    marquerLue(conversationId)

    const canal = supabase
      .channel(`messages-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new])
          marquerLue(conversationId)
        }
      )
      // Message supprimé pour tout le monde par son expéditeur : mis à jour en direct.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => setMessages((prev) => prev.map((m) => (m.id === payload.new.id ? { ...m, ...payload.new } : m)))
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

    // « profils!expediteur_id » : la table messages_masques relie aussi
    // messages et profils ; sans cette précision, Supabase refuse la requête
    // (relation ambiguë) et la conversation s'affiche vide.
    const { data, error } = await supabase
      .from('messages')
      .select('id, contenu, piece_jointe_path, piece_jointe_nom, piece_jointe_type, expediteur_id, created_at, supprime_pour_tous, profils!expediteur_id(nom, photo_path)')
      .eq('conversation_id', conversationId)
      .order('created_at')
    if (error) console.error('Chargement des messages :', error.message)
    // Messages que j'ai supprimés « pour moi » : on ne les affiche plus.
    const { data: masques } = await supabase.from('messages_masques').select('message_id')
    const idsMasques = new Set((masques || []).map((x) => x.message_id))
    setMessages((data || []).filter((m) => !idsMasques.has(m.id)))
    setChargement(false)

  }

  // Liens temporaires des images et messages vocaux, y compris pour les
  // messages arrivés en direct.
  const demandes = useRef(new Set())
  useEffect(() => {
    for (const m of messages) {
      const media = m.piece_jointe_type?.startsWith('image/') || m.piece_jointe_type?.startsWith('audio/')
      if (!m.piece_jointe_path || !media || demandes.current.has(m.id)) continue
      demandes.current.add(m.id)
      supabase.storage.from('pieces-jointes').createSignedUrl(m.piece_jointe_path, 3600).then(({ data: signed }) => {
        if (signed?.signedUrl) setUrlsPieces((prev) => ({ ...prev, [m.id]: signed.signedUrl }))
      })
    }
  }, [messages])

  useEffect(() => () => { clearInterval(minuterieVocal.current); arreterMicro() }, [])

  function arreterMicro() {
    try { enregistreur.current?.stream?.getTracks().forEach((piste) => piste.stop()) } catch { /* ignore */ }
  }

  async function demarrerVocal() {
    setErreurVocal('')
    try {
      const flux = await navigator.mediaDevices.getUserMedia({ audio: true })
      const format = formatVocal()
      const rec = new MediaRecorder(flux, format ? { mimeType: format } : undefined)
      morceaux.current = []
      rec.ondataavailable = (e) => { if (e.data?.size) morceaux.current.push(e.data) }
      rec.start(250)
      enregistreur.current = rec
      setVocal({ secondes: 0 })
      minuterieVocal.current = setInterval(() => {
        setVocal((v) => {
          if (!v) return v
          if (v.secondes + 1 >= VOCAL_MAX_S) { setTimeout(() => terminerVocal(true), 0) }
          return { secondes: v.secondes + 1 }
        })
      }, 1000)
    } catch {
      setErreurVocal(t('vocalMicroRefuse'))
    }
  }

  // envoyer = true : on envoie l'enregistrement ; false : on l'annule.
  function terminerVocal(envoyerVocal) {
    const rec = enregistreur.current
    clearInterval(minuterieVocal.current)
    setVocal(null)
    if (!rec) return
    enregistreur.current = null
    rec.onstop = async () => {
      rec.stream.getTracks().forEach((piste) => piste.stop())
      if (!envoyerVocal || !morceaux.current.length) return
      const type = (rec.mimeType || 'audio/webm').split(';')[0]
      const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
      const blob = new Blob(morceaux.current, { type })
      if (blob.size < 1500) return // clic trop bref : rien d'audible
      setEnvoi(true)
      const nom = `vocal-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${extension}`
      const chemin = `${entreprise?.id}/messagerie/${conversationId}/${Date.now()}-${nom}`
      const { error: erreurUpload } = await supabase.storage.from('pieces-jointes').upload(chemin, blob, { contentType: type })
      if (erreurUpload) { setEnvoi(false); setErreurVocal(t('vocalEchec')); return }
      const { data: messageId } = await supabase.rpc('envoyer_message', {
        p_conversation_id: conversationId,
        p_contenu: '',
        p_piece_jointe_path: chemin,
        p_piece_jointe_nom: nom,
        p_piece_jointe_type: type,
      })
      if (messageId) supabase.functions.invoke('envoyer-notification-push', { body: { message_id: messageId } }).catch(() => {})
      setEnvoi(false)
    }
    rec.stop()
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

  async function supprimer(pourTous) {
    if (!messageChoisi) return
    setErreurSuppression('')
    const { error } = await supabase.rpc('supprimer_message', { p_message_id: messageChoisi.id, p_pour_tous: pourTous })
    if (error) { setErreurSuppression(error.message); return }
    setMessages((prev) => (pourTous
      ? prev.map((m) => (m.id === messageChoisi.id ? { ...m, contenu: null, piece_jointe_path: null, supprime_pour_tous: true } : m))
      : prev.filter((m) => m.id !== messageChoisi.id)))
    setMessageChoisi(null)
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
            {messages.map((m, index) => {
              const estMoi = m.expediteur_id === profil?.id
              // Photo affichée une seule fois par suite de messages du même auteur.
              const nouveauJour = index === 0 || new Date(messages[index - 1].created_at).toDateString() !== new Date(m.created_at).toDateString()
              const debutSerie = nouveauJour || messages[index - 1].expediteur_id !== m.expediteur_id
              return (
                <div key={m.id}>
                {nouveauJour && (
                  <div className="flex justify-center my-2">
                    <span className="text-[11px] bg-canvas border border-line text-petrol-500 rounded-full px-3 py-0.5 first-letter:uppercase">{libelleJour(m.created_at, t)}</span>
                  </div>
                )}
                <div className={`flex items-end gap-2 ${estMoi ? 'justify-end' : 'justify-start'} ${debutSerie ? 'pt-1.5' : ''}`}>
                  {!estMoi && (debutSerie
                    ? <Avatar nom={m.profils?.nom} chemin={m.profils?.photo_path} taille={30} className="self-start" />
                    : <span className="w-[30px] shrink-0" />)}
                  <div
                    role="button"
                    tabIndex={0}
                    title={t('supprimer')}
                    onClick={() => { setErreurSuppression(''); setMessageChoisi(m) }}
                    className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm cursor-pointer ${estMoi ? 'bg-petrol-800 text-white rounded-br-md' : 'bg-white border border-line rounded-bl-md'}`}
                  >
                    {!estMoi && debutSerie && <p className="text-xs font-medium text-petrol-500 mb-0.5">{m.profils?.nom}</p>}
                    {m.supprime_pour_tous && (
                      <p className={`italic ${estMoi ? 'text-petrol-200' : 'text-petrol-400'}`}>🚫 {estMoi ? t('vousAvezSupprime') : t('messageSupprime')}</p>
                    )}
                    {m.contenu && <p className="whitespace-pre-wrap break-words">{m.contenu}</p>}
                    {m.piece_jointe_path && m.piece_jointe_type?.startsWith('audio/') ? (
                      <div onClick={(e) => e.stopPropagation()} className="mt-1">
                        {urlsPieces[m.id]
                          ? <audio controls preload="metadata" src={urlsPieces[m.id]} className="max-w-[240px] h-10" />
                          : <span className="text-xs">🎤 {t('vocal')}</span>}
                      </div>
                    ) : m.piece_jointe_path && (
                      m.piece_jointe_type?.startsWith('image/') && urlsPieces[m.id] ? (
                        <button onClick={(e) => { e.stopPropagation(); ouvrirPieceJointe(m) }}>
                          <img src={urlsPieces[m.id]} alt="" className="rounded mt-1 max-h-48 object-cover" />
                        </button>
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); ouvrirPieceJointe(m) }} className={`flex items-center gap-1 mt-1 underline text-xs ${estMoi ? 'text-white' : 'text-blue-600'}`}>
                          📎 {m.piece_jointe_nom || t('piecesJointe')}
                        </button>
                      )
                    )}
                    <p className={`text-xs mt-1 ${estMoi ? 'text-petrol-200' : 'text-petrol-400'}`}>
                      {formatDateHeure(m.created_at, { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                </div>
              )
            })}
            {messages.length === 0 && <p className="text-petrol-400 text-center text-sm py-8">{t('debutConversation')}</p>}
            <div ref={finListe} />
          </>
        )}
      </div>

      {messageChoisi && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={() => setMessageChoisi(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-2 space-y-1" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs text-petrol-500 px-3 pt-2 pb-1 truncate">
              {messageChoisi.supprime_pour_tous ? t('messageSupprime') : (messageChoisi.contenu || messageChoisi.piece_jointe_nom || t('piecesJointe'))}
            </p>
            {messageChoisi.expediteur_id === profil?.id && !messageChoisi.supprime_pour_tous
              && new Date(messageChoisi.created_at) > new Date(Date.now() - 48 * 3600 * 1000) && (
              <button onClick={() => supprimer(true)} className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-red-50 text-red-700 text-sm">
                🗑️ {t('supprimerPourTous')}
              </button>
            )}
            <button onClick={() => supprimer(false)} className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-canvas text-sm">
              🙈 {t('supprimerPourMoi')}
            </button>
            {erreurSuppression && <p className="text-xs text-red-600 px-3">{erreurSuppression}</p>}
            <button onClick={() => setMessageChoisi(null)} className="w-full text-center px-3 py-2.5 rounded-lg text-petrol-500 text-sm border-t border-line">
              {t('annuler')}
            </button>
          </div>
        </div>
      )}

      <div className="p-3 border-t border-line shrink-0">
        {fichier && (
          <div className="flex items-center justify-between bg-canvas rounded px-2 py-1 mb-2 text-xs">
            <span className="truncate">📎 {fichier.name}</span>
            <button onClick={() => setFichier(null)} className="text-red-600 ml-2">✕</button>
          </div>
        )}
        {erreurVocal && <p className="text-xs text-red-600 mb-1">{erreurVocal}</p>}
        {vocal ? (
          <div className="flex items-center gap-2">
            <button onClick={() => terminerVocal(false)} className="shrink-0 text-red-600 p-2" title={t('annuler')}>🗑️</button>
            <div className="flex-1 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
              {t('vocalEnregistrement')} {duree(vocal.secondes)}
            </div>
            <button onClick={() => terminerVocal(true)} className="bg-petrol-800 text-white rounded-lg px-4 py-2 text-sm shrink-0">
              {t('envoyer')}
            </button>
          </div>
        ) : (
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
          <ZoneTexteAuto
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            onEnvoyer={envoyer}
            maxLignes={6}
            placeholder={t('ecrireMessage')}
          />
          {!texte.trim() && !fichier && vocalDisponible ? (
            <button
              onClick={demarrerVocal}
              disabled={envoi}
              title={t('vocalEnregistrer')}
              className="bg-petrol-800 text-white rounded-full w-10 h-10 flex items-center justify-center disabled:opacity-40 shrink-0"
            >
              {envoi ? '…' : <IconeMicro />}
            </button>
          ) : (
          <button
            onClick={envoyer}
            disabled={envoi || (!texte.trim() && !fichier)}
            className="bg-petrol-800 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-40 shrink-0"
          >
            {envoi ? '…' : t('envoyer')}
          </button>
          )}
        </div>
        )}
      </div>
    </div>
  )
}
