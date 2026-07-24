import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { PieceSaleHistory } from '../../../types/pieceSales';
import {
  formatCurrency,
  formatDateMx,
  getSaleStatusLabel,
  getSaleStatusColor,
  safeInteger,
} from '../../../lib/pieceSalesHelpers';
import { RejectionRetryModal } from './RejectionRetryModal';

interface PieceSalesHistoryTableProps {
  history: PieceSaleHistory[];
  onRefresh: () => void;
}

export const PieceSalesHistoryTable = ({ history, onRefresh }: PieceSalesHistoryTableProps) => {
  const [selectedRejection, setSelectedRejection] = useState<PieceSaleHistory | null>(null);

  if (history.length === 0) {
    return (
      <div className="text-center py-12 text-cc-text-muted border border-white/5 rounded-2xl">
        No hay ventas registradas todavía.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto border border-white/5 rounded-2xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 bg-cc-surface/50">
              <th className="px-6 py-3 text-left text-cc-text-muted font-semibold">Folio</th>
              <th className="px-6 py-3 text-left text-cc-text-muted font-semibold">Fecha</th>
              <th className="px-6 py-3 text-left text-cc-text-muted font-semibold">Unidades</th>
              <th className="px-6 py-3 text-right text-cc-text-muted font-semibold">Total</th>
              <th className="px-6 py-3 text-right text-cc-text-muted font-semibold">Comisión</th>
              <th className="px-6 py-3 text-left text-cc-text-muted font-semibold">Método</th>
              <th className="px-6 py-3 text-left text-cc-text-muted font-semibold">Estado</th>
              <th className="px-6 py-3 text-center text-cc-text-muted font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {history.map((sale) => (
              <tr key={sale.sale_id} className="border-b border-white/5 hover:bg-cc-surface/30">
                <td className="px-6 py-3 text-cc-cream font-semibold">{sale.sale_folio}</td>
                <td className="px-6 py-3 text-cc-text-muted">{formatDateMx(sale.sale_date)}</td>
                <td className="px-6 py-3 text-cc-cream">{safeInteger(sale.units_sold)}</td>
                <td className="px-6 py-3 text-right text-cc-cream">
                  {formatCurrency(sale.total_amount)}
                </td>
                <td className="px-6 py-3 text-right text-cc-cream">
                  {formatCurrency(sale.total_commission)}
                </td>
                <td className="px-6 py-3 text-cc-text-muted">
                  {sale.payment_method === 'cash' ? 'Efectivo' : 'Transferencia'}
                </td>
                <td className="px-6 py-3">
                  <span className={`text-sm font-semibold ${getSaleStatusColor(sale.status)}`}>
                    {getSaleStatusLabel(sale.status)}
                  </span>
                </td>
                <td className="px-6 py-3 text-center">
                  {sale.status === 'payment_rejected' && (
                    <button
                      onClick={() => setSelectedRejection(sale)}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded text-xs font-semibold transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Reintentar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedRejection && (
        <RejectionRetryModal
          sale={selectedRejection}
          onClose={() => setSelectedRejection(null)}
          onSuccess={() => {
            setSelectedRejection(null);
            onRefresh();
          }}
        />
      )}
    </>
  );
};
