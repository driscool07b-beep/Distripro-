import { useEffect, useRef, useState } from 'react'

// Interaction vocale : dictée (reconnaissance vocale du navigateur, sans
// coût) et lecture à voix haute des réponses.
const LANGUES = { fr: 'fr-FR', en: 'en-US', ar: 'ar-SA', zh: 'zh-CN' }
const Reconnaissance = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

export const dicteeDisponible = !!Reconnaissance
export const lectureDisponible = typeof window !== 'undefined' && 'speechSynthesis' in window

// Dictée CONTINUE : le micro reste ouvert pendant les pauses naturelles ;
// la demande part quand on rappuie sur le micro, ou après un silence prolongé.
const SILENCE_FIN_MS = 3500

// Sur Android, Chrome renvoie souvent chaque morceau de la dictée comme un
// nouveau résultat CUMULATIF (« fais-moi », « fais-moi la », « fais-moi la
// facture »…) : les mettre bout à bout répète et colle les mots. On fusionne
// donc intelligemment : un résultat qui prolonge le texte le remplace, un
// résultat déjà contenu à la fin est ignoré, un chevauchement n'est gardé
// qu'une fois.
const normaliser = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
export function fusionnerDictee(acc, morceau) {
  const a = (acc || '').trim()
  const b = (morceau || '').trim()
  if (!a) return b
  if (!b) return a
  const na = normaliser(a)
  const nb = normaliser(b)
  if (!nb) return a
  if (nb.startsWith(na)) return b
  if (na.endsWith(nb)) return a
  // Chevauchement mot à mot : fin de a = début de b.
  const ma = a.split(/\s+/)
  const mb = b.split(/\s+/)
  for (let k = Math.min(ma.length, mb.length); k > 0; k--) {
    if (normaliser(ma.slice(-k).join(' ')) === normaliser(mb.slice(0, k).join(' '))) {
      return [...ma, ...mb.slice(k)].join(' ')
    }
  }
  return `${a} ${b}`
}

export function useDictee({ langue = 'fr', onFinal }) {
  const [ecoute, setEcoute] = useState(false)
  const [provisoire, setProvisoire] = useState('')
  const [erreur, setErreur] = useState('')
  const reco = useRef(null)
  const texteFinal = useRef('')
  const rappel = useRef(onFinal)
  rappel.current = onFinal
  const minuterieSilence = useRef(null)
  const relancerMinuterie = (delai = SILENCE_FIN_MS) => {
    clearTimeout(minuterieSilence.current)
    minuterieSilence.current = setTimeout(() => reco.current?.stop?.(), delai)
  }

  useEffect(() => () => { clearTimeout(minuterieSilence.current); reco.current?.abort?.() }, [])

  function demarrer() {
    if (!Reconnaissance || ecoute) return
    setErreur('')
    texteFinal.current = ''
    setProvisoire('')
    const r = new Reconnaissance()
    r.lang = LANGUES[langue] || 'fr-FR'
    r.interimResults = true
    r.continuous = true
    r.maxAlternatives = 1
    r.onresult = (e) => {
      let fin = ''
      let encours = ''
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin = fusionnerDictee(fin, e.results[i][0].transcript)
        else encours = fusionnerDictee(encours, e.results[i][0].transcript)
      }
      texteFinal.current = fin
      setProvisoire(fusionnerDictee(fin, encours))
      relancerMinuterie()
    }
    r.onerror = (e) => {
      setErreur(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'micro' : e.error === 'no-speech' ? 'silence' : 'reseau')
    }
    r.onend = () => {
      clearTimeout(minuterieSilence.current)
      setEcoute(false)
      const texte = (texteFinal.current || '').trim()
      setProvisoire('')
      if (texte) rappel.current?.(texte)
    }
    reco.current = r
    setEcoute(true)
    try { r.start(); relancerMinuterie(7000) } catch { setEcoute(false) }
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
