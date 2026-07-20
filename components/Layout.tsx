import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  ChefHat, 
  Trash2, 
  LogOut,
  Cat,
  Receipt,
  DollarSign,
  Truck,
  Wallet,
  ClipboardList,
  Tag,
  HeartHandshake,
  Loader
} from 'lucide-react';

export const Layout = () => {
  const navigate = useNavigate();
  const { profileLoading, canAccessModule, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Error logging out:', err);
    }
  };

  // All available nav items
  const allNavItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', module: 'dashboard' },
    { to: '/pos', icon: ShoppingCart, label: 'Punto de Venta', module: 'pos' },
    { to: '/inventory', icon: Package, label: 'Inventario', module: 'inventario' },
    { to: '/production', icon: ChefHat, label: 'Producción', module: 'produccion' },
    { to: '/print-labels', icon: Tag, label: 'Imprimir Etiquetas', module: 'etiquetas' },
    { to: '/waste', icon: Trash2, label: 'Merma', module: 'merma' },
    { to: '/ops', icon: Truck, label: 'Logística y Operación', module: 'logistica' },
    { to: '/socios-comerciales', icon: HeartHandshake, label: 'Socios Comerciales', module: 'socios_comerciales' },
    { to: '/sales-history', icon: Receipt, label: 'Historial', module: 'historial' },
    { to: '/corte-de-caja', icon: Wallet, label: 'Corte de Caja', module: 'corte_caja' },
    { to: '/pedidos', icon: ClipboardList, label: 'Pedidos', module: 'pedidos' },
    { to: '/finanzas', icon: DollarSign, label: 'Finanzas', module: 'finanzas' },
  ];

  // Filter nav items based on user role
  const visibleNavItems = allNavItems.filter(item => canAccessModule(item.module));

  // Show loading state while profile is being loaded
  if (profileLoading) {
    return (
      <div className="flex h-screen bg-cc-bg text-cc-text-main overflow-hidden">
        <aside className="w-20 lg:w-56 bg-cc-surface border-r border-white/5 flex flex-col transition-all duration-300">
          <div className="h-20 flex items-center justify-center border-b border-white/5">
            <div className="flex items-center gap-2 text-cc-primary">
              <Cat size={32} />
              <span className="hidden lg:block font-bold text-xl tracking-wider text-cc-cream">CAT CORN</span>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <Loader size={24} className="animate-spin text-cc-primary" />
          </div>
        </aside>
        <main className="flex-1 overflow-auto relative">
          <div className="p-6 max-w-[90rem] mx-auto">
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader size={32} className="animate-spin text-cc-primary mx-auto mb-4" />
                <p className="text-cc-text-muted">Cargando...</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-cc-bg text-cc-text-main overflow-hidden">
      {/* Sidebar */}
      <aside className="w-20 lg:w-56 bg-cc-surface border-r border-white/5 flex flex-col transition-all duration-300">
        <div className="h-20 flex items-center justify-center border-b border-white/5">
            <div className="flex items-center gap-2 text-cc-primary">
                <Cat size={32} />
                <span className="hidden lg:block font-bold text-xl tracking-wider text-cc-cream">CAT CORN</span>
            </div>
        </div>

        <nav className="flex-1 py-6 space-y-2 px-2">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-lg transition-colors duration-200 ${
                  isActive 
                    ? 'bg-cc-primary text-cc-bg font-semibold shadow-[0_0_15px_rgba(244,197,66,0.3)]' 
                    : 'text-cc-text-muted hover:bg-white/5 hover:text-cc-text-main'
                }`
              }
            >
              <item.icon size={22} />
              <span className="hidden lg:block">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-white/5">
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 text-cc-text-muted hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors"
          >
            <LogOut size={20} />
            <span className="hidden lg:block">Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto relative">
        <div className="p-6 max-w-[90rem] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
};