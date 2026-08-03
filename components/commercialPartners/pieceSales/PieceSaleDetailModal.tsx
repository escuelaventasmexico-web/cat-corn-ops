import { useState, useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { PieceSaleHistory, PieceSaleHistoryItem, PieceSaleCorrection } from '../../../types/pieceSales';
import {
  formatCurrency,
  formatDateMx,
  getSaleStatusLabel,
  getSaleStatusColor,
  safeInteger,
  safeNumber,
  normalizePieceSaleItems,
  calculateUnitsFromItems,
} from '../../../lib/pieceSalesHelpers';
import { supabase } from '../../../supabase';
import { PieceSaleItemCorrectionModal } from './PieceSaleItemCorrectionModal';

interface PieceSaleDetailModalProps {
  sale: PieceSaleHistory;
  isAdmin?: boolean;
  onClose: () => void;
  onRefresh?: () => void;
}

export const PieceSaleDetailModal = ({ 
  sale, 
  isAdmin = false,
  onClose,
  onRefresh,
}: PieceSaleDetailModalProps) => {
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [selectedItemForCorrection, setSelectedItemForCorrection] = useState<PieceSaleHistoryItem | null>(null);
  const [corrections, setCorrections] = useState<PieceSaleCorrection[]>([]);

  const folio = sale.folio || sale.sale_folio || 'Sin folio';
  const vendedor = sale.seller_name || 'Vendedor sin nombre';
  const fecha = formatDateMx(sale.sale_date);
  const metodo = sale.payment_method === 'cash' ? 'Efectivo' : 'Transferencia';
  const estado = getSaleStatusLabel(sale.status);
  const estadoColor = getSaleStatusColor(sale.status);
  const notas = sale.notes || 'Sin notas';
  const totalMonto = formatCurrency(safeNumber(sale.total_amount));
  const totalComisión = formatCurrency(safeNumber(sale.total_commission));

  // Normalizar y procesar items
  const items = normalizePieceSaleItems(sale.items);
  
  // Calcular unidades: usar total_units si es > 0, si no calcular desde items
  const unidadesTotales =
    safeNumber(sale.total_units) > 0
      ? safeNumber(sale.total_units)
      : calculateUnitsFromItems(items);

  // Verificar si la venta puede ser corregida
  const canCorrect = ['draft', 'pending_review', 'payment_rejected'].includes(sale.status);

  // Cargar historial de correcciones (solo admin)
  useEffect(() => {
    if (isAdmin && sale.sale_id) {
      loadCorrections();
    }
  }, [isAdmin, sale.sale_id]);

  const loadCorrections = async () => {
    if (!supabase) return;
    
    const { data, error } = await supabase
      .from('v_piece_sale_correction_history')
      .select('*')
      .eq('sale_id', sale.sale_id)
      .order('corrected_at', { ascending: false });

    if (error) {
      console.error('Error loading corrections:', error);
    } else {
      setCorrections(data || []);
    }
  };

  const handleOpenCorrectionModal = (item: PieceSaleHistoryItem) => {
    setSelectedItemForCorrection(item);
    setCorrectionModalOpen(true);
  };

  const handleCorrectionSuccess = () => {
    setCorrectionModalOpen(false);
    setSelectedItemForCorrection(null);
    loadCorrections();
    onRefresh?.();
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-cc-bg rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between p-6 border-b border-white/10 bg-cc-surface">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-cc-text-main">Detalle de Venta</h2>
            {sale.has_corrections && (
              <span className="px-2 py-1 bg-amber-500/20 border border-amber-500/50 rounded text-xs font-semibold text-amber-400">
                Corregida
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/5 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-cc-text-muted uppercase tracking-wider">Folio</p>
              <p className="text-lg font-mono text-cc-text-main">{folio}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-cc-text-muted uppercase tracking-wider">Vendedor</p>
              <p className="text-lg font-semibold text-cc-text-main">{vendedor}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-cc-text-muted uppercase tracking-wider">Fecha</p>
              <p className="text-lg text-cc-text-main">{fecha}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-cc-text-muted uppercase tracking-wider">Método</p>
              <p className="text-lg text-cc-text-main">{metodo}</p>
            </div>
          </div>

          {/* Status & Units */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/10">
            <div className="space-y-1">
              <p className="text-xs text-cc-text-muted uppercase tracking-wider">Estado</p>
              <p className={`text-lg font-semibold ${estadoColor}`}>{estado}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-cc-text-muted uppercase tracking-wider">Unidades Totales</p>
              <p className="text-lg font-semibold text-cc-text-main">
                {safeInteger(unidadesTotales)}
              </p>
            </div>
          </div>

          {/* Totals */}
          <div className="space-y-3 p-4 rounded-lg bg-cc-surface border border-white/10">
            <div className="flex justify-between">
              <span className="text-cc-text-muted">Total de venta:</span>
              <span className="font-semibold text-cc-text-main">{totalMonto}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-cc-text-muted">Comisión generada:</span>
              <span className="font-semibold text-cc-primary">{totalComisión}</span>
            </div>
          </div>

          {/* Últimas correcciones (si aplica) */}
          {sale.has_corrections && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm">
              <p className="text-amber-400">
                <strong>Última corrección:</strong> {formatDateMx(sale.latest_correction_at)} por{' '}
                {sale.latest_corrected_by_name}
              </p>
              {sale.latest_correction_reason && (
                <p className="text-amber-300 mt-1">
                  <strong>Razón:</strong> {sale.latest_correction_reason}
                </p>
              )}
            </div>
          )}

          {/* Notes */}
          {sale.notes && (
            <div className="space-y-2 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <p className="text-xs text-blue-300 uppercase tracking-wider">Notas</p>
              <p className="text-sm text-blue-200">{notas}</p>
            </div>
          )}

          {/* Items Table */}
          <div className="space-y-3">
            <h3 className="font-semibold text-cc-text-main uppercase tracking-wider text-sm">
              Productos Vendidos
            </h3>

            {items.length > 0 ? (
              <div className="space-y-2 border-t border-white/10">
                {items.map((item, idx) => {
                  const cantidad = safeNumber(item.quantity);
                  const nombre = item.product_name || 'Producto sin nombre';
                  const variante = item.product_variant || '';
                  const presentacion = item.product_size || '';
                  const precioUnitario = formatCurrency(safeNumber(item.unit_retail_price));
                  const subtotal = formatCurrency(safeNumber(item.subtotal));

                  return (
                    <div key={item.item_id || idx} className="py-3 border-b border-white/5 last:border-b-0">
                      {/* Cantidad y Producto */}
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex-1">
                          <p className="font-semibold text-cc-text-main">
                            {safeInteger(cantidad)}× {nombre}
                          </p>
                          {(variante || presentacion) && (
                            <p className="text-xs text-cc-text-muted mt-0.5">
                              {[variante, presentacion].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>

                        {/* Botón Corregir */}
                        {!isAdmin && canCorrect && (
                          <button
                            onClick={() => handleOpenCorrectionModal(item)}
                            className="px-2 py-1 text-xs font-semibold rounded bg-cc-primary/20 text-cc-primary hover:bg-cc-primary/30 transition whitespace-nowrap"
                          >
                            Corregir
                          </button>
                        )}
                      </div>

                      {/* Precios */}
                      <div className="grid grid-cols-2 gap-2 text-xs text-cc-text-muted mt-2">
                        <div>
                          <span className="text-cc-text-muted">Precio unitario:</span>
                          <p className="text-cc-text-main font-mono">{precioUnitario}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-cc-text-muted">Subtotal:</span>
                          <p className="text-cc-text-main font-mono">{subtotal}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 text-center text-cc-text-muted bg-cc-surface rounded-lg border border-white/10">
                Sin detalle de productos
              </div>
            )}
          </div>

          {/* Historial de correcciones (admin) */}
          {isAdmin && corrections.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-white/10">
              <h3 className="font-semibold text-cc-text-main uppercase tracking-wider text-sm">
                Historial de Correcciones ({corrections.length})
              </h3>

              <div className="space-y-4">
                {corrections.map(correction => (
                  <div
                    key={correction.correction_id}
                    className="bg-cc-surface rounded-lg p-4 border border-white/10 text-sm space-y-3"
                  >
                    {/* Encabezado */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-cc-text-secondary text-xs">
                          {formatDateMx(correction.corrected_at)}
                        </p>
                        <p className="text-cc-text-main font-medium mt-1">
                          {correction.corrected_by_name || 'Usuario'} corrigió esta venta
                        </p>
                      </div>
                    </div>

                    {/* Razón */}
                    {correction.correction_reason && (
                      <div className="bg-cc-bg rounded px-3 py-2">
                        <p className="text-cc-text-secondary text-xs mb-1">Razón:</p>
                        <p className="text-cc-text-main">{correction.correction_reason}</p>
                      </div>
                    )}

                    {/* Antes y Después */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {/* Antes */}
                      <div>
                        <p className="text-cc-text-secondary font-semibold mb-2">ANTES</p>
                        <div className="space-y-1 text-cc-text-main">
                          <p>
                            {safeInteger(correction.before_snapshot.quantity)}×{' '}
                            {correction.before_snapshot.product_name}
                          </p>
                          <p className="font-mono text-cc-text-secondary">
                            ${Number(correction.before_snapshot.unit_retail_price ?? 0).toFixed(2)}
                          </p>
                          <p className="font-semibold">
                            ${Number(correction.before_snapshot.subtotal ?? 0).toFixed(2)}
                          </p>
                          <p className="text-cc-primary">
                            Comisión: ${Number(correction.before_snapshot.commission_total ?? 0).toFixed(2)}
                          </p>
                        </div>
                      </div>

                      {/* Después */}
                      <div>
                        <p className="text-cc-text-secondary font-semibold mb-2">DESPUÉS</p>
                        <div className="space-y-1 text-cc-text-main">
                          <p>
                            {safeInteger(correction.after_snapshot.quantity)}×{' '}
                            {correction.after_snapshot.product_name}
                          </p>
                          <p className="font-mono text-cc-text-secondary">
                            ${Number(correction.after_snapshot.unit_retail_price ?? 0).toFixed(2)}
                          </p>
                          <p className="font-semibold">
                            ${Number(correction.after_snapshot.subtotal ?? 0).toFixed(2)}
                          </p>
                          <p className="text-cc-primary">
                            Comisión: ${Number(correction.after_snapshot.commission_total ?? 0).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Totales de venta */}
                    <div className="border-t border-white/10 pt-3 text-xs">
                      <p className="text-cc-text-secondary mb-2">Total de venta afectado:</p>
                      <div className="grid grid-cols-2 gap-3 text-cc-text-main">
                        <div>
                          <p className="text-cc-text-secondary">Antes:</p>
                          <p className="font-semibold">
                            ${Number(correction.previous_sale_total ?? 0).toFixed(2)}
                          </p>
                        </div>
                        <div>
                          <p className="text-cc-text-secondary">Después:</p>
                          <p className="font-semibold">
                            ${Number(correction.new_sale_total ?? 0).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Advertencia de pago */}
                    {correction.payment_request_reset && (
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2 flex gap-2">
                        <AlertCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                        <p className="text-amber-400">
                          El comprobante de transferencia fue invalidado porque cambió el total.
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 p-6 border-t border-white/10 bg-cc-surface flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors text-cc-text-main font-semibold"
          >
            Cerrar
          </button>
        </div>
      </div>

      {/* Modal de corrección */}
      {correctionModalOpen && selectedItemForCorrection && (
        <PieceSaleItemCorrectionModal
          sale={sale}
          item={selectedItemForCorrection}
          onClose={() => {
            setCorrectionModalOpen(false);
            setSelectedItemForCorrection(null);
          }}
          onSuccess={handleCorrectionSuccess}
        />
      )}
    </div>
  );
};
