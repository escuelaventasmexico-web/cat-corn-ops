import { useEffect, useState, useCallback } from 'react';
import { Calendar, Loader2, TrendingUp, TrendingDown, X, ChevronLeft, ChevronRight, Store, ShoppingBag, Banknote, CreditCard, Landmark } from 'lucide-react';
import { supabase } from '../../supabase';

interface CalendarDay {
  sale_date: string;
  total_sales: number;
  cash_sales: number;
  card_sales: number;
  transfer_sales: number;
  ticket_count: number;
  avg_ticket: number;
  prev_year_sales: number;
  yoy_diff_abs: number;
  yoy_diff_pct: number | null;
}

/** A sale row enriched with product info for the day detail modal */
interface DaySale {
  id: string;
  total: number;
  payment_method: string;
  promotion_code: string | null;
  created_at: string;
  product_name: string | null;
}

/** An order that was delivered (charged) on the selected day */
interface DayOrder {
  id: string;
  customer_name: string;
  product_name: string | null;
  quantity: number;
  total: number;
  payment_method: string;
  created_at: string;   // when the order was placed
  charged_at: string;   // when it was charged (updated_at → 'delivered')
}

interface DayDetail {
  // Caja directa
  cajaCash: number;
  cajaCard: number;
  cajaMixed: number;
  cajaTotal: number;
  cajaCount: number;
  // Pedidos
  pedidosCash: number;
  pedidosCard: number;
  pedidosTransfer: number;
  pedidosTotal: number;
  pedidosCount: number;
  // Combined
  grandTotal: number;
  // Order list
  orders: DayOrder[];
}

interface Props {
  monthStartISO: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export const MonthCalendar = ({ monthStartISO: initialMonthISO }: Props) => {
  const [monthStartISO, setMonthStartISO] = useState(initialMonthISO);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);
  const [dayDetail, setDayDetail] = useState<DayDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Parse current month for display
  const [year, month] = monthStartISO.split('-').map(Number);
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  // Navigate months
  const goMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    setMonthStartISO(iso);
    setSelectedDay(null);
    setDayDetail(null);
  };

  // Load detailed breakdown when a day is clicked
  const loadDayDetail = useCallback(async (day: CalendarDay) => {
    if (!supabase) return;
    setDetailLoading(true);
    try {
      // Day boundaries (Mexico City timezone stored as UTC)
      const dayStart = new Date(day.sale_date + 'T00:00:00-06:00').toISOString();
      const nextDay = new Date(new Date(day.sale_date + 'T00:00:00-06:00').getTime() + 86400000).toISOString();

      // 1) All sales of the day with product info
      const { data: salesData } = await supabase
        .from('sales')
        .select('id, total, payment_method, promotion_code, created_at')
        .gte('created_at', dayStart)
        .lt('created_at', nextDay)
        .order('created_at', { ascending: true });

      const sales: DaySale[] = (salesData || []).map(s => ({
        id: s.id,
        total: Number(s.total),
        payment_method: (s.payment_method || '').toUpperCase(),
        promotion_code: s.promotion_code || null,
        created_at: s.created_at,
        product_name: null,
      }));

      const isOrder = (s: DaySale) => s.promotion_code === 'ORDER_CHECKOUT';
      const pm = (s: DaySale) => s.payment_method;

      // Caja directa
      const cajaSales = sales.filter(s => !isOrder(s));
      const cajaCash = cajaSales.filter(s => pm(s) === 'CASH').reduce((a, s) => a + s.total, 0);
      const cajaCard = cajaSales.filter(s => pm(s) === 'CARD').reduce((a, s) => a + s.total, 0);
      const cajaMixed = cajaSales.filter(s => pm(s) === 'MIXED').reduce((a, s) => a + s.total, 0);
      const cajaTotal = cajaCash + cajaCard + cajaMixed;

      // Pedidos
      const pedidoSales = sales.filter(s => isOrder(s));
      const pedidosCash = pedidoSales.filter(s => pm(s) === 'CASH').reduce((a, s) => a + s.total, 0);
      const pedidosCard = pedidoSales.filter(s => pm(s) === 'CARD').reduce((a, s) => a + s.total, 0);
      const pedidosTransfer = pedidoSales.filter(s => pm(s) === 'TRANSFER').reduce((a, s) => a + s.total, 0);
      const pedidosTotal = pedidosCash + pedidosCard + pedidosTransfer;

      // 2) Orders delivered on this day (linked by updated_at ≈ sale time)
      const { data: ordersData } = await supabase
        .from('orders')
        .select('id, customer_name, quantity, created_at, updated_at, products(name, price)')
        .eq('status', 'delivered')
        .gte('updated_at', dayStart)
        .lt('updated_at', nextDay)
        .order('updated_at', { ascending: true });

      // Match each order to a pedido sale by closest timestamp
      const orderList: DayOrder[] = (ordersData || []).map((o: any) => {
        const prod = Array.isArray(o.products) ? o.products[0] : o.products;
        const unitPrice = prod?.price ?? 0;
        const total = unitPrice * (o.quantity ?? 1);

        // Find closest pedido sale by time
        const orderTs = new Date(o.updated_at).getTime();
        let matchedMethod = 'CASH';
        let minDiff = Infinity;
        for (const ps of pedidoSales) {
          const diff = Math.abs(new Date(ps.created_at).getTime() - orderTs);
          if (diff < minDiff) {
            minDiff = diff;
            matchedMethod = ps.payment_method;
          }
        }

        return {
          id: o.id,
          customer_name: o.customer_name || '—',
          product_name: prod?.name || '—',
          quantity: o.quantity ?? 1,
          total,
          payment_method: matchedMethod,
          created_at: o.created_at,
          charged_at: o.updated_at,
        };
      });

      setDayDetail({
        cajaCash, cajaCard, cajaMixed, cajaTotal, cajaCount: cajaSales.length,
        pedidosCash, pedidosCard, pedidosTransfer, pedidosTotal, pedidosCount: pedidoSales.length,
        grandTotal: cajaTotal + pedidosTotal,
        orders: orderList,
      });
    } catch (err) {
      console.error('[MonthCalendar] Error loading day detail:', err);
      setDayDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError('');
        if (!supabase) throw new Error('Supabase no configurado');

        const { data, error: rpcErr } = await supabase.rpc('finance_calendar_with_yoy', {
          p_month_start: monthStartISO,
        });
        if (rpcErr) throw rpcErr;
        setDays((data as CalendarDay[]) || []);
      } catch (e: any) {
        setError(e.message || 'Error al cargar calendario');
      } finally {
        setLoading(false);
      }
    })();
  }, [monthStartISO]);

  // Today string for highlighting
  const todayStr = new Date().toISOString().slice(0, 10);

  // Build calendar grid — offset first day to correct weekday (Monday-first)
  const firstDate = new Date(year, month - 1, 1);
  let startDow = firstDate.getDay(); // 0=Sun
  startDow = startDow === 0 ? 6 : startDow - 1; // convert to Mon=0
  const blanks = Array.from({ length: startDow }, (_, i) => i);

  // Max intensity for heatmap coloring
  const maxSales = Math.max(...days.map((d) => d.total_sales), 1);

  // Month totals
  const monthTotal = days.reduce((s, d) => s + d.total_sales, 0);
  const prevYearTotal = days.reduce((s, d) => s + d.prev_year_sales, 0);
  const monthYoyDiff = monthTotal - prevYearTotal;
  const monthYoyPct = prevYearTotal > 0 ? ((monthYoyDiff / prevYearTotal) * 100) : null;

  return (
    <div className="bg-cc-surface rounded-2xl border border-white/5 overflow-hidden">
      {/* Header with nav */}
      <div className="flex items-center justify-between p-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <Calendar size={22} className="text-cc-primary" />
          <h3 className="text-lg font-bold text-cc-cream">Calendario de Ventas</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => goMonth(-1)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
            <ChevronLeft size={18} className="text-cc-text-muted" />
          </button>
          <span className="text-sm font-semibold text-cc-cream min-w-[140px] text-center">{monthLabel}</span>
          <button onClick={() => goMonth(1)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
            <ChevronRight size={18} className="text-cc-text-muted" />
          </button>
        </div>
      </div>

      {/* Month totals summary row */}
      {!loading && days.length > 0 && (
        <div className="px-5 py-3 border-b border-white/5 flex flex-wrap gap-4 text-xs text-cc-text-muted">
          <span>Total mes: <span className="text-green-400 font-bold">{fmt(monthTotal)}</span></span>
          <span>Mismo mes año anterior: <span className="text-cc-cream font-semibold">{fmt(prevYearTotal)}</span></span>
          {prevYearTotal > 0 ? (
            <span className={monthYoyDiff >= 0 ? 'text-green-400' : 'text-red-400'}>
              {monthYoyDiff >= 0 ? '+' : ''}{fmt(monthYoyDiff)} ({monthYoyPct !== null ? `${monthYoyPct >= 0 ? '+' : ''}${monthYoyPct.toFixed(1)}%` : '—'})
            </span>
          ) : (
            <span className="text-cc-text-muted/60">Sin histórico año anterior</span>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="animate-spin text-cc-primary" size={28} />
        </div>
      )}

      {error && (
        <div className="p-5 text-red-300 text-sm">{error}</div>
      )}

      {/* Calendar Grid */}
      {!loading && !error && (
        <div className="p-5">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEKDAY_LABELS.map((wd) => (
              <div key={wd} className="text-[10px] font-semibold text-cc-text-muted/60 text-center uppercase tracking-wider">
                {wd}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {/* Blank spacers for first week offset */}
            {blanks.map((i) => (
              <div key={`blank-${i}`} />
            ))}

            {days.map((d) => {
              const dateObj = new Date(d.sale_date + 'T12:00:00');
              const dayNum = dateObj.getDate();
              const isToday = d.sale_date === todayStr;
              const isFuture = d.sale_date > todayStr;
              const hasSales = d.total_sales > 0;
              const isSelected = selectedDay?.sale_date === d.sale_date;

              // Heat intensity (0–1)
              const intensity = hasSales ? Math.max(0.15, d.total_sales / maxSales) : 0;

              return (
                <button
                  key={d.sale_date}
                  onClick={() => {
                    if (isFuture) return;
                    if (isSelected) {
                      setSelectedDay(null);
                      setDayDetail(null);
                    } else {
                      setSelectedDay(d);
                      loadDayDetail(d);
                    }
                  }}
                  disabled={isFuture}
                  className={`
                    relative aspect-square rounded-lg flex flex-col items-center justify-center
                    text-xs transition-all duration-150 border
                    ${isFuture
                      ? 'opacity-30 cursor-default border-transparent'
                      : isSelected
                        ? 'border-cc-primary shadow-[0_0_12px_rgba(244,197,66,0.3)] scale-105'
                        : 'border-transparent hover:border-white/20 hover:scale-105 cursor-pointer'
                    }
                    ${isToday ? 'ring-2 ring-cc-primary/50 ring-offset-1 ring-offset-cc-surface' : ''}
                  `}
                  style={{
                    backgroundColor: hasSales
                      ? `rgba(34,197,94,${intensity * 0.35})`
                      : isFuture
                        ? 'transparent'
                        : 'rgba(255,255,255,0.02)',
                  }}
                >
                  <span className={`font-semibold ${isToday ? 'text-cc-primary' : hasSales ? 'text-cc-cream' : 'text-cc-text-muted/50'}`}>
                    {dayNum}
                  </span>
                  {hasSales && (
                    <span className="text-[9px] text-green-400/80 font-medium leading-tight mt-0.5">
                      {d.total_sales >= 1000
                        ? `$${(d.total_sales / 1000).toFixed(1)}k`
                        : `$${d.total_sales.toFixed(0)}`
                      }
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Day Detail Modal */}
      {selectedDay && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => { setSelectedDay(null); setDayDetail(null); }}>
          <div className="bg-neutral-950 border border-neutral-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
              <div>
                <h3 className="text-base font-bold text-cc-cream">
                  {new Date(selectedDay.sale_date + 'T12:00:00').toLocaleDateString('es-MX', {
                    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                  })}
                </h3>
                <p className="text-xs text-cc-text-muted mt-0.5">
                  Total del día: <span className="text-green-400 font-bold">{fmt(selectedDay.total_sales)}</span>
                  {' '}· {selectedDay.ticket_count} ticket{selectedDay.ticket_count !== 1 ? 's' : ''}
                  {' '}· Promedio {fmt(selectedDay.avg_ticket)}
                </p>
              </div>
              <button onClick={() => { setSelectedDay(null); setDayDetail(null); }} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
                <X size={18} className="text-cc-text-muted" />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {detailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="animate-spin text-cc-primary" size={24} />
                </div>
              ) : dayDetail ? (
                <>
                  {/* Grand total bar */}
                  <div className="flex items-center justify-between px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-xl">
                    <span className="text-sm font-medium text-green-300">Total del día</span>
                    <span className="text-xl font-bold text-green-400">{fmt(dayDetail.grandTotal)}</span>
                  </div>

                  {/* Two-column breakdown */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Caja directa */}
                    <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
                      <div className="flex items-center gap-2 mb-3">
                        <Store size={16} className="text-cc-primary" />
                        <span className="text-sm font-bold text-cc-cream">Ventas Caja</span>
                        <span className="ml-auto text-lg font-bold text-cc-primary">{fmt(dayDetail.cajaTotal)}</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-2 text-cc-text-muted"><Banknote size={13} className="text-green-400" /> Efectivo</span>
                          <span className="text-cc-cream font-medium">{fmt(dayDetail.cajaCash)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-2 text-cc-text-muted"><CreditCard size={13} className="text-blue-400" /> Tarjeta</span>
                          <span className="text-cc-cream font-medium">{fmt(dayDetail.cajaCard)}</span>
                        </div>
                        {dayDetail.cajaMixed > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 text-cc-text-muted"><Banknote size={13} className="text-orange-400" /> Mixto</span>
                            <span className="text-cc-cream font-medium">{fmt(dayDetail.cajaMixed)}</span>
                          </div>
                        )}
                        <div className="text-[10px] text-cc-text-muted/60 pt-1 border-t border-white/5">{dayDetail.cajaCount} ticket{dayDetail.cajaCount !== 1 ? 's' : ''}</div>
                      </div>
                    </div>

                    {/* Pedidos */}
                    <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
                      <div className="flex items-center gap-2 mb-3">
                        <ShoppingBag size={16} className="text-violet-400" />
                        <span className="text-sm font-bold text-cc-cream">Ventas Pedidos</span>
                        <span className="ml-auto text-lg font-bold text-violet-400">{fmt(dayDetail.pedidosTotal)}</span>
                      </div>
                      <div className="space-y-2">
                        {dayDetail.pedidosCash > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 text-cc-text-muted"><Banknote size={13} className="text-yellow-400" /> Efectivo</span>
                            <span className="text-cc-cream font-medium">{fmt(dayDetail.pedidosCash)}</span>
                          </div>
                        )}
                        {dayDetail.pedidosCard > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 text-cc-text-muted"><CreditCard size={13} className="text-cyan-400" /> Tarjeta</span>
                            <span className="text-cc-cream font-medium">{fmt(dayDetail.pedidosCard)}</span>
                          </div>
                        )}
                        {dayDetail.pedidosTransfer > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2 text-cc-text-muted"><Landmark size={13} className="text-violet-400" /> Transferencia</span>
                            <span className="text-cc-cream font-medium">{fmt(dayDetail.pedidosTransfer)}</span>
                          </div>
                        )}
                        {dayDetail.pedidosTotal === 0 && (
                          <p className="text-xs text-cc-text-muted/60">Sin ventas de pedidos</p>
                        )}
                        <div className="text-[10px] text-cc-text-muted/60 pt-1 border-t border-white/5">{dayDetail.pedidosCount} cobro{dayDetail.pedidosCount !== 1 ? 's' : ''}</div>
                      </div>
                    </div>
                  </div>

                  {/* YoY comparison row */}
                  <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
                    selectedDay.prev_year_sales > 0
                      ? selectedDay.yoy_diff_abs >= 0
                        ? 'bg-green-500/10 border-green-500/20'
                        : 'bg-red-500/10 border-red-500/20'
                      : 'bg-white/[0.03] border-white/5'
                  }`}>
                    <span className="text-xs text-cc-text-muted">vs Año Anterior</span>
                    {selectedDay.prev_year_sales > 0 ? (
                      <div className="flex items-center gap-2">
                        {selectedDay.yoy_diff_abs >= 0
                          ? <TrendingUp size={14} className="text-green-400" />
                          : <TrendingDown size={14} className="text-red-400" />
                        }
                        <span className={`text-sm font-bold ${selectedDay.yoy_diff_abs >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {selectedDay.yoy_diff_abs >= 0 ? '+' : ''}{fmt(selectedDay.yoy_diff_abs)}
                        </span>
                        <span className="text-xs text-cc-text-muted">
                          (antes: {fmt(selectedDay.prev_year_sales)}
                          {selectedDay.yoy_diff_pct !== null && (
                            <span className={selectedDay.yoy_diff_pct >= 0 ? ' text-green-400' : ' text-red-400'}>
                              , {selectedDay.yoy_diff_pct >= 0 ? '+' : ''}{selectedDay.yoy_diff_pct.toFixed(1)}%
                            </span>
                          )})
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-cc-text-muted/60">Sin histórico</span>
                    )}
                  </div>

                  {/* Order list */}
                  {dayDetail.orders.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-cc-text-muted uppercase tracking-wide mb-3">Pedidos cobrados este día</h4>
                      <div className="space-y-2">
                        {dayDetail.orders.map((o) => {
                          const methodLabel =
                            o.payment_method === 'TRANSFER' ? 'Transferencia'
                            : o.payment_method === 'CARD' ? 'Tarjeta'
                            : 'Efectivo';
                          const methodColor =
                            o.payment_method === 'TRANSFER' ? 'text-violet-400'
                            : o.payment_method === 'CARD' ? 'text-blue-400'
                            : 'text-green-400';
                          return (
                            <div key={o.id} className="bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="text-sm font-bold text-cc-cream">{o.customer_name}</span>
                                  <span className="text-xs text-cc-text-muted ml-2">{o.product_name} ×{o.quantity}</span>
                                </div>
                                <div className="text-right">
                                  <span className="text-sm font-bold text-cc-primary">{fmt(o.total)}</span>
                                  <span className={`text-[10px] ml-2 font-medium ${methodColor}`}>{methodLabel}</span>
                                </div>
                              </div>
                              <div className="flex gap-4 mt-1.5 text-[10px] text-cc-text-muted/70">
                                <span>Pedido: {new Date(o.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                                <span>Cobro: {new Date(o.charged_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {dayDetail.orders.length === 0 && dayDetail.pedidosCount > 0 && (
                    <p className="text-xs text-cc-text-muted/60 text-center py-2">No se encontraron registros de pedidos vinculados</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-cc-text-muted text-center py-8">No se pudo cargar el detalle</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
