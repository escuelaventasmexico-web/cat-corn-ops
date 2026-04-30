import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Receipt, X, CreditCard, Banknote, Landmark, Download, Calendar, Filter, RotateCcw, AlertTriangle, Truck } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatDateTimeMX } from '../lib/datetime';

interface SaleItemPreview {
  quantity: number;
  product_name?: string | null;
  products: { name: string } | null;
}

interface Sale {
  id: string;
  total: number;
  payment_method: string;
  created_at: string;
  is_refunded?: boolean;
  refunded_at?: string | null;
  refund_reason?: string | null;
  sale_origin?: string;
  delivery_platform?: string | null;
  sale_items?: SaleItemPreview[];
}

interface SaleItem {
  id: string;
  product_id: string | null;
  product_name?: string | null;
  quantity: number;
  price: number;
  products: {
    name: string;
    size: string;
    flavor: string | null;
    grams: number | null;
  } | null;
}

interface Sample {
  id: string;
  created_at: string;
  batch_id: string | null;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
}

export const SalesHistory = () => {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loadingSamples, setLoadingSamples] = useState(true);

  // ── Refund state ──
  const [refundTarget, setRefundTarget] = useState<Sale | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  // --- Helpers ---

  /** Normaliza payment_method a 'cash' | 'card' | 'transfer' | 'other' sin importar variantes */
  const normalizePaymentMethod = (raw: string | null | undefined): 'cash' | 'card' | 'transfer' | 'other' => {
    const m = (raw || '').toLowerCase().trim();
    if (m.includes('efect') || m === 'cash') return 'cash';
    if (m.includes('tarj') || m.includes('card')) return 'card';
    if (m.includes('transfer') || m === 'transfer') return 'transfer';
    return 'other';
  };

  /** Builds a short summary of product names for a sale card */
  const buildProductSummary = (items?: SaleItemPreview[]): string => {
    if (!items || items.length === 0) return 'Venta';
    const grouped: Record<string, number> = {};
    for (const item of items) {
      const name = item.products?.name || item.product_name || 'Producto genérico';
      grouped[name] = (grouped[name] || 0) + item.quantity;
    }
    const entries = Object.entries(grouped);
    if (entries.length === 1) {
      const [name, qty] = entries[0];
      return qty > 1 ? `${qty} × ${name}` : name;
    }
    const parts = entries.map(([name, qty]) => qty > 1 ? `${qty} × ${name}` : name);
    const full = parts.join(' + ');
    if (full.length <= 60) return full;
    const first = parts[0];
    const remaining = entries.length - 1;
    return `${first} + ${remaining} más`;
  };

  /** Builds a readable description line from product fields */
  const buildProductDescription = (p: SaleItem['products']): string => {
    if (!p) return '';
    const parts: string[] = [];
    if (p.flavor) parts.push(p.flavor);
    if (p.size) parts.push(p.size);
    if (p.grams) parts.push(`${p.grams}g`);
    return parts.join(' · ');
  };

  const handleRefund = async () => {
    if (!refundTarget || !supabase) return;
    setRefundLoading(true);
    setRefundError(null);
    try {
      const { error } = await supabase.rpc('refund_sale', {
        p_sale_id: refundTarget.id,
        p_reason: refundReason.trim() || null,
      });
      if (error) throw error;
      // Update local state — mark as refunded without reload
      setSales(prev => prev.map(s =>
        s.id === refundTarget.id
          ? { ...s, is_refunded: true, refunded_at: new Date().toISOString(), refund_reason: refundReason.trim() || null }
          : s
      ));
      setRefundTarget(null);
      setRefundReason('');
    } catch (err: any) {
      setRefundError(err?.message || 'Error al procesar la devolución');
    } finally {
      setRefundLoading(false);
    }
  };

  useEffect(() => {
    loadSales();
    loadSamples();
  }, [fromDate, toDate]);

  // Helper to build date range considering local timezone (America/Mexico_City)
  const buildDateRange = (fromDateStr: string, toDateStr: string) => {
    let startISO: string | null = null;
    let endISO: string | null = null;
    let effectiveFrom = fromDateStr;
    let effectiveTo = toDateStr;

    // Si solo hay from sin to, usa from como to
    if (fromDateStr && !toDateStr) {
      effectiveTo = fromDateStr;
    }

    if (effectiveFrom) {
      // Parse YYYY-MM-DD como fecha local en MX timezone
      const [year, month, day] = effectiveFrom.split('-').map(Number);
      const startLocal = new Date(year, month - 1, day);
      startLocal.setHours(0, 0, 0, 0);
      // Convertir a UTC/ISO para query de Supabase
      startISO = startLocal.toISOString();
    }

    if (effectiveTo) {
      // Parse YYYY-MM-DD como fecha local en MX timezone
      const [year, month, day] = effectiveTo.split('-').map(Number);
      const endLocal = new Date(year, month - 1, day);
      endLocal.setHours(0, 0, 0, 0);
      endLocal.setDate(endLocal.getDate() + 1); // Día siguiente para rango [start, end)
      // Convertir a UTC/ISO para query de Supabase
      endISO = endLocal.toISOString();
    }

    console.log('FILTER', { from: effectiveFrom, to: effectiveTo, startISO, endISO });
    return { startISO, endISO };
  };

  const loadSales = async () => {
    setLoading(true);
    try {
      if (!supabase) return;
      
      let query = supabase
        .from('sales')
        .select('id, total, payment_method, created_at, is_refunded, refunded_at, refund_reason, sale_origin, delivery_platform, promotion_code, sale_items(quantity, product_name, products(name))')
        .order('created_at', { ascending: false });

      // Si hay alguna fecha seleccionada, aplica filtros
      if (fromDate || toDate) {
        const { startISO, endISO } = buildDateRange(fromDate, toDate);

        if (startISO) {
          query = query.gte('created_at', startISO);
        }

        if (endISO) {
          query = query.lt('created_at', endISO);
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      console.log('SALES COUNT', data?.length);
      console.log('[SALES] raw sales', data);
      console.log('[SALES] payment methods', data?.map((s: any) => s.payment_method));
      const salesData: Sale[] = (data || []).map((s: any) => ({
        id: s.id,
        total: s.total,
        payment_method: s.payment_method,
        created_at: s.created_at,
        is_refunded: s.is_refunded ?? false,
        refunded_at: s.refunded_at ?? null,
        refund_reason: s.refund_reason ?? null,
        sale_origin: s.sale_origin
          ?? (s.promotion_code === 'ORDER_CHECKOUT' ? 'order' : 'pos'),
        delivery_platform: s.delivery_platform ?? null,
        sale_items: (s.sale_items || []).map((si: any) => ({
          quantity: si.quantity,
          product_name: si.product_name || null,
          products: Array.isArray(si.products) ? (si.products[0] || null) : (si.products || null)
        }))
      }));
      setSales(salesData);
    } catch (error) {
      console.error('Error loading sales:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSamples = async () => {
    setLoadingSamples(true);
    try {
      if (!supabase) return;
      
      let query = supabase
        .from('waste_events')
        .select('id, created_at, batch_id, quantity, unit, notes')
        .eq('type', 'PRODUCT')
        .eq('reason', 'MUESTRA')
        .order('created_at', { ascending: false });

      // Si hay alguna fecha seleccionada, aplica filtros
      if (fromDate || toDate) {
        const { startISO, endISO } = buildDateRange(fromDate, toDate);

        if (startISO) {
          query = query.gte('created_at', startISO);
        }

        if (endISO) {
          query = query.lt('created_at', endISO);
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      console.log('SAMPLES COUNT', data?.length);
      console.log('[SALES] raw samples', data);
      setSamples(data || []);
    } catch (error) {
      console.error('Error loading samples:', error);
    } finally {
      setLoadingSamples(false);
    }
  };

  const loadSaleDetails = async (sale: Sale) => {
    setSelectedSale(sale);
    setLoadingItems(true);
    try {
      if (!supabase) return;
      
      const { data, error } = await supabase
        .from('sale_items')
        .select(`
          id,
          product_id,
          product_name,
          quantity,
          price,
          products (
            name,
            size,
            flavor,
            grams
          )
        `)
        .eq('sale_id', sale.id);

      if (error) throw error;
      
      // Transform data to match SaleItem type
      const items: SaleItem[] = (data || []).map((item: any) => {
        const raw = Array.isArray(item.products) && item.products.length > 0
          ? item.products[0]
          : item.products;
        return {
          id: item.id,
          product_id: item.product_id,
          product_name: item.product_name || null,
          quantity: item.quantity,
          price: item.price,
          products: raw ? {
            name: raw.name || '',
            size: raw.size || '',
            flavor: raw.flavor || null,
            grams: raw.grams || null,
          } : null
        };
      });
      
      setSaleItems(items);
    } catch (error) {
      console.error('Error loading sale items:', error);
    } finally {
      setLoadingItems(false);
    }
  };

  const getPaymentBadge = (method: string, origin?: string | null) => {
    const norm = normalizePaymentMethod(method);
    const isOrderCash = norm === 'cash' && origin === 'order';
    if (isOrderCash) return {
      icon: <Banknote size={16} className="text-yellow-400" />,
      label: 'Efectivo',
      color: 'text-yellow-400',
    };
    if (norm === 'cash') return {
      icon: <Banknote size={16} className="text-green-400" />,
      label: 'Efectivo',
      color: 'text-green-400',
    };
    if (norm === 'card') return {
      icon: <CreditCard size={16} className="text-blue-400" />,
      label: 'Tarjeta',
      color: 'text-blue-400',
    };
    if (norm === 'transfer') return {
      icon: <Landmark size={16} className="text-violet-400" />,
      label: 'Transferencia',
      color: 'text-violet-400',
    };
    return {
      icon: <Receipt size={16} />,
      label: method || 'Otro',
      color: 'text-cc-text-muted',
    };
  };

  // Keep legacy single-arg wrappers so the CSV export line still compiles
  const getPaymentLabel = (method: string) => getPaymentBadge(method).label;

  const setQuickFilter = (filter: 'today' | 'last7' | 'month' | 'clear') => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayLocal = `${year}-${month}-${day}`;

    switch (filter) {
      case 'today':
        setFromDate(todayLocal);
        setToDate(todayLocal);
        break;
      case 'last7':
        const last7 = new Date(today);
        last7.setDate(last7.getDate() - 7);
        const year7 = last7.getFullYear();
        const month7 = String(last7.getMonth() + 1).padStart(2, '0');
        const day7 = String(last7.getDate()).padStart(2, '0');
        setFromDate(`${year7}-${month7}-${day7}`);
        setToDate(todayLocal);
        break;
      case 'month':
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const yearM = firstDay.getFullYear();
        const monthM = String(firstDay.getMonth() + 1).padStart(2, '0');
        const dayM = String(firstDay.getDate()).padStart(2, '0');
        setFromDate(`${yearM}-${monthM}-${dayM}`);
        setToDate(todayLocal);
        break;
      case 'clear':
        setFromDate('');
        setToDate('');
        break;
    }
  };

  const exportToCSV = () => {
    if (sales.length === 0) {
      alert('No hay ventas para exportar');
      return;
    }

    const headers = ['ID Venta', 'Fecha', 'Método de Pago', 'Total'];
    const rows = sales.map(sale => [
      sale.id,
      formatDateTimeMX(sale.created_at),
      getPaymentLabel(sale.payment_method),
      `$${Number(sale.total || 0).toFixed(2)}`
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `ventas_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Split sales by origin ────────────────────────────────────────────────
  const cajasSales    = sales.filter(s => !s.is_refunded && (s.sale_origin === 'pos'      || !s.sale_origin));
  const pedidosSales  = sales.filter(s => !s.is_refunded &&  s.sale_origin === 'order');
  const deliverySales = sales.filter(s => !s.is_refunded &&  s.sale_origin === 'delivery');

  // Caja (pos) — CASH & CARD only for the register breakdown
  const cashTotal     = cajasSales.filter(s => normalizePaymentMethod(s.payment_method) === 'cash').reduce((sum, s) => sum + Number(s.total || 0), 0);
  const cardTotal     = cajasSales.filter(s => normalizePaymentMethod(s.payment_method) === 'card').reduce((sum, s) => sum + Number(s.total || 0), 0);
  const cajaTotal     = cashTotal + cardTotal;

  // Pedidos — informativo, separado de caja
  const pedidosCash     = pedidosSales.filter(s => normalizePaymentMethod(s.payment_method) === 'cash').reduce((sum, s) => sum + Number(s.total || 0), 0);
  const pedidosCard     = pedidosSales.filter(s => normalizePaymentMethod(s.payment_method) === 'card').reduce((sum, s) => sum + Number(s.total || 0), 0);
  const pedidosTransfer = pedidosSales.filter(s => normalizePaymentMethod(s.payment_method) === 'transfer').reduce((sum, s) => sum + Number(s.total || 0), 0);
  const pedidosTotal    = pedidosSales.reduce((sum, s) => sum + Number(s.total || 0), 0);

  // Delivery — informativo, separado de caja
  const deliveryTotal = deliverySales.reduce((sum, s) => sum + Number(s.total || 0), 0);

  const totalGeneral = sales.filter(s => !s.is_refunded).reduce((sum, s) => sum + Number(s.total || 0), 0);

  // Chart includes all origins, labeled clearly
  const paymentChartData = [
    { name: 'Caja Efectivo',    value: cashTotal,        color: '#4CAF50' },
    { name: 'Caja Tarjeta',     value: cardTotal,        color: '#2196F3' },
    { name: 'Pedidos Efectivo', value: pedidosCash,      color: '#F59E0B' },
    { name: 'Pedidos Tarjeta',  value: pedidosCard,      color: '#06B6D4' },
    { name: 'Pedidos Transf.',  value: pedidosTransfer,  color: '#8B5CF6' },
    { name: 'Delivery',         value: deliveryTotal,    color: '#FF6900' },
  ].filter(item => item.value > 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold text-cc-cream flex items-center gap-3">
          <Receipt size={32} className="text-cc-primary" />
          Historial de Ventas
        </h2>
        <button
          onClick={exportToCSV}
          className="flex items-center gap-2 px-4 py-2 bg-cc-primary text-cc-bg rounded-lg hover:bg-cc-primary/90 transition-colors font-medium"
        >
          <Download size={18} />
          Exportar CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-cc-surface p-5 rounded-xl border border-white/5">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={20} className="text-cc-primary" />
          <h3 className="text-lg font-semibold text-cc-cream">Filtros por Fecha</h3>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-cc-text-muted mb-2">Desde</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-cc-text-muted mb-2">Hasta</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setQuickFilter('today')}
            className="px-4 py-2 bg-white/5 hover:bg-cc-primary/20 border border-white/10 rounded-lg text-cc-text-main text-sm transition-colors"
          >
            <Calendar size={14} className="inline mr-1" />
            Hoy
          </button>
          <button
            onClick={() => setQuickFilter('last7')}
            className="px-4 py-2 bg-white/5 hover:bg-cc-primary/20 border border-white/10 rounded-lg text-cc-text-main text-sm transition-colors"
          >
            Últimos 7 días
          </button>
          <button
            onClick={() => setQuickFilter('month')}
            className="px-4 py-2 bg-white/5 hover:bg-cc-primary/20 border border-white/10 rounded-lg text-cc-text-main text-sm transition-colors"
          >
            Este mes
          </button>
          <button
            onClick={() => setQuickFilter('clear')}
            className="px-4 py-2 bg-white/5 hover:bg-red-500/20 border border-white/10 rounded-lg text-cc-text-muted text-sm transition-colors"
          >
            Limpiar
          </button>
        </div>
      </div>

      {/* Sales breakdown by origin */}
      {sales.length > 0 && (
        <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
          <h3 className="text-lg font-bold text-cc-cream mb-4">Desglose por origen</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart */}
            <div className="h-64">
              {paymentChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={paymentChartData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {paymentChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => `$${value.toFixed(2)}`}
                      contentStyle={{ backgroundColor: '#2A2A2A', border: '1px solid #444', color: '#F5F5F5' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-cc-text-muted">
                  Sin datos para mostrar
                </div>
              )}
            </div>

            {/* Stats panels */}
            <div className="flex flex-col justify-start gap-3">

              {/* Caja directa */}
              {cajasSales.length > 0 && (
                <div className="bg-black/20 p-4 rounded-lg border border-green-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-green-400">🏪 Caja directa</span>
                    <span className="text-xs text-cc-text-muted">{cajasSales.length} ventas</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-cc-text-muted flex items-center gap-1"><Banknote size={13} className="text-green-400" /> Efectivo</span>
                    <span className="text-cc-cream font-semibold">${cashTotal.toFixed(2)} <span className="text-cc-text-muted font-normal">({cajasSales.filter(s => normalizePaymentMethod(s.payment_method) === 'cash').length})</span></span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-cc-text-muted flex items-center gap-1"><CreditCard size={13} className="text-blue-400" /> Tarjeta</span>
                    <span className="text-cc-cream font-semibold">${cardTotal.toFixed(2)} <span className="text-cc-text-muted font-normal">({cajasSales.filter(s => normalizePaymentMethod(s.payment_method) === 'card').length})</span></span>
                  </div>
                  <div className="flex justify-between text-sm mt-2 pt-2 border-t border-white/10">
                    <span className="text-green-300 font-bold">Total caja</span>
                    <span className="text-green-300 font-bold">${cajaTotal.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Pedidos */}
              {pedidosSales.length > 0 && (
                <div className="bg-black/20 p-4 rounded-lg border border-violet-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-violet-400">📦 Pedidos</span>
                    <span className="text-xs text-cc-text-muted">{pedidosSales.length} pedidos · NO entra a caja</span>
                  </div>
                  {pedidosCash > 0 && (
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-cc-text-muted">Efectivo</span>
                      <span className="text-cc-cream">${pedidosCash.toFixed(2)}</span>
                    </div>
                  )}
                  {pedidosCard > 0 && (
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-cc-text-muted">Tarjeta</span>
                      <span className="text-cc-cream">${pedidosCard.toFixed(2)}</span>
                    </div>
                  )}
                  {pedidosTransfer > 0 && (
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-cc-text-muted flex items-center gap-1"><Landmark size={13} className="text-violet-400" /> Transferencia</span>
                      <span className="text-cc-cream">${pedidosTransfer.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm mt-2 pt-2 border-t border-white/10">
                    <span className="text-violet-300 font-bold">Total pedidos</span>
                    <span className="text-violet-300 font-bold">${pedidosTotal.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Delivery */}
              {deliverySales.length > 0 && (
                <div className="bg-black/20 p-4 rounded-lg border border-orange-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-orange-400 flex items-center gap-1"><Truck size={13} /> Delivery plataformas</span>
                    <span className="text-xs text-cc-text-muted">{deliverySales.length} ventas · NO entra a caja</span>
                  </div>
                  <div className="flex justify-between text-sm mt-2 pt-1">
                    <span className="text-orange-300 font-bold">Total delivery</span>
                    <span className="text-orange-300 font-bold">${deliveryTotal.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Grand total */}
              <div className="bg-cc-primary/10 p-4 rounded-lg border border-cc-primary/20">
                <div className="text-sm text-cc-text-muted mb-1">Total General (todos los orígenes)</div>
                <div className="text-3xl font-bold text-cc-primary">${totalGeneral.toFixed(2)}</div>
                <div className="text-xs text-cc-text-muted mt-1">
                  {sales.filter(s => !s.is_refunded).length} ventas
                  {sales.filter(s => s.is_refunded).length > 0 && (
                    <> · <span className="text-red-400">{sales.filter(s => s.is_refunded).length} devuelta(s)</span></>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-cc-text-muted py-20">
          Cargando ventas...
        </div>
      ) : sales.length === 0 ? (
        <div className="text-center text-cc-text-muted py-20 bg-cc-surface rounded-xl border border-white/5">
          <Receipt size={64} className="mx-auto mb-4 opacity-30" />
          <p className="text-xl">No hay ventas registradas aún</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {sales.map((sale) => (
            <div
              key={sale.id}
              onClick={() => !sale.is_refunded && loadSaleDetails(sale)}
              className={`bg-cc-surface p-5 rounded-xl border transition-all ${
                sale.is_refunded
                  ? 'border-red-500/20 opacity-60 cursor-default'
                  : 'border-white/5 hover:border-cc-primary/30 cursor-pointer hover:shadow-lg group'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
                    sale.is_refunded ? 'bg-red-500/10' : 'bg-cc-primary/10 group-hover:bg-cc-primary/20'
                  }`}>
                    <Receipt size={24} className={sale.is_refunded ? 'text-red-400' : 'text-cc-primary'} />
                  </div>
                  <div>
                    <div className="font-semibold text-cc-text-main mb-1 line-clamp-1 flex items-center gap-2">
                      {buildProductSummary(sale.sale_items)}
                      {sale.is_refunded && (
                        <span className="text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                          DEVUELTO
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-cc-text-muted">
                        #{sale.id.substring(0, 8).toUpperCase()}
                      </span>
                      <span className="text-cc-text-muted text-xs">•</span>
                      <span className="text-xs text-cc-text-muted">
                        {formatDateTimeMX(sale.created_at)}
                      </span>
                      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-white/5">
                        {(() => { const b = getPaymentBadge(sale.payment_method, sale.sale_origin); return <>{b.icon}<span className={b.color}>{b.label}</span></>; })()}
                      </span>
                      {sale.sale_origin === 'delivery' && (
                        <span className="flex items-center gap-1 text-xs font-bold text-orange-300 bg-orange-500/15 border border-orange-500/25 rounded-full px-2 py-0.5">
                          <Truck size={10} />
                          {sale.delivery_platform === 'uber_eats' ? 'Uber Eats' : sale.delivery_platform === 'didi_food' ? 'DiDi Food' : 'Rappi'}
                        </span>
                      )}
                      {sale.is_refunded && sale.refunded_at && (
                        <span className="text-[10px] text-red-400/70">
                          Devuelta {formatDateTimeMX(sale.refunded_at)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className={`text-2xl font-bold ${
                      sale.is_refunded ? 'text-red-400 line-through decoration-red-400/60' : 'text-cc-primary'
                    }`}>
                      ${Number(sale.total).toFixed(2)}
                    </div>
                    <div className="text-xs text-cc-text-muted">
                      {sale.is_refunded ? 'Devuelta' : 'Click para ver detalles'}
                    </div>
                  </div>
                  {!sale.is_refunded && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setRefundTarget(sale); setRefundReason(''); setRefundError(null); }}
                      className="p-2 rounded-lg bg-white/5 border border-white/10 text-cc-text-muted hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition-all"
                      title="Devolver venta"
                    >
                      <RotateCcw size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Samples Section */}
      <div className="bg-cc-surface p-5 rounded-xl border border-yellow-500/20">
        <h3 className="text-lg font-semibold text-yellow-400 mb-4 flex items-center gap-2">
          <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
          Muestras
        </h3>
        
        {loadingSamples ? (
          <div className="text-center text-cc-text-muted py-8">
            Cargando muestras...
          </div>
        ) : samples.length === 0 ? (
          <div className="text-center text-cc-text-muted py-8">
            No se encontraron muestras en el periodo seleccionado
          </div>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {samples.map((sample) => (
              <div
                key={sample.id}
                className="flex items-start justify-between p-4 bg-yellow-500/5 rounded-lg border border-yellow-500/20"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="px-3 py-1 bg-yellow-500/20 border border-yellow-500/40 rounded-md">
                      <span className="text-xs font-bold text-yellow-300">MUESTRA</span>
                    </div>
                    <span className="text-sm text-cc-text-muted">
                      {formatDateTimeMX(sample.created_at)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {sample.quantity && sample.unit && (
                      <div className="text-sm text-yellow-200/90">
                        <span className="font-semibold">Cantidad:</span> {sample.quantity} {sample.unit}
                      </div>
                    )}
                    {sample.notes && (
                      <div className="text-sm text-yellow-200/70">
                        <span className="font-semibold">Nota:</span> {sample.notes}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de Detalles */}
      {selectedSale && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-cc-surface rounded-2xl border border-white/10 max-w-2xl w-full max-h-[80vh] overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="p-6 border-b border-white/10 flex justify-between items-start bg-white/5">
              <div>
                <h3 className="text-2xl font-bold text-cc-cream mb-2">
                  Detalle de Venta
                </h3>
                <div className="flex items-center gap-3 text-sm text-cc-text-muted">
                  <span className="font-mono">#{selectedSale.id.substring(0, 8).toUpperCase()}</span>
                  <span>•</span>
                  <span>{formatDateTimeMX(selectedSale.created_at)}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    {(() => { const b = getPaymentBadge(selectedSale.payment_method, selectedSale.sale_origin); return <>{b.icon}<span className={b.color}>{b.label}</span></>; })()}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedSale(null)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X size={24} className="text-cc-text-muted hover:text-cc-text-main" />
              </button>
            </div>

            {/* Items List */}
            <div className="p-6 overflow-y-auto max-h-[50vh]">
              {loadingItems ? (
                <div className="text-center text-cc-text-muted py-8">
                  Cargando productos...
                </div>
              ) : (
                <div className="space-y-3">
                  {saleItems.map((item) => {
                    const itemTotal = Number(item.price) * Number(item.quantity);
                    const description = buildProductDescription(item.products);
                    return (
                      <div
                        key={item.id}
                        className="p-4 bg-black/20 rounded-lg border border-white/5 space-y-3"
                      >
                        {/* Product name + description */}
                        <div>
                          <div className="font-semibold text-cc-text-main">
                            {item.products?.name || item.product_name || 'Producto genérico'}
                          </div>
                          {description && (
                            <div className="text-xs text-cc-text-muted mt-0.5">
                              {description}
                            </div>
                          )}
                        </div>
                        {/* Quantity / Price / Subtotal row */}
                        <div className="flex items-center gap-6 text-sm">
                          <div className="text-center">
                            <div className="text-cc-text-muted text-xs">Cantidad</div>
                            <div className="font-bold text-cc-text-main">{item.quantity}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-cc-text-muted text-xs">Precio Unit.</div>
                            <div className="font-bold text-cc-text-main">${Number(item.price).toFixed(2)}</div>
                          </div>
                          <div className="ml-auto text-center">
                            <div className="text-cc-text-muted text-xs">Subtotal</div>
                            <div className="font-bold text-cc-primary">${itemTotal.toFixed(2)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer - Total */}
            <div className="p-6 border-t border-white/10 bg-black/20">
              <div className="flex justify-between items-center">
                <span className="text-lg font-medium text-cc-text-muted">Total de la Venta</span>
                <span className={`text-3xl font-bold ${selectedSale.is_refunded ? 'text-red-400 line-through' : 'text-cc-primary'}`}>
                  ${Number(selectedSale.total).toFixed(2)}
                </span>
              </div>
              {selectedSale.is_refunded && (
                <div className="mt-3 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <RotateCcw size={14} className="text-red-400 shrink-0" />
                  <span className="text-sm text-red-300 font-medium">DEVUELTO</span>
                  {selectedSale.refunded_at && <span className="text-xs text-red-400/70 ml-1">{formatDateTimeMX(selectedSale.refunded_at)}</span>}
                  {selectedSale.refund_reason && <span className="text-xs text-red-400/70 ml-1">— {selectedSale.refund_reason}</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Refund confirm modal ── */}
      {refundTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75">
          <div className="bg-[#1a1a2e] border border-red-500/20 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
              <AlertTriangle size={18} className="text-red-400 shrink-0" />
              <h2 className="font-bold text-cc-cream text-base">Devolver venta</h2>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 space-y-1">
                <p className="text-xs text-cc-text-muted">Ticket</p>
                <p className="font-mono text-sm font-bold text-cc-cream">#{refundTarget.id.substring(0, 8).toUpperCase()}</p>
                <p className="text-xs text-cc-text-muted">{formatDateTimeMX(refundTarget.created_at)}</p>
                <p className="text-cc-primary font-bold">${Number(refundTarget.total).toFixed(2)}</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-cc-text-muted uppercase tracking-wide mb-1.5">
                  Motivo (opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ej: Venta duplicada, error de cobro…"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-cc-cream placeholder-gray-500 focus:ring-2 focus:ring-red-400/40 focus:border-red-400/40 outline-none"
                />
              </div>
              <p className="text-xs text-cc-text-muted leading-relaxed">
                La venta quedará marcada como <span className="text-red-400 font-semibold">DEVUELTA</span> y no afectará métricas ni totales. El registro <strong>no se elimina</strong>.
              </p>
              {refundError && (
                <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{refundError}</p>
              )}
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={() => { setRefundTarget(null); setRefundReason(''); setRefundError(null); }}
                className="flex-1 py-2.5 rounded-xl border border-white/10 bg-white/5 text-cc-text-muted text-sm font-semibold hover:bg-white/10 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleRefund}
                disabled={refundLoading}
                className="flex-1 py-2.5 rounded-xl bg-red-500/80 text-white text-sm font-bold hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {refundLoading ? 'Procesando…' : 'Confirmar devolución'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
