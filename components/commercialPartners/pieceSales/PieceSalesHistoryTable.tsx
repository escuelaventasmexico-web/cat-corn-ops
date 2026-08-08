import { useState } from 'react';
import { RefreshCw, Eye } from 'lucide-react';
import { PieceSaleHistory } from '../../../types/pieceSales';
import {
  formatCurrency,
  formatDateMx,
  formatVerificationDateTime,
  getSaleStatusLabel,
  getSaleStatusColor,
  safeInteger,
  safeNumber,
  normalizePieceSaleItems,
  calculateUnitsFromItems,
} from '../../../lib/pieceSalesHelpers';
import { RejectionRetryModal } from './RejectionRetryModal';
import { PieceSaleDetailModal } from './PieceSaleDetailModal';

interface PieceSalesHistoryTableProps {
  history: PieceSaleHistory[];
  onRefresh: () => void;
  isAdmin?: boolean;
}

export const PieceSalesHistoryTable = ({ history, onRefresh, isAdmin = false }: PieceSalesHistoryTableProps) => {
  const [selectedRejection, setSelectedRejection] = useState<PieceSaleHistory | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<PieceSaleHistory | null>(null);

  if (history.length === 0) {
    return (
      <div className="text-center py-12 text-cc-text-muted border border-white/5 rounded-2xl">
        No hay ventas registradas todavía.
      </div>
    );
  }

  // Console logging para debuggeo temporal
  console.log('Admin piece sale history:', history);

  return (
    <>
      {isAdmin ? (
        /* ── ADMIN VIEW: Columnas completas con productos ────────────────── */
        <div className="overflow-x-auto border border-white/5 rounded-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-cc-surface/50">
                <th className="px-4 py-3 text-left text-cc-text-muted font-semibold">Folio</th>
                <th className="px-4 py-3 text-left text-cc-text-muted font-semibold">Vendedor</th>
                <th className="px-4 py-3 text-left text-cc-text-muted font-semibold">Fecha</th>
                <th className="px-4 py-3 text-left text-cc-text-muted font-semibold">Productos Vendidos</th>
                <th className="px-4 py-3 text-center text-cc-text-muted font-semibold">Unidades</th>
                <th className="px-4 py-3 text-right text-cc-text-muted font-semibold">Total</th>
                <th className="px-4 py-3 text-right text-cc-text-muted font-semibold">Comisión</th>
                <th className="px-4 py-3 text-left text-cc-text-muted font-semibold">Método</th>
                <th className="px-4 py-3 text-left text-cc-text-muted font-semibold">Estado</th>
                <th className="px-4 py-3 text-center text-cc-text-muted font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {history.map((sale) => {
                const folio = sale.folio || sale.sale_folio || '—';
                const vendedor = sale.seller_name || 'Vendedor sin nombre';
                const items = normalizePieceSaleItems(sale.items);
                
                // Calcular unidades: usar total_units si es > 0, si no calcular desde items
                const unidadesTotales =
                  safeNumber(sale.total_units) > 0
                    ? safeNumber(sale.total_units)
                    : calculateUnitsFromItems(items);

                // Crear resumen de productos vendidos
                const productSummary = items
                  .slice(0, 2)
                  .map(item => `${safeInteger(item.quantity)}× ${item.product_name}`)
                  .join('\n');
                
                const hasMore = items.length > 2;
                const moreText = hasMore ? ` +${items.length - 2} producto(s) más` : '';

                return (
                  <tr key={sale.sale_id} className="border-b border-white/5 hover:bg-cc-surface/30">
                    <td className="px-4 py-3 text-cc-cream font-mono text-xs">
                      {folio}
                    </td>
                    <td className="px-4 py-3 text-cc-text-main text-sm">
                      {vendedor}
                    </td>
                    <td className="px-4 py-3 text-cc-text-muted text-sm">
                      {formatDateMx(sale.sale_date)}
                    </td>
                    <td className="px-4 py-3 text-cc-text-muted text-xs max-w-xs">
                      {items.length > 0 ? (
                        <div className="whitespace-pre-line">
                          <div>{productSummary}</div>
                          {moreText && <div className="text-cc-primary font-semibold text-xs mt-1">{moreText}</div>}
                        </div>
                      ) : (
                        <span className="italic">Sin detalle de productos</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-cc-cream text-center font-semibold">
                      {safeInteger(unidadesTotales)}
                    </td>
                    <td className="px-4 py-3 text-right text-cc-cream font-semibold">
                      {formatCurrency(safeNumber(sale.total_amount))}
                    </td>
                    <td className="px-4 py-3 text-right text-cc-cream">
                      {formatCurrency(safeNumber(sale.total_commission))}
                    </td>
                    <td className="px-4 py-3 text-cc-text-muted text-sm">
                      {sale.payment_method === 'cash' ? 'Efectivo' : 'Transferencia'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <span className={`text-sm font-semibold ${getSaleStatusColor(sale.status)}`}>
                          {getSaleStatusLabel(sale.status)}
                        </span>
                        {sale.verification_reviewed_at && (
                          <div className="text-xs text-cc-text-muted">
                            {sale.status === 'confirmed' ? 'Verificada:' : 'Revisado:'} {formatVerificationDateTime(sale.verification_reviewed_at)}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setSelectedDetail(sale)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded text-xs font-semibold transition-colors"
                          title="Ver detalle"
                        >
                          <Eye size={14} />
                          Ver
                        </button>
                        {sale.status === 'payment_rejected' && (
                          <button
                            onClick={() => setSelectedRejection(sale)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded text-xs font-semibold transition-colors"
                            title="Reintentar pago"
                          >
                            <RefreshCw className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── SELLER VIEW: Columnas simplificadas sin Vendedor ────────────── */
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
              {history.map((sale) => {
                const folio = sale.folio || sale.sale_folio || '—';
                const items = normalizePieceSaleItems(sale.items);
                
                const unidadesTotales =
                  safeNumber(sale.total_units) > 0
                    ? safeNumber(sale.total_units)
                    : calculateUnitsFromItems(items);

                return (
                  <tr key={sale.sale_id} className="border-b border-white/5 hover:bg-cc-surface/30">
                    <td className="px-6 py-3 text-cc-cream font-semibold">{folio}</td>
                    <td className="px-6 py-3 text-cc-text-muted">{formatDateMx(sale.sale_date)}</td>
                    <td className="px-6 py-3 text-cc-cream">{safeInteger(unidadesTotales)}</td>
                    <td className="px-6 py-3 text-right text-cc-cream">
                      {formatCurrency(safeNumber(sale.total_amount))}
                    </td>
                    <td className="px-6 py-3 text-right text-cc-cream">
                      {formatCurrency(safeNumber(sale.total_commission))}
                    </td>
                    <td className="px-6 py-3 text-cc-text-muted">
                      {sale.payment_method === 'cash' ? 'Efectivo' : 'Transferencia'}
                    </td>
                    <td className="px-6 py-3">
                      <div className="space-y-1">
                        <span className={`text-sm font-semibold ${getSaleStatusColor(sale.status)}`}>
                          {getSaleStatusLabel(sale.status)}
                        </span>
                        {sale.verification_reviewed_at && (
                          <div className="text-xs text-cc-text-muted">
                            {sale.status === 'confirmed' ? 'Verificada:' : 'Revisado:'} {formatVerificationDateTime(sale.verification_reviewed_at)}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setSelectedDetail(sale)}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded text-xs font-semibold transition-colors"
                          title="Ver detalle de venta"
                        >
                          <Eye size={14} />
                          Ver detalle
                        </button>
                        {sale.status === 'payment_rejected' && (
                          <button
                            onClick={() => setSelectedRejection(sale)}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded text-xs font-semibold transition-colors"
                            title="Reintentar pago rechazado"
                          >
                            <RefreshCw className="w-3 h-3" />
                            Reintentar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
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

      {selectedDetail && (
        <PieceSaleDetailModal
          sale={selectedDetail}
          isAdmin={isAdmin}
          onClose={() => setSelectedDetail(null)}
          onRefresh={onRefresh}
        />
      )}
    </>
  );
};
