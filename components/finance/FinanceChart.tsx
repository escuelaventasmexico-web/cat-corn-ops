import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, AlertCircle } from 'lucide-react';
import { getCommercialCollections, getMexicoCityPaymentDate } from '../../services/commercialCollectionsService';

interface DailySeries {
  day: string;
  sales_mxn: number;
  expenses_mxn: number;
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

      const commercialData = await getCommercialCollections(
        new Date(Date.UTC(year, month - 1, 1)),
        new Date(Date.UTC(year, month, 1)),
      );

      if (commercialData.error) throw new Error(commercialData.error);

      const dailyCommercialMap = new Map<string, number>();
      for (const item of commercialData.breakdown) {
        const date = getMexicoCityPaymentDate(item.payment_date);
        dailyCommercialMap.set(date, (dailyCommercialMap.get(date) ?? 0) + item.amount);
      }

      const enrichedData = ((seriesData ?? []) as DailySeries[]).map(record => {
        const commercial = dailyCommercialMap.get(record.day) ?? 0;
        return {
          ...record,
          commercial_collections: commercial,
          sales_mxn: Number(record.sales_mxn ?? 0) + commercial,
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
            <Line type="monotone" dataKey="sales_mxn" stroke="#4CAF50" strokeWidth={2} name="Ventas" dot={{ fill: '#4CAF50' }} />
            <Line type="monotone" dataKey="expenses_mxn" stroke="#F44336" strokeWidth={2} name="Gastos" dot={{ fill: '#F44336' }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};
