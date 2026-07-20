/* ── Commission Payment Modal ────────────────────────────────────────── */

import React, { useState } from 'react';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import { CommissionSettlementSummary } from './CommissionSettlementSummary';
import {
  CommissionPaymentMethod,
  type PaymentMethodDetails,
} from './CommissionPaymentMethod';
import {
  createCommissionSettlement,
  payCommissionSettlement,
  uploadPaymentProof,
} from './paymentUtils';

interface CommissionPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  sellerId: string;
  sellerName: string;
  sellerFolio?: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  totalAmount: number;
  movementCount: number;
}

type Step = 1 | 2;

export const CommissionPaymentModal: React.FC<CommissionPaymentModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  sellerId,
  sellerName,
  sellerFolio,
  periodStart,
  periodEnd,
  periodLabel,
  totalAmount,
  movementCount,
}) => {
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [settlementId, setSettlementId] = useState('');
  const [folio, setFolio] = useState('');

  const handlePrepare = async () => {
    setLoading(true);
    setError('');

    try {
      console.log('CREATING SETTLEMENT', { sellerId, periodStart, periodEnd });

      const settlement = await createCommissionSettlement(
        sellerId,
        periodStart,
        periodEnd
      );

      console.log('SETTLEMENT CREATED', settlement);

      setSettlementId(settlement.settlement_id);
      setFolio(settlement.folio);
      setStep(2);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al preparar liquidación';
      console.error('PREPARE ERROR', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async (method: 'transfer' | 'cash', details: PaymentMethodDetails) => {
    setLoading(true);
    setError('');

    try {
      let proofPath = null;
      let fileName = null;
      let mimeType = null;

      console.log('PAYMENT METHOD', method);
      console.log('DETAILS', details);

      // Upload proof if transfer
      if (method === 'transfer' && details.proofFile) {
        console.log('UPLOADING PROOF', details.proofFile.name);

        proofPath = await uploadPaymentProof(
          details.proofFile,
          sellerId,
          settlementId
        );

        fileName = details.proofFile.name;
        mimeType = details.proofFile.type;

        console.log('PROOF UPLOADED', { proofPath, fileName, mimeType });
      }

      // Call pay RPC
      console.log('CALLING PAY RPC', {
        settlementId,
        method,
        proofPath,
        fileName,
        mimeType,
        reference: details.reference,
        notes: details.notes,
        cashConfirmed: details.cashConfirmed,
      });

      await payCommissionSettlement(
        settlementId,
        method,
        proofPath,
        fileName,
        mimeType,
        details.reference || null,
        details.notes || null,
        details.cashConfirmed || false
      );

      console.log('PAYMENT SUCCESSFUL');

      setSuccessMessage(
        `Pago registrado exitosamente. Folio: ${folio}`
      );

      // Close after delay
      setTimeout(() => {
        onClose();
        onSuccess();
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al procesar pago';
      console.error('PAYMENT ERROR', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 rounded-lg border border-neutral-800 max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-900">
          <div>
            <p className="text-xs text-neutral-500 uppercase tracking-wider">
              Pago de comisiones
            </p>
            <p className="text-sm text-neutral-400 mt-1">
              Paso {step} de 2
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-neutral-500 hover:text-neutral-300 disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Success Message */}
          {successMessage && (
            <div className="mb-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
              <p className="text-sm text-green-300 font-medium">{successMessage}</p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-sm text-red-300 font-medium">Error</p>
              <p className="text-xs text-red-300 mt-1">{error}</p>
            </div>
          )}

          {/* Step 1: Summary */}
          {step === 1 && (
            <CommissionSettlementSummary
              seller={{
                id: sellerId,
                name: sellerName,
                folio: sellerFolio,
              }}
              period={{
                start: periodStart,
                end: periodEnd,
                label: periodLabel,
              }}
              totalAmount={totalAmount}
              movementCount={movementCount}
            />
          )}

          {/* Step 2: Payment Method */}
          {step === 2 && (
            <CommissionPaymentMethod
              totalAmount={totalAmount}
              onSubmit={handlePayment}
              onCancel={() => setStep(1)}
              loading={loading}
            />
          )}
        </div>

        {/* Footer - Actions */}
        {step === 1 && (
          <div className="sticky bottom-0 flex gap-3 p-4 border-t border-neutral-800 bg-neutral-900">
            <button
              onClick={onClose}
              disabled={loading}
              className="
                flex-1 px-4 py-2 rounded-lg text-neutral-300
                bg-neutral-800 border border-neutral-700
                hover:bg-neutral-700 hover:border-neutral-600
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors
              "
            >
              Cancelar
            </button>
            <button
              onClick={handlePrepare}
              disabled={loading}
              className="
                flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg
                font-medium text-black bg-yellow-500
                hover:bg-yellow-400
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors
              "
            >
              {loading ? 'Preparando...' : 'Preparar pago'}
              {!loading && <ChevronRight size={16} />}
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="sticky bottom-0 flex gap-3 p-4 border-t border-neutral-800 bg-neutral-900">
            <button
              onClick={() => setStep(1)}
              disabled={loading}
              className="
                flex items-center justify-center gap-2 px-4 py-2 rounded-lg
                text-neutral-300 bg-neutral-800 border border-neutral-700
                hover:bg-neutral-700 hover:border-neutral-600
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors
              "
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
