import { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { X, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';
import {
  PieceSaleProduct,
  PieceSaleItemDisplay,
  PieceSaleResponse,
} from '../../../types/pieceSales';
import {
  calculateTotals,
  createPieceSaleItem,
  formatCurrency,
  sanitizeFileName,
  validateFileSize,
  validateFileType,
} from '../../../lib/pieceSalesHelpers';
import { createPieceSaleWithPaymentRequest } from '../../../lib/pieceSalesRpc';
import { submitPaymentVerificationRequest } from '../../../lib/paymentVerificationRpcs';
import { NewPieceSaleSuccess } from './NewPieceSaleSuccess';

interface NewPieceSaleModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export const NewPieceSaleModal = ({ onClose, onSuccess }: NewPieceSaleModalProps) => {
  const [products, setProducts] = useState<PieceSaleProduct[]>([]);
  const [items, setItems] = useState<PieceSaleItemDisplay[]>([]);
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer'>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<PieceSaleResponse | null>(null);

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('v_piece_sale_products')
        .select('*');

      if (error) throw error;
      setProducts((data as PieceSaleProduct[]) || []);
    } catch (err: any) {
      console.error('Error loading products:', err);
      setError('Error al cargar productos');
    }
  };

  const addItem = (product: PieceSaleProduct) => {
    // Check if product already exists
    if (items.some((item) => item.product_id === product.product_id)) {
      setError('Este producto ya fue agregado');
      return;
    }

    const newItem = createPieceSaleItem(product, 1);
    setItems([...items, newItem]);
  };

  const removeItem = (productId: string) => {
    setItems(items.filter((item) => item.product_id !== productId));
  };

  const updateItemQuantity = (productId: string, quantity: number) => {
    if (quantity < 1) {
      removeItem(productId);
      return;
    }

    setItems(
      items.map((item) => {
        if (item.product_id === productId) {
          const subtotal = item.retail_price * quantity;
          const commission_total = item.unit_commission * quantity;
          return { ...item, quantity, subtotal, commission_total };
        }
        return item;
      })
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!validateFileType(file.type)) {
      setError('Tipo de archivo no permitido. Use JPG, PNG, WebP o PDF.');
      return;
    }

    if (!validateFileSize(file.size)) {
      setError('El archivo es demasiado grande. Máximo 10 MB.');
      return;
    }

    setProofFile(file);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (items.length === 0) {
      setError('Agregue al least 1 producto');
      return;
    }

    if (paymentMethod === 'cash' && !cashConfirmed) {
      setError('Debe confirmar que recibió el efectivo completo');
      return;
    }

    if (paymentMethod === 'transfer' && !proofFile) {
      setError('Debe adjuntar comprobante de transferencia');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const authResponse = await supabase?.auth.getUser();
      const userData = authResponse?.data?.user;
      if (!userData?.id) throw new Error('Usuario no autenticado');

      // Create sale
      const salePayload = {
        p_sale_date: new Date(saleDate).toISOString(),
        p_payment_method: paymentMethod,
        p_items: items.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
        })),
        p_payment_reference: reference || null,
        p_notes: notes || null,
      };

      const saleResponse = await createPieceSaleWithPaymentRequest(salePayload);

      // Upload proof if transfer
      if (paymentMethod === 'transfer' && proofFile) {
        setUploading(true);

        const fileName = sanitizeFileName(proofFile.name);
        const filePath = `${userData.id}/${saleResponse.request_id}/${Date.now()}-${fileName}`;

        const { error: uploadError } = await supabase!.storage
          .from('customer-payment-proofs')
          .upload(filePath, proofFile, { upsert: false });

        if (uploadError) throw new Error(`Error uploading proof: ${uploadError.message}`);

        // Submit payment
        await submitPaymentVerificationRequest(
          saleResponse.request_id,
          filePath,
          fileName,
          proofFile.type,
          proofFile.size
        );
      } else if (paymentMethod === 'cash') {
        // Submit payment for cash
        await submitPaymentVerificationRequest(
          saleResponse.request_id,
          null,
          null,
          null,
          null
        );
      }

      setSuccessData(saleResponse);
    } catch (err: any) {
      console.error('Error creating sale:', err);
      setError(err?.message || 'Error al registrar venta');
    } finally {
      setLoading(false);
      setUploading(false);
    }
  };

  if (successData) {
    return (
      <NewPieceSaleSuccess
        data={successData}
        onClose={() => {
          onClose();
          onSuccess();
        }}
      />
    );
  }

  const { totalAmount, totalCommission, totalUnits } = calculateTotals(items);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1C1A1A] rounded-3xl border border-white/10 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* ── HEADER ──────────────────────────────────────── */}
        <div className="sticky top-0 bg-[#2A2A2A] border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-cc-text-main">Nueva venta por pieza</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#3A3A3A] rounded-xl transition-colors"
          >
            <X className="w-5 h-5 text-cc-text-muted" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* ── ERROR ───────────────────────────────────── */}
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* ── PRODUCTS LIST ───────────────────────────── */}
          <div>
            <label className="block text-sm font-semibold text-cc-text-main mb-3">
              Productos
            </label>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {products.map((product) => {
                const isAdded = items.some((item) => item.product_id === product.product_id);
                return (
                  <button
                    key={product.product_id}
                    type="button"
                    onClick={() => addItem(product)}
                    disabled={isAdded}
                    className={`w-full text-left p-3 rounded-xl border transition-colors ${
                      isAdded
                        ? 'bg-[#2A2A2A] border-white/5 opacity-50 cursor-not-allowed'
                        : 'bg-[#2A2A2A] border-white/10 hover:border-cc-primary hover:bg-[#3A3A3A]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-cc-cream">{product.product_name}</p>
                        <p className="text-xs text-cc-text-muted">
                          {product.product_variant} • {product.product_size}
                        </p>
                      </div>
                      <Plus className="w-5 h-5 text-cc-primary" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── SELECTED ITEMS ──────────────────────────── */}
          {items.length > 0 && (
            <div>
              <label className="block text-sm font-semibold text-cc-text-main mb-3">
                Items seleccionados
              </label>
              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item.product_id} className="bg-[#2A2A2A] rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-semibold text-cc-cream">{item.product_name}</p>
                        <p className="text-xs text-cc-text-muted">
                          {item.retail_price === null ? '...' : formatCurrency(item.retail_price)} / unidad
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(item.product_id)}
                        className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div>
                        <label className="text-xs text-cc-text-muted mb-1 block">Cantidad</label>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) =>
                            updateItemQuantity(item.product_id, parseInt(e.target.value) || 1)
                          }
                          className="w-full bg-[#1C1A1A] border border-white/10 rounded-lg px-3 py-2 text-cc-cream text-sm focus:outline-none focus:border-cc-primary"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-cc-text-muted mb-1 block">Subtotal</label>
                        <div className="bg-[#1C1A1A] border border-white/10 rounded-lg px-3 py-2 text-cc-cream text-sm font-semibold">
                          {formatCurrency(item.subtotal)}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-white/10 text-xs">
                      <p className="text-cc-text-muted">
                        Comisión:{' '}
                        <span className="text-green-400 font-semibold">
                          {formatCurrency(item.commission_total)}
                        </span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── SALE DETAILS ────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-cc-text-main mb-2">
                Fecha
              </label>
              <input
                type="date"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                required
                className="w-full bg-[#2A2A2A] border border-white/10 rounded-lg px-3 py-2 text-cc-cream text-sm focus:outline-none focus:border-cc-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-cc-text-main mb-2">
                Método
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as 'cash' | 'transfer')}
                className="w-full bg-[#2A2A2A] border border-white/10 rounded-lg px-3 py-2 text-cc-cream text-sm focus:outline-none focus:border-cc-primary"
              >
                <option value="cash">Efectivo</option>
                <option value="transfer">Transferencia</option>
              </select>
            </div>
          </div>

          {/* ── PAYMENT INFO ────────────────────────────── */}
          {paymentMethod === 'cash' && (
            <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-2xl">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cashConfirmed}
                  onChange={(e) => setCashConfirmed(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-cc-primary"
                />
                <span className="text-sm text-blue-300">
                  Confirmo que recibí el importe completo en efectivo y que debo entregarlo
                  íntegramente a Cat Corn.
                </span>
              </label>
            </div>
          )}

          {paymentMethod === 'transfer' && (
            <div className="space-y-3">
              <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-2xl">
                <p className="text-sm text-blue-300">
                  El cliente debe transferir directamente a la cuenta de Cat Corn.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-cc-text-main mb-2">
                  Comprobante *
                </label>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={handleFileChange}
                  required
                  className="w-full bg-[#2A2A2A] border border-white/10 rounded-lg px-3 py-2 text-cc-text-muted text-sm focus:outline-none focus:border-cc-primary"
                />
                <p className="text-xs text-cc-text-muted mt-1">
                  JPG, PNG, WebP o PDF (máx. 10 MB)
                </p>
                {proofFile && (
                  <p className="text-xs text-green-400 mt-1">✓ {proofFile.name}</p>
                )}
              </div>
            </div>
          )}

          {/* ── REFERENCE ───────────────────────────────── */}
          <div>
            <label className="block text-sm font-semibold text-cc-text-main mb-2">
              Referencia (opcional)
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Número de transferencia, cheque, etc."
              className="w-full bg-[#2A2A2A] border border-white/10 rounded-lg px-3 py-2 text-cc-cream text-sm focus:outline-none focus:border-cc-primary"
            />
          </div>

          {/* ── NOTES ───────────────────────────────────── */}
          <div>
            <label className="block text-sm font-semibold text-cc-text-main mb-2">
              Notas (opcional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Información adicional..."
              rows={3}
              className="w-full bg-[#2A2A2A] border border-white/10 rounded-lg px-3 py-2 text-cc-cream text-sm focus:outline-none focus:border-cc-primary resize-none"
            />
          </div>

          {/* ── TOTALS ──────────────────────────────────── */}
          {items.length > 0 && (
            <div className="bg-[#2A2A2A] rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-cc-text-muted">Unidades:</span>
                <span className="font-semibold text-cc-cream">{totalUnits}</span>
              </div>
              <div className="flex items-center justify-between text-sm border-t border-white/10 pt-2">
                <span className="text-cc-text-muted">Total de venta:</span>
                <span className="font-bold text-cc-cream">{formatCurrency(totalAmount)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-cc-text-muted">Comisión estimada:</span>
                <span className="font-bold text-green-400">{formatCurrency(totalCommission)}</span>
              </div>
            </div>
          )}

          {/* ── BUTTONS ─────────────────────────────────── */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-[#2A2A2A] hover:bg-[#3A3A3A] text-cc-text-main rounded-xl font-semibold transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || uploading || items.length === 0}
              className="flex-1 px-4 py-3 bg-cc-primary hover:bg-cc-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-cc-surface rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {loading || uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {uploading ? 'Subiendo comprobante...' : 'Registrando...'}
                </>
              ) : (
                'Reportar venta'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
