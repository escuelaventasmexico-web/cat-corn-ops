import React, { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Plus, Trash2, X } from 'lucide-react';
import { WholesaleProduct, MINIMUM_ORDER_PIECES, INPUT_CLS, SELECT_CLS, LABEL_CLS, CARD_CLS, BUTTON_ADD_CLS, fmtCurrency } from './types';

interface Props {
  orderId: string;
  partnerId: string;
  onClose: () => void;
  onSaved: () => void;
}

interface OrderItem {
  id?: string;
  product_code: string;
  product_name: string;
  product_variant: string;
  product_size: string;
  quantity: number;
  unit_price: number;
}

interface OrderData {
  id: string;
  partner_id: string;
  order_date: string;
  delivery_date: string;
  order_status: string;
  notes: string | null;
}

const WholesaleOrderEditModal: React.FC<Props> = ({ orderId, partnerId, onClose, onSaved }) => {
  const [products, setProducts] = useState<WholesaleProduct[]>([]);
  const [order, setOrder] = useState<OrderData | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [orderDate, setOrderDate] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPayments, setHasPayments] = useState(false);
  const [originalItems, setOriginalItems] = useState<OrderItem[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    loadData();
  }, [orderId]);

  const loadData = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      // Load products
      const { data: productsData, error: productsErr } = await supabase
        .from('wholesale_price_catalog')
        .select('*')
        .eq('active', true)
        .order('product_name');

      if (productsErr) throw productsErr;
      setProducts(productsData || []);

      // Load order
      const { data: orderData, error: orderErr } = await supabase
        .from('wholesale_orders')
        .select('*')
        .eq('id', orderId)
        .single();

      if (orderErr) throw orderErr;
      if (!orderData) throw new Error('Pedido no encontrado');

      setOrder(orderData);
      setOrderDate(orderData.order_date);
      setDeliveryDate(orderData.delivery_date);
      setNotes(orderData.notes || '');

      // Load items
      const { data: itemsData, error: itemsErr } = await supabase
        .from('wholesale_order_items')
        .select('*')
        .eq('wholesale_order_id', orderId);

      if (itemsErr) throw itemsErr;
      setItems(itemsData || []);
      setOriginalItems(itemsData || []);

      // Check for payments (can't edit if payments exist)
      const { data: paymentData, error: paymentErr } = await supabase
        .from('wholesale_payments')
        .select('id')
        .eq('wholesale_order_id', orderId)
        .in('status', ['completed', 'paid'])
        .limit(1);

      if (paymentErr) throw paymentErr;
      setHasPayments(paymentData && paymentData.length > 0);
    } catch (err: any) {
      console.error('Error loading order:', err);
      setError(err.message || 'Error al cargar el pedido');
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = () => {
    setItems(prev => [
      ...prev,
      {
        product_code: '',
        product_name: '',
        product_variant: '',
        product_size: '',
        quantity: 0,
        unit_price: 0,
      },
    ]);
  };

  const handleProductSelect = (index: number, productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    setItems(prev =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              id: item.id,
              product_code: product.product_code,
              product_name: product.product_name,
              product_variant: product.product_variant,
              product_size: product.product_size,
              unit_price: product.wholesale_price,
            }
          : item,
      ),
    );
  };

  const handleQuantityChange = (index: number, qty: number) => {
    setItems(prev =>
      prev.map((item, i) => (i === index ? { ...item, quantity: qty } : item)),
    );
  };

  const handlePriceChange = (index: number, price: number) => {
    setItems(prev =>
      prev.map((item, i) => (i === index ? { ...item, unit_price: price } : item)),
    );
  };

  const handleRemoveItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const totalPieces = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const originalTotal = originalItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const canSave = totalPieces >= MINIMUM_ORDER_PIECES && items.length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave || !supabase || !order) return;

    if (hasPayments) {
      setError('Este pedido ya tiene pagos registrados y no puede modificarse.');
      return;
    }

    setShowConfirm(false);
    setSaving(true);
    setError(null);

    try {
      // Update order header
      const { error: updateErr } = await supabase
        .from('wholesale_orders')
        .update({
          order_date: orderDate,
          delivery_date: deliveryDate,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId);

      if (updateErr) throw updateErr;

      // Delete old items
      const { error: deleteErr } = await supabase
        .from('wholesale_order_items')
        .delete()
        .eq('wholesale_order_id', orderId);

      if (deleteErr) throw deleteErr;

      // Insert new items (preserving historical prices where appropriate)
      const newItems = items.map(item => ({
        wholesale_order_id: orderId,
        partner_id: partnerId,
        product_code: item.product_code,
        product_name: item.product_name,
        product_variant: item.product_variant,
        product_size: item.product_size,
        quantity: item.quantity,
        unit_price: item.unit_price,
      }));

      const { error: insertErr } = await supabase
        .from('wholesale_order_items')
        .insert(newItems);

      if (insertErr) throw insertErr;

      onSaved();
    } catch (err: any) {
      console.error('Error saving order:', err);
      setError(err.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
        <div className={`${CARD_CLS} p-6 max-w-md w-full text-center`}>
          <p>Cargando pedido...</p>
        </div>
      </div>
    );
  }

  if (hasPayments && !showConfirm) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
        <div className="bg-[#D6A23A] border border-[#a87820] rounded-lg max-w-sm w-full p-6 shadow-xl">
          <h3 className="text-lg font-bold text-[#111111] mb-3">
            No se puede editar este pedido
          </h3>
          <p className="text-sm text-[#374151] mb-6">
            Este pedido ya tiene pagos registrados. Para evitar inconsistencias financieras, no puede ser modificado directamente.
          </p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-[#2d1a00] hover:bg-[#1a0f00] text-[#F6E7C1] rounded font-medium transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center pt-10 px-4 pb-8 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Editar Pedido Mayoreo</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-800">
              {error}
            </div>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLS}>Fecha de Pedido</label>
              <input
                type="date"
                value={orderDate}
                onChange={e => setOrderDate(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Fecha de Entrega</label>
              <input
                type="date"
                value={deliveryDate}
                onChange={e => setDeliveryDate(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={LABEL_CLS}>Notas</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className={`${INPUT_CLS} resize-none`}
              rows={3}
              placeholder="Notas adicionales..."
            />
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className={LABEL_CLS}>Productos</label>
              <button
                onClick={handleAddItem}
                className={`${BUTTON_ADD_CLS} flex items-center gap-1`}
              >
                <Plus size={14} />
                Agregar Producto
              </button>
            </div>

            {items.length === 0 ? (
              <p className="text-sm text-gray-500 italic">Sin productos agregados</p>
            ) : (
              <div className="space-y-3">
                {items.map((item, idx) => (
                  <div key={idx} className="p-4 bg-gray-50 rounded border border-gray-200 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-gray-700">Producto</label>
                        <select
                          value={item.product_code}
                          onChange={e => {
                            const prod = products.find(p => p.product_code === e.target.value);
                            if (prod) handleProductSelect(idx, prod.id);
                          }}
                          className={SELECT_CLS}
                        >
                          <option value="">Seleccionar...</option>
                          {products.map(p => (
                            <option key={p.id} value={p.product_code}>
                              {p.product_name} {p.product_variant && `- ${p.product_variant}`}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-700">Cantidad</label>
                        <input
                          type="number"
                          min={0}
                          value={item.quantity}
                          onChange={e => handleQuantityChange(idx, parseInt(e.target.value) || 0)}
                          className={INPUT_CLS}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-gray-700">Precio Unitario</label>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={item.unit_price}
                          onChange={e => handlePriceChange(idx, parseFloat(e.target.value) || 0)}
                          className={INPUT_CLS}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-700">Subtotal</label>
                        <div className="bg-white border border-gray-300 rounded px-3 py-2 text-sm font-semibold">
                          {fmtCurrency(item.quantity * item.unit_price)}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleRemoveItem(idx)}
                      className="w-full px-2 py-1 text-red-600 hover:bg-red-50 rounded text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                    >
                      <Trash2 size={12} />
                      Eliminar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Summary */}
          {items.length > 0 && (
            <div className="p-4 bg-gray-50 rounded border border-gray-200 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium">Total piezas:</span>
                <span className="font-semibold">{totalPieces}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-medium">Total anterior:</span>
                <span className="font-semibold">{fmtCurrency(originalTotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="font-medium">Total nuevo:</span>
                <span className="font-semibold text-green-600">{fmtCurrency(totalAmount)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-900 rounded font-medium transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={!canSave || saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </div>

        {/* Confirm Modal */}
        {showConfirm && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">
                Confirmar cambios
              </h3>
              <div className="mb-6 space-y-3 text-sm">
                <div>
                  <p className="text-gray-600">Total anterior</p>
                  <p className="text-lg font-semibold">{fmtCurrency(originalTotal)}</p>
                </div>
                <div>
                  <p className="text-gray-600">Total nuevo</p>
                  <p className="text-lg font-semibold text-green-600">{fmtCurrency(totalAmount)}</p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-900 rounded font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WholesaleOrderEditModal;
