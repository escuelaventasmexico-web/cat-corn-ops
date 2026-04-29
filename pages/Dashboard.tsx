import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { DollarSign, ShoppingBag, AlertTriangle, TrendingUp, TrendingDown, Banknote, CreditCard, Landmark, Store, Receipt, Truck } from 'lucide-react';
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
  const [topMonthProducts, setTopMonthProducts] = useState<TopProduct[]>([]);
  const [topMode, setTopMode] = useState<'day' | 'month'>('day');
  const [chartData, setChartData] = useState<any[]>([]);
  const [breakdown, setBreakdown] = useState({ cajaTotal: 0, cajaCash: 0, cajaCard: 0, cajaMixed: 0, pedidosTotal: 0, pedidosCash: 0, pedidosCard: 0, pedidosTransfer: 0, deliveryTotal: 0, deliveryUber: 0, deliveryDidi: 0, deliveryRappi: 0 });

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

      // 1. Sales Today - total and count (also get payment_method + promotion_code for breakdown)
      const { data: salesToday } = await supabase
        .from('sales')
        .select('total, payment_method, promotion_code, sale_origin, delivery_platform')
        .gte('created_at', todayStr)
        .lt('created_at', tomorrowStr)
        .eq('is_refunded', false);
      
      const totalToday = salesToday?.reduce((sum, sale) => sum + Number(sale.total), 0) || 0;
      const ordersToday = salesToday?.length || 0;

      // Split by origin
      const normPM = (m: string) => (m || '').toUpperCase().trim();
      // Backward compat: ORDER_CHECKOUT promotion_code OR sale_origin = 'order'
      const isOrder    = (s: any) => s.sale_origin === 'order' || s.promotion_code === 'ORDER_CHECKOUT';
      const isDelivery = (s: any) => s.sale_origin === 'delivery';
      const isCaja     = (s: any) => !isOrder(s) && !isDelivery(s);

      // Caja directa (POS)
      const cajaCash  = salesToday?.filter(s => isCaja(s) && normPM(s.payment_method) === 'CASH').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const cajaCard  = salesToday?.filter(s => isCaja(s) && normPM(s.payment_method) === 'CARD').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const cajaMixed = salesToday?.filter(s => isCaja(s) && normPM(s.payment_method) === 'MIXED').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const cajaTotal = cajaCash + cajaCard + cajaMixed;

      // Pedidos (orders)
      const pedidosCash     = salesToday?.filter(s => isOrder(s) && normPM(s.payment_method) === 'CASH').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const pedidosCard     = salesToday?.filter(s => isOrder(s) && normPM(s.payment_method) === 'CARD').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const pedidosTransfer = salesToday?.filter(s => isOrder(s) && normPM(s.payment_method) === 'TRANSFER').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const pedidosTotal    = pedidosCash + pedidosCard + pedidosTransfer;

      // Delivery platforms
      const deliveryUber  = salesToday?.filter(s => isDelivery(s) && s.delivery_platform === 'uber_eats').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const deliveryDidi  = salesToday?.filter(s => isDelivery(s) && s.delivery_platform === 'didi_food').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const deliveryRappi = salesToday?.filter(s => isDelivery(s) && s.delivery_platform === 'rappi').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const deliveryTotal = deliveryUber + deliveryDidi + deliveryRappi;

      const paymentMethodChart = [
        { name: 'Caja Efectivo',   amount: cajaCash,        color: '#4CAF50' },
        { name: 'Caja Tarjeta',    amount: cajaCard,        color: '#2196F3' },
        { name: 'Pedidos Efectivo',amount: pedidosCash,     color: '#F59E0B' },
        { name: 'Pedidos Tarjeta', amount: pedidosCard,     color: '#06B6D4' },
        { name: 'Pedidos Transf.', amount: pedidosTransfer, color: '#8B5CF6' },
        { name: 'Caja Mixto',      amount: cajaMixed,       color: '#F97316' },
        { name: 'Uber Eats',       amount: deliveryUber,    color: '#FF6900' },
        { name: 'DiDi Food',       amount: deliveryDidi,    color: '#FF4C00' },
        { name: 'Rappi',           amount: deliveryRappi,   color: '#FF441A' },
      ].filter(d => d.amount > 0);

      // Breakdown summary for the panel
      const breakdownSummary = { cajaTotal, cajaCash, cajaCard, cajaMixed, pedidosTotal, pedidosCash, pedidosCard, pedidosTransfer, deliveryTotal, deliveryUber, deliveryDidi, deliveryRappi };

      // 2. Sales Yesterday - for percentage calculation
      const { data: salesYesterday } = await supabase
        .from('sales')
        .select('total')
        .gte('created_at', yesterdayStr)
        .lt('created_at', todayStr)
        .eq('is_refunded', false);
      
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
        .lt('created_at', tomorrowStr)
        .eq('is_refunded', false);
      
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

      // 5. Top Products This Month
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthStartStr = monthStart.toISOString();

      const { data: monthSales } = await supabase
        .from('sales')
        .select('id')
        .gte('created_at', monthStartStr)
        .lt('created_at', tomorrowStr)
        .eq('is_refunded', false);

      const monthSaleIds = monthSales?.map(s => s.id) || [];
      let topMonthList: TopProduct[] = [];

      if (monthSaleIds.length > 0) {
        const { data: monthItems } = await supabase
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
          .in('sale_id', monthSaleIds);

        const monthMap = new Map<string, { name: string; size: string; flavor: string; revenue: number; units: number }>();

        if (monthItems) {
          for (const item of monthItems) {
            if (!item.products) continue;
            const productId = item.product_id;
            const revenue = Number(item.price) * Number(item.quantity);
            const units = Number(item.quantity);
            const prod = Array.isArray(item.products) ? item.products[0] : item.products;
            if (!prod) continue;

            if (monthMap.has(productId)) {
              const existing = monthMap.get(productId)!;
              existing.revenue += revenue;
              existing.units += units;
            } else {
              monthMap.set(productId, {
                name: prod.name || '',
                size: prod.size || '',
                flavor: prod.flavor || '',
                revenue,
                units
              });
            }
          }
        }

        topMonthList = Array.from(monthMap.entries())
          .map(([id, data]) => ({ id, ...data }))
          .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
          .slice(0, 6);
      }

      setStats({
        salesToday: totalToday,
        ordersToday,
        lowStockCount: count || 0,
        percentageChange
      });
      setTopProducts(topProductsList);
      setTopMonthProducts(topMonthList);
      setChartData(paymentMethodChart);
      setBreakdown(breakdownSummary);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({ title, value, icon: Icon, trend, color, subtitle }: any) => (
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
        {subtitle && (
            <div className="mt-3 pt-3 border-t border-white/5">
                <p className="text-cc-text-muted text-xs font-medium mb-0.5">{subtitle.label}</p>
                <p className="text-lg font-semibold text-cc-cream/80">{subtitle.value}</p>
            </div>
        )}
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
            <StatCard 
                title="Venta Caja" 
                value={`$${breakdown.cajaTotal.toFixed(2)}`} 
                icon={Store} 
                color="bg-cc-primary"
            />
            <StatCard 
                title="Venta Pedidos" 
                value={`$${breakdown.pedidosTotal.toFixed(2)}`} 
                icon={ShoppingBag} 
                color="bg-violet-400"
            />
            <StatCard 
                title="Venta Delivery" 
                value={`$${breakdown.deliveryTotal.toFixed(2)}`} 
                icon={Truck} 
                color="bg-orange-500"
            />
            <StatCard 
                title="Total del Día" 
                value={`$${stats.salesToday.toFixed(2)}`} 
                icon={DollarSign} 
                trend={true}
                color="bg-green-500"
            />
            <StatCard 
                title="Tickets Cobrados" 
                value={stats.ordersToday} 
                icon={Receipt} 
                color="bg-cc-accent"
                subtitle={{
                  label: 'Ticket Promedio',
                  value: `$${stats.ordersToday > 0 ? (stats.salesToday / stats.ordersToday).toFixed(2) : '0.00'}`
                }}
            />
            <StatCard 
                title="Alerta Inventario" 
                value={stats.lowStockCount} 
                icon={AlertTriangle} 
                color="bg-red-400"
            />
        </div>

        {/* Charts & Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-cc-surface p-6 rounded-xl border border-white/5">
                <div className="mb-4">
                    <h3 className="text-lg font-bold text-cc-cream mb-1">Desglose de ventas del día</h3>
                    <p className="text-xs text-cc-text-muted">Separado por origen del cobro y método de pago</p>
                </div>

                {/* Summary breakdown panels */}
                <div className="grid grid-cols-2 gap-4 mb-5">
                    {/* Caja Directa */}
                    <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
                        <div className="flex items-center gap-2 mb-3">
                            <Store size={16} className="text-cc-primary" />
                            <span className="text-sm font-bold text-cc-cream">Caja directa</span>
                            <span className="ml-auto text-lg font-bold text-cc-primary">${breakdown.cajaTotal.toFixed(2)}</span>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2 text-cc-text-muted">
                                    <Banknote size={14} className="text-green-400" /> Efectivo
                                </span>
                                <span className="text-cc-cream font-medium">${breakdown.cajaCash.toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2 text-cc-text-muted">
                                    <CreditCard size={14} className="text-blue-400" /> Tarjeta
                                </span>
                                <span className="text-cc-cream font-medium">${breakdown.cajaCard.toFixed(2)}</span>
                            </div>
                            {breakdown.cajaMixed > 0 && (
                                <div className="flex items-center justify-between text-sm">
                                    <span className="flex items-center gap-2 text-cc-text-muted">
                                        <Banknote size={14} className="text-orange-400" /> Mixto
                                    </span>
                                    <span className="text-cc-cream font-medium">${breakdown.cajaMixed.toFixed(2)}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Pedidos */}
                    <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
                        <div className="flex items-center gap-2 mb-3">
                            <ShoppingBag size={16} className="text-violet-400" />
                            <span className="text-sm font-bold text-cc-cream">Pedidos</span>
                            <span className="ml-auto text-lg font-bold text-violet-400">${breakdown.pedidosTotal.toFixed(2)}</span>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2 text-cc-text-muted">
                                    <Banknote size={14} className="text-yellow-400" /> Efectivo
                                </span>
                                <span className="text-cc-cream font-medium">${breakdown.pedidosCash.toFixed(2)}</span>
                            </div>
                            {breakdown.pedidosCard > 0 && (
                                <div className="flex items-center justify-between text-sm">
                                    <span className="flex items-center gap-2 text-cc-text-muted">
                                        <CreditCard size={14} className="text-cyan-400" /> Tarjeta
                                    </span>
                                    <span className="text-cc-cream font-medium">${breakdown.pedidosCard.toFixed(2)}</span>
                                </div>
                            )}
                            <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2 text-cc-text-muted">
                                    <Landmark size={14} className="text-violet-400" /> Transferencia
                                </span>
                                <span className="text-cc-cream font-medium">${breakdown.pedidosTransfer.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Delivery plataformas */}
                    {breakdown.deliveryTotal > 0 && (
                    <div className="bg-neutral-900 rounded-xl p-4 border border-orange-500/20 col-span-2">
                        <div className="flex items-center gap-2 mb-3">
                            <Truck size={16} className="text-orange-400" />
                            <span className="text-sm font-bold text-cc-cream">Delivery plataformas</span>
                            <span className="ml-auto text-lg font-bold text-orange-400">${breakdown.deliveryTotal.toFixed(2)}</span>
                            <span className="text-[10px] text-orange-400/60 font-medium border border-orange-500/30 rounded-full px-2 py-0.5">Liquidación pendiente</span>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            {breakdown.deliveryUber > 0 && (
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-orange-300 font-medium">Uber Eats</span>
                                    <span className="text-cc-cream font-bold">${breakdown.deliveryUber.toFixed(2)}</span>
                                </div>
                            )}
                            {breakdown.deliveryDidi > 0 && (
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-orange-400 font-medium">DiDi Food</span>
                                    <span className="text-cc-cream font-bold">${breakdown.deliveryDidi.toFixed(2)}</span>
                                </div>
                            )}
                            {breakdown.deliveryRappi > 0 && (
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-red-400 font-medium">Rappi</span>
                                    <span className="text-cc-cream font-bold">${breakdown.deliveryRappi.toFixed(2)}</span>
                                </div>
                            )}
                        </div>
                    </div>
                    )}
                </div>

                {/* Bar chart */}
                <div className="h-52">
                    {chartData.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-cc-text-muted">
                            No hay ventas registradas hoy
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData}>
                                <XAxis 
                                    dataKey="name" 
                                    stroke="#999" 
                                    style={{ fontSize: '10px' }}
                                    interval={0}
                                    angle={-20}
                                    textAnchor="end"
                                    height={50}
                                />
                                <YAxis 
                                    stroke="#999" 
                                    style={{ fontSize: '11px' }}
                                />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#2A2A2A', border: '1px solid #444', color: '#F5F5F5' }}
                                    formatter={(value: number) => `$${value.toFixed(2)}`}
                                />
                                <Bar dataKey="amount" fill="#F4C542" radius={[4, 4, 0, 0]}>
                                    {chartData.map((entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={entry.color || '#F4C542'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-cc-cream">Top Productos</h3>
                    <div className="flex bg-white/5 rounded-lg p-0.5">
                        <button
                            onClick={() => setTopMode('day')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                                topMode === 'day'
                                    ? 'bg-cc-primary text-cc-bg'
                                    : 'text-cc-text-muted hover:text-cc-cream'
                            }`}
                        >
                            Hoy
                        </button>
                        <button
                            onClick={() => setTopMode('month')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                                topMode === 'month'
                                    ? 'bg-cc-primary text-cc-bg'
                                    : 'text-cc-text-muted hover:text-cc-cream'
                            }`}
                        >
                            Mes
                        </button>
                    </div>
                </div>
                {topMode === 'month' && (
                    <p className="text-xs text-cc-text-muted mb-3">
                        {new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase())}
                    </p>
                )}
                <div className="space-y-4">
                    {loading ? (
                        <div className="text-cc-text-muted text-center py-8">Cargando...</div>
                    ) : (topMode === 'day' ? topProducts : topMonthProducts).length === 0 ? (
                        <div className="text-cc-text-muted text-center py-8">
                            {topMode === 'day' ? 'Sin ventas hoy' : 'Sin ventas este mes'}
                        </div>
                    ) : (
                        (topMode === 'day' ? topProducts : topMonthProducts).map((product, index) => (
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