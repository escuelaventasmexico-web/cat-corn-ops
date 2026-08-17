import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SUPABASE_CONFIGURED } from './supabase';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';
import { ProtectedRoute, AccessDenied } from './components/ProtectedRoute';
import { SensitiveModuleGuard } from './components/SensitiveModuleGuard';
import { Dashboard } from './pages/Dashboard';
import { POS } from './pages/POS';
import { Inventory } from './pages/Inventory';
import { Production } from './pages/Production';
import { SalesHistory } from './pages/SalesHistory';
import { Waste } from './pages/Waste';
import { Finanzas } from './pages/Finanzas';
import { CorteDeCaja } from './pages/CorteDeCaja';
import { Pedidos } from './pages/Pedidos';
import Ops from './pages/Ops';
import { PrintLabels } from './pages/PrintLabels';
import { CommercialPartners } from './pages/CommercialPartners';
import { SupabaseNotConfigured } from './components/SupabaseNotConfigured';
import 'leaflet/dist/leaflet.css';
// Inner component that uses useAuth hook
function AppRoutes() {
  const { session, loading, blockedReason } = useAuth();

  if (!SUPABASE_CONFIGURED) {
    return <SupabaseNotConfigured />;
  }

  // Show global loading while session is being checked
  if (loading) {
    return (
      <div className="min-h-screen bg-[#1C1A1A] flex items-center justify-center text-[#F4C542]">
        <div className="text-center">
          <div className="animate-spin inline-block w-12 h-12 border-4 border-[#F4C542] border-t-transparent rounded-full mb-4" />
          <p>Cargando Cat Corn OPS...</p>
        </div>
      </div>
    );
  }

  // Show login if no session
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Show blocked screen if user has blockedReason (no_profile or inactive)
  if (blockedReason) {
    return (
      <Routes>
        <Route path="/login" element={<Navigate to="/blocked" replace />} />
        <Route path="/blocked" element={<AccessDenied />} />
        <Route path="*" element={<Navigate to="/blocked" replace />} />
      </Routes>
    );
  }

  // Normal app routing (user has valid session and profile)
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      
      <Route element={<Layout />}>
        <Route path="/" element={
          <ProtectedRoute requiredModules={['dashboard']}>
            <Dashboard />
          </ProtectedRoute>
        } />
        <Route path="/pos" element={
          <ProtectedRoute requiredModules={['pos']}>
            <POS />
          </ProtectedRoute>
        } />
        <Route path="/inventory" element={
          <ProtectedRoute requiredModules={['inventario']}>
            <Inventory />
          </ProtectedRoute>
        } />
        <Route path="/production" element={
          <ProtectedRoute requiredModules={['produccion']}>
            <Production />
          </ProtectedRoute>
        } />
        <Route path="/waste" element={
          <ProtectedRoute requiredModules={['merma']}>
            <Waste />
          </ProtectedRoute>
        } />
        <Route path="/sales-history" element={
          <ProtectedRoute requiredModules={['historial']}>
            <SensitiveModuleGuard>
              <SalesHistory />
            </SensitiveModuleGuard>
          </ProtectedRoute>
        } />
        <Route path="/finanzas/*" element={
          <ProtectedRoute requiredModules={['finanzas']}>
            <SensitiveModuleGuard>
              <Finanzas />
            </SensitiveModuleGuard>
          </ProtectedRoute>
        } />
        <Route path="/corte-de-caja" element={
          <ProtectedRoute requiredModules={['corte_caja']}>
            <SensitiveModuleGuard>
              <CorteDeCaja />
            </SensitiveModuleGuard>
          </ProtectedRoute>
        } />
        <Route path="/pedidos" element={
          <ProtectedRoute requiredModules={['pedidos']}>
            <Pedidos />
          </ProtectedRoute>
        } />
        <Route path="/ops" element={
          <ProtectedRoute requiredModules={['logistica']}>
            <Ops />
          </ProtectedRoute>
        } />
        <Route path="/print-labels" element={
          <ProtectedRoute requiredModules={['etiquetas']}>
            <PrintLabels />
          </ProtectedRoute>
        } />
        <Route path="/socios-comerciales" element={
          <ProtectedRoute requiredModules={['socios_comerciales']}>
            <CommercialPartners />
          </ProtectedRoute>
        } />
        {/* Catch-all for unauthorized access */}
        <Route path="*" element={<AccessDenied />} />
      </Route>
    </Routes>
  );
}

function App() {
  if (!SUPABASE_CONFIGURED) {
    return <SupabaseNotConfigured />;
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;