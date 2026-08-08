import React, { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Eye } from 'lucide-react';
import { WholesaleOrder, WholesaleOrderTotal, fmtCurrency, fmtDate, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS, CARD_CLS } from './types';
import WholesaleOrderDetailModal from './WholesaleOrderDetailModal';

interface Props {
  partnerId: string;
  refreshKey?: number;
}

const WholesaleOrderHistory: React.FC<Props> = ({ partnerId, refreshKey = 0 }) => {
  const [orders, setOrders] = useState<Array<WholesaleOrder & { total?: WholesaleOrderTotal }>>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  useEffect(() => {
    loadOrders();
  }, [partnerId, refreshKey]);

  const loadOrders = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      // Load orders
      const { data: ordersData, error: ordersErr } = await supabase
        .from('wholesale_orders')
        .select('*')
        .eq('partner_id', partnerId)
        .order('order_date', { ascending: false });

      if (ordersErr) throw ordersErr;

      // Load totals
      const { data: totalsData, error: totalsErr } = await supabase
        .from('v_wholesale_order_totals')
        .select('*')
        .eq('partner_id', partnerId);

      if (totalsErr) throw totalsErr;

      // Merge
      const merged = (ordersData || []).map(order => ({
        ...order,
        total: (totalsData || []).find(t => t.wholesale_order_id === order.id),
      }));

      setOrders(merged);
    } catch (err) {
      console.error('Error loading orders:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className={`${CARD_CLS} text-center py-4`}>Cargando...</div>;
  }

  if (orders.length === 0) {
    return <div className={`${CARD_CLS} text-center py-4 text-[#6b7280]`}>Sin órdenes registradas</div>;
  }

  return (
    <div className="space-y-3">
      {orders.map(order => (
        <div key={order.id} className={CARD_CLS}>
          <div className="grid grid-cols-4 gap-3 text-sm items-center">
            <div>
              <p className="text-xs text-[#6b7280]">Folio</p>
              <p className="font-semibold text-[#111111]">{order.id.slice(0, 8)}</p>
            </div>
            <div>
              <p className="text-xs text-[#6b7280]">Fecha</p>
              <p className="font-semibold text-[#111111]">{fmtDate(order.order_date)}</p>
            </div>
            <div>
              <p className="text-xs text-[#6b7280]">Total</p>
              <p className="font-semibold text-[#111111]">{fmtCurrency(order.total?.total_amount || 0)}</p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-[#6b7280]">Pago</p>
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${
                    PAYMENT_STATUS_COLORS[order.total?.computed_payment_status || 'pending']
                  }`}
                >
                  {PAYMENT_STATUS_LABELS[order.total?.computed_payment_status || 'pending']}
                </span>
              </div>
              <button
                onClick={() => setSelectedOrderId(order.id)}
                className="flex items-center gap-1 px-2 py-1.5 bg-[#2d1a00] hover:bg-[#1a0f00] text-[#F6E7C1] rounded text-xs font-medium transition-colors"
                title="Ver detalle completo"
              >
                <Eye size={14} />
                Detalle
              </button>
            </div>
          </div>
        </div>
      ))}

      {selectedOrderId && (
        <WholesaleOrderDetailModal orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} />
      )}
    </div>
  );
};

export default WholesaleOrderHistory;
