import { SellerCommissionMonthlySummary } from './commissionTypes';
import { formatCurrency, parseNumericValue } from './commissionUtils';
import { TrendingUp, DollarSign, Clock, CheckCircle } from 'lucide-react';

interface CommissionSummaryCardsProps {
  summary: SellerCommissionMonthlySummary | null;
  onPendingClick?: () => void;
  onAvailableClick?: () => void;
}

export const CommissionSummaryCards = ({ summary, onPendingClick, onAvailableClick }: CommissionSummaryCardsProps) => {
  if (!summary) return null;

  const available = parseNumericValue(summary.available_total);
  const pending = parseNumericValue(summary.pending_total);
  const paid = parseNumericValue(summary.paid_total);
  const generated = parseNumericValue(summary.generated_total);

  return (
    <>
      {/* Primary Card: Available for Payment */}
      <button
        onClick={onAvailableClick}
        disabled={available === 0}
        className="text-left bg-gradient-to-br from-cc-primary/20 to-cc-primary/5 border-2 border-cc-primary rounded-2xl p-6 col-span-2 hover:border-cc-primary/80 hover:from-cc-primary/30 hover:to-cc-primary/10 disabled:hover:border-cc-primary disabled:hover:from-cc-primary/20 disabled:hover:to-cc-primary/5 disabled:cursor-default transition-all group"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-cc-text-muted text-sm font-semibold mb-2">Comisión disponible</p>
            <p className="text-4xl font-bold text-cc-primary mb-2">
              {formatCurrency(available)}
            </p>
            <p className="text-xs text-cc-text-muted max-w-sm">
              Ya cumplió las condiciones y está lista para pagarse.
              {available > 0 && (
                <span className="block mt-2 font-semibold text-cc-primary opacity-0 group-hover:opacity-100 transition-opacity">
                  Clic para ver desglose →
                </span>
              )}
            </p>
          </div>
          <DollarSign className="w-12 h-12 text-cc-primary opacity-20 group-hover:opacity-30 group-disabled:opacity-20 transition-opacity" />
        </div>
      </button>

      {/* Secondary Cards */}
      {/* Pending de Liberación - CLICKABLE */}
      <button
        onClick={onPendingClick}
        disabled={pending === 0}
        className="text-left bg-cc-surface border border-white/10 rounded-2xl p-6 hover:border-white/30 hover:bg-white/5 disabled:hover:border-white/10 disabled:hover:bg-cc-surface disabled:cursor-default transition-all group"
      >
        <div className="flex items-start justify-between mb-3">
          <p className="text-cc-text-muted text-sm font-semibold">Pendiente de liberación</p>
          <Clock className="w-5 h-5 text-cc-text-muted opacity-50 group-hover:opacity-100 group-disabled:opacity-50 transition-opacity" />
        </div>
        <p className="text-2xl font-bold text-cc-cream mb-2">
          {formatCurrency(pending)}
        </p>
        <div className="flex items-center justify-between">
          <p className="text-xs text-cc-text-muted">
            Ventas registradas que todavía no han sido pagadas completamente.
          </p>
          {pending > 0 && (
            <p className="text-xs font-semibold text-cc-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap ml-2">
              Ver detalle →
            </p>
          )}
        </div>
      </button>

      <div className="bg-cc-surface border border-white/10 rounded-2xl p-6">
        <div className="flex items-start justify-between mb-3">
          <p className="text-cc-text-muted text-sm font-semibold">Pagado</p>
          <CheckCircle className="w-5 h-5 text-green-400 opacity-50" />
        </div>
        <p className="text-2xl font-bold text-cc-cream mb-2">
          {formatCurrency(paid)}
        </p>
        <p className="text-xs text-cc-text-muted">
          Comisiones que Cat Corn ya te pagó.
        </p>
      </div>

      <div className="bg-cc-surface border border-white/10 rounded-2xl p-6">
        <div className="flex items-start justify-between mb-3">
          <p className="text-cc-text-muted text-sm font-semibold">Generado total</p>
          <TrendingUp className="w-5 h-5 text-yellow-500 opacity-50" />
        </div>
        <p className="text-2xl font-bold text-cc-cream mb-2">
          {formatCurrency(generated)}
        </p>
        <p className="text-xs text-cc-text-muted">
          Disponible + pendiente + pagado del mes.
        </p>
      </div>
    </>
  );
};
