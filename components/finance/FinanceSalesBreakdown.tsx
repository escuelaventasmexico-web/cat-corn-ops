import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Receipt, Store, Truck, UserRound, Users, X } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { getB2BMonthlyCollectionsReport } from '../../services/b2bMonthlyCollectionsService';
import { getCommercialCollections } from '../../services/commercialCollectionsService';
import {
  getConfirmedPieceSalePeriodSummary,
  getFinanceSalesBreakdown,
} from '../../services/financeSalesBreakdownService';
import type {
  FinanceBranchKey,
  FinanceSaleOperation,
  FinanceSalesBreakdown as FinanceSalesBreakdownData,
  FinanceSellerKey,
} from '../../lib/financeSalesBreakdown.js';
import { buildSalesParticipation, calculateGeneratedGrandTotal } from '../../lib/financeSalesBreakdown.js';

interface Props {
  monthStartISO: string;
}

interface B2BPeriodSummary {
  generated: number;
  collected: number;
  pending: number;
  generatedBySource: { comodato: number; mayoreo: number; pieceSale: number };
  collectedBySource: { comodato: number; mayoreo: number; pieceSale: number };
}

interface SelectedDetail {
  kind: 'branch' | 'seller';
  key: FinanceBranchKey | FinanceSellerKey;
  label: string;
}

const fmt = (value: number) => new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN',
}).format(value);

const formatDateTime = (value: string) => new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

const paymentLabel = (method: string) => ({
  CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', MIXED: 'Mixto',
}[method] ?? (method || '—'));

const nextMonthDate = (monthStartISO: string) => {
  const [year, month] = monthStartISO.split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return next.toISOString().slice(0, 10);
};

const nextDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

const lastMonthDate = (monthStartISO: string) => {
  const [year, month] = monthStartISO.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

const asUtcCalendarDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const PARTICIPATION_COLORS: Record<string, string> = {
  chipitlan: '#F4C542',
  aurrera: '#3B82F6',
  other: '#94A3B8',
  b2b: '#A855F7',
  orders: '#F59E0B',
  delivery: '#22C55E',
};

export const FinanceSalesBreakdown = ({ monthStartISO }: Props) => {
  const [sales, setSales] = useState<FinanceSalesBreakdownData | null>(null);
  const [b2b, setB2B] = useState<B2BPeriodSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDetail, setSelectedDetail] = useState<SelectedDetail | null>(null);
  const [selectedDate, setSelectedDate] = useState('');

  useEffect(() => { setSelectedDate(''); }, [monthStartISO]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      setSelectedDetail(null);
      try {
        const monthEndExclusive = nextMonthDate(monthStartISO);
        const periodStart = selectedDate || monthStartISO;
        const periodEndExclusive = selectedDate ? nextDate(selectedDate) : monthEndExclusive;
        const month = monthStartISO.slice(0, 7);
        const [salesResult, collectionsReport, collections, pieceSales] = await Promise.all([
          getFinanceSalesBreakdown(periodStart, periodEndExclusive),
          getB2BMonthlyCollectionsReport(month),
          getCommercialCollections(asUtcCalendarDate(periodStart), asUtcCalendarDate(periodEndExclusive)),
          getConfirmedPieceSalePeriodSummary(periodStart, periodEndExclusive),
        ]);
        if (collections.error) throw new Error(collections.error);

        const periodOperations = collectionsReport.operations.filter(operation => (
          operation.operation_date >= periodStart && operation.operation_date < periodEndExclusive
        ));
        const comodatoOperations = periodOperations.filter(operation => operation.source_type === 'comodato');
        const mayoreoOperations = periodOperations.filter(operation => operation.source_type === 'mayoreo');
        const comodatoGenerated = comodatoOperations.reduce((sum, operation) => sum + Number(operation.total_due || 0), 0);
        const mayoreoGenerated = mayoreoOperations.reduce((sum, operation) => sum + Number(operation.total_due || 0), 0);
        const comodatoPending = comodatoOperations
          .reduce((sum, operation) => sum + Number(operation.pending_amount || 0), 0);
        const mayoreoPending = mayoreoOperations
          .reduce((sum, operation) => sum + Number(operation.pending_amount || 0), 0);
        const periodB2B: B2BPeriodSummary = {
          generated: Math.round((comodatoGenerated + mayoreoGenerated + pieceSales.generated) * 100) / 100,
          collected: collections.total,
          pending: Math.round((comodatoPending + mayoreoPending + pieceSales.pending) * 100) / 100,
          generatedBySource: {
            comodato: comodatoGenerated,
            mayoreo: mayoreoGenerated,
            pieceSale: pieceSales.generated,
          },
          collectedBySource: {
            comodato: collections.bySource.comodato,
            mayoreo: collections.bySource.mayoreo,
            pieceSale: collections.bySource.pieceSale,
          },
        };
        if (!cancelled) {
          setSales(salesResult);
          setB2B(periodB2B);
        }
      } catch (reason: unknown) {
        if (!cancelled) {
          setSales(null);
          setB2B(null);
          setError(reason instanceof Error ? reason.message : 'No se pudo cargar el desglose financiero.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [monthStartISO, selectedDate]);

  const detailOperations = useMemo(() => {
    if (!sales || !selectedDetail) return [];
    return sales.operations.filter(operation => selectedDetail.kind === 'branch'
      ? operation.channel === 'pos' && operation.branchKey === selectedDetail.key
      : operation.channel === 'pos' && operation.branchKey === 'aurrera' && operation.sellerKey === selectedDetail.key);
  }, [sales, selectedDetail]);

  if (loading) return (
    <section className="rounded-2xl border border-white/5 bg-cc-surface p-8 flex items-center justify-center gap-3 text-cc-text-muted">
      <Loader2 className="animate-spin text-cc-primary" size={24} /> Cargando desglose por sucursal y vendedor…
    </section>
  );

  if (error || !sales || !b2b) return (
    <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 flex gap-3 text-red-200">
      <AlertCircle className="shrink-0 text-red-400" size={22} />
      <div><p className="font-semibold">No se pudo cargar el desglose de ventas</p><p className="text-sm mt-1">{error}</p></div>
    </section>
  );

  const visibleBranches = sales.branches.filter(branch => branch.key !== 'other' || branch.tickets > 0);
  const branchTotal = sales.branches.reduce((sum, branch) => sum + branch.total, 0);
  const branchReconciled = Math.round(branchTotal * 100) === Math.round(sales.channels.pos.total * 100);
  const generalGenerated = calculateGeneratedGrandTotal(sales.salesTotal, b2b.generated);
  const participation = buildSalesParticipation(sales, b2b.generated);
  const participationPercentage = participation.items.reduce((sum, item) => sum + item.percentage, 0);

  return (
    <section className="space-y-6">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h3 className="text-xl font-bold text-cc-cream">Ventas por sucursal y canal</h3><p className="text-sm text-cc-text-muted mt-1">Ventas generadas del periodo. La cobranza B2B se informa aparte y no se vuelve a sumar.</p></div>
          <div className="flex items-end gap-2">
            <button onClick={() => setSelectedDate('')} className={`px-3 py-2 rounded-lg border text-sm ${selectedDate ? 'border-white/10 text-cc-text-muted' : 'border-cc-primary/40 bg-cc-primary/10 text-cc-primary'}`}>Mes completo</button>
            <label className="text-xs text-cc-text-muted">Día<input type="date" min={monthStartISO} max={lastMonthDate(monthStartISO)} value={selectedDate} onChange={event => setSelectedDate(event.target.value)} className="block mt-1 rounded-lg bg-cc-bg border border-white/15 px-3 py-2 text-cc-cream" /></label>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {visibleBranches.map(branch => (
          <button key={branch.key} onClick={() => setSelectedDetail({ kind: 'branch', key: branch.key, label: branch.label })}
            className="p-5 rounded-xl border border-blue-500/25 bg-blue-500/5 text-left hover:bg-blue-500/10 transition-colors">
            <div className="flex items-center gap-2 text-blue-300"><Store size={19} /><span className="text-sm font-semibold">{branch.label} — POS</span></div>
            <p className="mt-3 text-2xl font-bold text-cc-cream">{fmt(branch.total)}</p>
            <p className="text-xs text-cc-text-muted">{branch.tickets} tickets · Promedio {fmt(branch.averageTicket)}</p>
          </button>
        ))}
        <ChannelCard icon={<Receipt size={19} />} title="Pedidos" amount={sales.channels.orders.total} tickets={sales.channels.orders.tickets} />
        <ChannelCard icon={<Truck size={19} />} title="Delivery" amount={sales.channels.delivery.total} tickets={sales.channels.delivery.tickets} />
        <div className="p-5 rounded-xl border border-violet-500/25 bg-violet-500/5 sm:col-span-2 xl:col-span-1">
          <div className="flex items-center gap-2 text-violet-300"><Users size={19} /><span className="text-sm font-semibold">Socios Comerciales</span></div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Metric label="Generado" value={b2b.generated} />
            <Metric label="Cobrado" value={b2b.collected} />
            <Metric label="Pendiente*" value={b2b.pending} />
          </div>
          <p className="mt-3 text-[11px] text-cc-text-muted">Generado: Comodato {fmt(b2b.generatedBySource.comodato)} · Mayoreo {fmt(b2b.generatedBySource.mayoreo)} · Pieza {fmt(b2b.generatedBySource.pieceSale)}</p>
          <p className="mt-1 text-[11px] text-cc-text-muted">Cobrado: Comodato {fmt(b2b.collectedBySource.comodato)} · Mayoreo {fmt(b2b.collectedBySource.mayoreo)} · Pieza {fmt(b2b.collectedBySource.pieceSale)}</p>
          <p className="mt-2 text-[10px] text-cc-text-muted">*Saldo vigente de las operaciones originadas en este periodo.</p>
        </div>
        <div className="p-5 rounded-xl border border-green-500/30 bg-green-500/10 sm:col-span-2 xl:col-span-3 flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm font-semibold text-green-300">Total general de ventas generadas</p><p className="text-xs text-cc-text-muted">POS + Pedidos + Delivery + ventas B2B generadas</p></div>
          <p className="text-3xl font-bold text-green-400">{fmt(generalGenerated)}</p>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h3 className="text-xl font-bold text-cc-cream">Ventas POS por vendedor</h3><p className="text-sm text-cc-text-muted mt-1">Aurrera usa el responsable seleccionado; Chipitlán usa el cajero autenticado. No se muestran comisiones.</p></div>
          <Reconciliation ok={sales.reconciliation.sellersMatchPos} label={`${fmt(sales.reconciliation.sellersTotal)} de ${fmt(sales.reconciliation.posTotal)} POS`} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
          {sales.sellers.map(seller => (
            <button key={seller.key} onClick={() => setSelectedDetail({ kind: 'seller', key: seller.key, label: seller.label })}
              className="p-5 rounded-xl border border-white/10 bg-cc-surface text-left hover:bg-white/5 transition-colors">
              <div className="flex items-center gap-2 text-cc-primary"><UserRound size={18} /><span className="font-semibold">{seller.label}</span></div>
              {seller.key === 'gerardo' ? (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-cc-text-muted">Ventas POS</span>
                    <span className="font-semibold text-cc-cream">{fmt(seller.total)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-violet-300">+ Socios Comerciales</span>
                    <span className="font-semibold text-violet-300">{fmt(b2b.generated)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2">
                    <span className="text-sm font-semibold text-cc-cream">Total POS + Socios</span>
                    <span className="text-xl font-bold text-cc-primary">{fmt(seller.total + b2b.generated)}</span>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-2xl font-bold text-cc-cream">{fmt(seller.total)}</p>
              )}
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-cc-text-muted">
                <span>{seller.tickets} tickets POS</span><span>{fmt(seller.averageTicket)} prom. POS</span><span>{seller.sharePercent.toFixed(1)}% POS</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-cc-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h3 className="text-xl font-bold text-cc-cream">Participación de ventas generadas</h3><p className="text-sm text-cc-text-muted mt-1">El total general representa el 100%; la cobranza B2B no se suma como una venta adicional.</p></div>
          <Reconciliation ok={participation.amountMatchesTotal && Math.abs(participationPercentage - 100) < 0.0001} label={`${fmt(participation.total)} · 100%`} />
        </div>
        {participation.items.length === 0 ? (
          <p className="py-12 text-center text-cc-text-muted">Sin ventas generadas en este periodo.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-[minmax(280px,0.9fr)_minmax(320px,1.1fr)] gap-6 items-center">
            <div className="h-[300px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={participation.items} dataKey="amount" nameKey="label" cx="50%" cy="50%" innerRadius={68} outerRadius={112} paddingAngle={2}>
                    {participation.items.map(item => <Cell key={item.key} fill={PARTICIPATION_COLORS[item.key] ?? '#CBD5E1'} />)}
                  </Pie>
                  <Tooltip formatter={(value: number, _name: string, entry: { payload?: { percentage?: number } }) => [`${fmt(Number(value))} · ${Number(entry.payload?.percentage ?? 0).toFixed(1)}%`, 'Ventas']} contentStyle={{ backgroundColor: '#202020', border: '1px solid #444', borderRadius: '8px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {participation.items.map(item => (
                <div key={item.key} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: PARTICIPATION_COLORS[item.key] ?? '#CBD5E1' }} />
                  <span className="text-sm font-medium text-cc-cream">{item.label}</span>
                  <span className="text-sm text-cc-text-muted">{fmt(item.amount)}</span>
                  <span className="w-14 text-right text-sm font-bold text-cc-primary">{item.percentage.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <Reconciliation ok={branchReconciled} label="Sucursales = POS" />
        <Reconciliation ok={sales.reconciliation.duplicateRows === 0} label={`${sales.reconciliation.uniqueRows} ventas únicas · ${sales.reconciliation.duplicateRows} duplicadas`} />
      </div>

      {selectedDetail && (
        <OperationsModal title={selectedDetail.label} operations={detailOperations} onClose={() => setSelectedDetail(null)} />
      )}
    </section>
  );
};

const ChannelCard = ({ icon, title, amount, tickets }: { icon: React.ReactNode; title: string; amount: number; tickets: number }) => (
  <div className="p-5 rounded-xl border border-amber-500/25 bg-amber-500/5">
    <div className="flex items-center gap-2 text-amber-300">{icon}<span className="text-sm font-semibold">{title}</span></div>
    <p className="mt-3 text-2xl font-bold text-cc-cream">{fmt(amount)}</p><p className="text-xs text-cc-text-muted">{tickets} tickets</p>
  </div>
);

const Metric = ({ label, value }: { label: string; value: number }) => <div><p className="text-[10px] uppercase text-cc-text-muted">{label}</p><p className="font-bold text-cc-cream">{fmt(value)}</p></div>;

const Reconciliation = ({ ok, label }: { ok: boolean; label: string }) => (
  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${ok ? 'border-green-500/30 bg-green-500/10 text-green-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
    {ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{label}
  </span>
);

const OperationsModal = ({ title, operations, onClose }: { title: string; operations: FinanceSaleOperation[]; onClose: () => void }) => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
    <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-white/10 bg-cc-surface shadow-2xl">
      <div className="p-5 flex items-center justify-between border-b border-white/10"><div><h3 className="text-lg font-bold text-cc-cream">{title}</h3><p className="text-xs text-cc-text-muted">{operations.length} operaciones · {fmt(operations.reduce((sum, operation) => sum + operation.total, 0))}</p></div><button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10"><X size={20} /></button></div>
      <div className="overflow-y-auto p-5">
        {operations.length === 0 ? <p className="py-10 text-center text-cc-text-muted">Sin operaciones en este periodo.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-cc-text-muted"><tr><th className="text-left pb-3">Fecha</th><th className="text-left pb-3">Ticket</th><th className="text-left pb-3">Método</th><th className="text-right pb-3">Importe</th></tr></thead><tbody>{operations.map(operation => <tr key={operation.id} className="border-t border-white/5"><td className="py-3 text-cc-cream">{formatDateTime(operation.createdAt)}</td><td className="py-3 font-mono text-cc-primary">#{operation.id.slice(0, 8).toUpperCase()}</td><td className="py-3 text-cc-text-muted">{paymentLabel(operation.paymentMethod)}</td><td className="py-3 text-right font-semibold text-cc-cream">{fmt(operation.total)}</td></tr>)}</tbody></table></div>
        )}
      </div>
    </div>
  </div>
);
