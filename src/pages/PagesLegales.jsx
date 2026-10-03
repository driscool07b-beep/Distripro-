import { Link, useParams } from 'react-router-dom'
import { EDITEUR as E, documentEnCoursDeFinalisation } from '../lib/infosEditeur'

// Pages légales publiques (accessibles sans connexion). Rédigées en français,
// langue qui fait foi. Modèles à faire valider par un juriste avant le
// lancement commercial.

const DOCUMENTS = {
  cgu: {
    titre: "Conditions générales d'utilisation",
    sections: [
      ['1. Objet', `Les présentes conditions régissent l'accès et l'utilisation de DistribPro, logiciel de gestion commerciale et de distribution accessible en ligne (« le Service »), édité par ${E.raisonSociale} (« l'Éditeur »). Toute création de compte vaut acceptation pleine et entière des présentes conditions.`],
      ['2. Comptes et accès', `Le Service est réservé aux professionnels. L'entreprise cliente (« le Client ») désigne un administrateur, qui invite ses collaborateurs et leur attribue un rôle. Chaque utilisateur est responsable de la confidentialité de ses identifiants ; toute action réalisée avec ses identifiants est réputée faite par lui. Le Client s'engage à fournir des informations exactes et à les tenir à jour.`],
      ['3. Période d\'essai et abonnement', `Le Service peut être essayé gratuitement pendant une durée indiquée lors de l'inscription. À l'issue de l'essai, son utilisation suppose la souscription d'une formule payante (mensuelle ou annuelle), dont le prix et le nombre de commerciaux autorisés figurent dans l'espace « Mon abonnement ». Les prix s'entendent en francs CFA. L'abonnement est payable d'avance ; il est prolongé pour la période payée à compter de l'échéance en cours.`],
      ['4. Unités d\'intelligence artificielle', `Les fonctions d'intelligence artificielle (assistant, saisie dictée, analyses, rapports commentés, planification) consomment des unités IA, décomptées à chaque utilisation et visibles dans « Mon abonnement ». Des unités peuvent être offertes ou achetées par packs. Les unités ne sont ni remboursables ni convertibles en espèces. À solde nul, les fonctions d'IA sont suspendues jusqu'à la recharge.`],
      ['5. Paiement, retard et suspension', `Les paiements en ligne sont traités par un prestataire de paiement agréé ; l'Éditeur n'a jamais accès aux données bancaires. En cas de non-paiement à l'échéance ou d'essai expiré, l'Éditeur peut, après rappels, placer l'espace du Client en lecture seule, puis suspendre l'accès. Les données sont conservées pendant la suspension et l'accès complet est rétabli dès régularisation.`],
      ['6. Données du Client', `Les données saisies dans le Service (clients, produits, ventes, stocks, documents…) restent la propriété exclusive du Client. L'Éditeur les traite uniquement pour fournir le Service, en qualité de sous-traitant, conformément à la politique de confidentialité. Le Client peut exporter ses données (Excel, PDF) à tout moment ; en cas de résiliation, il dispose d'un délai de trente (30) jours pour les récupérer avant leur suppression.`],
      ['7. Obligations du Client', `Le Client s'engage à utiliser le Service conformément aux lois en vigueur, notamment en matière fiscale, commerciale, sociale et de protection des données personnelles. Il est seul responsable des informations qu'il saisit, des documents qu'il émet (factures, reçus, bons, actes) et de leur conformité. Lorsqu'il utilise la facture normalisée électronique (FNE), il reste responsable de ses obligations déclaratives auprès de l'administration fiscale.`],
      ['8. Intelligence artificielle', `Les contenus produits par l'IA (réponses, analyses, recommandations, brouillons de saisie) sont fournis à titre d'aide. Ils peuvent comporter des erreurs et doivent être vérifiés par l'utilisateur. Aucune saisie préparée par l'assistant n'est enregistrée sans la validation expresse de l'utilisateur.`],
      ['9. Disponibilité et maintenance', `L'Éditeur met en œuvre les moyens raisonnables pour assurer l'accès au Service 24 h/24, sans garantie d'absence d'interruption, notamment pour maintenance, mise à jour ou en cas d'incident chez un prestataire technique. Les opérations de maintenance programmées sont, dans la mesure du possible, annoncées dans l'application.`],
      ['10. Responsabilité', `L'Éditeur est tenu d'une obligation de moyens. Sa responsabilité ne saurait être engagée pour les dommages indirects (perte de chiffre d'affaires, de clientèle, de données imputables au Client…). En tout état de cause, sa responsabilité est limitée au montant des sommes versées par le Client au titre des douze (12) derniers mois.`],
      ['11. Propriété intellectuelle', `Le Service, son code, sa marque, ses interfaces et ses contenus sont la propriété de l'Éditeur. Le Client bénéficie d'un droit d'utilisation personnel, non exclusif et non transférable, pour la durée de son abonnement. Toute reproduction, revente ou ingénierie inverse est interdite.`],
      ['12. Résiliation', `Le Client peut cesser son abonnement à tout moment : il prend fin à l'échéance de la période payée, sans remboursement de la période en cours. L'Éditeur peut résilier l'accès en cas de manquement grave du Client aux présentes, après mise en demeure restée sans effet pendant quinze (15) jours.`],
      ['13. Modification des conditions', `L'Éditeur peut faire évoluer les présentes conditions. Les modifications substantielles sont portées à la connaissance des clients dans l'application au moins quinze (15) jours avant leur entrée en vigueur.`],
      ['14. Droit applicable et litiges', `Les présentes conditions sont soumises au droit ivoirien et aux Actes uniformes OHADA applicables. À défaut d'accord amiable, tout litige relève de la compétence du Tribunal de commerce d'Abidjan.`],
      ['15. Contact', `${E.raisonSociale} — ${E.siege} — ${E.email}`],
    ],
  },
  confidentialite: {
    titre: 'Politique de confidentialité',
    sections: [
      ['1. Qui traite vos données ?', `Pour les comptes, l'abonnement et la relation commerciale, ${E.raisonSociale} est responsable du traitement. Pour les données que les entreprises clientes saisissent sur leurs propres clients, commerciaux et opérations, l'entreprise cliente est responsable du traitement et l'Éditeur agit en qualité de sous-traitant, uniquement sur ses instructions.`],
      ['2. Cadre légal', `Les traitements sont réalisés conformément à la loi n° 2013-450 du 19 juin 2013 relative à la protection des données à caractère personnel et aux décisions de l'Autorité de protection (ARTCI). Référence de déclaration ou d'autorisation : ${E.declarationArtci}.`],
      ['3. Données collectées', `Données de compte (nom, email, téléphone, rôle, photo de profil facultative) ; données de l'entreprise (raison sociale, coordonnées, identifiants fiscaux, logo) ; données saisies dans le Service (clients, produits, ventes, stocks, encaissements, tournées, rapports de visite et leurs photos) ; position GPS lors des visites terrain, lorsque la fonction est utilisée ; données techniques (journaux de connexion, appareil) ; données de paiement d'abonnement, hors données bancaires, qui restent chez le prestataire de paiement.`],
      ['4. Finalités', `Fournir et sécuriser le Service ; gérer les comptes, abonnements et paiements ; produire les documents commerciaux et, à la demande du client, les factures normalisées (FNE) ; fournir les fonctions d'intelligence artificielle ; envoyer les emails de service (invitations, réinitialisation de mot de passe, rappels d'échéance, rapports) ; assurer le support et améliorer le Service.`],
      ['5. Prestataires et destinataires', `Les données sont accessibles aux seuls utilisateurs autorisés de l'entreprise cliente, selon leur rôle, et aux prestataires techniques nécessaires au Service : hébergement de la base de données et des fichiers (Supabase), hébergement de l'application (Netlify), envoi d'emails (Resend), intelligence artificielle (Anthropic, pour les seules requêtes d'IA), paiement en ligne (CinetPay) et, lorsque le client l'active, la plateforme FNE de la Direction générale des impôts. Aucune donnée n'est vendue ni utilisée à des fins publicitaires.`],
      ['6. Transferts hors de Côte d\'Ivoire', `Certains prestataires hébergent ou traitent des données hors de Côte d'Ivoire. Ces transferts sont encadrés conformément à la loi n° 2013-450 et aux autorisations de l'ARTCI, et ne portent que sur les données nécessaires au Service.`],
      ['7. Durée de conservation', `Les données sont conservées pendant la durée de l'abonnement, puis trente (30) jours après la résiliation pour permettre leur récupération, avant suppression ; à l'exception des pièces comptables et fiscales, conservées pendant les durées légales.`],
      ['8. Sécurité', `Chiffrement des échanges (HTTPS), cloisonnement strict des données de chaque entreprise, droits d'accès selon le rôle, journalisation des actions sensibles, mots de passe jamais stockés en clair, clés et secrets techniques inaccessibles depuis l'application.`],
      ['9. Vos droits', `Vous disposez d'un droit d'accès, de rectification, d'opposition pour motif légitime et de suppression de vos données, dans les conditions prévues par la loi. Pour l'exercer : ${E.email}. Pour les données saisies par une entreprise cliente, adressez-vous d'abord à cette entreprise. Vous pouvez également saisir l'ARTCI.`],
      ['10. Stockage local', `L'application conserve sur votre appareil quelques préférences (langue, apparence, affichage de l'assistant) et des données nécessaires au fonctionnement hors connexion. Aucun traceur publicitaire n'est utilisé.`],
      ['11. Contact', `${E.raisonSociale} — ${E.siege} — ${E.email}`],
    ],
  },
  mentions: {
    titre: 'Mentions légales',
    sections: [
      ['Éditeur', `${E.raisonSociale}, ${E.formeJuridique} au capital de ${E.capital}. Siège : ${E.siege}. RCCM : ${E.rccm}. NCC : ${E.ncc}. Représentant légal et directeur de la publication : ${E.representant}. Contact : ${E.email} — ${E.telephone}.`],
      ['Hébergement de l\'application', 'Netlify, Inc. — San Francisco, Californie, États-Unis — netlify.com. [Adresse postale à vérifier]'],
      ['Hébergement des données', 'Supabase, Inc. — supabase.com. [Adresse postale et région d\'hébergement des données à vérifier]'],
      ['Protection des données', `Déclaration / autorisation ARTCI : ${E.declarationArtci}. Voir la politique de confidentialité.`],
      ['Propriété intellectuelle', `La marque DistribPro, le logiciel et ses contenus sont la propriété de ${E.raisonSociale}. Toute reproduction non autorisée est interdite.`],
    ],
  },
}

export default function PagesLegales() {
  const { document } = useParams()
  const doc = DOCUMENTS[document] || DOCUMENTS.cgu
  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-3xl mx-auto p-4 sm:p-8">
        <Link to="/" className="text-sm text-petrol-600 underline">← DistribPro</Link>
        <nav className="flex flex-wrap gap-2 my-4 text-xs">
          {Object.entries(DOCUMENTS).map(([cle, d]) => (
            <Link key={cle} to={`/legal/${cle}`} className={`px-3 py-1.5 rounded-full border ${DOCUMENTS[document] === d || (!DOCUMENTS[document] && cle === 'cgu') ? 'bg-petrol-800 text-white border-petrol-800' : 'bg-white border-line'}`}>{d.titre}</Link>
          ))}
        </nav>
        <h1 className="text-2xl font-bold">{doc.titre}</h1>
        <p className="text-xs text-petrol-500 mt-1">Version du {E.dateVersion}</p>
        {documentEnCoursDeFinalisation() && (
          <p className="mt-3 text-xs rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2">Document en cours de finalisation : les informations entre crochets seront complétées à l'immatriculation de la société éditrice.</p>
        )}
        <div className="mt-6 space-y-5">
          {doc.sections.map(([titre, texte]) => (
            <section key={titre}>
              <h2 className="font-semibold text-petrol-900">{titre}</h2>
              <p className="text-sm text-petrol-800 leading-relaxed mt-1 whitespace-pre-line">{texte}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
