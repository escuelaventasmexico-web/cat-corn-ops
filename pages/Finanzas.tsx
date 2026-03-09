import { useState, useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { 
  DollarSign, 
  TrendingUp, 
  FileText, 
  CreditCard, 
  Target, 
  Receipt,
  Upload,
  ArrowLeft,
  AlertCircle
} from 'lucide-react';
import { supabase } from '../supabase';
import { FinanceChart } from '../components/finance/FinanceChart.tsx';
import { ExpensesManager } from '../components/finance/ExpensesManager.tsx';
import { FixedCostsManager } from '../components/finance/FixedCostsManager.tsx';
import { MonthlyTargetsEditor } from '../components/finance/MonthlyTargetsEditor.tsx';
import { ExpenseDocumentsManager } from '../components/finance/ExpenseDocumentsManager.tsx';
import { PLDetailedView } from '../components/finance/PLDetailedView.tsx';
import { FixedCostsVsSales } from '../components/finance/FixedCostsVsSales.tsx';

interface FinanceCard {
  path: string;
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
}

// Dashboard with cards and chart
const FinanzasDashboard = () => {
  const navigate = useNavigate();

  const cards: FinanceCard[] = [
    {
      path: '/finanzas/resumen',
      title: 'Resumen del Mes',
      description: 'Vista general de ingresos y gastos',
      icon: DollarSign,
      color: 'from-yellow-500/20 to-yellow-600/20 border-yellow-500/30'
    },
    {
      path: '/finanzas/gastos-fijos-vs-ventas',
      title: 'Gastos Fijos vs Ventas',
      description: 'Estado de cobertura',
      icon: TrendingUp,
      color: 'from-blue-500/20 to-blue-600/20 border-blue-500/30'
    },
    {
      path: '/finanzas/pnl',
      title: 'P&L Detallado',
      description: 'Estado de resultados completo',
      icon: FileText,
      color: 'from-purple-500/20 to-purple-600/20 border-purple-500/30'
    },
    {
      path: '/finanzas/gastos',
      title: 'Gastos del Mes',
      description: 'Gestionar gastos variables',
      icon: CreditCard,
      color: 'from-red-500/20 to-red-600/20 border-red-500/30'
    },
    {
      path: '/finanzas/fijos',
      title: 'Gastos Fijos',
      description: 'Configurar costos recurrentes',
      icon: Receipt,
      color: 'from-orange-500/20 to-orange-600/20 border-orange-500/30'
    },
    {
      path: '/finanzas/meta',
      title: 'Meta Mensual',
      description: 'Objetivos de ventas',
      icon: Target,
      color: 'from-green-500/20 to-green-600/20 border-green-500/30'
    },
    {
      path: '/finanzas/documentos',
      title: 'Documentos',
      description: 'Facturas y comprobantes',
      icon: Upload,
      color: 'from-indigo-500/20 to-indigo-600/20 border-indigo-500/30'
    }
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <DollarSign size={32} className="text-cc-primary" />
        <h2 className="text-3xl font-bold text-cc-cream">Finanzas</h2>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.path}
              onClick={() => navigate(card.path)}
              className={`relative p-6 rounded-xl border bg-gradient-to-br ${card.color} hover:scale-105 transition-all duration-200 text-left group overflow-hidden`}
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform" />
              <div className="relative z-10">
                <Icon size={32} className="text-cc-primary mb-3" />
                <h3 className="text-lg font-bold text-cc-cream mb-1">{card.title}</h3>
                <p className="text-sm text-cc-text-muted">{card.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Chart Section */}
      <FinanceChart />
    </div>
  );
};

// Helper function to format currency in MXN
const formatMXN = (amount: number | null | undefined): string => {
  if (amount === null || amount === undefined) return '$0.00';
  return new Intl.NumberFormat('es-MX', { 
    style: 'currency', 
    currency: 'MXN' 
  }).format(amount);
};

// Test component for debugging /finanzas/resumen
const FinanceResumenTest = () => {
  const navigate = useNavigate();
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

  // Calculate progress percentage
  const calculateProgress = (): number => {
    if (!data || !data.sales_target_mxn || data.sales_target_mxn <= 0) return 0;
    const progress = (data.sales_mtd_mxn / data.sales_target_mxn) * 100;
    
    // Validate result
    if (isNaN(progress) || !isFinite(progress)) return 0;
    
    return Math.min(Math.max(progress, 0), 100); // clamp between 0-100
  };

  const progressPercent = calculateProgress();

  // DEV ONLY: Debug progress bar
  if (import.meta.env.DEV && data) {
    console.log('🎯 Progress Bar Debug:', {
      sales_mtd_mxn: data.sales_mtd_mxn,
      sales_target_mxn: data.sales_target_mxn,
      progressPercent,
      progressPercentType: typeof progressPercent,
      isNaN: isNaN(progressPercent),
      isFinite: isFinite(progressPercent)
    });
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold text-cc-cream">Resumen del Mes</h2>
        <button
          onClick={() => navigate('/finanzas')}
          className="flex items-center gap-2 px-4 py-2 bg-cc-surface border border-cc-primary/30 text-cc-cream rounded-lg hover:bg-cc-primary/10 transition-colors"
        >
          <ArrowLeft size={20} />
          Volver
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
          <p className="text-cc-cream">Cargando datos...</p>
        </div>
      )}

      {/* Data State - Real UI */}
      {!loading && !error && data && (() => {
        // Calculate progress percentage INLINE
        const mtd = data.sales_mtd_mxn || 0;
        const target = data.sales_target_mxn || 0;
        const progressPercent = Math.max(0, Math.min(100, target > 0 ? (mtd / target) * 100 : 0));

        return (
          <>
            {/* Meta Progress Bar - REBUILT */}
            <div className="bg-cc-surface p-6 rounded-xl border border-cc-primary/20">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-cc-cream">Progreso de Meta Mensual</h3>
                {target > 0 ? (
                  <span className="text-2xl font-bold text-cc-primary">{progressPercent.toFixed(1)}%</span>
                ) : (
                  <span className="text-sm text-yellow-400">Sin meta definida</span>
                )}
              </div>
              
              {target > 0 ? (
                <>
                  {/* Progress Bar Track + Fill */}
                  <div className="w-full h-4 rounded-full bg-white/10 overflow-hidden mt-2">
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-out"
                      style={{
                        width: `${progressPercent}%`,
                        background: "linear-gradient(90deg, #facc15, #f59e0b, #d97706)",
                        boxShadow: "0 0 12px rgba(250, 204, 21, 0.6)"
                      }}
                    />
                  </div>
                  
                  {/* Stats Text */}
                  <div className="flex justify-between text-sm text-cc-text-muted">
                    <span>{formatMXN(mtd)} / {formatMXN(target)}</span>
                    <span>Faltan: {formatMXN(Math.max(0, target - mtd))}</span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-cc-text-muted">Define una meta mensual para ver el progreso</p>
              )}
            </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Ventas MTD */}
            <div className="bg-gradient-to-br from-green-500/10 to-green-600/5 border border-green-500/30 p-6 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="text-green-400" size={24} />
                <h4 className="text-sm font-semibold text-green-400">Ventas del Mes</h4>
              </div>
              <p className="text-3xl font-bold text-cc-cream">{formatMXN(data.sales_mtd_mxn)}</p>
              <p className="text-xs text-cc-text-muted mt-1">MTD (Month to Date)</p>
            </div>

            {/* Proyección */}
            <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/30 p-6 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="text-blue-400" size={24} />
                <h4 className="text-sm font-semibold text-blue-400">Proyección Mensual</h4>
              </div>
              <p className="text-3xl font-bold text-cc-cream">{formatMXN(data.sales_projection_mxn)}</p>
              <p className="text-xs text-cc-text-muted mt-1">Basado en el ritmo actual</p>
            </div>

            {/* Gastos del Mes */}
            <div className="bg-gradient-to-br from-red-500/10 to-red-600/5 border border-red-500/30 p-6 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="text-red-400" size={24} />
                <h4 className="text-sm font-semibold text-red-400">Gastos del Mes</h4>
              </div>
              <p className="text-3xl font-bold text-cc-cream">{formatMXN(data.expenses_total_mxn)}</p>
              
              {/* Warning badge if no fixed expenses paid but plan exists */}
              {(data.expenses_fixed_mxn || 0) === 0 && (data.fixed_plan_mxn || 0) > 0 && (
                <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 bg-yellow-500/20 border border-yellow-500/50 rounded text-xs text-yellow-300">
                  ⚠️ Aún no registras pagos de fijos
                </div>
              )}
              
              <div className="mt-3 space-y-1 text-xs text-cc-text-muted">
                <div className="flex justify-between">
                  <span>Fijos (pagados):</span>
                  <span className="text-cc-cream">{formatMXN(data.expenses_fixed_mxn || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Fijos (planificados):</span>
                  <span className="text-orange-300">{formatMXN(data.fixed_plan_mxn || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Variables:</span>
                  <span className="text-cc-cream">{formatMXN(data.expenses_variable_mxn || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Otros:</span>
                  <span className="text-cc-cream">{formatMXN(data.expenses_other_mxn || 0)}</span>
                </div>
              </div>
              
              {/* Plan note */}
              <div className="mt-3 pt-3 border-t border-red-500/20">
                <p className="text-xs text-cc-text-muted">
                  Plan fijo del mes: <span className="font-semibold text-orange-300">{formatMXN(data.fixed_plan_mxn || 0)}</span>
                </p>
              </div>
            </div>

            {/* Utilidad Neta */}
            <div className={`bg-gradient-to-br p-6 rounded-xl ${
              ((data.sales_mtd_mxn || 0) - (data.expenses_total_mxn || 0)) >= 0 
                ? 'from-purple-500/10 to-purple-600/5 border border-purple-500/30' 
                : 'from-red-500/10 to-red-600/5 border border-red-500/30'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <FileText className={`${((data.sales_mtd_mxn || 0) - (data.expenses_total_mxn || 0)) >= 0 ? 'text-purple-400' : 'text-red-400'}`} size={24} />
                <h4 className={`text-sm font-semibold ${((data.sales_mtd_mxn || 0) - (data.expenses_total_mxn || 0)) >= 0 ? 'text-purple-400' : 'text-red-400'}`}>
                  Utilidad Neta
                </h4>
              </div>
              <p className="text-3xl font-bold text-cc-cream">{formatMXN((data.sales_mtd_mxn || 0) - (data.expenses_total_mxn || 0))}</p>
              <p className="text-xs text-cc-text-muted mt-1">
                {((data.sales_mtd_mxn || 0) - (data.expenses_total_mxn || 0)) >= 0 ? 'Ganancia' : 'Pérdida'}
              </p>
            </div>

            {/* Fijos Pagados */}
            <div className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border border-orange-500/30 p-6 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <Receipt className="text-orange-400" size={24} />
                <h4 className="text-sm font-semibold text-orange-400">Fijos Pagados</h4>
              </div>
              <p className="text-3xl font-bold text-cc-cream">{formatMXN(data.fixed_covered_mxn)}</p>
              <p className="text-xs text-cc-text-muted mt-1">
                Pendiente por pagar: <span className="text-cc-cream font-semibold">{formatMXN(data.fixed_pending_mxn)}</span>
              </p>
            </div>

            {/* Meta Mensual */}
            <div className="bg-gradient-to-br from-yellow-500/10 to-yellow-600/5 border border-yellow-500/30 p-6 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <Target className="text-yellow-400" size={24} />
                <h4 className="text-sm font-semibold text-yellow-400">Meta Mensual</h4>
              </div>
              <p className="text-3xl font-bold text-cc-cream">
                {target > 0 ? formatMXN(target) : 'Sin definir'}
              </p>
              {target > 0 && (
                <p className="text-xs text-cc-text-muted mt-1">
                  Alcanzado: <span className="text-cc-primary font-semibold">{progressPercent.toFixed(1)}%</span>
                </p>
              )}
            </div>
          </div>
          </>
        );
      })()}

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

// Not Found Page
const NotFound = () => {
  const navigate = useNavigate();

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bg-cc-surface p-12 rounded-xl border border-red-500/20 text-center">
        <AlertCircle size={64} className="mx-auto mb-4 text-red-400" />
        <h2 className="text-2xl font-bold text-cc-cream mb-2">Sección no encontrada</h2>
        <p className="text-cc-text-muted mb-6">La página que buscas no existe en el módulo de Finanzas</p>
        <button
          onClick={() => navigate('/finanzas')}
          className="inline-flex items-center gap-2 px-6 py-3 bg-cc-primary text-cc-bg rounded-lg hover:bg-cc-primary/90 transition-colors font-medium"
        >
          <ArrowLeft size={20} />
          Volver a Finanzas
        </button>
      </div>
    </div>
  );
};

// Main Finanzas component with routing
export const Finanzas = () => {
  const navigate = useNavigate();

  return (
    <Routes>
      <Route index element={<FinanzasDashboard />} />
      <Route 
        path="resumen" 
        element={<FinanceResumenTest />} 
      />
      <Route 
        path="gastos-fijos-vs-ventas" 
        element={<FixedCostsVsSales onClose={() => navigate('/finanzas')} />} 
      />
      <Route 
        path="pnl" 
        element={<PLDetailedView onClose={() => navigate('/finanzas')} />} 
      />
      <Route 
        path="gastos" 
        element={<ExpensesManager onClose={() => navigate('/finanzas')} />} 
      />
      <Route 
        path="fijos" 
        element={<FixedCostsManager onClose={() => navigate('/finanzas')} />} 
      />
      <Route 
        path="meta" 
        element={<MonthlyTargetsEditor onClose={() => navigate('/finanzas')} />} 
      />
      <Route 
        path="documentos" 
        element={<ExpenseDocumentsManager onClose={() => navigate('/finanzas')} />} 
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};
