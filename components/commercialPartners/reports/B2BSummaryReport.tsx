import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, ChevronRight, Loader2, Minus } from 'lucide-react';
import { supabase } from '../../../supabase';
import type { B2BDashboardSummary, B2BConversionSummary, B2BPipelineByStatus } from './b2bReportTypes';
import { formatCurrency, formatNumber, formatPercent } from './b2bReportHelpers';
import { B2BBalanceDetailModal } from './B2BBalanceDetailModal';
import { getB2BMonthlyAnalysis, getMonthBounds, type B2BMonthlyMetrics } from '../../../services/b2bMonthlyAnalysisService';

interface B2BSummaryReportProps { refreshTrigger?: number; month: string; }
type MetricFormat = 'currency' | 'number';

const monthLabel = (value: string): string => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  return new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
};
const previousMonthLabel = (month: string): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  return monthLabel(`${monthNumber === 1 ? year - 1 : year}-${String(monthNumber === 1 ? 12 : monthNumber - 1).padStart(2, '0')}`);
};
const valueLabel = (value: number, format: MetricFormat) => format === 'currency' ? formatCurrency(value) : formatNumber(value);

const MonthlyMetricCard = ({ label, value, previous, previousLabel, format = 'currency', detail }: {
  label: string; value: number; previous: number; previousLabel: string; format?: MetricFormat; detail?: string;
}) => {
  const delta = value - previous;
  const unchanged = delta === 0;
  const increased = delta > 0;
  const Icon = unchanged ? Minus : increased ? ArrowUp : ArrowDown;
  const color = unchanged ? 'text-cc-text-muted' : increased ? 'text-green-400' : 'text-red-400';
  const comparison = previous === 0 ? (value > 0 ? 'Nuevo' : 'Sin datos del mes anterior') : `${increased ? '+' : ''}${formatPercent(delta / Math.abs(previous))}`;
  const comparisonColor = previous === 0 ? (value > 0 ? 'text-green-400' : 'text-cc-text-muted') : color;
  return <div className="rounded-2xl border border-white/5 bg-cc-surface p-5"><p className="text-xs uppercase tracking-wide text-cc-text-muted">{label}</p><p className="mt-2 text-2xl font-bold text-cc-cream">{valueLabel(value, format)}</p>{detail && <p className="mt-1 text-xs text-cc-text-muted">{detail}</p>}<div className="mt-3 border-t border-white/5 pt-3 text-xs"><p className="text-cc-text-muted">{previousLabel}: {valueLabel(previous, format)}</p><p className={`mt-1 flex items-center gap-1 font-semibold ${comparisonColor}`}><Icon size={14} />{previous === 0 ? comparison : unchanged ? 'Sin cambio' : `${increased ? '+' : ''}${valueLabel(delta, format)} · ${comparison}`}</p></div></div>;
};

export const B2BSummaryReport = ({ refreshTrigger = 0, month }: B2BSummaryReportProps) => {
  const [summary, setSummary] = useState<B2BDashboardSummary | null>(null);
  const [pipeline, setPipeline] = useState<B2BPipelineByStatus[]>([]);
  const [conversion, setConversion] = useState<B2BConversionSummary | null>(null);
  const [monthly, setMonthly] = useState<{ selected: B2BMonthlyMetrics; previous: B2BMonthlyMetrics } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBalanceDetail, setShowBalanceDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conversionData = useMemo(() => {
    if (!conversion) return null;
    const registered = Number(conversion.total_registered ?? 0);
    const active = Number(conversion.active ?? 0);
    return { total_registered: registered, prospects: Number(conversion.prospects ?? 0), in_negotiation: Number(conversion.in_negotiation ?? 0), active, rejected: Number(conversion.rejected ?? 0), conversion_rate: Number(conversion.conversion_rate ?? (registered > 0 ? active / registered : 0)) };
  }, [conversion]);

  useEffect(() => {
    const loadData = async () => {
      if (!supabase) { setError('Supabase no está configurado'); setLoading(false); return; }
      try {
        setLoading(true); setError(null);
        const [summaryRes, pipelineRes, conversionRes, monthlyData] = await Promise.all([
          supabase.from('v_b2b_dashboard_summary').select('*').limit(1),
          supabase.from('v_b2b_pipeline_by_status').select('*'),
          supabase.from('v_b2b_conversion_summary').select('*').limit(1),
          getB2BMonthlyAnalysis(month),
        ]);
        if (summaryRes.error) throw summaryRes.error;
        if (pipelineRes.error) throw pipelineRes.error;
        if (conversionRes.error) throw conversionRes.error;
        setSummary((summaryRes.data?.[0] as B2BDashboardSummary) ?? null);
        setPipeline((pipelineRes.data as B2BPipelineByStatus[]) ?? []);
        setConversion((conversionRes.data?.[0] as B2BConversionSummary) ?? null);
        setMonthly({ selected: monthlyData.selected, previous: monthlyData.previous });
      } catch (caught: unknown) { console.error('Error loading B2B summary:', caught); setError(caught instanceof Error ? caught.message : 'Error al cargar resumen'); }
      finally { setLoading(false); }
    };
    void loadData();
  }, [month, refreshTrigger]);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-cc-primary" /></div>;
  if (error) return <div className="flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-6"><AlertCircle className="h-5 w-5 flex-shrink-0 text-red-400" /><div><h3 className="font-semibold text-red-300">Error al cargar datos</h3><p className="text-sm text-red-200">{error}</p></div></div>;
  if (!summary || !monthly) return <div className="py-12 text-center text-cc-text-muted">No hay datos todavía para este reporte.</div>;

  const previousLabel = previousMonthLabel(month);
  const current = monthly.selected;
  const previous = monthly.previous;
  const monthBounds = getMonthBounds(month);
  const conversionCards: Array<[string, string | number, string]> = [
    ['Registrados', conversionData?.total_registered ?? 0, 'text-cc-cream'], ['Prospectos', conversionData?.prospects ?? 0, 'text-yellow-400'], ['En negociación', conversionData?.in_negotiation ?? 0, 'text-orange-400'], ['Activos', conversionData?.active ?? 0, 'text-green-400'], ['Rechazados', conversionData?.rejected ?? 0, 'text-red-400'], ['Tasa conversión', formatPercent(conversionData?.conversion_rate), 'text-cc-cream'],
  ];

  return <div className="space-y-8">
    <section><div className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-bold text-cc-text-main">Resumen mensual B2B</h2><p className="text-sm capitalize text-cc-text-muted">{monthLabel(month)}</p></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"><MonthlyMetricCard label="Total generado / comprado" value={current.total_generated} previous={previous.total_generated} previousLabel={previousLabel} /><MonthlyMetricCard label="Total cobrado" value={current.total_paid} previous={previous.total_paid} previousLabel={previousLabel} /><MonthlyMetricCard label="Piezas vendidas" value={current.total_units} previous={previous.total_units} previousLabel={previousLabel} format="number" /></div></section>

    <section><h2 className="mb-4 text-lg font-bold text-cc-text-main">Estado actual</h2><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"><button onClick={() => setShowBalanceDetail(true)} className="group rounded-2xl border border-white/5 bg-cc-surface p-5 text-left transition-all hover:border-red-500/30 hover:bg-white/[0.02]"><div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-wide text-cc-text-muted">Saldo pendiente actual</p><p className="mt-2 text-2xl font-bold text-red-400">{formatCurrency(summary.b2b_pending_balance ?? 0)}</p><p className="mt-1 text-xs text-red-300">{formatNumber(summary.partners_with_pending_balance)} socios</p></div><ChevronRight className="h-5 w-5 text-red-400 opacity-0 transition-all group-hover:translate-x-1 group-hover:opacity-100" /></div></button><div className="rounded-2xl border border-white/5 bg-cc-surface p-5"><p className="text-xs uppercase tracking-wide text-cc-text-muted">Socios totales</p><p className="mt-2 text-2xl font-bold text-cc-cream">{formatNumber(summary.total_partners)}</p><p className="mt-1 text-xs text-cc-text-muted">{formatNumber(summary.active_partners)} activos</p></div><div className="rounded-2xl border border-white/5 bg-cc-surface p-5"><p className="text-xs uppercase tracking-wide text-cc-text-muted">Modelos</p><p className="mt-2 text-sm text-cc-text-main">Comodato: <b className="text-cc-cream">{formatNumber(summary.comodato_partners)}</b></p><p className="mt-1 text-sm text-cc-text-main">Mayoreo: <b className="text-cc-cream">{formatNumber(summary.wholesale_partners)}</b></p></div></div></section>

    <ChannelSection title="Comodato"><MonthlyMetricCard label="Generado" value={current.comodato_generated} previous={previous.comodato_generated} previousLabel={previousLabel} /><MonthlyMetricCard label="Cobrado" value={current.comodato_paid} previous={previous.comodato_paid} previousLabel={previousLabel} /><MonthlyMetricCard label="Piezas liquidadas" value={current.comodato_units} previous={previous.comodato_units} previousLabel={previousLabel} format="number" /></ChannelSection>
    <ChannelSection title="Mayoreo"><MonthlyMetricCard label="Comprado" value={current.wholesale_purchased} previous={previous.wholesale_purchased} previousLabel={previousLabel} /><MonthlyMetricCard label="Cobrado" value={current.wholesale_paid} previous={previous.wholesale_paid} previousLabel={previousLabel} /><MonthlyMetricCard label="Piezas compradas" value={current.wholesale_units} previous={previous.wholesale_units} previousLabel={previousLabel} format="number" /></ChannelSection>
    <ChannelSection title="Venta por Pieza"><MonthlyMetricCard label="Vendido" value={current.piece_generated} previous={previous.piece_generated} previousLabel={previousLabel} /><MonthlyMetricCard label="Cobrado" value={current.piece_paid} previous={previous.piece_paid} previousLabel={previousLabel} /><MonthlyMetricCard label="Piezas vendidas" value={current.piece_units} previous={previous.piece_units} previousLabel={previousLabel} format="number" /></ChannelSection>

    {conversionData && <section><h2 className="mb-4 text-lg font-bold text-cc-text-main">Tasa de conversión actual</h2><div className="grid grid-cols-1 gap-4 sm:grid-cols-3 xl:grid-cols-6">{conversionCards.map(([label, value, color]) => <div key={label} className="rounded-2xl border border-white/5 bg-cc-surface p-5"><p className="text-xs uppercase tracking-wide text-cc-text-muted">{label}</p><p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p></div>)}</div></section>}
    {pipeline.length > 0 && <section><h2 className="mb-4 text-lg font-bold text-cc-text-main">Pipeline por estado actual</h2><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{pipeline.map((item, index) => <div key={`${item.status}-${index}`} className="rounded-2xl border border-white/5 bg-cc-surface p-5"><p className="text-xs uppercase tracking-wide text-cc-text-muted">{item.status}</p><p className="mt-2 text-sm text-cc-text-main">Socios: <b className="text-cc-cream">{formatNumber(item.partner_count)}</b></p><p className="mt-1 text-sm text-cc-text-main">Generado: <b className="text-cc-cream">{formatCurrency(item.total_generated)}</b></p><p className="mt-1 text-sm text-cc-text-main">Pendiente: <b className="text-red-400">{formatCurrency(item.total_pending)}</b></p></div>)}</div></section>}
    <B2BBalanceDetailModal isOpen={showBalanceDetail} onClose={() => setShowBalanceDetail(false)} pieceSaleDateRange={{ start: new Date(`${monthBounds.start}T00:00:00Z`), end: new Date(`${monthBounds.endExclusive}T00:00:00Z`) }} />
  </div>;
};

const ChannelSection = ({ title, children }: { title: string; children: React.ReactNode }) => <section><h2 className="mb-4 text-lg font-bold text-cc-text-main">{title}</h2><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div></section>;
