import { SellerCommissionMonthlySummary } from './commissionTypes';
import { formatNumber, parseNumericValue } from './commissionUtils';
import { Users, TrendingUp, Package } from 'lucide-react';

interface ActivitySummaryProps {
  summary: SellerCommissionMonthlySummary | null;
}

export const ActivitySummary = ({ summary }: ActivitySummaryProps) => {
  if (!summary) return null;

  const comodatoUnits = parseNumericValue(summary.comodato_units);
  const wholesaleUnits = parseNumericValue(summary.wholesale_units);
  const totalUnits = comodatoUnits + wholesaleUnits;
  const conversions = parseNumericValue(summary.conversion_count);
  const partners = parseNumericValue(summary.partners_count);

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <div className="bg-cc-surface rounded-xl border border-white/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Package className="w-4 h-4 text-purple-400" />
          <p className="text-xs text-cc-text-muted">Comodato</p>
        </div>
        <p className="text-2xl font-bold text-cc-cream">{formatNumber(comodatoUnits)}</p>
        <p className="text-xs text-cc-text-muted mt-1">bolsas</p>
      </div>

      <div className="bg-cc-surface rounded-xl border border-white/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Package className="w-4 h-4 text-blue-400" />
          <p className="text-xs text-cc-text-muted">Mayoreo</p>
        </div>
        <p className="text-2xl font-bold text-cc-cream">{formatNumber(wholesaleUnits)}</p>
        <p className="text-xs text-cc-text-muted mt-1">bolsas</p>
      </div>

      <div className="bg-cc-surface rounded-xl border border-white/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-yellow-400" />
          <p className="text-xs text-cc-text-muted">Total</p>
        </div>
        <p className="text-2xl font-bold text-cc-cream">{formatNumber(totalUnits)}</p>
        <p className="text-xs text-cc-text-muted mt-1">bolsas</p>
      </div>

      <div className="bg-cc-surface rounded-xl border border-white/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-green-400" />
          <p className="text-xs text-cc-text-muted">Conversiones</p>
        </div>
        <p className="text-2xl font-bold text-cc-cream">{formatNumber(conversions)}</p>
        <p className="text-xs text-cc-text-muted mt-1">eventos</p>
      </div>

      <div className="bg-cc-surface rounded-xl border border-white/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-4 h-4 text-orange-400" />
          <p className="text-xs text-cc-text-muted">Socios</p>
        </div>
        <p className="text-2xl font-bold text-cc-cream">{formatNumber(partners)}</p>
        <p className="text-xs text-cc-text-muted mt-1">atendidos</p>
      </div>
    </div>
  );
};
