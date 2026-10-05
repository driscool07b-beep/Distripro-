import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import communFr from '../locales/fr/commun.json'
import abonnementFr from '../locales/fr/abonnement.json'
import assistantFr from '../locales/fr/assistant.json'
import reconciliationsFr from '../locales/fr/reconciliations.json'
import infobullesFr from '../locales/fr/infobulles.json'
import dashboardFr from '../locales/fr/dashboard.json'
import ventesFr from '../locales/fr/ventes.json'
import stockFr from '../locales/fr/stock.json'
import clientsFr from '../locales/fr/clients.json'
import commandesFr from '../locales/fr/commandes.json'
import tourneesFr from '../locales/fr/tournees.json'
import analyseiaFr from '../locales/fr/analyseia.json'
import mesversementsFr from '../locales/fr/mesversements.json'
import mouvementsstockFr from '../locales/fr/mouvementsstock.json'
import carteclientsFr from '../locales/fr/carteclients.json'
import grandlivreFr from '../locales/fr/grandlivre.json'
import depotsFr from '../locales/fr/depots.json'
import localiserstockFr from '../locales/fr/localiserstock.json'
import groupesFr from '../locales/fr/groupes.json'
import rapportsFr from '../locales/fr/rapports.json'
import versementsFr from '../locales/fr/versements.json'
import objectifsFr from '../locales/fr/objectifs.json'
import stockcommercialFr from '../locales/fr/stockcommercial.json'
import utilisateursFr from '../locales/fr/utilisateurs.json'
import analytiqueFr from '../locales/fr/analytique.json'
import creancesFr from '../locales/fr/creances.json'
import messagerieFr from '../locales/fr/messagerie.json'
import parametresFr from '../locales/fr/parametres.json'
import apparenceFr from '../locales/fr/apparence.json'
import journalcaisseFr from '../locales/fr/journalcaisse.json'
import aideFr from '../locales/fr/aide.json'
import banquesFr from '../locales/fr/banques.json'
import plancomptableFr from '../locales/fr/plancomptable.json'
import notesutilisationFr from '../locales/fr/notesutilisation.json'

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

// Les autres langues sont chargées À LA DEMANDE (un fichier par écran), pour
// ne pas alourdir le démarrage : le français, langue de secours, est intégré.
const FICHIERS_LANGUES = import.meta.glob(['../locales/en/*.json', '../locales/ar/*.json', '../locales/zh/*.json'], { import: 'default' })

export async function chargerLangue(code) {
  if (!code || code === 'fr' || i18n.hasResourceBundle(code, 'commun')) return
  const entrees = Object.entries(FICHIERS_LANGUES).filter(([chemin]) => chemin.includes(`/locales/${code}/`))
  await Promise.all(entrees.map(async ([chemin, charger]) => {
    const ns = chemin.split('/').pop().replace('.json', '')
    i18n.addResourceBundle(code, ns, await charger(), true, true)
  }))
}

// À utiliser à la place de i18n.changeLanguage : charge la langue avant de basculer.
export async function changerLangue(code) {
  try { await chargerLangue(code) } catch (e) { console.error('Chargement de la langue impossible :', e) }
  return i18n.changeLanguage(code)
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      fr: { commun: communFr, abonnement: abonnementFr, assistant: assistantFr, reconciliations: reconciliationsFr, infobulles: infobullesFr, dashboard: dashboardFr, ventes: ventesFr, stock: stockFr, clients: clientsFr, commandes: commandesFr, tournees: tourneesFr, analyseia: analyseiaFr, mesversements: mesversementsFr, mouvementsstock: mouvementsstockFr, carteclients: carteclientsFr, grandlivre: grandlivreFr, depots: depotsFr, localiserstock: localiserstockFr, groupes: groupesFr, rapports: rapportsFr, versements: versementsFr, objectifs: objectifsFr, stockcommercial: stockcommercialFr, utilisateurs: utilisateursFr, analytique: analytiqueFr, creances: creancesFr, messagerie: messagerieFr, parametres: parametresFr, apparence: apparenceFr, journalcaisse: journalcaisseFr, aide: aideFr, banques: banquesFr, plancomptable: plancomptableFr, notesutilisation: notesutilisationFr },
    },
    fallbackLng: 'fr',
    supportedLngs: LANGUES.map((l) => l.code),
    ns: ['commun', 'abonnement', 'assistant', 'reconciliations', 'infobulles', 'dashboard', 'ventes', 'stock', 'clients', 'commandes', 'tournees', 'analyseia', 'mesversements', 'mouvementsstock', 'carteclients', 'grandlivre', 'depots', 'localiserstock', 'groupes', 'rapports', 'versements', 'objectifs', 'stockcommercial', 'utilisateurs', 'analytique', 'creances', 'messagerie', 'parametres', 'apparence', 'journalcaisse', 'aide', 'banques', 'plancomptable', 'notesutilisation'],
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

// Langue détectée au démarrage (choix enregistré ou langue du navigateur) :
// chargée avant le premier affichage (voir main.jsx), 4 s au plus.
let langueInitiale = 'fr'
try { langueInitiale = (localStorage.getItem('distribpro_langue') || navigator.language || 'fr').slice(0, 2) } catch { /* ignore */ }
if (!LANGUES.some((l) => l.code === langueInitiale)) langueInitiale = 'fr'
export const i18nPret = Promise.race([
  chargerLangue(langueInitiale).then(() => (langueInitiale !== 'fr' ? i18n.changeLanguage(langueInitiale) : null)),
  new Promise((resolve) => setTimeout(resolve, 4000)),
]).catch(() => null)

export default i18n
