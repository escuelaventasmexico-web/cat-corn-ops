/* ── Commission Settlement Detail Modal ──────────────────────────────── */

import React, { useState, useEffect } from 'react';
import { X, AlertCircle, Loader } from 'lucide-react';
import { loadSettlementDetail } from './paymentUtils';
import { formatCurrency, formatDate } from '../commissionUtils';
import { CommissionSettlementDetail } from '../commissionTypes';
import { CommissionSettlementHistory } from '../commissionTypes';

interface CommissionSettlementDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  settlementId: string;
  settlement: CommissionSettlementHistory;
}

export const CommissionSettlementDetailModal: React.FC<CommissionSettlementDetailModalProps> = ({
  isOpen,
  onClose,
  settlementId,
  settlement,
}) => {
  const [details, setDetails] = useState<CommissionSettlementDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, settlementId]);

  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      const data = await loadSettlementDetail(settlementId);
      console.log('SETTLEMENT DETAIL LOADED', data);
      setDetails(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar detalles';
      console.error('LOAD DETAIL ERROR', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const totalAmount = details.reduce(
    (sum, d) => sum + Number(d.settlement_item_amount || 0),
    0
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 rounded-lg border border-neutral-800 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-900">
          <div>
            <p className="text-xs text-neutral-500 uppercase tracking-wider">
              Detalle de liquidación
            </p>
            <p className="text-sm font-mono font-semibold text-yellow-400 mt-1">
              {settlement.folio}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Settlement Info */}
          <div className="grid grid-cols-2 gap-3 p-4 bg-neutral-800/50 rounded-lg border border-neutral-700">
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider">Período</p>
              <p className="text-sm font-medium text-neutral-200 mt-1">
                {settlement.period_label}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider">Estado</p>
              <p className="text-sm font-medium text-neutral-200 mt-1">
                {settlement.status === 'draft' && 'En preparación'}
                {settlement.status === 'paid' && 'Pagada'}
                {settlement.status === 'cancelled' && 'Cancelada'}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider">Total</p>
              <p className="text-lg font-semibold text-yellow-400 mt-1">
                {formatCurrency(totalAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider">Movimientos</p>
              <p className="text-sm font-medium text-neutral-200 mt-1">{details.length}</p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="text-center py-6">
              <Loader size={20} className="mx-auto text-yellow-500 animate-spin" />
            </div>
          )}

          {/* Details Table */}
          {!loading && details.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-neutral-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-800 border-b border-neutral-700">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                      Fecha
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                      Socio
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                      Producto
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                      Cant.
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                      C/U
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((detail) => (
                    <tr
                      key={detail.commission_event_id}
                      className="border-b border-neutral-800 hover:bg-neutral-800/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-neutral-300">
                        {formatDate(detail.earned_at)}
                      </td>
                      <td className="px-4 py-3 text-neutral-300">
                        <div>
                          <p className="font-medium">{detail.business_name}</p>
                          <p className="text-xs text-neutral-500">{detail.partner_folio}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-neutral-300">
                        <div>
                          <p>{detail.product_name}</p>
                          {detail.product_variant && (
                            <p className="text-xs text-neutral-500">{detail.product_variant}</p>
                          )}
                          {detail.product_size && (
                            <p className="text-xs text-neutral-500">{detail.product_size}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-neutral-300 font-medium">
                        {detail.quantity}
                      </td>
                      <td className="px-4 py-3 text-right text-neutral-300">
                        {formatCurrency(Number(detail.unit_commission))}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-yellow-400">
                        {formatCurrency(Number(detail.settlement_item_amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && details.length === 0 && (
            <div className="text-center py-6">
              <p className="text-neutral-400">No hay movimientos registrados</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex justify-end gap-3 p-4 border-t border-neutral-800 bg-neutral-900">
          <button
            onClick={onClose}
            className="
              px-4 py-2 rounded-lg font-medium text-black
              bg-yellow-500 hover:bg-yellow-400
              transition-colors
            "
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
