import React, { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Plus, Trash2 } from 'lucide-react';
import { WholesaleProduct, MINIMUM_ORDER_PIECES, INPUT_CLS, SELECT_CLS, LABEL_CLS, CARD_CLS, BUTTON_PRIMARY_CLS, BUTTON_ADD_CLS, todayISO } from './types';
import { createWholesaleOrderWithUnits } from '../../../services/commercialDeliveryUnitService';

interface Props {
  partnerId: string;
  onClose: () => void;
  onSaved: () => void;
}

interface OrderItem {
  product_id?: string | null;
  product_code: string;
  product_name: string;
  product_variant: string;
  product_size: string;
  quantity: number;
  unit_price: number;
}

const WholesaleOrderForm: React.FC<Props> = ({ partnerId, onClose, onSaved }) => {
  const [products, setProducts] = useState<WholesaleProduct[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [orderDate, setOrderDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setLoading] = useState(true);

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    if (!supabase) return;
    try {
      const { data, error: queryError } = await supabase
        .from('wholesale_price_catalog')
        .select('*')
        .eq('active', true)
        .order('product_name');

      if (queryError) throw queryError;
      setProducts(data || []);
    } catch (err: any) {
      setError(err.message || 'Error al cargar catálogo');
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
              product_id: product.product_id,
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

  const handleRemoveItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const totalPieces = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const canSave = totalPieces >= MINIMUM_ORDER_PIECES && items.length > 0 && !saving;

  const handleSave = async () => {
    if (totalPieces < MINIMUM_ORDER_PIECES) {
      setError(`El mínimo de compra es ${MINIMUM_ORDER_PIECES} piezas. Tienes ${totalPieces}.`);
      return;
    }

    if (!supabase) {
      setError('Supabase no configurado');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (items.some(item => !item.product_id)) {
        throw new Error('El catálogo debe tener un producto real asociado para generar etiquetas individuales.');
      }
      await createWholesaleOrderWithUnits({
        partnerId,
        orderDate,
        notes,
        paymentTermsHours: 72,
        items: items.map(item => ({
          product_id: item.product_id,
          product_code: item.product_code,
          product_name: item.product_name,
          product_variant: item.product_variant,
          product_size: item.product_size,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
      });

      onSaved();
    } catch (err: any) {
      setError(err.message || 'Error al guardar orden');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-20 px-4 pb-8 overflow-y-auto">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#D6A23A] shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex justify-between items-center px-6 pt-5 pb-3 border-b border-[#c49330]">
            <h2 className="text-xl font-bold text-[#111111]">Registrar Venta Mayoreo</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#c49330]/50 text-[#374151]">
            ✕
          </button>
        </div>

        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          {error && <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg text-red-800 text-sm">{error}</div>}

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className={LABEL_CLS}>Fecha de Venta *</label>
                <input 
                  type="date" 
                  value={orderDate} 
                  onChange={e => setOrderDate(e.target.value)} 
                  className={INPUT_CLS}
                  style={{ color: '#111111', WebkitTextFillColor: '#111111', backgroundColor: '#ffffff' }}
                />
              </div>
            </div>
            <p className="text-xs text-[#6b5c40]">La fecha de entrega y el plazo de pago se asignarán al liberar todas las bolsas escaneadas.</p>

            <div>
              <label className={LABEL_CLS}>Notas</label>
              <textarea 
                value={notes} 
                onChange={e => setNotes(e.target.value)} 
                className={INPUT_CLS} 
                rows={2}
                style={{ color: '#111111', WebkitTextFillColor: '#111111', backgroundColor: '#ffffff' }}
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-3">
                <label className="text-sm font-medium text-[#4a2c0a]">Productos (Mínimo: {MINIMUM_ORDER_PIECES} piezas)</label>
                <button 
                  onClick={handleAddItem} 
                  className={BUTTON_ADD_CLS}
                  style={{ WebkitTextFillColor: '#111111' }}
                >
                  <Plus size={14} /> Agregar
                </button>
              </div>

              {items.length === 0 ? (
                <div className={`${CARD_CLS} text-center py-4`}>
                  <p className="text-sm text-[#6b7280]">No hay productos. Agrega uno para comenzar.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx} className={`${CARD_CLS} grid grid-cols-5 gap-2 items-end`}>
                      <div>
                        <label className="text-xs text-[#6b7280]">Producto</label>
                        <select
                          value={item.product_code}
                          onChange={e => {
                            const selected = products.find(p => p.product_code === e.target.value);
                            if (selected) handleProductSelect(idx, selected.id);
                          }}
                          className={SELECT_CLS}
                          style={{ color: '#111111', WebkitTextFillColor: '#111111', backgroundColor: '#ffffff' }}
                        >
                          <option value="" style={{ color: '#111111', backgroundColor: '#ffffff' }}>Seleccionar...</option>
                          {products.map(p => (
                            <option key={p.id} value={p.product_code} style={{ color: '#111111', backgroundColor: '#ffffff' }}>
                              {p.product_name} - {p.product_variant}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-[#6b7280]">Cantidad</label>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity || ''}
                          onChange={e => handleQuantityChange(idx, parseInt(e.target.value) || 0)}
                          className={INPUT_CLS}
                          style={{ color: '#111111', WebkitTextFillColor: '#111111', backgroundColor: '#ffffff' }}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[#6b7280]">P. Unitario</label>
                        <input 
                          type="number" 
                          value={item.unit_price} 
                          disabled 
                          className={INPUT_CLS}
                          style={{ color: '#111111', WebkitTextFillColor: '#111111', backgroundColor: '#ffffff', opacity: '1' }}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[#6b7280]">Subtotal</label>
                        <div className="px-3 py-2 bg-white rounded border border-[#c49330] text-[#111111] text-sm font-semibold" style={{ color: '#111111' }}>
                          ${(item.quantity * item.unit_price).toFixed(2)}
                        </div>
                      </div>
                      <button onClick={() => handleRemoveItem(idx)} className="px-2 py-2 bg-red-600 text-white rounded hover:bg-red-700">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className={`${CARD_CLS} mt-3 text-right`} style={{ color: '#111111' }}>
                <p className="text-sm" style={{ color: '#111111' }}>
                  <strong>Total Piezas:</strong> {totalPieces}
                </p>
                <p className="text-sm" style={{ color: '#111111' }}>
                  <strong>Total Venta:</strong> ${totalAmount.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#c49330] bg-[#fff8e6]">
          <button onClick={onClose} className="px-4 py-2 bg-white border border-[#c49330] text-[#111111] font-semibold rounded hover:bg-[#f5e9c8]">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={BUTTON_PRIMARY_CLS}
          >
              {saving ? 'Guardando...' : 'Guardar y generar etiquetas'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WholesaleOrderForm;
