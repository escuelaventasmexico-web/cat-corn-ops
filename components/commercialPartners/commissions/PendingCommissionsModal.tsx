import { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { X, AlertCircle, Loader2 } from 'lucide-react';
import { CommissionMovement } from './commissionTypes';
import { formatCurrency, parseNumericValue } from './commissionUtils';

interface PendingCommissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sellerId: string;
  sellerName: string;
  monthStart: string;
  monthEnd: string;
  pendingTotal: number;
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  comodato_sale: 'Venta en comodato',
  wholesale_sale: 'Venta de mayoreo',
  piece_sale: 'Venta por pieza',
  conversion_bonus: 'Bono por conversión Comodato → Mayoreo',
  adjustment: 'Ajuste',
};

const getSourceTypeLabel = (sourceType: string): string => {
  return SOURCE_TYPE_LABELS[sourceType] || sourceType;
};

const getWaitingReason = (sourceType: string, releaseCondition: string): string => {
  switch (sourceType) {
    case 'piece_sale':
      return 'El cobro todavía no ha sido confirmado por el administrador.';
    case 'comodato_sale':
      return 'La operación de comodato todavía no ha sido liquidada completamente.';
    case 'wholesale_sale':
      return 'El pedido de mayoreo todavía no ha sido liquidado completamente.';
    case 'conversion_bonus':
      return 'La primera compra de mayoreo que libera el bono todavía no cumple las condiciones de pago.';
    default:
      if (releaseCondition === 'full_payment') {
        return 'Se libera cuando la operación quede completamente pagada.';
      }
      return 'Esta comisión todavía no cumple su condición de liberación.';
  }
};

export const PendingCommissionsModal = ({
  isOpen,
  onClose,
  sellerId,
  monthStart,
  monthEnd,
  pendingTotal,
}: PendingCommissionsModalProps) => {
  const [movements, setMovements] = useState<CommissionMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadPendingMovements();
    }
  }, [isOpen, sellerId, monthStart, monthEnd]);

  const loadPendingMovements = async () => {
    if (!supabase) {
      setError('Supabase no configurado');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: err } = await supabase
        .from('v_seller_commission_movements')
        .select('*')
        .eq('seller_id', sellerId)
        .eq('status', 'pending')
        .gte('earned_at', monthStart)
        .lte('earned_at', monthEnd)
        .order('earned_at', { ascending: false });

      if (err) throw err;
      setMovements((data as CommissionMovement[]) || []);
    } catch (err: any) {
      console.error('Error loading pending commissions:', err);
      setError('No se pudo cargar el detalle de las comisiones pendientes.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const calculateTotal = (): number => {
    return movements.reduce((sum, m) => sum + parseNumericValue(m.commission_amount), 0);
  };

  const currentTotal = calculateTotal();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 px-4 pb-8 overflow-y-auto bg-black/40">
      <div
        className="relative w-full max-w-3xl bg-[#111111] rounded-2xl border border-white/10 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-white/10">
          <div>
            <h2 className="text-2xl font-bold text-cc-cream">Comisiones pendientes de liberación</h2>
            <p className="text-sm text-cc-text-muted mt-1">
              Detalle de las comisiones que todavía no cumplen las condiciones para quedar disponibles para pago.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-cc-text-muted transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Summary Bar */}
        <div className="px-6 py-4 border-b border-white/10 bg-[#1a1a1a]">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-cc-text-muted mb-1">Total pendiente</p>
              <p className="text-2xl font-bold text-cc-cream">{formatCurrency(currentTotal)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-cc-text-muted mb-1">Movimientos pendientes</p>
              <p className="text-2xl font-bold text-cc-cream">{movements.length}</p>
            </div>
          </div>
          {currentTotal !== pendingTotal && (
            <p className="text-xs text-yellow-400 mt-2">
              ⚠️ Suma del detalle: {formatCurrency(currentTotal)} vs tarjeta: {formatCurrency(pendingTotal)}
            </p>
          )}
        </div>

        {/* Content */}
        <div className="px-6 py-5 max-h-[calc(100vh-300px)] overflow-y-auto bg-[#111111]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-cc-primary animate-spin" />
            </div>
          ) : error ? (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-300">{error}</p>
                <button
                  onClick={loadPendingMovements}
                  className="text-xs font-medium text-red-400 hover:text-red-300 mt-2"
                >
                  Reintentar
                </button>
              </div>
            </div>
          ) : movements.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-cc-text-muted">No hay comisiones pendientes de liberación en este período.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {movements.map((movement, idx) => (
                <div
                  key={idx}
                  className="bg-cc-surface border border-white/10 rounded-lg p-4 hover:border-white/20 transition-colors"
                >
                  {/* Type and Date */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-cc-primary">
                        {getSourceTypeLabel(movement.source_type)}
                      </p>
                      <p className="text-xs text-cc-text-muted mt-0.5">
                        {new Date(movement.earned_at).toLocaleDateString('es-MX', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <p className="text-lg font-bold text-cc-primary">
                      {formatCurrency(parseNumericValue(movement.commission_amount))}
                    </p>
                  </div>

                  {/* Partner Info */}
                  {movement.business_name ? (
                    <div className="mb-3">
                      <p className="text-xs font-semibold text-cc-text-muted">Cliente</p>
                      <p className="text-sm text-cc-cream font-medium">{movement.business_name}</p>
                    </div>
                  ) : null}

                  {/* Product Info */}
                  {movement.product_name && (
                    <div className="mb-3">
                      <p className="text-xs font-semibold text-cc-text-muted">Producto</p>
                      <div className="text-sm text-cc-cream">
                        <p className="font-medium">{movement.product_name}</p>
                        {movement.product_variant && (
                          <p className="text-xs text-cc-text-muted">{movement.product_variant}</p>
                        )}
                        {movement.product_size && (
                          <p className="text-xs text-cc-text-muted">Presentación: {movement.product_size}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Commission Details */}
                  <div className="grid grid-cols-3 gap-3 mb-3 p-3 bg-[#1a1a1a] rounded border border-white/10">
                    <div>
                      <p className="text-xs font-semibold text-cc-text-muted">Cantidad</p>
                      <p className="text-sm font-bold text-cc-cream">{movement.quantity}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-cc-text-muted">Comisión unitaria</p>
                      <p className="text-sm font-bold text-cc-cream">
                        {formatCurrency(parseNumericValue(movement.unit_commission))}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-cc-text-muted">Total</p>
                      <p className="text-sm font-bold text-cc-primary">
                        {formatCurrency(parseNumericValue(movement.commission_amount))}
                      </p>
                    </div>
                  </div>

                  {/* Folio if exists */}
                  {movement.source_folio && (
                    <div className="mb-3">
                      <p className="text-xs font-semibold text-cc-text-muted">
                        Folio: <span className="font-mono text-cc-cream">{movement.source_folio}</span>
                      </p>
                    </div>
                  )}

                  {/* Pending Reason */}
                  <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded text-sm text-yellow-200">
                    <p className="font-semibold mb-1">Pendiente porque:</p>
                    <p className="text-xs">{getWaitingReason(movement.source_type, movement.release_condition)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/10 bg-[#1a1a1a]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-cc-text-main font-medium transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
