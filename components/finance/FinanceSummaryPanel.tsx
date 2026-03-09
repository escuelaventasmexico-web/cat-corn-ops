import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { DollarSign, X, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';

interface MonthSummary {
  total_sales: number;
  total_expenses: number;
  fixed_costs: number;
  variable_costs: number;
  net_income: number;
  profit_margin: number;
  fixed_costs_covered: boolean;
  monthly_target: number;
  target_achievement: number;
}

interface FinanceSummaryPanelProps {
  onClose: () => void;
}

export const FinanceSummaryPanel = ({ onClose }: FinanceSummaryPanelProps) => {
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    loadSummary();
  }, []);

  const loadSummary = async () => {
    setLoading(true);
    setError('');

    try {
      if (!supabase) throw new Error('Supabase no configurado');

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthStartStr = monthStart.toISOString().split('T')[0];

      const { data, error: rpcError } = await supabase
        .rpc('finance_month_summary', { p_month_start: monthStartStr });

      if (rpcError) throw rpcError;

      setSummary(data);
    } catch (err: any) {
      console.error('Error loading summary:', err);
      setError(err.message || 'Error al cargar resumen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DollarSign size={32} className="text-cc-primary" />
          <h2 className="text-3xl font-bold text-cc-cream">Resumen del Mes</h2>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <X size={24} className="text-cc-text-muted" />
        </button>
      </div>

      {loading && (
        <div className="bg-cc-surface p-12 rounded-xl border border-white/5 text-center text-cc-text-muted">
          Cargando resumen...
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-lg flex items-start gap-3">
          <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-medium">Error</p>
            <p className="text-red-300/80 text-sm">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Total Sales */}
          <div className="bg-gradient-to-br from-green-500/10 to-green-600/10 border border-green-500/30 p-6 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={20} className="text-green-400" />
              <h3 className="text-sm font-medium text-green-300">Ventas Totales</h3>
            </div>
            <p className="text-3xl font-bold text-green-400">
              ${summary.total_sales.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
            </p>
          </div>

          {/* Total Expenses */}
          <div className="bg-gradient-to-br from-red-500/10 to-red-600/10 border border-red-500/30 p-6 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown size={20} className="text-red-400" />
              <h3 className="text-sm font-medium text-red-300">Gastos Totales</h3>
            </div>
            <p className="text-3xl font-bold text-red-400">
              ${summary.total_expenses.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
            </p>
          </div>

          {/* Net Income */}
          <div className={`bg-gradient-to-br ${summary.net_income >= 0 ? 'from-blue-500/10 to-blue-600/10 border-blue-500/30' : 'from-orange-500/10 to-orange-600/10 border-orange-500/30'} border p-6 rounded-xl`}>
            <div className="flex items-center gap-2 mb-2">
              <DollarSign size={20} className={summary.net_income >= 0 ? 'text-blue-400' : 'text-orange-400'} />
              <h3 className="text-sm font-medium text-cc-text-muted">Utilidad Neta</h3>
            </div>
            <p className={`text-3xl font-bold ${summary.net_income >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
              ${summary.net_income.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
            </p>
          </div>

          {/* Fixed Costs */}
          <div className="bg-cc-surface border border-white/5 p-6 rounded-xl">
            <h3 className="text-sm font-medium text-cc-text-muted mb-2">Gastos Fijos</h3>
            <p className="text-2xl font-bold text-cc-cream">
              ${summary.fixed_costs.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
            </p>
            <div className="mt-2">
              {summary.fixed_costs_covered ? (
                <span className="text-xs px-2 py-1 bg-green-500/20 text-green-400 rounded">Cubiertos</span>
              ) : (
                <span className="text-xs px-2 py-1 bg-red-500/20 text-red-400 rounded">Pendientes</span>
              )}
            </div>
          </div>

          {/* Variable Costs */}
          <div className="bg-cc-surface border border-white/5 p-6 rounded-xl">
            <h3 className="text-sm font-medium text-cc-text-muted mb-2">Gastos Variables</h3>
            <p className="text-2xl font-bold text-cc-cream">
              ${summary.variable_costs.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
            </p>
          </div>

          {/* Profit Margin */}
          <div className="bg-cc-surface border border-white/5 p-6 rounded-xl">
            <h3 className="text-sm font-medium text-cc-text-muted mb-2">Margen de Utilidad</h3>
            <p className={`text-2xl font-bold ${summary.profit_margin >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {summary.profit_margin.toFixed(1)}%
            </p>
          </div>

          {/* Monthly Target */}
          {summary.monthly_target > 0 && (
            <>
              <div className="bg-cc-surface border border-white/5 p-6 rounded-xl">
                <h3 className="text-sm font-medium text-cc-text-muted mb-2">Meta Mensual</h3>
                <p className="text-2xl font-bold text-cc-primary">
                  ${summary.monthly_target.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                </p>
              </div>

              <div className="bg-cc-surface border border-white/5 p-6 rounded-xl">
                <h3 className="text-sm font-medium text-cc-text-muted mb-2">Cumplimiento</h3>
                <p className={`text-2xl font-bold ${summary.target_achievement >= 100 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {summary.target_achievement.toFixed(1)}%
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
