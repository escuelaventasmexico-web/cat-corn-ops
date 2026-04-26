import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ClipboardList,
  Plus,
  Phone,
  User,
  CalendarDays,
  Package,
  Hash,
  StickyNote,
  Loader2,
  CheckCircle2,
  Clock,
  ChefHat,
  Truck,
  XCircle,
  Search,
  X,
  Banknote,
  CreditCard,
  ShoppingCart,
  Trash2,
  TrendingUp,
  Popcorn,
  Download,
  Landmark,
  Tag,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { supabase } from '../supabase';
import type { Product } from '../supabase';
// getOpenSessionId removed: pedido checkouts no longer link to the cash register session.
import { printOrderLabel } from '../lib/printReceipt';

/* ── Types ──────────────────────────────────────────────────────────────── */

type ProductType = 'Salada' | 'Sabores' | 'Caramelo';
type OrderStatus = 'pending' | 'prepared' | 'delivered' | 'cancelled';

interface Order {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  delivery_date: string;
  product_type: ProductType;
  product_id: string | null;
  quantity: number;
  notes: string | null;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
  label_printed?: boolean;
  /* joined */
  products?: { name: string; price: number } | null;
}

interface OrdersSummary {
  totalOrders: number;
  totalPieces: number;
  bySalada: number;
  bySabores: number;
  byCaramelo: number;
  tomorrowOrders: number;
  tomorrowPieces: number;
}

const STATUS_CFG: Record<OrderStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  pending:   { label: 'Pendiente',  color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30', icon: Clock },
  prepared:  { label: 'Preparado',  color: 'text-blue-400',   bg: 'bg-blue-500/15 border-blue-500/30',     icon: ChefHat },
  delivered: { label: 'Entregado',  color: 'text-green-400',  bg: 'bg-green-500/15 border-green-500/30',   icon: Truck },
  cancelled: { label: 'Cancelado',  color: 'text-red-400',    bg: 'bg-red-500/15 border-red-500/30',       icon: XCircle },
};

const ALL_STATUSES: OrderStatus[] = ['pending', 'prepared', 'delivered', 'cancelled'];
const PRODUCT_TYPES: ProductType[] = ['Salada', 'Sabores', 'Caramelo'];

/* ── Helpers ────────────────────────────────────────────────────────────── */

const todayISO = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const tomorrowISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const fmtDateShort = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/* ── Component ──────────────────────────────────────────────────────────── */

export const Pedidos = () => {
  /* ── Products ── */
  const [products, setProducts] = useState<Product[]>([]);

  /* ── Orders ── */
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>('');

  /* ── Summary ── */
  const [summary, setSummary] = useState<OrdersSummary | null>(null);

  /* ── Form state ── */
  const [formCustomerName, setFormCustomerName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formDeliveryDate, setFormDeliveryDate] = useState('');
  const [formProductType, setFormProductType] = useState<ProductType | ''>('');
  const [formProductId, setFormProductId] = useState('');
  const [formQuantity, setFormQuantity] = useState<number | ''>('');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  /* ── Status update loading ── */
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  /* ── Checkout modal ── */
  const [orderToCheckout, setOrderToCheckout] = useState<Order | null>(null);
  const [checkoutPaymentMethod, setCheckoutPaymentMethod] = useState<'CASH' | 'CARD' | 'TRANSFER'>('CASH');
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  /* ── Delete modal ── */
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  /* ── Filtered products for the form ── */
  const filteredProducts = useMemo(
    () =>
      formProductType
        ? products.filter(
            (p) =>
              (p.flavor ?? p.category ?? '').toLowerCase() === formProductType.toLowerCase(),
          )
        : [],
    [products, formProductType],
  );

  /* ── Load products once ── */
  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('products')
      .select('*')
      .order('name')
      .then(({ data }) => {
        if (data) setProducts(data as Product[]);
      });
  }, []);

  /* ── Load summary ── */
  const loadSummary = useCallback(async () => {
    if (!supabase) return;
    const today = todayISO();
    const tomorrow = tomorrowISO();

    const { data } = await supabase
      .from('orders')
      .select('delivery_date, product_type, quantity, status')
      .gte('delivery_date', today)
      .in('status', ['pending', 'prepared']);

    if (!data) { setSummary(null); return; }

    const s: OrdersSummary = {
      totalOrders: data.length,
      totalPieces: data.reduce((sum, o) => sum + (o.quantity ?? 0), 0),
      bySalada: data.filter(o => o.product_type === 'Salada').reduce((s, o) => s + (o.quantity ?? 0), 0),
      bySabores: data.filter(o => o.product_type === 'Sabores').reduce((s, o) => s + (o.quantity ?? 0), 0),
      byCaramelo: data.filter(o => o.product_type === 'Caramelo').reduce((s, o) => s + (o.quantity ?? 0), 0),
      tomorrowOrders: data.filter(o => o.delivery_date === tomorrow).length,
      tomorrowPieces: data.filter(o => o.delivery_date === tomorrow).reduce((s, o) => s + (o.quantity ?? 0), 0),
    };
    setSummary(s);
  }, []);

  /* ── Load orders ── */
  const loadOrders = useCallback(async () => {
    if (!supabase) return;
    setLoadingOrders(true);

    let query = supabase
      .from('orders')
      .select('*, products(name, price)')
      .order('delivery_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (selectedDate) {
      query = query.eq('delivery_date', selectedDate);
    } else {
      query = query.gte('delivery_date', todayISO());
    }

    const { data } = await query;
    setOrders((data as Order[]) ?? []);
    setLoadingOrders(false);
  }, [selectedDate]);

  useEffect(() => {
    loadOrders();
    loadSummary();
  }, [loadOrders, loadSummary]);

  /* ── Reset product when type changes ── */
  useEffect(() => {
    setFormProductId('');
  }, [formProductType]);

  /* ── Save order ── */
  const handleSave = async () => {
    if (!supabase) return;
    if (!formCustomerName.trim()) return alert('Nombre del cliente es obligatorio');
    if (!formDeliveryDate) return alert('Fecha de entrega es obligatoria');
    if (!formQuantity || formQuantity <= 0) return alert('Cantidad debe ser mayor a 0');

    setSaving(true);
    const { error } = await supabase.from('orders').insert({
      customer_name: formCustomerName.trim(),
      customer_phone: formPhone.trim() || null,
      delivery_date: formDeliveryDate,
      product_type: formProductType || null,
      product_id: formProductId || null,
      quantity: formQuantity,
      notes: formNotes.trim() || null,
      status: 'pending',
    });

    if (error) {
      console.error('[ORDERS] insert error:', error);
      alert('Error al guardar pedido');
    } else {
      setSuccessMsg('Pedido registrado ✓');
      setTimeout(() => setSuccessMsg(''), 3000);
      setFormCustomerName('');
      setFormPhone('');
      setFormDeliveryDate('');
      setFormProductType('');
      setFormProductId('');
      setFormQuantity('');
      setFormNotes('');
      loadOrders();
      loadSummary();
    }
    setSaving(false);
  };

  /* ── Update order status ── */
  const handleStatusChange = async (orderId: string, newStatus: OrderStatus) => {
    if (!supabase) return;
    setUpdatingStatusId(orderId);

    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus })
      .eq('id', orderId);

    if (error) {
      console.error('[ORDERS] status update error:', error);
      alert('Error al actualizar estado');
    } else {
      console.log('[ORDERS] status updated', orderId, newStatus);
      loadOrders();
      loadSummary();
    }
    setUpdatingStatusId(null);
  };

  /* ── Checkout (convert order to sale) ── */
  const handleCheckoutOrder = async () => {
    if (!supabase || !orderToCheckout) return;
    const order = orderToCheckout;

    console.log('[ORDERS] checkout order', order);
    setCheckoutLoading(true);

    try {
      const product = order.products;
      const unitPrice = product?.price ?? 0;
      const total = unitPrice * order.quantity;

      // NOTE: pedido checkouts do NOT link to the cash register session.
      // Orders are collected separately and must NOT appear in the physical
      // cash register closing (cierre de caja).

      // 1. Insert sale
      const salePayload: Record<string, unknown> = {
        total,
        payment_method: checkoutPaymentMethod,
        cash_amount: checkoutPaymentMethod === 'CASH' ? total : 0,
        card_amount: checkoutPaymentMethod === 'CARD' ? total : 0,
        transfer_amount: checkoutPaymentMethod === 'TRANSFER' ? total : 0,
        customer_id: null,
        loyalty_reward_applied: false,
        loyalty_discount_amount: 0,
        promotion_code: 'ORDER_CHECKOUT',
        // cash_session_id is intentionally NOT set for order checkouts.
        // Pedidos are NOT part of the physical cash register.
      };

      const { data: sale, error: saleErr } = await supabase
        .from('sales')
        .insert(salePayload)
        .select('id')
        .single();

      if (saleErr) throw saleErr;

      // 2. Insert sale_items
      if (order.product_id) {
        const { error: itemsErr } = await supabase.from('sale_items').insert({
          sale_id: sale.id,
          product_id: order.product_id,
          quantity: order.quantity,
          price: unitPrice,
          discount_amount: 0,
          discount_reason: null,
        });
        if (itemsErr) throw itemsErr;
      }

      console.log('[ORDERS] sale created from order', sale.id);

      // 3. Mark order as delivered
      await supabase
        .from('orders')
        .update({ status: 'delivered' })
        .eq('id', order.id);

      setOrderToCheckout(null);
      setCheckoutPaymentMethod('CASH');
      setSuccessMsg('Pedido cobrado ✓');
      setTimeout(() => setSuccessMsg(''), 3000);
      loadOrders();
      loadSummary();
    } catch (err: any) {
      console.error('[ORDERS] checkout error:', err);
      alert('Error al cobrar pedido: ' + (err.message ?? 'Error desconocido'));
    } finally {
      setCheckoutLoading(false);
    }
  };

  /* ── Delete order (pending only) ── */
  const handleAskDeleteOrder = (order: Order) => {
    if (order.status !== 'pending') {
      if (order.status === 'delivered') {
        alert('Este pedido ya fue cobrado o entregado y no puede eliminarse');
      } else {
        alert('Solo se pueden eliminar pedidos en estado pendiente');
      }
      return;
    }
    setOrderToDelete(order);
  };

  const handleDeleteOrder = async () => {
    if (!supabase || !orderToDelete) return;
    setDeleteLoading(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .delete()
        .eq('id', orderToDelete.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        alert('Este pedido ya fue cobrado o entregado y no puede eliminarse');
        return;
      }

      setOrderToDelete(null);
      setSuccessMsg('Pedido eliminado ✓');
      setTimeout(() => setSuccessMsg(''), 3000);
      await loadOrders();
      await loadSummary();
    } catch (err: any) {
      console.error('[ORDERS] delete error:', err);
      alert('Error al eliminar pedido: ' + (err.message ?? 'Error desconocido'));
    } finally {
      setDeleteLoading(false);
    }
  };

  /* ── Export orders to Excel ── */
  const handleExportOrdersExcel = useCallback(() => {
    if (orders.length === 0) {
      alert('No hay pedidos para exportar');
      return;
    }

    const statusLabel = (s: OrderStatus) => STATUS_CFG[s]?.label ?? s;

    /* ── Sheet 1: Pedidos Detalle ── */
    const detailRows = orders.map((o) => ({
      'Fecha de entrega': fmtDateShort(o.delivery_date),
      'Cliente': o.customer_name,
      'Teléfono': o.customer_phone || '—',
      'Tipo de palomita': o.product_type || '—',
      'Presentación / tamaño': o.products?.name || '—',
      'Cantidad': o.quantity,
      'Notas': o.notes || '—',
      'Estado': statusLabel(o.status),
    }));

    const wsDetail = XLSX.utils.json_to_sheet(detailRows);
    wsDetail['!cols'] = [
      { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 14 },
      { wch: 26 }, { wch: 10 }, { wch: 30 }, { wch: 12 },
    ];

    /* ── Sheet 2: Resumen Producción ── */
    // Group by product_type → product name → sum quantity
    const grouped: Record<string, Record<string, number>> = {};
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      const tipo = o.product_type || 'Sin tipo';
      const pres = o.products?.name || '(sin presentación)';
      if (!grouped[tipo]) grouped[tipo] = {};
      grouped[tipo][pres] = (grouped[tipo][pres] || 0) + o.quantity;
    }

    const summaryAoa: (string | number)[][] = [
      ['Tipo', 'Presentación', 'Cantidad'],
    ];
    let grandTotal = 0;
    for (const tipo of Object.keys(grouped).sort()) {
      let tipoTotal = 0;
      const entries = Object.entries(grouped[tipo]).sort((a, b) => a[0].localeCompare(b[0]));
      for (const [pres, qty] of entries) {
        summaryAoa.push([tipo, pres, qty]);
        tipoTotal += qty;
      }
      summaryAoa.push([tipo, 'SUBTOTAL', tipoTotal]);
      summaryAoa.push([]);
      grandTotal += tipoTotal;
    }
    summaryAoa.push(['', 'TOTAL GENERAL', grandTotal]);

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
    wsSummary['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 12 }];

    /* ── Sheet 3: Producción por Sabor ── */
    const flavorMap = new Map<string, number>(); // key = "producto||sabor"
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      const producto = o.products?.name || '(sin presentación)';
      const rawNotes = (o.notes ?? '').trim();
      const notesEmpty = !rawNotes || rawNotes === '—';

      let sabor: string;
      if (o.product_type === 'Sabores') {
        sabor = notesEmpty ? 'Sabores (sin especificar)' : rawNotes;
      } else if (!notesEmpty) {
        // Nota presente en Salada/Caramelo → usar nota como sabor específico
        sabor = rawNotes;
      } else {
        // Sin nota → el sabor es el tipo mismo
        sabor = o.product_type || 'Sin tipo';
      }
      // Capitalize first letter
      sabor = sabor.charAt(0).toUpperCase() + sabor.slice(1);

      const key = `${producto}||${sabor}`;
      flavorMap.set(key, (flavorMap.get(key) || 0) + o.quantity);
    }

    const flavorAoa: (string | number)[][] = [
      ['Producto', 'Sabor', 'Cantidad'],
    ];
    const sortedFlavors = Array.from(flavorMap.entries()).sort((a, b) => {
      const [pA, sA] = a[0].split('||');
      const [pB, sB] = b[0].split('||');
      return pA.localeCompare(pB) || sA.localeCompare(sB);
    });
    let flavorGrandTotal = 0;
    for (const [key, qty] of sortedFlavors) {
      const [producto, sabor] = key.split('||');
      flavorAoa.push([producto, sabor, qty]);
      flavorGrandTotal += qty;
    }
    flavorAoa.push([]);
    flavorAoa.push(['', 'TOTAL', flavorGrandTotal]);

    const wsFlavor = XLSX.utils.aoa_to_sheet(flavorAoa);
    wsFlavor['!cols'] = [{ wch: 28 }, { wch: 24 }, { wch: 12 }];

    /* ── Workbook ── */
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Pedidos Detalle');
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen Producción');
    XLSX.utils.book_append_sheet(wb, wsFlavor, 'Producción por Sabor');

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const datePart = selectedDate || todayISO();
    const fileName = selectedDate
      ? `pedidos_${datePart}.xlsx`
      : `pedidos_proximos_${datePart}.xlsx`;

    saveAs(
      new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      fileName,
    );
  }, [orders, selectedDate]);

  /* ── Computed: total for checkout modal ── */
  const checkoutTotal = useMemo(() => {
    if (!orderToCheckout) return 0;
    const price = orderToCheckout.products?.price ?? 0;
    return price * orderToCheckout.quantity;
  }, [orderToCheckout]);

  /* ── Computed: economic summary of visible orders ── */
  const economicSummary = useMemo(() => {
    let totalOrders = 0;
    let totalPieces = 0;
    let totalAmount = 0;
    for (const o of orders) {
      totalOrders += 1;
      totalPieces += o.quantity;
      totalAmount += (o.products?.price ?? 0) * o.quantity;
    }
    return { totalOrders, totalPieces, totalAmount };
  }, [orders]);

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-cc-primary/15 rounded-xl">
          <ClipboardList className="text-cc-primary" size={28} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-cc-cream tracking-wide">Pedidos</h1>
          <p className="text-sm text-cc-text-muted">Captura y consulta de pedidos futuros</p>
        </div>
      </div>

      {/* ── Summary cards ── */}
      {summary && summary.totalOrders > 0 && (
        <div className="bg-cc-surface border border-white/10 rounded-2xl p-5 space-y-3">
          <h2 className="text-xs font-bold text-cc-text-muted uppercase tracking-wide flex items-center gap-2">
            <TrendingUp size={14} className="text-cc-primary" /> Pedidos próximos (pendientes + preparados)
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <SummaryCard label="Pedidos" value={summary.totalOrders} color="text-cc-primary" icon={<ClipboardList size={14} />} />
            <SummaryCard label="Piezas totales" value={summary.totalPieces} color="text-cc-cream" icon={<Package size={14} />} />
            <SummaryCard label="Salada" value={summary.bySalada} color="text-yellow-300" icon={<Popcorn size={14} />} />
            <SummaryCard label="Sabores" value={summary.bySabores} color="text-pink-400" icon={<Popcorn size={14} />} />
            <SummaryCard label="Caramelo" value={summary.byCaramelo} color="text-amber-500" icon={<Popcorn size={14} />} />
            <SummaryCard label="Mañana" value={summary.tomorrowOrders} color="text-blue-400" icon={<CalendarDays size={14} />} sub={`${summary.tomorrowPieces} pzas`} />
          </div>
        </div>
      )}

      {/* ── Form ── */}
      <div className="bg-cc-surface border border-white/10 rounded-2xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-cc-text-muted uppercase tracking-wide flex items-center gap-2">
          <Plus size={14} className="text-cc-primary" /> Nuevo pedido
        </h2>

        {/* Row 1: name + phone + date */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-cc-text-muted flex items-center gap-1 mb-1">
              <User size={12} /> Nombre del cliente *
            </label>
            <input
              type="text"
              value={formCustomerName}
              onChange={(e) => setFormCustomerName(e.target.value)}
              placeholder="Nombre"
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-cc-text-main placeholder:text-cc-text-muted/40 focus:outline-none focus:border-cc-primary/50 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-cc-text-muted flex items-center gap-1 mb-1">
              <Phone size={12} /> Teléfono
            </label>
            <input
              type="tel"
              value={formPhone}
              onChange={(e) => setFormPhone(e.target.value)}
              placeholder="Opcional"
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-cc-text-main placeholder:text-cc-text-muted/40 focus:outline-none focus:border-cc-primary/50 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-cc-text-muted flex items-center gap-1 mb-1">
              <CalendarDays size={12} /> Fecha de entrega *
            </label>
            <input
              type="date"
              value={formDeliveryDate}
              onChange={(e) => setFormDeliveryDate(e.target.value)}
              min={todayISO()}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-cc-text-main focus:outline-none focus:border-cc-primary/50 transition-colors [color-scheme:dark]"
            />
          </div>
        </div>

        {/* Row 2: type + product + quantity */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-cc-text-muted flex items-center gap-1 mb-1">
              <Package size={12} /> Tipo de palomita
            </label>
            <select
              value={formProductType}
              onChange={(e) => setFormProductType(e.target.value as ProductType | '')}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-cc-text-main focus:outline-none focus:border-cc-primary/50 transition-colors"
            >
              <option value="">— Seleccionar —</option>
              {PRODUCT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-cc-text-muted flex items-center gap-1 mb-1">
              <Package size={12} /> Presentación / tamaño
            </label>
            <select
              value={formProductId}
              onChange={(e) => setFormProductId(e.target.value)}
              disabled={!formProductType}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-cc-text-main focus:outline-none focus:border-cc-primary/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <option value="">
                {formProductType ? '— Seleccionar producto —' : '— Elige tipo primero —'}
              </option>
              {filteredProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.grams ? ` (${p.grams}g)` : ''}
                  {p.sku_code ? ` — ${p.sku_code}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-cc-text-muted flex items-center gap-1 mb-1">
              <Hash size={12} /> Cantidad *
            </label>
            <input
              type="number"
              min={1}
              value={formQuantity}
              onChange={(e) =>
                setFormQuantity(e.target.value === '' ? '' : Math.max(1, Number(e.target.value)))
              }
              placeholder="0"
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-cc-text-main placeholder:text-cc-text-muted/40 focus:outline-none focus:border-cc-primary/50 transition-colors"
            />
          </div>
        </div>

        {/* Row 3: notes */}
        <div>
          <label className="text-xs text-cc-text-muted flex items-center gap-1 mb-1">
            <StickyNote size={12} /> Notas
          </label>
          <textarea
            value={formNotes}
            onChange={(e) => setFormNotes(e.target.value)}
            placeholder="Notas opcionales"
            rows={2}
            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-cc-text-main placeholder:text-cc-text-muted/40 focus:outline-none focus:border-cc-primary/50 transition-colors resize-none"
          />
        </div>

        {/* Save button + success */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-cc-primary text-cc-bg font-bold rounded-lg text-sm hover:bg-cc-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_12px_rgba(244,197,66,0.25)]"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {saving ? 'Guardando…' : 'Guardar pedido'}
          </button>

          {successMsg && (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-400 animate-pulse">
              <CheckCircle2 size={16} /> {successMsg}
            </span>
          )}
        </div>
      </div>

      {/* ── Orders list ── */}
      <div className="bg-cc-surface border border-white/10 rounded-2xl p-5 space-y-4">
        {/* Header + date filter */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-sm font-bold text-cc-text-muted uppercase tracking-wide flex items-center gap-2">
            <Search size={14} className="text-cc-primary" /> Pedidos
            {selectedDate
              ? ` — ${fmtDateShort(selectedDate)}`
              : ' — Próximos'}
          </h2>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-text-main focus:outline-none focus:border-cc-primary/50 transition-colors [color-scheme:dark]"
            />
            {selectedDate && (
              <button
                onClick={() => setSelectedDate('')}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                title="Ver todos los próximos"
              >
                <X size={16} className="text-cc-text-muted hover:text-cc-text-main" />
              </button>
            )}
            <button
              onClick={handleExportOrdersExcel}
              disabled={orders.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-cc-primary text-cc-bg font-bold rounded-lg text-xs hover:bg-cc-primary/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title="Exportar pedidos a Excel"
            >
              <Download size={14} />
              Excel
            </button>
          </div>
        </div>

        {/* Table */}
        {loadingOrders ? (
          <div className="text-center text-cc-text-muted py-10 animate-pulse text-sm">
            Cargando pedidos…
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center text-cc-text-muted py-10 bg-black/20 rounded-lg border border-white/5">
            <ClipboardList size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No hay pedidos{selectedDate ? ` para ${fmtDateShort(selectedDate)}` : ' próximos'}</p>
          </div>
        ) : (
          <div className="bg-black/20 rounded-lg border border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-cc-text-muted border-b border-white/10 bg-black/20">
                    <th className="text-left py-2.5 px-3 font-medium">Entrega</th>
                    <th className="text-left py-2.5 px-3 font-medium">Cliente</th>
                    <th className="text-left py-2.5 px-3 font-medium">Teléfono</th>
                    <th className="text-left py-2.5 px-3 font-medium">Producto</th>
                    <th className="text-center py-2.5 px-3 font-medium">Cant.</th>
                    <th className="text-center py-2.5 px-3 font-medium">Estado</th>
                    <th className="text-left py-2.5 px-3 font-medium">Notas</th>
                    <th className="text-center py-2.5 px-3 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const st = STATUS_CFG[o.status] ?? STATUS_CFG.pending;
                    const canCheckout = o.status === 'pending' || o.status === 'prepared';
                    const canDelete = o.status === 'pending';
                    const isUpdating = updatingStatusId === o.id;
                    return (
                      <tr
                        key={o.id}
                        className={`border-b border-white/5 transition-colors ${
                          o.label_printed
                            ? 'bg-violet-500/10 hover:bg-violet-500/15 border-b-violet-500/20'
                            : 'hover:bg-white/5'
                        }`}
                      >
                        <td className="py-2.5 px-3 text-cc-text-muted whitespace-nowrap">
                          {fmtDateShort(o.delivery_date)}
                        </td>
                        <td className="py-2.5 px-3 text-cc-text-main font-medium">
                          {o.customer_name}
                        </td>
                        <td className="py-2.5 px-3 text-cc-text-muted">
                          {o.customer_phone || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-cc-text-main">
                          {o.products?.name ?? o.product_type ?? '—'}
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold text-cc-primary">
                          {o.quantity}
                        </td>
                        {/* Status select */}
                        <td className="py-2 px-2 text-center">
                          <select
                            value={o.status}
                            disabled={isUpdating}
                            onChange={(e) => handleStatusChange(o.id, e.target.value as OrderStatus)}
                            className={`text-[10px] font-bold rounded-full px-2 py-1 border appearance-none text-center cursor-pointer transition-colors disabled:opacity-50 ${st.bg} ${st.color} bg-transparent focus:outline-none`}
                          >
                            {ALL_STATUSES.map((s) => (
                              <option key={s} value={s} className="bg-cc-surface text-cc-text-main text-xs">
                                {STATUS_CFG[s].label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-3 text-cc-text-muted max-w-[160px] truncate">
                          {o.notes || '—'}
                        </td>
                        {/* Actions */}
                        <td className="py-2 px-2 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={async () => {
                                try {
                                  await printOrderLabel(o.customer_name);
                                  if (!o.label_printed && supabase) {
                                    await supabase
                                      .from('orders')
                                      .update({ label_printed: true })
                                      .eq('id', o.id);
                                    setOrders(prev =>
                                      prev.map(x => x.id === o.id ? { ...x, label_printed: true } : x)
                                    );
                                  }
                                } catch (err: any) {
                                  alert(err.message || 'Error al imprimir etiqueta');
                                }
                              }}
                              title="Imprimir etiqueta con nombre del cliente"
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all ${
                                o.label_printed
                                  ? 'bg-violet-500/25 border-violet-400/50 text-violet-300'
                                  : 'bg-violet-500/15 border-violet-500/30 text-violet-400 hover:bg-violet-500/25'
                              }`}
                            >
                              <Tag size={11} />{o.label_printed ? '✔ Impresa' : 'Etiqueta'}
                            </button>
                            <button
                              onClick={() => { setOrderToCheckout(o); setCheckoutPaymentMethod('CASH'); }}
                              disabled={!canCheckout}
                              title={canCheckout ? 'Cobrar pedido' : 'Solo pedidos pendientes o preparados'}
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all
                                bg-green-500/15 border-green-500/30 text-green-400 hover:bg-green-500/25
                                disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-green-500/15"
                            >
                              <ShoppingCart size={11} /> Cobrar
                            </button>
                            <button
                              onClick={() => handleAskDeleteOrder(o)}
                              title={canDelete ? 'Eliminar pedido pendiente' : 'Solo se pueden eliminar pedidos pendientes'}
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all ${
                                canDelete
                                  ? 'bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/25'
                                  : 'bg-neutral-900 border-neutral-700 text-neutral-500 hover:border-neutral-600'
                              }`}
                            >
                              <Trash2 size={11} /> Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Economic summary of visible orders ── */}
      {orders.length > 0 && (
        <div className="bg-cc-surface border border-white/10 rounded-2xl p-5">
          <h2 className="text-xs font-bold text-cc-text-muted uppercase tracking-wide flex items-center gap-2 mb-3">
            <Banknote size={14} className="text-green-400" /> Resumen económico{selectedDate ? ` — ${new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}` : ' — Próximos'}
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="px-4 py-3 bg-black/30 rounded-lg border border-white/5">
              <div className="text-[10px] text-cc-text-muted uppercase mb-0.5 flex items-center gap-1">
                <ClipboardList size={12} /> Total de pedidos
              </div>
              <div className="text-2xl font-bold text-cc-primary">{economicSummary.totalOrders}</div>
            </div>
            <div className="px-4 py-3 bg-black/30 rounded-lg border border-white/5">
              <div className="text-[10px] text-cc-text-muted uppercase mb-0.5 flex items-center gap-1">
                <Package size={12} /> Piezas totales
              </div>
              <div className="text-2xl font-bold text-cc-cream">{economicSummary.totalPieces}</div>
            </div>
            <div className="px-4 py-3 bg-black/30 rounded-lg border border-white/5">
              <div className="text-[10px] text-cc-text-muted uppercase mb-0.5 flex items-center gap-1">
                <Banknote size={12} /> Monto total estimado
              </div>
              <div className="text-2xl font-bold text-green-400">${economicSummary.totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete order modal ── */}
      {orderToDelete && (
        <div
          className="fixed inset-0 bg-black z-50 flex items-center justify-center p-4"
          onClick={() => !deleteLoading && setOrderToDelete(null)}
        >
          <div
            className="bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-neutral-800 bg-neutral-900 flex items-center justify-between">
              <h3 className="text-lg font-bold text-cc-cream flex items-center gap-2">
                <Trash2 size={20} className="text-red-400" /> Eliminar pedido
              </h3>
              <button
                onClick={() => !deleteLoading && setOrderToDelete(null)}
                className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
              >
                <X size={18} className="text-cc-text-muted" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                Esta acción eliminará el pedido de forma permanente.
              </p>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Cliente</span>
                  <span className="text-cc-text-main font-medium">{orderToDelete.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Producto</span>
                  <span className="text-cc-text-main font-medium">
                    {orderToDelete.products?.name ?? orderToDelete.product_type ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Cantidad</span>
                  <span className="text-cc-primary font-bold">{orderToDelete.quantity}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Fecha de entrega</span>
                  <span className="text-cc-text-main font-medium">{fmtDateShort(orderToDelete.delivery_date)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Estado</span>
                  <span className={`font-bold ${STATUS_CFG[orderToDelete.status]?.color ?? 'text-cc-text-main'}`}>
                    {STATUS_CFG[orderToDelete.status]?.label ?? orderToDelete.status}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-neutral-800 bg-neutral-900 flex gap-3">
              <button
                onClick={() => setOrderToDelete(null)}
                disabled={deleteLoading}
                className="flex-1 py-2.5 text-sm font-semibold text-cc-text-muted bg-neutral-900 border border-neutral-700 rounded-lg hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteOrder}
                disabled={deleteLoading}
                className="flex-1 py-2.5 text-sm font-bold text-white bg-red-600 rounded-lg hover:bg-red-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {deleteLoading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {deleteLoading ? 'Eliminando…' : 'Eliminar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Checkout order modal ── */}
      {orderToCheckout && (
        <div
          className="fixed inset-0 bg-black z-50 flex items-center justify-center p-4"
          onClick={() => !checkoutLoading && setOrderToCheckout(null)}
        >
          <div
            className="bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 border-b border-neutral-800 bg-neutral-900 flex items-center justify-between">
              <h3 className="text-lg font-bold text-cc-cream flex items-center gap-2">
                <ShoppingCart size={20} className="text-green-400" /> Cobrar pedido
              </h3>
              <button
                onClick={() => !checkoutLoading && setOrderToCheckout(null)}
                className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
              >
                <X size={18} className="text-cc-text-muted" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              {/* Order details */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Cliente</span>
                  <span className="text-cc-text-main font-medium">{orderToCheckout.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Producto</span>
                  <span className="text-cc-text-main font-medium">
                    {orderToCheckout.products?.name ?? orderToCheckout.product_type ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Cantidad</span>
                  <span className="text-cc-primary font-bold">{orderToCheckout.quantity}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cc-text-muted">Precio unitario</span>
                  <span className="text-cc-text-main">${(orderToCheckout.products?.price ?? 0).toFixed(2)}</span>
                </div>
                <div className="border-t border-neutral-800 pt-2 flex justify-between">
                  <span className="text-cc-cream font-bold">Total estimado</span>
                  <span className="text-xl font-bold text-cc-primary">${checkoutTotal.toFixed(2)}</span>
                </div>
              </div>

              {/* Payment method */}
              <div>
                <label className="text-xs text-cc-text-muted mb-2 block">Método de pago</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setCheckoutPaymentMethod('CASH')}
                    className={`flex items-center justify-center gap-2 py-3 rounded-lg border text-sm font-bold transition-all ${
                      checkoutPaymentMethod === 'CASH'
                        ? 'bg-green-950 border-green-700 text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.15)]'
                        : 'bg-neutral-900 border-neutral-700 text-cc-text-muted hover:border-neutral-600'
                    }`}
                  >
                    <Banknote size={18} /> Efectivo
                  </button>
                  <button
                    onClick={() => setCheckoutPaymentMethod('CARD')}
                    className={`flex items-center justify-center gap-2 py-3 rounded-lg border text-sm font-bold transition-all ${
                      checkoutPaymentMethod === 'CARD'
                        ? 'bg-blue-950 border-blue-700 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.15)]'
                        : 'bg-neutral-900 border-neutral-700 text-cc-text-muted hover:border-neutral-600'
                    }`}
                  >
                    <CreditCard size={18} /> Tarjeta
                  </button>
                  <button
                    onClick={() => setCheckoutPaymentMethod('TRANSFER')}
                    className={`flex items-center justify-center gap-2 py-3 rounded-lg border text-sm font-bold transition-all ${
                      checkoutPaymentMethod === 'TRANSFER'
                        ? 'bg-violet-950 border-violet-700 text-violet-300 shadow-[0_0_10px_rgba(139,92,246,0.15)]'
                        : 'bg-neutral-900 border-neutral-700 text-cc-text-muted hover:border-neutral-600'
                    }`}
                  >
                    <Landmark size={18} /> Transferencia
                  </button>
                </div>
              </div>

              {/* Warning if no product_id */}
              {!orderToCheckout.product_id && (
                <p className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
                  ⚠️ Este pedido no tiene producto asociado. Se registrará la venta con total $0.00.
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-neutral-800 bg-neutral-900 flex gap-3">
              <button
                onClick={() => setOrderToCheckout(null)}
                disabled={checkoutLoading}
                className="flex-1 py-2.5 text-sm font-semibold text-cc-text-muted bg-neutral-900 border border-neutral-700 rounded-lg hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleCheckoutOrder}
                disabled={checkoutLoading}
                className="flex-1 py-2.5 text-sm font-bold text-cc-bg bg-green-500 rounded-lg hover:bg-green-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_12px_rgba(34,197,94,0.3)] inline-flex items-center justify-center gap-2"
              >
                {checkoutLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                {checkoutLoading ? 'Procesando…' : 'Confirmar cobro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Summary card ───────────────────────────────────────────────────────── */

function SummaryCard({
  label,
  value,
  color,
  icon,
  sub,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="px-3 py-2.5 bg-black/30 rounded-lg border border-white/5">
      <div className="text-[10px] text-cc-text-muted uppercase mb-0.5 flex items-center gap-1">
        {icon} {label}
      </div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-cc-text-muted">{sub}</div>}
    </div>
  );
}
