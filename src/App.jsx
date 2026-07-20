import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import Stock from './pages/Stock'
import Ventes from './pages/Ventes'
import NotFound from './pages/NotFound'

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
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
