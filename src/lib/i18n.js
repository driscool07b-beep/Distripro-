import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import communFr from '../locales/fr/commun.json'
import communEn from '../locales/en/commun.json'
import communAr from '../locales/ar/commun.json'
import communZh from '../locales/zh/commun.json'
import dashboardFr from '../locales/fr/dashboard.json'
import dashboardEn from '../locales/en/dashboard.json'
import dashboardAr from '../locales/ar/dashboard.json'
import dashboardZh from '../locales/zh/dashboard.json'
import ventesFr from '../locales/fr/ventes.json'
import ventesEn from '../locales/en/ventes.json'
import ventesAr from '../locales/ar/ventes.json'
import ventesZh from '../locales/zh/ventes.json'

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
      fr: { commun: communFr, dashboard: dashboardFr, ventes: ventesFr },
      en: { commun: communEn, dashboard: dashboardEn, ventes: ventesEn },
      ar: { commun: communAr, dashboard: dashboardAr, ventes: ventesAr },
      zh: { commun: communZh, dashboard: dashboardZh, ventes: ventesZh },
    },
    fallbackLng: 'fr',
    supportedLngs: LANGUES.map((l) => l.code),
    ns: ['commun', 'dashboard', 'ventes'],
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
