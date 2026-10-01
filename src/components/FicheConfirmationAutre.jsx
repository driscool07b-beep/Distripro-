import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatXOF, formatDate } from '../lib/format'
import { traduireErreur } from '../lib/erreurs'
import CartePiece from './CartePiece'

// Fiches de confirmation de l'assistant pour les encaissements, les nouveaux
// clients et les rapports de visite. Rien n'est enregistré avant « Valider » ;
// l'enregistrement passe par les mêmes fonctions et règles que les écrans.

function Cadre({ titre, children }) {
  const { t } = useTranslation('assistant')
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50/60 p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{titre}</p>
        <span className="text-[10px] uppercase tracking-wide text-amber-700">{t('fiche.nonEnregistree')}</span>
      </div>
      {children}
    </div>
  )
}

function Boutons({ envoi, onAnnuler, onValider, desactive }) {
  const { t } = useTranslation('assistant')
  return (
    <div className="flex gap-2">
      <button type="button" className="btn-secondary flex-1 text-sm" disabled={envoi} onClick={onAnnuler}>{t('fiche.annuler')}</button>
      <button type="button" className="btn-primary flex-1 text-sm" disabled={envoi || desactive} onClick={onValider}>{envoi ? '…' : `✓ ${t('fiche.valider')}`}</button>
    </div>
  )
}

function Termine({ ok, texte, children }) {
  return (
    <div className="space-y-1.5">
      <div className={`rounded-xl border px-3 py-2 text-sm ${ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-line bg-canvas text-petrol-500'}`}>{texte}</div>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------- Encaissement
function FicheEncaissement({ action, onTermine, onNavigation }) {
  const { t } = useTranslation('assistant')
  const { profil } = useAuth()
  const [mode, setMode] = useState(action.mode || 'espece')
  const [reference, setReference] = useState(action.reference || '')
  const [parts, setParts] = useState(() => Object.fromEntries(action.factures.map((f) => [f.vente_id, String(f.part || '')])))
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')
  const [etat, setEtat] = useState('a_valider')
  const total = useMemo(() => Object.values(parts).reduce((n, v) => n + Number(v || 0), 0), [parts])

  async function valider() {
    setErreur('')
    if (['cheque', 'virement'].includes(mode) && reference.trim().length < 2) { setErreur(t('encaissement.referenceObligatoire')); return }
    setEnvoi(true)
    for (const f of action.factures) {
      const part = Math.min(Number(parts[f.vente_id] || 0), Number(f.reste))
      if (!(part > 0)) continue
      const { error } = await supabase.rpc('enregistrer_reglement', {
        p_vente_id: f.vente_id, p_montant: part, p_mode: mode,
        p_commercial_id: profil?.role === 'commercial' ? profil.id : null,
        p_banque_id: null, p_reference_paiement: ['cheque', 'virement'].includes(mode) ? reference.trim() : null,
      })
      if (error) { setEnvoi(false); setErreur(`${f.numero} : ${traduireErreur(error.message)}`); return }
    }
    setEnvoi(false)
    setEtat('valide')
    onTermine?.(t('encaissement.enregistre', { client: action.client.nom, montant: formatXOF(total) }))
  }

  if (etat === 'valide') {
    const premiere = action.factures.find((f) => Number(parts[f.vente_id]) > 0)
    return (
      <Termine ok texte={`✅ ${t('encaissement.enregistreCourt', { montant: formatXOF(total) })}`}>
        {premiere && <CartePiece piece={{ type: 'vente', id: premiere.vente_id, titre: premiere.numero, detail: action.client.nom }} onAction={onNavigation} />}
      </Termine>
    )
  }
  if (etat === 'annule') return <Termine texte={`✖ ${t('fiche.annulee')}`} />

  return (
    <Cadre titre={`💵 ${t('encaissement.titre')}`}>
      <p><span className="text-petrol-500">{t('fiche.client')} :</span> <strong>{action.client.nom}</strong> · <span className="text-petrol-500">{t('encaissement.du')} {formatXOF(action.total_du)}</span></p>
      <div className="space-y-1">
        {action.factures.map((f) => (
          <div key={f.vente_id} className="flex items-center gap-2 bg-white rounded-lg border border-line px-2 py-1.5">
            <span className="flex-1 min-w-0">
              <span className="block truncate">{f.numero}</span>
              <span className="block text-[11px] text-petrol-500">{t('encaissement.reste')} {formatXOF(f.reste)}{f.echeance ? ` · ${t('encaissement.echeance')} ${formatDate(f.echeance)}` : ''}</span>
            </span>
            <input type="number" min="0" max={f.reste} inputMode="numeric" className="w-24 text-right border border-line rounded px-1 py-0.5"
              value={parts[f.vente_id]} onChange={(e) => setParts({ ...parts, [f.vente_id]: e.target.value })} />
          </div>
        ))}
      </div>
      {action.montant > action.total_du && <p className="text-xs text-amber-800">⚠️ {t('encaissement.depassement', { montant: formatXOF(action.montant), du: formatXOF(action.total_du) })}</p>}
      <p className="text-right text-base"><span className="text-petrol-500 text-sm">{t('encaissement.total')} :</span> <strong className="font-mono">{formatXOF(total)}</strong></p>
      <div className="grid grid-cols-2 gap-2">
        <select className="input-field !py-1.5 text-sm" value={mode} onChange={(e) => setMode(e.target.value)}>
          {['espece', 'mobile_money', 'cheque', 'virement'].map((m) => <option key={m} value={m}>{t(`fiche.modes.${m}`)}</option>)}
        </select>
        {['cheque', 'virement'].includes(mode) && (
          <input className="input-field !py-1.5 text-sm" placeholder={t('encaissement.reference')} value={reference} onChange={(e) => setReference(e.target.value)} />
        )}
      </div>
      {erreur && <p className="text-xs text-red-600">{erreur}</p>}
      <Boutons envoi={envoi} desactive={!(total > 0)} onAnnuler={() => { setEtat('annule'); onTermine?.(null) }} onValider={valider} />
    </Cadre>
  )
}

// ---------------------------------------------------------------- Nouveau client
function FicheClient({ action, onTermine, onNavigation }) {
  const { t } = useTranslation('assistant')
  const { profil } = useAuth()
  const [c, setC] = useState({ nom: action.nom || '', telephone: action.telephone || '', ville: action.ville || '', adresse: action.adresse || '', type_client: action.type_client || '' })
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')
  const [cree, setCree] = useState(null)
  const [annule, setAnnule] = useState(false)

  async function valider() {
    setErreur('')
    if (c.nom.trim().length < 2) { setErreur(t('client.nomObligatoire')); return }
    setEnvoi(true)
    const { data, error } = await supabase.from('clients').insert({
      entreprise_id: profil.entreprise_id, commercial_id: profil.id,
      nom: c.nom.trim(), telephone: c.telephone.trim() || null, ville: c.ville.trim() || null,
      adresse: c.adresse.trim() || null, type_client: c.type_client.trim() || null,
      notes: action.note || null, segment: 'nouveau', limite_credit: 0,
    }).select('id').single()
    setEnvoi(false)
    if (error) { setErreur(traduireErreur(error.message)); return }
    setCree(data.id)
    onTermine?.(t('client.cree', { nom: c.nom.trim() }))
  }

  if (cree) {
    return (
      <Termine ok texte={`✅ ${t('client.creeCourt', { nom: c.nom.trim() })}`}>
        <CartePiece piece={{ type: 'client', id: cree, titre: c.nom.trim(), detail: [c.telephone, c.ville].filter(Boolean).join(' · ') }} onAction={onNavigation} />
      </Termine>
    )
  }
  if (annule) return <Termine texte={`✖ ${t('fiche.annulee')}`} />

  const champ = (cle, label) => (
    <label className="text-xs text-petrol-600">{label}
      <input className="input-field !py-1.5 text-sm mt-0.5" value={c[cle]} onChange={(e) => setC({ ...c, [cle]: e.target.value })} />
    </label>
  )
  return (
    <Cadre titre={`👤 ${t('client.titre')}`}>
      {action.doublons?.length > 0 && (
        <p className="text-xs text-amber-800 bg-amber-100 rounded px-2 py-1">⚠️ {t('client.doublons', { noms: action.doublons.map((d) => d.nom).join(', ') })}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">{champ('nom', t('client.nom'))}</div>
        {champ('telephone', t('client.telephone'))}
        {champ('ville', t('client.ville'))}
        {champ('adresse', t('client.adresse'))}
        {champ('type_client', t('client.type'))}
      </div>
      {erreur && <p className="text-xs text-red-600">{erreur}</p>}
      <Boutons envoi={envoi} onAnnuler={() => { setAnnule(true); onTermine?.(null) }} onValider={valider} />
    </Cadre>
  )
}

// ---------------------------------------------------------------- Rapport de visite
function FicheVisite({ action, onTermine }) {
  const { t } = useTranslation('assistant')
  const { profil } = useAuth()
  const [observations, setObservations] = useState(action.observations || '')
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')
  const [etat, setEtat] = useState('a_valider')

  async function valider() {
    setErreur('')
    if (observations.trim().length < 3) { setErreur(t('visite.observationsObligatoires')); return }
    setEnvoi(true)
    // Rattachement à la tournée du jour si ce client y figure.
    const aujourdhui = new Date().toLocaleDateString('fr-CA', { timeZone: 'Africa/Abidjan' })
    const { data: ligne } = await supabase.from('tournee_lignes')
      .select('id, tournees!inner(commercial_id, date_tournee)')
      .eq('client_id', action.client.id).eq('tournees.commercial_id', profil.id).eq('tournees.date_tournee', aujourdhui)
      .limit(1).maybeSingle()
    const { error } = await supabase.from('rapports_visite').insert({
      entreprise_id: profil.entreprise_id, client_id: action.client.id, commercial_id: profil.id,
      tournee_ligne_id: ligne?.id || null, notes_rayon: observations.trim(), photos_paths: [],
    })
    setEnvoi(false)
    if (error) { setErreur(traduireErreur(error.message)); return }
    setEtat('valide')
    onTermine?.(t('visite.enregistree', { client: action.client.nom }) + (ligne ? ` ${t('visite.tournee')}` : ''))
  }

  if (etat === 'valide') return <Termine ok texte={`✅ ${t('visite.enregistreeCourt')}`} />
  if (etat === 'annule') return <Termine texte={`✖ ${t('fiche.annulee')}`} />
  return (
    <Cadre titre={`📝 ${t('visite.titre')}`}>
      <p><span className="text-petrol-500">{t('fiche.client')} :</span> <strong>{action.client.nom}</strong></p>
      <textarea className="input-field text-sm min-h-[90px]" value={observations} onChange={(e) => setObservations(e.target.value)} />
      <p className="text-[11px] text-petrol-500">{t('visite.aide')}</p>
      {erreur && <p className="text-xs text-red-600">{erreur}</p>}
      <Boutons envoi={envoi} onAnnuler={() => { setEtat('annule'); onTermine?.(null) }} onValider={valider} />
    </Cadre>
  )
}

export default function FicheConfirmationAutre(props) {
  if (props.action.type === 'encaissement') return <FicheEncaissement {...props} />
  if (props.action.type === 'client') return <FicheClient {...props} />
  if (props.action.type === 'visite') return <FicheVisite {...props} />
  return null
}
