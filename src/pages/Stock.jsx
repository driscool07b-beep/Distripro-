import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { exporterExcel, exporterPDF, formatMontantPDF } from '../lib/export'
import * as XLSX from 'xlsx'
import { traduireErreur } from '../lib/erreurs'

const PRODUIT_VIDE = { nom: '', categorie: '', prix_vente: '', seuil_alerte: '10', quantite_initiale: '0' }

export default function Stock() {
  const { entreprise, profil } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const filtreAlertes = searchParams.get('filtre') === 'alertes'
  const [produits, setProduits] = useState([])
  const [recherche, setRecherche] = useState('')
  const [chargement, setChargement] = useState(true)
  const [modalProduit, setModalProduit] = useState(false)
  const [produitEnEdition, setProduitEnEdition] = useState(null)
  const [modalHistorique, setModalHistorique] = useState(null)
  const [historiquePrix, setHistoriquePrix] = useState([])
  const [modalImportOuvert, setModalImportOuvert] = useState(false)
  const [lignesImport, setLignesImport] = useState([])
  const [erreurImport, setErreurImport] = useState('')
  const [importEnCours, setImportEnCours] = useState(false)
  const [progressionImport, setProgressionImport] = useState(0)
  const [resultatImport, setResultatImport] = useState(null)
  const [modalMouvement, setModalMouvement] = useState(null) // produit sélectionné
  const [modalTransfert, setModalTransfert] = useState(null) // produit sélectionné
  const [depots, setDepots] = useState([]) // dépôts sur lesquels l'utilisateur est habilité (source des mouvements)
  const [tousLesDepots, setTousLesDepots] = useState([]) // tous les dépôts actifs de l'entreprise (choix d'une destination)
  const [transfertsEnAttente, setTransfertsEnAttente] = useState([])
  const [modalReception, setModalReception] = useState(null) // transfert sélectionné
  const [reception, setReception] = useState({ quantite_recue: '', note: '' })
  const [fichierJustificatifReception, setFichierJustificatifReception] = useState(null)
  const [fichierJustificatif, setFichierJustificatif] = useState(null)
  const [fichierJustificatifTransfert, setFichierJustificatifTransfert] = useState(null)
  const [formulaire, setFormulaire] = useState(PRODUIT_VIDE)
  const [mouvement, setMouvement] = useState({ type: 'entree', quantite: '', raison: '', motif: '', depot_id: '' })
  const [transfert, setTransfert] = useState({ depot_source_id: '', depot_destination_id: '', quantite: '', motif: '' })
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    chargerProduits()
    chargerDepots()
  }, [profil?.id])

  useEffect(() => {
    if (depots.length > 0) chargerTransfertsEnAttente()
  }, [depots])

  async function chargerTransfertsEnAttente() {
    const { data } = await supabase
      .from('transferts_stock')
      .select(`
        id, quantite_envoyee, motif, envoye_at,
        produit:produits(nom),
        depot_source:depots!transferts_stock_depot_source_id_fkey(nom),
        depot_destination:depots!transferts_stock_depot_destination_id_fkey(nom, id),
        envoye_par_profil:profils!envoye_par(nom)
      `)
      .eq('statut', 'en_transit')
      .in('depot_destination_id', depots.map((d) => d.id))
      .order('envoye_at', { ascending: true })
    setTransfertsEnAttente(data || [])
  }

  async function chargerProduits() {
    setChargement(true)
    const { data, error } = await supabase
      .from('produits')
      .select('id, nom, categorie, prix_vente, seuil_alerte, created_at, stocks(quantite, depot_id)')
      .order('created_at', { ascending: false })
    if (!error) {
      setProduits(
        (data || []).map((p) => ({
          ...p,
          quantite: (p.stocks || []).reduce((s, x) => s + (x.quantite || 0), 0),
        }))
      )
    }
    setChargement(false)
  }

  async function chargerDepots() {
    const { data: actifs } = await supabase.from('depots').select('id, nom').eq('actif', true).order('nom')
    setTousLesDepots(actifs || [])
    if (profil?.role === 'gestionnaire_stock') {
      const { data } = await supabase.from('gestionnaire_depots').select('depot:depots(id, nom)').eq('profil_id', profil.id)
      setDepots((data || []).map((d) => d.depot).filter(Boolean))
    } else {
      setDepots(actifs || [])
    }
  }

  async function enregistrerProduit(e) {
    e.preventDefault()
    setErreur('')
    if (!formulaire.nom.trim() || !formulaire.prix_vente) {
      setErreur('Le nom et le prix unitaire sont requis.')
      return
    }
    setEnregistrement(true)

    let error
    if (produitEnEdition) {
      const resultat = await supabase.rpc('modifier_produit', {
        p_produit_id: produitEnEdition.id,
        p_nom: formulaire.nom.trim(),
        p_categorie: formulaire.categorie.trim() || null,
        p_prix_vente: Number(formulaire.prix_vente),
        p_seuil_alerte: Number(formulaire.seuil_alerte || 0),
      })
      error = resultat.error
    } else {
      const resultat = await supabase.rpc('creer_produit', {
        p_nom: formulaire.nom.trim(),
        p_categorie: formulaire.categorie.trim() || null,
        p_prix_vente: Number(formulaire.prix_vente),
        p_seuil_alerte: Number(formulaire.seuil_alerte || 0),
        p_quantite_initiale: Number(formulaire.quantite_initiale || 0),
      })
      error = resultat.error
    }

    setEnregistrement(false)
    if (error) {
      console.error('Erreur enregistrerProduit:', error)
      setErreur(`Erreur : ${traduireErreur(error.message)}`)
      return
    }
    setModalProduit(false)
    setProduitEnEdition(null)
    setFormulaire(PRODUIT_VIDE)
    chargerProduits()
  }

  function ouvrirModalEdition(produit) {
    setProduitEnEdition(produit)
    setFormulaire({
      nom: produit.nom,
      categorie: produit.categorie || '',
      prix_vente: String(produit.prix_vente || ''),
      seuil_alerte: String(produit.seuil_alerte ?? '10'),
      quantite_initiale: '0',
    })
    setErreur('')
    setModalProduit(true)
  }

  async function ouvrirHistorique(produit) {
    setModalHistorique(produit)
    const { data } = await supabase
      .from('produits_historique_prix')
      .select('ancien_prix, nouveau_prix, created_at, profils!modifie_par(nom)')
      .eq('produit_id', produit.id)
      .order('created_at', { ascending: false })
    setHistoriquePrix(data || [])
  }

  function ouvrirModalImport() {
    setLignesImport([])
    setErreurImport('')
    setResultatImport(null)
    setProgressionImport(0)
    setModalImportOuvert(true)
  }

  function telechargerModeleImport() {
    const feuille = XLSX.utils.aoa_to_sheet([
      ['Nom', 'Catégorie', 'Prix de vente', 'Seuil alerte', 'Stock initial'],
      ['Produit Exemple 500g', 'Céréales', 1000, 10, 50],
    ])
    const classeur = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(classeur, feuille, 'Produits')
    XLSX.writeFile(classeur, 'modele-import-produits.xlsx')
  }

  function lireFichierImport(e) {
    const fichier = e.target.files?.[0]
    if (!fichier) return
    setErreurImport('')
    setResultatImport(null)

    const lecteur = new FileReader()
    lecteur.onload = (event) => {
      try {
        const classeur = XLSX.read(event.target.result, { type: 'array' })
        const feuille = classeur.Sheets[classeur.SheetNames[0]]
        const lignes = XLSX.utils.sheet_to_json(feuille, {
          header: ['nom', 'categorie', 'prix_vente', 'seuil_alerte', 'quantite_initiale'],
          range: 1,
          defval: '',
        })
        const lignesValides = lignes
          .map((l) => ({
            nom: String(l.nom || '').trim(),
            categorie: String(l.categorie || '').trim(),
            prix_vente: Number(l.prix_vente) || 0,
            seuil_alerte: Number(l.seuil_alerte) || 0,
            quantite_initiale: Number(l.quantite_initiale) || 0,
          }))
          .filter((l) => l.nom && l.prix_vente > 0)
        setLignesImport(lignesValides)
        if (lignesValides.length === 0) setErreurImport('Aucune ligne valide (nom et prix de vente obligatoires).')
      } catch (err) {
        setErreurImport(`Fichier illisible : ${err.message}`)
      }
    }
    lecteur.readAsArrayBuffer(fichier)
  }

  async function confirmerImport() {
    if (lignesImport.length === 0) return
    setImportEnCours(true)
    setErreurImport('')
    let reussis = 0
    const echecs = []

    for (let i = 0; i < lignesImport.length; i++) {
      const l = lignesImport[i]
      const { error } = await supabase.rpc('creer_produit', {
        p_nom: l.nom,
        p_categorie: l.categorie || null,
        p_prix_vente: l.prix_vente,
        p_seuil_alerte: l.seuil_alerte,
        p_quantite_initiale: l.quantite_initiale,
      })
      if (error) echecs.push(`${l.nom} : ${traduireErreur(error.message)}`)
      else reussis++
      setProgressionImport(i + 1)
    }

    setImportEnCours(false)
    setResultatImport({ reussis, total: lignesImport.length, echecs })
    setLignesImport([])
    chargerProduits()
  }

  function ouvrirModalMouvement(produit) {
    setModalMouvement(produit)
    setMouvement({
      type: 'entree',
      quantite: '',
      raison: '',
      motif: '',
      depot_id: depots.length === 1 ? depots[0].id : '',
    })
    setErreur('')
  }

  function ouvrirModalTransfert(produit) {
    setModalTransfert(produit)
    setTransfert({ depot_source_id: '', depot_destination_id: '', quantite: '', motif: '' })
    setFichierJustificatifTransfert(null)
    setErreur('')
  }

  const RAISONS_ENTREE = ['Réception fournisseur', 'Production (usine)', 'Retour client', 'Inventaire (régularisation)', 'Autre']
  const RAISONS_SORTIE = ['Casse / perte', 'Reconditionnement', 'Périmé / invendable', 'Inventaire (régularisation)', 'Autre']

  async function enregistrerMouvement(e) {
    e.preventDefault()
    setErreur('')
    const qte = Number(mouvement.quantite)
    if (!qte || qte <= 0) {
      setErreur('Indiquez une quantité valide.')
      return
    }
    if (depots.length > 1 && !mouvement.depot_id) {
      setErreur('Sélectionnez un dépôt.')
      return
    }
    if (!mouvement.raison) {
      setErreur('Sélectionnez une raison.')
      return
    }
    if (mouvement.raison === 'Autre' && !mouvement.motif.trim()) {
      setErreur('Précisez le motif pour "Autre".')
      return
    }
    if (entreprise?.justificatif_stock_obligatoire && !fichierJustificatif) {
      setErreur('Un justificatif (photo ou PDF) est obligatoire pour tout ajustement de stock.')
      return
    }
    const motifComplet = mouvement.raison + (mouvement.motif.trim() ? ' — ' + mouvement.motif.trim() : '')
    setEnregistrement(true)
    const { data: mouvementId, error } = await supabase.rpc('ajuster_stock', {
      p_produit_id: modalMouvement.id,
      p_type: mouvement.type,
      p_quantite: qte,
      p_motif: motifComplet,
      p_depot_id: mouvement.depot_id || null,
    })
    if (error) {
      setEnregistrement(false)
      setErreur(
        error.message?.includes('stock insuffisant')
          ? 'Stock insuffisant pour cette sortie.'
          : error.message?.includes('plusieurs dépôts')
          ? 'Plusieurs dépôts existent — cette fonctionnalité de sélection arrive bientôt, contactez un administrateur.'
          : `Erreur : ${traduireErreur(error.message)}`
      )
      return
    }

    if (fichierJustificatif) {
      const extension = fichierJustificatif.name.split('.').pop()
      const chemin = `${entreprise.id}/mouvements-stock/${mouvementId}.${extension}`
      const { error: erreurUpload } = await supabase.storage.from('justificatifs-stock').upload(chemin, fichierJustificatif, { upsert: true })
      if (!erreurUpload) {
        await supabase.rpc('attacher_justificatif_mouvement', { p_mouvement_id: mouvementId, p_chemin: chemin })
      } else {
        // Le mouvement est déjà enregistré (et donc tracé dans le journal comme
        // sans justificatif, visible pour un administrateur) — on informe sans
        // bloquer, puisque le stock a déjà été mis à jour.
        console.error('Erreur upload justificatif:', erreurUpload)
      }
    }

    setEnregistrement(false)
    chargerProduits()
    fermerModalMouvement()
  }

  function fermerModalMouvement() {
    setModalMouvement(null)
    setMouvement({ type: 'entree', quantite: '', raison: '', motif: '', depot_id: '' })
    setFichierJustificatif(null)
    setErreur('')
  }

  async function enregistrerTransfert(e) {
    e.preventDefault()
    setErreur('')
    const qte = Number(transfert.quantite)
    if (!qte || qte <= 0) {
      setErreur('Indiquez une quantité valide.')
      return
    }
    if (!transfert.depot_source_id || !transfert.depot_destination_id) {
      setErreur('Sélectionnez le dépôt source et le dépôt destination.')
      return
    }
    if (transfert.depot_source_id === transfert.depot_destination_id) {
      setErreur('Le dépôt source et le dépôt destination doivent être différents.')
      return
    }
    if (entreprise?.justificatif_stock_obligatoire && !fichierJustificatifTransfert) {
      setErreur('Un justificatif (photo ou PDF) est obligatoire pour tout transfert de stock.')
      return
    }
    setEnregistrement(true)
    const { data: resultat, error } = await supabase.rpc('transferer_stock', {
      p_produit_id: modalTransfert.id,
      p_depot_source_id: transfert.depot_source_id,
      p_depot_destination_id: transfert.depot_destination_id,
      p_quantite: qte,
      p_motif: transfert.motif.trim() || null,
    })
    if (error) {
      setEnregistrement(false)
      setErreur(
        error.message?.includes('stock insuffisant')
          ? 'Stock insuffisant dans le dépôt source.'
          : `Erreur : ${traduireErreur(error.message)}`
      )
      return
    }

    if (fichierJustificatifTransfert && resultat?.mouvement_sortie_id) {
      const extension = fichierJustificatifTransfert.name.split('.').pop()
      const chemin = `${entreprise.id}/mouvements-stock/${resultat.mouvement_sortie_id}.${extension}`
      const { error: erreurUpload } = await supabase.storage
        .from('justificatifs-stock')
        .upload(chemin, fichierJustificatifTransfert, { upsert: true })
      if (!erreurUpload) {
        await supabase.rpc('attacher_justificatif_mouvement', { p_mouvement_id: resultat.mouvement_sortie_id, p_chemin: chemin })
      } else {
        console.error('Erreur upload justificatif transfert:', erreurUpload)
      }
    }

    setEnregistrement(false)
    chargerProduits()
    chargerTransfertsEnAttente()
    fermerModalTransfert()
  }

  function fermerModalTransfert() {
    setModalTransfert(null)
    setTransfert({ depot_source_id: '', depot_destination_id: '', quantite: '', motif: '' })
    setFichierJustificatifTransfert(null)
    setErreur('')
  }

  function ouvrirModalReception(t) {
    setModalReception(t)
    setReception({ quantite_recue: String(t.quantite_envoyee), note: '' })
    setFichierJustificatifReception(null)
    setErreur('')
  }

  function fermerModalReception() {
    setModalReception(null)
    setReception({ quantite_recue: '', note: '' })
    setFichierJustificatifReception(null)
    setErreur('')
  }

  async function enregistrerReception(e) {
    e.preventDefault()
    setErreur('')
    const qte = Number(reception.quantite_recue)
    if (reception.quantite_recue === '' || Number.isNaN(qte) || qte < 0) {
      setErreur('Indiquez la quantité réellement reçue (0 si rien n\u2019est arrivé).')
      return
    }
    if (entreprise?.justificatif_stock_obligatoire && !fichierJustificatifReception) {
      setErreur('Un justificatif (photo ou PDF) est obligatoire pour valider une réception.')
      return
    }
    setEnregistrement(true)
    const { data: mouvementEntreeId, error } = await supabase.rpc('receptionner_transfert', {
      p_transfert_id: modalReception.id,
      p_quantite_recue: qte,
      p_note: reception.note.trim() || null,
    })
    if (error) {
      setEnregistrement(false)
      setErreur(`Erreur : ${traduireErreur(error.message)}`)
      return
    }

    if (fichierJustificatifReception && mouvementEntreeId) {
      const extension = fichierJustificatifReception.name.split('.').pop()
      const chemin = `${entreprise.id}/mouvements-stock/${mouvementEntreeId}.${extension}`
      const { error: erreurUpload } = await supabase.storage
        .from('justificatifs-stock')
        .upload(chemin, fichierJustificatifReception, { upsert: true })
      if (!erreurUpload) {
        await supabase.rpc('attacher_justificatif_mouvement', { p_mouvement_id: mouvementEntreeId, p_chemin: chemin })
      } else {
        console.error('Erreur upload justificatif réception:', erreurUpload)
      }
    }

    setEnregistrement(false)
    chargerProduits()
    chargerTransfertsEnAttente()
    fermerModalReception()
  }

  const produitsFiltres = produits
    .filter((p) => p.nom.toLowerCase().includes(recherche.toLowerCase()))
    .filter((p) => !filtreAlertes || p.quantite <= (p.seuil_alerte ?? 0))
  const nbAlertes = produits.filter((p) => p.quantite <= (p.seuil_alerte ?? 0)).length
  const valeurTotaleStock = produits.reduce((s, p) => s + p.quantite * (p.prix_vente || 0), 0)

  const COLONNES_EXPORT = [
    { cle: 'nom', titre: 'Produit' },
    { cle: 'categorie', titre: 'Catégorie' },
    { cle: 'prix', titre: 'Prix unitaire (F CFA)', alignDroite: true },
    { cle: 'stock', titre: 'Stock', alignDroite: true },
    { cle: 'valeur', titre: 'Valeur (F CFA)', alignDroite: true },
  ]
  function donneesExport() {
    return (produitsFiltres || []).map((p) => ({
      nom: p.nom,
      categorie: p.categorie || '—',
      prix: Number(p.prix_vente || 0),
      stock: p.quantite,
      valeur: p.quantite * (p.prix_vente || 0),
    }))
  }
  function exportExcel() {
    exporterExcel('stock', COLONNES_EXPORT, donneesExport())
  }
  function exportPDF() {
    exporterPDF('stock', 'Produits & Stock', null, COLONNES_EXPORT, donneesExport(), 'Valeur totale', formatMontantPDF(valeurTotaleStock) + ' F CFA', entreprise)
  }

  return (
    <div className="p-8 max-w-6xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Produits &amp; Stock</h1>
          <p className="text-sm text-petrol-700 mt-1">
            {produits.length} produit(s) — {nbAlertes > 0 ? (
              <span className="text-amber-600 font-medium">{nbAlertes} en alerte de stock</span>
            ) : (
              'stock sain'
            )}
          </p>
          <p className="text-sm text-petrol-700 mt-0.5">
            Valeur totale du stock : <span className="font-mono font-medium">{formatXOF(valeurTotaleStock)}</span>
          </p>
          {profil?.role === 'gestionnaire_stock' && depots.length === 0 && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2">
              Aucun dépôt ne vous a été attribué — contactez un administrateur pour pouvoir enregistrer des mouvements de stock.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary text-sm" onClick={exportExcel} disabled={produitsFiltres.length === 0}>
            📊 Excel
          </button>
          <button className="btn-secondary text-sm" onClick={exportPDF} disabled={produitsFiltres.length === 0}>
            📄 PDF
          </button>
          {['admin', 'manager', 'gestionnaire_stock'].includes(profil?.role) && (
            <>
              <button className="btn-secondary text-sm" onClick={ouvrirModalImport}>
                📥 Importer
              </button>
              <button className="btn-primary" onClick={() => { setProduitEnEdition(null); setFormulaire(PRODUIT_VIDE); setModalProduit(true) }}>
                + Nouveau produit
              </button>
            </>
          )}
        </div>
      </header>

      {transfertsEnAttente.length > 0 && (
        <div className="card p-4 mb-4 border-amber-200 bg-amber-50">
          <p className="text-sm font-semibold text-amber-800 mb-2">
            📦 {transfertsEnAttente.length} transfert(s) en attente de réception
          </p>
          <div className="space-y-2">
            {transfertsEnAttente.map((t) => (
              <div key={t.id} className="flex items-center justify-between bg-white rounded-lg border border-amber-200 px-3 py-2 text-sm gap-2">
                <div>
                  <p className="font-medium">{t.produit?.nom} — {t.quantite_envoyee} unité(s)</p>
                  <p className="text-xs text-petrol-500">
                    {t.depot_source?.nom} → {t.depot_destination?.nom} · envoyé par {t.envoye_par_profil?.nom || '—'} le{' '}
                    {new Date(t.envoye_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </p>
                </div>
                <button className="btn-primary text-xs shrink-0" onClick={() => ouvrirModalReception(t)}>
                  Réceptionner
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <input
        type="text"
        placeholder="Rechercher un produit…"
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        className="input-field max-w-sm mb-4"
      />

      {filtreAlertes && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full">
            Filtré : produits en alerte de stock
          </span>
          <button
            onClick={() => setSearchParams({})}
            className="text-petrol-500 underline text-xs"
          >
            Retirer le filtre
          </button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-xs text-petrol-600">
              <th className="px-4 py-3 font-medium">Produit</th>
              <th className="px-4 py-3 font-medium">Catégorie</th>
              <th className="px-4 py-3 font-medium">Prix unitaire</th>
              <th className="px-4 py-3 font-medium">Stock</th>
              <th className="px-4 py-3 font-medium">Valeur</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {chargement ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-petrol-500">Chargement…</td></tr>
            ) : produitsFiltres.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-petrol-500">Aucun produit trouvé.</td></tr>
            ) : (
              produitsFiltres.map((p) => {
                const enAlerte = p.quantite <= (p.seuil_alerte ?? 0)
                return (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                    <td className="px-4 py-3 font-medium">{p.nom}</td>
                    <td className="px-4 py-3 text-petrol-700">{p.categorie || '—'}</td>
                    <td className="px-4 py-3 font-mono text-petrol-700">{formatXOF(p.prix_vente)}</td>
                    <td className="px-4 py-3">
                      <span className={`font-mono px-2 py-0.5 rounded ${enAlerte ? 'bg-amber-50 text-amber-700' : 'text-petrol-900'}`}>
                        {p.quantite}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-petrol-700">
                      {formatXOF(p.quantite * (p.prix_vente || 0))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {['admin', 'manager', 'gestionnaire_stock'].includes(profil?.role) && !(profil?.role === 'gestionnaire_stock' && depots.length === 0) && (
                        <div className="flex flex-col items-end gap-1">
                          <button
                            className="text-xs font-medium text-petrol-700 hover:text-amber-600"
                            onClick={() => ouvrirModalMouvement(p)}
                          >
                            Ajuster le stock
                          </button>
                          {tousLesDepots.length > 1 && depots.length > 0 && (
                            <button
                              className="text-xs font-medium text-petrol-700 hover:text-amber-600"
                              onClick={() => ouvrirModalTransfert(p)}
                            >
                              Transférer entre dépôts
                            </button>
                          )}
                          <div className="flex gap-2">
                            <button className="text-xs text-petrol-500 underline" onClick={() => ouvrirModalEdition(p)}>
                              Modifier
                            </button>
                            <button className="text-xs text-petrol-500 underline" onClick={() => ouvrirHistorique(p)}>
                              Historique
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {modalProduit && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-4">{produitEnEdition ? 'Modifier le produit' : 'Nouveau produit'}</h2>
            <form onSubmit={enregistrerProduit} className="space-y-3">
              <div>
                <label className="label">Nom *</label>
                <input
                  className="input-field"
                  value={formulaire.nom}
                  onChange={(e) => setFormulaire({ ...formulaire, nom: e.target.value })}
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Catégorie</label>
                <input
                  className="input-field"
                  value={formulaire.categorie}
                  onChange={(e) => setFormulaire({ ...formulaire, categorie: e.target.value })}
                  placeholder="Céréales, Farines, Épices…"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Prix unitaire (F CFA) *</label>
                  <input
                    type="number"
                    className="input-field font-mono"
                    value={formulaire.prix_vente}
                    onChange={(e) => setFormulaire({ ...formulaire, prix_vente: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Seuil d'alerte</label>
                  <input
                    type="number"
                    className="input-field font-mono"
                    value={formulaire.seuil_alerte}
                    onChange={(e) => setFormulaire({ ...formulaire, seuil_alerte: e.target.value })}
                  />
                </div>
              </div>
              {!produitEnEdition && (
                <div>
                  <label className="label">Quantité initiale en stock</label>
                  <input
                    type="number"
                    className="input-field font-mono"
                    value={formulaire.quantite_initiale}
                    onChange={(e) => setFormulaire({ ...formulaire, quantite_initiale: e.target.value })}
                  />
                </div>
              )}

              {erreur && <div className="text-sm text-red-600">{erreur}</div>}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  className="btn-secondary flex-1"
                  onClick={() => {
                    setModalProduit(false)
                    setProduitEnEdition(null)
                    setFormulaire(PRODUIT_VIDE)
                    setErreur('')
                  }}
                >
                  Annuler
                </button>
                <button type="submit" disabled={enregistrement} className="btn-primary flex-1">
                  {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalMouvement && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-1">Ajuster le stock</h2>
            <p className="text-sm text-petrol-600 mb-4">{modalMouvement.nom} — stock actuel : {modalMouvement.quantite}</p>
            <form onSubmit={enregistrerMouvement} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMouvement({ ...mouvement, type: 'entree', raison: '' })}
                  className={`py-2 rounded-lg text-sm font-medium border ${
                    mouvement.type === 'entree'
                      ? 'bg-petrol-800 text-white border-petrol-800'
                      : 'border-line text-petrol-700'
                  }`}
                >
                  Entrée
                </button>
                <button
                  type="button"
                  onClick={() => setMouvement({ ...mouvement, type: 'sortie', raison: '' })}
                  className={`py-2 rounded-lg text-sm font-medium border ${
                    mouvement.type === 'sortie'
                      ? 'bg-petrol-800 text-white border-petrol-800'
                      : 'border-line text-petrol-700'
                  }`}
                >
                  Sortie
                </button>
              </div>
              <div>
                <label className="label">Quantité</label>
                <input
                  type="number"
                  className="input-field font-mono"
                  value={mouvement.quantite}
                  onChange={(e) => setMouvement({ ...mouvement, quantite: e.target.value })}
                  autoFocus
                />
              </div>
              {depots.length > 1 && (
                <div>
                  <label className="label">Dépôt *</label>
                  <select
                    className="input-field"
                    value={mouvement.depot_id}
                    onChange={(e) => setMouvement({ ...mouvement, depot_id: e.target.value })}
                  >
                    <option value="">Sélectionner un dépôt…</option>
                    {depots.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label">Raison *</label>
                <select
                  className="input-field"
                  value={mouvement.raison}
                  onChange={(e) => setMouvement({ ...mouvement, raison: e.target.value })}
                >
                  <option value="">Sélectionner…</option>
                  {(mouvement.type === 'entree' ? RAISONS_ENTREE : RAISONS_SORTIE).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Détail {mouvement.raison === 'Autre' ? '*' : '(optionnel)'}</label>
                <input
                  className="input-field"
                  value={mouvement.motif}
                  onChange={(e) => setMouvement({ ...mouvement, motif: e.target.value })}
                  placeholder="Nom du fournisseur, numéro de bon, précision…"
                />
              </div>
              <div>
                <label className="label">
                  Justificatif (photo ou PDF){entreprise?.justificatif_stock_obligatoire ? ' *' : ' (optionnel)'}
                </label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setFichierJustificatif(e.target.files?.[0] || null)}
                  className="input-field"
                />
                <p className="text-xs text-petrol-500 mt-1">
                  {entreprise?.justificatif_stock_obligatoire ? 'Obligatoire' : 'Facultatif'} — bon d'approvisionnement, photo de la casse, feuille d'inventaire…
                </p>
              </div>

              {erreur && <div className="text-sm text-red-600">{erreur}</div>}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  className="btn-secondary flex-1"
                  onClick={fermerModalMouvement}
                >
                  Annuler
                </button>
                <button type="submit" disabled={enregistrement} className="btn-primary flex-1">
                  {enregistrement ? 'Enregistrement…' : 'Valider'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalTransfert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-1">Transférer entre dépôts</h2>
            <p className="text-sm text-petrol-600 mb-4">{modalTransfert.nom} — stock total : {modalTransfert.quantite}</p>
            <form onSubmit={enregistrerTransfert} className="space-y-3">
              <div>
                <label className="label">Dépôt source *</label>
                <select
                  className="input-field"
                  value={transfert.depot_source_id}
                  onChange={(e) => setTransfert({ ...transfert, depot_source_id: e.target.value })}
                >
                  <option value="">Sélectionner…</option>
                  {depots.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Dépôt destination *</label>
                <select
                  className="input-field"
                  value={transfert.depot_destination_id}
                  onChange={(e) => setTransfert({ ...transfert, depot_destination_id: e.target.value })}
                >
                  <option value="">Sélectionner…</option>
                  {tousLesDepots
                    .filter((d) => d.id !== transfert.depot_source_id)
                    .map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
                </select>
                <p className="text-xs text-petrol-500 mt-1">
                  Le stock du dépôt destination ne sera crédité qu'après validation de la réception par son responsable.
                </p>
              </div>
              <div>
                <label className="label">Quantité</label>
                <input
                  type="number"
                  className="input-field font-mono"
                  value={transfert.quantite}
                  onChange={(e) => setTransfert({ ...transfert, quantite: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Détail (optionnel)</label>
                <input
                  className="input-field"
                  value={transfert.motif}
                  onChange={(e) => setTransfert({ ...transfert, motif: e.target.value })}
                  placeholder="Numéro de bordereau, raison du transfert…"
                />
              </div>
              <div>
                <label className="label">
                  Justificatif (photo ou PDF){entreprise?.justificatif_stock_obligatoire ? ' *' : ' (optionnel)'}
                </label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setFichierJustificatifTransfert(e.target.files?.[0] || null)}
                  className="input-field"
                />
                <p className="text-xs text-petrol-500 mt-1">
                  {entreprise?.justificatif_stock_obligatoire ? 'Obligatoire' : 'Facultatif'} — bordereau de transfert, bon de sortie…
                </p>
              </div>

              {erreur && <div className="text-sm text-red-600">{erreur}</div>}

              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={fermerModalTransfert}>
                  Annuler
                </button>
                <button type="submit" disabled={enregistrement} className="btn-primary flex-1">
                  {enregistrement ? 'Enregistrement…' : 'Envoyer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalReception && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-1">Réceptionner le transfert</h2>
            <p className="text-sm text-petrol-600 mb-4">
              {modalReception.produit?.nom} — {modalReception.depot_source?.nom} → {modalReception.depot_destination?.nom}
              <br />
              Quantité envoyée : <span className="font-mono">{modalReception.quantite_envoyee}</span>
            </p>
            <form onSubmit={enregistrerReception} className="space-y-3">
              <div>
                <label className="label">Quantité réellement reçue (après contrôle) *</label>
                <input
                  type="number"
                  min="0"
                  className="input-field font-mono"
                  value={reception.quantite_recue}
                  onChange={(e) => setReception({ ...reception, quantite_recue: e.target.value })}
                  autoFocus
                />
                {Number(reception.quantite_recue) !== modalReception.quantite_envoyee && reception.quantite_recue !== '' && (
                  <p className="text-xs text-amber-700 mt-1">
                    ⚠️ Écart avec la quantité envoyée ({modalReception.quantite_envoyee}) — l'écart sera tracé dans le journal.
                  </p>
                )}
              </div>
              <div>
                <label className="label">Note (optionnel)</label>
                <input
                  className="input-field"
                  value={reception.note}
                  onChange={(e) => setReception({ ...reception, note: e.target.value })}
                  placeholder="Raison de l'écart, état de la marchandise…"
                />
              </div>
              <div>
                <label className="label">
                  Justificatif (photo ou PDF){entreprise?.justificatif_stock_obligatoire ? ' *' : ' (optionnel)'}
                </label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setFichierJustificatifReception(e.target.files?.[0] || null)}
                  className="input-field"
                />
                <p className="text-xs text-petrol-500 mt-1">
                  {entreprise?.justificatif_stock_obligatoire ? 'Obligatoire' : 'Facultatif'} — photo de la marchandise reçue, bon signé…
                </p>
              </div>

              {erreur && <div className="text-sm text-red-600">{erreur}</div>}

              <div className="flex gap-2 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={fermerModalReception}>
                  Annuler
                </button>
                <button type="submit" disabled={enregistrement} className="btn-primary flex-1">
                  {enregistrement ? 'Enregistrement…' : 'Valider la réception'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalImportOuvert && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="font-semibold text-lg">Importer des produits (Excel)</h2>
              <button onClick={() => setModalImportOuvert(false)} className="text-petrol-400 text-xl leading-none">✕</button>
            </div>

            <p className="text-sm text-petrol-600 mb-3">
              Téléchargez le modèle, remplissez-le en gardant l'ordre des colonnes, puis importez-le.
            </p>
            <button onClick={telechargerModeleImport} className="btn-secondary text-sm mb-4">
              📄 Télécharger le modèle
            </button>

            <div className="mb-4">
              <label className="label">Fichier Excel (.xlsx)</label>
              <input type="file" accept=".xlsx,.xls" onChange={lireFichierImport} className="text-sm" />
            </div>

            {erreurImport && <p className="text-sm text-red-600 mb-3">{erreurImport}</p>}

            {lignesImport.length > 0 && (
              <>
                <p className="text-sm font-medium mb-2">{lignesImport.length} produit(s) prêt(s) à importer</p>
                <div className="border border-line rounded-lg overflow-y-auto max-h-48 mb-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-canvas text-left">
                        <th className="px-2 py-1.5">Nom</th>
                        <th className="px-2 py-1.5 text-right">Prix</th>
                        <th className="px-2 py-1.5 text-right">Stock initial</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignesImport.slice(0, 20).map((l, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="px-2 py-1.5">{l.nom}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{l.prix_vente}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{l.quantite_initiale}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {lignesImport.length > 20 && (
                    <p className="text-xs text-petrol-400 text-center py-1.5">… et {lignesImport.length - 20} de plus</p>
                  )}
                </div>
                <button onClick={confirmerImport} disabled={importEnCours} className="btn-primary w-full">
                  {importEnCours ? `Import en cours… (${progressionImport}/${lignesImport.length})` : `Importer ${lignesImport.length} produit(s)`}
                </button>
              </>
            )}

            {resultatImport && (
              <div className="mt-3">
                <p className="text-sm text-green-700">
                  ✓ {resultatImport.reussis} produit(s) importé(s) sur {resultatImport.total}.
                </p>
                {resultatImport.echecs.length > 0 && (
                  <div className="text-xs text-red-600 mt-2">
                    {resultatImport.echecs.map((e, i) => <p key={i}>{e}</p>)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {modalHistorique && (
        <div className="fixed inset-0 bg-petrol-950/40 flex items-center justify-center p-4 z-50">
          <div className="card bg-white p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-1">Historique des prix</h2>
            <p className="text-sm text-petrol-600 mb-4">{modalHistorique.nom}</p>
            {historiquePrix.length === 0 ? (
              <p className="text-sm text-petrol-400">Aucun changement de prix enregistré.</p>
            ) : (
              <div className="space-y-2">
                {historiquePrix.map((h, i) => (
                  <div key={i} className="text-sm border-b border-line pb-2">
                    <p>
                      {h.ancien_prix != null ? formatXOF(h.ancien_prix) : '—'} → <strong>{formatXOF(h.nouveau_prix)}</strong>
                    </p>
                    <p className="text-xs text-petrol-500">
                      {h.profils?.nom || '—'} —{' '}
                      {new Date(h.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <button className="btn-secondary w-full mt-4" onClick={() => setModalHistorique(null)}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function formatXOF(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0) + ' F CFA'
}
