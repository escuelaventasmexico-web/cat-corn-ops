import {
  AlertCircle,
  CheckCircle,
  Clock,
  DollarSign,
  History,
  Loader2,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import {
  CommissionPaymentOverview,
  SellerCommissionMonthlySummary,
} from './commissionTypes';
import { formatCurrency, parseNumericValue } from './commissionUtils';

interface CommissionSummaryCardsProps {
  summary: SellerCommissionMonthlySummary | null;
  totalAvailable?: number;
  paymentOverview?: CommissionPaymentOverview | null;
  paymentOverviewLoading?: boolean;
  paymentOverviewError?: string | null;
  onPendingClick?: () => void;
  onAvailableClick?: () => void;
}

interface MetricCardProps {
  label: string;
  value: number;
  description: string;
  valueClass?: string;
  icon: React.ReactNode;
  onClick?: () => void;
}

const MetricCard = ({
  label,
  value,
  description,
  valueClass = 'text-cc-cream',
  icon,
  onClick,
}: MetricCardProps) => {
  const className = 'h-full w-full rounded-2xl border border-white/10 bg-cc-surface p-5 text-left transition-colors';
  const content = (
    <>
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-cc-text-muted">{label}</p>
        {icon}
      </div>
      <p className={`text-2xl font-bold ${valueClass}`}>{formatCurrency(value)}</p>
      <p className="mt-2 text-xs leading-relaxed text-cc-text-muted">{description}</p>
    </>
  );

  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} hover:border-white/25 hover:bg-white/[0.04]`}>
      {content}
    </button>
  ) : <div className={className}>{content}</div>;
};

export const CommissionSummaryCards = ({
  summary,
  totalAvailable = 0,
  paymentOverview,
  paymentOverviewLoading = false,
  paymentOverviewError = null,
  onPendingClick,
  onAvailableClick,
}: CommissionSummaryCardsProps) => {
  if (!summary) return null;

  const available = parseNumericValue(summary.available_total);
  const pending = parseNumericValue(summary.pending_total);
  const paidFromMonthEvents = parseNumericValue(summary.paid_total);
  const generated = parseNumericValue(summary.generated_total);

  if (paymentOverview === undefined) {
    return (
      <>
        <MetricCard
          label="Comisión disponible del mes"
          value={available}
          description="Saldo de eventos generados en el mes seleccionado."
          valueClass="text-cc-primary"
          icon={<DollarSign className="h-5 w-5 text-cc-primary" />}
        />
        <MetricCard
          label="Pendiente de liberación del mes"
          value={pending}
          description="Eventos del mes que todavía no cumplen su condición de liberación."
          icon={<Clock className="h-5 w-5 text-amber-400" />}
        />
        <MetricCard
          label="Pagado de eventos del mes"
          value={paidFromMonthEvents}
          description="Importe aplicado a eventos generados en el mes, aunque el pago haya ocurrido después."
          icon={<CheckCircle className="h-5 w-5 text-blue-400" />}
        />
        <MetricCard
          label="Generado en el mes"
          value={generated}
          description="Comisiones y ajustes generados durante el mes seleccionado."
          icon={<TrendingUp className="h-5 w-5 text-yellow-400" />}
        />
      </>
    );
  }

  return (
    <>
      <section className="col-span-full space-y-3">
        <div>
          <h3 className="text-base font-bold text-cc-cream">Indicadores del mes seleccionado</h3>
          <p className="text-xs text-cc-text-muted">Agrupados por la fecha de generación del evento.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Comisiones y ajustes generados en el mes"
            value={generated}
            description="Total generado por eventos cuyo earned_at pertenece al mes."
            icon={<TrendingUp className="h-5 w-5 text-yellow-400" />}
          />
          <MetricCard
            label="Pagado de comisiones generadas en el mes"
            value={paidFromMonthEvents}
            description="Aplicado a eventos del mes; no representa el dinero desembolsado durante el mes."
            valueClass="text-blue-300"
            icon={<CheckCircle className="h-5 w-5 text-blue-400" />}
          />
          <MetricCard
            label="Disponible correspondiente a eventos del mes"
            value={available}
            description="Saldo liberado de eventos generados en el mes seleccionado."
            valueClass="text-cc-primary"
            icon={<DollarSign className="h-5 w-5 text-cc-primary" />}
            onClick={onAvailableClick}
          />
          <MetricCard
            label="Pendiente de liberación correspondiente al mes"
            value={pending}
            description="Eventos generados en el mes pendientes de cumplir su condición."
            valueClass="text-amber-300"
            icon={<Clock className="h-5 w-5 text-amber-400" />}
            onClick={onPendingClick}
          />
        </div>
      </section>

      <section className="col-span-full space-y-3">
        <div>
          <h3 className="text-base font-bold text-cc-cream">Flujo real de pagos</h3>
          <p className="text-xs text-cc-text-muted">Agrupado por la fecha efectiva de pago en Ciudad de México.</p>
        </div>
        {paymentOverviewLoading ? (
          <div className="flex min-h-28 items-center justify-center rounded-2xl border border-white/10 bg-cc-surface">
            <Loader2 className="h-6 w-6 animate-spin text-cc-primary" />
          </div>
        ) : paymentOverviewError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {paymentOverviewError}
          </div>
        ) : paymentOverview ? (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <MetricCard
                label="PAGADO DURANTE EL MES"
                value={paymentOverview.paid_during_month}
                description="Suma de liquidaciones pagadas cuyo paid_at pertenece al mes seleccionado."
                valueClass="text-green-300"
                icon={<WalletCards className="h-6 w-6 text-green-400" />}
              />
              <MetricCard
                label="TOTAL HISTÓRICO PAGADO"
                value={paymentOverview.total_historical_paid}
                description="Suma histórica de liquidaciones con estado pagado; no suma tarjetas mensuales."
                valueClass="text-blue-300"
                icon={<History className="h-6 w-6 text-blue-400" />}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricCard
                label="Comisiones comerciales pagadas en el mes"
                value={paymentOverview.commercial_paid_during_month}
                description="Partidas pagadas distintas de días extra y otros ajustes administrativos."
                icon={<DollarSign className="h-5 w-5 text-cc-primary" />}
              />
              <MetricCard
                label="Días extra pagados en el mes"
                value={paymentOverview.extra_days_paid_during_month}
                description="Ajustes identificados como extra_day en sus metadatos."
                valueClass="text-purple-300"
                icon={<Clock className="h-5 w-5 text-purple-400" />}
              />
              <MetricCard
                label="Total pagado conciliado"
                value={paymentOverview.commercial_paid_during_month
                  + paymentOverview.extra_days_paid_during_month
                  + paymentOverview.other_adjustments_paid_during_month}
                description="Comisiones comerciales + días extra + otros ajustes incluidos en liquidaciones."
                valueClass="text-green-300"
                icon={<CheckCircle className="h-5 w-5 text-green-400" />}
              />
            </div>
            {!paymentOverview.month_concepts_match_paid_total && (
              <div className="flex gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                El desglose por conceptos no concilia con el total pagado. Revisa las partidas antes de usar estas cifras.
              </div>
            )}
          </>
        ) : null}
      </section>

      <section className="col-span-full space-y-3">
        <div>
          <h3 className="text-base font-bold text-cc-cream">Saldos acumulados actuales</h3>
          <p className="text-xs text-cc-text-muted">No dependen del mes seleccionado.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MetricCard
            label="Total disponible para pagar actualmente"
            value={totalAvailable}
            description="Saldo asignable acumulado de todos los meses, excluyendo importes pagados o reservados."
            valueClass="text-cc-primary"
            icon={<DollarSign className="h-6 w-6 text-cc-primary" />}
          />
          <MetricCard
            label="Total histórico pendiente de liberación"
            value={paymentOverview?.historical_pending_release ?? 0}
            description="Comisiones de cualquier mes que aún no cumplen su condición de liberación."
            valueClass="text-amber-300"
            icon={<Clock className="h-6 w-6 text-amber-400" />}
          />
        </div>
      </section>
    </>
  );
};
