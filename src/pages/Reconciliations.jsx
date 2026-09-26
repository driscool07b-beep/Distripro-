import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatXOF, formatDate } from '../lib/format'
import { traduireErreur } from '../lib/erreurs'
import { ecrireEnTeteEntreprise } from '../lib/export'

// Réconciliation des commerciaux : stock (sorties, ventes, retours, compté)
// et argent (ventes comptant, recouvrements, versements), justification par
// le commercial, double validation caisse → comptable, dettes et
// remboursements. Les écritures comptables sont passées par le serveur.
const COULEURS_STATUT = {
  brouillon: 'bg-amber-100 text-amber-800',
  validee_caisse: 'bg-sky-100 text-sky-800',
  validee: 'bg-emerald-100 text-emerald-800',
  annulee: 'bg-gray-100 text-gray-500 line-through',
}

const aujourdhui = () => new Date().toISOString().slice(0, 10)

export default function Reconciliations() {
  const { t } = useTranslation('reconciliations')
  const { profil, entreprise } = useAuth()
  const [onglet, setOnglet] = useState('fiches')
  const [fiches, setFiches] = useState([])
  const [membres, setMembres] = useState([])
  const [caisses, setCaisses] = useState([])
  const [estResponsableCaisse, setEstResponsableCaisse] = useState(false)
  const [filtreCommercial, setFiltreCommercial] = useState('')
  const [ficheOuverte, setFicheOuverte] = useState(null)
  const [nouvelle, setNouvelle] = useState(null)
  const [erreur, setErreur] = useState('')
  const [envoi, setEnvoi] = useState(false)

  const role = profil?.role
  const estDirection = ['admin', 'manager'].includes(role)
  const estComptable = ['admin', 'comptable'].includes(role)
  const peutPreparer = estDirection || role === 'comptable' || estResponsableCaisse
  const estCommercial = role === 'commercial'
  const nomMembre = (id) => membres.find((m) => m.id === id)?.nom || '—'
  const commerciaux = membres.filter((m) => m.role === 'commercial')

  async function charger() {
    let requete = supabase.from('reconciliations_commercial').select('*').order('date_fin', { ascending: false }).limit(200)
    if (filtreCommercial) requete = requete.eq('commercial_id', filtreCommercial)
    const { data } = await requete
    setFiches(data || [])
  }

  useEffect(() => {
    supabase.from('profils').select('id, nom, role, actif, compte_tiers_numero').order('nom').then(({ data }) => setMembres(data || []))
    supabase.from('caisses').select('id, nom, responsable_id, actif').eq('actif', true).order('nom').then(({ data }) => {
      setCaisses(data || [])
      setEstResponsableCaisse((data || []).some((c) => c.responsable_id === profil?.id))
    })
  }, [profil?.id])

  useEffect(() => { charger() }, [filtreCommercial])

  async function creerFiche() {
    setErreur('')
    setEnvoi(true)
    const { data, error } = await supabase.rpc('preparer_reconciliation', {
      p_commercial_id: nouvelle.commercial_id, p_date_debut: nouvelle.date_debut, p_date_fin: nouvelle.date_fin,
    })
    setEnvoi(false)
    if (error) { setErreur(traduireErreur(error.message)); return }
    setNouvelle(null)
    await charger()
    setFicheOuverte(data)
  }

  if (ficheOuverte) {
    return (
      <FicheReconciliation
        id={ficheOuverte}
        nomMembre={nomMembre}
        peutPreparer={peutPreparer}
        estComptable={estComptable}
        estDirection={estDirection}
        entreprise={entreprise}
        onRetour={() => { setFicheOuverte(null); charger() }}
      />
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold mb-1">{t('titre')}</h1>
      <p className="text-sm text-petrol-500 mb-4">{t('sousTitre')}</p>

      <div className="flex gap-2 mb-4">
        {['fiches', 'dettes'].map((o) => (
          <button key={o} onClick={() => setOnglet(o)}
            className={`px-4 py-2 rounded-full text-sm border ${onglet === o ? 'bg-petrol-800 text-white border-petrol-800' : 'border-line text-petrol-700'}`}>
            {t(`onglets.${o}`)}
          </button>
        ))}
      </div>

      {onglet === 'fiches' && (
        <>
          <div className="flex flex-wrap gap-2 items-end mb-4">
            {!estCommercial && (
              <select className="input-field sm:max-w-xs" value={filtreCommercial} onChange={(e) => setFiltreCommercial(e.target.value)}>
                <option value="">{t('tousCommerciaux')}</option>
                {commerciaux.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            )}
            <div className="flex-1" />
            {peutPreparer && (
              <button data-aide="reconciliations.nouvelle" className="btn-primary text-sm"
                onClick={() => { setErreur(''); setNouvelle({ commercial_id: '', date_debut: aujourdhui(), date_fin: aujourdhui() }) }}>
                {t('nouvelle')}
              </button>
            )}
          </div>

          {nouvelle && (
            <div className="card p-4 mb-4 space-y-3">
              <p className="font-semibold">{t('nouvelleTitre')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="label">{t('commercial')}</label>
                  <select className="input-field" value={nouvelle.commercial_id} onChange={(e) => setNouvelle({ ...nouvelle, commercial_id: e.target.value })}>
                    <option value="">{t('choisir')}</option>
                    {commerciaux.filter((c) => c.actif !== false).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{t('du')}</label>
                  <input type="date" className="input-field" value={nouvelle.date_debut} onChange={(e) => setNouvelle({ ...nouvelle, date_debut: e.target.value })} />
                </div>
                <div>
                  <label className="label">{t('au')}</label>
                  <input type="date" className="input-field" value={nouvelle.date_fin} max={aujourdhui()} onChange={(e) => setNouvelle({ ...nouvelle, date_fin: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-petrol-500">{t('nouvelleAide')}</p>
              {erreur && <p className="text-sm text-red-600">{erreur}</p>}
              <div className="flex gap-2">
                <button className="btn-primary text-sm" disabled={envoi || !nouvelle.commercial_id} onClick={creerFiche}>{envoi ? t('calcul') : t('preparer')}</button>
                <button className="btn-secondary text-sm" onClick={() => setNouvelle(null)}>{t('annuler')}</button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {fiches.map((f) => (
              <button key={f.id} onClick={() => setFicheOuverte(f.id)} className="w-full text-left border border-line rounded-lg p-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">{f.numero} — {nomMembre(f.commercial_id)}</p>
                  <p className="text-xs text-petrol-500">{formatDate(f.date_debut)} → {formatDate(f.date_fin)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-end text-xs">
                    <p>{t('ecartArgent')} <span className={`font-mono ${f.ecart_argent > 0 ? 'text-red-600' : ''}`}>{formatXOF(f.ecart_argent)}</span></p>
                    <p>{t('manquantStock')} <span className={`font-mono ${f.valeur_manquant > 0 ? 'text-red-600' : ''}`}>{formatXOF(f.valeur_manquant)}</span></p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${COULEURS_STATUT[f.statut]}`}>{t(`statuts.${f.statut}`)}</span>
                </div>
              </button>
            ))}
            {fiches.length === 0 && <p className="text-sm text-petrol-400 text-center py-8">{t('aucuneFiche')}</p>}
          </div>
        </>
      )}

      {onglet === 'dettes' && (
        <DettesCommerciaux
          entreprise={entreprise}
          commerciaux={estCommercial ? membres.filter((m) => m.id === profil?.id) : commerciaux}
          caisses={caisses}
          peutEncaisser={['admin', 'manager', 'comptable'].includes(role)}
          peutAnnuler={role === 'admin'}
        />
      )}
    </div>
  )
}

function FicheReconciliation({ id, nomMembre, peutPreparer, estComptable, estDirection, entreprise, onRetour }) {
  const { t } = useTranslation('reconciliations')
  const { profil } = useAuth()
  const [fiche, setFiche] = useState(null)
  const [lignes, setLignes] = useState([])
  const [versements, setVersements] = useState([])
  const [comptes, setComptes] = useState({})
  const [justification, setJustification] = useState('')
  const [decisionArgent, setDecisionArgent] = useState('dette')
  const [decisionManquant, setDecisionManquant] = useState('dette')
  const [commentaire, setCommentaire] = useState('')
  const [erreur, setErreur] = useState('')
  const [envoi, setEnvoi] = useState(false)

  async function charger() {
    const { data: f } = await supabase.from('reconciliations_commercial').select('*').eq('id', id).single()
    const { data: l } = await supabase.from('reconciliation_lignes').select('*, produits(nom)').eq('reconciliation_id', id).order('produit_id')
    setFiche(f)
    setLignes(l || [])
    setComptes(Object.fromEntries((l || []).map((x) => [x.produit_id, String(x.stock_compte)])))
    setJustification(f?.justification || '')
    if (f) {
      const { data: v } = await supabase.from('versements_caisse').select('numero, montant, date_versement, nature, caisses(nom)')
        .eq('commercial_id', f.commercial_id).gte('date_versement', f.date_debut).lte('date_versement', f.date_fin).order('date_versement')
      setVersements(v || [])
    }
  }
  useEffect(() => { charger() }, [id])

  async function action(fn, params, message) {
    setErreur('')
    setEnvoi(true)
    const { error } = await supabase.rpc(fn, params)
    setEnvoi(false)
    if (error) { setErreur(traduireErreur(error.message)); return false }
    if (message) alert(message)
    await charger()
    return true
  }

  if (!fiche) return <div className="p-6 text-sm text-petrol-500">{t('chargement')}</div>

  const brouillon = fiche.statut === 'brouillon'
  const estLeCommercial = profil?.id === fiche.commercial_id
  const peutJustifier = (estLeCommercial || estDirection) && ['brouillon', 'validee_caisse'].includes(fiche.statut)
  const comptageModifie = lignes.some((l) => String(l.stock_compte) !== comptes[l.produit_id])

  function imprimer() {
    const doc = new jsPDF({ orientation: 'landscape' })
    let y = ecrireEnTeteEntreprise(doc, entreprise)
    doc.setFontSize(14)
    doc.text(`${t('fichePdf')} ${fiche.numero}`, 14, y + 4)
    doc.setFontSize(10)
    doc.text(`${t('commercial')} : ${nomMembre(fiche.commercial_id)} — ${t('periode')} : ${formatDate(fiche.date_debut)} → ${formatDate(fiche.date_fin)} — ${t(`statuts.${fiche.statut}`)}`, 14, y + 11)
    autoTable(doc, {
      startY: y + 16,
      head: [[t('col.produit'), t('col.debut'), t('col.sorties'), t('col.ventes'), t('col.retours'), t('col.autres'), t('col.theorique'), t('col.compte'), t('col.ecart'), t('col.valeur')]],
      body: lignes.map((l) => [l.produits?.nom, l.stock_debut, l.sorties, l.ventes, l.retours, l.autres, l.stock_theorique, l.stock_compte, l.ecart, formatXOF(l.valeur_ecart)]),
      styles: { fontSize: 8 },
    })
    let y2 = doc.lastAutoTable.finalY + 8
    const argent = [
      [t('ventesComptant'), formatXOF(fiche.ventes_comptant)],
      [t('recouvrements'), formatXOF(fiche.recouvrements)],
      [t('montantDu'), formatXOF(fiche.montant_du)],
      [t('montantVerse'), formatXOF(fiche.montant_verse)],
      [t('ecartArgent'), formatXOF(fiche.ecart_argent)],
      [t('manquantStock'), formatXOF(fiche.valeur_manquant)],
    ]
    autoTable(doc, { startY: y2, body: argent, theme: 'plain', styles: { fontSize: 9 }, columnStyles: { 1: { halign: 'right' } }, tableWidth: 110 })
    y2 = doc.lastAutoTable.finalY + 6
    if (versements.length) {
      doc.setFontSize(9)
      doc.text(`${t('versementsRattaches')} : ${versements.map((v) => `${v.numero || '—'} (${formatXOF(v.montant)})`).join(', ')}`, 14, y2, { maxWidth: 270 })
      y2 += 8
    }
    if (fiche.justification) { doc.text(`${t('justification')} : ${fiche.justification}`, 14, y2, { maxWidth: 270 }); y2 += 10 }
    if (fiche.statut === 'validee') {
      doc.text(`${t('decisionFinale')} : ${fiche.montant_dette > 0 ? t('detteCree', { montant: formatXOF(fiche.montant_dette) }) : t('aucuneDette')}${fiche.commentaire_comptable ? ` — ${fiche.commentaire_comptable}` : ''}`, 14, y2, { maxWidth: 270 })
      y2 += 10
    }
    doc.text(`${t('signCommercial')} : ____________________     ${t('signCaisse')} : ____________________     ${t('signComptable')} : ____________________`, 14, Math.min(y2 + 10, 195))
    doc.save(`${fiche.numero}.pdf`)
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <button className="text-sm text-petrol-600 mb-3" onClick={onRetour}>← {t('retourListe')}</button>
      <div className="flex flex-wrap justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold">{fiche.numero} — {nomMembre(fiche.commercial_id)}</h1>
          <p className="text-sm text-petrol-500">{formatDate(fiche.date_debut)} → {formatDate(fiche.date_fin)} · {t('valorisation')} : {t(`valorisations.${fiche.valorisation}`)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full ${COULEURS_STATUT[fiche.statut]}`}>{t(`statuts.${fiche.statut}`)}</span>
          <button data-aide="reconciliations.imprimer" className="btn-secondary text-sm" onClick={imprimer}>🖨️ {t('imprimer')}</button>
        </div>
      </div>

      {/* Stock */}
      <div className="card p-4 mb-4">
        <h2 className="font-semibold mb-1">📦 {t('partieStock')}</h2>
        <p className="text-xs text-petrol-500 mb-3">{t('partieStockAide')}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[820px]" data-tableau-classique>
            <thead>
              <tr className="bg-canvas text-left text-petrol-600">
                {['produit', 'debut', 'sorties', 'ventes', 'retours', 'autres', 'theorique', 'compte', 'ecart', 'valeur'].map((c) => (
                  <th key={c} className={`px-2 py-2 ${c !== 'produit' ? 'text-right' : ''}`}>{t(`col.${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id} className="border-b border-line">
                  <td className="px-2 py-2 font-medium">{l.produits?.nom}</td>
                  <td className="px-2 py-2 text-right font-mono">{l.stock_debut}</td>
                  <td className="px-2 py-2 text-right font-mono">+{l.sorties}</td>
                  <td className="px-2 py-2 text-right font-mono">−{l.ventes}</td>
                  <td className="px-2 py-2 text-right font-mono">−{l.retours}</td>
                  <td className="px-2 py-2 text-right font-mono">{l.autres}</td>
                  <td className="px-2 py-2 text-right font-mono font-semibold">{l.stock_theorique}</td>
                  <td className="px-2 py-2 text-right">
                    {brouillon && peutPreparer ? (
                      <input type="number" min="0" className="input-field !py-1 !px-2 w-20 text-right" value={comptes[l.produit_id] ?? ''}
                        onChange={(e) => setComptes({ ...comptes, [l.produit_id]: e.target.value })} />
                    ) : <span className="font-mono">{l.stock_compte}</span>}
                  </td>
                  <td className={`px-2 py-2 text-right font-mono ${l.ecart > 0 ? 'text-red-600 font-semibold' : l.ecart < 0 ? 'text-sky-700' : ''}`}>{l.ecart}</td>
                  <td className={`px-2 py-2 text-right font-mono ${l.valeur_ecart > 0 ? 'text-red-600' : ''}`}>{formatXOF(l.valeur_ecart)}</td>
                </tr>
              ))}
              {lignes.length === 0 && <tr><td colSpan={10} className="px-2 py-6 text-center text-petrol-400">{t('aucunStock')}</td></tr>}
            </tbody>
          </table>
        </div>
        {brouillon && peutPreparer && comptageModifie && (
          <button className="btn-primary text-sm mt-3" disabled={envoi}
            onClick={() => action('saisir_comptage_reconciliation', { p_id: id, p_lignes: lignes.map((l) => ({ produit_id: l.produit_id, stock_compte: Number(comptes[l.produit_id] || 0) })) })}>
            {t('enregistrerComptage')}
          </button>
        )}
      </div>

      {/* Argent */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="card p-4">
          <h2 className="font-semibold mb-3">💰 {t('partieArgent')}</h2>
          <dl className="text-sm space-y-1.5">
            {[['ventesComptant', fiche.ventes_comptant], ['recouvrements', fiche.recouvrements], ['montantDu', fiche.montant_du, true], ['montantVerse', fiche.montant_verse]].map(([cle, v, gras]) => (
              <div key={cle} className={`flex justify-between ${gras ? 'font-semibold border-t border-line pt-1.5' : ''}`}><dt>{t(cle)}</dt><dd className="font-mono">{formatXOF(v)}</dd></div>
            ))}
            <div className="flex justify-between font-semibold border-t border-line pt-1.5">
              <dt>{t('ecartArgent')}</dt>
              <dd className={`font-mono ${fiche.ecart_argent > 0 ? 'text-red-600' : fiche.ecart_argent < 0 ? 'text-sky-700' : 'text-emerald-700'}`}>{formatXOF(fiche.ecart_argent)}</dd>
            </div>
          </dl>
          <p className="text-xs font-medium text-petrol-600 mt-3 mb-1">{t('versementsRattaches')}</p>
          {versements.length === 0 ? <p className="text-xs text-petrol-400">{t('aucunVersement')}</p> : (
            <ul className="text-xs space-y-1">
              {versements.map((v, i) => (
                <li key={i} className="flex justify-between">
                  <span>{formatDate(v.date_versement)} — {v.numero || '—'} — {v.caisses?.nom}{v.nature === 'remboursement_dette' ? ` (${t('remboursement')})` : ''}</span>
                  <span className="font-mono">{formatXOF(v.montant)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-4">
          <h2 className="font-semibold mb-3">📝 {t('justification')}</h2>
          {peutJustifier ? (
            <>
              <textarea rows={4} className="input-field" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder={t('justificationPlaceholder')} />
              <button className="btn-secondary text-sm mt-2" disabled={envoi || justification.trim().length < 3 || justification === (fiche.justification || '')}
                onClick={() => action('justifier_reconciliation', { p_id: id, p_texte: justification })}>{t('enregistrerJustification')}</button>
            </>
          ) : (
            <p className="text-sm text-petrol-700">{fiche.justification || t('aucuneJustification')}</p>
          )}
          {fiche.justifie_at && <p className="text-xs text-petrol-500 mt-2">{t('justifiePar', { nom: nomMembre(fiche.justifie_par), date: formatDate(fiche.justifie_at) })}</p>}
        </div>
      </div>

      {/* Validations */}
      <div className="card p-4">
        <h2 className="font-semibold mb-3">✅ {t('validations')}</h2>
        <ol className="text-sm space-y-1 mb-4">
          <li>1. {t('etapeCaisse')} : {fiche.valide_caisse_at ? t('faitPar', { nom: nomMembre(fiche.valide_caisse_par), date: formatDate(fiche.valide_caisse_at) }) : t('enAttente')}</li>
          <li>2. {t('etapeComptable')} : {fiche.valide_comptable_at ? t('faitPar', { nom: nomMembre(fiche.valide_comptable_par), date: formatDate(fiche.valide_comptable_at) }) : t('enAttente')}</li>
        </ol>

        {brouillon && peutPreparer && !estLeCommercial && (
          <div className="flex flex-wrap gap-2">
            <button data-aide="reconciliations.validerCaisse" className="btn-primary text-sm" disabled={envoi || comptageModifie}
              onClick={() => { if (window.confirm(t('confirmerCaisse'))) action('valider_reconciliation_caisse', { p_id: id }) }}>
              {t('validerCaisse')}
            </button>
            <button className="btn-secondary text-sm" disabled={envoi}
              onClick={() => { const motif = window.prompt(t('motifAnnulation')); if (motif) action('annuler_reconciliation', { p_id: id, p_motif: motif }) }}>
              {t('annulerFiche')}
            </button>
            {comptageModifie && <p className="text-xs text-amber-700 w-full">{t('enregistrerAvant')}</p>}
          </div>
        )}

        {fiche.statut === 'validee_caisse' && estComptable && !estLeCommercial && (
          <div className="space-y-3">
            {fiche.ecart_argent > 0 && (
              <div>
                <label className="label">{t('traitementArgent', { montant: formatXOF(fiche.ecart_argent) })}</label>
                <select className="input-field sm:max-w-md" value={decisionArgent} onChange={(e) => setDecisionArgent(e.target.value)}>
                  <option value="dette">{t('decisions.dette')}</option>
                  <option value="perte">{t('decisions.perte')}</option>
                </select>
              </div>
            )}
            {fiche.valeur_manquant > 0 && (
              <div>
                <label className="label">{t('traitementManquant', { montant: formatXOF(fiche.valeur_manquant) })}</label>
                <select className="input-field sm:max-w-md" value={decisionManquant} onChange={(e) => setDecisionManquant(e.target.value)}>
                  <option value="dette">{t('decisions.dette')}</option>
                  <option value="perte">{t('decisions.perte')}</option>
                </select>
              </div>
            )}
            <input className="input-field" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder={t('commentairePlaceholder')} />
            <button data-aide="reconciliations.validerComptable" className="btn-primary text-sm" disabled={envoi}
              onClick={() => { if (window.confirm(t('confirmerComptable'))) action('valider_reconciliation_comptable', { p_id: id, p_decision_argent: decisionArgent, p_decision_manquant: decisionManquant, p_commentaire: commentaire }) }}>
              {t('validerComptable')}
            </button>
          </div>
        )}

        {fiche.statut === 'validee' && (
          <p className="text-sm">
            {fiche.montant_dette > 0 ? <span className="text-red-700 font-medium">{t('detteCree', { montant: formatXOF(fiche.montant_dette) })}</span> : <span className="text-emerald-700">{t('aucuneDette')}</span>}
            {fiche.commentaire_comptable && <span className="block text-petrol-600 mt-1">« {fiche.commentaire_comptable} »</span>}
          </p>
        )}
        {erreur && <p className="text-sm text-red-600 mt-3">{erreur}</p>}
      </div>
    </div>
  )
}

function DettesCommerciaux({ entreprise, commerciaux, caisses, peutEncaisser, peutAnnuler }) {
  const { t } = useTranslation('reconciliations')
  const [mouvements, setMouvements] = useState([])
  const [avances, setAvances] = useState([])
  const [retenues, setRetenues] = useState([])
  const [forcage, setForcage] = useState(null) // { commercial_id, montant, nb, periode, motif }
  const { profil } = useAuth()
  const peutForcer = ['admin', 'comptable'].includes(profil?.role)
  const moisCourant = new Date().toISOString().slice(0, 7)
  const [moisEtat, setMoisEtat] = useState(moisCourant)
  const [ouvert, setOuvert] = useState(null)
  const [saisie, setSaisie] = useState({ caisse_id: '', montant: '', motif: '' })
  const [erreur, setErreur] = useState('')
  const [envoi, setEnvoi] = useState(false)

  async function charger() {
    const [{ data }, { data: av }, { data: re }] = await Promise.all([
      supabase.from('dettes_commerciaux').select('*, auteur:profils!effectue_par(nom)').order('created_at', { ascending: false }),
      supabase.from('avances_salaire').select('*').order('created_at', { ascending: false }),
      supabase.from('retenues_salaire').select('*').order('periode_paie'),
    ])
    setMouvements(data || [])
    setAvances(av || [])
    setRetenues(re || [])
  }
  useEffect(() => { charger() }, [])

  const solde = (id) => mouvements.filter((m) => m.commercial_id === id).reduce((s, m) => s + (m.type === 'dette' ? Number(m.montant) : -Number(m.montant)), 0)

  async function rembourser(commercialId) {
    setErreur('')
    setEnvoi(true)
    const { error } = await supabase.rpc('enregistrer_remboursement_dette', {
      p_commercial_id: commercialId, p_caisse_id: saisie.caisse_id, p_montant: Number(saisie.montant), p_motif: saisie.motif,
    })
    setEnvoi(false)
    if (error) { setErreur(traduireErreur(error.message)); return }
    setSaisie({ caisse_id: '', montant: '', motif: '' })
    charger()
  }

  async function annuler(commercialId) {
    const montant = window.prompt(t('montantAnnulation'))
    if (!montant) return
    const motif = window.prompt(t('motifAbandon'))
    if (!motif) return
    const { error } = await supabase.rpc('annuler_dette_commercial', { p_commercial_id: commercialId, p_montant: Number(montant), p_motif: motif })
    if (error) { alert(traduireErreur(error.message)); return }
    charger()
  }

  const restant = (a) => Number(a.montant) - retenues.filter((r) => r.avance_id === a.id).reduce((n, r) => n + Number(r.montant), 0)
  const nom = (id) => commerciaux.find((c) => c.id === id)?.nom || '—'
  const retenueParAvanceEtMois = (a, mois) => retenues.find((r) => r.avance_id === a.id && r.periode_paie === mois)
  // Mensualité due pour un mois : la mensualité (ou le reste, s'il est plus petit),
  // à partir du premier mois de retenue.
  const dueDuMois = (a, mois) => (a.statut === 'en_cours' && mois >= a.premiere_periode ? Math.min(Number(a.mensualite), restant(a)) : 0)

  async function lancerForcage() {
    setErreur('')
    setEnvoi(true)
    const { error } = await supabase.rpc('recouvrement_force', {
      p_commercial_id: forcage.commercial_id, p_montant: Number(forcage.montant), p_nb_mensualites: Number(forcage.nb),
      p_premiere_periode: forcage.periode, p_motif: forcage.motif,
    })
    setEnvoi(false)
    if (error) { setErreur(traduireErreur(error.message)); return }
    setForcage(null)
    charger()
  }

  async function enregistrerRetenue(a) {
    const montant = window.prompt(t('avances.montantRetenue', { mois: moisEtat }), String(dueDuMois(a, moisEtat) || Number(a.mensualite)))
    if (!montant) return
    const { error } = await supabase.rpc('enregistrer_retenue_salaire', { p_avance_id: a.id, p_periode_paie: moisEtat, p_montant: Number(montant) })
    if (error) { alert(traduireErreur(error.message)); return }
    charger()
  }

  function imprimerNotification(a) {
    const doc = new jsPDF()
    let y = ecrireEnTeteEntreprise(doc, entreprise)
    doc.setFontSize(14)
    doc.text(t('avances.notifTitre'), 14, y + 6)
    doc.setFontSize(10)
    const lignes = [
      t('avances.notifSalarie', { nom: nom(a.commercial_id) }),
      t('avances.notifMontant', { montant: formatXOF(a.montant) }),
      t('avances.notifMotif', { motif: a.motif }),
      t('avances.notifEcheancier', { nb: a.nb_mensualites, mensualite: formatXOF(a.mensualite), debut: a.premiere_periode }),
      '',
      t('avances.notifTexte'),
    ]
    let yy = y + 16
    lignes.forEach((l) => { const d = doc.splitTextToSize(l, 180); doc.text(d, 14, yy); yy += d.length * 5 + 2 })
    yy += 14
    doc.text(t('avances.notifFait', { date: formatDate(new Date()) }), 14, yy)
    doc.text(`${t('avances.signSalarie')} :`, 14, yy + 14)
    doc.text(`${t('avances.signEmployeur')} :`, 120, yy + 14)
    doc.save(`notification-retenue-${nom(a.commercial_id).replace(/\s+/g, '-')}.pdf`)
  }

  function imprimerEtatMensuel() {
    const lignes = avances
      .map((a) => ({ a, due: dueDuMois(a, moisEtat), saisie: retenueParAvanceEtMois(a, moisEtat) }))
      .filter((x) => x.due > 0 || x.saisie)
    const doc = new jsPDF()
    const y = ecrireEnTeteEntreprise(doc, entreprise)
    doc.setFontSize(14)
    doc.text(t('avances.etatTitre', { mois: moisEtat }), 14, y + 6)
    doc.setFontSize(9)
    doc.text(entreprise?.retenues_comptabilisees_par === 'distribpro' ? t('avances.etatNoteDistribpro') : t('avances.etatNotePaie'), 14, y + 12, { maxWidth: 180 })
    autoTable(doc, {
      startY: y + 20,
      head: [[t('commercial'), t('avances.compte'), t('avances.retenue'), t('avances.resteApres')]],
      body: lignes.map(({ a, due, saisie }) => {
        const montant = saisie ? Number(saisie.montant) : due
        return [nom(a.commercial_id), commerciaux.find((c) => c.id === a.commercial_id)?.compte_avance_numero || '421…', formatXOF(montant), formatXOF(restant(a) - (saisie ? 0 : montant))]
      }),
      styles: { fontSize: 9 },
    })
    doc.save(`etat-retenues-${moisEtat}.pdf`)
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-petrol-500 mb-2">{t('dettesAide')}</p>
      {peutForcer && avances.some((a) => a.statut === 'en_cours') && (
        <div className="card p-3 flex flex-wrap items-end gap-2 mb-2">
          <div>
            <label className="label">{t('avances.moisPaie')}</label>
            <input type="month" className="input-field" value={moisEtat} onChange={(e) => setMoisEtat(e.target.value)} />
          </div>
          <button data-aide="reconciliations.etatRetenues" className="btn-secondary text-sm" onClick={imprimerEtatMensuel}>🖨️ {t('avances.etatBouton')}</button>
          <p className="text-xs text-petrol-500 w-full">{entreprise?.retenues_comptabilisees_par === 'distribpro' ? t('avances.modeDistribpro') : t('avances.modePaie')}</p>
        </div>
      )}
      {commerciaux.map((c) => {
        const s = solde(c.id)
        const historique = mouvements.filter((m) => m.commercial_id === c.id)
        return (
          <div key={c.id} className="card p-3">
            <button className="w-full flex justify-between items-center text-left" onClick={() => setOuvert(ouvert === c.id ? null : c.id)}>
              <span>
                <span className="font-medium text-sm">{c.nom}</span>
                {c.compte_tiers_numero && <span className="ms-2 text-xs font-mono text-petrol-500">{c.compte_tiers_numero}</span>}
              </span>
              <span className={`font-mono font-semibold ${s > 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatXOF(s)}</span>
            </button>
            {ouvert === c.id && (
              <div className="mt-3 border-t border-line pt-3 space-y-3">
                {historique.length === 0 ? <p className="text-xs text-petrol-400">{t('aucunMouvementDette')}</p> : (
                  <ul className="text-xs space-y-1">
                    {historique.map((m) => (
                      <li key={m.id} className="flex flex-wrap justify-between gap-2 border-b border-line pb-1">
                        <span>{formatDate(m.created_at)} — {t(`typesDette.${m.type}`)} — {m.motif} — {m.auteur?.nom || '—'}</span>
                        <span className={`font-mono ${m.type === 'dette' ? 'text-red-600' : m.type === 'transfert_salaire' ? 'text-amber-700' : 'text-emerald-700'}`}>{m.type === 'dette' ? '+' : '−'}{formatXOF(m.montant)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {peutEncaisser && s > 0 && (
                  <div className="flex flex-wrap gap-2 items-end">
                    <select className="input-field sm:max-w-[200px]" value={saisie.caisse_id} onChange={(e) => setSaisie({ ...saisie, caisse_id: e.target.value })}>
                      <option value="">{t('caisse')}</option>
                      {caisses.map((k) => <option key={k.id} value={k.id}>{k.nom}</option>)}
                    </select>
                    <input type="number" min="0" max={s} className="input-field sm:max-w-[160px]" placeholder={t('montant')} value={saisie.montant} onChange={(e) => setSaisie({ ...saisie, montant: e.target.value })} />
                    <button className="btn-primary text-sm" disabled={envoi || !saisie.caisse_id || !saisie.montant} onClick={() => rembourser(c.id)}>{t('encaisserRemboursement')}</button>
                    {peutAnnuler && <button className="btn-secondary text-sm" onClick={() => annuler(c.id)}>{t('abandonnerDette')}</button>}
                    {peutForcer && (
                      <button data-aide="reconciliations.recouvrementForce" className="btn-3d btn-3d-rouge text-sm px-3 py-2"
                        onClick={() => setForcage({ commercial_id: c.id, montant: String(s), nb: '1', periode: moisCourant, motif: '' })}>
                        {t('avances.bouton')}
                      </button>
                    )}
                  </div>
                )}
                {forcage?.commercial_id === c.id && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 space-y-2">
                    <p className="text-sm font-medium">{t('avances.titre')}</p>
                    <p className="text-xs text-petrol-600">{t('avances.aide', { racine: entreprise?.compte_racine_avances || '421' })}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div><label className="label">{t('montant')}</label><input type="number" min="0" max={s} className="input-field" value={forcage.montant} onChange={(e) => setForcage({ ...forcage, montant: e.target.value })} /></div>
                      <div><label className="label">{t('avances.nbMensualites')}</label><input type="number" min="1" max="60" className="input-field" value={forcage.nb} onChange={(e) => setForcage({ ...forcage, nb: e.target.value })} /></div>
                      <div><label className="label">{t('avances.premierMois')}</label><input type="month" className="input-field" value={forcage.periode} onChange={(e) => setForcage({ ...forcage, periode: e.target.value })} /></div>
                    </div>
                    {Number(forcage.nb) > 0 && Number(forcage.montant) > 0 && (
                      <p className="text-xs">{t('avances.apercu', { mensualite: formatXOF(Math.ceil(Number(forcage.montant) / Number(forcage.nb))) })}
                        {entreprise?.plafond_retenue_mensuelle ? ` — ${t('avances.plafond', { plafond: formatXOF(entreprise.plafond_retenue_mensuelle) })}` : ''}</p>
                    )}
                    <input className="input-field" value={forcage.motif} onChange={(e) => setForcage({ ...forcage, motif: e.target.value })} placeholder={t('avances.motif')} />
                    <div className="flex gap-2">
                      <button className="btn-primary text-sm" disabled={envoi || forcage.motif.trim().length < 3} onClick={() => { if (window.confirm(t('avances.confirmer'))) lancerForcage() }}>{t('avances.valider')}</button>
                      <button className="btn-secondary text-sm" onClick={() => setForcage(null)}>{t('annuler')}</button>
                    </div>
                  </div>
                )}
                {avances.filter((a) => a.commercial_id === c.id).map((a) => (
                  <div key={a.id} className="rounded-xl border border-line p-3 text-xs space-y-1">
                    <p className="font-medium text-sm">
                      {t('avances.avance')} {formatXOF(a.montant)} — {a.nb_mensualites} × {formatXOF(a.mensualite)} {t('avances.aPartirDe', { mois: a.premiere_periode })}
                      <span className={`ms-2 px-2 py-0.5 rounded-full ${a.statut === 'soldee' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>{t(`avances.statuts.${a.statut}`)}</span>
                    </p>
                    <p className="text-petrol-600">{a.motif} · {t('avances.restant')} <span className="font-mono font-semibold">{formatXOF(restant(a))}</span></p>
                    {retenues.filter((r) => r.avance_id === a.id).map((r) => (
                      <p key={r.id} className="text-petrol-500">✓ {r.periode_paie} : {formatXOF(r.montant)} ({t(`avances.par.${r.comptabilisee_par}`)})</p>
                    ))}
                    <div className="flex flex-wrap gap-3 pt-1">
                      <button className="underline text-petrol-700" onClick={() => imprimerNotification(a)}>🖨️ {t('avances.notifBouton')}</button>
                      {peutForcer && a.statut === 'en_cours' && !retenueParAvanceEtMois(a, moisEtat) && (
                        <button className="underline text-amber-700" onClick={() => enregistrerRetenue(a)}>{t('avances.retenueBouton', { mois: moisEtat })}</button>
                      )}
                    </div>
                  </div>
                ))}
                {erreur && <p className="text-xs text-red-600">{erreur}</p>}
              </div>
            )}
          </div>
        )
      })}
      {commerciaux.length === 0 && <p className="text-sm text-petrol-400">{t('aucunCommercial')}</p>}
    </div>
  )
}
