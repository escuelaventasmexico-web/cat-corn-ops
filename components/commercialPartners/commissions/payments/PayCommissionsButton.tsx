// ── Pay Commissions Button ─────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import { CreditCard, AlertCircle, Loader } from 'lucide-react';
import { CommissionPaymentModal } from './CommissionPaymentModal';
import { loadAvailableForPayment, loadSettlementHistory } from './paymentUtils';
import { CommissionDraftCard } from './CommissionDraftCard';
import { formatCurrency, getMonthName } from '../commissionUtils';

interface PayCommissionsButtonProps {
  sellerId: string;
  sellerName: string;
  sellerFolio?: string;
  onPaymentComplete: () => void;
}

export const PayCommissionsButton: React.FC<PayCommissionsButtonProps> = ({
  sellerId,
  sellerName,
  sellerFolio,
  onPaymentComplete,
}) => {
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState<number>(0);
  const [availableCount, setAvailableCount] = useState(0);
  const [hasDraft, setHasDraft] = useState(false);
  const [draftData, setDraftData] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, [sellerId]);

  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      // Load available for payment
      const availData = await loadAvailableForPayment(sellerId);
      console.log('AVAILABLE DATA', availData);

      if (availData) {
        setAvailable(Number(availData.available_amount || 0));
        setAvailableCount(Number(availData.available_event_count || 0));
        setHasDraft(availData.has_draft_settlement || false);
      }

      // Load settlement history to find draft details
      if (availData?.has_draft_settlement && availData?.draft_settlement_id) {
        const history = await loadSettlementHistory(sellerId);
        const draft = history.find(
          (s) => s.settlement_id === availData.draft_settlement_id
        );

        if (draft) {
          setDraftData(draft);
          console.log('DRAFT FOUND', draft);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar datos';
      console.error('LOAD ERROR', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentComplete = () => {
    setIsModalOpen(false);
    loadData(); // Reload data
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
        <div>
          <p className="text-sm text-red-300 font-medium">Error al cargar</p>
          <p className="text-xs text-red-300 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  // No available commissions
  if (available === 0 && !hasDraft) {
    return (
      <div className="p-4 bg-neutral-900 rounded-lg border border-neutral-800 text-center">
        <p className="text-sm text-neutral-400">
          No hay comisiones disponibles para pagar
        </p>
      </div>
    );
  }

  // Show draft card if exists
  if (hasDraft && draftData) {
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
          totalAmount={Number(draftData.total_amount || 0)}
          movementCount={draftData.event_count || 0}
        />
      </>
    );
  }

  // Button to create new settlement
  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="
          w-full flex items-center justify-between gap-3 px-4 py-3
          rounded-lg font-medium text-black
          bg-yellow-500 hover:bg-yellow-400
          transition-colors
          group
        "
      >
        <div className="flex items-center gap-3 flex-1">
          <CreditCard size={18} />
          <div className="text-left">
            <p>Pagar comisiones</p>
            <p className="text-xs opacity-75">
              {availableCount} movimiento{availableCount !== 1 ? 's' : ''} • {formatCurrency(available)}
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
        periodStart={new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          .toISOString()
          .split('T')[0]}
        periodEnd={new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
          .toISOString()
          .split('T')[0]}
        periodLabel={`${getMonthName(new Date())} ${new Date().getFullYear()}`}
        totalAmount={available}
        movementCount={availableCount}
      />
    </>
  );
};
