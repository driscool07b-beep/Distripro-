import { useEffect, useRef, useState } from 'react'

// Interaction vocale : dictée (reconnaissance vocale du navigateur, sans
// coût) et lecture à voix haute des réponses.
const LANGUES = { fr: 'fr-FR', en: 'en-US', ar: 'ar-SA', zh: 'zh-CN' }
const Reconnaissance = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

export const dicteeDisponible = !!Reconnaissance
export const lectureDisponible = typeof window !== 'undefined' && 'speechSynthesis' in window

// Dictée : texte provisoire pendant qu'on parle, texte final à la fin.
export function useDictee({ langue = 'fr', onFinal }) {
  const [ecoute, setEcoute] = useState(false)
  const [provisoire, setProvisoire] = useState('')
  const [erreur, setErreur] = useState('')
  const reco = useRef(null)
  const texteFinal = useRef('')
  const rappel = useRef(onFinal)
  rappel.current = onFinal

  useEffect(() => () => reco.current?.abort?.(), [])

  function demarrer() {
    if (!Reconnaissance || ecoute) return
    setErreur('')
    texteFinal.current = ''
    setProvisoire('')
    const r = new Reconnaissance()
    r.lang = LANGUES[langue] || 'fr-FR'
    r.interimResults = true
    r.continuous = false
    r.maxAlternatives = 1
    r.onresult = (e) => {
      let fin = ''
      let encours = ''
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript
        else encours += e.results[i][0].transcript
      }
      texteFinal.current = fin
      setProvisoire((fin + ' ' + encours).trim())
    }
    r.onerror = (e) => {
      setErreur(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'micro' : e.error === 'no-speech' ? 'silence' : 'reseau')
    }
    r.onend = () => {
      setEcoute(false)
      const texte = (texteFinal.current || '').trim()
      setProvisoire('')
      if (texte) rappel.current?.(texte)
    }
    reco.current = r
    setEcoute(true)
    try { r.start() } catch { setEcoute(false) }
  }

  function arreter() { reco.current?.stop?.() }

  return { ecoute, provisoire, erreur, demarrer, arreter }
}

// Lecture à voix haute (sans la mise en forme : astérisques, puces…).
export function lireTexte(texte, langue = 'fr') {
  if (!lectureDisponible || !texte) return
  window.speechSynthesis.cancel()
  const propre = String(texte).replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/^[-•]\s*/gm, '').replace(/F CFA/g, 'francs CFA')
  const u = new SpeechSynthesisUtterance(propre.slice(0, 1200))
  u.lang = LANGUES[langue] || 'fr-FR'
  u.rate = 1.05
  window.speechSynthesis.speak(u)
}

export function arreterLecture() { if (lectureDisponible) window.speechSynthesis.cancel() }
