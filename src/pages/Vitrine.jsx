// Site vitrine de DistribPro : page d'accueil publique de distribpro.com pour
// les visiteurs non connectés (les utilisateurs connectés arrivent sur leur
// tableau de bord). Tarifs lus en direct depuis la Console plateforme,
// formulaire de contact enregistré et transmis par la fonction
// « demande-contact », fiche technique PDF générée à la demande.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { EDITEUR } from '../lib/infosEditeur'

const ACCENT = '#E8A83C'

// Formules par défaut, si les tarifs en direct ne répondent pas.
const TARIFS_DEFAUT = [
  { code: 'starter', nom: 'Starter', prix_mensuel: 25000, prix_annuel: 240000, max_commerciaux: 3, prix_place_supp: 3000 },
  { code: 'pro', nom: 'Pro', prix_mensuel: 45000, prix_annuel: 432000, max_commerciaux: 10, prix_place_supp: 3000 },
  { code: 'entreprise', nom: 'Entreprise', prix_mensuel: 85000, prix_annuel: 816000, max_commerciaux: null, prix_place_supp: 3000 },
]
const POUR_QUI = {
  starter: 'Pour démarrer avec une petite équipe terrain.',
  pro: 'Pour une équipe commerciale en croissance.',
  entreprise: 'Pour les réseaux de distribution et plusieurs magasins.',
}

const fcfa = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} F CFA`

// Icônes au trait (même famille que celles de l'application).
function Icone({ nom, className = 'w-5 h-5' }) {
  const traits = {
    vente: <><path d="M3 7h18l-2 11H5L3 7Z" /><path d="M8 7V5a4 4 0 0 1 8 0v2" /></>,
    stock: <><path d="M3 8 12 3l9 5v8l-9 5-9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" /></>,
    route: <><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" /></>,
    balance: <><path d="M12 3v18M5 21h14M6 7h12" /><path d="m6 7-3 7a3 3 0 0 0 6 0L6 7ZM18 7l-3 7a3 3 0 0 0 6 0l-3-7Z" /></>,
    camion: <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>,
    facture: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
    compta: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h8" /></>,
    graphe: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
    micro: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
    bouclier: <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></>,
    cle: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3" /></>,
    trace: <><path d="M4 6h16M4 12h10M4 18h7" /><circle cx="18" cy="16" r="3" /></>,
    export: <><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></>,
    telecharger: <><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    fermer: <><path d="M6 6l12 12M18 6 6 18" /></>,
    check: <><path d="M20 6 9 17l-5-5" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    whatsapp: <><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19l-4 1Z" /><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1c-1-.5-1.5-1-2-2l1-1-1-2L9 9.5Z" /></>,
    lieu: <><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></>,
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {traits[nom]}
    </svg>
  )
}

const FONCTIONNALITES = [
  ['vente', 'Ventes et encaissements', 'Comptant ou à crédit, taxes calculées, reçus, encaissements partiels, règlements groupés et avoirs.'],
  ['stock', 'Stock multi-magasins', 'Stock par magasin, lots et péremptions en FIFO, inventaires, transferts avec justificatifs photo.'],
  ['route', 'Commerciaux et tournées', 'Stock en main de chaque commercial, tournées planifiées, visites géolocalisées, objectifs.'],
  ['balance', 'Réconciliation', 'Écarts de stock et d’argent par commercial, dettes suivies, retenues sur salaire encadrées.'],
  ['camion', 'Commandes et livraisons', 'Commandes clients, préparation au magasin, livraisons partielles, proformas et bons de livraison.'],
  ['facture', 'Factures et FNE', 'Reçus et factures A4, module FNE de la DGI, envoi au client par WhatsApp ou e-mail.'],
  ['compta', 'Caisse, banque, comptabilité', 'Journaux de caisse et de banque, rapprochement, plan SYSCOHADA, export vers votre logiciel comptable.'],
  ['graphe', 'Pilotage', 'Tableaux de bord par rôle, carte des clients, analyses et rapport d’activité PowerPoint chaque mois.'],
]

const QUESTIONS = [
  ['Faut-il installer quelque chose ?', 'Non. DistribPro s’utilise dans le navigateur, sur ordinateur, tablette et téléphone. Sur téléphone, il s’ajoute à l’écran d’accueil comme une application, sans passer par un magasin d’applications.'],
  ['Et si un commercial n’a pas de réseau ?', 'Ses saisies terrain sont conservées sur le téléphone et envoyées dès le retour de la connexion. La dictée vocale et l’assistant IA demandent une connexion.'],
  ['L’assistant IA peut-il enregistrer une vente tout seul ?', 'Non. Il prépare une fiche que l’utilisateur vérifie puis valide, avec les mêmes contrôles qu’une saisie manuelle (stock, remise autorisée, droits du rôle).'],
  ['Puis-je reprendre mes données existantes ?', 'Oui. Produits, clients, soldes et comptes clients s’importent depuis Excel, avec vos propres références. Nous pouvons vous accompagner lors de la reprise.'],
  ['Mes données sont-elles protégées ?', 'Les données de chaque entreprise sont strictement isolées, les connexions chiffrées, et chaque utilisateur ne voit que ce que son rôle autorise. Vous pouvez tout exporter à tout moment.'],
  ['Comment se passe le paiement ?', 'L’essai de 21 jours est gratuit et sans carte bancaire. Le paiement en ligne par Mobile Money et carte arrive prochainement ; d’ici là, nous activons votre abonnement directement avec vous.'],
]

const SUJETS = [
  ['demo', 'Une démonstration'],
  ['tarifs', 'Un devis ou les tarifs'],
  ['migration', 'Reprendre mes données existantes'],
  ['partenariat', 'Devenir partenaire / revendeur'],
  ['assistance', 'De l’aide (je suis déjà client)'],
  ['autre', 'Autre chose'],
]
const TAILLES = ['1 à 3 commerciaux', '4 à 10 commerciaux', '11 à 30 commerciaux', 'Plus de 30 commerciaux', 'Pas encore de commerciaux']

function Titre({ sur, children, clair = false, className = '' }) {
  return (
    <div className={`flex flex-col gap-3 max-w-3xl ${className}`}>
      {sur && <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: clair ? ACCENT : '#8A5A0A' }}>{sur}</p>}
      <h2 className={`m-0 font-display font-bold text-[clamp(28px,3.6vw,42px)] leading-[1.12] ${clair ? 'text-white' : 'text-[#0D2830]'}`}>{children}</h2>
    </div>
  )
}

export default function Vitrine() {
  const [menuOuvert, setMenuOuvert] = useState(false)
  const [tarifs, setTarifs] = useState(TARIFS_DEFAUT)
  const [annuel, setAnnuel] = useState(false)
  const [ficheEnCours, setFicheEnCours] = useState(false)

  useEffect(() => {
    document.title = 'DistribPro — gestion commerciale pour distributeurs en Côte d’Ivoire'
    supabase.rpc('tarifs_publics').then(({ data }) => { if (data?.length) setTarifs(data) })
  }, [])

  async function telechargerFiche() {
    setFicheEnCours(true)
    try {
      const { genererFicheTechnique } = await import('../lib/ficheTechnique')
      genererFicheTechnique(tarifs)
    } finally {
      setFicheEnCours(false)
    }
  }

  const liens = [['#fonctionnalites', 'Fonctionnalités'], ['#assistant', 'Assistant IA'], ['#tarifs', 'Tarifs'], ['#faq', 'Questions'], ['#contact', 'Contact']]
  const wa = (EDITEUR.whatsapp || '').replace(/\D/g, '')

  return (
    <div className="font-body text-[#0D2830] bg-[#F5F6F4] leading-[1.55] min-h-screen" dir="ltr" lang="fr">
      {/* En-tête */}
      <header className="sticky top-0 z-30 bg-[#0A1F26]/95 backdrop-blur text-white border-b border-white/5">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          <a href="#accueil" className="flex items-center gap-2.5 text-white no-underline font-display font-bold text-[21px]">
            <img src="/icons/icon-192.png" alt="" className="w-8 h-8 rounded-lg" />
            DistribPro
          </a>
          <nav aria-label="Navigation principale" className="hidden lg:flex gap-6 ml-6 text-[15px]">
            {liens.map(([h, l]) => <a key={h} href={h} className="text-[#D7E3E6] hover:text-white no-underline">{l}</a>)}
          </nav>
          <div className="ml-auto hidden sm:flex items-center gap-2.5">
            <Link to="/connexion" className="text-white no-underline px-4 py-2.5 rounded-xl border border-[#347080] text-[15px] hover:bg-white/5">Se connecter</Link>
            <Link to="/creer-entreprise" className="no-underline px-4 py-2.5 rounded-xl font-semibold text-[15px] text-[#0A1F26] hover:brightness-105" style={{ background: ACCENT }}>Essai gratuit</Link>
          </div>
          <button
            type="button"
            onClick={() => setMenuOuvert((v) => !v)}
            className="lg:hidden ml-auto sm:ml-0 w-11 h-11 inline-flex items-center justify-center rounded-xl hover:bg-white/10"
            aria-label={menuOuvert ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={menuOuvert}
          >
            <Icone nom={menuOuvert ? 'fermer' : 'menu'} className="w-6 h-6" />
          </button>
        </div>
        {menuOuvert && (
          <nav aria-label="Menu" className="lg:hidden border-t border-white/10 px-4 pb-4 pt-2 flex flex-col">
            {liens.map(([h, l]) => (
              <a key={h} href={h} onClick={() => setMenuOuvert(false)} className="text-[#D7E3E6] no-underline py-3 text-[16px] border-b border-white/5">{l}</a>
            ))}
            <div className="flex gap-2.5 pt-4 sm:hidden">
              <Link to="/connexion" className="flex-1 text-center text-white no-underline px-4 py-3 rounded-xl border border-[#347080]">Se connecter</Link>
              <Link to="/creer-entreprise" className="flex-1 text-center no-underline px-4 py-3 rounded-xl font-semibold text-[#0A1F26]" style={{ background: ACCENT }}>Essai gratuit</Link>
            </div>
          </nav>
        )}
      </header>

      {/* Accroche */}
      <section id="accueil" className="bg-[#0A1F26] text-white px-4 sm:px-6 pt-12 pb-20 sm:pt-16 sm:pb-24 scroll-mt-16">
        <div className="max-w-[1200px] mx-auto grid lg:grid-cols-[1.25fr_1fr] gap-12 items-center">
          <div className="flex flex-col gap-6 min-w-0">
            <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.08em]" style={{ color: ACCENT }}>Gestion commerciale et distribution · Côte d&apos;Ivoire</p>
            <h1 className="m-0 font-display font-bold text-[clamp(36px,5.2vw,62px)] leading-[1.04]">Vos commerciaux vendent. DistribPro fait le reste.</h1>
            <p className="m-0 text-[18px] sm:text-[19px] text-[#C9D9DD] max-w-[600px]">
              Ventes terrain, stock suivi jusque chez le commercial, encaissements réconciliés et factures prêtes pour la FNE, avec un assistant IA qui saisit à la voix. Pensé pour les distributeurs, grossistes et producteurs.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/creer-entreprise" className="no-underline px-6 py-3.5 rounded-xl font-semibold text-[17px] text-[#0A1F26] hover:brightness-105" style={{ background: ACCENT }}>Essayer gratuitement 21 jours</Link>
              <a href="#contact" className="no-underline text-white px-6 py-3.5 rounded-xl border border-[#347080] text-[17px] hover:bg-white/5">Demander une démonstration</a>
            </div>
            <p className="m-0 text-[14px] text-[#8FB0B8]">Sans carte bancaire · Sur ordinateur et téléphone · Français, anglais, arabe, chinois</p>
          </div>

          {/* Démonstration de la dictée (exemple fictif) */}
          <div className="w-full max-w-[430px] lg:justify-self-end bg-[#123640] rounded-3xl p-5 flex flex-col gap-3 border border-[#1A4752] shadow-2xl shadow-black/30">
            <div className="flex items-center gap-2 text-[13px] text-[#8FB0B8]">
              <span className="w-7 h-7 rounded-full inline-flex items-center justify-center" style={{ background: ACCENT, color: '#0A1F26' }}><Icone nom="micro" className="w-4 h-4" /></span>
              Le commercial dicte, entre deux clients
            </div>
            <div className="self-end bg-[#1A4752] rounded-[16px_16px_4px_16px] px-3.5 py-2.5 text-[15px] max-w-[92%]">
              « Vente à Supérette La Confiance : dix farines de maïs Soleil et cinq huiles Palme d&apos;Or, payé en espèces. »
            </div>
            <div className="bg-white text-[#0D2830] rounded-2xl p-4 flex flex-col gap-2 border-2" style={{ borderColor: ACCENT }}>
              <div className="flex justify-between items-baseline gap-2">
                <strong className="font-display whitespace-nowrap">Vente à valider</strong>
                <span className="text-[11px] uppercase tracking-[0.06em] text-[#8A5A0A] text-right">Pas encore enregistrée</span>
              </div>
              <p className="m-0 text-[14px] text-[#3B5A62]">Client : <strong className="text-[#0D2830]">Supérette La Confiance</strong></p>
              <div className="flex justify-between text-[14px] border-t border-[#E2E4DF] pt-2"><span>Farine de maïs Soleil 1 kg × 10</span><span>12 500</span></div>
              <div className="flex justify-between text-[14px]"><span>Huile Palme d&apos;Or 1 L × 5</span><span>7 500</span></div>
              <div className="flex justify-between text-[15px] border-t border-[#E2E4DF] pt-2"><span>Total · espèces</span><strong>20 000 F CFA</strong></div>
              <div className="flex gap-2 mt-1" aria-hidden="true">
                <span className="flex-1 text-center py-2.5 rounded-xl border border-[#E2E4DF] bg-[#F5F6F4] text-[14px]">Modifier</span>
                <span className="flex-1 text-center py-2.5 rounded-xl bg-[#123640] text-white font-semibold text-[14px]">Valider</span>
              </div>
            </div>
            <p className="m-0 text-[12px] text-[#8FB0B8]">L&apos;assistant prépare, le commercial valide : rien n&apos;est enregistré sans son accord. Exemple fictif.</p>
          </div>
        </div>
      </section>

      {/* Les problèmes */}
      <section className="px-4 sm:px-6 py-16 sm:py-20">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-8">
          <Titre>Ce qui coûte cher à un distributeur, ce n&apos;est pas le logiciel. C&apos;est ce qu&apos;il ne voit pas.</Titre>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              ['Des saisies faites le soir, de mémoire', 'Pressés, les commerciaux notent mal ou tard, et les chiffres arrivent en retard. Avec DistribPro, ils dictent leur vente en quelques secondes, chez le client.'],
              ['Des écarts de stock et d’argent', 'Ce qui sort du magasin, ce qui est vendu, ce qui revient, ce qui est versé : chaque tournée est réconciliée et les écarts sautent aux yeux.'],
              ['Des factures à mettre aux normes', 'La facture normalisée électronique (FNE) s’impose. DistribPro intègre la FNE de la DGI et envoie la facture au client par WhatsApp ou e-mail.'],
            ].map(([t, d]) => (
              <div key={t} className="bg-white border border-[#E2E4DF] rounded-2xl p-6 flex flex-col gap-2.5">
                <h3 className="m-0 font-display text-[20px] font-semibold">{t}</h3>
                <p className="m-0 text-[#3B5A62]">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Fonctionnalités */}
      <section id="fonctionnalites" className="px-4 sm:px-6 pb-20 scroll-mt-16">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-8">
          <Titre sur="Tout au même endroit">Une seule application, du magasin jusqu&apos;au client</Titre>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FONCTIONNALITES.map(([ic, t, d]) => (
              <div key={t} className="bg-white border border-[#E2E4DF] rounded-2xl p-5 flex flex-col gap-2.5">
                <span className="w-10 h-10 rounded-xl bg-[#E9F0F1] text-[#123640] inline-flex items-center justify-center"><Icone nom={ic} /></span>
                <h3 className="m-0 font-display text-[18px] font-semibold">{t}</h3>
                <p className="m-0 text-[#3B5A62] text-[15px]">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mise en route */}
      <section className="px-4 sm:px-6 pb-20">
        <div className="max-w-[1200px] mx-auto bg-white border border-[#E2E4DF] rounded-3xl p-6 sm:p-10 flex flex-col gap-8">
          <Titre sur="Mise en route">Opérationnel en une journée, pas en trois mois</Titre>
          <ol className="m-0 p-0 list-none grid md:grid-cols-3 gap-6">
            {[
              ['Créez votre espace', 'En quelques minutes, sans carte bancaire : votre entreprise, vos magasins, vos taxes.'],
              ['Importez l’existant', 'Produits, clients, soldes et comptes clients depuis Excel, avec vos propres références.'],
              ['Équipez vos équipes', 'Chacun reçoit son accès par e-mail et installe DistribPro sur son téléphone. Des tutoriels par rôle sont intégrés.'],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="shrink-0 w-10 h-10 rounded-full font-display font-bold text-[18px] inline-flex items-center justify-center text-[#0A1F26]" style={{ background: ACCENT }}>{i + 1}</span>
                <div className="flex flex-col gap-1">
                  <h3 className="m-0 font-display text-[18px] font-semibold">{t}</h3>
                  <p className="m-0 text-[#3B5A62] text-[15px]">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Assistant IA */}
      <section id="assistant" className="bg-[#0D2830] text-white px-4 sm:px-6 py-20 scroll-mt-16">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-8">
          <Titre sur="Assistant IA" clair>Un assistant qui parle à chacun de vos métiers</Titre>
          <p className="m-0 -mt-3 text-[#C9D9DD] text-[18px] max-w-3xl">
            Il retrouve vos clients et vos produits, applique vos tarifs et vos remises autorisées, vérifie le stock et prépare la saisie. Il répond dans la langue de l&apos;utilisateur, peut lire ses réponses à voix haute, et ne voit que ce que son rôle autorise.
          </p>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              ['Pour le commercial', 'Ventes, commandes, encaissements, nouveaux clients et rapports de visite, dictés entre deux clients.', '« Supérette La Confiance a payé 50 000 en espèces. »'],
              ['Pour le magasin', 'Commandes à préparer, réceptions avec lots et péremptions, sorties vers les commerciaux, transferts.', '« Quelles commandes dois-je préparer aujourd’hui ? »'],
              ['Pour la direction', 'Questions sur les chiffres en langage courant, et un rapport d’activité commenté chaque mois.', '« Classe mes commerciaux par chiffre d’affaires ce mois-ci. »'],
            ].map(([t, d, ex]) => (
              <div key={t} className="bg-[#123640] border border-[#1A4752] rounded-2xl p-6 flex flex-col gap-2.5">
                <h3 className="m-0 font-display text-[21px] font-semibold">{t}</h3>
                <p className="m-0 text-[#C9D9DD]">{d}</p>
                <p className="m-0 mt-auto pt-2 text-[15px]" style={{ color: ACCENT }}>{ex}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tarifs */}
      <section id="tarifs" className="px-4 sm:px-6 py-20 scroll-mt-16">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <Titre sur="Tarifs">Une formule selon la taille de votre équipe</Titre>
            <div className="inline-flex p-1 rounded-xl bg-[#E9F0F1]" role="group" aria-label="Période de facturation">
              {[[false, 'Mensuel'], [true, 'Annuel · -20 %']].map(([v, l]) => (
                <button key={l} type="button" onClick={() => setAnnuel(v)} aria-pressed={annuel === v}
                  className={`px-4 min-h-[44px] rounded-lg text-[15px] font-semibold ${annuel === v ? 'bg-[#123640] text-white' : 'text-[#123640]'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {tarifs.map((p, i) => {
              const miseEnAvant = tarifs.length === 3 && i === 1
              return (
                <div key={p.code} className={`rounded-2xl p-7 flex flex-col gap-3 border ${miseEnAvant ? 'bg-[#0A1F26] text-white border-[#0A1F26] shadow-xl' : 'bg-white border-[#E2E4DF]'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="m-0 font-display text-[22px] font-semibold">{p.nom}</h3>
                    {miseEnAvant && <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full text-[#0A1F26]" style={{ background: ACCENT }}>Le plus choisi</span>}
                  </div>
                  <p className="m-0 font-display font-bold text-[32px] leading-tight">
                    {fcfa(annuel ? p.prix_annuel : p.prix_mensuel)}
                    <span className={`text-[15px] font-normal ${miseEnAvant ? 'text-[#C9D9DD]' : 'text-[#3B5A62]'}`}> / {annuel ? 'an' : 'mois'}</span>
                  </p>
                  <p className={`m-0 ${miseEnAvant ? 'text-[#C9D9DD]' : 'text-[#3B5A62]'}`}>{POUR_QUI[p.code] || ''}</p>
                  <ul className={`m-0 p-0 list-none flex flex-col gap-2 text-[15px] ${miseEnAvant ? 'text-[#E6EEF0]' : ''}`}>
                    {[
                      p.max_commerciaux ? `Jusqu’à ${p.max_commerciaux} commerciaux` : 'Commerciaux illimités',
                      'Un utilisateur inclus par rôle',
                      'Tous les modules, assistant IA compris',
                      'Unités IA offertes à l’inscription',
                    ].map((x) => (
                      <li key={x} className="flex gap-2 items-start"><Icone nom="check" className="w-5 h-5 shrink-0 mt-0.5 text-[#3E8E96]" />{x}</li>
                    ))}
                  </ul>
                  <Link to="/creer-entreprise"
                    className={`mt-auto text-center no-underline px-4 py-3 rounded-xl font-semibold ${miseEnAvant ? 'text-[#0A1F26]' : 'bg-[#123640] text-white'}`}
                    style={miseEnAvant ? { background: ACCENT } : undefined}>Commencer l&apos;essai gratuit</Link>
                </div>
              )
            })}
          </div>
          <p className="m-0 text-[15px] text-[#3B5A62] max-w-4xl">
            Essai gratuit de 21 jours, sans engagement ni carte bancaire. Au-delà d&apos;un utilisateur par rôle (administration, comptabilité, magasin…), {fcfa(tarifs[0]?.prix_place_supp || 3000)} par mois et par utilisateur supplémentaire. Si votre équipe commerciale dépasse la formule, vous passez simplement à la suivante.
          </p>
        </div>
      </section>

      {/* Confiance */}
      <section className="bg-[#E9F0F1] px-4 sm:px-6 py-16">
        <div className="max-w-[1200px] mx-auto grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {[
            ['export', 'Vos données vous appartiennent', 'Export Excel et PDF à tout moment.'],
            ['cle', 'Chacun voit ce qui le concerne', 'Droits par rôle : un commercial ne voit que ses ventes, ses clients et son stock.'],
            ['trace', 'Traçabilité complète', 'Chaque mouvement de stock et d’argent est tracé, avec son auteur et ses justificatifs.'],
            ['bouclier', 'Protection des données', 'Données isolées par entreprise, connexions chiffrées, traitements conformes à la loi ivoirienne n° 2013-450.'],
          ].map(([ic, t, d]) => (
            <div key={t} className="flex flex-col gap-2">
              <span className="text-[#123640]"><Icone nom={ic} className="w-6 h-6" /></span>
              <h3 className="m-0 font-display text-[18px] font-semibold">{t}</h3>
              <p className="m-0 text-[#3B5A62] text-[15px]">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Fiche technique */}
      <section className="px-4 sm:px-6 pt-20">
        <div className="max-w-[1200px] mx-auto rounded-3xl bg-[#123640] text-white p-6 sm:p-10 flex flex-wrap items-center gap-6 justify-between">
          <div className="flex flex-col gap-2 max-w-2xl">
            <h2 className="m-0 font-display font-bold text-[clamp(24px,3vw,32px)] leading-tight">La fiche technique, pour la montrer en interne</h2>
            <p className="m-0 text-[#C9D9DD]">Modules, caractéristiques techniques, sécurité et tarifs à jour, sur deux pages A4 à partager avec votre direction ou votre comptable.</p>
          </div>
          <button type="button" onClick={telechargerFiche} disabled={ficheEnCours}
            className="inline-flex items-center gap-2 px-6 min-h-[52px] rounded-xl font-semibold text-[16px] text-[#0A1F26] disabled:opacity-70" style={{ background: ACCENT }}>
            <Icone nom="telecharger" />
            {ficheEnCours ? 'Préparation…' : 'Télécharger la fiche (PDF)'}
          </button>
        </div>
      </section>

      {/* Questions */}
      <section id="faq" className="px-4 sm:px-6 py-20 scroll-mt-16">
        <div className="max-w-[860px] mx-auto flex flex-col gap-6">
          <Titre>Questions fréquentes</Titre>
          <div className="flex flex-col gap-3">
            {QUESTIONS.map(([q, r]) => (
              <details key={q} className="group bg-white border border-[#E2E4DF] rounded-2xl px-5 open:pb-4">
                <summary className="cursor-pointer list-none min-h-[56px] flex items-center justify-between gap-4 font-display text-[17px] font-semibold">
                  {q}
                  <span className="shrink-0 w-7 h-7 rounded-full bg-[#E9F0F1] inline-flex items-center justify-center text-[18px] leading-none transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </summary>
                <p className="m-0 text-[#3B5A62]">{r}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="bg-[#0A1F26] text-white px-4 sm:px-6 py-20 scroll-mt-16">
        <div className="max-w-[1200px] mx-auto grid lg:grid-cols-[1fr_1.3fr] gap-10 lg:gap-14">
          <div className="flex flex-col gap-6">
            <Titre sur="Contact" clair>Voyez DistribPro avec vos propres produits</Titre>
            <p className="m-0 text-[#C9D9DD] text-[18px]">
              Une démonstration de 30 minutes, en visio ou dans vos locaux à Abidjan, sur un cas qui ressemble au vôtre. Réponse sous un jour ouvré.
            </p>
            <ul className="m-0 p-0 list-none flex flex-col gap-4 text-[16px]">
              <li><a href={`mailto:${EDITEUR.email}`} className="inline-flex items-center gap-3 text-white no-underline hover:underline"><span className="w-10 h-10 rounded-xl bg-[#123640] inline-flex items-center justify-center"><Icone nom="mail" /></span>{EDITEUR.email}</a></li>
              {wa && <li><a href={`https://wa.me/${wa}`} className="inline-flex items-center gap-3 text-white no-underline hover:underline"><span className="w-10 h-10 rounded-xl bg-[#123640] inline-flex items-center justify-center"><Icone nom="whatsapp" /></span>WhatsApp</a></li>}
              <li className="inline-flex items-center gap-3 text-[#C9D9DD]"><span className="w-10 h-10 rounded-xl bg-[#123640] inline-flex items-center justify-center text-white"><Icone nom="lieu" /></span>Abidjan, Côte d&apos;Ivoire</li>
            </ul>
            <p className="m-0 text-[15px] text-[#8FB0B8]">
              Vous préférez essayer seul ? <Link to="/creer-entreprise" className="font-semibold" style={{ color: ACCENT }}>Ouvrez votre espace gratuit</Link>, sans carte bancaire.
            </p>
          </div>
          <FormulaireContact />
        </div>
      </section>

      {/* Pied de page */}
      <footer className="bg-[#071A20] text-[#8FB0B8] px-4 sm:px-6 py-8 text-[14px]">
        <div className="max-w-[1200px] mx-auto flex flex-wrap gap-x-8 gap-y-3 justify-between">
          <span>© {new Date().getFullYear()} DistribPro · édité par {EDITEUR.raisonSociale} · Abidjan, Côte d&apos;Ivoire</span>
          <span className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/legal/cgu" className="text-[#C9D9DD]">Conditions d&apos;utilisation</Link>
            <Link to="/legal/confidentialite" className="text-[#C9D9DD]">Confidentialité</Link>
            <Link to="/legal/mentions" className="text-[#C9D9DD]">Mentions légales</Link>
            <Link to="/connexion" className="text-[#C9D9DD]">Se connecter</Link>
          </span>
        </div>
      </footer>
    </div>
  )
}

const champ = 'w-full min-h-[48px] rounded-xl border border-[#C9D3D1] bg-white px-3.5 py-2.5 text-[16px] text-[#0D2830] placeholder:text-[#7A8D91] focus:outline-none focus:ring-2 focus:ring-[#E8A83C] focus:border-[#E8A83C]'
const etiquette = 'flex flex-col gap-1.5 text-[14px] font-semibold text-[#0D2830]'

function FormulaireContact() {
  const debut = useRef(Date.now())
  const [v, setV] = useState({ nom: '', entreprise: '', telephone: '', email: '', ville: '', taille_equipe: '', sujet: 'demo', message: '', consentement: false, site_web: '' })
  const [etat, setEtat] = useState('saisie') // saisie | envoi | envoye
  const [erreur, setErreur] = useState('')
  const maj = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function envoyer(e) {
    e.preventDefault()
    setErreur('')
    if (!v.consentement) { setErreur('Merci de cocher la case pour que nous puissions vous recontacter.'); return }
    setEtat('envoi')
    const { data, error } = await supabase.functions.invoke('demande-contact', {
      body: { ...v, source: 'formulaire', duree_ms: Date.now() - debut.current },
    })
    if (error || !data?.ok) {
      let message = data?.erreur
      try { message = message || (await error?.context?.json())?.erreur } catch { /* ignore */ }
      setErreur(message || `L'envoi n'a pas abouti. Réessayez, ou écrivez-nous à ${EDITEUR.email}.`)
      setEtat('saisie')
      return
    }
    setEtat('envoye')
  }

  if (etat === 'envoye') {
    return (
      <div className="bg-white text-[#0D2830] rounded-3xl p-8 flex flex-col gap-4 items-start self-start" role="status">
        <span className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center justify-center"><Icone nom="check" className="w-6 h-6" /></span>
        <h3 className="m-0 font-display text-[24px] font-bold">Merci {v.nom.split(' ')[0]}, c&apos;est bien reçu.</h3>
        <p className="m-0 text-[#3B5A62]">Nous vous recontactons au {v.telephone} sous un jour ouvré. Un e-mail de confirmation vient de partir vers {v.email}.</p>
        <Link to="/creer-entreprise" className="no-underline px-5 py-3 rounded-xl font-semibold text-[#0A1F26]" style={{ background: ACCENT }}>En attendant, ouvrir mon espace d&apos;essai</Link>
      </div>
    )
  }

  return (
    <form onSubmit={envoyer} className="relative bg-white text-[#0D2830] rounded-3xl p-6 sm:p-8 grid sm:grid-cols-2 gap-4" noValidate>
      <label className={etiquette}>Nom et prénom *<input className={champ} value={v.nom} onChange={maj('nom')} autoComplete="name" required /></label>
      <label className={etiquette}>Entreprise<input className={champ} value={v.entreprise} onChange={maj('entreprise')} autoComplete="organization" /></label>
      <label className={etiquette}>Téléphone (WhatsApp) *<input className={champ} type="tel" inputMode="tel" value={v.telephone} onChange={maj('telephone')} autoComplete="tel" placeholder="07 00 00 00 00" required /></label>
      <label className={etiquette}>E-mail *<input className={champ} type="email" inputMode="email" value={v.email} onChange={maj('email')} autoComplete="email" required /></label>
      <label className={etiquette}>Ville<input className={champ} value={v.ville} onChange={maj('ville')} autoComplete="address-level2" placeholder="Abidjan" /></label>
      <label className={etiquette}>Taille de l&apos;équipe terrain
        <select className={champ} value={v.taille_equipe} onChange={maj('taille_equipe')}>
          <option value="">Choisir…</option>
          {TAILLES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label className={`${etiquette} sm:col-span-2`}>Vous souhaitez *
        <select className={champ} value={v.sujet} onChange={maj('sujet')}>
          {SUJETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label className={`${etiquette} sm:col-span-2`}>Votre message
        <textarea className={`${champ} min-h-[120px] resize-y`} value={v.message} onChange={maj('message')} maxLength={3000}
          placeholder="Ce que vous distribuez, votre organisation actuelle, ce que vous aimeriez améliorer…" />
      </label>
      {/* Piège à robots : invisible pour les visiteurs. */}
      <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
        <label>Site web<input tabIndex={-1} autoComplete="off" value={v.site_web} onChange={maj('site_web')} /></label>
      </div>
      <label className="sm:col-span-2 flex gap-3 items-start text-[14px] text-[#3B5A62] cursor-pointer">
        <input type="checkbox" checked={v.consentement} onChange={maj('consentement')} className="mt-1 w-5 h-5 shrink-0 accent-[#123640]" />
        <span>J&apos;accepte que DistribPro utilise ces informations pour me recontacter au sujet de ma demande. Voir la <Link to="/legal/confidentialite" className="underline text-[#123640]">politique de confidentialité</Link>.</span>
      </label>
      {erreur && <p className="sm:col-span-2 m-0 text-[14px] text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2" role="alert">{erreur}</p>}
      <button type="submit" disabled={etat === 'envoi'}
        className="sm:col-span-2 min-h-[52px] rounded-xl bg-[#123640] text-white font-semibold text-[16px] hover:bg-[#0D2830] disabled:opacity-70">
        {etat === 'envoi' ? 'Envoi en cours…' : 'Envoyer ma demande'}
      </button>
      <p className="sm:col-span-2 m-0 text-[13px] text-[#5A7177]">* champs obligatoires · Réponse sous un jour ouvré</p>
    </form>
  )
}
