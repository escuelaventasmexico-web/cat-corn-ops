import { TrendingUp, TrendingDown, Clock, AlertCircle } from 'lucide-react';
import { SellerCommissionMonthlySummary } from '../../../types/pieceSales';
import { safeCurrency, safeInteger } from '../../../lib/pieceSalesHelpers';

interface PieceSalesSummaryCardsProps {
  summaryData: SellerCommissionMonthlySummary | null;
}

export const PieceSalesSummaryCards = ({ summaryData }: PieceSalesSummaryCardsProps) => {
  if (!summaryData) {
    return (
      <div className="text-center py-12 text-cc-text-muted">
        No hay datos disponibles todavía.
      </div>
    );
  }

  const cards = [
    {
      title: 'Ventas del mes',
      value: safeCurrency(summaryData.monthly_sales_amount),
      detail: `${safeInteger(summaryData.monthly_units_sold)} piezas en ${safeInteger(summaryData.monthly_sales_count)} ventas`,
      icon: TrendingUp,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'Comisión pendiente',
      value: safeCurrency(summaryData.total_commission_pending),
      detail: undefined,
      icon: Clock,
      color: 'text-orange-400',
      bgColor: 'bg-orange-500/10',
    },
    {
      title: 'Comisión disponible',
      value: safeCurrency(summaryData.total_commission_available),
      detail: undefined,
      icon: TrendingDown,
      color: 'text-green-400',
      bgColor: 'bg-green-500/10',
    },
    {
      title: 'Cobros en revisión',
      value: safeInteger(summaryData.monthly_payments_under_review),
      detail: undefined,
      icon: AlertCircle,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <div
            key={idx}
            className={`${card.bgColor} border border-white/5 rounded-2xl p-6`}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-cc-text-muted uppercase tracking-wide">
                {card.title}
              </p>
              <Icon className={`w-5 h-5 ${card.color}`} />
            </div>
            <p className="text-2xl font-bold text-cc-cream">{card.value}</p>
            {card.detail && (
              <p className="text-xs text-cc-text-muted mt-2">{card.detail}</p>
            )}
          </div>
        );
      })}
    </div>
  );
};
