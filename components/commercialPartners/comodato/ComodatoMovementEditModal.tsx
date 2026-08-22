import React, { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Plus, Trash2, X } from 'lucide-react';
import {
  PartnerMovement,
  PartnerMovementItem,
  ComodatoProduct,
  fmtCurrency,
  fmtDate,
  MOVEMENT_TYPE_LABELS,
  INPUT_CLS,
  SELECT_CLS,
  LABEL_CLS,
  CARD_CLS,
} from './types';

interface Props {
  movementId: string;
  partnerId: string;
  onClose: () => void;
  onSaved: () => void;
}

const ComodatoMovementEditModal: React.FC<Props> = ({ movementId, partnerId, onClose, onSaved }) => {
  const [movement, setMovement] = useState<PartnerMovement | null>(null);
  const [items, setItems] = useState<PartnerMovementItem[]>([]);
  const [products, setProducts] = useState<ComodatoProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [hasConflicts, setHasConflicts] = useState<string | null>(null);
  const [nextVisitDate, setNextVisitDate] = useState('');
  const [nextVisitReason, setNextVisitReason] = useState('');

  useEffect(() => {
    loadData();
  }, [movementId]);

  const loadData = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      // Load movement
      const { data: movementData, error: movementErr } = await supabase
        .from('commercial_partner_movements')
        .select('*')
        .eq('id', movementId)
        .single();

      if (movementErr) throw movementErr;
      if (!movementData) throw new Error('Movimiento no encontrado');

      setMovement(movementData);
      setNotes(movementData.notes || '');
      setNextVisitDate(movementData.next_visit_date || '');
      setNextVisitReason(movementData.next_visit_reason || '');

      // Load items
      const { data: itemsData, error: itemsErr } = await supabase
        .from('commercial_partner_movement_items')
        .select('*')
        .eq('movement_id', movementId);

      if (itemsErr) throw itemsErr;
      setItems(itemsData || []);

      // Load comodato products
      const { data: productsData, error: productsErr } = await supabase
        .from('comodato_products')
        .select('*')
        .eq('active', true)
        .order('product_name');

      if (productsErr) throw productsErr;
      setProducts(productsData || []);

      // Check for conflicts (can only edit 'delivery' type movements without sold/withdrawn/spoiled)
      if (movementData.movement_type === 'delivery') {
        // Check if any items have been sold/withdrawn/spoiled
        const itemsWithActivity = (itemsData || []).filter(
          it => (it.quantity_sold ?? 0) > 0 || (it.quantity_withdrawn ?? 0) > 0 || (it.quantity_spoiled ?? 0) > 0
        );
        if (itemsWithActivity.length > 0) {
          setHasConflicts(
            'Este movimiento de entrega tiene productos que ya han sido vendidos, retirados o dañados. No puede editarse.'
          );
        }
      } else {
        // Other movement types (settlement, withdrawal, spoilage, etc.) cannot be edited
        const movType = movementData.movement_type as keyof typeof MOVEMENT_TYPE_LABELS;
        const typeLabel = (movType in MOVEMENT_TYPE_LABELS) ? MOVEMENT_TYPE_LABELS[movType] : movementData.movement_type;
        setHasConflicts(`Los movimientos tipo "${typeLabel}" no pueden ser editados.`);
      }

      // Check payment verification requests
      if (movementData.movement_type === 'settlement') {
        const { data: verificationsData, error: verificationsErr } = await supabase
          .from('commercial_partner_payment_verification_requests')
          .select('id')
          .eq('movement_id', movementId)
          .in('status', ['pending_review', 'approved'])
          .limit(1);

        if (verificationsErr) throw verificationsErr;
        if (verificationsData && verificationsData.length > 0) {
          setHasConflicts('Este movimiento ya tiene solicitudes de verificación de pago pendientes o aprobadas. No puede editarse.');
        }
      }
    } catch (err: any) {
      console.error('Error loading movement:', err);
      setError(err.message || 'Error al cargar el movimiento');
    } finally {
      setLoading(false);
    }
  };

  const handleProductSelect = (index: number, productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    setItems(prev =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              product_code: product.product_code,
              product_name: product.product_name,
              product_variant: product.product_variant,
              product_size: product.product_size,
              price_to_catcorn: product.price_to_catcorn,
              suggested_retail_price: product.suggested_retail_price,
            }
          : item,
      ),
    );
  };

  const handleQuantityChange = (index: number, field: string, qty: number) => {
    setItems(prev =>
      prev.map((item, i) =>
        i === index ? { ...item, [field]: qty } : item,
      ),
    );
  };

  const handleRemoveItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddItem = () => {
    setItems(prev => [
      ...prev,
      {
        movement_id: movementId,
        product_code: '',
        product_name: '',
        product_variant: '',
        product_size: '',
        quantity_delivered: 0,
        quantity_sold: 0,
        quantity_withdrawn: 0,
        quantity_spoiled: 0,
        price_to_catcorn: 0,
        suggested_retail_price: 0,
        amount_due: 0,
        notes: '',
      } as any,
    ]);
  };

  const handleSave = async () => {
    if (!supabase || !movement || hasConflicts) return;

    setShowConfirm(false);
    setSaving(true);
    setError(null);

    try {
      // Update movement header
      const { error: updateErr } = await supabase
        .from('commercial_partner_movements')
        .update({
          notes: notes || null,
          next_visit_date: nextVisitDate || null,
          next_visit_reason: nextVisitReason || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', movementId);

      if (updateErr) throw updateErr;

      // Delete old items
      const { error: deleteErr } = await supabase
        .from('commercial_partner_movement_items')
        .delete()
        .eq('movement_id', movementId);

      if (deleteErr) throw deleteErr;

      // Insert new items (preserving historical prices)
      const newItems = items.map(item => ({
        movement_id: movementId,
        partner_id: partnerId,
        product_code: item.product_code,
        product_name: item.product_name,
        product_variant: item.product_variant,
        product_size: item.product_size,
        quantity_delivered: item.quantity_delivered || 0,
        quantity_sold: item.quantity_sold || 0,
        quantity_withdrawn: item.quantity_withdrawn || 0,
        quantity_spoiled: item.quantity_spoiled || 0,
        price_to_catcorn: item.price_to_catcorn || 0,
        suggested_retail_price: item.suggested_retail_price || 0,
        amount_due: item.amount_due || 0,
        notes: item.notes || null,
        spoilage_absorbed_by: item.spoilage_absorbed_by || null,
      }));

      const { error: insertErr } = await supabase
        .from('commercial_partner_movement_items')
        .insert(newItems);

      if (insertErr) throw insertErr;

      // Recalculate totals
      const totalAmountDue = newItems.reduce((sum, it) => sum + (it.amount_due || 0), 0);
      const { error: totalsErr } = await supabase
        .from('commercial_partner_movements')
        .update({ total_amount_due: totalAmountDue })
        .eq('id', movementId);

      if (totalsErr) throw totalsErr;

      onSaved();
    } catch (err: any) {
      console.error('Error saving movement:', err);
      setError(err.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
        <div className={`${CARD_CLS} p-6 max-w-md w-full text-center`}>
          <p>Cargando movimiento...</p>
        </div>
      </div>
    );
  }

  if (hasConflicts) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
        <div className="bg-[#D6A23A] border border-[#a87820] rounded-lg max-w-sm w-full p-6 shadow-xl">
          <h3 className="text-lg font-bold text-[#111111] mb-3">
            No se puede editar este movimiento
          </h3>
          <p className="text-sm text-[#374151] mb-6">
            {hasConflicts}
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
          <h2 className="text-xl font-bold text-gray-900">Editar Movimiento</h2>
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

          {/* Movement info */}
          {movement && (
            <div className="p-4 bg-gray-50 rounded border border-gray-200">
              <p className="text-xs text-gray-600 mb-1">Tipo de movimiento</p>
              <p className="font-semibold text-gray-900">
                {MOVEMENT_TYPE_LABELS[movement.movement_type] || movement.movement_type}
              </p>
              <p className="text-xs text-gray-600 mt-2">Fecha: {fmtDate(movement.movement_date)}</p>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className={LABEL_CLS}>Notas</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className={`${INPUT_CLS} resize-none`}
              rows={2}
              placeholder="Notas adicionales..."
            />
          </div>

          {/* Next visit (for delivery type only) */}
          {movement?.movement_type === 'delivery' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLS}>Próxima visita</label>
                <input
                  type="date"
                  value={nextVisitDate}
                  onChange={e => setNextVisitDate(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Motivo</label>
                <input
                  type="text"
                  value={nextVisitReason}
                  onChange={e => setNextVisitReason(e.target.value)}
                  className={INPUT_CLS}
                  placeholder="Motivo de la siguiente visita"
                />
              </div>
            </div>
          )}

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className={LABEL_CLS}>Productos</label>
              {movement?.movement_type === 'delivery' && (
                <button
                  onClick={handleAddItem}
                  className="px-2 py-1 text-sm bg-white border border-[#c49330] text-[#111111] font-semibold rounded hover:bg-[#f7e6bd] transition-colors flex items-center gap-1"
                >
                  <Plus size={14} />
                  Agregar
                </button>
              )}
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
                        {movement?.movement_type === 'delivery' ? (
                          <select
                            value={item.product_code || ''}
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
                        ) : (
                          <div className="bg-white border border-gray-300 rounded px-3 py-2 text-sm font-semibold">
                            {item.product_name}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-700">Cantidad</label>
                        <input
                          type="number"
                          min={0}
                          value={item.quantity_delivered}
                          onChange={e => handleQuantityChange(idx, 'quantity_delivered', parseInt(e.target.value) || 0)}
                          disabled={movement?.movement_type !== 'delivery'}
                          className={INPUT_CLS}
                        />
                      </div>
                    </div>

                    {movement?.movement_type !== 'delivery' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-gray-700">Vendido</label>
                          <input
                            type="number"
                            min={0}
                            value={item.quantity_sold}
                            disabled
                            className={INPUT_CLS}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-gray-700">Retirado</label>
                          <input
                            type="number"
                            min={0}
                            value={item.quantity_withdrawn}
                            disabled
                            className={INPUT_CLS}
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-xs text-gray-600">Precio a Cat Corn</p>
                        <p className="font-semibold">{fmtCurrency(item.price_to_catcorn || 0)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">PVP</p>
                        <p className="font-semibold">{fmtCurrency(item.suggested_retail_price || 0)}</p>
                      </div>
                      {movement?.movement_type === 'delivery' && (
                        <button
                          onClick={() => handleRemoveItem(idx)}
                          className="px-2 py-1 text-red-600 hover:bg-red-50 rounded text-xs font-medium flex items-center gap-1 transition-colors"
                        >
                          <Trash2 size={12} />
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
            disabled={saving || items.length === 0}
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
                  <p className="text-gray-600">Total de productos: {items.length}</p>
                  <p className="text-lg font-semibold">
                    {items.reduce((sum, it) => sum + (it.quantity_delivered || 0), 0)} piezas
                  </p>
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

export default ComodatoMovementEditModal;
