import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
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
  Tag
} from 'lucide-react';

export const Layout = () => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase?.auth.signOut();
    navigate('/login');
  };

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/pos', icon: ShoppingCart, label: 'Punto de Venta' },
    { to: '/inventory', icon: Package, label: 'Inventario' },
    { to: '/production', icon: ChefHat, label: 'Producción' },
    { to: '/print-labels', icon: Tag, label: 'Imprimir Etiquetas' },
    { to: '/waste', icon: Trash2, label: 'Merma' },
    { to: '/ops', icon: Truck, label: 'Logística y Operación' },
    { to: '/sales-history', icon: Receipt, label: 'Historial' },
    { to: '/corte-de-caja', icon: Wallet, label: 'Corte de Caja' },
    { to: '/pedidos', icon: ClipboardList, label: 'Pedidos' },
    { to: '/finanzas', icon: DollarSign, label: 'Finanzas' },
  ];

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
          {navItems.map((item) => (
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