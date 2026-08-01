import { Home, Users, Package, TrendingUp, MoreVertical } from 'lucide-react';

type MobilePageTab = 'inicio' | 'socios' | 'vender' | 'comisiones' | 'mas';

interface SellerMobileNavigationProps {
  activeTab: MobilePageTab;
  onTabChange: (tab: MobilePageTab) => void;
}

export const SellerMobileNavigation = ({ activeTab, onTabChange }: SellerMobileNavigationProps) => {
  const navItems: { id: MobilePageTab; label: string; icon: React.ReactNode }[] = [
    { id: 'inicio', label: 'Inicio', icon: <Home size={20} /> },
    { id: 'socios', label: 'Socios', icon: <Users size={20} /> },
    { id: 'vender', label: 'Vender', icon: <Package size={20} /> },
    { id: 'comisiones', label: 'Comisiones', icon: <TrendingUp size={20} /> },
    { id: 'mas', label: 'Más', icon: <MoreVertical size={20} /> },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-cc-surface backdrop-blur-md h-16 z-40 px-0 py-2">
      <div className="flex h-full">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 px-2 py-1 transition-all ${
              activeTab === item.id
                ? 'text-cc-primary'
                : 'text-cc-text-muted hover:text-cc-text-main'
            }`}
          >
            <span className={activeTab === item.id ? 'opacity-100' : 'opacity-75'}>
              {item.icon}
            </span>
            <span className="text-[10px] font-medium whitespace-nowrap">
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
