import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import communFr from '../locales/fr/commun.json'
import communEn from '../locales/en/commun.json'
import communAr from '../locales/ar/commun.json'
import communZh from '../locales/zh/commun.json'

// Langues dont le contenu est réellement traduit. L'arabe et le chinois
// sont préparés dans la structure (RTL, sélecteur) mais leur contenu
// n'est pas encore traduit (Phase 5 du plan de bilinguisation) — tant
// qu'un fichier de traduction pour une langue n'a que des clés vides ou
// manquantes, i18next retombe sur la clé anglaise/française par défaut.
export const LANGUES = [
  { code: 'fr', nom: 'Français', dir: 'ltr' },
  { code: 'en', nom: 'English', dir: 'ltr' },
  { code: 'ar', nom: 'العربية', dir: 'rtl' },
  { code: 'zh', nom: '中文', dir: 'ltr' }, // le chinois s'écrit LTR comme le français
]

export function direction(langue) {
  return LANGUES.find((l) => l.code === langue)?.dir || 'ltr'
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      fr: { commun: communFr },
      en: { commun: communEn },
      ar: { commun: communAr },
      zh: { commun: communZh },
    },
    fallbackLng: 'fr',
    supportedLngs: LANGUES.map((l) => l.code),
    ns: ['commun'],
    defaultNS: 'commun',
    interpolation: { escapeValue: false }, // React échappe déjà par défaut
    detection: {
      // Ordre : ce que l'utilisateur a explicitement choisi (localStorage,
      // posé par AuthContext depuis profils.langue ou par le sélecteur de
      // langue) prime sur la langue du navigateur.
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'distribpro_langue',
    },
  })

export default i18n
