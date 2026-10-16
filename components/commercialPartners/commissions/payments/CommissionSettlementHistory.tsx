import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, Eye, Loader } from 'lucide-react';
import { getMexicoCityDateKey } from '../../../../lib/datetime';
import {
  CommissionPaymentOverview,
  CommissionPaymentRecord,
  CommissionSettlementHistory as SettlementRecord,
} from '../commissionTypes';
import { formatCurrency } from '../commissionUtils';
import { CommissionSettlementDetailModal } from './CommissionSettlementDetailModal';
import {
  createSignedProofUrl,
  formatSupabaseError,
  loadSettlementHistory,
} from './paymentUtils';

interface CommissionSettlementHistoryProps {
  sellerId: string;
  monthStart?: string;
  monthEndExclusive?: string;
  overview?: CommissionPaymentOverview | null;
  overviewLoading?: boolean;
  overviewError?: string | null;
}

type FilterStatus = 'todos' | 'draft' | 'paid' | 'cancelled';

const emptyBreakdown = (settlement: SettlementRecord): CommissionPaymentRecord => ({
  ...settlement,
  earned_period_start: null,
  earned_period_end: null,
  commercial_commissions_amount: 0,
  extra_days_amount: 0,
  other_adjustments_amount: 0,
  concept_breakdown_matches_total: true,
});

const formatDateOnly = (value: string | null): string => {
  if (!value) return '—';
  const match = value.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
};
const formatPaymentDate = (value: string | null): string => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

const paymentMethodLabel = (value: string | null): string => {
  if (value === 'cash') return 'Efectivo';
  if (value === 'transfer') return 'Transferencia';
  return '—';
};

export const CommissionSettlementHistory: React.FC<CommissionSettlementHistoryProps> = ({
  sellerId,
  monthStart,
  monthEndExclusive,
  overview,
  overviewLoading,
  overviewError,
}) => {
  const controlled = overview !== undefined
    || overviewLoading !== undefined
    || overviewError !== undefined;
  const [localSettlements, setLocalSettlements] = useState<CommissionPaymentRecord[]>([]);
  const [localLoading, setLocalLoading] = useState(!controlled);
  const [localError, setLocalError] = useState('');
  const [filter, setFilter] = useState<FilterStatus>('todos');
  const [selectedSettlement, setSelectedSettlement] = useState<CommissionPaymentRecord | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [downloadingProof, setDownloadingProof] = useState('');

  useEffect(() => {
    if (controlled) return;
    let cancelled = false;
    const loadData = async () => {
      setLocalLoading(true);
      setLocalError('');
      try {
        const data = await loadSettlementHistory(sellerId);
        if (!cancelled) setLocalSettlements(data.map(emptyBreakdown));
      } catch (loadError) {
        console.error('LOAD HISTORY ERROR', loadError);
        if (!cancelled) setLocalError(formatSupabaseError(loadError, 'Error al cargar historial'));
      } finally {
        if (!cancelled) setLocalLoading(false);
      }
    };
    void loadData();
    return () => { cancelled = true; };
  }, [controlled, sellerId]);

  const settlements = controlled ? overview?.settlements ?? [] : localSettlements;
  const loading = controlled ? Boolean(overviewLoading) : localLoading;
  const error = controlled ? overviewError ?? '' : localError;

  const filteredSettlements = settlements.filter(settlement => (
    filter === 'todos' || settlement.status === filter
  ));

  const monthlyPaymentIds = useMemo(() => new Set(
    (overview?.payments_during_month ?? []).map(settlement => settlement.settlement_id)
  ), [overview]);

  const handleDownloadProof = async (settlement: CommissionPaymentRecord) => {
    if (!settlement.payment_proof_path) {
      alert('No hay comprobante disponible');
      return;
    }
    setDownloadingProof(settlement.settlement_id);
    try {
      const url = await createSignedProofUrl(settlement.payment_proof_path);
      window.open(url, '_blank');
    } catch (downloadError) {
      console.error('DOWNLOAD ERROR', downloadError);
      alert(formatSupabaseError(downloadError, 'Error al descargar'));
    } finally {
      setDownloadingProof('');
    }
  };

  if (loading) {
    return <div className="py-8 text-center"><Loader size={20} className="mx-auto animate-spin text-yellow-500" /></div>;
  }

  if (error) {
    return (
      <div className="flex gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-red-400" />
        <div>
          <p className="text-sm font-medium text-red-300">Error al cargar</p>
          <p className="mt-1 whitespace-pre-line text-xs text-red-300">{error}</p>
        </div>
      </div>
    );
  }

  if (settlements.length === 0) {
    return <div className="py-8 text-center text-neutral-400">No hay registros de liquidaciones</div>;
  }

  return (
    <>
      <div className="space-y-4">
        {overview && monthStart && monthEndExclusive && (
          <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-300">Pagos efectivos del mes seleccionado</p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
              <p className="text-2xl font-bold text-green-300">{formatCurrency(overview.paid_during_month)}</p>
              <p className="text-xs text-cc-text-muted">
                {overview.payments_during_month.length} liquidación{overview.payments_during_month.length === 1 ? '' : 'es'} · paid_at entre {formatDateOnly(monthStart)} y {formatDateOnly(monthEndExclusive)} (límite exclusivo)
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(['todos', 'draft', 'paid', 'cancelled'] as FilterStatus[]).map(status => (
            <button
              type="button"
              key={status}
              onClick={() => setFilter(status)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === status
                  ? 'bg-yellow-500 text-black'
                  : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
              }`}
            >
              {status === 'todos' ? `Todos (${settlements.length})` : null}
              {status === 'draft' ? `Borradores (${settlements.filter(row => row.status === status).length})` : null}
              {status === 'paid' ? `Pagadas (${settlements.filter(row => row.status === status).length})` : null}
              {status === 'cancelled' ? `Canceladas (${settlements.filter(row => row.status === status).length})` : null}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="border-b border-neutral-800 bg-neutral-900">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-neutral-400">Folio</th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-neutral-400">Fecha real de pago</th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-neutral-400">Generación de eventos</th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-neutral-400">Desglose</th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase text-neutral-400">Total</th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-neutral-400">Método / estado</th>
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase text-neutral-400">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredSettlements.map(settlement => {
                const paidDate = settlement.paid_at ? getMexicoCityDateKey(settlement.paid_at) : null;
                const belongsToSelectedMonth = monthlyPaymentIds.has(settlement.settlement_id)
                  || Boolean(paidDate && monthStart && monthEndExclusive
                    && paidDate >= monthStart && paidDate < monthEndExclusive);
                return (
                  <tr key={settlement.settlement_id} className="border-b border-neutral-800 align-top hover:bg-neutral-900/50">
                    <td className="px-3 py-3">
                      <p className="font-mono font-semibold text-yellow-400">{settlement.folio}</p>
                      {belongsToSelectedMonth && (
                        <span className="mt-1 inline-flex rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold text-green-300">Pagado en el mes</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-neutral-200">
                      <p>{formatPaymentDate(settlement.paid_at)}</p>
                      <p className="mt-1 text-xs text-neutral-500">America/Mexico_City</p>
                    </td>
                    <td className="px-3 py-3 text-neutral-300">
                      <p>{formatDateOnly(settlement.earned_period_start ?? settlement.month_start)}</p>
                      <p className="text-xs text-neutral-500">a {formatDateOnly(settlement.earned_period_end ?? settlement.month_end)}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-neutral-300">
                      {settlement.status === 'paid' && controlled ? (
                        <div className="space-y-1">
                          <p>Comercial: <span className="font-semibold">{formatCurrency(settlement.commercial_commissions_amount)}</span></p>
                          <p>Días extra: <span className="font-semibold text-purple-300">{formatCurrency(settlement.extra_days_amount)}</span></p>
                          {Math.abs(settlement.other_adjustments_amount) > 0.005 && (
                            <p>Otros ajustes: <span className="font-semibold">{formatCurrency(settlement.other_adjustments_amount)}</span></p>
                          )}
                          {!settlement.concept_breakdown_matches_total && (
                            <p className="font-semibold text-red-300">El desglose no concilia con el total</p>
                          )}
                        </div>
                      ) : settlement.status === 'paid' ? (
                        <span className="text-neutral-500">Consulta el detalle para ver las partidas</span>
                      ) : <span className="text-neutral-500">Se muestra al quedar pagada</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-neutral-200">{formatCurrency(Number(settlement.total_amount))}</td>
                    <td className="px-3 py-3">
                      <p className="text-neutral-300">{paymentMethodLabel(settlement.payment_method)}</p>
                      <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs ${
                        settlement.status === 'paid'
                          ? 'border-green-500/30 bg-green-500/10 text-green-300'
                          : settlement.status === 'draft'
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                            : 'border-neutral-700 bg-neutral-800 text-neutral-400'
                      }`}>
                        {settlement.status === 'paid' ? 'Pagada' : settlement.status === 'draft' ? 'En preparación' : 'Cancelada'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => { setSelectedSettlement(settlement); setShowDetailModal(true); }}
                          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
                          title="Ver detalles"
                        ><Eye size={16} /></button>
                        {settlement.status === 'paid' && settlement.has_payment_proof && (
                          <button
                            type="button"
                            onClick={() => void handleDownloadProof(settlement)}
                            disabled={downloadingProof === settlement.settlement_id}
                            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-700 hover:text-blue-300 disabled:opacity-50"
                            title="Descargar comprobante"
                          ><Download size={16} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSettlement && (
        <CommissionSettlementDetailModal
          isOpen={showDetailModal}
          onClose={() => { setShowDetailModal(false); setSelectedSettlement(null); }}
          settlementId={selectedSettlement.settlement_id}
          settlement={selectedSettlement}
        />
      )}
    </>
  );
};
