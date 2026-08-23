import { useEffect, useState, useMemo } from 'react';
import { X, ChevronDown, ChevronUp, Loader2, AlertCircle } from 'lucide-react';
import {
  B2BBalanceDetailResponse,
  B2BBalancePartner,
} from './b2bReportTypes';
import { formatCurrency, formatNumber } from './b2bReportHelpers';
import { getB2BBalanceDetail } from '../../../services/commercialCollectionsService';

interface B2BBalanceDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  pieceSaleDateRange: {
    start: Date;
    end: Date;
  };
}

type TabType = 'por-cobrar' | 'pendiente-venta' | 'all';

export const B2BBalanceDetailModal = ({
  isOpen,
  onClose,
  pieceSaleDateRange,
}: B2BBalanceDetailModalProps) => {
  const [data, setData] = useState<B2BBalanceDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('por-cobrar');
  const [expandedPartner, setExpandedPartner] = useState<string | null>(null);

  // Load data when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);

      const { data: response, error: err } = await getB2BBalanceDetail(
        pieceSaleDateRange.start,
        pieceSaleDateRange.end
      );

      if (err) {
        setError(err);
        setData(null);
      } else {
        setData(response);
        setError(null);
      }

      setLoading(false);
    };

    loadData();
  }, [isOpen, pieceSaleDateRange]);

  // Filter partners based on active tab
  const filteredPartners = useMemo(() => {
    if (!data?.partners) return [];

    let filtered = [...data.partners];

    // Apply tab filter
    switch (activeTab) {
      case 'por-cobrar':
        // Show partners with money owed (pending > 0)
        filtered = filtered.filter((p) => (p.comodato?.pending ?? 0) > 0 || (p.wholesale?.pending ?? 0) > 0);
        // Sort by pending amount descending (highest debt first)
        filtered.sort((a, b) => b.pending_amount - a.pending_amount);
        break;
      case 'pendiente-venta':
        // Show partners with stock in possession (stock_units > 0)
        filtered = filtered.filter((p) => (p.comodato?.stock_units ?? 0) > 0);
        // Sort by stock value descending (highest inventory value first)
        filtered.sort((a, b) => {
          const aStockValue = (a.comodato?.stock ?? []).reduce(
            (sum, item) => sum + ((item.current_quantity ?? 0) * (item.last_price_to_catcorn ?? 0)),
            0
          );
          const bStockValue = (b.comodato?.stock ?? []).reduce(
            (sum, item) => sum + ((item.current_quantity ?? 0) * (item.last_price_to_catcorn ?? 0)),
            0
          );
          return bStockValue - aStockValue;
        });
        break;
      case 'all':
        // Show all partners with either pending or stock
        filtered = filtered.filter(
          (p) => (p.comodato?.pending ?? 0) > 0 || (p.wholesale?.pending ?? 0) > 0 || (p.comodato?.stock_units ?? 0) > 0
        );
        // Sort by pending amount descending
        filtered.sort((a, b) => b.pending_amount - a.pending_amount);
        break;
    }

    return filtered;
  }, [data?.partners, activeTab]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-[#111111] rounded-2xl w-full max-h-[90vh] max-w-6xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h2 className="text-2xl font-bold text-cc-cream">Detalle de saldos</h2>
            <p className="text-sm text-cc-text-muted mt-1">
              Consulta quién tiene saldo pendiente, qué producto tiene en
              posesión y el historial de operaciones.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-cc-text-muted hover:text-cc-cream transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-cc-primary animate-spin mx-auto mb-2" />
                <p className="text-cc-text-muted">
                  Cargando detalle de saldos...
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="p-6">
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-300">
                    No se pudo cargar el detalle
                  </p>
                  <p className="text-xs text-red-200 mt-1">{error}</p>
                </div>
              </div>
              <button
                onClick={() => onClose()}
                className="mt-4 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded-lg transition-colors"
              >
                Cerrar
              </button>
            </div>
          ) : data ? (
            <div className="p-6 space-y-6">
              {/* Resumen superior */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-cc-text-muted uppercase tracking-wide">
                  Resumen de saldos
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                  <div className="bg-cc-surface rounded-xl p-4 border border-white/5">
                    <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-1">
                      Total por cobrar a socios
                    </p>
                    <p className="text-xl font-bold text-red-400">
                      {formatCurrency(data.summary.b2b_pending_balance ?? 0)}
                    </p>
                  </div>

                  <div className="bg-cc-surface rounded-xl p-4 border border-white/5">
                    <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-1">
                      Comodato Por Cobrar
                    </p>
                    <p className="text-xl font-bold text-cc-cream">
                      {formatCurrency(data.summary.comodato_pending ?? 0)}
                    </p>
                  </div>

                  <div className="bg-cc-surface rounded-xl p-4 border border-white/5">
                    <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-1">
                      📦 Producto en Posesión
                    </p>
                    <div>
                      <p className="text-xl font-bold text-yellow-400">
                        {formatNumber(
                          data.partners?.reduce((sum, p) => sum + (p.comodato?.stock_units ?? 0), 0) ?? 0
                        )}
                      </p>
                      <p className="text-xs text-cc-text-muted mt-1">
                        {formatCurrency(
                          data.partners?.reduce((sum, p) => {
                            return (
                              sum +
                              (p.comodato?.stock ?? []).reduce(
                                (itemSum, item) =>
                                  itemSum + ((item.current_quantity ?? 0) * (item.last_price_to_catcorn ?? 0)),
                                0
                              )
                            );
                          }, 0) ?? 0
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="bg-cc-surface rounded-xl p-4 border border-white/5">
                    <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-1">
                      Mayoreo Por Cobrar
                    </p>
                    <p className="text-xl font-bold text-cc-cream">
                      {formatCurrency(data.summary.wholesale_pending ?? 0)}
                    </p>
                  </div>

                  <div className="bg-cc-surface rounded-xl p-4 border border-white/5">
                    <p className="text-xs text-cc-text-muted uppercase tracking-wide mb-1">
                      Socios Por Cobrar
                    </p>
                    <p className="text-xl font-bold text-cc-cream">
                      {formatNumber(data.summary.b2b_partners_with_pending ?? 0)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="space-y-3">
                <div className="flex gap-2 border-b border-white/10">
                  {['por-cobrar', 'pendiente-venta', 'all'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab as TabType)}
                      className={`px-4 py-3 text-sm font-medium uppercase tracking-wide transition-colors ${
                        activeTab === tab
                          ? 'text-cc-cream border-b-2 border-cc-primary'
                          : 'text-cc-text-muted hover:text-cc-cream'
                      }`}
                    >
                      {tab === 'por-cobrar' && '💰 POR COBRAR'}
                      {tab === 'pendiente-venta' && '📦 PENDIENTE DE VENTA'}
                      {tab === 'all' && 'TODOS'}
                    </button>
                  ))}
                </div>

                {/* Tab description */}
                <div className="px-4 py-2 bg-white/5 rounded-lg border border-white/10">
                  <p className="text-xs text-cc-text-muted leading-relaxed">
                    {activeTab === 'por-cobrar' &&
                      'Socios con producto que ya fue reportado como vendido pero cuyo dinero todavía no ha sido completamente pagado.'}
                    {activeTab === 'pendiente-venta' &&
                      'Socios con producto que aún está en su posesión y pendiente de ser vendido.'}
                    {activeTab === 'all' &&
                      'Vista completa de todos los socios con saldo pendiente y/o producto en posesión.'}
                  </p>
                </div>
              </div>

              {/* Socios Comerciales */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-cc-text-muted uppercase tracking-wide">
                  Socios Comerciales
                </h3>

                {filteredPartners.length === 0 ? (
                  <div className="text-center py-8 text-cc-text-muted">
                    {activeTab === 'por-cobrar' &&
                      'No hay saldos por cobrar.'}
                    {activeTab === 'pendiente-venta' &&
                      'No hay producto en posesión pendiente de venta.'}
                    {activeTab === 'all' &&
                      'No hay registros para mostrar.'}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredPartners
                      .map((partner) => (
                        <PartnerCard
                          key={partner.partner_id}
                          partner={partner}
                          isExpanded={expandedPartner === partner.partner_id}
                          onToggle={() =>
                            setExpandedPartner(
                              expandedPartner === partner.partner_id
                                ? null
                                : partner.partner_id
                            )
                          }
                        />
                      ))}
                  </div>
                )}
              </div>

            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

/* ── Partner Card ──────────────────────────────────────────────── */

interface PartnerCardProps {
  partner: B2BBalancePartner;
  isExpanded: boolean;
  onToggle: () => void;
}

const PartnerCard = ({ partner, isExpanded, onToggle }: PartnerCardProps) => {
  // Calculate metrics for immediate display
  const comodatoPending = partner.comodato?.pending ?? 0;
  const comodatoStockUnits = partner.comodato?.stock_units ?? 0;
  const comodatoStockValue = (partner.comodato?.stock ?? []).reduce(
    (sum, item) => sum + ((item.current_quantity ?? 0) * (item.last_price_to_catcorn ?? 0)),
    0
  );
  const exposicion = comodatoPending + comodatoStockValue;

  return (
    <div className="bg-cc-surface border border-white/5 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full p-4 hover:bg-white/5 transition-colors text-left flex items-center justify-between group"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-3">
            <h4 className="font-semibold text-cc-cream truncate">
              {partner.business_name}
            </h4>
            <span className="text-xs px-2 py-1 bg-white/10 text-cc-text-muted rounded uppercase tracking-wide whitespace-nowrap">
              {partner.folio}
            </span>
          </div>

          {/* Immediate metrics display */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-2">
            {/* 💰 Por cobrar */}
            <div className="bg-black/20 rounded px-2 py-1.5">
              <p className="text-cc-text-muted mb-0.5">💰 Por cobrar</p>
              <p className={`font-semibold ${comodatoPending > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {formatCurrency(comodatoPending)}
              </p>
            </div>

            {/* 📦 En posesión */}
            <div className="bg-black/20 rounded px-2 py-1.5">
              <p className="text-cc-text-muted mb-0.5">📦 Piezas</p>
              <p className="font-semibold text-yellow-400">
                {formatNumber(comodatoStockUnits)}
              </p>
            </div>

            {/* 💵 Valor Cat Corn */}
            <div className="bg-black/20 rounded px-2 py-1.5">
              <p className="text-cc-text-muted mb-0.5">💵 Valor Cat Corn</p>
              <p className="font-semibold text-cc-cream">
                {formatCurrency(comodatoStockValue)}
              </p>
            </div>

            {/* 📊 Exposición */}
            <div className="bg-black/20 rounded px-2 py-1.5">
              <p className="text-cc-text-muted mb-0.5">📊 Exposición</p>
              <p className="font-semibold text-orange-400">
                {formatCurrency(exposicion)}
              </p>
            </div>
          </div>

          <p className="text-xs text-cc-text-muted">
            {partner.partner_model === 'comodato' ? 'Comodato' : 'Mayoreo'}
            {partner.comodato && partner.wholesale && ' · Comodato · Mayoreo'}
          </p>
        </div>
        <div className="ml-4">
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-cc-text-muted group-hover:text-cc-cream transition-colors" />
          ) : (
            <ChevronDown className="w-5 h-5 text-cc-text-muted group-hover:text-cc-cream transition-colors" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-white/5 p-4 space-y-6">
          {/* Comodato */}
          {partner.comodato && (
            <ComodatoDetail comodato={partner.comodato} />
          )}

          {/* Mayoreo */}
          {partner.wholesale && (
            <WholesaleDetail wholesale={partner.wholesale} />
          )}
        </div>
      )}
    </div>
  );
};

/* ── Comodato Detail ────────────────────────────────────────────── */

interface ComodatoDetailProps {
  comodato: any; // B2BComodatoDetail
}

const ComodatoDetail = ({ comodato }: ComodatoDetailProps) => {
  const stockValue = (comodato?.stock ?? []).reduce(
    (sum: number, item: any) => sum + ((item.current_quantity ?? 0) * (item.last_price_to_catcorn ?? 0)),
    0
  );

  return (
    <div className="space-y-6">
      <h5 className="text-xs font-semibold text-cc-text-muted uppercase tracking-wide">
        Comodato
      </h5>

      {/* ════════ 💰 SALDO POR COBRAR ════════ */}
      <div className="space-y-3 border-b border-white/10 pb-4">
        <h6 className="text-xs font-bold text-red-400 uppercase tracking-widest">
          💰 SALDO POR COBRAR (Dinero adeudado)
        </h6>

        <div className="grid grid-cols-3 gap-2">
          <div className="bg-red-500/10 rounded-lg p-3 border border-red-500/20">
            <p className="text-xs text-cc-text-muted mb-1">Generado</p>
            <p className="font-semibold text-cc-cream">
              {formatCurrency(comodato.generated ?? 0)}
            </p>
          </div>
          <div className="bg-green-500/10 rounded-lg p-3 border border-green-500/20">
            <p className="text-xs text-cc-text-muted mb-1">Pagado</p>
            <p className="font-semibold text-green-400">
              {formatCurrency(comodato.paid ?? 0)}
            </p>
          </div>
          <div className="bg-red-500/10 rounded-lg p-3 border border-red-500/20">
            <p className="text-xs text-cc-text-muted mb-1">Pendiente</p>
            <p className={`font-semibold ${(comodato.pending ?? 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {formatCurrency(comodato.pending ?? 0)}
            </p>
          </div>
        </div>

        {/* Liquidaciones / Ventas reportadas */}
        {comodato.settlements && comodato.settlements.length > 0 && (
          <div className="space-y-2 mt-4">
            <p className="text-xs font-semibold text-cc-text-muted uppercase tracking-wide">
              Transacciones reportadas
            </p>
            <div className="space-y-2">
              {comodato.settlements.map((settlement: any, idx: number) => (
                <div
                  key={idx}
                  className="bg-black/20 rounded-lg p-3 text-sm space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-cc-cream font-semibold">
                      {formatDate(settlement.movement_date)}
                    </p>
                    {settlement.payment_status === 'liquidated' && (
                      <span className="text-xs px-2 py-1 bg-green-500/20 text-green-300 rounded">
                        ✓ Liquidado
                      </span>
                    )}
                  </div>
                  {settlement.products_sold && settlement.products_sold.length > 0 && (
                    <div className="text-xs text-cc-text-muted">
                      <p className="mb-1">Productos vendidos:</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {settlement.products_sold.map(
                          (product: any, pidx: number) => (
                            <li key={pidx}>
                              {product.product_name}
                              {product.product_variant &&
                                ` ${product.product_variant}`}{' '}
                              ×{' '}
                              {formatNumber(
                                product.quantity_sold
                              )} = {formatCurrency(product.sale_amount ?? 0)}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
                  <div className="text-xs space-y-1">
                    <p>
                      <span className="text-cc-text-muted">Monto:</span>
                      {' '}
                      <span className="font-semibold text-cc-cream">
                        {formatCurrency(settlement.sale_total ?? 0)}
                      </span>
                    </p>
                    {settlement.payment_amount && (
                      <p>
                        <span className="text-cc-text-muted">Pago recibido:</span>
                        {' '}
                        <span className="font-semibold text-green-400">
                          {formatCurrency(settlement.payment_amount)}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ════════ 📦 PRODUCTO EN POSESIÓN ════════ */}
      {comodato.stock && comodato.stock.length > 0 && (
        <div className="space-y-3">
          <h6 className="text-xs font-bold text-yellow-400 uppercase tracking-widest">
            📦 PRODUCTO EN POSESIÓN (Inventario no vendido)
          </h6>

          <div className="bg-yellow-500/10 rounded-lg p-4 border border-yellow-500/20 space-y-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-cc-text-muted mb-1">Total de piezas</p>
                <p className="text-2xl font-bold text-yellow-400">
                  {formatNumber(comodato.stock_units ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-cc-text-muted mb-1">Valor Cat Corn</p>
                <p className="text-2xl font-bold text-cc-cream">
                  {formatCurrency(stockValue)}
                </p>
              </div>
            </div>
          </div>

          {/* Detalle de productos */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-cc-text-muted uppercase tracking-wide">
              Productos en detalle
            </p>
            <div className="space-y-2">
              {comodato.stock
                .filter((s: any) => s.current_quantity > 0)
                .map((item: any, idx: number) => {
                  const itemStockValue = (item.current_quantity ?? 0) * (item.last_price_to_catcorn ?? 0);
                  return (
                    <div
                      key={idx}
                      className="bg-black/20 rounded-lg p-3 text-sm space-y-2"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-cc-cream">
                            {item.product_name}
                            {item.product_variant && ` · ${item.product_variant}`}
                            {item.product_size && ` · ${item.product_size}`}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-cc-text-muted mb-1">Cantidad</p>
                          <p className="font-semibold text-yellow-400">
                            {formatNumber(item.current_quantity)} piezas
                          </p>
                        </div>
                        <div>
                          <p className="text-cc-text-muted mb-1">Precio Cat Corn (unitario)</p>
                          <p className="font-semibold text-cc-cream">
                            {formatCurrency(item.last_price_to_catcorn ?? 0)}
                          </p>
                        </div>
                      </div>

                      <div className="bg-black/40 rounded p-2">
                        <p className="text-xs text-cc-text-muted mb-1">Valor total de este producto</p>
                        <p className="font-semibold text-yellow-400">
                          {formatCurrency(itemStockValue)}
                        </p>
                      </div>

                      <div className="text-xs text-cc-text-muted space-y-0.5">
                        <p>
                          <span className="text-cc-cream font-semibold">Movimientos:</span>
                          {' '}
                          Entregadas {formatNumber(item.total_delivered)} ·
                          Vendidas {formatNumber(item.total_sold)} ·
                          Retiradas {formatNumber(item.total_withdrawn)} ·
                          Merma {formatNumber(item.total_spoiled)}
                        </p>
                        {item.first_delivery_at && (
                          <p>
                            <span className="text-cc-cream font-semibold">Primera entrega:</span>
                            {' '}
                            {formatDate(item.first_delivery_at)}
                          </p>
                        )}
                        {item.last_delivery_at && (
                          <p>
                            <span className="text-cc-cream font-semibold">Última entrega:</span>
                            {' '}
                            {formatDate(item.last_delivery_at)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Wholesale Detail ───────────────────────────────────────────── */

interface WholesaleDetailProps {
  wholesale: any; // B2BWholesaleDetail
}

const WholesaleDetail = ({ wholesale }: WholesaleDetailProps) => {
  return (
    <div className="space-y-4">
      <h5 className="text-xs font-semibold text-cc-text-muted uppercase tracking-wide">
        Mayoreo
      </h5>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-black/20 rounded-lg p-3">
          <p className="text-xs text-cc-text-muted mb-1">Comprado</p>
          <p className="font-semibold text-cc-cream">
            {formatCurrency(wholesale.purchased ?? 0)}
          </p>
        </div>
        <div className="bg-black/20 rounded-lg p-3">
          <p className="text-xs text-cc-text-muted mb-1">Pagado</p>
          <p className="font-semibold text-cc-cream">
            {formatCurrency(wholesale.paid ?? 0)}
          </p>
        </div>
        <div className="bg-black/20 rounded-lg p-3">
          <p className="text-xs text-cc-text-muted mb-1">Pendiente</p>
          <p className="font-semibold text-red-400">
            {formatCurrency(wholesale.pending ?? 0)}
          </p>
        </div>
      </div>

      {/* Órdenes */}
      {wholesale.orders && wholesale.orders.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-cc-text-muted uppercase tracking-wide">
            Órdenes
          </p>
          <div className="space-y-2">
            {wholesale.orders.map((order: any, idx: number) => (
              <div
                key={idx}
                className="bg-black/20 rounded-lg p-3 text-sm space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-cc-cream">
                      {order.order_folio}
                    </p>
                    <p className="text-xs text-cc-text-muted">
                      {formatDate(order.order_date)} ·{' '}
                      {formatNumber(order.total_pieces)} piezas
                    </p>
                  </div>
                  {order.payment_status === 'liquidated' && (
                    <span className="text-xs px-2 py-1 bg-green-500/20 text-green-300 rounded">
                      ✓ Liquidado
                    </span>
                  )}
                </div>

                {order.products && order.products.length > 0 && (
                  <div className="text-xs text-cc-text-muted space-y-1 border-t border-white/10 pt-2">
                    {order.products.map(
                      (product: any, pidx: number) => (
                        <p key={pidx}>
                          {product.product_name}
                          {product.product_variant &&
                            ` · ${product.product_variant}`}{' '}
                          ×{' '}
                          {formatNumber(product.quantity)} @{' '}
                          {formatCurrency(product.unit_price)} ={' '}
                          {formatCurrency(
                            product.quantity * product.unit_price
                          )}
                        </p>
                      )
                    )}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 text-xs pt-2 border-t border-white/10">
                  <div>
                    <p className="text-cc-text-muted">Total</p>
                    <p className="text-cc-cream font-semibold">
                      {formatCurrency(order.total_amount ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-cc-text-muted">Pagado</p>
                    <p className="text-cc-cream font-semibold">
                      {formatCurrency(order.total_paid ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-cc-text-muted">Pendiente</p>
                    <p className="text-red-400 font-semibold">
                      {formatCurrency(order.pending_amount ?? 0)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Helpers ────────────────────────────────────────────────────── */

function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('es-MX', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateString;
  }
}
