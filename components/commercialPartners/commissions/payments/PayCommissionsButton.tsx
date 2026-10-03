// ── Pay Commissions Button ─────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarRange, CreditCard, Loader } from 'lucide-react';
import { CommissionPaymentModal } from './CommissionPaymentModal';
import { formatSupabaseError, getCommissionSettlementPreview } from './paymentUtils';
import { CommissionDraftCard } from './CommissionDraftCard';
import { formatCurrency, formatDate } from '../commissionUtils';
import { CommissionSettlementPreview } from '../commissionTypes';

interface PayCommissionsButtonProps {
  sellerId: string;
  sellerName: string;
  sellerFolio?: string;
  onPaymentComplete: () => void;
}

type SettlementScope = 'accumulated' | 'month';

const emptyPreview: CommissionSettlementPreview = {
  available_total: 0,
  event_count: 0,
  first_available_date: null,
  last_available_date: null,
  existing_draft_id: null,
  existing_draft_folio: null,
  existing_draft_total: 0,
  existing_draft_created_at: null,
  existing_draft_period_start: null,
  existing_draft_period_end: null,
  existing_draft_event_count: 0,
};

const getMexicoCityDate = (): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const getMonthRange = (monthValue: string) => {
  const [year, month] = monthValue.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${monthValue}-01`,
    end: `${monthValue}-${String(lastDay).padStart(2, '0')}`,
  };
};

const getMonthLabel = (monthValue: string) => {
  const [year, month] = monthValue.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 15)));
};

const getDraftPeriodLabel = (start: string, end: string) => {
  if (start.slice(0, 7) === end.slice(0, 7)) return getMonthLabel(start.slice(0, 7));
  return `Acumulado del ${formatDate(start)} al ${formatDate(end)}`;
};

export const PayCommissionsButton: React.FC<PayCommissionsButtonProps> = ({
  sellerId,
  sellerName,
  sellerFolio,
  onPaymentComplete,
}) => {
  const today = getMexicoCityDate();
  const [scope, setScope] = useState<SettlementScope>('accumulated');
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [accumulatedPreview, setAccumulatedPreview] = useState(emptyPreview);
  const [monthPreview, setMonthPreview] = useState(emptyPreview);
  const [accumulatedStart, setAccumulatedStart] = useState(today);
  const [accumulatedEnd, setAccumulatedEnd] = useState(today);
  const [draftData, setDraftData] = useState<{
    settlement_id: string;
    folio: string;
    period_label: string;
    month_start: string;
    month_end: string;
    total_amount: number;
    event_count: number;
    created_at: string;
  } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState('');

  const monthRange = useMemo(() => getMonthRange(selectedMonth), [selectedMonth]);
  const selectedPreview = scope === 'accumulated' ? accumulatedPreview : monthPreview;
  const selectedPeriodStart = scope === 'accumulated' ? accumulatedStart : monthRange.start;
  const selectedPeriodEnd = scope === 'accumulated' ? accumulatedEnd : monthRange.end;
  const selectedPeriodLabel = scope === 'accumulated'
    ? 'Acumulado pendiente hasta hoy'
    : getMonthLabel(selectedMonth);

  useEffect(() => {
    setScope('accumulated');
    setSelectedMonth(getMexicoCityDate().slice(0, 7));
  }, [sellerId]);

  useEffect(() => {
    loadData();
  }, [sellerId, selectedMonth]);

  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      const currentMexicoDate = getMexicoCityDate();
      const discovery = await getCommissionSettlementPreview(
        sellerId,
        '1900-01-01',
        currentMexicoDate
      );
      const firstAvailableDate = discovery.first_available_date || currentMexicoDate;
      const exactAccumulated = await getCommissionSettlementPreview(
        sellerId,
        firstAvailableDate,
        currentMexicoDate
      );
      const exactMonth = await getCommissionSettlementPreview(
        sellerId,
        monthRange.start,
        monthRange.end
      );

      setAccumulatedStart(firstAvailableDate);
      setAccumulatedEnd(currentMexicoDate);
      setAccumulatedPreview(exactAccumulated);
      setMonthPreview(exactMonth);

      if (
        exactAccumulated.existing_draft_id
        && exactAccumulated.existing_draft_folio
        && exactAccumulated.existing_draft_period_start
        && exactAccumulated.existing_draft_period_end
        && exactAccumulated.existing_draft_created_at
      ) {
        setDraftData({
          settlement_id: exactAccumulated.existing_draft_id,
          folio: exactAccumulated.existing_draft_folio,
          period_label: getDraftPeriodLabel(
            exactAccumulated.existing_draft_period_start,
            exactAccumulated.existing_draft_period_end
          ),
          month_start: exactAccumulated.existing_draft_period_start,
          month_end: exactAccumulated.existing_draft_period_end,
          total_amount: exactAccumulated.existing_draft_total,
          event_count: exactAccumulated.existing_draft_event_count,
          created_at: exactAccumulated.existing_draft_created_at,
        });
      } else {
        setDraftData(null);
      }
    } catch (loadError) {
      console.error('COMMISSION SETTLEMENT PREVIEW LOAD ERROR', loadError);
      setError(formatSupabaseError(loadError, 'Error al cargar la vista previa de liquidación'));
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentComplete = () => {
    setIsModalOpen(false);
    loadData();
    onPaymentComplete();
  };

  if (loading) {
    return (
      <div className="p-4 bg-neutral-900 rounded-lg border border-neutral-800 text-center">
        <Loader size={20} className="mx-auto text-yellow-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex gap-3">
        <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm text-red-300 font-medium">Error al cargar</p>
          <p className="text-xs text-red-300 mt-1 whitespace-pre-line break-words">{error}</p>
        </div>
      </div>
    );
  }

  if (draftData) {
    return (
      <>
        <CommissionDraftCard
          draft={draftData}
          onContinue={() => setIsModalOpen(true)}
          onRefresh={loadData}
        />
        <CommissionPaymentModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={handlePaymentComplete}
          sellerId={sellerId}
          sellerName={sellerName}
          sellerFolio={sellerFolio}
          periodStart={draftData.month_start}
          periodEnd={draftData.month_end}
          periodLabel={draftData.period_label}
          totalAmount={draftData.total_amount}
          accumulatedAvailable={accumulatedPreview.available_total}
          movementCount={draftData.event_count}
          existingSettlement={{
            id: draftData.settlement_id,
            folio: draftData.folio,
            totalAmount: draftData.total_amount,
          }}
        />
      </>
    );
  }

  if (accumulatedPreview.available_total <= 0.005) {
    return (
      <div className="p-4 bg-neutral-900 rounded-lg border border-neutral-800 text-center">
        <p className="text-sm text-neutral-400">No hay comisiones disponibles para pagar</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarRange size={17} className="text-yellow-500" />
          <p className="text-sm font-semibold text-neutral-200">Periodo de liquidación</p>
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-neutral-700 bg-neutral-950 p-3 cursor-pointer">
          <input
            type="radio"
            name={`settlement-scope-${sellerId}`}
            checked={scope === 'accumulated'}
            onChange={() => setScope('accumulated')}
            className="mt-1 accent-yellow-500"
          />
          <span>
            <span className="block text-sm font-medium text-neutral-200">Acumulado pendiente hasta hoy</span>
            <span className="block text-xs text-neutral-500 mt-1">
              {formatDate(accumulatedStart)} → {formatDate(accumulatedEnd)}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-neutral-700 bg-neutral-950 p-3 cursor-pointer">
          <input
            type="radio"
            name={`settlement-scope-${sellerId}`}
            checked={scope === 'month'}
            onChange={() => setScope('month')}
            className="mt-1 accent-yellow-500"
          />
          <span className="flex-1">
            <span className="block text-sm font-medium text-neutral-200">Seleccionar un mes</span>
            <input
              type="month"
              value={selectedMonth}
              max={today.slice(0, 7)}
              onChange={event => {
                setSelectedMonth(event.target.value);
                setScope('month');
              }}
              className="mt-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200"
            />
          </span>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-xs text-neutral-500">Disponible en el periodo</p>
          <p className="mt-1 text-lg font-semibold text-yellow-400">
            {formatCurrency(selectedPreview.available_total)}
          </p>
          <p className="text-xs text-neutral-500">
            {selectedPreview.event_count} movimiento{selectedPreview.event_count === 1 ? '' : 's'}
          </p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <p className="text-xs text-neutral-500">Disponible acumulado</p>
          <p className="mt-1 text-lg font-semibold text-neutral-200">
            {formatCurrency(accumulatedPreview.available_total)}
          </p>
          <p className="text-xs text-neutral-500">
            {accumulatedPreview.event_count} movimiento{accumulatedPreview.event_count === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <button
        onClick={() => setIsModalOpen(true)}
        disabled={selectedPreview.available_total <= 0.005}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg font-medium text-black bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors group"
      >
        <div className="flex items-center gap-3 flex-1">
          <CreditCard size={18} />
          <div className="text-left">
            <p>Pagar comisiones</p>
            <p className="text-xs opacity-75">
              {selectedPeriodLabel} · {formatCurrency(selectedPreview.available_total)}
            </p>
          </div>
        </div>
      </button>

      <CommissionPaymentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handlePaymentComplete}
        sellerId={sellerId}
        sellerName={sellerName}
        sellerFolio={sellerFolio}
        periodStart={selectedPeriodStart}
        periodEnd={selectedPeriodEnd}
        periodLabel={selectedPeriodLabel}
        totalAmount={selectedPreview.available_total}
        accumulatedAvailable={accumulatedPreview.available_total}
        movementCount={selectedPreview.event_count}
      />
    </div>
  );
};
