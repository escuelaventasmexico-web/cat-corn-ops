import { useState, useEffect } from 'react';
import { X, FileText, TrendingUp, TrendingDown, DollarSign, AlertCircle, Calendar, Download } from 'lucide-react';
import { supabase } from '../../supabase';
import { exportPnLToExcel } from '../../lib/exportPnL';

interface PLDetailedViewProps {
  onClose: () => void;
}

// Type definitions
interface PLData {
  sales_mxn: number;
  cogs_variable_purchases_mxn: number;
  gross_profit_mxn: number;
  fixed_expenses_mxn: number;
  other_expenses_mxn: number;
  net_profit_mxn: number;
}

interface FinanceSummary {
  sales_mtd_mxn: number;
  expenses_fixed_mxn: number;
  expenses_variable_mxn: number;
  expenses_other_mxn: number;
  expenses_total_mxn: number;
  fixed_plan_mxn: number;
  fixed_covered_mxn: number;
  fixed_pending_mxn: number;
  pnl?: PLData;
}

// Helper function to format currency in MXN
const formatCurrencyMXN = (amount: number | null | undefined): string => {
  if (amount === null || amount === undefined) return '$0.00';
  return new Intl.NumberFormat('es-MX', { 
    style: 'currency', 
    currency: 'MXN' 
  }).format(amount);
};

export const PLDetailedView = ({ onClose }: PLDetailedViewProps) => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FinanceSummary | null>(null);
  const [error, setError] = useState<any>(null);
  
  // Month selector - default to current month
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);

  useEffect(() => {
    const fetchPLData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        if (!supabase) {
          throw new Error('Supabase no está configurado');
        }

        // Convert YYYY-MM to YYYY-MM-01
        const monthStartISO = `${selectedMonth}-01`;

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

    fetchPLData();
  }, [selectedMonth]);

  // Calculate P&L metrics with fallbacks
  const sales = data?.pnl?.sales_mxn ?? 0;
  const cogs = data?.pnl?.cogs_variable_purchases_mxn ?? 0;
  const grossProfit = data?.pnl?.gross_profit_mxn ?? (sales - cogs);
  const fixedExpenses = data?.pnl?.fixed_expenses_mxn ?? 0;
  const otherExpenses = data?.pnl?.other_expenses_mxn ?? 0;
  const netProfit = data?.pnl?.net_profit_mxn ?? (grossProfit - fixedExpenses - otherExpenses);

  // Calculate margins
  const grossMargin = sales > 0 ? (grossProfit / sales) * 100 : null;
  const netMargin = sales > 0 ? (netProfit / sales) * 100 : null;

  // Helper to format margin
  const formatMargin = (margin: number | null): string => {
    return margin !== null ? `${margin.toFixed(1)}%` : '—';
  };

  // Handle Excel export
  const handleExportExcel = () => {
    if (!data) return;
    try {
      exportPnLToExcel(data, selectedMonth + '-01');
    } catch (error) {
      console.error('Error al exportar Excel:', error);
      alert('Error al generar el archivo Excel. Verifica que haya datos disponibles.');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText size={32} className="text-cc-primary" />
          <h2 className="text-3xl font-bold text-cc-cream">P&L Detallado</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Export Excel Button */}
          {!loading && !error && data && data.pnl && (
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium"
              title="Descargar Excel"
            >
              <Download size={20} />
              Descargar Excel
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={24} className="text-cc-text-muted" />
          </button>
        </div>
      </div>

      {/* Month Selector */}
      <div className="bg-cc-surface p-4 rounded-lg border border-cc-primary/20 flex items-center gap-3">
        <Calendar size={20} className="text-cc-primary" />
        <label className="text-cc-text-muted font-semibold">Mes:</label>
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="bg-cc-bg border border-cc-primary/30 text-cc-cream rounded px-3 py-1 focus:outline-none focus:border-cc-primary"
        />
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
          <p className="text-cc-cream">Cargando estado de resultados...</p>
        </div>
      )}

      {/* No PNL Data */}
      {!loading && !error && (!data || !data.pnl) && (
        <div className="bg-cc-surface p-8 rounded-lg border border-yellow-500/20 text-center">
          <AlertCircle size={48} className="mx-auto mb-4 text-yellow-400" />
          <p className="text-cc-cream font-semibold mb-2">No hay datos de P&L para este mes</p>
          <p className="text-cc-text-muted text-sm">Selecciona un mes diferente o verifica que haya datos registrados.</p>
        </div>
      )}

      {/* Data State */}
      {!loading && !error && data && data.pnl && (
        <>
          {/* Key Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Ventas */}
            <div className="bg-gradient-to-br from-green-500/10 to-green-600/5 border border-green-500/30 p-5 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="text-green-400" size={24} />
                <h4 className="text-sm font-semibold text-green-400">Ventas del Mes</h4>
              </div>
              <p className="text-3xl font-bold text-cc-cream">{formatCurrencyMXN(sales)}</p>
              <p className="text-xs text-cc-text-muted mt-1">Ingresos totales</p>
            </div>

            {/* COGS */}
            <div className="bg-gradient-to-br from-red-500/10 to-red-600/5 border border-red-500/30 p-5 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="text-red-400" size={24} />
                <h4 className="text-sm font-semibold text-red-400">Compras Variables (COGS)</h4>
              </div>
              <p className="text-3xl font-bold text-cc-cream">{formatCurrencyMXN(cogs)}</p>
              <p className="text-xs text-cc-text-muted mt-1">Costo de ventas</p>
            </div>

            {/* Utilidad Bruta */}
            <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/30 p-5 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="text-blue-400" size={24} />
                <h4 className="text-sm font-semibold text-blue-400">Utilidad Bruta</h4>
              </div>
              <p className="text-3xl font-bold text-cc-cream">{formatCurrencyMXN(grossProfit)}</p>
              <p className="text-xs text-blue-300 mt-1">Margen: {formatMargin(grossMargin)}</p>
            </div>

            {/* Gastos Fijos */}
            <div className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border border-orange-500/30 p-5 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="text-orange-400" size={24} />
                <h4 className="text-sm font-semibold text-orange-400">Gastos Fijos Pagados</h4>
              </div>
              <p className="text-3xl font-bold text-cc-cream">{formatCurrencyMXN(fixedExpenses)}</p>
              <p className="text-xs text-cc-text-muted mt-1">Costos recurrentes</p>
            </div>

            {/* Otros Gastos */}
            <div className="bg-gradient-to-br from-yellow-500/10 to-yellow-600/5 border border-yellow-500/30 p-5 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="text-yellow-400" size={24} />
                <h4 className="text-sm font-semibold text-yellow-400">Otros Gastos</h4>
              </div>
              <p className="text-3xl font-bold text-cc-cream">{formatCurrencyMXN(otherExpenses)}</p>
              <p className="text-xs text-cc-text-muted mt-1">Gastos adicionales</p>
            </div>

            {/* Utilidad Neta */}
            <div className={`bg-gradient-to-br p-5 rounded-xl ${
              netProfit >= 0 
                ? 'from-purple-500/10 to-purple-600/5 border border-purple-500/30' 
                : 'from-red-500/10 to-red-600/5 border border-red-500/30'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {netProfit >= 0 ? (
                  <TrendingUp className="text-purple-400" size={24} />
                ) : (
                  <TrendingDown className="text-red-400" size={24} />
                )}
                <h4 className={`text-sm font-semibold ${
                  netProfit >= 0 ? 'text-purple-400' : 'text-red-400'
                }`}>
                  Utilidad Neta
                </h4>
              </div>
              <p className="text-3xl font-bold text-cc-cream">{formatCurrencyMXN(netProfit)}</p>
              <p className={`text-xs mt-1 ${
                netProfit >= 0 ? 'text-purple-300' : 'text-red-300'
              }`}>
                Margen: {formatMargin(netMargin)}
              </p>
            </div>
          </div>

          {/* Estado de Resultados - Table Format */}
          <div className="bg-cc-surface p-6 rounded-xl border border-white/10">
            <h3 className="text-xl font-bold text-cc-cream mb-4">Estado de Resultados</h3>
            
            <div className="space-y-3">
              {/* Ventas */}
              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-cc-cream font-semibold">Ventas</span>
                <span className="text-green-400 font-bold text-lg">{formatCurrencyMXN(sales)}</span>
              </div>

              {/* (-) COGS */}
              <div className="flex justify-between items-center py-2 border-b border-white/5 pl-4">
                <span className="text-cc-text-muted">(-) Compras Variables (COGS)</span>
                <span className="text-red-400 font-semibold">{cogs > 0 ? `(${formatCurrencyMXN(cogs)})` : formatCurrencyMXN(0)}</span>
              </div>

              {/* (=) Utilidad Bruta */}
              <div className="flex justify-between items-center py-2 border-b border-white/10 bg-blue-500/5 px-2 rounded">
                <span className="text-blue-400 font-bold">(=) Utilidad Bruta</span>
                <span className="text-blue-400 font-bold text-lg">{formatCurrencyMXN(grossProfit)}</span>
              </div>

              {/* (-) Gastos Fijos */}
              <div className="flex justify-between items-center py-2 border-b border-white/5 pl-4">
                <span className="text-cc-text-muted">(-) Gastos Fijos Pagados</span>
                <span className="text-red-400 font-semibold">{fixedExpenses > 0 ? `(${formatCurrencyMXN(fixedExpenses)})` : formatCurrencyMXN(0)}</span>
              </div>

              {/* (-) Otros Gastos */}
              <div className="flex justify-between items-center py-2 border-b border-white/10 pl-4">
                <span className="text-cc-text-muted">(-) Otros Gastos</span>
                <span className="text-red-400 font-semibold">{otherExpenses > 0 ? `(${formatCurrencyMXN(otherExpenses)})` : formatCurrencyMXN(0)}</span>
              </div>

              {/* (=) Utilidad Neta */}
              <div className={`flex justify-between items-center py-3 px-2 rounded ${
                netProfit >= 0 
                  ? 'bg-purple-500/10 border border-purple-500/30' 
                  : 'bg-red-500/10 border border-red-500/30'
              }`}>
                <span className={`font-bold text-lg ${
                  netProfit >= 0 ? 'text-purple-400' : 'text-red-400'
                }`}>
                  (=) Utilidad Neta
                </span>
                <span className={`font-bold text-2xl ${
                  netProfit >= 0 ? 'text-purple-400' : 'text-red-400'
                }`}>
                  {formatCurrencyMXN(netProfit)}
                </span>
              </div>
            </div>
          </div>

          {/* Margins Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-blue-950/20 border border-blue-500/30 p-5 rounded-lg">
              <h4 className="text-sm font-semibold text-blue-400 mb-2">Margen Bruto</h4>
              <p className="text-4xl font-bold text-cc-cream">{formatMargin(grossMargin)}</p>
              <p className="text-xs text-cc-text-muted mt-1">
                Utilidad bruta / Ventas
              </p>
            </div>

            <div className={`p-5 rounded-lg ${
              netProfit >= 0 
                ? 'bg-purple-950/20 border border-purple-500/30' 
                : 'bg-red-950/20 border border-red-500/30'
            }`}>
              <h4 className={`text-sm font-semibold mb-2 ${
                netProfit >= 0 ? 'text-purple-400' : 'text-red-400'
              }`}>
                Margen Neto
              </h4>
              <p className="text-4xl font-bold text-cc-cream">{formatMargin(netMargin)}</p>
              <p className="text-xs text-cc-text-muted mt-1">
                Utilidad neta / Ventas
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
