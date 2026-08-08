import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, AlertCircle } from 'lucide-react';
import { getCommercialCollections } from '../../services/commercialCollectionsService';

interface DailySeries {
  day: string;
  sales_mxn: number;
  expenses_mxn: number;
}

export const FinanceChart = () => {
  const [data, setData] = useState<DailySeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    loadChartData();
  }, []);

  const loadChartData = async () => {
    setLoading(true);
    setError('');
    
    try {
      if (!supabase) throw new Error('Supabase no configurado');

      // Get current month start
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthStartStr = monthStart.toISOString().split('T')[0];

      // Load store sales via RPC
      const { data: seriesData, error: rpcError } = await supabase
        .rpc('finance_daily_series', { p_month_start: monthStartStr });

      if (rpcError) throw rpcError;

      // Load commercial collections for the entire month
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const monthStartUTC = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1));
      const monthEndUTC = new Date(Date.UTC(monthEnd.getUTCFullYear(), monthEnd.getUTCMonth(), 1));

      const commercialData = await getCommercialCollections(monthStartUTC, monthEndUTC);

      if (commercialData.error) {
        console.error('Commercial collections error:', commercialData.error);
        // Continue without commercial data if error occurs
      }

      // Build a map of daily commercial collections by day
      const dailyCommercialMap = new Map<string, number>();
      if (!commercialData.error && commercialData.breakdown.length > 0) {
        for (const item of commercialData.breakdown) {
          const dateStr = item.payment_date.split('T')[0];
          const current = dailyCommercialMap.get(dateStr) || 0;
          dailyCommercialMap.set(dateStr, current + item.amount);
        }
      }

      // Merge commercial collections into series data
      const enrichedData = (seriesData || []).map((record: any) => ({
        ...record,
        // Add commercial collections to sales_mxn
        commercial_collections: dailyCommercialMap.get(record.day) || 0,
        sales_mxn: (record.sales_mxn || 0) + (dailyCommercialMap.get(record.day) || 0)
      }));

      console.log('Finance chart data enriched with commercial collections', enrichedData);
      setData(enrichedData);
    } catch (err: any) {
      console.error('Error loading chart data:', err);
      setError(err.message || 'Error al cargar datos del gráfico');
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
        <div className="h-64 flex items-center justify-center text-cc-text-muted">
          Cargando datos...
        </div>
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
        <div className="h-64 flex items-center justify-center text-cc-text-muted">
          No hay datos disponibles para este mes
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
            <XAxis 
              dataKey="day" 
              stroke="#999" 
              tick={{ fill: '#999' }}
            />
            <YAxis 
              stroke="#999" 
              tick={{ fill: '#999' }}
              tickFormatter={(value) => `$${value.toLocaleString()}`}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#2A2A2A', 
                border: '1px solid #444',
                borderRadius: '8px'
              }}
              formatter={(value: number) => `$${value.toFixed(2)}`}
            />
            <Legend />
            <Line 
              type="monotone" 
              dataKey="sales_mxn" 
              stroke="#4CAF50" 
              strokeWidth={2}
              name="Ventas"
              dot={{ fill: '#4CAF50' }}
            />
            <Line 
              type="monotone" 
              dataKey="expenses_mxn" 
              stroke="#F44336" 
              strokeWidth={2}
              name="Gastos"
              dot={{ fill: '#F44336' }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};
