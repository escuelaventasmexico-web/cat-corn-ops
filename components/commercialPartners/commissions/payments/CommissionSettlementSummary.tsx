/* ── Commission Settlement Summary ────────────────────────────────────── */

import React from 'react';
import { formatCurrency, formatDate } from '../commissionUtils';
import { DollarSign, Calendar, Hash } from 'lucide-react';

interface CommissionSettlementSummaryProps {
  seller: {
    id: string;
    name: string;
    folio?: string;
  };
  period: {
    start: string;
    end: string;
    label: string;
  };
  totalAmount: number;
  movementCount: number;
  folio?: string;
}

export const CommissionSettlementSummary: React.FC<CommissionSettlementSummaryProps> = ({
  seller,
  period,
  totalAmount,
  movementCount,
  folio,
}) => {
  return (
    <div className="space-y-4">
      {/* Seller Info */}
      <div className="p-4 bg-neutral-900 rounded-lg border border-neutral-800">
        <p className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Vendedor</p>
        <p className="text-lg font-semibold text-neutral-100">{seller.name}</p>
        {seller.folio && (
          <p className="text-sm text-neutral-400 mt-1">Folio: {seller.folio}</p>
        )}
      </div>

      {/* Period Info */}
      <div className="p-4 bg-neutral-900 rounded-lg border border-neutral-800">
        <div className="flex items-center gap-2 mb-3">
          <Calendar size={16} className="text-yellow-500" />
          <p className="text-xs text-neutral-500 uppercase tracking-wider">Período</p>
        </div>
        <p className="text-lg font-semibold text-neutral-100">{period.label}</p>
        <p className="text-xs text-neutral-500 mt-2">
          {formatDate(period.start)} → {formatDate(period.end)}
        </p>
      </div>

      {/* Amount Info */}
      <div className="p-4 bg-gradient-to-br from-yellow-500/10 to-yellow-500/5 rounded-lg border border-yellow-500/30">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign size={16} className="text-yellow-500" />
          <p className="text-xs text-neutral-500 uppercase tracking-wider">Monto a pagar</p>
        </div>
        <p className="text-2xl font-bold text-yellow-400">{formatCurrency(totalAmount)}</p>
      </div>

      {/* Movement Count */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-neutral-900 rounded-lg border border-neutral-800">
          <p className="text-xs text-neutral-500 uppercase tracking-wider">Movimientos</p>
          <p className="text-xl font-semibold text-neutral-200 mt-1">{movementCount}</p>
        </div>

        {folio && (
          <div className="p-3 bg-neutral-900 rounded-lg border border-neutral-800">
            <div className="flex items-center gap-2">
              <Hash size={14} className="text-neutral-500" />
              <p className="text-xs text-neutral-500 uppercase tracking-wider">Folio</p>
            </div>
            <p className="text-lg font-mono font-semibold text-yellow-400 mt-1">{folio}</p>
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <p className="text-xs text-blue-300">
          <span className="font-semibold">Nota:</span> Al avanzar, se creará un borrador de liquidación con estos datos.
          Podrás revisar los detalles antes de confirmar el pago.
        </p>
      </div>
    </div>
  );
};
