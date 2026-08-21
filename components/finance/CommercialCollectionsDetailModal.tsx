import { X, Building2, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  getCommercialCollectionDetails,
  type CommercialCollectionItem,
  type CommercialCollectionDetail,
} from '../../services/commercialCollectionsService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string;
  total: number;
  comodatoTotal: number;
  mayoreoTotal: number;
  pieceSaleTotal: number;
  breakdown: CommercialCollectionItem[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);

/**
 * Format payment_date WITHOUT timezone conversion
 * Assumes payment_date is stored as business date at midnight UTC (e.g., 2026-08-20T00:00:00Z)
 * Represents business date 2026-08-20, NOT a datetime needing timezone conversion
 */
const formatBusinessDate = (isoString: string): string => {
  if (!isoString) return '—';
  // Extract YYYY-MM-DD without any conversion
  const dateStr = isoString.slice(0, 10);
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
};

const getMethodLabel = (method: string) => {
  switch (method) {
    case 'cash': return 'Efectivo';
    case 'transfer': return 'Transferencia';
    default: return method;
  }
};

interface PaymentCardProps {
  item: CommercialCollectionDetail;
  isExpanded: boolean;
  onToggle: () => void;
}

const ComodatoCard = ({ item, isExpanded, onToggle }: PaymentCardProps) => (
  <div className="bg-neutral-900 rounded-lg border border-neutral-800 overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full px-4 py-3 hover:bg-neutral-800/50 transition-colors text-left"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-cc-cream truncate">
            {item.partner?.business_name || item.partner?.folio || '—'}
          </div>
          {item.partner?.folio && (
            <div className="text-[10px] text-cc-text-muted/60 truncate">{item.partner.folio}</div>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-sm font-bold text-blue-400 whitespace-nowrap">{fmt(item.amount)}</div>
          <div className="text-[10px] text-cc-text-muted/60 whitespace-nowrap">{formatBusinessDate(item.payment_date)}</div>
        </div>
        <ChevronDown size={16} className={`text-cc-text-muted flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </div>
    </button>

    {isExpanded && (
      <div className="px-4 py-3 border-t border-neutral-800 bg-neutral-900/50 space-y-3">
        {/* Partner Info */}
        {item.partner && (
          <div className="space-y-2 text-xs">
            <div className="font-bold text-cc-text-muted mb-2">SOCIO</div>
            {item.partner.business_name && (
              <div className="flex justify-between">
                <span className="text-cc-text-muted">Nombre:</span>
                <span className="text-cc-cream">{item.partner.business_name}</span>
              </div>
            )}
            {item.partner.folio && (
              <div className="flex justify-between">
                <span className="text-cc-text-muted">Folio:</span>
                <span className="text-cc-cream font-mono text-[9px]">{item.partner.folio}</span>
              </div>
            )}
            {item.partner.responsible_name && (
              <div className="flex justify-between">
                <span className="text-cc-text-muted">Responsable:</span>
                <span className="text-cc-cream text-right">{item.partner.responsible_name}</span>
              </div>
            )}
          </div>
        )}

        {/* Payment Info */}
        <div className="border-t border-neutral-800 pt-2 space-y-2 text-xs">
          <div className="font-bold text-cc-text-muted mb-2">PAGO</div>
          <div className="flex justify-between">
            <span className="text-cc-text-muted">Cobrado:</span>
            <span className="text-cc-cream font-bold">{fmt(item.amount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-cc-text-muted">Método:</span>
            <span className="text-cc-cream">{getMethodLabel(item.payment_method)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-cc-text-muted">Fecha:</span>
            <span className="text-cc-cream">{formatBusinessDate(item.payment_date)}</span>
          </div>
          {item.reference && (
            <div className="flex justify-between">
              <span className="text-cc-text-muted">Referencia:</span>
              <span className="text-cc-cream font-mono text-[9px]">{item.reference}</span>
            </div>
          )}
          {item.notes && (
            <div className="flex justify-between">
              <span className="text-cc-text-muted">Notas:</span>
              <span className="text-cc-cream/80 text-right">{item.notes}</span>
            </div>
          )}
        </div>

        {/* Movement / Products */}
        {item.movement && (
          <div className="border-t border-neutral-800 pt-2 space-y-2 text-xs">
            <div className="font-bold text-cc-text-muted mb-2">LIQUIDACIÓN VINCULADA</div>
            {item.movement.movement_date && (
              <div className="flex justify-between">
                <span className="text-cc-text-muted">Fecha:</span>
                <span className="text-cc-cream">{formatBusinessDate(item.movement.movement_date)}</span>
              </div>
            )}
            {item.movement.movement_type && (
              <div className="flex justify-between">
                <span className="text-cc-text-muted">Tipo:</span>
                <span className="text-cc-cream">{item.movement.movement_type}</span>
              </div>
            )}
            {item.movement.status && (
              <div className="flex justify-between">
                <span className="text-cc-text-muted">Status:</span>
                <span className="text-cc-cream">{item.movement.status}</span>
              </div>
            )}
          </div>
        )}

        {/* Products */}
        {item.products && item.products.length > 0 && (
          <div className="border-t border-neutral-800 pt-2">
            <div className="text-[10px] font-bold text-cc-text-muted mb-2">PRODUCTOS VENDIDOS</div>
            <div className="space-y-2">
              {item.products.map((prod, idx) => (
                <div key={idx} className="text-[10px] bg-neutral-800/30 rounded p-2">
                  <div className="font-medium text-cc-cream">{prod.product_name}</div>
                  {(prod.product_variant || prod.product_size) && (
                    <div className="text-cc-text-muted/60">{[prod.product_variant, prod.product_size].filter(Boolean).join(' · ')}</div>
                  )}
                  <div className="flex justify-between mt-1 text-cc-text-muted/80">
                    <span>{prod.quantity_sold} pz. × {fmt(prod.price_to_catcorn)}</span>
                    <span className="font-medium text-cc-cream">{fmt(prod.amount_due)}</span>
                  </div>
                </div>
              ))}
              {item.products.length > 0 && (
                <div className="flex justify-between font-bold text-sm pt-1 border-t border-neutral-800/50">
                  <span className="text-cc-text-muted">Total liquidación:</span>
                  <span className="text-cc-cream">{fmt(item.products.reduce((sum, p) => sum + p.amount_due, 0))}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {!item.movement && (
          <div className="border-t border-neutral-800 pt-2 text-[10px] text-cc-text-muted/60 italic">
            Pago sin liquidación específica vinculada
          </div>
        )}
      </div>
    )}
  </div>
);

const MayoreoCard = ({ item, isExpanded, onToggle }: PaymentCardProps) => (
  <div className="bg-neutral-900 rounded-lg border border-neutral-800 overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full px-4 py-3 hover:bg-neutral-800/50 transition-colors text-left"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-cc-cream truncate">
            {item.partner?.business_name || item.partner?.folio || '—'}
          </div>
          {item.partner?.folio && (
            <div className="text-[10px] text-cc-text-muted/60 truncate">{item.partner.folio}</div>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-sm font-bold text-amber-400 whitespace-nowrap">{fmt(item.amount)}</div>
          <div className="text-[10px] text-cc-text-muted/60 whitespace-nowrap">{formatBusinessDate(item.payment_date)}</div>
        </div>
        <ChevronDown size={16} className={`text-cc-text-muted flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </div>
    </button>

    {isExpanded && (
      <div className="px-4 py-3 border-t border-neutral-800 bg-neutral-900/50 space-y-3">
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-cc-text-muted">Método:</span>
            <span className="text-cc-cream">{getMethodLabel(item.payment_method)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-cc-text-muted">Cobrado:</span>
            <span className="text-cc-cream font-bold">{fmt(item.amount)}</span>
          </div>
          {item.reference && (
            <div className="flex justify-between">
              <span className="text-cc-text-muted">Referencia:</span>
              <span className="text-cc-cream font-mono text-[9px]">{item.reference}</span>
            </div>
          )}
          {item.notes && (
            <div className="flex justify-between">
              <span className="text-cc-text-muted">Notas:</span>
              <span className="text-cc-cream/80 text-right">{item.notes}</span>
            </div>
          )}
        </div>
      </div>
    )}
  </div>
);

const PieceSaleCard = ({ item, isExpanded, onToggle }: PaymentCardProps) => (
  <div className="bg-neutral-900 rounded-lg border border-neutral-800 overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full px-4 py-3 hover:bg-neutral-800/50 transition-colors text-left"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-cc-cream truncate">
            {item.seller_id ? `Vendedor ${item.seller_id.substring(0, 8)}` : '—'}
          </div>
          <div className="text-[10px] text-cc-text-muted/60">Venta por pieza</div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-sm font-bold text-emerald-400 whitespace-nowrap">{fmt(item.amount)}</div>
          <div className="text-[10px] text-cc-text-muted/60 whitespace-nowrap">{formatBusinessDate(item.payment_date)}</div>
        </div>
        <ChevronDown size={16} className={`text-cc-text-muted flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </div>
    </button>

    {isExpanded && (
      <div className="px-4 py-3 border-t border-neutral-800 bg-neutral-900/50 space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-cc-text-muted">Método:</span>
          <span className="text-cc-cream">{getMethodLabel(item.payment_method)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-cc-text-muted">Cobrado:</span>
          <span className="text-cc-cream font-bold">{fmt(item.amount)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-cc-text-muted">Fecha:</span>
          <span className="text-cc-cream">{formatBusinessDate(item.payment_date)}</span>
        </div>
        {item.reference && (
          <div className="flex justify-between">
            <span className="text-cc-text-muted">Referencia:</span>
            <span className="text-cc-cream font-mono text-[9px]">{item.reference}</span>
          </div>
        )}
        {item.notes && (
          <div className="flex justify-between">
            <span className="text-cc-text-muted">Notas:</span>
            <span className="text-cc-cream/80 text-right">{item.notes}</span>
          </div>
        )}
        <div className="text-[10px] text-cc-text-muted/60 italic pt-2 border-t border-neutral-800/50">
          Detalle de productos: próxima mejora
        </div>
      </div>
    )}
  </div>
);

export const CommercialCollectionsDetailModal = ({
  isOpen,
  onClose,
  selectedDate,
  total,
  comodatoTotal,
  mayoreoTotal,
  pieceSaleTotal,
  breakdown,
}: Props) => {
  const [enrichedBreakdown, setEnrichedBreakdown] = useState<CommercialCollectionDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const enrichData = async () => {
      if (isOpen && breakdown.length > 0) {
        setLoading(true);
        try {
          const enriched = await getCommercialCollectionDetails(breakdown);
          setEnrichedBreakdown(enriched);
        } catch (err) {
          console.error('Error enriching commercial collection data:', err);
          // Fallback to basic breakdown if enrichment fails
          setEnrichedBreakdown(breakdown as CommercialCollectionDetail[]);
        } finally {
          setLoading(false);
        }
      }
    };

    enrichData();
  }, [isOpen, breakdown]);

  if (!isOpen) return null;

  const comodatoItems = enrichedBreakdown.filter(item => item.source_type === 'comodato');
  const mayoreoItems = enrichedBreakdown.filter(item => item.source_type === 'mayoreo');
  const pieceSaleItems = enrichedBreakdown.filter(item => item.source_type === 'venta_pieza');

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="bg-neutral-950 border border-neutral-800 rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
          <div>
            <h2 className="text-lg font-bold text-cc-cream">Desglose de Socios Comerciales</h2>
            <p className="text-xs text-cc-text-muted mt-1">
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-MX', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
          >
            <X size={20} className="text-cc-text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="inline-flex items-center gap-2 text-sm text-cc-text-muted">
                  <div className="w-4 h-4 border-2 border-cc-accent border-t-transparent rounded-full animate-spin" />
                  Cargando información del socio y operación...
                </div>
              </div>
            </div>
          )}

          {!loading && (
            <div className="space-y-6">
            {/* Comodato Section */}
            {comodatoTotal > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Building2 size={16} className="text-blue-400" />
                  <h3 className="text-sm font-bold text-cc-cream">Comodato</h3>
                  <span className="ml-auto text-sm font-bold text-blue-400">{fmt(comodatoTotal)}</span>
                </div>
                <div className="space-y-2">
                  {comodatoItems.map(item => (
                    <ComodatoCard
                      key={item.id}
                      item={item}
                      isExpanded={expandedIds.has(item.id)}
                      onToggle={() => toggleExpanded(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Mayoreo Section */}
            {mayoreoTotal > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Building2 size={16} className="text-amber-400" />
                  <h3 className="text-sm font-bold text-cc-cream">Mayoreo</h3>
                  <span className="ml-auto text-sm font-bold text-amber-400">{fmt(mayoreoTotal)}</span>
                </div>
                <div className="space-y-2">
                  {mayoreoItems.map(item => (
                    <MayoreoCard
                      key={item.id}
                      item={item}
                      isExpanded={expandedIds.has(item.id)}
                      onToggle={() => toggleExpanded(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Venta por Pieza Section */}
            {pieceSaleTotal > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Building2 size={16} className="text-emerald-400" />
                  <h3 className="text-sm font-bold text-cc-cream">Venta por Pieza</h3>
                  <span className="ml-auto text-sm font-bold text-emerald-400">{fmt(pieceSaleTotal)}</span>
                </div>
                <div className="space-y-2">
                  {pieceSaleItems.map(item => (
                    <PieceSaleCard
                      key={item.id}
                      item={item}
                      isExpanded={expandedIds.has(item.id)}
                      onToggle={() => toggleExpanded(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {enrichedBreakdown.length === 0 && !loading && (
              <p className="text-sm text-cc-text-muted/60 text-center py-8">Sin pagos de socios comerciales este día</p>
            )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-800 px-6 py-4 bg-neutral-900/50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-cc-text-muted">Total verificado</span>
            <span className="text-lg font-bold text-emerald-400">{fmt(total)}</span>
          </div>
          <div className="text-[10px] text-cc-text-muted/60 mt-2">
            {enrichedBreakdown.length} operación{enrichedBreakdown.length !== 1 ? 'es' : ''} registrada{enrichedBreakdown.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    </div>
  );
};
