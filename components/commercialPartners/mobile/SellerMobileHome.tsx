import { TrendingUp, Users, Package, DollarSign } from 'lucide-react';

interface SellerMobileHomeProps {
  commissionPending?: number;
  commissionAvailable?: number;
  partnersCount?: number;
  onNavigate: (page: 'socios' | 'vender' | 'comisiones') => void;
}

export const SellerMobileHome = ({
  commissionPending = 0,
  commissionAvailable = 0,
  partnersCount = 0,
  onNavigate,
}: SellerMobileHomeProps) => {
  const quickStats = [
    {
      title: 'Comisión disponible',
      value: `$${(commissionAvailable ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`,
      icon: <DollarSign size={24} className="text-green-500" />,
      action: () => onNavigate('comisiones'),
    },
    {
      title: 'Pendiente por revisar',
      value: `$${(commissionPending ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`,
      icon: <TrendingUp size={24} className="text-yellow-500" />,
      action: () => onNavigate('comisiones'),
    },
    {
      title: 'Mis socios',
      value: `${partnersCount ?? 0}`,
      icon: <Users size={24} className="text-blue-500" />,
      action: () => onNavigate('socios'),
    },
  ];

  return (
    <div className="space-y-4 pb-24">
      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-3 px-4 pt-4">
        {quickStats.map((stat, idx) => (
          <button
            key={idx}
            onClick={stat.action}
            className="flex items-center gap-3 p-4 rounded-lg bg-cc-surface border border-white/10 hover:border-white/20 hover:bg-cc-surface/80 transition-colors active:scale-95"
          >
            <div className="flex-shrink-0 p-2 rounded-lg bg-white/5">
              {stat.icon}
            </div>
            <div className="flex-1 text-left">
              <p className="text-xs text-cc-text-muted">{stat.title}</p>
              <p className="text-lg font-bold text-cc-text-main">{stat.value}</p>
            </div>
            <span className="text-cc-primary text-lg">→</span>
          </button>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="px-4 space-y-3">
        <h3 className="text-xs font-semibold text-cc-text-muted uppercase tracking-wider px-2">
          Acciones rápidas
        </h3>
        
        <button
          onClick={() => onNavigate('vender')}
          className="w-full flex items-center gap-3 p-4 rounded-lg bg-gradient-to-r from-cc-primary to-cc-primary-dark hover:opacity-90 transition-opacity active:scale-95"
        >
          <Package size={20} className="text-cc-bg" />
          <span className="font-semibold text-cc-bg text-sm">Nueva venta por pieza</span>
          <span className="ml-auto">→</span>
        </button>

        <button
          onClick={() => onNavigate('socios')}
          className="w-full flex items-center gap-3 p-4 rounded-lg border border-white/10 hover:bg-white/5 transition-colors active:scale-95"
        >
          <Users size={20} className="text-cc-primary" />
          <span className="font-semibold text-cc-text-main text-sm">Gestionar socios</span>
          <span className="ml-auto text-cc-primary">→</span>
        </button>
      </div>

      {/* Info Card */}
      <div className="mx-4 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
        <p className="text-xs text-blue-300 text-center">
          💡 Mantén actualizada tu información de comisiones visitando la sección de "Comisiones"
        </p>
      </div>
    </div>
  );
};
