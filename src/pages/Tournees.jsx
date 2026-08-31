import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function Tournees() {
  const { profil, entreprise } = useAuth();
  const entrepriseId = profil?.entreprise_id;
  const [tournees, setTournees] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedTournee, setSelectedTournee] = useState(null);
  const [visites, setVisites] = useState([]);

  const [rapportLigne, setRapportLigne] = useState(null); // ligne en cours de rapport, ou null
  const [rapportNotesRayon, setRapportNotesRayon] = useState('');
  const [rapportNotesReserve, setRapportNotesReserve] = useState('');
  const [rapportPhotos, setRapportPhotos] = useState([]); // [{file, apercu}]
  const [rapportEnvoi, setRapportEnvoi] = useState(false);
  const [rapportErreur, setRapportErreur] = useState('');

  const [catalogueProduits, setCatalogueProduits] = useState([]);
  const [rapportLignesProduits, setRapportLignesProduits] = useState([]); // [{produit_id, quantite_rayon, quantite_reserve}]
  const [produitAjoutSelection, setProduitAjoutSelection] = useState('');

  const [champsPerso, setChampsPerso] = useState([]);
  const [rapportValeursChamps, setRapportValeursChamps] = useState({}); // { champ_id: valeur }

  const [formData, setFormData] = useState({
    date_tournee: new Date().toISOString().split('T')[0],
    clients_selectionnes: [],
  });

  useEffect(() => {
    if (entrepriseId) {
      chargerTournees();
      chargerClients();
      chargerCatalogueProduits();
      chargerChampsPerso();
    }
  }, [entrepriseId]);

  const chargerCatalogueProduits = async () => {
    const { data, error } = await supabase
      .from('produits')
      .select('id, nom')
      .eq('entreprise_id', entrepriseId)
      .eq('actif', true)
      .order('nom');
    if (!error) setCatalogueProduits(data || []);
  };

  const chargerChampsPerso = async () => {
    const { data, error } = await supabase
      .from('champs_personnalises_rapport')
      .select('*')
      .eq('entreprise_id', entrepriseId)
      .eq('actif', true)
      .order('ordre');
    if (!error) setChampsPerso(data || []);
  };

  const chargerTournees = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tournees')
      .select('*')
      .eq('entreprise_id', entrepriseId)
      .order('date_tournee', { ascending: false });

    if (error) {
      console.error('Erreur chargement tournées:', error);
    } else {
      setTournees(data || []);
    }
    setLoading(false);
  };

  const chargerClients = async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('id, nom, latitude, longitude')
      .eq('entreprise_id', entrepriseId);

    if (!error) setClients(data || []);
  };

  const chargerLignes = async (tourneeId) => {
    const { data, error } = await supabase
      .from('tournee_lignes')
      .select('*, clients(nom)')
      .eq('tournee_id', tourneeId)
      .order('ordre', { ascending: true });

    if (!error) setVisites(data || []);
  };

  const ouvrirTournee = (tournee) => {
    setSelectedTournee(tournee);
    chargerLignes(tournee.id);
  };

  const creerTournee = async (e) => {
    e.preventDefault();
    if (formData.clients_selectionnes.length === 0) {
      alert('Sélectionnez au moins un client');
      return;
    }

    const { data, error } = await supabase.rpc('creer_tournee_optimisee', {
      p_commercial_id: profil?.id,
      p_date_tournee: formData.date_tournee,
      p_client_ids: formData.clients_selectionnes,
    });

    if (error) {
      alert('Erreur lors de la création : ' + error.message);
      console.error(error);
      return;
    }

    setShowForm(false);
    setFormData({
      date_tournee: new Date().toISOString().split('T')[0],
      clients_selectionnes: [],
    });
    chargerTournees();
  };

  const marquerVisitee = async (ligne) => {
    if (!navigator.geolocation) {
      alert("La géolocalisation n'est pas disponible sur cet appareil/navigateur.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { data, error } = await supabase.rpc('valider_visite', {
          p_tournee_ligne_id: ligne.id,
          p_latitude: position.coords.latitude,
          p_longitude: position.coords.longitude,
        });

        if (error) {
          alert('Erreur : ' + error.message);
          return;
        }

        if (!data?.succes) {
          alert(
            data?.message ||
              `Vous semblez trop éloigné du client (${data?.distance_metres ?? '?'} m) pour valider cette visite.`
          );
          return;
        }

        if (selectedTournee) chargerLignes(selectedTournee.id);
        setRapportLigne(ligne);
        setRapportNotesRayon('');
        setRapportNotesReserve('');
        setRapportPhotos([]);
        setRapportErreur('');
        setRapportLignesProduits([]);
        setProduitAjoutSelection('');
        setRapportValeursChamps({});
      },
      () => {
        alert("Impossible d'obtenir votre position. Autorisez la géolocalisation pour valider une visite.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const ajouterPhotoRapport = (e) => {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (!fichier || rapportPhotos.length >= 3) return;
    setRapportPhotos((prev) => [...prev, { file: fichier, apercu: URL.createObjectURL(fichier) }]);
  };

  const retirerPhotoRapport = (index) => {
    setRapportPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const ajouterLigneProduit = () => {
    if (!produitAjoutSelection) return;
    if (rapportLignesProduits.some((l) => l.produit_id === produitAjoutSelection)) {
      setProduitAjoutSelection('');
      return;
    }
    setRapportLignesProduits((prev) => [
      ...prev,
      { produit_id: produitAjoutSelection, quantite_rayon: '', quantite_reserve: '' },
    ]);
    setProduitAjoutSelection('');
  };

  const majLigneProduit = (produitId, champ, valeur) => {
    setRapportLignesProduits((prev) =>
      prev.map((l) => (l.produit_id === produitId ? { ...l, [champ]: valeur } : l))
    );
  };

  const retirerLigneProduit = (produitId) => {
    setRapportLignesProduits((prev) => prev.filter((l) => l.produit_id !== produitId));
  };

  const fermerRapport = () => {
    setRapportLigne(null);
    setRapportPhotos([]);
    setRapportErreur('');
    setRapportLignesProduits([]);
    setRapportValeursChamps({});
  };

  const envoyerRapport = async () => {
    if (entreprise?.photo_rapport_obligatoire && rapportPhotos.length === 0) {
      setRapportErreur('Au moins une photo est requise pour ce rapport (réglage entreprise).');
      return;
    }
    setRapportEnvoi(true);
    setRapportErreur('');

    const cheminsPhotos = [];
    for (let i = 0; i < rapportPhotos.length; i++) {
      const { file } = rapportPhotos[i];
      const extension = file.name.split('.').pop() || 'jpg';
      const chemin = `${entrepriseId}/rapports/${rapportLigne.id}/${i}.${extension}`;
      const { error: erreurUpload } = await supabase.storage
        .from('client-photos')
        .upload(chemin, file, { upsert: true });
      if (erreurUpload) {
        setRapportEnvoi(false);
        setRapportErreur(`Erreur envoi photo ${i + 1} : ${erreurUpload.message}`);
        return;
      }
      cheminsPhotos.push(chemin);
    }

    const { data: rapportCree, error } = await supabase
      .from('rapports_visite')
      .insert({
        entreprise_id: entrepriseId,
        tournee_ligne_id: rapportLigne.id,
        client_id: rapportLigne.client_id,
        commercial_id: profil?.id,
        notes_rayon: rapportNotesRayon.trim() || null,
        notes_reserve: rapportNotesReserve.trim() || null,
        photos_paths: cheminsPhotos,
      })
      .select('id')
      .single();

    if (error) {
      setRapportEnvoi(false);
      setRapportErreur(`Erreur enregistrement rapport : ${error.message}`);
      return;
    }

    if (rapportLignesProduits.length > 0) {
      const lignes = rapportLignesProduits.map((l) => ({
        entreprise_id: entrepriseId,
        rapport_id: rapportCree.id,
        produit_id: l.produit_id,
        quantite_rayon: l.quantite_rayon === '' ? null : Number(l.quantite_rayon),
        quantite_reserve: l.quantite_reserve === '' ? null : Number(l.quantite_reserve),
      }));
      const { error: erreurLignes } = await supabase.from('rapport_visite_produits').insert(lignes);
      if (erreurLignes) {
        setRapportEnvoi(false);
        setRapportErreur(`Rapport enregistré, mais erreur sur les lignes produits : ${erreurLignes.message}`);
        return;
      }
    }

    const valeursSaisies = Object.entries(rapportValeursChamps).filter(([, v]) => v !== '' && v != null);
    if (valeursSaisies.length > 0) {
      const lignesChamps = valeursSaisies.map(([champId, valeur]) => ({
        entreprise_id: entrepriseId,
        rapport_id: rapportCree.id,
        champ_id: champId,
        valeur: String(valeur),
      }));
      const { error: erreurChamps } = await supabase
        .from('rapport_visite_champs_valeurs')
        .insert(lignesChamps);
      if (erreurChamps) {
        setRapportEnvoi(false);
        setRapportErreur(`Rapport enregistré, mais erreur sur les champs personnalisés : ${erreurChamps.message}`);
        return;
      }
    }

    setRapportEnvoi(false);
    fermerRapport();
  };

  const toggleClientSelection = (clientId) => {
    setFormData((prev) => {
      const dejaSelectionne = prev.clients_selectionnes.includes(clientId);
      return {
        ...prev,
        clients_selectionnes: dejaSelectionne
          ? prev.clients_selectionnes.filter((id) => id !== clientId)
          : [...prev.clients_selectionnes, clientId],
      };
    });
  };

  if (loading) {
    return <div className="p-4 text-center text-gray-500">Chargement des tournées...</div>;
  }

  if (selectedTournee) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <button
          onClick={() => setSelectedTournee(null)}
          className="mb-4 text-blue-600 flex items-center gap-1"
        >
          ← Retour aux tournées
        </button>

        <h1 className="text-xl font-bold mb-1">
          Tournée du {new Date(selectedTournee.date_tournee).toLocaleDateString('fr-FR')}
        </h1>
        <p className="text-sm text-gray-500 mb-4">
          {visites.length} visite(s) planifiée(s)
        </p>

        <div className="space-y-3">
          {visites.map((ligne, index) => (
            <div
              key={ligne.id}
              className={`border rounded-lg p-3 flex items-center justify-between ${
                ligne.statut === 'visite' ? 'bg-green-50 border-green-200' : 'bg-white'
              }`}
            >
              <div>
                <p className="font-medium">
                  {index + 1}. {ligne.clients?.nom || 'Client'}
                </p>
                <p className="text-xs text-gray-500">
                  Statut : {ligne.statut === 'visite' ? '✅ Visitée' : '⏳ À visiter'}
                </p>
              </div>
              {ligne.statut !== 'visite' && (
                <button
                  onClick={() => marquerVisitee(ligne)}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm"
                >
                  Marquer visitée (vérif. GPS)
                </button>
              )}
            </div>
          ))}
          {visites.length === 0 && (
            <p className="text-gray-400 text-center py-8">Aucune visite pour cette tournée</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">Tournées</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm"
        >
          {showForm ? 'Annuler' : '+ Nouvelle tournée'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={creerTournee} className="border rounded-lg p-4 mb-4 bg-gray-50 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Date de la tournée</label>
            <input
              type="date"
              value={formData.date_tournee}
              onChange={(e) => setFormData({ ...formData, date_tournee: e.target.value })}
              className="w-full border rounded px-3 py-2"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Clients à visiter ({formData.clients_selectionnes.length} sélectionné(s))
            </label>
            <div className="max-h-48 overflow-y-auto border rounded divide-y">
              {clients.map((client) => (
                <label
                  key={client.id}
                  className="flex items-center gap-2 p-2 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={formData.clients_selectionnes.includes(client.id)}
                    onChange={() => toggleClientSelection(client.id)}
                  />
                  {client.nom}
                </label>
              ))}
              {clients.length === 0 && (
                <p className="p-2 text-gray-400 text-sm">Aucun client disponible</p>
              )}
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium"
          >
            Créer la tournée (itinéraire optimisé)
          </button>
        </form>
      )}

      <div className="space-y-2">
        {tournees.map((tournee) => (
          <button
            key={tournee.id}
            onClick={() => ouvrirTournee(tournee)}
            className="w-full text-left border rounded-lg p-3 hover:bg-gray-50 flex justify-between items-center"
          >
            <div>
              <p className="font-medium">
                {new Date(tournee.date_tournee).toLocaleDateString('fr-FR')}
              </p>
              <p className="text-xs text-gray-500">Statut : {tournee.statut || 'planifiée'}</p>
            </div>
            <span className="text-gray-400">→</span>
          </button>
        ))}
        {tournees.length === 0 && (
          <p className="text-gray-400 text-center py-8">Aucune tournée créée pour le moment</p>
        )}
      </div>

      {rapportLigne && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-5 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-3">
            <h2 className="font-semibold text-lg">Rapport de visite</h2>
            <p className="text-sm text-gray-500">
              {rapportLigne.clients?.nom || 'Client'} — visite validée ✅
            </p>

            <div>
              <label className="block text-sm font-medium mb-1">État du stock en rayon</label>
              <textarea
                className="w-full border rounded px-3 py-2 text-sm"
                rows={2}
                value={rapportNotesRayon}
                onChange={(e) => setRapportNotesRayon(e.target.value)}
                placeholder="Ex : rupture sur le Bacca mil 550g, bien fourni sinon"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">État du stock en réserve</label>
              <textarea
                className="w-full border rounded px-3 py-2 text-sm"
                rows={2}
                value={rapportNotesReserve}
                onChange={(e) => setRapportNotesReserve(e.target.value)}
                placeholder="Ex : 20 cartons en réserve, stock suffisant pour 2 semaines"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Stock par produit</label>
              <div className="flex gap-2 mb-2">
                <select
                  className="flex-1 border rounded px-2 py-1.5 text-sm"
                  value={produitAjoutSelection}
                  onChange={(e) => setProduitAjoutSelection(e.target.value)}
                >
                  <option value="">— Choisir un produit —</option>
                  {catalogueProduits
                    .filter((p) => !rapportLignesProduits.some((l) => l.produit_id === p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.nom}</option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={ajouterLigneProduit}
                  className="bg-petrol-800 text-white px-3 rounded text-sm"
                >
                  + Ajouter
                </button>
              </div>
              {rapportLignesProduits.length > 0 && (
                <div className="space-y-2">
                  {rapportLignesProduits.map((ligne) => {
                    const produit = catalogueProduits.find((p) => p.id === ligne.produit_id);
                    return (
                      <div key={ligne.produit_id} className="border rounded-lg p-2">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium">{produit?.nom || 'Produit'}</p>
                          <button
                            type="button"
                            onClick={() => retirerLigneProduit(ligne.produit_id)}
                            className="text-red-600 text-xs"
                          >
                            Retirer
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-gray-500">Qté rayon</label>
                            <input
                              type="number"
                              min="0"
                              className="w-full border rounded px-2 py-1 text-sm"
                              value={ligne.quantite_rayon}
                              onChange={(e) => majLigneProduit(ligne.produit_id, 'quantite_rayon', e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">Qté réserve</label>
                            <input
                              type="number"
                              min="0"
                              className="w-full border rounded px-2 py-1 text-sm"
                              value={ligne.quantite_reserve}
                              onChange={(e) => majLigneProduit(ligne.produit_id, 'quantite_reserve', e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Photos ({rapportPhotos.length}/3)
                {entreprise?.photo_rapport_obligatoire && (
                  <span className="text-red-500"> — au moins 1 requise</span>
                )}
              </label>
              <div className="flex gap-2 flex-wrap">
                {rapportPhotos.map((p, i) => (
                  <div key={i} className="relative w-20 h-20">
                    <img src={p.apercu} alt="" className="w-20 h-20 object-cover rounded border" />
                    <button
                      type="button"
                      onClick={() => retirerPhotoRapport(i)}
                      className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-5 h-5 text-xs leading-5"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {rapportPhotos.length < 3 && (
                  <label className="w-20 h-20 border-2 border-dashed rounded flex items-center justify-center text-2xl text-gray-400 cursor-pointer">
                    +
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={ajouterPhotoRapport}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            {rapportErreur && <p className="text-sm text-red-600">{rapportErreur}</p>}

            {champsPerso.length > 0 && (
              <div className="space-y-3 border-t pt-3">
                {champsPerso.map((champ) => (
                  <div key={champ.id}>
                    <label className="block text-sm font-medium mb-1">{champ.libelle}</label>
                    {champ.type_champ === 'texte' && (
                      <input
                        className="w-full border rounded px-3 py-2 text-sm"
                        value={rapportValeursChamps[champ.id] || ''}
                        onChange={(e) =>
                          setRapportValeursChamps((prev) => ({ ...prev, [champ.id]: e.target.value }))
                        }
                      />
                    )}
                    {champ.type_champ === 'nombre' && (
                      <input
                        type="number"
                        className="w-full border rounded px-3 py-2 text-sm"
                        value={rapportValeursChamps[champ.id] || ''}
                        onChange={(e) =>
                          setRapportValeursChamps((prev) => ({ ...prev, [champ.id]: e.target.value }))
                        }
                      />
                    )}
                    {champ.type_champ === 'oui_non' && (
                      <select
                        className="w-full border rounded px-3 py-2 text-sm"
                        value={rapportValeursChamps[champ.id] || ''}
                        onChange={(e) =>
                          setRapportValeursChamps((prev) => ({ ...prev, [champ.id]: e.target.value }))
                        }
                      >
                        <option value="">—</option>
                        <option value="oui">Oui</option>
                        <option value="non">Non</option>
                      </select>
                    )}
                    {champ.type_champ === 'choix_multiple' && (
                      <select
                        className="w-full border rounded px-3 py-2 text-sm"
                        value={rapportValeursChamps[champ.id] || ''}
                        onChange={(e) =>
                          setRapportValeursChamps((prev) => ({ ...prev, [champ.id]: e.target.value }))
                        }
                      >
                        <option value="">—</option>
                        {(champ.options || []).map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              {!entreprise?.photo_rapport_obligatoire && (
                <button
                  type="button"
                  onClick={fermerRapport}
                  disabled={rapportEnvoi}
                  className="flex-1 border rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                >
                  Passer
                </button>
              )}
              <button
                type="button"
                onClick={envoyerRapport}
                disabled={rapportEnvoi}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
              >
                {rapportEnvoi ? 'Envoi…' : 'Enregistrer le rapport'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
