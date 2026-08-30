import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Clock3,
  Download,
  Loader2,
  Package,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getB2BProductAnalytics } from '../../../services/b2bProductAnalyticsService';
import type {
  B2BPartnerSpoilage,
  B2BProductAnalyticsResponse,
  B2BProductPerformance,
} from './b2bReportTypes';
import { formatCurrency, formatDate, formatNumber } from './b2bReportHelpers';
import { exportB2BProductAnalytics } from './exportB2BProductAnalytics';

interface B2BProductsReportProps {
  refreshTrigger?: number;
}

type PeriodPreset = 'current' | 'previous' | 'last30' | 'custom';
type ProductSort = 'units' | 'revenue' | 'liquidation' | 'spoilage' | 'spoilageCost';
type SpoilageSort = 'units' | 'cost' | 'rate';

interface DateRange {
  start: string;
  endExclusive: string;
}

const CHART_COLORS = ['#F4C542', '#F47BAA', '#06B6D4', '#A855F7', '#10B981', '#FB923C', '#60A5FA'];
const QUALITY_LABELS: Record<string, string> = {
  unmapped_products: 'Productos sin correspondencia',
  ambiguous_products: 'Productos con correspondencia ambigua',
  rows_without_product_id: 'Filas sin product_id',
  rows_without_product_code: 'Filas sin product_code',
  fifo_impossible_groups: 'Grupos incompatibles con FIFO',
  negative_inventory_groups: 'Grupos con inventario negativo',
  amount_reconciliation_errors: 'Diferencias de importe',
  orders_without_items: 'Órdenes entregadas sin artículos',
  rows_without_unit_cost: 'Filas sin costo unitario vigente',
};

const getMexicoToday = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const parseDate = (value: string): Date => new Date(`${value}T00:00:00Z`);
const dateOnly = (value: Date): string => value.toISOString().slice(0, 10);

const addDays = (value: string, amount: number): string => {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateOnly(date);
};

const monthRange = (monthOffset: number): DateRange => {
  const today = parseDate(getMexicoToday());
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + monthOffset, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start: dateOnly(start), endExclusive: dateOnly(end) };
};

const presetRange = (preset: Exclude<PeriodPreset, 'custom'>): DateRange => {
  if (preset === 'current') return monthRange(0);
  if (preset === 'previous') return monthRange(-1);
  const today = getMexicoToday();
  return { start: addDays(today, -29), endExclusive: addDays(today, 1) };
};

const productLabel = (product: {
  product_name: string;
  product_variant: string | null;
  product_size?: string | null;
}): string =>
  [product.product_name, product.product_variant, product.product_size]
    .filter(Boolean)
    .join(' · ');

const nullableCurrency = (value: number | null): string =>
  value === null ? 'No disponible' : formatCurrency(value);

const nullableDays = (value: number | null): string =>
  value === null ? 'No disponible' : `${formatNumber(value, 1)} días`;

const ProductTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: B2BProductPerformance }>;
}) => {
  const product = payload?.[0]?.payload;
  if (!active || !product) return null;
  return (
    <div className="rounded-lg border border-white/15 bg-[#171717] p-3 text-xs shadow-xl">
      <p className="mb-2 font-bold text-cc-cream">{productLabel(product)}</p>
      <p className="text-cc-text-muted">Unidades: <span className="text-cc-text-main">{formatNumber(product.units_sold)}</span></p>
      <p className="text-cc-text-muted">Ingreso: <span className="text-cc-primary">{formatCurrency(product.generated_revenue)}</span></p>
      <p className="text-cc-text-muted">Comodato: <span className="text-cc-text-main">{formatNumber(product.comodato_units)}</span></p>
      <p className="text-cc-text-muted">Mayoreo: <span className="text-cc-text-main">{formatNumber(product.wholesale_units)}</span></p>
    </div>
  );
};

const SpoilageTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: B2BPartnerSpoilage }>;
}) => {
  const partner = payload?.[0]?.payload;
  if (!active || !partner) return null;
  return (
    <div className="rounded-lg border border-white/15 bg-[#171717] p-3 text-xs shadow-xl">
      <p className="mb-2 font-bold text-cc-cream">{partner.partner_name}</p>
      <p className="text-cc-text-muted">Piezas: <span className="text-cc-text-main">{formatNumber(partner.spoiled_units)}</span></p>
      <p className="text-cc-text-muted">Costo estimado vigente: <span className="text-cc-primary">{nullableCurrency(partner.estimated_waste_cost)}</span></p>
      <p className="text-cc-text-muted">Tasa: <span className="text-cc-text-main">{formatNumber(partner.spoilage_rate * 100, 1)}%</span></p>
    </div>
  );
};

export const B2BProductsReport = ({ refreshTrigger = 0 }: B2BProductsReportProps) => {
  const [preset, setPreset] = useState<PeriodPreset>('current');
  const [range, setRange] = useState<DateRange>(() => presetRange('current'));
  const [report, setReport] = useState<B2BProductAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productSort, setProductSort] = useState<ProductSort>('units');
  const [spoilageSort, setSpoilageSort] = useState<SpoilageSort>('units');

  const loadData = useCallback(async () => {
    if (!range.start || !range.endExclusive || range.start >= range.endExclusive) {
      setError('El inicio debe ser anterior al fin exclusivo del periodo.');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setReport(await getB2BProductAnalytics(range.start, range.endExclusive));
    } catch (caught: unknown) {
      console.error('Error loading B2B product analytics:', caught);
      setError(caught instanceof Error ? caught.message : 'Error al cargar el análisis de productos B2B');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void loadData();
  }, [loadData, refreshTrigger]);

  const selectPreset = (next: PeriodPreset) => {
    setPreset(next);
    if (next !== 'custom') setRange(presetRange(next));
  };

  const sortedProducts = useMemo(() => {
    if (!report) return [];
    const value = (product: B2BProductPerformance): number => {
      if (productSort === 'revenue') return product.generated_revenue;
      if (productSort === 'liquidation') return product.weighted_average_liquidation_days ?? -1;
      if (productSort === 'spoilage') return product.spoiled_units;
      if (productSort === 'spoilageCost') return product.estimated_waste_cost ?? -1;
      return product.units_sold;
    };
    return [...report.products].sort((a, b) => value(b) - value(a));
  }, [productSort, report]);

  const sortedSpoilage = useMemo(() => {
    if (!report) return [];
    const value = (partner: B2BPartnerSpoilage): number => {
      if (spoilageSort === 'cost') return partner.estimated_waste_cost ?? -1;
      if (spoilageSort === 'rate') return partner.spoilage_rate;
      return partner.spoiled_units;
    };
    return [...report.spoilage_by_partner].sort((a, b) => value(b) - value(a));
  }, [report, spoilageSort]);

  const exportReport = async () => {
    if (!report) return;
    try {
      setExporting(true);
      await exportB2BProductAnalytics(report);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'No fue posible exportar el reporte');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-cc-surface p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-xl font-bold text-cc-cream">Análisis de productos B2B</h2>
            <p className="mt-1 text-sm text-cc-text-muted">Ventas reconocidas de comodato y mayoreo; cobranza excluida del reconocimiento.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {([
              ['current', 'Mes actual'],
              ['previous', 'Mes anterior'],
              ['last30', 'Últimos 30 días'],
              ['custom', 'Rango personalizado'],
            ] as Array<[PeriodPreset, string]>).map(([id, label]) => (
              <button key={id} onClick={() => selectPreset(id)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${preset === id ? 'bg-cc-primary text-cc-bg' : 'bg-white/10 text-cc-text-main hover:bg-white/15'}`}>
                {label}
              </button>
            ))}
            {preset === 'custom' && (
              <>
                <label className="text-xs text-cc-text-muted">Inicio<input type="date" value={range.start} onChange={event => setRange(current => ({ ...current, start: event.target.value }))} className="ml-2 rounded-lg border border-white/10 bg-cc-bg px-2 py-2 text-cc-text-main" /></label>
                <label className="text-xs text-cc-text-muted">Fin exclusivo<input type="date" value={range.endExclusive} onChange={event => setRange(current => ({ ...current, endExclusive: event.target.value }))} className="ml-2 rounded-lg border border-white/10 bg-cc-bg px-2 py-2 text-cc-text-main" /></label>
              </>
            )}
            <button onClick={() => void loadData()} disabled={loading} className="rounded-lg border border-white/10 bg-white/10 p-2 text-cc-text-main hover:bg-white/15 disabled:opacity-50" title="Actualizar"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button>
            <button onClick={() => void exportReport()} disabled={!report || exporting} className="flex items-center gap-2 rounded-lg border border-cc-primary/30 bg-cc-primary/15 px-3 py-2 text-xs font-semibold text-cc-primary hover:bg-cc-primary/25 disabled:opacity-50">
              {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Exportar XLSX
            </button>
          </div>
        </div>
      </section>

      {error && <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200"><AlertCircle size={19} />{error}</div>}
      {loading && !report && <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-cc-primary" /></div>}

      {report && (
        <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard icon={<Package size={20} />} label="Unidades vendidas" value={formatNumber(report.summary.units_sold)} detail={`${formatNumber(report.summary.comodato_units)} comodato · ${formatNumber(report.summary.wholesale_units)} mayoreo`} />
            <MetricCard icon={<TrendingUp size={20} />} label="Ingreso generado" value={formatCurrency(report.summary.generated_revenue)} detail={`${formatCurrency(report.summary.comodato_revenue)} comodato · ${formatCurrency(report.summary.wholesale_revenue)} mayoreo`} />
            <MetricCard icon={<BarChart3 size={20} />} label="Producto más vendido" value={report.summary.top_product ? productLabel(report.summary.top_product) : 'Sin datos'} detail={report.summary.top_product ? `${formatNumber(report.summary.top_product.units_sold)} piezas · ${formatCurrency(report.summary.top_product.generated_revenue)}` : undefined} />
            <MetricCard icon={<Clock3 size={20} />} label="Tiempo de liquidación (comodato)" value={nullableDays(report.summary.weighted_average_liquidation_days)} detail={`Mediana ponderada: ${nullableDays(report.summary.weighted_median_liquidation_days)}`} />
            <MetricCard icon={<ShieldAlert size={20} />} label="Merma registrada" value={`${formatNumber(report.summary.spoilage_units)} piezas`} detail={`Costo estimado vigente: ${nullableCurrency(report.summary.estimated_waste_cost)}`} />
            <MetricCard icon={<ShieldAlert size={20} />} label="Socio con mayor merma" value={report.summary.top_spoilage_partner?.partner_name ?? 'Sin datos'} detail={report.summary.top_spoilage_partner ? `${formatNumber(report.summary.top_spoilage_partner.spoiled_units)} piezas · ${formatNumber(report.summary.top_spoilage_partner.spoilage_rate * 100, 1)}% · Costo estimado vigente: ${nullableCurrency(report.summary.top_spoilage_partner.estimated_waste_cost)} · Absorbido por ${report.summary.top_spoilage_partner.cost_responsibility === 'catcorn' ? 'Cat Corn' : report.summary.top_spoilage_partner.cost_responsibility}` : undefined} />
          </section>

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ChartCard title="Productos más vendidos">
              <ResponsiveContainer width="100%" height={330}>
                <BarChart data={sortedProducts.slice(0, 10)} margin={{ top: 10, right: 12, bottom: 75, left: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="product_key" interval={0} angle={-35} textAnchor="end" tick={{ fill: '#A3A3A3', fontSize: 10 }} tickFormatter={(_, index) => productLabel(sortedProducts[index] ?? { product_name: '—', product_variant: null })} />
                  <YAxis tick={{ fill: '#A3A3A3', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ProductTooltip />} />
                  <Bar dataKey="units_sold" radius={[6, 6, 0, 0]}>{sortedProducts.slice(0, 10).map((product, index) => <Cell key={product.product_key} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Merma por socio">
              <ResponsiveContainer width="100%" height={330}>
                <BarChart data={sortedSpoilage} margin={{ top: 10, right: 12, bottom: 75, left: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="partner_name" interval={0} angle={-35} textAnchor="end" tick={{ fill: '#A3A3A3', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#A3A3A3', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<SpoilageTooltip />} />
                  <Bar dataKey="spoiled_units" fill="#F47BAA" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          <DataTableSection title="Rendimiento por producto" control={<SortSelect value={productSort} onChange={value => setProductSort(value as ProductSort)} options={[['units', 'Unidades'], ['revenue', 'Ingreso'], ['liquidation', 'Tiempo de liquidación'], ['spoilage', 'Merma'], ['spoilageCost', 'Costo de merma']]} />}>
            <table className="min-w-[1500px] w-full text-xs">
              <thead className="bg-white/5 text-cc-text-muted"><tr>{['Producto', 'Variante', 'Tamaño', 'Unidades vendidas', 'Ingreso generado', 'Socios distintos', 'Comodato unidades', 'Comodato importe', 'Mayoreo unidades', 'Mayoreo importe', 'Promedio días', 'Mediana días', 'Merma piezas', 'Costo estimado vigente'].map((label, index) => <th key={label} className={`px-3 py-3 ${index < 3 ? 'text-left' : 'text-right'}`}>{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-white/5">{sortedProducts.map(product => <tr key={product.product_key} className="text-cc-text-main hover:bg-white/[0.03]"><td className="px-3 py-3 font-semibold text-cc-cream">{product.product_name}</td><td className="px-3 py-3">{product.product_variant ?? '—'}</td><td className="px-3 py-3">{product.product_size ?? '—'}</td><NumberCell value={formatNumber(product.units_sold)} /><NumberCell value={formatCurrency(product.generated_revenue)} /><NumberCell value={formatNumber(product.distinct_partners)} /><NumberCell value={formatNumber(product.comodato_units)} /><NumberCell value={formatCurrency(product.comodato_revenue)} /><NumberCell value={formatNumber(product.wholesale_units)} /><NumberCell value={formatCurrency(product.wholesale_revenue)} /><NumberCell value={nullableDays(product.weighted_average_liquidation_days)} /><NumberCell value={nullableDays(product.weighted_median_liquidation_days)} /><NumberCell value={formatNumber(product.spoiled_units)} /><NumberCell value={nullableCurrency(product.estimated_waste_cost)} /></tr>)}</tbody>
            </table>
          </DataTableSection>

          <DataTableSection title="Merma por socio" control={<SortSelect value={spoilageSort} onChange={value => setSpoilageSort(value as SpoilageSort)} options={[['units', 'Piezas mermadas'], ['cost', 'Costo estimado'], ['rate', 'Tasa de merma']]} />}>
            <table className="min-w-[1050px] w-full text-xs">
              <thead className="bg-white/5 text-cc-text-muted"><tr>{['Socio', 'Piezas mermadas', 'Costo estimado vigente', 'Piezas vendidas', 'Piezas retiradas', 'Piezas resueltas', 'Tasa de merma', 'Responsable del costo'].map((label, index) => <th key={label} className={`px-3 py-3 ${index === 0 || index === 7 ? 'text-left' : 'text-right'}`}>{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-white/5">{sortedSpoilage.map(partner => <tr key={partner.partner_id} className="text-cc-text-main hover:bg-white/[0.03]"><td className="px-3 py-3 font-semibold text-cc-cream">{partner.partner_name}</td><NumberCell value={formatNumber(partner.spoiled_units)} /><NumberCell value={nullableCurrency(partner.estimated_waste_cost)} /><NumberCell value={formatNumber(partner.sold_units)} /><NumberCell value={formatNumber(partner.withdrawn_units)} /><NumberCell value={formatNumber(partner.resolved_units)} /><NumberCell value={`${formatNumber(partner.spoilage_rate * 100, 2)}%`} /><td className="px-3 py-3">{partner.cost_responsibility === 'catcorn' ? 'Cat Corn' : partner.cost_responsibility}</td></tr>)}</tbody>
            </table>
          </DataTableSection>

          <DataTableSection title={`Inventario lento · ${formatNumber(report.summary.open_inventory_units)} piezas abiertas`}>
            <table className="min-w-[1150px] w-full text-xs">
              <thead className="bg-white/5 text-cc-text-muted"><tr>{['Socio', 'Producto', 'Variante', 'Tamaño', 'Piezas en posesión', 'Entrega más antigua', 'Antigüedad', 'Rango', 'Valor estimado a costo vigente'].map((label, index) => <th key={label} className={`px-3 py-3 ${index < 4 ? 'text-left' : 'text-right'}`}>{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-white/5">{report.slow_inventory.map(item => <tr key={`${item.partner_id}-${item.product_key}`} className="text-cc-text-main hover:bg-white/[0.03]"><td className="px-3 py-3 font-semibold text-cc-cream">{item.partner_name}</td><td className="px-3 py-3">{item.product_name}</td><td className="px-3 py-3">{item.product_variant ?? '—'}</td><td className="px-3 py-3">{item.product_size ?? '—'}</td><NumberCell value={formatNumber(item.units_in_possession)} /><NumberCell value={formatDate(item.oldest_delivery_date)} /><NumberCell value={`${formatNumber(item.age_days)} días`} /><td className="px-3 py-3 text-right"><AgeBadge bucket={item.age_bucket} /></td><NumberCell value={nullableCurrency(item.estimated_inventory_cost)} /></tr>)}</tbody>
            </table>
          </DataTableSection>

          <section className="rounded-2xl border border-white/10 bg-cc-surface p-5">
            <div className="mb-4 flex items-center gap-2"><ShieldAlert size={19} className="text-amber-400" /><h3 className="font-bold text-cc-cream">Calidad de datos</h3></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{Object.entries(report.data_quality).map(([key, section]) => <div key={key} className={`rounded-xl border p-3 ${section.count > 0 ? 'border-amber-500/30 bg-amber-500/10' : 'border-white/10 bg-white/[0.02]'}`}><p className="text-xs text-cc-text-muted">{QUALITY_LABELS[key] ?? key}</p><p className={`mt-1 text-xl font-bold ${section.count > 0 ? 'text-amber-300' : 'text-cc-cream'}`}>{formatNumber(section.count)}</p>{section.count > 0 && <p className="mt-1 text-[11px] text-amber-200/80">El detalle completo se incluye en el XLSX.</p>}</div>)}</div>
          </section>
        </>
      )}
    </div>
  );
};

const MetricCard = ({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail?: string }) => (
  <div className="rounded-2xl border border-white/5 bg-cc-surface p-5">
    <div className="mb-3 flex items-center gap-2 text-cc-primary">{icon}<p className="text-xs font-semibold uppercase tracking-wide text-cc-text-muted">{label}</p></div>
    <p className="text-2xl font-bold text-cc-cream">{value}</p>
    {detail && <p className="mt-2 text-xs leading-relaxed text-cc-text-muted">{detail}</p>}
  </div>
);

const ChartCard = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="rounded-2xl border border-white/10 bg-cc-surface p-4"><h3 className="mb-3 font-bold text-cc-cream">{title}</h3>{children}</section>;

const DataTableSection = ({ title, control, children }: { title: string; control?: React.ReactNode; children: React.ReactNode }) => <section className="overflow-hidden rounded-2xl border border-white/10 bg-cc-surface"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4"><h3 className="font-bold text-cc-cream">{title}</h3>{control}</div><div className="overflow-x-auto">{children}</div></section>;

const SortSelect = ({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<[string, string]> }) => <label className="text-xs text-cc-text-muted">Ordenar por <select value={value} onChange={event => onChange(event.target.value)} className="ml-2 rounded-lg border border-white/10 bg-cc-bg px-2 py-1.5 text-cc-text-main">{options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>;

const NumberCell = ({ value }: { value: string }) => <td className="whitespace-nowrap px-3 py-3 text-right">{value}</td>;

const AgeBadge = ({ bucket }: { bucket: '0-15' | '16-30' | '31-45' | '46+' }) => {
  const color = bucket === '46+' ? 'bg-red-500/20 text-red-300' : bucket === '31-45' ? 'bg-orange-500/20 text-orange-300' : bucket === '16-30' ? 'bg-amber-500/20 text-amber-300' : 'bg-green-500/20 text-green-300';
  const label = bucket === '46+' ? 'Más de 45 días' : `${bucket} días`;
  return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${color}`}>{label}</span>;
};
