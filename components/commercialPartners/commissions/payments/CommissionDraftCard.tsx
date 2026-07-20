// ── Commission Draft Card ────────────────────────────────────────────

import React, { useState } from 'react';
import { AlertCircle, Trash2, ArrowRight } from 'lucide-react';
import { formatCurrency, formatDate } from '../commissionUtils';
import { cancelCommissionSettlementDraft } from './paymentUtils';

interface CommissionDraftCardProps {
  draft: {
    settlement_id: string;
    folio: string;
    period_label: string;
    month_start: string;
    month_end: string;
    total_amount: number;
    event_count: number;
    created_at: string;
  };
  onContinue: () => void;
  onRefresh: () => void;
}

export const CommissionDraftCard: React.FC<CommissionDraftCardProps> = ({
  draft,
  onContinue,
  onRefresh,
}) => {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');

  const handleCancel = async () => {
    if (!window.confirm('¿Estás seguro de que deseas cancelar este borrador?')) {
      return;
    }

    setCancelling(true);
    setError('');

    try {
      console.log('CANCELLING DRAFT', draft.settlement_id);

      await cancelCommissionSettlementDraft(
        draft.settlement_id,
        'Cancelado por el usuario'
      );

      console.log('DRAFT CANCELLED');

      onRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cancelar';
      console.error('CANCEL ERROR', err);
      setError(message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="p-4 bg-gradient-to-br from-amber-500/10 to-amber-500/5 border border-amber-500/30 rounded-lg space-y-3">
      {/* Alert Header */}
      <div className="flex gap-3 items-start">
        <AlertCircle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-300">Borrador en preparación</p>
          <p className="text-xs text-amber-200 mt-1">
            Existe un borrador de liquidación en progreso
          </p>
        </div>
      </div>

      {/* Draft Details */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="p-2 bg-amber-900/20 rounded">
          <p className="text-xs text-neutral-500">Folio</p>
          <p className="text-sm font-mono font-semibold text-amber-400 mt-1">
            {draft.folio}
          </p>
        </div>
        <div className="p-2 bg-amber-900/20 rounded">
          <p className="text-xs text-neutral-500">Monto</p>
          <p className="text-sm font-semibold text-amber-400 mt-1">
            {formatCurrency(draft.total_amount)}
          </p>
        </div>
        <div className="p-2 bg-amber-900/20 rounded col-span-2">
          <p className="text-xs text-neutral-500">{draft.period_label}</p>
          <p className="text-xs text-amber-300 mt-1">
            {formatDate(draft.month_start)} - {formatDate(draft.month_end)}
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 p-2 rounded border border-red-500/20">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={onContinue}
          className="
            flex-1 flex items-center justify-center gap-2
            px-3 py-2 rounded-lg font-medium text-sm
            bg-yellow-500 text-black
            hover:bg-yellow-400
            transition-colors
          "
        >
          Continuar pago
          <ArrowRight size={14} />
        </button>
        <button
          onClick={handleCancel}
          disabled={cancelling}
          className="
            px-3 py-2 rounded-lg text-neutral-300
            bg-neutral-800 border border-neutral-700
            hover:bg-neutral-700 hover:text-red-300
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          "
          title="Cancelar borrador"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
};
