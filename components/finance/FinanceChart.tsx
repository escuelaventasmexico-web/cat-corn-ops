import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, AlertCircle } from 'lucide-react';
import { getMexicoCityPaymentDate } from '../../services/commercialCollectionsService';
import { getB2BFinanceMetrics } from '../../services/financeMetricsService';

interface DailySeries {
  day: string;
  sales_mxn: number;
  expenses_mxn: number;
  b2b_generated?: number;
  commercial_collections?: number;
}

export const FinanceChart = () => {
  const [data, setData] = useState<DailySeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadChartData();
  }, []);

  const loadChartData = async () => {
    setLoading(true);
    setError('');

    try {
      if (!supabase) throw new Error('Supabase no configurado');

      const [year, month] = getMexicoCityPaymentDate(new Date()).split('-').map(Number);
      const monthStartStr = `${year}-${String(month).padStart(2, '0')}-01`;

      const { data: seriesData, error: rpcError } = await supabase
        .rpc('finance_daily_series', { p_month_start: monthStartStr });

      if (rpcError) throw rpcError;

      const monthEnd = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      const b2b = await getB2BFinanceMetrics(monthStartStr, monthEnd);

      const enrichedData = ((seriesData ?? []) as DailySeries[]).map(record => {
        const businessDate = record.day.length === 2 ? `${monthStartStr.slice(0, 8)}${record.day}` : record.day;
        const generated = b2b.generatedByDate[businessDate] ?? 0;
        return {
          ...record,
          day: businessDate,
          b2b_generated: generated,
          commercial_collections: b2b.collectedByDate[businessDate] ?? 0,
          sales_mxn: Number(record.sales_mxn ?? 0) + generated,
        };
      });

      setData(enrichedData);
    } catch (err: any) {
      console.error('Error loading chart data:', err);
      setError(err?.message || 'Error al cargar datos del gráfico');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
        <div className="flex items-center gap-3 mb-4">
          <TrendingUp size={24} className="text-cc-primary" />
          <h3 className="text-xl font-bold text-cc-cream">Ingresos vs Gastos - Mes Actual</h3>
        </div>
        <div className="h-64 flex items-center justify-center text-cc-text-muted">Cargando datos...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-cc-surface p-6 rounded-xl border border-red-500/20">
        <div className="flex items-center gap-3 mb-2">
          <AlertCircle size={24} className="text-red-400" />
          <h3 className="text-xl font-bold text-red-400">Error</h3>
        </div>
        <p className="text-red-300/80">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
      <div className="flex items-center gap-3 mb-6">
        <TrendingUp size={24} className="text-cc-primary" />
        <h3 className="text-xl font-bold text-cc-cream">Ingresos vs Gastos - Mes Actual</h3>
      </div>

      {data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-cc-text-muted">No hay datos disponibles para este mes</div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
            <XAxis dataKey="day" stroke="#999" tick={{ fill: '#999' }} />
            <YAxis stroke="#999" tick={{ fill: '#999' }} tickFormatter={(value) => `$${value.toLocaleString()}`} />
            <Tooltip
              contentStyle={{ backgroundColor: '#2A2A2A', border: '1px solid #444', borderRadius: '8px' }}
              formatter={(value: number) => `$${value.toFixed(2)}`}
            />
            <Legend />
            <Line type="monotone" dataKey="sales_mxn" stroke="#4CAF50" strokeWidth={2} name="Ventas generadas" dot={{ fill: '#4CAF50' }} />
            <Line type="monotone" dataKey="commercial_collections" stroke="#A855F7" strokeWidth={2} name="Cobranza B2B (separada)" dot={{ fill: '#A855F7' }} />
            <Line type="monotone" dataKey="expenses_mxn" stroke="#F44336" strokeWidth={2} name="Gastos" dot={{ fill: '#F44336' }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};
