import React from 'react';
import { TrendingUp, TrendingDown, Package, ShoppingCart } from 'lucide-react';
import { WholesaleSummary, fmtCurrency, CARD_CLS } from './types';

interface Props {
  summary: WholesaleSummary | null;
  loading: boolean;
}

const Stat = ({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: string;
}) => (
  <div className={`${CARD_CLS} flex flex-col gap-1`}>
    <div className="flex items-center gap-2 mb-1">
      <span className={`${accent ?? 'text-[#7a4a0a]'}`}>
        <Icon size={16} />
      </span>
      <span className="text-xs text-[#6b5c40] font-medium">{label}</span>
    </div>
    <p className="text-lg font-bold text-[#111111]">{value}</p>
  </div>
);

const WholesaleSummaryCards: React.FC<Props> = ({ summary, loading }) => {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`${CARD_CLS} h-20 animate-pulse bg-[#f5e9c8]`} />
        ))}
      </div>
    );
  }

  if (!summary) {
    return (
      <div className={`${CARD_CLS} bg-red-50 border-red-300 text-center`}>
        <p className="text-sm text-red-700">No hay datos de mayoreo disponibles</p>
      </div>
    );
  }

  const balance = summary.pending_balance ?? 0;
  const balanceAccent = balance > 0 ? 'text-red-600' : 'text-green-600';

  return (
    <div className="grid grid-cols-2 gap-3">
      <Stat
        icon={TrendingUp}
        label="Total comprado"
        value={fmtCurrency(summary.total_purchased ?? 0)}
      />
      <Stat
        icon={TrendingDown}
        label="Total pagado"
        value={fmtCurrency(summary.total_paid ?? 0)}
        accent="text-green-700"
      />
      <Stat
        icon={Package}
        label="Saldo pendiente"
        value={fmtCurrency(balance)}
        accent={balanceAccent}
      />
      <Stat
        icon={ShoppingCart}
        label="Total piezas"
        value={String(summary.total_pieces ?? 0)}
      />
    </div>
  );
};

export default WholesaleSummaryCards;
