import { useEffect, useState } from 'react';
import { X, Loader2, Banknote, CreditCard, Repeat2, Hash, BarChart3 } from 'lucide-react';
import { supabase } from '../../supabase';
import { getCommercialCollections, getMexicoCityPaymentDate } from '../../services/commercialCollectionsService';

interface DailyRow {
  sale_date: string;
  total_sales: number;
  cash_sales: number;
  card_sales: number;
  transfer_sales: number;
  mixed_count: number;
  ticket_count: number;
  avg_ticket: number;
  commercial_collections?: number;
}

interface Props {
  monthStartISO: string;
  onClose: () => void;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);

const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: '2-digit' });
};

const emptyDailyRow = (saleDate: string): DailyRow => ({
  sale_date: saleDate,
  total_sales: 0,
  cash_sales: 0,
  card_sales: 0,
  transfer_sales: 0,
  mixed_count: 0,
  ticket_count: 0,
  avg_ticket: 0,
  commercial_collections: 0,
});

export const DailyBreakdownModal = ({ monthStartISO, onClose }: Props) => {
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        setError('');
        if (!supabase) throw new Error('Supabase no configurado');

        const { data, error: rpcErr } = await supabase.rpc('finance_daily_breakdown', {
          p_month_start: monthStartISO,
        });
        if (rpcErr) throw rpcErr;
        const [year, month] = monthStartISO.split('-').map(Number);
        const commercial = await getCommercialCollections(
          new Date(Date.UTC(year, month - 1, 1)),
          new Date(Date.UTC(year, month, 1)),
        );
        if (commercial.error) throw new Error(commercial.error);

        const rowsByDate = new Map<string, DailyRow>();
        for (const sourceRow of ((data ?? []) as DailyRow[])) {
          rowsByDate.set(sourceRow.sale_date, {
            ...sourceRow,
            total_sales: Number(sourceRow.total_sales ?? 0),
            cash_sales: Number(sourceRow.cash_sales ?? 0),
            card_sales: Number(sourceRow.card_sales ?? 0),
            transfer_sales: Number(sourceRow.transfer_sales ?? 0),
            mixed_count: Number(sourceRow.mixed_count ?? 0),
            ticket_count: Number(sourceRow.ticket_count ?? 0),
            avg_ticket: Number(sourceRow.avg_ticket ?? 0),
            commercial_collections: 0,
          });
        }

        for (const payment of commercial.breakdown) {
          const day = getMexicoCityPaymentDate(payment.payment_date);
          const row = rowsByDate.get(day) ?? emptyDailyRow(day);
          row.commercial_collections = (row.commercial_collections ?? 0) + payment.amount;
          rowsByDate.set(day, row);
        }
        setRows(
          [...rowsByDate.values()]
            .map(row => ({
              ...row,
              total_sales: row.total_sales + (row.commercial_collections ?? 0),
            }))
            .sort((a, b) => a.sale_date.localeCompare(b.sale_date)),
        );
      } catch (e: any) {
        setError(e?.message || 'Error al cargar historial');
      } finally {
        setLoading(false);
      }
    })();
  }, [monthStartISO]);

  // Totals
  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total_sales,
      cash: acc.cash + r.cash_sales,
      card: acc.card + r.card_sales,
      transfer: acc.transfer + r.transfer_sales,
      commercial: acc.commercial + (r.commercial_collections ?? 0),
      tickets: acc.tickets + r.ticket_count,
    }),
    { total: 0, cash: 0, card: 0, transfer: 0, commercial: 0, tickets: 0 },
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-cc-surface border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <BarChart3 size={24} className="text-cc-primary" />
            <h2 className="text-xl font-bold text-cc-cream">Historial Diario</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X size={20} className="text-cc-text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-cc-primary" size={32} />
            </div>
          )}

          {error && (
            <div className="bg-red-900/30 border border-red-500/40 rounded-lg p-4 text-red-300 text-sm">
              {error}
            </div>
          )}

          {!loading && !error && rows.length === 0 && (
            <p className="text-center text-cc-text-muted py-8">Sin datos para este mes.</p>
          )}

          {!loading && !error && rows.map((r) => {
            const hasSales = r.total_sales > 0;
            return (
              <div
                key={r.sale_date}
                className={`rounded-xl border p-4 transition-all ${
                  hasSales
                    ? 'bg-white/[0.03] border-white/10'
                    : 'bg-white/[0.01] border-white/5 opacity-50'
                }`}
              >
                {/* Date + Total */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-cc-cream">{fmtDate(r.sale_date)}</span>
                  <span className={`text-lg font-bold ${hasSales ? 'text-green-400' : 'text-cc-text-muted'}`}>
                    {fmt(r.total_sales)}
                  </span>
                </div>

                {hasSales && (
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-cc-text-muted">
                      <Banknote size={14} className="text-green-400" />
                      <span>Efectivo:</span>
                      <span className="text-cc-cream font-medium">{fmt(r.cash_sales)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-cc-text-muted">
                      <Repeat2 size={14} className="text-violet-400" />
                      <span>Socios: <b className="text-cc-cream">{fmt(r.commercial_collections ?? 0)}</b></span>
                    </div>
                    <div className="flex items-center gap-1.5 text-cc-text-muted">
                      <CreditCard size={14} className="text-blue-400" />
                      <span>Tarjeta:</span>
                      <span className="text-cc-cream font-medium">{fmt(r.card_sales)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-cc-text-muted">
                      <CreditCard size={14} className="text-violet-300" />
                      <span>Transfer:</span>
                      <span className="text-cc-cream font-medium">{fmt(r.transfer_sales)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-cc-text-muted">
                      <Hash size={14} className="text-cc-primary" />
                      <span>Tickets:</span>
                      <span className="text-cc-cream font-medium">{r.ticket_count}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-cc-text-muted">
                      <Repeat2 size={14} className="text-purple-400" />
                      <span>Promedio:</span>
                      <span className="text-cc-cream font-medium">{fmt(r.avg_ticket)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer totals */}
        {!loading && rows.length > 0 && (
          <div className="border-t border-white/10 p-5">
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-sm">
              <div>
                <p className="text-cc-text-muted text-xs">Total Mes</p>
                <p className="text-green-400 font-bold">{fmt(totals.total)}</p>
              </div>
              <div>
                <p className="text-cc-text-muted text-xs">Efectivo</p>
                <p className="text-cc-cream font-semibold">{fmt(totals.cash)}</p>
              </div>
              <div>
                <p className="text-cc-text-muted text-xs">Tarjeta</p>
                <p className="text-cc-cream font-semibold">{fmt(totals.card)}</p>
              </div>
              <div>
                <p className="text-cc-text-muted text-xs">Transferencia</p>
                <p className="text-cc-cream font-semibold">{fmt(totals.transfer)}</p>
              </div>
              <div>
                <p className="text-cc-text-muted text-xs">Socios Comerciales</p>
                <p className="text-violet-300 font-semibold">{fmt(totals.commercial)}</p>
              </div>
              <div>
                <p className="text-cc-text-muted text-xs">Tickets</p>
                <p className="text-cc-cream font-semibold">{totals.tickets}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
