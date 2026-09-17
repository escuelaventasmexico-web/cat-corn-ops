import React, { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Eye, Edit2, Trash2, MoreVertical } from 'lucide-react';
import { WholesaleOrder, WholesaleOrderTotal, fmtCurrency, fmtDate, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS, CARD_CLS } from './types';
import WholesaleOrderDetailModal from './WholesaleOrderDetailModal';
import WholesaleOrderEditModal from './WholesaleOrderEditModal';
import { useAuth } from '../../../contexts/AuthContext';
import { verifyFinancialAccessPassword } from '../../../lib/financialAccessPassword';
import { adminCancelWholesaleOrder } from '../../../services/commercialDeliveryUnitService';

interface Props {
  partnerId: string;
  refreshKey?: number;
  onOrderCancelled?: () => void;
}

interface ActionMenuState {
  orderId: string | null;
}

const WholesaleOrderHistory: React.FC<Props> = ({ partnerId, refreshKey = 0, onOrderCancelled }) => {
  const { isAdmin } = useAuth();
  const [orders, setOrders] = useState<Array<WholesaleOrder & { total?: WholesaleOrderTotal }>>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<ActionMenuState>({ orderId: null });
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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

  const handleEditOrder = (orderId: string) => {
    setActionMenu({ orderId: null });
    setEditingOrderId(orderId);
  };

  const closeCancelModal = () => {
    setCancellingOrderId(null);
    setCancelReason('');
    setAdminPassword('');
    setCancelConfirmed(false);
    setCancelError(null);
  };

  const handleCancelOrder = (orderId: string) => {
    setActionMenu({ orderId: null });
    setSuccessMessage(null);
    setCancelError(null);
    setCancellingOrderId(orderId);
  };

  const confirmCancellation = async () => {
    if (!cancellingOrderId || !isAdmin || cancelReason.trim().length < 10 || !adminPassword || !cancelConfirmed) return;

    setCancelLoading(true);
    setCancelError(null);
    try {
      // Keep the existing secondary-password UX, then send the same password
      // to the RPC so the server verifies it again in the atomic transaction.
      const password = adminPassword;
      const verification = await verifyFinancialAccessPassword(password);
      if (verification.status !== 'verified') {
        throw new Error(verification.status === 'invalid'
          ? 'Contraseña administrativa incorrecta.'
          : verification.errorMessage);
      }

      await adminCancelWholesaleOrder({
        orderId: cancellingOrderId,
        reason: cancelReason,
        adminPassword: password,
      });

      closeCancelModal();
      await loadOrders();
      onOrderCancelled?.();
      setSuccessMessage('El pedido fue cancelado y sus etiquetas fueron anuladas.');
    } catch (err: any) {
      setAdminPassword('');
      setCancelError(err.message || 'No se pudo cancelar el pedido. La información no fue modificada.');
    } finally {
      setAdminPassword('');
      setCancelLoading(false);
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
      {successMessage && (
        <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          {successMessage}
        </div>
      )}
      {orders.map(order => (
        <div key={order.id} className={CARD_CLS}>
          <div className="grid grid-cols-5 gap-3 text-sm items-center">
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
            <div>
              <p className="text-xs text-[#6b7280]">Estado</p>
              <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium border ${
                order.order_status === 'cancelled'
                  ? 'border-red-300 bg-red-50 text-red-700'
                  : 'border-amber-300 bg-amber-50 text-amber-800'
              }`}>
                {order.order_status === 'cancelled' ? 'Cancelado' : order.order_status === 'delivered' ? 'Entregado' : 'Pendiente'}
              </span>
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
              
              {/* Action buttons menu */}
              <div className="relative">
                <button
                  onClick={() => setActionMenu(prev => ({
                    orderId: prev.orderId === order.id ? null : order.id
                  }))}
                  className="flex items-center gap-1 px-2 py-1.5 bg-[#2d1a00] hover:bg-[#1a0f00] text-[#F6E7C1] rounded text-xs font-medium transition-colors"
                  title="Acciones"
                >
                  <MoreVertical size={14} />
                </button>
                
                {/* Dropdown menu */}
                {actionMenu.orderId === order.id && (
                  <div className="absolute right-0 top-full mt-1 bg-[#2d1a00] border border-[#5a3a1a] rounded shadow-lg z-50 min-w-32">
                    <button
                      onClick={() => {
                        setSelectedOrderId(order.id);
                        setActionMenu({ orderId: null });
                      }}
                      className="block w-full text-left px-3 py-2 text-xs text-[#F6E7C1] hover:bg-[#1a0f00] flex items-center gap-2"
                    >
                      <Eye size={12} />
                      Detalle
                    </button>
                    {order.order_status !== 'cancelled' && <button
                      onClick={() => handleEditOrder(order.id)}
                      className="block w-full text-left px-3 py-2 text-xs text-[#F6E7C1] hover:bg-[#1a0f00] flex items-center gap-2"
                    >
                      <Edit2 size={12} />
                      Editar
                    </button>}
                    {isAdmin && order.order_status !== 'cancelled' && <button
                      onClick={() => handleCancelOrder(order.id)}
                      className="block w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-[#1a0f00] flex items-center gap-2 border-t border-[#5a3a1a]"
                    >
                      <Trash2 size={12} />
                      Cancelar pedido
                    </button>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Detail Modal */}
      {selectedOrderId && (
        <WholesaleOrderDetailModal orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} />
      )}

      {/* Edit Modal */}
      {editingOrderId && (
        <WholesaleOrderEditModal 
          orderId={editingOrderId}
          partnerId={partnerId}
          onClose={() => setEditingOrderId(null)}
          onSaved={() => {
            setEditingOrderId(null);
            loadOrders();
          }}
        />
      )}

      {/* Administrative cancellation modal: the order and labels stay auditable. */}
      {cancellingOrderId && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#D6A23A] border border-[#a87820] rounded-lg max-w-md w-full p-6 shadow-xl">
            <h3 className="text-lg font-bold text-[#111111] mb-4">
              ¿Cancelar este pedido?
            </h3>
            
            {cancelError && (
              <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-sm text-red-800">
                {cancelError}
              </div>
            )}

            <div className="mb-5 space-y-3 text-sm text-[#374151]">
              <div>
                <p className="text-xs font-semibold text-[#6b7280]">Folio</p>
                <p>{orders.find(o => o.id === cancellingOrderId)?.id.slice(0, 8)}</p>
              </div>
              <p className="rounded bg-red-50 p-3 text-xs text-red-900">
                El pedido, sus productos y sus etiquetas se conservarán para auditoría. La cancelación sólo procederá si el servidor confirma que no existen pagos, liberaciones ni consecuencias posteriores.
              </p>
              <div>
                <label className="block text-xs font-semibold text-[#6b7280]">Motivo obligatorio (mínimo 10 caracteres)</label>
                <textarea
                  value={cancelReason}
                  onChange={event => setCancelReason(event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded border border-[#a87820] bg-white p-2 text-sm text-[#111111]"
                  placeholder="Describe el registro por error…"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#6b7280]">Contraseña administrativa</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={adminPassword}
                  onChange={event => setAdminPassword(event.target.value)}
                  className="mt-1 w-full rounded border border-[#a87820] bg-white p-2 text-sm text-[#111111]"
                />
              </div>
              <label className="flex items-start gap-2 text-xs text-[#4a2c0a]">
                <input type="checkbox" checked={cancelConfirmed} onChange={event => setCancelConfirmed(event.target.checked)} />
                Confirmo la cancelación administrativa y su auditoría permanente.
              </label>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={closeCancelModal}
                disabled={cancelLoading}
                className="px-4 py-2 bg-[#6b7280] hover:bg-[#4b5563] text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => void confirmCancellation()}
                disabled={cancelLoading || !cancelConfirmed || cancelReason.trim().length < 10 || !adminPassword}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
              >
                {cancelLoading ? 'Cancelando…' : 'Cancelar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WholesaleOrderHistory;
