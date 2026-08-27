import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function Tournees() {
  const { profil } = useAuth();
  const entrepriseId = profil?.entreprise_id;
  const [tournees, setTournees] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedTournee, setSelectedTournee] = useState(null);
  const [visites, setVisites] = useState([]);

  const [formData, setFormData] = useState({
    date_tournee: new Date().toISOString().split('T')[0],
    clients_selectionnes: [],
  });

  useEffect(() => {
    if (entrepriseId) {
      chargerTournees();
      chargerClients();
    }
  }, [entrepriseId]);

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

  const marquerVisitee = async (ligneId) => {
    if (!navigator.geolocation) {
      alert("La géolocalisation n'est pas disponible sur cet appareil/navigateur.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { data, error } = await supabase.rpc('valider_visite', {
          p_tournee_ligne_id: ligneId,
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
      },
      () => {
        alert("Impossible d'obtenir votre position. Autorisez la géolocalisation pour valider une visite.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
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
                  onClick={() => marquerVisitee(ligne.id)}
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
    </div>
  );
}
