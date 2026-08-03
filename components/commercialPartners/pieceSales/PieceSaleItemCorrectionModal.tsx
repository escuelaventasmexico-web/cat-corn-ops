import { useState, useEffect } from 'react';
import { X, ChevronDown, AlertCircle, CheckCircle } from 'lucide-react';
import { PieceSaleHistory, PieceSaleHistoryItem } from '../../../types/pieceSales';
import {
  formatCurrency,
  safeNumber,
} from '../../../lib/pieceSalesHelpers';
import { correctPieceSaleItem } from '../../../lib/pieceSalesRpc';
import { supabase } from '../../../supabase';

interface PieceSaleProduct {
  product_id: string;
  product_name: string;
  product_variant?: string | null;
  product_size?: string | null;
  retail_price: number | string;
  unit_commission: number | string;
  sku_code?: string;
  active: boolean;
}

interface PieceSaleItemCorrectionModalProps {
  sale: PieceSaleHistory;
  item: PieceSaleHistoryItem;
  onClose: () => void;
  onSuccess: () => void;
}

export const PieceSaleItemCorrectionModal = ({
  sale,
  item,
  onClose,
  onSuccess,
}: PieceSaleItemCorrectionModalProps) => {
  const [step, setStep] = useState<'form' | 'preview' | 'result'>('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [selectedProduct, setSelectedProduct] = useState<PieceSaleProduct | null>(null);
  const [quantity, setQuantity] = useState<number>(Number(item.quantity ?? 1));
  const [reason, setReason] = useState('');

  // Products
  const [products, setProducts] = useState<PieceSaleProduct[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<PieceSaleProduct[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showProductDropdown, setShowProductDropdown] = useState(false);

  // Result
  const [correctionResult, setCorrectionResult] = useState<any>(null);

  // Load products from view
  useEffect(() => {
    loadProducts();
  }, []);

  // Filter products when search term changes
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredProducts(products);
    } else {
      const term = searchTerm.toLowerCase();
      setFilteredProducts(
        products.filter(p => {
          const name = (p.product_name || '').toLowerCase();
          const variant = (p.product_variant || '').toLowerCase();
          const size = (p.product_size || '').toLowerCase();
          const sku = (p.sku_code || '').toLowerCase();
          return name.includes(term) || variant.includes(term) || size.includes(term) || sku.includes(term);
        })
      );
    }
  }, [searchTerm, products]);

  const loadProducts = async () => {
    if (!supabase) return;

    try {
      const { data, error: err } = await supabase
        .from('v_piece_sale_products')
        .select('*')
        .order('product_name');

      if (err) {
        console.error('Error loading correction products:', {
          message: err.message,
          details: err.details,
          hint: err.hint,
          code: err.code,
        });
        setError(`No se pudieron cargar los productos: ${err.message}`);
        setProducts([]);
        setFilteredProducts([]);
        return;
      }

      const normalizedProducts = (data ?? []).map(product => ({
        ...product,
        retail_price: Number(product.retail_price ?? 0),
        unit_commission: Number(product.unit_commission ?? 0),
      }));

      setProducts(normalizedProducts);
      setFilteredProducts(normalizedProducts);
      setError(null);
    } catch (err: any) {
      console.error('Exception loading correction products:', err);
      setError(`Error inesperado: ${err.message || 'Error desconocido'}`);
      setProducts([]);
      setFilteredProducts([]);
    }
  };

  const handleSelectProduct = (product: PieceSaleProduct) => {
    setSelectedProduct(product);
    setSearchTerm(product.product_name);
    setShowProductDropdown(false);
  };

  const isFormValid = () => {
    if (!selectedProduct || quantity <= 0 || reason.trim().length < 10) return false;
    const productChanged = selectedProduct.product_id !== item.product_id;
    const qtyChanged = quantity !== Number(item.quantity ?? 0);
    return productChanged || qtyChanged;
  };

  const handleSubmitCorrection = async () => {
    if (!isFormValid() || !selectedProduct) return;

    setLoading(true);
    setError(null);

    try {
      const result = await correctPieceSaleItem(
        sale.sale_id,
        item.item_id,
        selectedProduct.product_id,
        quantity,
        reason.trim()
      );

      console.log('Correction result:', result);
      setCorrectionResult(result);
      setStep('result');
    } catch (err: any) {
      setError(
        err.message ||
        'Error desconocido al aplicar la corrección. Por favor intenta nuevamente.'
      );
      console.error('Correction error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Calculate financial impact for preview
  const oldSubtotal = safeNumber(item.unit_retail_price) * Number(item.quantity ?? 0);
  const newSubtotal = safeNumber(selectedProduct?.retail_price || 0) * quantity;
  const subtotalDiff = newSubtotal - oldSubtotal;

  const oldCommission = safeNumber(item.commission_total);
  const newCommission = safeNumber(selectedProduct?.unit_commission || 0) * quantity;
  const commissionDiff = newCommission - oldCommission;

  const getDiffColor = (diff: number) => {
    if (diff > 0) return 'text-green-400';
    if (diff < 0) return 'text-red-400';
    return 'text-gray-400';
  };

  const getDiffLabel = (diff: number) => {
    if (diff > 0) return '↑';
    if (diff < 0) return '↓';
    return '=';
  };

  if (step === 'result' && correctionResult) {
    return (
      <div
        className="fixed inset-0 bg-black/75 z-[90] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="relative z-[100] bg-[#0b0b0b] rounded-xl shadow-2xl max-w-md w-full border border-white/10"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/10 bg-cc-surface">
            <h2 className="text-xl font-bold text-cc-text-main">Corrección Completada</h2>
            <button onClick={onClose} className="p-1 hover:bg-white/5 rounded-lg">
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {/* Success Icon */}
            <div className="flex justify-center">
              <div className="rounded-full bg-green-500/20 p-4">
                <CheckCircle size={40} className="text-green-400" />
              </div>
            </div>

            {/* Message */}
            <div className="text-center">
              <p className="text-cc-text-main font-semibold">
                Producto corregido exitosamente
              </p>
              <p className="text-cc-text-secondary text-sm mt-2">
                Los cambios se han registrado en el sistema.
              </p>
            </div>

            {/* Summary */}
            <div className="bg-[#151515] rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-cc-text-secondary">Total de venta:</p>
                  <p className="font-mono text-cc-text-main">
                    ${Number(correctionResult.new_sale_total ?? 0).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-cc-text-secondary">Comisión:</p>
                  <p className="font-mono text-cc-primary">
                    ${Number(correctionResult.new_commission_total ?? 0).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            {/* Payment Reset Warning */}
            {correctionResult.payment_request_reset && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex gap-2">
                <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="text-amber-400 font-semibold">Comprobante invalidado</p>
                  <p className="text-amber-300 text-xs mt-1">
                    Debido al cambio en el total, tendrás que re-enviar el comprobante de
                    transferencia.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-white/10 bg-cc-surface">
            <button
              onClick={() => {
                onSuccess();
                onClose();
              }}
              className="w-full px-4 py-2 rounded-lg bg-cc-primary text-cc-bg font-semibold hover:bg-cc-primary/90 transition"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black/75 z-[90] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative z-[100] bg-[#0b0b0b] rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-white/10"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between p-6 border-b border-white/10 bg-cc-surface">
          <h2 className="text-xl font-bold text-cc-text-main">Corregir Producto</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/5 rounded-lg">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Form Step */}
          {step === 'form' && (
            <div className="space-y-6">
              {/* Current Product */}
              <div className="space-y-2">
                <p className="text-xs text-cc-text-muted uppercase tracking-wider">
                  Producto Capturado
                </p>
                <div className="bg-[#151515] rounded-lg p-4 border border-white/10">
                  <p className="font-semibold text-cc-text-main">{item.product_name}</p>
                  {(item.product_variant || item.product_size) && (
                    <p className="text-xs text-cc-text-secondary mt-1">
                      {[item.product_variant, item.product_size].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-4 mt-3 text-sm">
                    <div>
                      <span className="text-cc-text-secondary">Cantidad:</span>
                      <p className="font-mono text-cc-text-main">
                        {Number(item.quantity ?? 0)} unidades
                      </p>
                    </div>
                    <div>
                      <span className="text-cc-text-secondary">Subtotal:</span>
                      <p className="font-mono text-cc-text-main">
                        {formatCurrency(oldSubtotal)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 text-sm">
                    <span className="text-cc-text-secondary">Comisión unitaria:</span>
                    <p className="font-mono text-cc-primary">
                      {formatCurrency(safeNumber(item.unit_commission))} × {Number(item.quantity ?? 0)} ={' '}
                      {formatCurrency(oldCommission)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Product Selector */}
              <div className="space-y-2">
                <label className="text-xs text-cc-text-muted uppercase tracking-wider">
                  Producto Correcto
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => {
                      setSearchTerm(e.target.value);
                      setShowProductDropdown(true);
                    }}
                    onFocus={() => setShowProductDropdown(true)}
                    placeholder="Buscar por nombre, variante, talla o SKU..."
                    className="w-full px-4 py-2 rounded-lg bg-white text-black placeholder-gray-500 border border-gray-300 focus:outline-none focus:border-cc-primary focus:ring-1 focus:ring-cc-primary"
                  />
                  <ChevronDown
                    size={18}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-cc-text-secondary pointer-events-none"
                  />

                  {/* Dropdown */}
                  {showProductDropdown && filteredProducts.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg bg-white border border-gray-300 z-[105] shadow-lg">
                      {filteredProducts.map(product => (
                        <button
                          key={product.product_id}
                          onClick={() => handleSelectProduct(product)}
                          className="w-full text-left px-4 py-2 hover:bg-gray-100 border-b border-gray-200 last:border-b-0 transition"
                        >
                          <p className="font-semibold text-gray-900 text-sm">
                            {product.product_name}
                          </p>
                          <div className="flex justify-between text-xs text-gray-600 mt-0.5">
                            <span>
                              {[product.product_variant, product.product_size]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                            <span>
                              ${Number(product.retail_price ?? 0).toFixed(2)} / ${Number(product.unit_commission ?? 0).toFixed(2)}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedProduct && (
                  <p className="text-xs text-cc-primary">
                    ✓ {selectedProduct.product_name} seleccionado
                  </p>
                )}
              </div>

              {/* Quantity */}
              <div className="space-y-2">
                <label className="text-xs text-cc-text-muted uppercase tracking-wider">
                  Cantidad
                </label>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-4 py-2 rounded-lg bg-white text-black border border-gray-300 focus:outline-none focus:border-cc-primary focus:ring-1 focus:ring-cc-primary"
                />
              </div>

              {/* Reason */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-xs text-cc-text-muted uppercase tracking-wider">
                    Razón de Corrección
                  </label>
                  <span className="text-xs text-cc-text-secondary">
                    {reason.length}/10+ caracteres
                  </span>
                </div>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Describe por qué se necesita esta corrección..."
                  rows={3}
                  maxLength={500}
                  className="w-full px-4 py-2 rounded-lg bg-white text-black placeholder-gray-500 border border-gray-300 focus:outline-none focus:border-cc-primary focus:ring-1 focus:ring-cc-primary resize-none"
                />
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-950 border border-red-700 rounded-lg p-3 flex gap-2">
                  <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-100 text-sm">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* Preview Step */}
          {step === 'preview' && (
            <div className="space-y-6">
              {/* Impact Warning */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                <p className="text-amber-400 text-sm">
                  Revisa cuidadosamente los cambios antes de confirmar. Esto afectará el total
                  de la venta y la comisión generada.
                </p>
              </div>

              {/* Before and After */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* ANTES */}
                <div className="bg-[#151515] rounded-lg p-4 border border-white/10">
                  <p className="text-xs text-cc-text-muted uppercase tracking-wider mb-3">
                    Antes
                  </p>
                  <div className="space-y-2 text-sm">
                    <div>
                      <p className="text-cc-text-secondary text-xs">Producto:</p>
                      <p className="text-cc-text-main font-semibold">{item.product_name}</p>
                    </div>
                    <div>
                      <p className="text-cc-text-secondary text-xs">Cantidad:</p>
                      <p className="text-cc-text-main font-mono">
                        {Number(item.quantity ?? 0)} unidades
                      </p>
                    </div>
                    <div>
                      <p className="text-cc-text-secondary text-xs">Precio unitario:</p>
                      <p className="text-cc-text-main font-mono">
                        {formatCurrency(safeNumber(item.unit_retail_price))}
                      </p>
                    </div>
                    <div className="border-t border-white/10 pt-2">
                      <p className="text-cc-text-secondary text-xs">Subtotal:</p>
                      <p className="text-cc-text-main font-semibold">
                        {formatCurrency(oldSubtotal)}
                      </p>
                    </div>
                    <div>
                      <p className="text-cc-text-secondary text-xs">Comisión:</p>
                      <p className="text-cc-primary font-semibold">
                        {formatCurrency(oldCommission)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* DESPUÉS */}
                <div className="bg-[#151515] rounded-lg p-4 border border-white/10">
                  <p className="text-xs text-cc-text-muted uppercase tracking-wider mb-3">
                    Después
                  </p>
                  <div className="space-y-2 text-sm">
                    <div>
                      <p className="text-cc-text-secondary text-xs">Producto:</p>
                      <p className="text-cc-text-main font-semibold">
                        {selectedProduct?.product_name}
                      </p>
                    </div>
                    <div>
                      <p className="text-cc-text-secondary text-xs">Cantidad:</p>
                      <p className="text-cc-text-main font-mono">{quantity} unidades</p>
                    </div>
                    <div>
                      <p className="text-cc-text-secondary text-xs">Precio unitario:</p>
                      <p className="text-cc-text-main font-mono">
                        {formatCurrency(safeNumber(selectedProduct?.retail_price || 0))}
                      </p>
                    </div>
                    <div className="border-t border-white/10 pt-2">
                      <p className="text-cc-text-secondary text-xs">Subtotal:</p>
                      <p className="text-cc-text-main font-semibold">
                        {formatCurrency(newSubtotal)}
                      </p>
                    </div>
                    <div>
                      <p className="text-cc-text-secondary text-xs">Comisión:</p>
                      <p className="text-cc-primary font-semibold">
                        {formatCurrency(newCommission)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Impact Summary */}
              <div className="bg-[#151515] rounded-lg p-4 border border-white/10 space-y-4">
                <p className="text-sm font-semibold text-cc-text-main">Diferencias</p>

                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-cc-text-secondary">Diferencia de venta:</span>
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${getDiffColor(subtotalDiff)}`}>
                        {getDiffLabel(subtotalDiff)}
                      </span>
                      <span className={`font-mono ${getDiffColor(subtotalDiff)}`}>
                        {formatCurrency(Math.abs(subtotalDiff))}
                      </span>
                    </div>
                  </div>

                  <div className="bg-cc-bg rounded px-3 py-2">
                    <div className="flex justify-between text-xs text-cc-text-secondary mb-1">
                      <span>Total de venta:</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-cc-text-secondary">Antes:</span>
                      <span className="font-mono text-cc-text-main">
                        {formatCurrency(safeNumber(sale.total_amount))}
                      </span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-cc-text-secondary">Después:</span>
                      <span className="font-mono text-cc-text-main">
                        {formatCurrency(
                          safeNumber(sale.total_amount) + subtotalDiff
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-cc-text-secondary">Diferencia de comisión:</span>
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${getDiffColor(commissionDiff)}`}>
                        {getDiffLabel(commissionDiff)}
                      </span>
                      <span className={`font-mono ${getDiffColor(commissionDiff)}`}>
                        {formatCurrency(Math.abs(commissionDiff))}
                      </span>
                    </div>
                  </div>

                  <div className="bg-cc-bg rounded px-3 py-2">
                    <div className="flex justify-between text-xs text-cc-text-secondary mb-1">
                      <span>Total de comisión:</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-cc-text-secondary">Antes:</span>
                      <span className="font-mono text-cc-primary">
                        {formatCurrency(safeNumber(sale.total_commission))}
                      </span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-cc-text-secondary">Después:</span>
                      <span className="font-mono text-cc-primary">
                        {formatCurrency(
                          safeNumber(sale.total_commission) + commissionDiff
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reason Display */}
              <div className="bg-[#151515] rounded-lg p-4 border border-white/10">
                <p className="text-xs text-cc-text-muted uppercase tracking-wider mb-2">
                  Razón
                </p>
                <p className="text-cc-text-main text-sm">{reason}</p>
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-950 border border-red-700 rounded-lg p-3 flex gap-2">
                  <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-100 text-sm">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 p-6 border-t border-white/10 bg-cc-surface flex gap-3">
          {step === 'form' && (
            <>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 rounded-lg border border-white/20 text-cc-text-main font-semibold hover:bg-white/5 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => setStep('preview')}
                disabled={!isFormValid()}
                className={`flex-1 px-4 py-2 rounded-lg font-semibold transition ${
                  isFormValid()
                    ? 'bg-cc-primary text-cc-bg hover:bg-cc-primary/90'
                    : 'bg-white/5 text-cc-text-secondary cursor-not-allowed'
                }`}
              >
                Ver cambios
              </button>
            </>
          )}

          {step === 'preview' && (
            <>
              <button
                onClick={() => setStep('form')}
                className="flex-1 px-4 py-2 rounded-lg border border-white/20 text-cc-text-main font-semibold hover:bg-white/5 transition"
              >
                Volver
              </button>
              <button
                onClick={handleSubmitCorrection}
                disabled={loading}
                className={`flex-1 px-4 py-2 rounded-lg font-semibold transition ${
                  loading
                    ? 'bg-white/5 text-cc-text-secondary cursor-not-allowed'
                    : 'bg-cc-primary text-cc-bg hover:bg-cc-primary/90'
                }`}
              >
                {loading ? 'Confirmando...' : 'Confirmar corrección'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
