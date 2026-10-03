import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { Receipt, X, CreditCard, Banknote, Landmark, Download, Calendar, Filter, RotateCcw, AlertTriangle, Truck, Printer } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { addCalendarDays, formatDateTimeMX, getMexicoCityDateKey, mexicoCityDateStartISO } from '../lib/datetime';
import { getCommercialCollections, CommercialCollectionItem } from '../services/commercialCollectionsService';
import { useAuth } from '../contexts/AuthContext';
import { useBranch } from '../contexts/BranchContext';
import { printSaleReceipt } from '../lib/printReceipt';
import type { ReceiptData } from '../components/TicketReceipt';

interface SaleItemPreview {
  sale_id: string;
  quantity: number;
  product_name?: string | null;
  products: { name: string } | null;
}

interface Sale {
  id: string;
  total: number;
  payment_method: string;
  cash_amount: number | null;
  card_amount: number | null;
  transfer_amount: number | null;
  created_at: string;
  branch_id: string | null;
  branch_name: string | null;
  is_refunded?: boolean;
  refunded_at?: string | null;
  refund_reason?: string | null;
  sale_origin?: string;
  delivery_platform?: string | null;
  promotion_code?: string | null;
  customer_id?: string | null;
  sale_items?: SaleItemPreview[];
}

interface ComboComponentSnapshot {
  component_name: string;
  quantity_total: number;
}

interface SaleItem {
  id: string;
  product_id: string | null;
  product_name?: string | null;
  quantity: number;
  price: number;
  discount_amount: number;
  discount_reason: string | null;
  combo_components: ComboComponentSnapshot[];
  products: {
    name: string;
    product_name: string | null;
    size: string;
    flavor: string | null;
    grams: number | null;
    price: number | null;
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
  const { isAdmin, profile } = useAuth();
  const { branches, loading: branchesLoading, error: branchContextError } = useBranch();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState('all');
  const [hasLegacySales, setHasLegacySales] = useState(false);
  const [branchOptionsError, setBranchOptionsError] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [reprintLoading, setReprintLoading] = useState(false);
  const [reprintError, setReprintError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loadingSamples, setLoadingSamples] = useState(true);
  const [samplesError, setSamplesError] = useState<string | null>(null);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  // Commercial collections (Socios Comerciales)
  const [comercialCollections, setComercialCollections] = useState<{
    total: number;
    comodato: number;
    mayoreo: number;
    pieceSale: number;
    cash: number;
    transfer: number;
    breakdown: CommercialCollectionItem[];
  }>({
    total: 0,
    comodato: 0,
    mayoreo: 0,
    pieceSale: 0,
    cash: 0,
    transfer: 0,
    breakdown: []
  });
  

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

  const formatSupabaseError = (error: unknown, fallback: string): string => {
    if (!error || typeof error !== 'object') return fallback;
    const value = error as { message?: string; details?: string; hint?: string; code?: string };
    return [value.message, value.details, value.hint, value.code]
      .filter((part): part is string => Boolean(part))
      .join(' · ') || fallback;
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
    if (!isAdmin || !refundTarget || !supabase) return;
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
    } catch (err: unknown) {
      console.error('[SalesHistory] Error completo de Supabase al procesar la devolución:', err);
      setRefundError(formatSupabaseError(err, 'Error al procesar la devolución'));
    } finally {
      setRefundLoading(false);
    }
  };

  const buildDateRange = (fromDateStr: string, toDateStr: string) => {
    const effectiveFrom = fromDateStr;
    let effectiveTo = toDateStr;
    if (fromDateStr && !toDateStr) {
      effectiveTo = fromDateStr;
    }
    if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
      throw new Error('La fecha “Desde” no puede ser posterior a “Hasta”.');
    }
    return {
      startISO: effectiveFrom ? mexicoCityDateStartISO(effectiveFrom) : null,
      endISO: effectiveTo ? mexicoCityDateStartISO(addCalendarDays(effectiveTo, 1)) : null,
      effectiveFrom,
      effectiveTo,
    };
  };

  const loadSales = async () => {
    setLoading(true);
    setSalesError(null);
    try {
      if (!supabase) throw new Error('Supabase no está configurado.');
      if (!profile?.is_active) throw new Error('El perfil no está activo.');
      if (!isAdmin && branches.length === 0) {
        throw new Error('No tienes sucursales autorizadas para consultar el historial.');
      }

      let query = supabase
        .from('v_sales_history')
        .select('id, total, payment_method, cash_amount, card_amount, transfer_amount, created_at, branch_id, branch_name, is_refunded, refunded_at, refund_reason, sale_origin, delivery_platform, promotion_code, customer_id')
        .order('created_at', { ascending: false });

      if (fromDate || toDate) {
        const { startISO, endISO } = buildDateRange(fromDate, toDate);
        if (startISO) query = query.gte('created_at', startISO);
        if (endISO) query = query.lt('created_at', endISO);
      }

      if (isAdmin) {
        if (branchFilter === 'legacy') query = query.is('branch_id', null);
        else if (branchFilter !== 'all') {
          if (!branches.some(branch => branch.id === branchFilter)) {
            throw new Error('La sucursal seleccionada no pertenece al catálogo autorizado.');
          }
          query = query.eq('branch_id', branchFilter);
        }
      } else {
        query = query.in('branch_id', branches.map(branch => branch.id));
      }

      const { data, error } = await query;
      if (error) throw error;

      const baseSales = (data || []) as any[];
      const previewsBySale = new Map<string, SaleItemPreview[]>();
      const saleIds = baseSales.map(sale => sale.id);
      for (let offset = 0; offset < saleIds.length; offset += 100) {
        const ids = saleIds.slice(offset, offset + 100);
        const { data: itemData, error: itemError } = await supabase
          .from('sale_items')
          .select('sale_id, quantity, product_name, products!sale_items_product_id_fkey(name)')
          .in('sale_id', ids);
        if (itemError) throw itemError;
        for (const item of itemData || []) {
          const product = Array.isArray(item.products) ? item.products[0] || null : item.products || null;
          const preview: SaleItemPreview = {
            sale_id: item.sale_id,
            quantity: item.quantity,
            product_name: item.product_name || null,
            products: product,
          };
          previewsBySale.set(item.sale_id, [...(previewsBySale.get(item.sale_id) || []), preview]);
        }
      }

      const salesData: Sale[] = baseSales.map((s: any) => ({
        id: s.id,
        total: Number(s.total || 0),
        payment_method: s.payment_method,
        cash_amount: s.cash_amount == null ? null : Number(s.cash_amount),
        card_amount: s.card_amount == null ? null : Number(s.card_amount),
        transfer_amount: s.transfer_amount == null ? null : Number(s.transfer_amount),
        created_at: s.created_at,
        branch_id: s.branch_id ?? null,
        branch_name: s.branch_name ?? null,
        is_refunded: s.is_refunded ?? false,
        refunded_at: s.refunded_at ?? null,
        refund_reason: s.refund_reason ?? null,
        sale_origin: s.sale_origin
          ?? (s.promotion_code === 'ORDER_CHECKOUT' ? 'order' : 'pos'),
        delivery_platform: s.delivery_platform ?? null,
        promotion_code: s.promotion_code ?? null,
        customer_id: s.customer_id ?? null,
        sale_items: previewsBySale.get(s.id) || [],
      }));
      setSales(salesData);
    } catch (error: unknown) {
      console.error('[SalesHistory] Error completo de Supabase al cargar ventas:', error);
      setSales([]);
      setSalesError(formatSupabaseError(error, 'No se pudo cargar el historial de ventas.'));
    } finally {
      setLoading(false);
    }
  };

  const loadSamples = async () => {
    setLoadingSamples(true);
    setSamplesError(null);
    try {
      if (!supabase) throw new Error('Supabase no está configurado.');
      
      let query = supabase
        .from('waste_events')
        .select('id, created_at, batch_id, quantity, unit, notes')
        .eq('type', 'PRODUCT')
        .eq('reason', 'MUESTRA')
        .order('created_at', { ascending: false });

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
      setSamples(data || []);
    } catch (error: unknown) {
      console.error('[SalesHistory] Error completo de Supabase al cargar muestras:', error);
      setSamples([]);
      setSamplesError(formatSupabaseError(error, 'No se pudieron cargar las muestras.'));
    } finally {
      setLoadingSamples(false);
    }
  };

  const loadSaleDetails = async (sale: Sale) => {
    setSelectedSale(sale);
    setLoadingItems(true);
    setItemsError(null);
    setReprintError(null);
    setSaleItems([]);
    try {
      if (!supabase) throw new Error('Supabase no está configurado.');
      
      const { data, error } = await supabase
        .from('sale_items')
        .select(`
          id,
          product_id,
          product_name,
          quantity,
          price,
          discount_amount,
          discount_reason,
          products!sale_items_product_id_fkey (
            name,
            product_name,
            size,
            flavor,
            grams,
            price
          )
        `)
        .eq('sale_id', sale.id);

      if (error) throw error;

      const itemIds = (data || []).map((item: any) => item.id);
      const { data: comboData, error: comboError } = itemIds.length > 0
        ? await supabase
          .from('sale_item_combo_components')
          .select('sale_item_id, component_name, quantity_total')
          .in('sale_item_id', itemIds)
        : { data: [], error: null };
      if (comboError) throw comboError;
      
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
          price: Number(item.price || 0),
          discount_amount: Number(item.discount_amount || 0),
          discount_reason: item.discount_reason || null,
          combo_components: (comboData || [])
            .filter((component: any) => component.sale_item_id === item.id)
            .map((component: any) => ({
              component_name: component.component_name,
              quantity_total: component.quantity_total,
            })),
          products: raw ? {
            name: raw.name || '',
            product_name: raw.product_name || null,
            size: raw.size || '',
            flavor: raw.flavor || null,
            grams: raw.grams || null,
            price: raw.price == null ? null : Number(raw.price),
          } : null
        };
      });
      
      setSaleItems(items);
    } catch (error: unknown) {
      console.error('[SalesHistory] Error completo de Supabase al cargar el detalle:', error);
      setItemsError(formatSupabaseError(error, 'No se pudo cargar el detalle de la venta.'));
    } finally {
      setLoadingItems(false);
    }
  };

  const loadCommercialCollections = async () => {
    setCollectionsError(null);
    if (!isAdmin || branchFilter !== 'all' || !fromDate || !toDate) {
      setComercialCollections({ total: 0, comodato: 0, mayoreo: 0, pieceSale: 0, cash: 0, transfer: 0, breakdown: [] });
      return;
    }
    try {
      const { effectiveFrom, effectiveTo } = buildDateRange(fromDate, toDate);
      const startKey = effectiveFrom || effectiveTo;
      if (!startKey || !effectiveTo) return;
      const asUtcCalendarDate = (dateKey: string) => {
        const [year, month, day] = dateKey.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day));
      };
      const collections = await getCommercialCollections(
        asUtcCalendarDate(startKey),
        asUtcCalendarDate(addCalendarDays(effectiveTo, 1)),
      );
      if (collections.error) throw new Error(collections.error);
      setComercialCollections({
        total: collections.total,
        comodato: collections.bySource.comodato,
        mayoreo: collections.bySource.mayoreo,
        pieceSale: collections.bySource.pieceSale,
        cash: collections.cash,
        transfer: collections.transfer,
        breakdown: collections.breakdown || [],
      });
    } catch (error: unknown) {
      console.error('[SalesHistory] Error al cargar cobros comerciales:', error);
      setCollectionsError(formatSupabaseError(error, 'No se pudieron cargar los cobros comerciales.'));
      setComercialCollections({ total: 0, comodato: 0, mayoreo: 0, pieceSale: 0, cash: 0, transfer: 0, breakdown: [] });
    }
  };

  useEffect(() => {
    if (branchesLoading || !profile) return;
    void loadSales();
  }, [branchFilter, branchesLoading, branches, fromDate, isAdmin, profile, toDate]);

  useEffect(() => {
    void loadSamples();
    void loadCommercialCollections();
  }, [branchFilter, fromDate, isAdmin, toDate]);

  useEffect(() => {
    if (!isAdmin || !supabase) {
      setHasLegacySales(false);
      setBranchOptionsError(null);
      return;
    }
    void supabase
      .from('sales')
      .select('id', { count: 'exact', head: true })
      .is('branch_id', null)
      .then(({ count, error }) => {
        if (error) {
          console.error('[SalesHistory] Error al comprobar ventas históricas sin sucursal:', error);
          setBranchOptionsError(formatSupabaseError(error, 'No se pudo comprobar si hay ventas sin sucursal.'));
        } else {
          setBranchOptionsError(null);
        }
        setHasLegacySales(!error && (count || 0) > 0);
      });
  }, [isAdmin]);

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
    const todayLocal = getMexicoCityDateKey();

    switch (filter) {
      case 'today':
        setFromDate(todayLocal);
        setToDate(todayLocal);
        break;
      case 'last7':
        setFromDate(addCalendarDays(todayLocal, -6));
        setToDate(todayLocal);
        break;
      case 'month':
        setFromDate(`${todayLocal.slice(0, 7)}-01`);
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

    const headers = ['Sucursal', 'Origen', 'Fecha', 'Hora', 'Folio', 'Descripción', 'Método de Pago', 'Monto', 'Estado'];
    const posSalesRows = sales.map(sale => {
      const origin = sale.sale_origin === 'order' ? 'Pedido' : 
                     sale.sale_origin === 'delivery' ? `Delivery (${sale.delivery_platform || 'otra'})` : 
                     'Caja Directa';
      const [date, time] = formatDateTimeMX(sale.created_at).split(' ');
      return [
        sale.branch_name || 'Histórica / sin sucursal',
        origin,
        date,
        time || '',
        sale.id.substring(0, 8).toUpperCase(),
        buildProductSummary(sale.sale_items),
        getPaymentLabel(sale.payment_method),
        `$${Number(sale.total || 0).toFixed(2)}`,
        sale.is_refunded ? 'Devuelto' : 'Completado'
      ];
    });

    const csvContent = [
      headers.join(','),
      ...posSalesRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `historial_ventas_${getMexicoCityDateKey()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const summary = useMemo(() => {
    const result = {
      grossTotal: 0,
      refundedTotal: 0,
      netTotal: 0,
      posCashTotal: 0,
      posCardTotal: 0,
      posTransferTotal: 0,
      orderCashTotal: 0,
      orderCardTotal: 0,
      orderTransferTotal: 0,
      deliveryTotal: 0,
      totalsByOrigin: {
        pos: { count: 0 },
        order: { count: 0 },
        delivery_platform: { count: 0 },
      },
    };
    for (const sale of sales) {
      const total = Number(sale.total || 0);
      result.grossTotal += total;
      if (sale.is_refunded) {
        result.refundedTotal += total;
        continue;
      }
      result.netTotal += total;
      const method = normalizePaymentMethod(sale.payment_method);
      const origin = sale.sale_origin === 'delivery'
        ? 'delivery'
        : sale.sale_origin === 'order' || sale.promotion_code === 'ORDER_CHECKOUT'
          ? 'order'
          : 'pos';
      if (origin === 'delivery') {
        result.deliveryTotal += total;
        result.totalsByOrigin.delivery_platform.count += 1;
      } else if (origin === 'order') {
        result.totalsByOrigin.order.count += 1;
        if (method === 'cash') result.orderCashTotal += total;
        if (method === 'card') result.orderCardTotal += total;
        if (method === 'transfer') result.orderTransferTotal += total;
      } else {
        result.totalsByOrigin.pos.count += 1;
        if (method === 'cash') result.posCashTotal += total;
        else if (method === 'card') result.posCardTotal += total;
        else if (method === 'transfer') result.posTransferTotal += total;
        else {
          result.posCashTotal += Number(sale.cash_amount || 0);
          result.posCardTotal += Number(sale.card_amount || 0);
        }
      }
    }
    return result;
  }, [sales]);

  const {
    grossTotal,
    refundedTotal,
    netTotal,
    posCashTotal,
    posCardTotal,
    posTransferTotal,
    orderCashTotal,
    orderCardTotal,
    orderTransferTotal,
    deliveryTotal,
    totalsByOrigin,
  } = summary;

  const cajaTotal = posCashTotal + posCardTotal + posTransferTotal;
  const pedidosTotal = orderCashTotal + orderCardTotal + orderTransferTotal;
  const deliveryTotalRPC = deliveryTotal;
  const paymentChartData = [
    { name: 'Caja Efectivo',    value: posCashTotal,        color: '#4CAF50' },
    { name: 'Caja Tarjeta',     value: posCardTotal,        color: '#2196F3' },
    { name: 'Caja Transf.',     value: posTransferTotal,    color: '#7C3AED' },
    { name: 'Pedidos Efectivo', value: orderCashTotal,      color: '#F59E0B' },
    { name: 'Pedidos Tarjeta',  value: orderCardTotal,      color: '#06B6D4' },
    { name: 'Pedidos Transf.',  value: orderTransferTotal,  color: '#8B5CF6' },
    { name: 'Delivery',         value: deliveryTotalRPC,    color: '#FF6900' },
    { name: 'Socios Comerciales', value: comercialCollections.total, color: '#EC4899' },
  ].filter(item => item.value > 0);

  const reprintSelectedSale = async () => {
    if (!selectedSale || saleItems.length === 0) return;
    setReprintLoading(true);
    setReprintError(null);
    try {
      const items = saleItems.map(item => {
        const quantity = Number(item.quantity || 1);
        const discount = Number(item.discount_amount || 0);
        const storedPrice = Number(item.price || 0);
        const catalogPrice = Number(item.products?.price || 0);
        const unitPrice = discount > 0 && quantity > 0
          ? Math.round((storedPrice + discount / quantity) * 100) / 100
          : catalogPrice > storedPrice ? catalogPrice : storedPrice;
        return {
          name: item.products?.product_name || item.products?.name || item.product_name || 'Producto genérico',
          size: item.products?.size || '',
          quantity,
          unitPrice,
          lineTotal: unitPrice * quantity,
          discount,
          discountReason: item.discount_reason || undefined,
          components: item.combo_components.map(component => ({
            name: component.component_name,
            quantity: component.quantity_total,
          })),
        };
      });
      const rawMethod = String(selectedSale.payment_method || '').toUpperCase();
      const method: ReceiptData['method'] = selectedSale.sale_origin === 'delivery'
        ? 'PLATFORM'
        : ['CASH', 'CARD', 'MIXED', 'TRANSFER', 'PLATFORM'].includes(rawMethod)
          ? rawMethod as ReceiptData['method']
          : 'CASH';
      const cashAmount = method === 'CASH'
        ? Number(selectedSale.cash_amount ?? selectedSale.total)
        : Number(selectedSale.cash_amount || 0);
      const cardAmount = method === 'CARD'
        ? Number(selectedSale.card_amount ?? selectedSale.total)
        : Number(selectedSale.card_amount || 0);
      await printSaleReceipt({
        saleId: selectedSale.id,
        date: new Date(selectedSale.created_at),
        items,
        subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
        totalDiscount: items.reduce((sum, item) => sum + item.discount, 0),
        total: Number(selectedSale.total),
        method,
        cashAmount,
        cardAmount,
        changeAmount: method === 'CASH' ? Math.max(0, cashAmount - Number(selectedSale.total)) : 0,
      });
    } catch (error: unknown) {
      console.error('[SalesHistory] Error al reimprimir la venta:', error);
      setReprintError(formatSupabaseError(error, 'No se pudo reimprimir la venta.'));
    } finally {
      setReprintLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold text-cc-cream flex items-center gap-3">
          <Receipt size={32} className="text-cc-primary" />
          Historial de Ventas
        </h2>
        <button
          onClick={exportToCSV}
          disabled={loading || Boolean(salesError) || sales.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-cc-primary text-cc-bg rounded-lg hover:bg-cc-primary/90 transition-colors font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download size={18} />
          Exportar CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-cc-surface p-5 rounded-xl border border-white/5">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={20} className="text-cc-primary" />
          <h3 className="text-lg font-semibold text-cc-cream">Filtros</h3>
        </div>
        
        <div className={`grid grid-cols-1 ${isAdmin ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-4 mb-4`}>
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
          {isAdmin && (
            <div>
              <label className="block text-sm text-cc-text-muted mb-2">Sucursal</label>
              <select
                value={branchFilter}
                onChange={(event) => setBranchFilter(event.target.value)}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 text-cc-text-main focus:ring-2 focus:ring-cc-primary outline-none"
              >
                <option value="all">Todas las sucursales</option>
                {branches.map(branch => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
                {hasLegacySales && <option value="legacy">Históricas / sin sucursal</option>}
              </select>
            </div>
          )}
        </div>

        {!isAdmin && (
          <p className="mb-4 text-xs text-cc-text-muted">
            Sucursales autorizadas: {branches.map(branch => branch.name).join(', ') || 'ninguna'}
          </p>
        )}

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

      {salesError && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">No se pudo cargar el historial de ventas</p>
              <p className="mt-1 break-words text-sm">{salesError}</p>
            </div>
          </div>
        </div>
      )}

      {(branchContextError || branchOptionsError) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" role="alert">
          Sucursales: {branchOptionsError || branchContextError}
        </div>
      )}

      {collectionsError && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" role="alert">
          Cobros comerciales: {collectionsError}
        </div>
      )}

      {/* Sales breakdown by origin */}
      {(sales.length > 0 || comercialCollections.total > 0) && (
        <div className="bg-cc-surface p-6 rounded-xl border border-white/5">
          <h3 className="text-lg font-bold text-cc-cream mb-1">Desglose Financiero - Todos los Orígenes</h3>
          <p className="text-xs text-cc-text-muted mb-4">Resumen de ingresos separados por origen y método de pago</p>
          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6">
            {/* Chart */}
            <div className="w-full h-[460px]">
              {paymentChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={paymentChartData}
                    margin={{ top: 20, right: 20, left: 60, bottom: 80 }}
                    barSize={45}
                    barCategoryGap="22%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} />
                    <XAxis
                      dataKey="name"
                      angle={-30}
                      textAnchor="end"
                      height={70}
                      tick={{ fill: '#CCCCCC', fontSize: 11 }}
                    />
                    <YAxis
                      width={60}
                      tick={{ fill: '#CCCCCC', fontSize: 11 }}
                      tickFormatter={(value: number) => `$${(value / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={(value: number) => `$${value.toFixed(2)}`}
                      contentStyle={{ backgroundColor: '#2A2A2A', border: '1px solid #444', color: '#F5F5F5' }}
                    />
                    <Bar
                      dataKey="value"
                      radius={[8, 8, 0, 0]}
                    >
                      {paymentChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-cc-text-muted">
                  Sin datos para mostrar
                </div>
              )}
            </div>

            {/* Stats panels */}
            <div className="flex flex-col justify-start gap-3">

              {/* Caja directa from the exact visible sales set */}
              {(totalsByOrigin['pos']?.count || 0) > 0 && (
                <div className="bg-black/20 p-4 rounded-lg border border-green-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-green-400">🏪 Caja directa</span>
                    <span className="text-xs text-cc-text-muted">{totalsByOrigin['pos']?.count || 0} ventas</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-cc-text-muted flex items-center gap-1"><Banknote size={13} className="text-green-400" /> Efectivo</span>
                    <span className="text-cc-cream font-semibold">${posCashTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-cc-text-muted flex items-center gap-1"><CreditCard size={13} className="text-blue-400" /> Tarjeta</span>
                    <span className="text-cc-cream font-semibold">${posCardTotal.toFixed(2)}</span>
                  </div>
                  {posTransferTotal > 0 && (
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-cc-text-muted flex items-center gap-1"><Landmark size={13} className="text-violet-400" /> Transferencia</span>
                      <span className="text-cc-cream font-semibold">${posTransferTotal.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm mt-2 pt-2 border-t border-white/10">
                    <span className="text-green-300 font-bold">Total caja</span>
                    <span className="text-green-300 font-bold">${cajaTotal.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Pedidos from the exact visible sales set */}
              {(totalsByOrigin['order']?.count || 0) > 0 && (
                <div className="bg-black/20 p-4 rounded-lg border border-violet-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-violet-400">📦 Pedidos</span>
                    <span className="text-xs text-cc-text-muted">{totalsByOrigin['order']?.count || 0} pedidos · NO entra a caja</span>
                  </div>
                  {orderCashTotal > 0 && (
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-cc-text-muted">Efectivo</span>
                      <span className="text-cc-cream">${orderCashTotal.toFixed(2)}</span>
                    </div>
                  )}
                  {orderCardTotal > 0 && (
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-cc-text-muted">Tarjeta</span>
                      <span className="text-cc-cream">${orderCardTotal.toFixed(2)}</span>
                    </div>
                  )}
                  {orderTransferTotal > 0 && (
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-cc-text-muted flex items-center gap-1"><Landmark size={13} className="text-violet-400" /> Transferencia</span>
                      <span className="text-cc-cream">${orderTransferTotal.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm mt-2 pt-2 border-t border-white/10">
                    <span className="text-violet-300 font-bold">Total pedidos</span>
                    <span className="text-violet-300 font-bold">${pedidosTotal.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Delivery from the exact visible sales set */}
              {(totalsByOrigin['delivery_platform']?.count || 0) > 0 && (
                <div className="bg-black/20 p-4 rounded-lg border border-orange-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-orange-400 flex items-center gap-1"><Truck size={13} /> Delivery plataformas</span>
                    <span className="text-xs text-cc-text-muted">{totalsByOrigin['delivery_platform']?.count || 0} ventas · NO entra a caja</span>
                  </div>
                  <div className="flex justify-between text-sm mt-2 pt-1">
                    <span className="text-orange-300 font-bold">Total delivery</span>
                    <span className="text-orange-300 font-bold">${deliveryTotal.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Socios Comerciales (Commercial Collections) */}
              {comercialCollections.total > 0 && (
                <div className="bg-black/20 p-4 rounded-lg border border-pink-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-pink-400">🤝 Socios Comerciales</span>
                    <span className="text-xs text-cc-text-muted">Cobros realizados</span>
                  </div>
                  {comercialCollections.comodato > 0 && (
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-cc-text-muted">Comodato</span>
                      <span className="text-cc-cream">${comercialCollections.comodato.toFixed(2)}</span>
                    </div>
                  )}
                  {comercialCollections.mayoreo > 0 && (
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-cc-text-muted">Mayoreo</span>
                      <span className="text-cc-cream">${comercialCollections.mayoreo.toFixed(2)}</span>
                    </div>
                  )}
                  {comercialCollections.pieceSale > 0 && (
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-cc-text-muted">Venta Pieza</span>
                      <span className="text-cc-cream">${comercialCollections.pieceSale.toFixed(2)}</span>
                    </div>
                  )}
                  {comercialCollections.cash > 0 && (
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-cc-text-muted flex items-center gap-1"><Banknote size={13} className="text-pink-400" /> Efectivo</span>
                      <span className="text-cc-cream">${comercialCollections.cash.toFixed(2)}</span>
                    </div>
                  )}
                  {comercialCollections.transfer > 0 && (
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-cc-text-muted flex items-center gap-1"><Landmark size={13} className="text-pink-400" /> Transferencia</span>
                      <span className="text-cc-cream">${comercialCollections.transfer.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm mt-2 pt-2 border-t border-white/10">
                    <span className="text-pink-300 font-bold">Total socios</span>
                    <span className="text-pink-300 font-bold">${comercialCollections.total.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Grand total from visible sales plus separately labeled commercial collections */}
              <div className="bg-cc-primary/10 p-4 rounded-lg border border-cc-primary/20">
                <div className="text-sm text-cc-text-muted mb-1">Total General histórico</div>
                <div className="text-3xl font-bold text-cc-primary">${(netTotal + comercialCollections.total).toFixed(2)}</div>
                <div className="text-sm text-cc-text-muted mt-2 space-y-1">
                  <div>POS (Bruto): <span className="font-semibold text-cc-cream">${grossTotal.toFixed(2)}</span></div>
                  <div>POS (Devoluciones): <span className="font-semibold text-red-400">-${refundedTotal.toFixed(2)}</span></div>
                  <div>Socios Comerciales: <span className="font-semibold text-pink-300">${comercialCollections.total.toFixed(2)}</span></div>
                  <div className="text-cc-primary font-bold mt-2">TOTAL: ${(netTotal + comercialCollections.total).toFixed(2)}</div>
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
      ) : salesError ? null : sales.length === 0 ? (
        <div className="text-center text-cc-text-muted py-20 bg-cc-surface rounded-xl border border-white/5">
          <Receipt size={64} className="mx-auto mb-4 opacity-30" />
          <p className="text-xl">No hay ventas para los filtros seleccionados</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {sales.map(sale => (
            <div
              key={sale.id}
              onClick={() => loadSaleDetails(sale)}
              className={`bg-cc-surface p-5 rounded-xl border transition-all ${
                sale.is_refunded
                  ? 'border-red-500/20 opacity-75 cursor-pointer'
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
                          <span className="mt-1 inline-flex rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-cc-text-muted">
                            {sale.branch_id && sale.branch_name ? sale.branch_name : 'Histórica / sin sucursal'}
                          </span>
                        </div>
                        {isAdmin && !sale.is_refunded && (
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
        ) : samplesError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" role="alert">
            {samplesError}
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
              ) : itemsError ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" role="alert">
                  {itemsError}
                </div>
              ) : saleItems.length === 0 ? (
                <div className="text-center text-cc-text-muted py-8">La venta no tiene partidas registradas.</div>
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
                            {item.products?.product_name || item.products?.name || item.product_name || 'Producto genérico'}
                          </div>
                          {description && (
                            <div className="text-xs text-cc-text-muted mt-0.5">
                              {description}
                            </div>
                          )}
                          {item.combo_components.length > 0 && (
                            <div className="mt-2 space-y-1 rounded-md border border-cc-primary/15 bg-cc-primary/5 p-2">
                              {item.combo_components.map((component, index) => (
                                <div key={`${component.component_name}-${index}`} className="text-xs text-cc-text-muted">
                                  + {component.quantity_total} × {component.component_name}
                                </div>
                              ))}
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
                        {item.discount_amount > 0 && (
                          <div className="text-xs text-emerald-300">
                            Descuento: -${item.discount_amount.toFixed(2)}
                            {item.discount_reason ? ` · ${item.discount_reason}` : ''}
                          </div>
                        )}
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
              {reprintError && (
                <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
                  {reprintError}
                </div>
              )}
              <button
                type="button"
                onClick={() => void reprintSelectedSale()}
                disabled={loadingItems || Boolean(itemsError) || saleItems.length === 0 || reprintLoading}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-cc-primary/30 bg-cc-primary/10 px-4 py-2.5 font-semibold text-cc-primary transition-colors hover:bg-cc-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Printer size={17} />
                {reprintLoading ? 'Reimprimiendo…' : 'Reimprimir ticket'}
              </button>
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
