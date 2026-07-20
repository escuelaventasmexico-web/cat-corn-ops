import { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  SellerCommissionMonthlySummary,
  CommissionMovement,
  CommissionFilters,
  CommissionSettlement,
  SellerCommissionTargetProgress,
} from './commissionTypes';
import {
  formatCurrency,
  getMotivationalMessage,
  getMonthName,
  getProgressPercentage,
  canSelectMonth,
  getMonthStartDate,
  getMonthEndDate,
  parseNumericValue,
} from './commissionUtils';
import { CommissionSummaryCards } from './CommissionSummaryCards';
import { ActivitySummary } from './ActivitySummary';
import { CommissionMovementsTable } from './CommissionMovementsTable';
import { CommissionSettlementHistory } from './payments/CommissionSettlementHistory';

interface SellerCommissionDashboardProps {
  sellerId: string;
}

export const SellerCommissionDashboard = ({ sellerId }: SellerCommissionDashboardProps) => {
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [summary, setSummary] = useState<SellerCommissionMonthlySummary | null>(null);
  const [movements, setMovements] = useState<CommissionMovement[]>([]);
  const [settlements, setSettlements] = useState<CommissionSettlement[]>([]);
  const [targetProgress, setTargetProgress] = useState<SellerCommissionTargetProgress | null>(null);
  const [filters, setFilters] = useState<CommissionFilters>({
    status: 'todos',
    sourceType: 'todos',
    searchQuery: '',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!supabase) {
      setError('Supabase no está configurado');
      setLoading(false);
      return;
    }

    if (!sellerId) {
      console.error('SELLER_ID_MISSING', { sellerId });
      setError('No se pudo identificar tu cuenta. Por favor inicia sesión nuevamente.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const monthStart = getMonthStartDate(currentDate.getFullYear(), currentDate.getMonth())
        .toISOString()
        .split('T')[0];
      const monthEnd = getMonthEndDate(currentDate.getFullYear(), currentDate.getMonth())
        .toISOString()
        .split('T')[0];

      console.log('LOADING_COMMISSION_DATA', {
        sellerId,
        monthStart,
        monthEnd,
        currentDate,
      });

      // Load summary
      const { data: summaryData, error: summaryErr } = await supabase
        .from('v_seller_commission_monthly_summary')
        .select('*')
        .eq('seller_id', sellerId)
        .eq('month_start', monthStart)
        .maybeSingle();

      if (summaryErr) {
        console.error('SUMMARY_ERROR', {
          message: summaryErr.message,
          code: summaryErr.code,
          details: summaryErr.details,
          hint: summaryErr.hint,
          error: summaryErr,
        });
        throw summaryErr;
      }
      console.log('SUMMARY_LOADED', summaryData);
      setSummary(summaryData as SellerCommissionMonthlySummary);

      // Load movements
      const { data: movementsData, error: movementsErr } = await supabase
        .from('v_seller_commission_movements')
        .select('*')
        .eq('seller_id', sellerId)
        .gte('earned_at', monthStart)
        .lte('earned_at', monthEnd)
        .order('earned_at', { ascending: false });

      if (movementsErr) {
        console.error('MOVEMENTS_ERROR', {
          message: movementsErr.message,
          code: movementsErr.code,
          details: movementsErr.details,
          hint: movementsErr.hint,
          error: movementsErr,
        });
        throw movementsErr;
      }
      console.log('MOVEMENTS_LOADED', movementsData?.length || 0);
      setMovements((movementsData as CommissionMovement[]) || []);

      // Load settlements
      const { data: settlementsData, error: settlementsErr } = await supabase
        .from('commission_settlements')
        .select('*')
        .eq('seller_id', sellerId)
        .order('created_at', { ascending: false });

      if (settlementsErr) {
        console.error('SETTLEMENTS_ERROR', {
          message: settlementsErr.message,
          code: settlementsErr.code,
          details: settlementsErr.details,
          hint: settlementsErr.hint,
          error: settlementsErr,
        });
        throw settlementsErr;
      }
      console.log('SETTLEMENTS_LOADED', settlementsData?.length || 0);
      setSettlements((settlementsData as CommissionSettlement[]) || []);

      // Load target progress
      const { data: targetData, error: targetErr } = await supabase
        .from('v_seller_commission_target_progress')
        .select('*')
        .eq('seller_id', sellerId)
        .eq('month_start', monthStart)
        .maybeSingle();

      if (targetErr) {
        console.error('TARGET_ERROR', {
          message: targetErr.message,
          code: targetErr.code,
          details: targetErr.details,
          hint: targetErr.hint,
          error: targetErr,
        });
        throw targetErr;
      }
      console.log('TARGET_LOADED', targetData);
      setTargetProgress(targetData as SellerCommissionTargetProgress);
    } catch (err: any) {
      console.error('COMMISSION_MODULE_LOAD_ERROR', {
        message: err?.message,
        code: err?.code,
        details: err?.details,
        hint: err?.hint,
        error: err,
      });
      setError('No se pudieron cargar tus comisiones.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentDate, sellerId]);

  const handlePreviousMonth = () => {
    const prev = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    if (canSelectMonth(prev.getFullYear(), prev.getMonth())) {
      setCurrentDate(prev);
    }
  };

  const handleNextMonth = () => {
    const next = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    if (canSelectMonth(next.getFullYear(), next.getMonth())) {
      setCurrentDate(next);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-cc-primary animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
        <div>
          <h3 className="font-semibold text-red-300">Error</h3>
          <p className="text-sm text-red-200">{error}</p>
        </div>
      </div>
    );
  }

  const monthName = getMonthName(currentDate);
  const available = parseNumericValue(summary?.available_total);
  const pending = parseNumericValue(summary?.pending_total);
  const generated = parseNumericValue(summary?.generated_total);
  const prevMonth = parseNumericValue(summary?.generated_total) * 0.8; // Simulated
  const hasActivity = (summary?.comodato_units || 0) + (summary?.wholesale_units || 0) > 0;

  const motivationalMessage = getMotivationalMessage(available, pending, generated, prevMonth, hasActivity);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-cc-cream mb-2">Mis comisiones</h1>
        <p className="text-cc-text-muted">
          Consulta lo que has generado, lo que ya está disponible y lo que falta por liberar.
        </p>
      </div>

      {/* Month Selector */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={handlePreviousMonth}
          disabled={!canSelectMonth(
            new Date(currentDate.getFullYear(), currentDate.getMonth() - 1).getFullYear(),
            new Date(currentDate.getFullYear(), currentDate.getMonth() - 1).getMonth()
          )}
          className="p-2 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-cc-primary" />
        </button>
        <div className="min-w-40 text-center">
          <p className="text-xl font-semibold text-cc-cream capitalize">{monthName}</p>
        </div>
        <button
          onClick={handleNextMonth}
          disabled={!canSelectMonth(
            new Date(currentDate.getFullYear(), currentDate.getMonth() + 1).getFullYear(),
            new Date(currentDate.getFullYear(), currentDate.getMonth() + 1).getMonth()
          )}
          className="p-2 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          <ChevronRight className="w-5 h-5 text-cc-primary" />
        </button>
      </div>

      {/* Main Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <CommissionSummaryCards summary={summary} />
      </div>

      {/* Motivational Message */}
      {hasActivity && (
        <div className="bg-cc-primary/10 border border-cc-primary/30 rounded-xl p-4">
          <p className="text-sm text-cc-cream">{motivationalMessage}</p>
        </div>
      )}

      {/* Target Progress */}
      {targetProgress ? (
        <div className="bg-cc-surface rounded-xl border border-white/5 p-6">
          <h3 className="text-lg font-bold text-cc-cream mb-4">Meta mensual de comisiones</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <p className="text-sm text-cc-text-muted mb-1">Meta</p>
              <p className="text-2xl font-bold text-cc-cream">
                {formatCurrency(parseNumericValue(targetProgress.target_commission_amount))}
              </p>
            </div>
            <div>
              <p className="text-sm text-cc-text-muted mb-1">Generado</p>
              <p className="text-2xl font-bold text-cc-primary">
                {formatCurrency(parseNumericValue(targetProgress.generated_total))}
              </p>
            </div>
            <div>
              <p className="text-sm text-cc-text-muted mb-1">Avance</p>
              <p className="text-2xl font-bold text-cc-cream">
                {getProgressPercentage(
                  parseNumericValue(targetProgress.generated_total),
                  parseNumericValue(targetProgress.target_commission_amount)
                ).toFixed(0)}
                %
              </p>
            </div>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2">
            <div
              className="bg-cc-primary rounded-full h-2 transition-all"
              style={{
                width: `${getProgressPercentage(
                  parseNumericValue(targetProgress.generated_total),
                  parseNumericValue(targetProgress.target_commission_amount)
                )}%`,
              }}
            />
          </div>
          <p className="text-xs text-cc-text-muted mt-3">
            Te faltan:{' '}
            {formatCurrency(
              Math.max(
                0,
                parseNumericValue(targetProgress.target_commission_amount) -
                  parseNumericValue(targetProgress.generated_total)
              )
            )}
          </p>
        </div>
      ) : (
        <div className="bg-cc-surface rounded-xl border border-white/5 p-6">
          <p className="text-sm text-cc-text-muted">
            No tienes una meta configurada para este mes.
          </p>
        </div>
      )}

      {/* Activity Summary */}
      <div>
        <h3 className="text-lg font-bold text-cc-cream mb-3">Resumen de actividad</h3>
        <ActivitySummary summary={summary} />
      </div>

      {/* Movements Table */}
      <div>
        <h3 className="text-lg font-bold text-cc-cream mb-3">Desglose de movimientos</h3>
        <CommissionMovementsTable movements={movements} filters={filters} onFiltersChange={setFilters} />
      </div>

      {/* Settlements */}
      {settlements.length > 0 && (
        <div>
          <h3 className="text-lg font-bold text-cc-cream mb-3">Pagos recibidos</h3>
          <div className="bg-cc-surface rounded-xl border border-white/5 p-6">
            <CommissionSettlementHistory sellerId={sellerId} />
          </div>
        </div>
      )}
    </div>
  );
};
