import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase, SUPABASE_CONFIGURED } from './supabase';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';
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
import { SupabaseNotConfigured } from './components/SupabaseNotConfigured';

function App() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !supabase) {
      setLoading(false);
      return;
    }

    const sb = supabase;

    sb.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!SUPABASE_CONFIGURED) {
    return <SupabaseNotConfigured />;
  }

  if (loading) {
    return <div className="min-h-screen bg-[#1C1A1A] flex items-center justify-center text-[#F4C542]">Cargando Cat Corn OPS...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={!session ? <Login /> : <Navigate to="/" />} />
        
        <Route element={session ? <Layout /> : <Navigate to="/login" />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/pos" element={<POS />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/production" element={<Production />} />
          <Route path="/waste" element={<Waste />} />
          <Route path="/sales-history" element={<SalesHistory />} />
          <Route path="/finanzas/*" element={<Finanzas />} />
          <Route path="/corte-de-caja" element={<CorteDeCaja />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/ops" element={<Ops />} />
          {/* Placeholders for other routes */}
          <Route path="*" element={<div className="p-8 text-cc-text-muted">Módulo en construcción</div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;/*  */