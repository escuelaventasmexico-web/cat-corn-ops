import { useState, useEffect } from 'react';
import { X, TrendingUp, DollarSign, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../../supabase';

interface FixedCostsVsSalesProps {
  onClose: () => void;
}

// Helper function to format currency in MXN
const formatMXN = (amount: number | null | undefined): string => {
  if (amount === null || amount === undefined) return '$0.00';
  return new Intl.NumberFormat('es-MX', { 
    style: 'currency', 
    currency: 'MXN' 
  }).format(amount);
};

export const FixedCostsVsSales = ({ onClose }: FixedCostsVsSalesProps) => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<any>(null);

  // Get current month start date
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed
  const monthStartDate = new Date(currentYear, currentMonth, 1);
  const monthStartISO = monthStartDate.toISOString().slice(0, 10);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        if (!supabase) {
          throw new Error('Supabase no está configurado');
        }

        const { data: result, error: rpcError } = await supabase.rpc('finance_month_summary', {
          p_month_start: monthStartISO
        });

        if (rpcError) {
          throw rpcError;
        }

        setData(result);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [monthStartISO]);

  // Calculate coverage metrics
  // A) Coverage paid percentage (what's actually been paid)
  const calculateCoveragePaid = (): number => {
    if (!data || !data.fixed_plan_mxn || data.fixed_plan_mxn <= 0) return 0;
    const coverage = (data.fixed_covered_mxn / data.fixed_plan_mxn) * 100;
    return Math.min(Math.max(coverage, 0), 100); // clamp 0-100
  };

  // B) Capacity by sales (whether sales are enough to cover the plan)
  const capacityOk = data && data.sales_mtd_mxn >= data.fixed_plan_mxn;
  const capacityDiff = data ? Math.abs(data.sales_mtd_mxn - data.fixed_plan_mxn) : 0;

  const coveragePaidPct = calculateCoveragePaid();

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp size={32} className="text-cc-primary" />
          <h2 className="text-3xl font-bold text-cc-cream">Gastos Fijos vs Ventas</h2>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <X size={24} className="text-cc-text-muted" />
        </button>
      </div>

      {/* Month Info */}
      <div className="bg-cc-surface p-4 rounded-lg border border-cc-primary/20">
        <p className="text-cc-text-muted">
          <span className="font-semibold text-cc-primary">Mes consultado:</span> {monthStartISO}
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-950/30 border border-red-500/50 p-4 rounded-lg">
          <div className="flex items-center gap-2 text-red-400 font-bold mb-2">
            <AlertCircle size={20} />
            Error al cargar datos
          </div>
          <p className="text-red-300 text-sm">{error.message || 'Error desconocido'}</p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="bg-cc-surface p-8 rounded-lg border border-blue-500/20 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cc-primary mx-auto mb-4"></div>
          <p className="text-cc-cream">Cargando análisis de cobertura...</p>
        </div>
      )}

      {/* Data State */}
      {!loading && !error && data && (
        <>
          {/* Status Message - Based on Sales Capacity */}
          <div className={`p-6 rounded-xl border ${
            capacityOk 
              ? 'bg-green-950/30 border-green-500/50' 
              : 'bg-yellow-950/30 border-yellow-500/50'
          }`}>
            <div className="flex items-center gap-3 mb-2">
              {capacityOk ? (
                <CheckCircle size={32} className="text-green-400" />
              ) : (
                <AlertCircle size={32} className="text-yellow-400" />
              )}
              <h3 className={`text-2xl font-bold ${
                capacityOk ? 'text-green-400' : 'text-yellow-400'
              }`}>
                {capacityOk 
                  ? 'Ventas alcanzan para cubrir el plan' 
                  : `Ventas aún no alcanzan el plan`
                }
              </h3>
            </div>
            <p className={`text-sm ${capacityOk ? 'text-green-300' : 'text-yellow-300'} ml-11`}>
              {capacityOk 
                ? 'Las ventas del mes ya alcanzan el plan de gastos fijos (esto no implica que estén pagados).'
                : `Te faltan ${formatMXN(capacityDiff)} para alcanzar el plan de gastos fijos del mes.`
              }
            </p>
          </div>

          {/* Sección 1 - Resumen */}
          <div className="bg-cc-surface p-6 rounded-xl border border-white/10">
            <h3 className="text-xl font-bold text-cc-cream mb-4 flex items-center gap-2">
              <DollarSign size={24} className="text-cc-primary" />
              Resumen del Mes
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gradient-to-br from-green-500/10 to-green-600/5 border border-green-500/30 p-5 rounded-lg">
                <p className="text-sm text-green-400 font-semibold mb-1">Ventas Acumuladas</p>
                <p className="text-3xl font-bold text-cc-cream">{formatMXN(data.sales_mtd_mxn)}</p>
                <p className="text-xs text-cc-text-muted mt-1">MTD (Month to Date)</p>
              </div>

              <div className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border border-orange-500/30 p-5 rounded-lg">
                <p className="text-sm text-orange-400 font-semibold mb-1">Gastos Fijos Planificados</p>
                <p className="text-3xl font-bold text-cc-cream">{formatMXN(data.fixed_plan_mxn)}</p>
                <p className="text-xs text-cc-text-muted mt-1">Costos recurrentes mensuales</p>
              </div>
            </div>
          </div>

          {/* Sección 2 - Cobertura de Pagos */}
          <div className="bg-cc-surface p-6 rounded-xl border border-white/10">
            <h3 className="text-xl font-bold text-cc-cream mb-4 flex items-center gap-2">
              <TrendingUp size={24} className="text-cc-primary" />
              Estado de Pagos
            </h3>

            {/* Progress Bar - Shows actual paid coverage */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-cc-text-muted">% de gastos fijos pagados</span>
                <span className="text-2xl font-bold text-cc-primary">{coveragePaidPct.toFixed(1)}%</span>
              </div>
              
              <div className="w-full bg-gray-700 rounded-full h-6 overflow-hidden">
                <div 
                  className={`h-6 transition-all duration-500 rounded-full ${
                    coveragePaidPct >= 100 
                      ? 'bg-gradient-to-r from-green-500 to-green-400' 
                      : coveragePaidPct >= 75
                      ? 'bg-gradient-to-r from-yellow-500 to-cc-primary'
                      : 'bg-gradient-to-r from-red-500 to-orange-500'
                  }`}
                  style={{ width: `${coveragePaidPct}%` }}
                ></div>
              </div>

              <div className="flex justify-between text-xs text-cc-text-muted mt-2">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>

            {/* Coverage Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-green-950/20 border border-green-500/30 p-5 rounded-lg">
                <p className="text-sm text-green-400 font-semibold mb-1">Gastos Pagados</p>
                <p className="text-3xl font-bold text-cc-cream">{formatMXN(data.fixed_covered_mxn)}</p>
                <p className="text-xs text-cc-text-muted mt-1">Efectivamente pagados</p>
              </div>

              <div className="bg-red-950/20 border border-red-500/30 p-5 rounded-lg">
                <p className="text-sm text-red-400 font-semibold mb-1">Gastos Pendientes</p>
                <p className="text-3xl font-bold text-cc-cream">{formatMXN(data.fixed_pending_mxn)}</p>
                <p className="text-xs text-cc-text-muted mt-1">Por pagar este mes</p>
              </div>
            </div>

            {/* Additional Info - Capacity by Sales */}
            {data.fixed_plan_mxn > 0 && (
              <div className="mt-4 p-4 bg-blue-950/20 border border-blue-500/30 rounded-lg">
                <p className="text-sm text-blue-300">
                  <span className="font-semibold">Análisis:</span> 
                  {capacityOk 
                    ? ` Has superado el plan de fijos por ${formatMXN(capacityDiff)}.`
                    : ` Te faltan ${formatMXN(capacityDiff)} para cubrir el plan de fijos con ventas.`
                  }
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {/* No Data State */}
      {!loading && !error && !data && (
        <div className="bg-cc-surface p-8 rounded-lg border border-yellow-500/20 text-center">
          <AlertCircle size={48} className="mx-auto mb-4 text-yellow-400" />
          <p className="text-cc-text-muted">No hay datos disponibles para este mes</p>
        </div>
      )}
    </div>
  );
};
