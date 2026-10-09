import { useEffect, useRef, useState } from 'react'

// Interaction vocale : dictée (reconnaissance vocale du navigateur, sans
// coût) et lecture à voix haute des réponses.
const LANGUES = { fr: 'fr-FR', en: 'en-US', ar: 'ar-SA', zh: 'zh-CN' }
const Reconnaissance = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

export const dicteeDisponible = !!Reconnaissance
export const lectureDisponible = typeof window !== 'undefined' && 'speechSynthesis' in window

// Dictée CONTINUE, au rythme de l'utilisateur : le micro reste ouvert tant
// qu'il n'a pas rappuyé dessus. Sur Android, Chrome coupe la reconnaissance
// après quelques secondes de pause : on la relance aussitôt, sans perdre le
// texte déjà dicté. Arrêt de sécurité après un long silence.
const SILENCE_MAX_MS = 30000
// Android : le mode « continu » de Chrome est peu fiable (sessions muettes,
// résultats répétés). On y enchaîne plutôt des sessions courtes.
const ANDROID = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '')

export function useDictee({ langue = 'fr', onFinal }) {
  const [ecoute, setEcoute] = useState(false)
  const [provisoire, setProvisoire] = useState('')
  const [erreur, setErreur] = useState('')
  const reco = useRef(null)
  const actif = useRef(false) // l'utilisateur veut continuer à dicter
  const base = useRef('') // texte des sessions de reconnaissance précédentes
  const sessionFin = useRef('') // texte définitif de la session en cours
  const sessionEnCours = useRef('') // texte encore provisoire de la session en cours
  const derniereActivite = useRef(0)
  const surveillance = useRef(null)
  const rappel = useRef(onFinal)
  rappel.current = onFinal

  useEffect(() => () => { actif.current = false; clearInterval(surveillance.current); reco.current?.abort?.() }, [])

  function terminer() {
    actif.current = false
    clearInterval(surveillance.current)
    setEcoute(false)
    const texte = fusionnerDictee(base.current, fusionnerDictee(sessionFin.current, sessionEnCours.current)).trim()
    base.current = ''
    sessionFin.current = ''
    sessionEnCours.current = ''
    setProvisoire('')
    if (texte) rappel.current?.(texte)
  }

  function lancerSession() {
    const r = new Reconnaissance()
    r.lang = LANGUES[langue] || 'fr-FR'
    r.interimResults = true
    r.continuous = !ANDROID
    r.maxAlternatives = 1
    r.onresult = (e) => {
      let fin = ''
      let encours = ''
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin = fusionnerDictee(fin, e.results[i][0].transcript)
        else encours = fusionnerDictee(encours, e.results[i][0].transcript)
      }
      sessionFin.current = fin
      sessionEnCours.current = encours
      derniereActivite.current = Date.now()
      setProvisoire(fusionnerDictee(fusionnerDictee(base.current, fin), encours))
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { setErreur('micro'); actif.current = false }
      else if (e.error === 'network') { setErreur('reseau'); actif.current = false }
      // 'no-speech' / 'aborted' : simple pause, la session est relancée.
    }
    r.onend = () => {
      // Le provisoire non confirmé n'est pas perdu : il rejoint le texte.
      base.current = fusionnerDictee(base.current, fusionnerDictee(sessionFin.current, sessionEnCours.current))
      sessionFin.current = ''
      sessionEnCours.current = ''
      if (actif.current && Date.now() - derniereActivite.current < SILENCE_MAX_MS) {
        // Petite pause avant de relancer : le micro doit être libéré.
        setTimeout(() => {
          if (!actif.current) { terminer(); return }
          try { lancerSession() } catch { terminer() }
        }, 250)
        return
      }
      terminer()
    }
    reco.current = r
    r.start()
  }

  function demarrer() {
    if (!Reconnaissance || ecoute) return
    setErreur('')
    base.current = ''
    sessionFin.current = ''
    sessionEnCours.current = ''
    setProvisoire('')
    actif.current = true
    derniereActivite.current = Date.now()
    setEcoute(true)
    clearInterval(surveillance.current)
    surveillance.current = setInterval(() => {
      if (Date.now() - derniereActivite.current > SILENCE_MAX_MS) arreter()
    }, 1000)
    try { lancerSession() } catch { terminer() }
  }

  // Rappui sur le micro : fin de la dictée, le texte part dans la zone de saisie.
  function arreter() {
    actif.current = false
    try { reco.current?.stop?.() } catch { terminer() }
  }

  return { ecoute, provisoire, erreur, demarrer, arreter }
}

// Voix de lecture : on choisit explicitement une voix de la bonne langue,
// sinon certains téléphones lisent le français avec leur voix anglaise.
let voixDisponibles = []
if (lectureDisponible) {
  const charger = () => { voixDisponibles = window.speechSynthesis.getVoices() || [] }
  charger()
  window.speechSynthesis.addEventListener?.('voiceschanged', charger)
}
function voixPour(code) {
  if (!voixDisponibles.length) voixDisponibles = window.speechSynthesis.getVoices() || []
  const c = code.toLowerCase().replace('_', '-')
  const langueSeule = c.slice(0, 2)
  const candidates = voixDisponibles.filter((v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith(langueSeule))
  return candidates.find((v) => (v.lang || '').toLowerCase().replace('_', '-') === c && v.localService)
    || candidates.find((v) => (v.lang || '').toLowerCase().replace('_', '-') === c)
    || candidates.find((v) => v.localService)
    || candidates[0]
    || null
}

// Lecture à voix haute (sans la mise en forme : astérisques, puces…).
export function lireTexte(texte, langue = 'fr') {
  if (!lectureDisponible || !texte) return
  window.speechSynthesis.cancel()
  const propre = String(texte).replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/^[-•]\s*/gm, '').replace(/F CFA/g, 'francs CFA')
  const code = LANGUES[langue] || 'fr-FR'
  const u = new SpeechSynthesisUtterance(propre.slice(0, 1200))
  u.lang = code
  const voix = voixPour(code)
  if (voix) u.voice = voix
  u.rate = 1.05
  window.speechSynthesis.speak(u)
}

export function arreterLecture() { if (lectureDisponible) window.speechSynthesis.cancel() }
