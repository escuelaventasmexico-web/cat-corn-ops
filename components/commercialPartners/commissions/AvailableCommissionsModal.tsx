import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  X,
} from 'lucide-react';
import { supabase } from '../../../supabase';
import { CommissionMovement, SellerCommissionMonthlySummary } from './commissionTypes';
import {
  buildCommissionStatementReport,
  CommissionFinancialTotals,
  formatCommissionDate,
  formatCommissionPeriod,
  getCommissionBusinessDate,
  getMovementCounterparty,
  getMovementDescription,
  getMovementDisplayStatus,
  getMovementDisplayStatusColor,
  getMovementFinancials,
  getMovementFolio,
  getStatementSourceLabel,
  isCommissionStatus,
  movementMatchesFilter,
  shiftDateOnly,
  StatementDetailFilter,
  StatementTab,
} from './commissionStatementReport';
import {
  formatCurrency,
  formatNumber,
  getPaymentStatusLabel,
  parseNumericValue,
} from './commissionUtils';
import { CommissionProductChart } from './CommissionProductChart';
import { exportCommissionStatement } from '../../../lib/exportCommissionStatement';

interface AvailableCommissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sellerId: string;
  sellerName: string;
  monthStart: string;
  monthEndExclusive: string;
  monthlySummary: SellerCommissionMonthlySummary;
}

const DETAIL_FILTERS: Array<{ key: StatementDetailFilter; label: string }> = [
  { key: 'all', label: 'Todos' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'available', label: 'Disponibles' },
  { key: 'partially_paid', label: 'Parcialmente pagadas' },
  { key: 'paid', label: 'Pagadas' },
  { key: 'cancelled', label: 'Canceladas' },
];

const TABS: Array<{ key: StatementTab; label: string }> = [
  { key: 'detail', label: 'Detalle' },
  { key: 'extra_days', label: 'Días extra' },
  { key: 'products', label: 'Por producto' },
];

export const AvailableCommissionsModal = ({
  isOpen,
  onClose,
  sellerId,
  sellerName,
  monthStart,
  monthEndExclusive,
  monthlySummary,
}: AvailableCommissionsModalProps) => {
  const [movements, setMovements] = useState<CommissionMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [activeTab, setActiveTab] = useState<StatementTab>('detail');
  const [detailFilter, setDetailFilter] = useState<StatementDetailFilter>('all');
  const [expandedExtraDays, setExpandedExtraDays] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const loadMonthlyMovements = async () => {
      if (!supabase) {
        setError('Supabase no configurado');
        return;
      }

      setLoading(true);
      setError(null);
      setExportError(null);
      setExporting(false);
      setMovements([]);
      setActiveTab('detail');
      setDetailFilter('all');
      setExpandedExtraDays(new Set());

      try {
        const safeStart = shiftDateOnly(monthStart, -1);
        const safeEnd = shiftDateOnly(monthEndExclusive, 1);
        const { data, error: queryError } = await supabase
          .from('v_seller_commission_movements')
          .select('*')
          .eq('seller_id', sellerId)
          .in('status', ['pending', 'available', 'paid', 'cancelled'])
          .gte('earned_at', `${safeStart}T00:00:00.000Z`)
          .lt('earned_at', `${safeEnd}T00:00:00.000Z`)
          .order('earned_at', { ascending: false });

        if (queryError) throw queryError;
        if (cancelled) return;

        const monthlyMovements = ((data as CommissionMovement[]) || []).filter(movement => {
          if (!isCommissionStatus(movement.status)) return false;
          const businessDate = getCommissionBusinessDate(movement);
          return businessDate >= monthStart && businessDate < monthEndExclusive;
        });
        setMovements(monthlyMovements);
      } catch (loadError) {
        if (cancelled) return;
        console.error('Error loading commission statement:', loadError);
        setError('No se pudo cargar el estado de cuenta de comisiones.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadMonthlyMovements();
    return () => {
      cancelled = true;
    };
  }, [isOpen, sellerId, monthStart, monthEndExclusive]);

  const report = useMemo(
    () => buildCommissionStatementReport(movements, monthlySummary),
    [movements, monthlySummary]
  );
  const filteredMovements = useMemo(
    () => report.allMovements.filter(movement => movementMatchesFilter(movement, detailFilter)),
    [report.allMovements, detailFilter]
  );

  if (!isOpen) return null;

  const toggleExtraDay = (businessDate: string) => {
    setExpandedExtraDays(current => {
      const next = new Set(current);
      if (next.has(businessDate)) next.delete(businessDate);
      else next.add(businessDate);
      return next;
    });
  };

  const handleExport = async () => {
    setExportError(null);
    setExporting(true);
    try {
      await exportCommissionStatement({ report, sellerName, monthStart });
    } catch (downloadError) {
      console.error('[COMMISSION STATEMENT] Export failed', downloadError);
      const message = downloadError instanceof Error
        ? downloadError.message
        : 'No se pudo generar el estado de cuenta.';
      setExportError(message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-2 sm:p-5">
      <div
        className="relative mx-auto flex min-h-[calc(100vh-1rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111111] shadow-2xl sm:min-h-0 sm:max-h-[calc(100vh-2.5rem)]"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex flex-col gap-4 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <h2 className="text-xl font-bold text-cc-cream sm:text-2xl">Estado de cuenta de comisiones</h2>
            <p className="mt-1 text-sm capitalize text-cc-text-muted">
              {sellerName} · {formatCommissionPeriod(monthStart)}
            </p>
          </div>
          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={loading || exporting || report.allMovements.length === 0 || !report.reconciliation.isValid}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cc-primary px-4 py-2 text-sm font-bold text-cc-bg transition-colors hover:bg-cc-primary-dark disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
              title={!report.reconciliation.isValid ? 'La descarga está bloqueada hasta conciliar el reporte' : undefined}
            >
              {exporting ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
              {exporting ? 'Generando Excel…' : 'Descargar estado de cuenta'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-cc-text-muted transition-colors hover:bg-white/10"
              aria-label="Cerrar estado de cuenta"
            >
              <X size={20} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex min-h-[420px] items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-cc-primary" />
            </div>
          ) : error ? (
            <div className="m-5 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-semibold text-red-300">No se pudo cargar el reporte</p>
                <p className="text-xs text-red-200">{error}</p>
              </div>
            </div>
          ) : (
            <>
              <section className="space-y-5 border-b border-white/10 bg-[#181818] px-4 py-5 sm:px-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-cc-text-muted">
                    Disponible para liquidar
                  </p>
                  <p className="mt-1 text-3xl font-bold text-cc-primary sm:text-4xl">
                    {formatCurrency(report.totals.allocatable)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <TotalCard label="Total generado" value={report.totals.generated} />
                  <TotalCard label="Pagado" value={report.totals.paid} tone="blue" />
                  <TotalCard label="Pendiente de liberación" value={report.totals.pending} tone="amber" />
                  <TotalCard label="Saldo liberado" value={report.totals.releasedOutstanding} />
                  <TotalCard label="Reservado" value={report.totals.reserved} tone="cyan" />
                  <TotalCard label="Disponible para liquidar" value={report.totals.allocatable} tone="primary" />
                </div>

                {!report.reconciliation.isValid && (
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                    <p className="font-bold">Advertencia de conciliación: la descarga está bloqueada.</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {report.reconciliation.issues.map(issue => <li key={issue}>{issue}</li>)}
                    </ul>
                  </div>
                )}
                {exportError && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                    {exportError}
                  </div>
                )}

                <SourceBreakdownTable rows={report.sourceBreakdown} />
              </section>

              <nav className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-white/10 bg-[#111111] px-4 pt-3 sm:px-6">
                {TABS.map(tab => (
                  <button
                    type="button"
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                      activeTab === tab.key
                        ? 'border-cc-primary text-cc-primary'
                        : 'border-transparent text-cc-text-muted hover:text-cc-text-main'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>

              <main className="px-4 py-5 sm:px-6">
                {activeTab === 'detail' && (
                  <DetailTab
                    movements={filteredMovements}
                    allCount={report.allMovements.length}
                    effectiveCount={report.effectiveMovements.length}
                    cancelledCount={report.cancelledMovements.length}
                    filter={detailFilter}
                    onFilterChange={setDetailFilter}
                  />
                )}
                {activeTab === 'extra_days' && (
                  <ExtraDaysTab
                    days={report.extraDays}
                    expandedDates={expandedExtraDays}
                    onToggle={toggleExtraDay}
                  />
                )}
                {activeTab === 'products' && (
                  <CommissionProductChart
                    products={report.productBreakdown}
                    productGenerated={report.productGenerated}
                    nonProductGenerated={report.nonProductGenerated}
                    totalGenerated={report.totals.generated}
                  />
                )}
              </main>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const TotalCard = ({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'blue' | 'amber' | 'cyan' | 'primary';
}) => {
  const valueClass = {
    neutral: 'text-cc-cream',
    blue: 'text-blue-300',
    amber: 'text-amber-300',
    cyan: 'text-cyan-300',
    primary: 'text-cc-primary',
  }[tone];
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="min-h-8 text-xs font-semibold text-cc-text-muted">{label}</p>
      <p className={`mt-1 text-lg font-bold ${valueClass}`}>{formatCurrency(value)}</p>
    </div>
  );
};

const SourceBreakdownTable = ({ rows }: { rows: Array<CommissionFinancialTotals & { key: string; label: string }> }) => (
  <div>
    <h3 className="mb-2 text-sm font-bold text-cc-cream">Desglose por origen</h3>
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="min-w-[900px] w-full text-xs">
        <thead className="bg-white/5 text-cc-text-muted">
          <tr>
            <th className="px-3 py-3 text-left">Tipo</th>
            <th className="px-3 py-3 text-right">Generado</th>
            <th className="px-3 py-3 text-right">Pagado</th>
            <th className="px-3 py-3 text-right">Pendiente</th>
            <th className="px-3 py-3 text-right">Saldo liberado</th>
            <th className="px-3 py-3 text-right">Reservado</th>
            <th className="px-3 py-3 text-right">Disponible</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map(row => (
            <tr key={row.key} className="text-cc-text-main">
              <td className="px-3 py-3 font-semibold text-cc-cream">{row.label}</td>
              <td className="px-3 py-3 text-right">{formatCurrency(row.generated)}</td>
              <td className="px-3 py-3 text-right">{formatCurrency(row.paid)}</td>
              <td className="px-3 py-3 text-right">{formatCurrency(row.pending)}</td>
              <td className="px-3 py-3 text-right">{formatCurrency(row.releasedOutstanding)}</td>
              <td className="px-3 py-3 text-right">{formatCurrency(row.reserved)}</td>
              <td className="px-3 py-3 text-right font-semibold text-cc-primary">{formatCurrency(row.allocatable)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const DetailTab = ({
  movements,
  allCount,
  effectiveCount,
  cancelledCount,
  filter,
  onFilterChange,
}: {
  movements: CommissionMovement[];
  allCount: number;
  effectiveCount: number;
  cancelledCount: number;
  filter: StatementDetailFilter;
  onFilterChange: (filter: StatementDetailFilter) => void;
}) => (
  <div className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-lg font-bold text-cc-cream">Movimientos mensuales</h3>
        <p className="text-xs text-cc-text-muted">
          {effectiveCount} efectivos · {cancelledCount} cancelados · {allCount} registros visibles
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {DETAIL_FILTERS.map(option => (
          <button
            type="button"
            key={option.key}
            onClick={() => onFilterChange(option.key)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === option.key
                ? 'border-cc-primary bg-cc-primary/15 text-cc-primary'
                : 'border-white/10 bg-white/[0.03] text-cc-text-muted hover:text-cc-text-main'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>

    {movements.length === 0 ? (
      <EmptyState message="No hay movimientos que coincidan con este filtro." />
    ) : (
      <>
        <div className="hidden overflow-x-auto rounded-xl border border-white/10 md:block">
          <table className="min-w-[1680px] w-full text-xs">
            <thead className="bg-white/5 text-cc-text-muted">
              <tr>
                {['Fecha', 'Tipo', 'Folio', 'Socio o canal', 'Producto', 'Variante', 'Presentación', 'Cantidad', 'Comisión unitaria', 'Generada', 'Pagada', 'Pendiente', 'Saldo liberado', 'Reservada', 'Disponible', 'Estado de comisión', 'Estado del pago'].map(header => (
                  <th key={header} className={`px-3 py-3 ${['Cantidad', 'Comisión unitaria', 'Generada', 'Pagada', 'Pendiente', 'Saldo liberado', 'Reservada', 'Disponible'].includes(header) ? 'text-right' : 'text-left'}`}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {movements.map(movement => (
                <DetailTableRow key={movement.commission_event_id} movement={movement} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-3 md:hidden">
          {movements.map(movement => (
            <DetailMobileCard key={movement.commission_event_id} movement={movement} />
          ))}
        </div>
      </>
    )}
  </div>
);

const DetailTableRow = ({ movement }: { movement: CommissionMovement }) => {
  const amounts = getMovementFinancials(movement);
  const cancelled = movement.status === 'cancelled';
  return (
    <tr className={`${cancelled ? 'bg-neutral-500/[0.04] opacity-65' : 'hover:bg-white/[0.03]'} text-cc-text-main`}>
      <td className="px-3 py-3">{formatCommissionDate(getCommissionBusinessDate(movement))}</td>
      <td className="px-3 py-3 font-semibold text-cc-cream">{getStatementSourceLabel(movement)}</td>
      <td className="px-3 py-3">{getMovementFolio(movement)}</td>
      <td className="px-3 py-3">{getMovementCounterparty(movement)}</td>
      <td className="max-w-52 px-3 py-3">{getMovementDescription(movement)}</td>
      <td className="px-3 py-3">{movement.product_variant || '—'}</td>
      <td className="px-3 py-3">{movement.product_size || '—'}</td>
      <td className="px-3 py-3 text-right">{formatNumber(parseNumericValue(movement.quantity))}</td>
      <td className="px-3 py-3 text-right">{formatCurrency(parseNumericValue(movement.unit_commission))}</td>
      <td className="px-3 py-3 text-right">{formatCurrency(parseNumericValue(movement.commission_amount))}</td>
      <td className="px-3 py-3 text-right">{formatCurrency(parseNumericValue(movement.paid_amount))}</td>
      <td className="px-3 py-3 text-right">{formatCurrency(amounts.pending)}</td>
      <td className="px-3 py-3 text-right">{formatCurrency(amounts.releasedOutstanding)}</td>
      <td className="px-3 py-3 text-right">{formatCurrency(amounts.reserved)}</td>
      <td className="px-3 py-3 text-right font-semibold text-cc-primary">{formatCurrency(amounts.allocatable)}</td>
      <td className="px-3 py-3"><StatusBadge movement={movement} /></td>
      <td className="px-3 py-3">{getPaymentStatusLabel(movement.payment_status)}</td>
    </tr>
  );
};

const DetailMobileCard = ({ movement }: { movement: CommissionMovement }) => {
  const amounts = getMovementFinancials(movement);
  const cancelled = movement.status === 'cancelled';
  return (
    <article className={`rounded-xl border p-4 ${cancelled ? 'border-neutral-500/20 bg-neutral-500/[0.04] opacity-70' : 'border-white/10 bg-white/[0.03]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-cc-text-muted">{formatCommissionDate(getCommissionBusinessDate(movement))}</p>
          <p className="font-bold text-cc-cream">{getMovementDescription(movement)}</p>
          <p className="text-xs text-cc-text-muted">{getStatementSourceLabel(movement)} · {getMovementFolio(movement)}</p>
        </div>
        <StatusBadge movement={movement} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <MobileMetric label="Generada" value={parseNumericValue(movement.commission_amount)} />
        <MobileMetric label="Pagada" value={parseNumericValue(movement.paid_amount)} />
        <MobileMetric label="Pendiente" value={amounts.pending} />
        <MobileMetric label="Saldo liberado" value={amounts.releasedOutstanding} />
        <MobileMetric label="Reservada" value={amounts.reserved} />
        <MobileMetric label="Disponible" value={amounts.allocatable} highlighted />
      </div>
      <p className="mt-3 text-xs text-cc-text-muted">
        {getMovementCounterparty(movement)} · Estado de pago: {getPaymentStatusLabel(movement.payment_status)}
      </p>
    </article>
  );
};

const MobileMetric = ({ label, value, highlighted = false }: { label: string; value: number; highlighted?: boolean }) => (
  <div>
    <p className="text-cc-text-muted">{label}</p>
    <p className={`font-semibold ${highlighted ? 'text-cc-primary' : 'text-cc-text-main'}`}>{formatCurrency(value)}</p>
  </div>
);

const StatusBadge = ({ movement }: { movement: CommissionMovement }) => (
  <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-semibold ${getMovementDisplayStatusColor(movement)}`}>
    {getMovementDisplayStatus(movement)}
  </span>
);

type ExtraDayRow = ReturnType<typeof buildCommissionStatementReport>['extraDays'][number];

const ExtraDaysTab = ({
  days,
  expandedDates,
  onToggle,
}: {
  days: ExtraDayRow[];
  expandedDates: Set<string>;
  onToggle: (businessDate: string) => void;
}) => (
  <div className="space-y-4">
    <div>
      <h3 className="text-lg font-bold text-cc-cream">Días extra</h3>
      <p className="text-xs text-cc-text-muted">
        El total diario usa comisión generada histórica, independientemente de pagos posteriores.
      </p>
    </div>
    {days.length === 0 ? (
      <EmptyState message="No hay días extra registrados en este periodo." />
    ) : days.map(day => {
      const expanded = expandedDates.has(day.businessDate);
      return (
        <article key={day.businessDate} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
          <button
            type="button"
            onClick={() => onToggle(day.businessDate)}
            className="w-full p-4 text-left transition-colors hover:bg-white/[0.03]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-cc-cream">{formatCommissionDate(day.businessDate)}</p>
                <p className="mt-0.5 text-xs text-cc-text-muted">{day.description}</p>
              </div>
              {expanded ? <ChevronUp className="text-cc-primary" size={19} /> : <ChevronDown className="text-cc-primary" size={19} />}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <DayMetric label="Pago extra generado" value={day.generated} />
              <DayMetric label="Pago extra pagado" value={day.paid} />
              <DayMetric label="Pago extra disponible" value={day.available} />
              <DayMetric label="Otras comisiones generadas" value={day.otherGenerated} />
              <DayMetric label="Total generado del día" value={day.dayGeneratedTotal} highlighted />
              <div className="col-span-2 rounded-lg bg-white/[0.03] p-2 lg:col-span-1">
                <p className="text-[11px] text-cc-text-muted">Estado</p>
                <p className="mt-1 text-xs font-semibold text-cc-text-main">{day.statusLabel}</p>
              </div>
            </div>
          </button>
          {expanded && (
            <div className="space-y-4 border-t border-white/10 p-4">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-cc-text-muted">Ajustes de día extra agrupados</p>
                <div className="space-y-2">
                  {day.extraDayMovements.map(movement => (
                    <div key={movement.commission_event_id} className="flex flex-col justify-between gap-2 rounded-lg bg-white/[0.03] p-3 text-xs sm:flex-row sm:items-center">
                      <div>
                        <p className="font-semibold text-cc-cream">{getMovementDescription(movement)}</p>
                        <p className="text-cc-text-muted">{getMovementDisplayStatus(movement)}</p>
                      </div>
                      <p className="font-semibold text-cc-text-main">
                        Generada {formatCurrency(parseNumericValue(movement.commission_amount))} · Pagada {formatCurrency(parseNumericValue(movement.paid_amount))} · Disponible {formatCurrency(movement.status === 'available' ? parseNumericValue(movement.allocatable_amount) : 0)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-cc-text-muted">Otras comisiones efectivas del día</p>
                {day.otherMovements.length === 0 ? (
                  <p className="text-xs text-cc-text-muted">No se generaron otras comisiones ese día.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-white/10">
                    <table className="min-w-[980px] w-full text-xs">
                      <thead className="bg-white/5 text-cc-text-muted">
                        <tr>
                          {['Tipo', 'Producto', 'Variante', 'Presentación', 'Cantidad', 'Generada', 'Pagada', 'Disponible', 'Estado'].map(header => (
                            <th key={header} className={`px-3 py-2 ${['Cantidad', 'Generada', 'Pagada', 'Disponible'].includes(header) ? 'text-right' : 'text-left'}`}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {day.otherMovements.map(movement => (
                          <tr key={movement.commission_event_id} className="text-cc-text-main">
                            <td className="px-3 py-2">{getStatementSourceLabel(movement)}</td>
                            <td className="px-3 py-2">{movement.product_name || getMovementDescription(movement)}</td>
                            <td className="px-3 py-2">{movement.product_variant || '—'}</td>
                            <td className="px-3 py-2">{movement.product_size || '—'}</td>
                            <td className="px-3 py-2 text-right">{formatNumber(parseNumericValue(movement.quantity))}</td>
                            <td className="px-3 py-2 text-right">{formatCurrency(parseNumericValue(movement.commission_amount))}</td>
                            <td className="px-3 py-2 text-right">{formatCurrency(parseNumericValue(movement.paid_amount))}</td>
                            <td className="px-3 py-2 text-right text-cc-primary">{formatCurrency(movement.status === 'available' ? parseNumericValue(movement.allocatable_amount) : 0)}</td>
                            <td className="px-3 py-2">{getMovementDisplayStatus(movement)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </article>
      );
    })}
  </div>
);

const DayMetric = ({ label, value, highlighted = false }: { label: string; value: number; highlighted?: boolean }) => (
  <div className={`rounded-lg p-2 ${highlighted ? 'bg-cc-primary/10' : 'bg-white/[0.03]'}`}>
    <p className="text-[11px] text-cc-text-muted">{label}</p>
    <p className={`mt-1 text-sm font-bold ${highlighted ? 'text-cc-primary' : 'text-cc-text-main'}`}>{formatCurrency(value)}</p>
  </div>
);

const EmptyState = ({ message }: { message: string }) => (
  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-10 text-center text-sm text-cc-text-muted">
    {message}
  </div>
);
