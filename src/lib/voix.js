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

// Liste des voix pas encore chargée (fréquent juste après l'ouverture sur
// Android) : on l'attend un court instant avant de parler.
function attendreVoix() {
  if (voixDisponibles.length || !lectureDisponible) return Promise.resolve()
  return new Promise((resolve) => {
    const fin = () => { voixDisponibles = window.speechSynthesis.getVoices() || []; resolve() }
    window.speechSynthesis.addEventListener?.('voiceschanged', fin, { once: true })
    setTimeout(fin, 1500)
  })
}

// Lecture à voix haute (sans la mise en forme : astérisques, puces, émojis…).
// onFin : appelé quand la lecture se termine ou est interrompue.
export async function lireTexte(texte, langue = 'fr', { onFin } = {}) {
  if (!lectureDisponible || !texte) return
  window.speechSynthesis.cancel()
  await attendreVoix()
  const propre = String(texte)
    .replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/^[-•]\s*/gm, '')
    .replace(/F CFA/g, 'francs CFA')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
  const code = LANGUES[langue] || 'fr-FR'
  // Lecture par phrases : Chrome coupe parfois les textes longs en cours de route.
  const morceaux = propre.match(/[^.!?\n]+[.!?]*\s*/g)?.map((m) => m.trim()).filter(Boolean) || [propre]
  const voix = voixPour(code)
  morceaux.forEach((m, i) => {
    const u = new SpeechSynthesisUtterance(m)
    u.lang = code
    if (voix) u.voice = voix
    u.rate = 1.05
    if (i === morceaux.length - 1) { u.onend = () => onFin?.(); u.onerror = () => onFin?.() }
    window.speechSynthesis.speak(u)
  })
}

export function arreterLecture() { if (lectureDisponible) window.speechSynthesis.cancel() }
