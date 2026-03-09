import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { DollarSign, ShoppingBag, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface TopProduct {
  id: string;
  name: string;
  size: string;
  flavor: string;
  revenue: number;
  units: number;
}

export const Dashboard = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    salesToday: 0,
    ordersToday: 0,
    lowStockCount: 0,
    percentageChange: '—'
  });
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      // Get today's date range
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString();
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString();

      // Get yesterday's date range
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString();

      if (!supabase) return;

      // 1. Sales Today - total and count (also get payment_method for chart)
      const { data: salesToday } = await supabase
        .from('sales')
        .select('total, payment_method')
        .gte('created_at', todayStr)
        .lt('created_at', tomorrowStr);
      
      const totalToday = salesToday?.reduce((sum, sale) => sum + Number(sale.total), 0) || 0;
      const ordersToday = salesToday?.length || 0;

      // Calculate sales by payment method for chart
      const cashTotal = salesToday?.filter(s => s.payment_method === 'cash').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const cardTotal = salesToday?.filter(s => s.payment_method === 'card').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      
      const paymentMethodChart = [
        { name: 'Efectivo', amount: cashTotal },
        { name: 'Tarjeta', amount: cardTotal }
      ];

      // 2. Sales Yesterday - for percentage calculation
      const { data: salesYesterday } = await supabase
        .from('sales')
        .select('total')
        .gte('created_at', yesterdayStr)
        .lt('created_at', todayStr);
      
      const totalYesterday = salesYesterday?.reduce((sum, sale) => sum + Number(sale.total), 0) || 0;

      // Calculate percentage change
      let percentageChange = '—';
      if (totalYesterday > 0) {
        const change = ((totalToday - totalYesterday) / totalYesterday) * 100;
        percentageChange = `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
      } else if (totalToday > 0) {
        percentageChange = '+100%';
      }

      // 3. Low Stock Count
      const { count } = await supabase
        .from('view_ingredient_stock')
        .select('*', { count: 'exact', head: true })
        .lt('current_stock', 100);

      // 4. Top Products Today - fetch sale_items joined with sales and products
      // First get today's sale IDs
      const { data: todaysSales } = await supabase
        .from('sales')
        .select('id')
        .gte('created_at', todayStr)
        .lt('created_at', tomorrowStr);
      
      const todaySaleIds = todaysSales?.map(s => s.id) || [];

      let topProductsList: TopProduct[] = [];

      if (todaySaleIds.length > 0) {
        // Fetch sale_items for today's sales with product info
        const { data: saleItemsToday } = await supabase
          .from('sale_items')
          .select(`
            quantity,
            price,
            product_id,
            products (
              id,
              name,
              size,
              flavor
            )
          `)
          .in('sale_id', todaySaleIds);

        // Aggregate by product
        const productMap = new Map<string, { name: string; size: string; flavor: string; revenue: number; units: number }>();
        
        if (saleItemsToday) {
          for (const item of saleItemsToday) {
            if (!item.products) continue;
            
            const productId = item.product_id;
            const revenue = Number(item.price) * Number(item.quantity);
            const units = Number(item.quantity);
            
            // Supabase may return the join as array or object
            const prod = Array.isArray(item.products) ? item.products[0] : item.products;
            if (!prod) continue;

            if (productMap.has(productId)) {
              const existing = productMap.get(productId)!;
              existing.revenue += revenue;
              existing.units += units;
            } else {
              productMap.set(productId, {
                name: prod.name || '',
                size: prod.size || '',
                flavor: prod.flavor || '',
                revenue,
                units
              });
            }
          }
        }

        // Sort by revenue and get top 4
        topProductsList = Array.from(productMap.entries())
          .map(([id, data]) => ({
            id,
            name: data.name,
            size: data.size,
            flavor: data.flavor,
            revenue: data.revenue,
            units: data.units
          }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 4);
      }

      setStats({
        salesToday: totalToday,
        ordersToday,
        lowStockCount: count || 0,
        percentageChange
      });
      setTopProducts(topProductsList);
      setChartData(paymentMethodChart);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({ title, value, icon: Icon, trend, color }: any) => (
    <div className="bg-cc-surface p-6 rounded-xl border border-white/5 shadow-lg">
        <div className="flex justify-between items-start">
            <div>
                <p className="text-cc-text-muted text-sm font-medium mb-1">{title}</p>
                <h3 className="text-3xl font-bold text-cc-cream">{value}</h3>
            </div>
            <div className={`p-3 rounded-lg ${color}`}>
                <Icon size={24} className="text-cc-bg" />
            </div>
        </div>
        {trend && (
            <div className="mt-4 flex items-center text-sm gap-1">
                {stats.percentageChange.startsWith('+') ? (
                  <TrendingUp size={16} className="text-green-400" />
                ) : stats.percentageChange === '—' ? null : (
                  <TrendingDown size={16} className="text-red-400" />
                )}
                <span className={stats.percentageChange.startsWith('+') ? "text-green-400 font-medium" : stats.percentageChange === '—' ? "text-cc-text-muted font-medium" : "text-red-400 font-medium"}>
                  {stats.percentageChange}
                </span>
                <span className="text-cc-text-muted">vs ayer</span>
            </div>
        )}
    </div>
  );

  return (
    <div className="space-y-8 animate-fade-in">
        <div className="flex justify-between items-center">
            <h2 className="text-3xl font-bold text-cc-cream">Dashboard Operativo</h2>
            <div className="text-sm text-cc-text-muted">
                {new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard 
                title="Ventas del Día" 
                value={`$${stats.salesToday.toFixed(2)}`} 
                icon={DollarSign} 
                trend={true}
                color="bg-cc-primary"
            />
            <StatCard 
                title="Tickets Cobrados" 
                value={stats.ordersToday} 
                icon={ShoppingBag} 
                color="bg-cc-accent"
            />
            <StatCard 
                title="Alerta Inventario" 
                value={stats.lowStockCount} 
                icon={AlertTriangle} 
                color="bg-red-400"
            />
            <StatCard 
                title="Merma Registrada" 
                value="0.00kg" 
                icon={TrendingDown} 
                color="bg-orange-400"
            />
        </div>

        {/* Charts & Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-cc-surface p-6 rounded-xl border border-white/5">
                <div className="mb-4">
                    <h3 className="text-lg font-bold text-cc-cream mb-1">Ventas del día por método de pago</h3>
                    <p className="text-xs text-cc-text-muted">Total vendido hoy (MXN) por método de pago</p>
                </div>
                <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData}>
                            <XAxis 
                                dataKey="name" 
                                stroke="#999" 
                                style={{ fontSize: '12px' }}
                                label={{ value: 'Método de Pago', position: 'insideBottom', offset: -5, fill: '#999' }}
                            />
                            <YAxis 
                                stroke="#999" 
                                style={{ fontSize: '12px' }}
                                label={{ value: 'Total (MXN)', angle: -90, position: 'insideLeft', fill: '#999' }}
                            />
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#2A2A2A', border: '1px solid #444', color: '#F5F5F5' }}
                                formatter={(value: number) => `$${value.toFixed(2)}`}
                            />
                            <Bar dataKey="amount" fill="#F4C542" radius={[4, 4, 0, 0]}>
                                {chartData.map((_entry, index) => (
                                    <Cell key={`cell-${index}`} fill={index === 0 ? '#F4C542' : '#4CAF50'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
                <h3 className="text-lg font-bold text-cc-cream mb-4">Top Productos</h3>
                <div className="space-y-4">
                    {loading ? (
                        <div className="text-cc-text-muted text-center py-8">Cargando...</div>
                    ) : topProducts.length === 0 ? (
                        <div className="text-cc-text-muted text-center py-8">Sin ventas hoy</div>
                    ) : (
                        topProducts.map((product, index) => (
                            <div key={product.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded bg-cc-primary/20 flex items-center justify-center text-cc-primary font-bold">
                                        {index + 1}
                                    </div>
                                    <div>
                                        <div className="text-cc-text-main font-medium">
                                            {product.name} {product.size}
                                            {product.flavor && (
                                                <span className="text-xs text-cc-text-muted ml-2">({product.flavor})</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-cc-text-muted">
                                            {product.units} vendido{product.units !== 1 ? 's' : ''}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-cc-primary font-bold">${product.revenue.toFixed(2)}</div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    </div>
  );
};