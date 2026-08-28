import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Parametres() {
  const { profil, entreprise, rechargerProfil } = useAuth()
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState('')
  const [confirmation, setConfirmation] = useState(false)

  if (profil?.role !== 'admin') {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <p className="text-petrol-500">
          Cette page est réservée aux administrateurs de l'entreprise.
        </p>
      </div>
    )
  }

  async function basculerPhotoObligatoire() {
    setErreur('')
    setConfirmation(false)
    setEnregistrement(true)
    const { error } = await supabase
      .from('entreprises')
      .update({ photo_rapport_obligatoire: !entreprise.photo_rapport_obligatoire })
      .eq('id', entreprise.id)
    setEnregistrement(false)
    if (error) {
      setErreur(`Erreur : ${error.message}`)
      return
    }
    await rechargerProfil()
    setConfirmation(true)
    setTimeout(() => setConfirmation(false), 2500)
  }

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Paramètres</h1>
        <p className="text-sm text-petrol-500">{entreprise?.nom}</p>
      </div>

      <div className="card p-4">
        <h2 className="font-semibold mb-1">Rapports de visite commerciale</h2>
        <p className="text-sm text-petrol-600 mb-4">
          Lorsqu'un commercial valide une visite pendant une tournée, il peut saisir l'état
          du stock chez le client (rayon et réserve) avec jusqu'à 3 photos à l'appui.
        </p>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-sm">Photo obligatoire pour valider le rapport</p>
            <p className="text-xs text-petrol-500">
              {entreprise?.photo_rapport_obligatoire
                ? 'Activé : au moins une photo doit être ajoutée.'
                : 'Désactivé : le rapport peut être envoyé sans photo.'}
            </p>
          </div>
          <button
            type="button"
            onClick={basculerPhotoObligatoire}
            disabled={enregistrement}
            className={`shrink-0 w-12 h-7 rounded-full transition-colors relative disabled:opacity-50 ${
              entreprise?.photo_rapport_obligatoire ? 'bg-amber-500' : 'bg-petrol-200'
            }`}
          >
            <span
              className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${
                entreprise?.photo_rapport_obligatoire ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {confirmation && <p className="text-xs text-green-600 mt-3">Réglage enregistré.</p>}
        {erreur && <p className="text-xs text-red-600 mt-3">{erreur}</p>}
      </div>
    </div>
  )
}
