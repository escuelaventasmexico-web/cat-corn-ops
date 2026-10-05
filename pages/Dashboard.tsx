import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { DollarSign, ShoppingBag, TrendingUp, TrendingDown, Banknote, CreditCard, Landmark, Store, Receipt, Truck, Bell, Check } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { getCommercialCollections } from '../services/commercialCollectionsService';
import { getBusinessDayBounds } from '../lib/dateUtils';
import { useBranch } from '../contexts/BranchContext';
import { useAuth } from '../contexts/AuthContext';
import { formatDateTimeMX } from '../lib/datetime';
import { acknowledgeAdminOperationalAlert, fetchAdminOperationalAlerts } from '../lib/operationalAlerts';
import type { AdminOperationalAlert } from '../lib/operationalAlerts';

interface TopProduct {
  id: string;
  name: string;
  size: string;
  flavor: string;
  revenue: number;
  units: number;
}

interface BranchCajaBreakdown {
  branchId: string;
  branchName: string;
  total: number;
  cash: number;
  card: number;
  transfer: number;
  other: number;
}

interface DashboardBreakdown {
  cajaTotal: number;
  cajaByBranch: BranchCajaBreakdown[];
  pedidosTotal: number;
  pedidosCash: number;
  pedidosCard: number;
  pedidosTransfer: number;
  deliveryTotal: number;
  deliveryUber: number;
  deliveryDidi: number;
  deliveryRappi: number;
  sociosComerciales: { total: number; cash: number; transfer: number };
}

const emptyBreakdown: DashboardBreakdown = {
  cajaTotal: 0,
  cajaByBranch: [],
  pedidosTotal: 0,
  pedidosCash: 0,
  pedidosCard: 0,
  pedidosTransfer: 0,
  deliveryTotal: 0,
  deliveryUber: 0,
  deliveryDidi: 0,
  deliveryRappi: 0,
  sociosComerciales: { total: 0, cash: 0, transfer: 0 },
};

export const Dashboard = () => {
  const { branches, loading: branchesLoading } = useBranch();
  const { role, profile } = useAuth();
  const isRestrictedSeller = role === 'vendedora';
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    salesToday: 0,
    cajaTotal: 0,
    ordersToday: 0,
    percentageChange: '—'
  });
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [topMonthProducts, setTopMonthProducts] = useState<TopProduct[]>([]);
  const [topMode, setTopMode] = useState<'day' | 'month'>('day');
  const [chartData, setChartData] = useState<any[]>([]);
  const [breakdown, setBreakdown] = useState<DashboardBreakdown>(emptyBreakdown);
  const [operationalAlerts, setOperationalAlerts] = useState<AdminOperationalAlert[]>([]);
  const [alertsError, setAlertsError] = useState<string | null>(null);

  useEffect(() => {
    if (!branchesLoading) {
      void loadDashboardData();
    }
  }, [branches, branchesLoading, role]);

  useEffect(() => {
    if (role !== 'admin' || !supabase) {
      setOperationalAlerts([]);
      return;
    }

    let cancelled = false;
    const loadAlerts = async () => {
      try {
        const rows = await fetchAdminOperationalAlerts(false);
        if (!cancelled) {
          setOperationalAlerts(rows);
          setAlertsError(null);
        }
      } catch (err: unknown) {
        console.error('[OPERATIONS] Error loading cash inventory alerts:', err);
        if (!cancelled) setAlertsError(err instanceof Error ? err.message : 'No se pudieron cargar las alertas operativas');
      }
    };

    void loadAlerts();
    const channel = supabase
      .channel('admin-cash-inventory-alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'admin_operational_alerts' },
        () => { void loadAlerts(); },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase?.removeChannel(channel);
    };
  }, [role]);

  const markAlertRead = async (alertId: string) => {
    try {
      await acknowledgeAdminOperationalAlert(alertId);
      setOperationalAlerts((current) => current.filter((alert) => alert.id !== alertId));
    } catch (err: unknown) {
      console.error('[OPERATIONS] Error acknowledging cash inventory alert:', err);
      setAlertsError(err instanceof Error ? err.message : 'No se pudo marcar la alerta como leída');
    }
  };

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const todayRange = getBusinessDayBounds();
      const [businessYear, businessMonth, businessDay] = todayRange.businessDate.split('-').map(Number);
      const yesterdayCalendarDate = new Date(Date.UTC(businessYear, businessMonth - 1, businessDay - 1));
      const yesterdayRange = getBusinessDayBounds([
        yesterdayCalendarDate.getUTCFullYear(),
        String(yesterdayCalendarDate.getUTCMonth() + 1).padStart(2, '0'),
        String(yesterdayCalendarDate.getUTCDate()).padStart(2, '0'),
      ].join('-'));
      const monthStartRange = getBusinessDayBounds(`${businessYear}-${String(businessMonth).padStart(2, '0')}-01`);

      if (!supabase) return;

      const authorizedBranchIds = branches.map(branch => branch.id);
      if (isRestrictedSeller && authorizedBranchIds.length === 0) {
        setStats({ salesToday: 0, cajaTotal: 0, ordersToday: 0, percentageChange: '—' });
        setTopProducts([]);
        setTopMonthProducts([]);
        setChartData([]);
        setBreakdown(emptyBreakdown);
        return;
      }

      // 1. Sales Today - total and count (also get payment_method + promotion_code for breakdown)
      let salesTodayQuery = supabase
        .from('sales')
        .select('total, payment_method, promotion_code, sale_origin, delivery_platform, cash_amount, card_amount, branch_id')
        .gte('created_at', todayRange.start.toISOString())
        .lt('created_at', todayRange.end.toISOString())
        .eq('is_refunded', false);

      if (isRestrictedSeller) {
        salesTodayQuery = salesTodayQuery.in('branch_id', authorizedBranchIds);
      }

      const { data: rawSalesToday } = await salesTodayQuery;

      // Split by origin before any aggregate is calculated. Orders remain out
      // of the restricted dashboard until their own branch contract exists.
      const normPM = (m: string) => (m || '').toUpperCase().trim();
      const isDelivery = (s: any) => s.sale_origin === 'delivery';
      const isOrder = (s: any) => !isDelivery(s) && (s.sale_origin === 'order' || s.promotion_code === 'ORDER_CHECKOUT');
      const isCaja = (s: any) => s.sale_origin === 'pos' || (!s.sale_origin && !isOrder(s) && !isDelivery(s));
      const salesToday = isRestrictedSeller
        ? (rawSalesToday || []).filter(sale => isCaja(sale) || isDelivery(sale))
        : (rawSalesToday || []);
      
      // Separate POS direct sales from orders
      const posSalesOnly = salesToday.filter(s => s.promotion_code !== 'ORDER_CHECKOUT');
      const posTotalToday = posSalesOnly.reduce((sum, sale) => sum + Number(sale.total), 0) || 0;
      const posCountToday = posSalesOnly.length || 0;
      
      // Total sales including orders (for other metrics)
      const totalToday = salesToday.reduce((sum, sale) => sum + Number(sale.total), 0) || 0;

      // Load commercial collections for today (cobros reales de Socios Comerciales)
      let sociosComerciales = { total: 0, cash: 0, transfer: 0 };
      if (!isRestrictedSeller) try {
        // The commercial service receives calendar-date Date values and applies
        // its own Mexico City midnight, inclusive/exclusive boundaries.
        const todayUTC = new Date(Date.UTC(businessYear, businessMonth - 1, businessDay));
        const tomorrowUTC = new Date(Date.UTC(businessYear, businessMonth - 1, businessDay + 1));

        const collections = await getCommercialCollections(todayUTC, tomorrowUTC);
        if (!collections.error) {
          sociosComerciales = { total: collections.total, cash: collections.cash, transfer: collections.transfer };
          // Log for validation
          console.log('Commercial collections validation', {
            businessDate: todayRange.businessDate,
            start: todayRange.start.toISOString(),
            end: todayRange.end.toISOString(),
            total: collections.total,
            bySource: collections.bySource,
            cash: collections.cash,
            transfer: collections.transfer
          });
        } else {
          console.error('Commercial collections error:', collections.error);
        }
      } catch (err) {
        console.error('Exception loading commercial collections:', err);
      }

      // Caja directa (POS), grouped from the same sales result. This deliberately
      // never consults cash_register_sessions: opening funds, counted cash,
      // withdrawals and close differences are not sales.
      const cajasByBranch = new Map<string, BranchCajaBreakdown>(
        branches.map(branch => [branch.id, {
          branchId: branch.id,
          branchName: branch.name,
          total: 0,
          cash: 0,
          card: 0,
          transfer: 0,
          other: 0,
        }])
      );

      for (const sale of salesToday || []) {
        if (!isCaja(sale)) continue;

        const branch = cajasByBranch.get(sale.branch_id);
        if (!branch) {
          // A sale always has a valid branch_id after Phase 1B. If the current
          // user cannot read that branch, do not silently present its money as
          // another branch's POS sale.
          console.warn('Direct POS sale belongs to a branch unavailable to this dashboard', sale.branch_id);
          continue;
        }

        const amount = Number(sale.total) || 0;
        branch.total += amount;

        const method = normPM(sale.payment_method);
        if (method === 'CASH') {
          branch.cash += amount;
        } else if (method === 'CARD') {
          branch.card += amount;
        } else if (method === 'TRANSFER') {
          branch.transfer += amount;
        } else if (method === 'MIXED') {
          const cash = Number(sale.cash_amount ?? 0);
          const card = Number(sale.card_amount ?? 0);
          branch.cash += cash;
          branch.card += card;
          // Preserve the total even if a historic mixed row did not persist a
          // complete split; it is shown as "Otro" instead of being dropped.
          branch.other += amount - cash - card;
        } else {
          branch.other += amount;
        }
      }

      const cajaByBranch = Array.from(cajasByBranch.values());
      // This is the only combined direct-POS total: every branch card and the
      // breakdown derive from these exact rows, so no amount is added twice.
      const cajaTotal = cajaByBranch.reduce((sum, branch) => sum + branch.total, 0);

      // Pedidos (orders)
      const pedidosCash     = salesToday.filter(s => isOrder(s) && normPM(s.payment_method) === 'CASH').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const pedidosCard     = salesToday.filter(s => isOrder(s) && normPM(s.payment_method) === 'CARD').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const pedidosTransfer = salesToday.filter(s => isOrder(s) && normPM(s.payment_method) === 'TRANSFER').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const pedidosTotal    = pedidosCash + pedidosCard + pedidosTransfer;

      // Delivery platforms
      const deliveryUber  = salesToday.filter(s => isDelivery(s) && s.delivery_platform === 'uber_eats').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const deliveryDidi  = salesToday.filter(s => isDelivery(s) && s.delivery_platform === 'didi_food').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const deliveryRappi = salesToday.filter(s => isDelivery(s) && s.delivery_platform === 'rappi').reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const deliveryTotal = deliveryUber + deliveryDidi + deliveryRappi;

      const branchColors = [
        { cash: '#4CAF50', card: '#2196F3', transfer: '#8B5CF6', other: '#94A3B8' },
        { cash: '#22C55E', card: '#38BDF8', transfer: '#A78BFA', other: '#CBD5E1' },
        { cash: '#86EFAC', card: '#60A5FA', transfer: '#C4B5FD', other: '#E2E8F0' },
      ];
      const paymentMethodChart = [
        ...cajaByBranch.flatMap((branch, index) => {
          const colors = branchColors[index % branchColors.length];
          return [
            { name: `${branch.branchName} efectivo`, amount: branch.cash, color: colors.cash },
            { name: `${branch.branchName} tarjeta`, amount: branch.card, color: colors.card },
            { name: `${branch.branchName} transferencia`, amount: branch.transfer, color: colors.transfer },
            { name: `${branch.branchName} otros`, amount: branch.other, color: colors.other },
          ];
        }),
        { name: 'Pedidos Efectivo',amount: pedidosCash,     color: '#F59E0B' },
        { name: 'Pedidos Tarjeta', amount: pedidosCard,     color: '#06B6D4' },
        { name: 'Pedidos Transf.', amount: pedidosTransfer, color: '#8B5CF6' },
        { name: 'Uber Eats',       amount: deliveryUber,    color: '#FF6900' },
        { name: 'DiDi Food',       amount: deliveryDidi,    color: '#FF4C00' },
        { name: 'Rappi',           amount: deliveryRappi,   color: '#FF441A' },
      ].filter(d => d.amount > 0);

      // Breakdown summary for the panel
      const breakdownSummary: DashboardBreakdown = {
        cajaTotal,
        cajaByBranch,
        pedidosTotal,
        pedidosCash,
        pedidosCard,
        pedidosTransfer,
        deliveryTotal,
        deliveryUber,
        deliveryDidi,
        deliveryRappi,
        sociosComerciales: { total: sociosComerciales.total, cash: sociosComerciales.cash, transfer: sociosComerciales.transfer },
      };

      // 2. Sales Yesterday - for percentage calculation
      let salesYesterdayQuery = supabase
        .from('sales')
        .select('total, promotion_code, sale_origin, delivery_platform')
        .gte('created_at', yesterdayRange.start.toISOString())
        .lt('created_at', yesterdayRange.end.toISOString())
        .eq('is_refunded', false);

      if (isRestrictedSeller) {
        salesYesterdayQuery = salesYesterdayQuery.in('branch_id', authorizedBranchIds);
      }

      const { data: rawSalesYesterday } = await salesYesterdayQuery;
      const salesYesterday = isRestrictedSeller
        ? (rawSalesYesterday || []).filter(sale => isCaja(sale) || isDelivery(sale))
        : (rawSalesYesterday || []);
      
      const totalYesterday = salesYesterday.reduce((sum, sale) => sum + Number(sale.total), 0) || 0;

      // Calculate percentage change
      let percentageChange = '—';
      if (totalYesterday > 0) {
        const change = ((totalToday - totalYesterday) / totalYesterday) * 100;
        percentageChange = `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
      } else if (totalToday > 0) {
        percentageChange = '+100%';
      }

      // 3. Top Products Today - fetch sale_items joined with sales and products
      // First get today's sale IDs
      let todaysSalesQuery = supabase
        .from('sales')
        .select('id, promotion_code, sale_origin, delivery_platform')
        .gte('created_at', todayRange.start.toISOString())
        .lt('created_at', todayRange.end.toISOString())
        .eq('is_refunded', false);

      if (isRestrictedSeller) {
        todaysSalesQuery = todaysSalesQuery.in('branch_id', authorizedBranchIds);
      }

      const { data: rawTodaysSales } = await todaysSalesQuery;
      const todaysSales = isRestrictedSeller
        ? (rawTodaysSales || []).filter(sale => isCaja(sale) || isDelivery(sale))
        : (rawTodaysSales || []);
      
      const todaySaleIds = todaysSales.map(s => s.id);

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

      // 4. Top Products This Month

      let monthSalesQuery = supabase
        .from('sales')
        .select('id, promotion_code, sale_origin, delivery_platform')
        .gte('created_at', monthStartRange.start.toISOString())
        .lt('created_at', todayRange.end.toISOString())
        .eq('is_refunded', false);

      if (isRestrictedSeller) {
        monthSalesQuery = monthSalesQuery.in('branch_id', authorizedBranchIds);
      }

      const { data: rawMonthSales } = await monthSalesQuery;
      const monthSales = isRestrictedSeller
        ? (rawMonthSales || []).filter(sale => isCaja(sale) || isDelivery(sale))
        : (rawMonthSales || []);

      const monthSaleIds = monthSales.map(s => s.id);
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
        salesToday: totalToday + sociosComerciales.total,
        cajaTotal: posTotalToday,
        ordersToday: posCountToday,
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
            <div className="text-right">
                <div className="text-sm text-cc-text-muted">
                    {new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Mexico_City' })}
                </div>
                {profile?.full_name && (
                    <div className="text-xs text-cc-text-muted">Usuario: {profile.full_name}</div>
                )}
            </div>
        </div>

        {role === 'admin' && (alertsError || operationalAlerts.length > 0) && (
          <section className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Bell size={18} className="text-amber-300" />
              <h3 className="font-bold text-cc-cream">Alertas operativas</h3>
              {operationalAlerts.length > 0 && (
                <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-bold text-amber-200">
                  {operationalAlerts.length}
                </span>
              )}
            </div>
            {alertsError && <p className="mb-2 text-xs text-red-300">{alertsError}</p>}
            <div className="space-y-2">
              {operationalAlerts.map((alert) => (
                <div key={alert.id} className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-cc-cream">{alert.title}</p>
                    <p className="text-xs text-cc-text-muted">{alert.actor_name} · {alert.branch_name} · {formatDateTimeMX(alert.created_at)}</p>
                    {alert.alert_type === 'cash_inventory_opening' ? (
                      <p className="mt-1 text-xs text-amber-100">
                        Maíz {String((alert.payload.corn as Record<string, unknown> | undefined)?.captured_value ?? '—')} kg · Aceite {String((alert.payload.oil as Record<string, unknown> | undefined)?.captured_value ?? '—')} L
                      </p>
                    ) : (
                      <div className="mt-1 space-y-0.5 text-xs text-amber-100">
                        <p>
                          Maíz {String((alert.payload.opening_counts as Record<string, unknown> | undefined)?.corn_kg ?? '—')} → {String((alert.payload.closing_counts as Record<string, unknown> | undefined)?.corn_kg ?? '—')} kg · diferencia {String((alert.payload.differences as Record<string, unknown> | undefined)?.corn_kg ?? '—')} kg
                        </p>
                        <p>
                          Aceite {String((alert.payload.opening_counts as Record<string, unknown> | undefined)?.oil_liters ?? '—')} → {String((alert.payload.closing_counts as Record<string, unknown> | undefined)?.oil_liters ?? '—')} L · diferencia {String((alert.payload.differences as Record<string, unknown> | undefined)?.oil_liters ?? '—')} L
                        </p>
                        <p className="text-cc-text-muted">
                          Ventas {String((alert.payload.sales_summary as Record<string, unknown> | undefined)?.sale_count ?? 0)} · Neto ${String((alert.payload.sales_summary as Record<string, unknown> | undefined)?.net_sales ?? 0)} · Costo conocido ${String((alert.payload.sales_summary as Record<string, unknown> | undefined)?.known_cost_total ?? 0)}
                        </p>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void markAlertRead(alert.id)}
                    className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-green-400/30 bg-green-400/10 px-2 py-1 text-xs font-semibold text-green-300 hover:bg-green-400/20"
                  >
                    <Check size={13} /> Leída
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
            {breakdown.cajaByBranch.map((branch, index) => (
                <StatCard
                    key={branch.branchId}
                    title={`Venta Caja ${branch.branchName}`}
                    value={`$${branch.total.toFixed(2)}`}
                    icon={Store}
                    color={index % 2 === 0 ? 'bg-cc-primary' : 'bg-sky-400'}
                />
            ))}
            {!isRestrictedSeller && <StatCard
                title="Venta Pedidos" 
                value={`$${breakdown.pedidosTotal.toFixed(2)}`} 
                icon={ShoppingBag} 
                color="bg-violet-400"
            />}
            {(!isRestrictedSeller || breakdown.deliveryTotal > 0) && <StatCard
                title="Venta Delivery" 
                value={`$${breakdown.deliveryTotal.toFixed(2)}`} 
                icon={Truck} 
                color="bg-orange-500"
            />}
            {!isRestrictedSeller && <StatCard
                title="Venta Socios Comerciales" 
                value={`$${breakdown.sociosComerciales.total.toFixed(2)}`} 
                icon={Landmark} 
                color="bg-indigo-500"
            />}
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
                    value: `$${stats.ordersToday > 0 ? (stats.cajaTotal / stats.ordersToday).toFixed(2) : '0.00'}`
                }}
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                    {/* Caja Directa */}
                    <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800 md:col-span-2">
                        <div className="flex items-center gap-2 mb-3">
                            <Store size={16} className="text-cc-primary" />
                            <span className="text-sm font-bold text-cc-cream">Caja directa</span>
                            <span className="ml-auto text-lg font-bold text-cc-primary">${breakdown.cajaTotal.toFixed(2)}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {breakdown.cajaByBranch.map(branch => (
                                <div key={branch.branchId} className="rounded-lg bg-white/5 p-3">
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <span className="text-sm font-semibold text-cc-cream">{branch.branchName}</span>
                                        <span className="text-cc-primary font-bold">${branch.total.toFixed(2)}</span>
                                    </div>
                                    {branch.total === 0 ? (
                                        <p className="text-xs text-cc-text-muted">Sin ventas directas</p>
                                    ) : (
                                        <div className="space-y-1.5 text-sm">
                                            {branch.cash > 0 && (
                                                <div className="flex items-center justify-between">
                                                    <span className="flex items-center gap-2 text-cc-text-muted"><Banknote size={14} className="text-green-400" /> Efectivo</span>
                                                    <span className="text-cc-cream font-medium">${branch.cash.toFixed(2)}</span>
                                                </div>
                                            )}
                                            {branch.card > 0 && (
                                                <div className="flex items-center justify-between">
                                                    <span className="flex items-center gap-2 text-cc-text-muted"><CreditCard size={14} className="text-blue-400" /> Tarjeta</span>
                                                    <span className="text-cc-cream font-medium">${branch.card.toFixed(2)}</span>
                                                </div>
                                            )}
                                            {branch.transfer > 0 && (
                                                <div className="flex items-center justify-between">
                                                    <span className="flex items-center gap-2 text-cc-text-muted"><Landmark size={14} className="text-violet-400" /> Transferencia</span>
                                                    <span className="text-cc-cream font-medium">${branch.transfer.toFixed(2)}</span>
                                                </div>
                                            )}
                                            {branch.other > 0 && (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-cc-text-muted">Otro</span>
                                                    <span className="text-cc-cream font-medium">${branch.other.toFixed(2)}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Pedidos */}
                    {!isRestrictedSeller && <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
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
                    </div>}

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

                    {/* Socios Comerciales */}
                    {!isRestrictedSeller && breakdown.sociosComerciales.total > 0 && (
                    <div className="bg-neutral-900 rounded-xl p-4 border border-indigo-500/20 col-span-2">
                        <div className="flex items-center gap-2 mb-3">
                            <Landmark size={16} className="text-indigo-400" />
                            <span className="text-sm font-bold text-cc-cream">Socios Comerciales</span>
                            <span className="ml-auto text-lg font-bold text-indigo-400">${breakdown.sociosComerciales.total.toFixed(2)}</span>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2 text-cc-text-muted">
                                    <Banknote size={14} className="text-green-400" /> Efectivo
                                </span>
                                <span className="text-cc-cream font-medium">${breakdown.sociosComerciales.cash.toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2 text-cc-text-muted">
                                    <Landmark size={14} className="text-indigo-400" /> Transferencia
                                </span>
                                <span className="text-cc-cream font-medium">${breakdown.sociosComerciales.transfer.toFixed(2)}</span>
                            </div>
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
                        {new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' }).replace(/^./, c => c.toUpperCase())}
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
