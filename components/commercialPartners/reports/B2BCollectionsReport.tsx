import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, Download, Loader2 } from 'lucide-react';
import { supabase } from '../../../supabase';
import { B2BMonthlyCollectionOperation, B2BMonthlyCollectionsReport, getB2BMonthlyCollectionsReport, getMexicoCityCurrentMonth } from '../../../services/b2bMonthlyCollectionsService';
import { B2BCollectionReport, B2BPendingBalance } from './b2bReportTypes';
import { exportToCSV, formatCurrency, formatNumber } from './b2bReportHelpers';

interface Props { refreshTrigger?: number; onPartnerSelect?: (partnerId: string) => void; }
type Status = 'all' | 'pending' | 'partial' | 'paid';
type Source = 'all' | 'comodato' | 'mayoreo';

const statusLabel: Record<Status, string> = { all: 'Todos', pending: 'Pendiente', partial: 'Parcial', paid: 'Pagado' };
const dateSourceLabel: Record<B2BMonthlyCollectionOperation['operation_date_source'], string> = {
  settlement_created_at: 'Liquidación registrada', released_at: 'Producto liberado',
  delivery_date_historical_fallback: 'Fecha de entrega (histórica)', order_date_historical_fallback: 'Fecha de pedido (histórica)',
};
const formatMexicoDateTime = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(value)) : '—';
/** Formats a business calendar date without moving it across time zones. */
const formatBusinessDate = (value: string | null | undefined) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(Date.UTC(year, month - 1, day)));
};

export const B2BCollectionsReport = ({ refreshTrigger = 0, onPartnerSelect }: Props) => {
  const [month, setMonth] = useState(getMexicoCityCurrentMonth);
  const [report, setReport] = useState<B2BMonthlyCollectionsReport | null>(null);
  const [balances, setBalances] = useState<B2BPendingBalance[]>([]);
  const [balanceSummary, setBalanceSummary] = useState<B2BCollectionReport | null>(null);
  const [status, setStatus] = useState<Status>('all');
  const [source, setSource] = useState<Source>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const load = async () => {
      setLoading(true); setError(null);
      try {
        const [monthly, balanceRows, summary] = await Promise.all([
          getB2BMonthlyCollectionsReport(month),
          client.from('v_b2b_pending_balances').select('*'),
          client.from('v_b2b_collection_report').select('*').limit(1),
        ]);
        if (balanceRows.error) throw balanceRows.error;
        if (summary.error) throw summary.error;
        setReport(monthly);
        setBalances((balanceRows.data ?? []) as B2BPendingBalance[]);
        setBalanceSummary((summary.data?.[0] as B2BCollectionReport) ?? null);
      } catch (err: any) { setReport(null); setError(err?.message || 'Error al cargar cobranza'); }
      finally { setLoading(false); }
    };
    load();
  }, [month, refreshTrigger]);

  const operations = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('es-MX');
    return (report?.operations ?? []).filter(operation => {
      if (status !== 'all' && operation.payment_status !== status) return false;
      if (source !== 'all' && operation.source_type !== source) return false;
      if (!needle) return true;
      return [operation.business_name, operation.responsible_name, operation.partner_folio, operation.operation_folio,
        ...operation.products.flatMap(product => [product.product_name, product.product_variant, product.product_size])]
        .filter(Boolean).join(' ').toLocaleLowerCase('es-MX').includes(needle);
    });
  }, [report, search, source, status]);

  const exportOperations = () => exportToCSV('cobranza_b2b_operaciones', operations.map(operation => ({
    origen: operation.source_type, folio_operacion: operation.operation_folio, socio: operation.business_name || '—',
    fecha_registro: formatMexicoDateTime(operation.registered_at), productos: operation.products.map(p => p.product_name || 'Sin nombre').join(' | '),
    generado: operation.total_due, pagado: operation.total_paid, pendiente: operation.pending_amount,
    estado: statusLabel[operation.payment_status], dias_esperando_pago: operation.days_waiting_payment,
    vence: formatMexicoDateTime(operation.payment_due_at), dias_vencida: operation.days_overdue,
    fecha_pago_completo: formatBusinessDate(operation.fully_paid_on),
  })), [
    { key: 'origen', label: 'Origen' }, { key: 'folio_operacion', label: 'Folio operación' }, { key: 'socio', label: 'Socio' },
    { key: 'fecha_registro', label: 'Fecha de registro' }, { key: 'productos', label: 'Productos' }, { key: 'generado', label: 'Generado' },
    { key: 'pagado', label: 'Pagado acumulado' }, { key: 'pendiente', label: 'Pendiente' }, { key: 'estado', label: 'Estado' },
    { key: 'dias_esperando_pago', label: 'Días esperando pago' }, { key: 'vence', label: 'Vence' },
    { key: 'dias_vencida', label: 'Días vencida' }, { key: 'fecha_pago_completo', label: 'Fecha pago completo' },
  ]);

  if (loading) return <div className="h-64 flex items-center justify-center"><Loader2 className="w-8 h-8 text-cc-primary animate-spin" /></div>;
  if (error) return <div className="p-6 rounded-2xl border border-red-500/30 bg-red-500/10 flex gap-3 text-red-200"><AlertCircle className="w-5 h-5 text-red-400" />{error}</div>;
  if (!report) return null;

  const summary = report.summary;
  const cards: Array<[string, string | number]> = [
    ['Generado en el mes', summary.total_generated], ['Pagado de operaciones del mes', summary.total_paid_for_operations],
    ['Pendiente de operaciones del mes', summary.pending_amount_for_operations], ['Cobrado durante el mes', summary.collected_during_month],
  ];
  return <div className="space-y-6">
    <div className="flex flex-wrap gap-3 items-end p-4 rounded-2xl bg-cc-surface border border-white/5">
      <label className="text-sm text-cc-text-muted">Mes<input type="month" value={month} onChange={e => setMonth(e.target.value)} className="block mt-1 rounded-lg bg-cc-bg border border-white/15 px-3 py-2 text-cc-cream" /></label>
      <label className="text-sm text-cc-text-muted">Estado<select value={status} onChange={e => setStatus(e.target.value as Status)} className="block mt-1 rounded-lg bg-cc-bg border border-white/15 px-3 py-2 text-cc-cream">{(['all', 'pending', 'partial', 'paid'] as Status[]).map(value => <option key={value} value={value}>{statusLabel[value]}</option>)}</select></label>
      <label className="text-sm text-cc-text-muted">Origen<select value={source} onChange={e => setSource(e.target.value as Source)} className="block mt-1 rounded-lg bg-cc-bg border border-white/15 px-3 py-2 text-cc-cream"><option value="all">Todos</option><option value="comodato">Comodato</option><option value="mayoreo">Mayoreo</option></select></label>
      <label className="text-sm text-cc-text-muted flex-1 min-w-[210px]">Buscar<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Socio, folio o producto" className="block mt-1 w-full rounded-lg bg-cc-bg border border-white/15 px-3 py-2 text-cc-cream" /></label>
      <button onClick={exportOperations} disabled={!operations.length} className="flex gap-2 items-center px-4 py-2 rounded-lg text-cc-primary bg-cc-primary/20 disabled:opacity-40"><Download size={16} />Exportar visibles</button>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">{cards.map(([label, value]) => <div key={label} className="p-5 rounded-2xl bg-cc-surface border border-white/5"><p className="text-xs uppercase text-cc-text-muted">{label}</p><p className="mt-2 text-2xl font-bold text-cc-cream">{formatCurrency(Number(value))}</p></div>)}</div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div className="p-5 rounded-2xl bg-cc-surface border border-white/5"><p className="text-xs uppercase text-cc-text-muted">Operaciones pendientes</p><p className="mt-2 text-2xl font-bold text-red-400">{formatNumber(summary.pending_operations_count + summary.partial_operations_count)}</p><p className="text-xs text-cc-text-muted">{summary.partners_with_pending_count} socios con saldo.</p></div><div className="p-5 rounded-2xl bg-cc-surface border border-white/5"><p className="text-xs uppercase text-cc-text-muted">Pendiente más antiguo</p>{summary.oldest_pending_operation ? <><p className="mt-2 font-semibold text-cc-cream">{summary.oldest_pending_operation.business_name || summary.oldest_pending_operation.operation_folio}</p><p className="text-sm text-cc-text-muted">{summary.oldest_pending_operation.days_waiting_payment} días · {formatCurrency(summary.oldest_pending_operation.pending_amount)}</p></> : <p className="mt-2 text-sm text-cc-text-muted">Sin saldo pendiente.</p>}</div></div>

    <section><div className="flex justify-between mb-3"><h3 className="font-semibold text-cc-cream">Operaciones originadas en el mes</h3><span className="text-sm text-cc-text-muted">{operations.length} visibles</span></div>{!operations.length ? <div className="py-12 text-center rounded-2xl bg-cc-surface border border-white/5 text-cc-text-muted">No hay liquidaciones registradas ni pedidos liberados en este mes.</div> : <div className="space-y-3">{operations.map(operation => <OperationCard key={`${operation.source_type}-${operation.operation_id}`} operation={operation} expanded={expanded === operation.operation_id} onToggle={() => setExpanded(expanded === operation.operation_id ? null : operation.operation_id)} onPartnerSelect={onPartnerSelect} />)}</div>}</section>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><section className="p-5 rounded-2xl bg-cc-surface border border-white/5"><h3 className="font-semibold text-cc-cream">Velocidad de pago</h3><p className="text-xs text-cc-text-muted">Mediana de días; mínimo 3 operaciones pagadas.</p><div className="grid grid-cols-2 gap-4 mt-4"><Ranking label="Más rápido" value={report.payment_speed_rankings.fastest_partner} /><Ranking label="Más lento" value={report.payment_speed_rankings.slowest_partner} /></div></section><section className="p-5 rounded-2xl bg-cc-surface border border-white/5"><h3 className="font-semibold text-cc-cream">Antigüedad de saldos pendientes</h3><div className="grid grid-cols-2 gap-3 mt-4">{[['0–2 días', report.aging.days_0_2], ['3–7 días', report.aging.days_3_7], ['8–15 días', report.aging.days_8_15], ['Más de 15 días', report.aging.days_over_15]].map(([label, value]) => <div key={label}><p className="text-xs text-cc-text-muted">{label}</p><p className="font-semibold text-cc-cream">{formatCurrency(Number(value))}</p></div>)}</div></section></div>

    <section className="p-5 rounded-2xl bg-cc-surface border border-white/5"><h3 className="font-semibold text-cc-cream">Saldos actuales por socio</h3><p className="text-xs text-cc-text-muted">Vista vigente, separada de las operaciones originadas en el mes.</p><div className="overflow-x-auto mt-4"><table className="w-full text-sm"><thead className="text-xs text-cc-text-muted"><tr><th className="text-left pb-2">Socio</th><th className="text-right pb-2">Comodato</th><th className="text-right pb-2">Mayoreo</th><th className="text-right pb-2">Total</th><th /></tr></thead><tbody>{balances.map(balance => <tr key={balance.partner_id} className="border-t border-white/5"><td className="py-2 text-cc-cream">{balance.business_name}</td><td className="py-2 text-right">{formatCurrency(balance.comodato_pending)}</td><td className="py-2 text-right">{formatCurrency(balance.wholesale_pending)}</td><td className="py-2 text-right text-red-400 font-semibold">{formatCurrency(balance.b2b_pending_balance)}</td><td className="py-2 text-right"><button onClick={() => onPartnerSelect?.(balance.partner_id)} className="text-cc-primary">Ver socio</button></td></tr>)}</tbody></table></div>{balanceSummary && <p className="mt-3 text-xs text-cc-text-muted">Saldo vigente total: {formatCurrency(balanceSummary.total_pending)}</p>}</section>
  </div>;
};

const Ranking = ({ label, value }: { label: string; value: B2BMonthlyCollectionsReport['payment_speed_rankings']['fastest_partner'] }) => <div><p className="text-xs text-cc-text-muted">{label}</p>{value ? <><p className="font-semibold text-cc-cream">{value.business_name || '—'}</p><p className="text-sm text-cc-primary">{formatNumber(Number(value.median_days), 1)} días · {value.operations_count} ops.</p></> : <p className="text-sm text-cc-text-muted">Historial insuficiente</p>}</div>;

const OperationCard = ({ operation, expanded, onToggle, onPartnerSelect }: { operation: B2BMonthlyCollectionOperation; expanded: boolean; onToggle: () => void; onPartnerSelect?: (id: string) => void }) => <article className="rounded-2xl bg-cc-surface border border-white/5 overflow-hidden"><div className="p-4 grid grid-cols-1 lg:grid-cols-[1.5fr_repeat(3,auto)] gap-4 items-center"><div><div className="flex gap-2"><span className="uppercase text-xs px-2 py-1 rounded bg-white/10 text-cc-text-muted">{operation.source_type}</span><span className="font-mono text-xs text-cc-primary">{operation.operation_folio}</span></div><p className="mt-2 font-semibold text-cc-cream">{operation.business_name || 'Socio sin nombre'} {operation.partner_folio && <span className="font-normal text-cc-text-muted">· {operation.partner_folio}</span>}</p><p className="text-xs text-cc-text-muted">{dateSourceLabel[operation.operation_date_source]}: {formatMexicoDateTime(operation.registered_at)}</p></div><Money label="Generado / pagado" value={`${formatCurrency(operation.total_due)} / ${formatCurrency(operation.total_paid)}`} /><Money label="Pendiente" value={formatCurrency(operation.pending_amount)} danger /><div className="flex items-center gap-2"><span className={`text-xs px-2 py-1 rounded ${operation.payment_status === 'paid' ? 'bg-green-500/15 text-green-300' : operation.payment_status === 'partial' ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-300'}`}>{statusLabel[operation.payment_status]}</span><button onClick={onToggle} className="p-2 text-cc-primary"><ChevronDown size={18} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} /></button></div></div>{expanded && <div className="p-4 border-t border-white/5"><div className="flex flex-wrap justify-between gap-3 text-sm mb-3"><span>Días esperando pago: <b>{operation.days_waiting_payment}</b></span><span>Pago completo: <b>{formatBusinessDate(operation.fully_paid_on)}</b></span>{operation.payment_due_at && <span>Vence: <b>{formatMexicoDateTime(operation.payment_due_at)}</b>{operation.pending_amount > 0 && operation.days_overdue > 0 && <em className="not-italic text-red-300"> · Vencida por {operation.days_overdue} días</em>}</span>}<button onClick={() => onPartnerSelect?.(operation.partner_id)} className="text-cc-primary font-semibold">Ver socio</button></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-cc-text-muted"><tr><th className="text-left pb-2">Producto</th><th className="text-right pb-2">Cantidad</th><th className="text-right pb-2">Precio histórico</th><th className="text-right pb-2">Importe</th></tr></thead><tbody>{operation.products.map((p, index) => <tr key={`${p.product_name}-${index}`} className="border-t border-white/5"><td className="py-2">{p.product_name || 'Sin nombre'}{p.product_variant ? ` — ${p.product_variant}` : ''}{p.product_size ? ` (${p.product_size})` : ''}{p.historical_identity_unverified && <span className="ml-2 text-xs text-amber-300">Histórico sin ID</span>}</td><td className="py-2 text-right">{formatNumber(p.quantity)}</td><td className="py-2 text-right">{formatCurrency(p.unit_price)}</td><td className="py-2 text-right">{formatCurrency(p.amount)}</td></tr>)}</tbody></table></div></div>}</article>;
const Money = ({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) => <div><p className="text-xs text-cc-text-muted">{label}</p><p className={danger ? 'font-semibold text-red-400' : 'font-semibold text-cc-cream'}>{value}</p></div>;
