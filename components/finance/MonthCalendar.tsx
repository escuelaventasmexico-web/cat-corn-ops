import { useEffect, useState } from 'react';
import { Calendar, Loader2, TrendingUp, TrendingDown, X, ChevronLeft, ChevronRight } from 'lucide-react';
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

  // Parse current month for display
  const [year, month] = monthStartISO.split('-').map(Number);
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  // Navigate months
  const goMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    setMonthStartISO(iso);
    setSelectedDay(null);
  };

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
                  onClick={() => !isFuture && setSelectedDay(isSelected ? null : d)}
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

      {/* Selected Day Detail */}
      {selectedDay && (
        <div className="border-t border-white/10 p-5 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold text-cc-cream">
              {new Date(selectedDay.sale_date + 'T12:00:00').toLocaleDateString('es-MX', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              })}
            </h4>
            <button onClick={() => setSelectedDay(null)} className="p-1 hover:bg-white/10 rounded transition-colors">
              <X size={16} className="text-cc-text-muted" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* Total */}
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
              <p className="text-[10px] text-green-300/80 uppercase tracking-wider">Vendido</p>
              <p className="text-lg font-bold text-green-400">{fmt(selectedDay.total_sales)}</p>
            </div>
            {/* Cash */}
            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
              <p className="text-[10px] text-cc-text-muted uppercase tracking-wider">Efectivo</p>
              <p className="text-lg font-bold text-cc-cream">{fmt(selectedDay.cash_sales)}</p>
            </div>
            {/* Card */}
            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
              <p className="text-[10px] text-cc-text-muted uppercase tracking-wider">Tarjeta</p>
              <p className="text-lg font-bold text-cc-cream">{fmt(selectedDay.card_sales)}</p>
            </div>
            {/* Transfer */}
            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
              <p className="text-[10px] text-cc-text-muted uppercase tracking-wider">Transferencia</p>
              <p className="text-lg font-bold text-cc-cream">{fmt(selectedDay.transfer_sales)}</p>
            </div>
            {/* Tickets */}
            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
              <p className="text-[10px] text-cc-text-muted uppercase tracking-wider">Tickets</p>
              <p className="text-lg font-bold text-cc-cream">{selectedDay.ticket_count}</p>
            </div>
            {/* Avg Ticket */}
            <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
              <p className="text-[10px] text-cc-text-muted uppercase tracking-wider">Ticket Promedio</p>
              <p className="text-lg font-bold text-cc-cream">{fmt(selectedDay.avg_ticket)}</p>
            </div>

            {/* YoY Comparison */}
            <div className={`rounded-lg p-3 border ${
              selectedDay.prev_year_sales > 0
                ? selectedDay.yoy_diff_abs >= 0
                  ? 'bg-green-500/10 border-green-500/20'
                  : 'bg-red-500/10 border-red-500/20'
                : 'bg-white/[0.03] border-white/5'
            }`}>
              <p className="text-[10px] text-cc-text-muted uppercase tracking-wider">vs Año Anterior</p>
              {selectedDay.prev_year_sales > 0 ? (
                <>
                  <div className="flex items-center gap-1">
                    {selectedDay.yoy_diff_abs >= 0
                      ? <TrendingUp size={14} className="text-green-400" />
                      : <TrendingDown size={14} className="text-red-400" />
                    }
                    <span className={`text-sm font-bold ${selectedDay.yoy_diff_abs >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {selectedDay.yoy_diff_abs >= 0 ? '+' : ''}{fmt(selectedDay.yoy_diff_abs)}
                    </span>
                  </div>
                  <p className="text-[10px] text-cc-text-muted mt-0.5">
                    Antes: {fmt(selectedDay.prev_year_sales)}
                    {selectedDay.yoy_diff_pct !== null && (
                      <span className={selectedDay.yoy_diff_pct >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {' '}({selectedDay.yoy_diff_pct >= 0 ? '+' : ''}{selectedDay.yoy_diff_pct.toFixed(1)}%)
                      </span>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-sm text-cc-text-muted/60 mt-1">Sin histórico disponible</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
