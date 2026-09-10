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
import stockFr from '../locales/fr/stock.json'
import stockEn from '../locales/en/stock.json'
import stockAr from '../locales/ar/stock.json'
import stockZh from '../locales/zh/stock.json'
import clientsFr from '../locales/fr/clients.json'
import clientsEn from '../locales/en/clients.json'
import clientsAr from '../locales/ar/clients.json'
import clientsZh from '../locales/zh/clients.json'
import commandesFr from '../locales/fr/commandes.json'
import commandesEn from '../locales/en/commandes.json'
import commandesAr from '../locales/ar/commandes.json'
import commandesZh from '../locales/zh/commandes.json'
import tourneesFr from '../locales/fr/tournees.json'
import tourneesEn from '../locales/en/tournees.json'
import tourneesAr from '../locales/ar/tournees.json'
import tourneesZh from '../locales/zh/tournees.json'
import analyseiaFr from '../locales/fr/analyseia.json'
import analyseiaEn from '../locales/en/analyseia.json'
import analyseiaAr from '../locales/ar/analyseia.json'
import analyseiaZh from '../locales/zh/analyseia.json'
import mesversementsFr from '../locales/fr/mesversements.json'
import mesversementsEn from '../locales/en/mesversements.json'
import mesversementsAr from '../locales/ar/mesversements.json'
import mesversementsZh from '../locales/zh/mesversements.json'
import mouvementsstockFr from '../locales/fr/mouvementsstock.json'
import mouvementsstockEn from '../locales/en/mouvementsstock.json'
import mouvementsstockAr from '../locales/ar/mouvementsstock.json'
import mouvementsstockZh from '../locales/zh/mouvementsstock.json'
import carteclientsFr from '../locales/fr/carteclients.json'
import carteclientsEn from '../locales/en/carteclients.json'
import carteclientsAr from '../locales/ar/carteclients.json'
import carteclientsZh from '../locales/zh/carteclients.json'
import grandlivreFr from '../locales/fr/grandlivre.json'
import grandlivreEn from '../locales/en/grandlivre.json'
import grandlivreAr from '../locales/ar/grandlivre.json'
import grandlivreZh from '../locales/zh/grandlivre.json'
import depotsFr from '../locales/fr/depots.json'
import depotsEn from '../locales/en/depots.json'
import depotsAr from '../locales/ar/depots.json'
import depotsZh from '../locales/zh/depots.json'

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
      fr: { commun: communFr, dashboard: dashboardFr, ventes: ventesFr, stock: stockFr, clients: clientsFr, commandes: commandesFr, tournees: tourneesFr, analyseia: analyseiaFr, mesversements: mesversementsFr, mouvementsstock: mouvementsstockFr, carteclients: carteclientsFr, grandlivre: grandlivreFr, depots: depotsFr },
      en: { commun: communEn, dashboard: dashboardEn, ventes: ventesEn, stock: stockEn, clients: clientsEn, commandes: commandesEn, tournees: tourneesEn, analyseia: analyseiaEn, mesversements: mesversementsEn, mouvementsstock: mouvementsstockEn, carteclients: carteclientsEn, grandlivre: grandlivreEn, depots: depotsEn },
      ar: { commun: communAr, dashboard: dashboardAr, ventes: ventesAr, stock: stockAr, clients: clientsAr, commandes: commandesAr, tournees: tourneesAr, analyseia: analyseiaAr, mesversements: mesversementsAr, mouvementsstock: mouvementsstockAr, carteclients: carteclientsAr, grandlivre: grandlivreAr, depots: depotsAr },
      zh: { commun: communZh, dashboard: dashboardZh, ventes: ventesZh, stock: stockZh, clients: clientsZh, commandes: commandesZh, tournees: tourneesZh, analyseia: analyseiaZh, mesversements: mesversementsZh, mouvementsstock: mouvementsstockZh, carteclients: carteclientsZh, grandlivre: grandlivreZh, depots: depotsZh },
    },
    fallbackLng: 'fr',
    supportedLngs: LANGUES.map((l) => l.code),
    ns: ['commun', 'dashboard', 'ventes', 'stock', 'clients', 'commandes', 'tournees', 'analyseia', 'mesversements', 'mouvementsstock', 'carteclients', 'grandlivre', 'depots'],
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
