import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { analyserTexte } from '../lib/analyseTexte'
import { extraitsGuide } from '../lib/guideAide'
import { useDictee, dicteeDisponible, lectureDisponible, lireTexte, arreterLecture } from '../lib/voix'
import FicheConfirmationAction from './FicheConfirmationAction'
import CartePiece from './CartePiece'
import FicheConfirmationAutre from './FicheConfirmationAutre'
import FicheConfirmationStock from './FicheConfirmationStock'
import { lireConfigFne } from '../lib/fne'

const CLE_VOIX = 'distribpro-assistant-voix'

// Conversation avec l'assistant : questions sur les chiffres, aide à
// l'utilisation, et saisie dictée de ventes / commandes (avec fiche de
// confirmation). Utilisée par la page « Assistant IA » et par la bulle.
export default function ConversationAssistant({ compact = false, onNavigation }) {
  const { t, i18n } = useTranslation('assistant')
  const { profil } = useAuth()
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState('')
  const [voixActive, setVoixActive] = useState(() => { try { return localStorage.getItem(CLE_VOIX) === '1' } catch { return false } })
  const finRef = useRef(null)
  const [fneActive, setFneActive] = useState(false)
  useEffect(() => { lireConfigFne().then((c) => setFneActive(!!c.actif)) }, [])
  const langue = (i18n.language || 'fr').slice(0, 2)

  const dictee = useDictee({ langue, onFinal: (texte) => envoyer(texte) })

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, enCours, dictee.provisoire])
  useEffect(() => () => arreterLecture(), [])

  const suggestions = profil?.role === 'gestionnaire_stock'
    ? ['mag1', 'mag2', 'mag3', 'mag4', 'mag5', 'stock1']
    : profil?.role === 'commercial'
      ? ['saisie1', 'saisie3', 'saisie4', 'saisie5', 'piece1', 'com2']
      : compact ? ['saisie1', 'piece1', 'dir1', 'aide1'] : ['saisie1', 'saisie2', 'saisie3', 'saisie4', 'piece1', 'dir1', 'dir2', 'dir3', 'dir4', 'aide1', 'aide2']

  function basculerVoix() {
    const v = !voixActive
    setVoixActive(v)
    try { localStorage.setItem(CLE_VOIX, v ? '1' : '0') } catch { /* ignore */ }
    if (!v) arreterLecture()
  }

  async function envoyer(texte) {
    const q = (texte ?? question).trim()
    if (!q || enCours) return
    setErreur('')
    arreterLecture()
    // Historique transmis : seulement le texte (les fiches restent locales).
    const suite = [...messages, { role: 'user', content: q }]
    setMessages(suite)
    setQuestion('')
    setEnCours(true)
    let page = ''
    try { page = sessionStorage.getItem('distribpro-derniere-page') || '' } catch { /* ignore */ }
    const historique = suite.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content }))
    const aide = extraitsGuide(`${q} ${historique.slice(-3, -1).map((m) => m.content).join(' ')}`)
    const { data, error } = await supabase.functions.invoke('assistant-ia', { body: { messages: historique, aide, page } })
    setEnCours(false)
    if (error) {
      let message = error.message
      try { message = (await error.context?.json())?.error || message } catch { /* ignore */ }
      setErreur(message)
      return
    }
    const reponse = data?.reponse || ''
    setMessages([...suite, { role: 'assistant', content: reponse, action: data?.action || null }])
    if (voixActive) lireTexte(reponse, langue)
  }

  // Une fiche validée ou annulée laisse une trace dans la conversation.
  function finFiche(message) {
    if (!message) return
    setMessages((m) => [...m, { role: 'assistant', content: message }])
    if (voixActive) lireTexte(message, langue)
  }

  const messageErreurMicro = dictee.erreur === 'micro' ? t('voix.microRefuse') : dictee.erreur === 'silence' ? t('voix.silence') : dictee.erreur ? t('voix.erreur') : ''

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className={`flex-1 min-h-0 overflow-y-auto space-y-3 ${compact ? 'px-3 py-3' : 'mb-4'}`}>
        {messages.length === 0 && (
          <div className={compact ? '' : 'card p-4'}>
            <p className="text-sm font-medium mb-2">{t('essayez')}</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => envoyer(t(`suggestions.${s}`))}
                  className="text-left text-xs rounded-full border border-line bg-white px-3 py-1.5 hover:border-amber-400 hover:bg-amber-50">
                  {t(`suggestions.${s}`)}
                </button>
              ))}
            </div>
            {dicteeDisponible && <p className="text-[11px] text-petrol-500 mt-3">🎤 {t('voix.astuce')}</p>}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col gap-2 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            {m.content && (
              <div className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${m.role === 'user' ? 'bg-petrol-800 text-white rounded-br-md' : 'bg-white border border-line rounded-bl-md space-y-1.5'}`}>
                {m.role === 'user' ? m.content : analyserTexte(m.content).map((b, j) =>
                  b.type === 'titre' ? <p key={j} className="font-semibold text-petrol-900 pt-1">{b.texte}</p> : (
                    <p key={j} className={b.type === 'puce' ? 'ps-4 relative before:content-["•"] before:absolute before:start-1 before:text-amber-600' : ''}>
                      {b.segments.map((sg, k) => (sg.gras ? <strong key={k}>{sg.texte}</strong> : <span key={k}>{sg.texte}</span>))}
                    </p>
                  ))}
              </div>
            )}
            {m.action && ['vente', 'commande'].includes(m.action.type) && (
              <div className="w-full max-w-[92%]"><FicheConfirmationAction action={m.action} onTermine={finFiche} fneActive={fneActive} onNavigation={onNavigation} /></div>
            )}
            {m.action && ['encaissement', 'client', 'visite'].includes(m.action.type) && (
              <div className="w-full max-w-[92%]"><FicheConfirmationAutre action={m.action} onTermine={finFiche} onNavigation={onNavigation} /></div>
            )}
            {m.action && ['reception', 'sortie', 'demande_sortie', 'transfert', 'commande_preparer', 'commande_livrer'].includes(m.action.type) && (
              <div className="w-full max-w-[92%]"><FicheConfirmationStock action={m.action} onTermine={finFiche} onNavigation={onNavigation} /></div>
            )}
            {m.action?.type === 'pieces' && (
              <div className="w-full max-w-[92%] space-y-1.5">
                {m.action.pieces.map((p) => <CartePiece key={`${p.type}-${p.id}`} piece={p} fneActive={fneActive} onAction={onNavigation} />)}
              </div>
            )}
          </div>
        ))}
        {(enCours || dictee.provisoire) && (
          <div className={`flex ${dictee.provisoire ? 'justify-end' : 'justify-start'}`}>
            <div className={`rounded-2xl px-3.5 py-2.5 text-sm ${dictee.provisoire ? 'bg-petrol-800/70 text-white' : 'bg-white border border-line text-petrol-500'}`}>
              <span className="animate-pulse">{dictee.provisoire || t('reflexion')}</span>
            </div>
          </div>
        )}
        {(erreur || messageErreurMicro) && <p className="text-xs text-red-600">{erreur || messageErreurMicro}</p>}
        <div ref={finRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); envoyer() }} className={`flex gap-2 items-center ${compact ? 'p-2 border-t border-line bg-white' : 'sticky bottom-0 bg-canvas pt-2 pb-2'}`}>
        {dicteeDisponible && (
          <button type="button" onClick={() => (dictee.ecoute ? dictee.arreter() : dictee.demarrer())} disabled={enCours}
            title={dictee.ecoute ? t('voix.arreter') : t('voix.parler')}
            className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg border ${dictee.ecoute ? 'bg-red-600 border-red-600 text-white animate-pulse' : 'bg-white border-line'}`}>
            🎤
          </button>
        )}
        <input className="input-field flex-1 !py-2" value={question} onChange={(e) => setQuestion(e.target.value)}
          placeholder={dictee.ecoute ? t('voix.ecoute') : t('placeholder')} disabled={enCours} maxLength={1000} />
        {lectureDisponible && (
          <button type="button" onClick={basculerVoix} title={voixActive ? t('voix.couper') : t('voix.activer')}
            className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center border ${voixActive ? 'bg-amber-100 border-amber-300' : 'bg-white border-line'}`}>
            {voixActive ? '🔊' : '🔈'}
          </button>
        )}
        <button type="submit" className="btn-primary px-3 !py-2 shrink-0" disabled={enCours || !question.trim()}>{t('envoyer')}</button>
      </form>
      {messages.length > 0 && (
        <button className="text-[11px] text-petrol-500 underline self-center py-1" onClick={() => { setMessages([]); setErreur(''); arreterLecture() }}>{t('nouvelleConversation')}</button>
      )}
    </div>
  )
}
