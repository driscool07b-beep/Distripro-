import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import Stock from './pages/Stock'
import Ventes from './pages/Ventes'
import NotFound from './pages/NotFound'
import Tournees from './pages/Tournees';
import Parametres from './pages/Parametres'
import Rapports from './pages/Rapports'

export default function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<Login />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="clients" element={<Clients />} />
        <Route path="stock" element={<Stock />} />
        <Route path="ventes" element={<Ventes />} />
        <Route path="tournees" element={<Tournees />} />
        <Route path="rapports" element={<Rapports />} />
        <Route path="parametres" element={<Parametres />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
