import React, { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { X, AlertCircle } from 'lucide-react';
import {
  WholesaleOrder,
  WholesaleOrderItem,
  WholesaleOrderTotal,
  WholesalePayment,
  fmtCurrency,
  fmtDate,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_METHOD_LABELS,
  CARD_CLS,
} from './types';

interface Props {
  orderId: string;
  onClose: () => void;
}

const WholesaleOrderDetailModal: React.FC<Props> = ({ orderId, onClose }) => {
  const [order, setOrder] = useState<WholesaleOrder | null>(null);
  const [items, setItems] = useState<WholesaleOrderItem[]>([]);
  const [total, setTotal] = useState<WholesaleOrderTotal | null>(null);
  const [payments, setPayments] = useState<WholesalePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOrderDetails();
  }, [orderId]);

  const loadOrderDetails = async () => {
    if (!supabase) {
      setError('Supabase no configurado');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Load order
      const { data: orderData, error: orderError } = await supabase
        .from('wholesale_orders')
        .select('*')
        .eq('id', orderId)
        .single();

      if (orderError) throw orderError;
      if (!orderData) throw new Error('Pedido no encontrado');

      setOrder(orderData);

      // Load items
      const { data: itemsData, error: itemsError } = await supabase
        .from('wholesale_order_items')
        .select('*')
        .eq('wholesale_order_id', orderId)
        .order('id', { ascending: true });

      if (itemsError) throw itemsError;
      setItems(itemsData || []);

      // Load total
      const { data: totalData, error: totalError } = await supabase
        .from('v_wholesale_order_totals')
        .select('*')
        .eq('wholesale_order_id', orderId)
        .single();

      if (totalError && totalError.code !== 'PGRST116') {
        throw totalError;
      }
      if (totalData) {
        setTotal(totalData);
      }

      // Load payments for this order
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('wholesale_payments')
        .select('*')
        .eq('wholesale_order_id', orderId)
        .order('payment_date', { ascending: false });

      if (paymentsError) throw paymentsError;
      setPayments(paymentsData || []);
    } catch (err: any) {
      console.error('Error loading order details:', err);
      setError(err.message || 'No se pudo cargar el detalle de esta compra.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <div className="relative bg-[#D6A23A] rounded-2xl p-6 max-w-2xl w-full mx-4">
          <div className="text-center py-8">
            <p className="text-[#111111]">Cargando detalle del pedido...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <div className="relative bg-[#D6A23A] rounded-2xl p-6 max-w-2xl w-full mx-4">
          <div className="flex items-start gap-3 py-6">
            <AlertCircle className="text-red-600 shrink-0" size={20} />
            <div>
              <p className="text-red-800 font-semibold">Error</p>
              <p className="text-red-700 text-sm mt-1">{error}</p>
              <button
                onClick={loadOrderDetails}
                className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium"
              >
                Reintentar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const totalPieces = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-8 px-4 pb-8 overflow-y-auto">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#D6A23A] shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center px-6 pt-5 pb-3 border-b border-[#c49330]">
          <h2 className="text-xl font-bold text-[#111111]">Detalle de compra</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#c49330]/50 text-[#374151]"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 max-h-[calc(100vh-200px)] overflow-y-auto">
          {/* Order Header */}
          <div className={`${CARD_CLS} mb-4 grid grid-cols-2 gap-4 md:grid-cols-4`}>
            <div>
              <p className="text-xs text-[#6b7280] font-medium">Folio</p>
              <p className="text-sm font-semibold text-[#111111]">{order.id.slice(0, 8)}</p>
            </div>
            <div>
              <p className="text-xs text-[#6b7280] font-medium">Fecha</p>
              <p className="text-sm font-semibold text-[#111111]">{fmtDate(order.order_date)}</p>
            </div>
            <div>
              <p className="text-xs text-[#6b7280] font-medium">Entrega</p>
              <p className="text-sm font-semibold text-[#111111]">{fmtDate(order.delivery_date)}</p>
            </div>
            <div>
              <p className="text-xs text-[#6b7280] font-medium">Estado de pago</p>
              <span
                className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${
                  PAYMENT_STATUS_COLORS[total?.computed_payment_status || 'pending']
                }`}
              >
                {PAYMENT_STATUS_LABELS[total?.computed_payment_status || 'pending']}
              </span>
            </div>
          </div>

          {/* Products Section */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-[#111111] mb-3 uppercase tracking-wider">Productos</h3>

            {items.length === 0 ? (
              <div className={`${CARD_CLS} text-center py-4`}>
                <p className="text-sm text-[#6b7280]">Sin productos en este pedido</p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item, idx) => (
                  <div key={idx} className={CARD_CLS}>
                    <div className="grid gap-3 md:grid-cols-2">
                      {/* Left: Product info */}
                      <div className="space-y-2">
                        <div>
                          <p className="text-xs text-[#6b7280] font-medium">Producto</p>
                          <p className="text-sm font-semibold text-[#111111]">{item.product_name}</p>
                        </div>
                        {item.product_variant && (
                          <div>
                            <p className="text-xs text-[#6b7280] font-medium">Sabor / Variante</p>
                            <p className="text-sm text-[#111111]">{item.product_variant}</p>
                          </div>
                        )}
                        {item.product_size && (
                          <div>
                            <p className="text-xs text-[#6b7280] font-medium">Presentación</p>
                            <p className="text-sm text-[#111111]">{item.product_size}</p>
                          </div>
                        )}
                        {item.product_code && (
                          <div>
                            <p className="text-xs text-[#6b7280] font-medium">Código</p>
                            <p className="text-xs text-[#666666] font-mono">{item.product_code}</p>
                          </div>
                        )}
                      </div>

                      {/* Right: Pricing and totals */}
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-xs text-[#6b7280] font-medium">Cantidad</p>
                            <p className="text-sm font-semibold text-[#111111]">{item.quantity} piezas</p>
                          </div>
                          <div>
                            <p className="text-xs text-[#6b7280] font-medium">Precio unitario</p>
                            <p className="text-sm font-semibold text-[#111111]">
                              {fmtCurrency(item.unit_price)}
                            </p>
                          </div>
                        </div>
                        <div className="pt-2 border-t border-[#c49330]/30">
                          <p className="text-xs text-[#6b7280] font-medium">Subtotal</p>
                          <p className="text-base font-bold text-green-700">
                            {fmtCurrency(item.quantity * item.unit_price)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notas Section */}
          {order.notes && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-[#111111] mb-2 uppercase tracking-wider">
                Notas del vendedor
              </h3>
              <div className={CARD_CLS}>
                <p className="text-sm text-[#111111] whitespace-pre-wrap">{order.notes}</p>
              </div>
            </div>
          )}

          {/* Totals */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-[#111111] mb-3 uppercase tracking-wider">Totales</h3>
            <div className={`${CARD_CLS} bg-blue-50 border-blue-200`}>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4 text-sm">
                <div>
                  <p className="text-xs text-[#6b7280] font-medium">Total de piezas</p>
                  <p className="text-lg font-bold text-blue-700">{totalPieces}</p>
                </div>
                <div>
                  <p className="text-xs text-[#6b7280] font-medium">Total pedido</p>
                  <p className="text-lg font-bold text-[#111111]">
                    {fmtCurrency(total?.total_amount || 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#6b7280] font-medium">Total pagado</p>
                  <p className="text-lg font-bold text-green-700">
                    {fmtCurrency(total?.total_paid || 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#6b7280] font-medium">Saldo pendiente</p>
                  <p className="text-lg font-bold text-red-700">
                    {fmtCurrency(total?.pending_amount || 0)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Payments Section */}
          <div>
            <h3 className="text-sm font-semibold text-[#111111] mb-3 uppercase tracking-wider">Pagos</h3>

            {payments.length === 0 ? (
              <div className={CARD_CLS}>
                <p className="text-sm text-[#6b7280]">Sin pagos registrados</p>
              </div>
            ) : (
              <div className="space-y-2">
                {payments.map(payment => (
                  <div key={payment.id} className={CARD_CLS}>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-5 text-sm">
                      <div>
                        <p className="text-xs text-[#6b7280] font-medium">Fecha</p>
                        <p className="font-semibold text-[#111111]">{fmtDate(payment.payment_date)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#6b7280] font-medium">Monto</p>
                        <p className="font-bold text-green-700">{fmtCurrency(payment.amount || 0)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#6b7280] font-medium">Método</p>
                        <p className="text-[#111111]">
                          {PAYMENT_METHOD_LABELS[payment.payment_method as keyof typeof PAYMENT_METHOD_LABELS] ||
                            payment.payment_method}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-[#6b7280] font-medium">Referencia</p>
                        <p className="text-[#111111]">{payment.reference || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#6b7280] font-medium">Notas</p>
                        <p className="text-[#111111] truncate">{payment.notes || '—'}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#c49330] bg-[#fff8e6]">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-[#c49330] text-[#111111] font-semibold rounded hover:bg-[#f5e9c8]"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

export default WholesaleOrderDetailModal;
