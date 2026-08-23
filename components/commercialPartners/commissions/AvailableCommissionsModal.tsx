import { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { X, AlertCircle, Loader2 } from 'lucide-react';
import { CommissionMovement } from './commissionTypes';
import { formatCurrency, parseNumericValue } from './commissionUtils';

interface AvailableCommissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sellerId: string;
  sellerName: string;
  monthStart: string;
  monthEnd: string;
  availableTotal: number;
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  comodato_sale: 'Comodato',
  wholesale_sale: 'Mayoreo',
  piece_sale: 'Venta por pieza',
  pos_sale: 'Punto de Venta',
  conversion_bonus: 'Bono de conversión',
  adjustment: 'Ajuste',
  extra_day: 'Día extra',
};

const getSourceTypeLabel = (sourceType: string, metadata?: any): string => {
  // Check if this is an extra day adjustment
  if (sourceType === 'adjustment' && metadata) {
    try {
      const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      if (meta?.adjustment_type === 'extra_day') {
        return 'Día extra';
      }
    } catch {
      // Fall through to default handling
    }
  }
  return SOURCE_TYPE_LABELS[sourceType] || sourceType;
};

export const AvailableCommissionsModal = ({
  isOpen,
  onClose,
  sellerId,
  sellerName,
  monthStart,
  monthEnd,
  availableTotal,
}: AvailableCommissionsModalProps) => {
  const [movements, setMovements] = useState<CommissionMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceBreakdown, setSourceBreakdown] = useState<Record<string, number>>({});

  useEffect(() => {
    if (isOpen) {
      loadAvailableMovements();
    }
  }, [isOpen, sellerId, monthStart, monthEnd]);

  const loadAvailableMovements = async () => {
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
        .eq('status', 'available')
        .gt('allocatable_amount', 0)
        .gte('earned_at', monthStart)
        .lte('earned_at', monthEnd)
        .order('earned_at', { ascending: false });

      if (err) throw err;
      const movementsData = (data as CommissionMovement[]) || [];
      setMovements(movementsData);

      // Calculate breakdown by source (with special handling for extra_day adjustments)
      const breakdown: Record<string, number> = {};
      movementsData.forEach(m => {
        let sourceKey: string = m.source_type || 'unknown';
        
        // Special case: if it's an adjustment with adjustment_type='extra_day', group as 'extra_day'
        if (sourceKey === 'adjustment' && m.metadata) {
          try {
            const metadata = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata;
            if (metadata?.adjustment_type === 'extra_day') {
              sourceKey = 'extra_day';
            }
          } catch {
            // Fall through to use 'adjustment' as key
          }
        }
        
        breakdown[sourceKey] = (breakdown[sourceKey] || 0) + parseNumericValue(m.allocatable_amount);
      });
      setSourceBreakdown(breakdown);
    } catch (err: any) {
      console.error('Error loading available commissions:', err);
      setError('No se pudo cargar el detalle de las comisiones disponibles.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const calculateTotal = (): number => {
    return movements.reduce((sum, m) => sum + parseNumericValue(m.allocatable_amount), 0);
  };

  const currentTotal = calculateTotal();

  const renderMovementDetails = (movement: CommissionMovement): string => {
    const parts: string[] = [];

    if (movement.product_name) {
      parts.push(movement.product_name);
    }

    if (movement.product_variant) {
      parts.push(movement.product_variant);
    }

    if (movement.product_size) {
      parts.push(movement.product_size);
    }

    if (movement.quantity && movement.unit_commission) {
      const quantity = parseNumericValue(movement.quantity);
      const unitComm = parseNumericValue(movement.unit_commission);
      if (quantity > 0 && unitComm > 0) {
        parts.push(`${quantity} ${quantity === 1 ? 'pieza' : 'piezas'} × ${formatCurrency(unitComm)}`);
      }
    }

    return parts.join(' · ');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 px-4 pb-8 overflow-y-auto bg-black/70">
      <div
        className="relative w-full max-w-4xl bg-[#111111] rounded-2xl border border-white/10 shadow-2xl opacity-100"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-white/10">
          <div>
            <h2 className="text-2xl font-bold text-cc-cream">Comisiones disponibles</h2>
            <p className="text-sm text-cc-text-muted mt-1">
              {sellerName} · {new Date(`${monthStart}T00:00:00`).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-cc-text-muted transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Summary and Breakdown */}
        <div className="px-6 py-5 border-b border-white/10 bg-[#1a1a1a] space-y-4">
          <div>
            <p className="text-xs font-semibold text-cc-text-muted mb-1">Total disponible</p>
            <p className="text-3xl font-bold text-cc-primary">{formatCurrency(currentTotal)}</p>
          </div>

          {/* Source Breakdown */}
          {Object.keys(sourceBreakdown).length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 border-t border-white/10">
              {Object.entries(sourceBreakdown)
                .filter(([_, amount]) => amount > 0)
                .sort(([_, a], [__, b]) => b - a)
                .map(([sourceType, amount]) => (
                  <div key={sourceType} className="text-xs">
                    <p className="text-cc-text-muted font-semibold mb-0.5">{getSourceTypeLabel(sourceType)}</p>
                    <p className="text-lg font-bold text-cc-cream">{formatCurrency(amount)}</p>
                  </div>
                ))}
            </div>
          )}

          {currentTotal !== availableTotal && (
            <p className="text-xs text-yellow-400 mt-2">
              ⚠️ Suma del detalle: {formatCurrency(currentTotal)} vs tarjeta: {formatCurrency(availableTotal)}
            </p>
          )}
        </div>

        {/* Content */}
        <div className="px-6 py-5 max-h-[calc(100vh-350px)] overflow-y-auto bg-[#111111]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-cc-primary animate-spin" />
            </div>
          ) : error ? (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-300">Error</p>
                <p className="text-xs text-red-200">{error}</p>
              </div>
            </div>
          ) : movements.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-cc-text-muted">No hay comisiones disponibles en este período.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {movements.map(movement => (
                <div
                  key={movement.commission_event_id}
                  className="p-4 bg-cc-surface border border-white/5 rounded-lg hover:border-white/10 transition-all"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold bg-cc-primary/20 text-cc-primary px-2 py-1 rounded">
                          {getSourceTypeLabel(movement.source_type || '', movement.metadata)}
                        </span>
                        <span className="text-xs text-cc-text-muted">
                          {new Date(movement.earned_at).toLocaleDateString('es-MX')}
                        </span>
                      </div>
                      <p className="text-sm text-cc-text-main font-semibold">
                        {movement.source_type === 'adjustment' && (() => {
                          try {
                            const meta = typeof movement.metadata === 'string' 
                              ? JSON.parse(movement.metadata) 
                              : movement.metadata;
                            if (meta?.adjustment_type === 'extra_day') {
                              return meta?.description || 'Día extra';
                            }
                          } catch {}
                          return 'Comisión';
                        })() || movement.product_name || 'Comisión'}
                      </p>
                      {movement.source_type !== 'adjustment' && renderMovementDetails(movement) && (
                        <p className="text-xs text-cc-text-muted mt-1">
                          {renderMovementDetails(movement)}
                        </p>
                      )}
                      {movement.business_name && movement.source_type !== 'adjustment' && (
                        <p className="text-xs text-cc-text-muted mt-1">
                          Socio: {movement.business_name}
                        </p>
                      )}
                    </div>
                    <div className="text-right ml-4 flex-shrink-0">
                      <p className="text-lg font-bold text-cc-primary">
                        {formatCurrency(parseNumericValue(movement.allocatable_amount))}
                      </p>
                      <p className="text-xs text-cc-text-muted">Disponible para liquidar</p>
                      <p className="mt-1 text-xs text-cc-text-muted">
                        Generada {formatCurrency(parseNumericValue(movement.commission_amount))}
                        {' · '}Pagada {formatCurrency(parseNumericValue(movement.paid_amount))}
                        {' · '}Reservada {formatCurrency(parseNumericValue(movement.reserved_amount))}
                        {' · '}Saldo {formatCurrency(parseNumericValue(movement.remaining_amount))}
                      </p>
                      {movement.unit_commission && (
                        <p className="text-xs text-cc-text-muted">
                          {formatCurrency(parseNumericValue(movement.unit_commission))} u.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && movements.length > 0 && (
          <div className="px-6 py-4 border-t border-white/10 bg-[#1a1a1a] flex items-center justify-between">
            <p className="text-xs text-cc-text-muted">
              {movements.length} {movements.length === 1 ? 'movimiento' : 'movimientos'}
            </p>
            <div className="text-right">
              <p className="text-xs text-cc-text-muted mb-0.5">Total disponible</p>
              <p className="text-xl font-bold text-cc-primary">{formatCurrency(currentTotal)}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
