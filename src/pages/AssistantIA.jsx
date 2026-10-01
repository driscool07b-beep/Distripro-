import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { analyserTexte } from '../lib/exportAnalyse'
import RapportPowerPoint from '../components/RapportPowerPoint'

// Assistant conversationnel : questions en langage courant sur les chiffres
// de l'entreprise. Les réponses s'appuient sur les vraies données, dans la
// limite des droits de l'utilisateur.
export default function AssistantIA() {
  const { t } = useTranslation('assistant')
  const { profil } = useAuth()
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState('')
  const finRef = useRef(null)

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, enCours])

  const suggestions = profil?.role === 'gestionnaire_stock'
    ? ['stock1', 'stock2', 'stock3']
    : profil?.role === 'commercial'
      ? ['com1', 'com2', 'com3', 'com4']
      : ['dir1', 'dir2', 'dir3', 'dir4', 'dir5', 'dir6']

  async function envoyer(texte) {
    const q = (texte ?? question).trim()
    if (!q || enCours) return
    setErreur('')
    const suite = [...messages, { role: 'user', content: q }]
    setMessages(suite)
    setQuestion('')
    setEnCours(true)
    const { data, error } = await supabase.functions.invoke('assistant-ia', { body: { messages: suite } })
    setEnCours(false)
    if (error) {
      let message = error.message
      try { message = (await error.context?.json())?.error || message } catch { /* ignore */ }
      setErreur(message)
      return
    }
    setMessages([...suite, { role: 'assistant', content: data?.reponse || '' }])
  }

  if (profil?.ia_active === false) {
    return <div className="p-6 text-sm text-petrol-500">{t('iaDesactivee')}</div>
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto flex flex-col" style={{ minHeight: 'calc(100vh - 7rem)' }}>
      <h1 className="text-xl font-bold mb-1">✨ {t('titre')}</h1>
      <p className="text-sm text-petrol-500 mb-4">{t('sousTitre')}</p>
      {['admin', 'manager', 'comptable', 'commercial'].includes(profil?.role) && (
        <div className="mb-4"><RapportPowerPoint /></div>
      )}

      <div className="flex-1 space-y-3 mb-4">
        {messages.length === 0 && (
          <div className="card p-4">
            <p className="text-sm font-medium mb-2">{t('essayez')}</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => envoyer(t(`suggestions.${s}`))}
                  className="text-left text-sm rounded-full border border-line bg-white px-3 py-1.5 hover:border-amber-400 hover:bg-amber-50">
                  {t(`suggestions.${s}`)}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === 'user' ? 'bg-petrol-800 text-white rounded-br-md' : 'card rounded-bl-md space-y-1.5'}`}>
              {m.role === 'user' ? m.content : analyserTexte(m.content).map((b, j) =>
                b.type === 'titre' ? (
                  <p key={j} className="font-semibold text-petrol-900 pt-1">{b.texte}</p>
                ) : (
                  <p key={j} className={b.type === 'puce' ? 'ps-4 relative before:content-["•"] before:absolute before:start-1 before:text-amber-600' : ''}>
                    {b.segments.map((sg, k) => (sg.gras ? <strong key={k}>{sg.texte}</strong> : <span key={k}>{sg.texte}</span>))}
                  </p>
                )
              )}
            </div>
          </div>
        ))}
        {enCours && (
          <div className="flex justify-start">
            <div className="card rounded-2xl rounded-bl-md px-4 py-3 text-sm text-petrol-500">
              <span className="inline-block animate-pulse">{t('reflexion')}</span>
            </div>
          </div>
        )}
        {erreur && <p className="text-sm text-red-600">{erreur}</p>}
        <div ref={finRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); envoyer() }} className="sticky bottom-0 bg-canvas pt-2 pb-2 flex gap-2">
        <input className="input-field flex-1" value={question} onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('placeholder')} disabled={enCours} maxLength={1000} />
        <button type="submit" className="btn-primary px-4" disabled={enCours || !question.trim()}>{t('envoyer')}</button>
      </form>
      {messages.length > 0 && (
        <button className="text-xs text-petrol-500 underline self-center" onClick={() => { setMessages([]); setErreur('') }}>{t('nouvelleConversation')}</button>
      )}
      <p className="text-[11px] text-petrol-400 text-center mt-2">{t('avertissement')}</p>
    </div>
  )
}
