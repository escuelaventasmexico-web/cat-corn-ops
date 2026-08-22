import React, { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { Eye, Edit2, Trash2, MoreVertical } from 'lucide-react';
import { WholesaleOrder, WholesaleOrderTotal, fmtCurrency, fmtDate, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS, CARD_CLS } from './types';
import WholesaleOrderDetailModal from './WholesaleOrderDetailModal';
import WholesaleOrderEditModal from './WholesaleOrderEditModal';

interface Props {
  partnerId: string;
  refreshKey?: number;
  onOrderDeleted?: () => void;
}

interface ActionMenuState {
  orderId: string | null;
}

const WholesaleOrderHistory: React.FC<Props> = ({ partnerId, refreshKey = 0, onOrderDeleted }) => {
  const [orders, setOrders] = useState<Array<WholesaleOrder & { total?: WholesaleOrderTotal }>>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<ActionMenuState>({ orderId: null });
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const handleDeleteOrder = (orderId: string) => {
    setActionMenu({ orderId: null });
    setDeleteError(null);
    setDeletingOrderId(orderId);
  };

  const confirmDelete = async () => {
    if (!deletingOrderId || !supabase) return;

    setDeleteLoading(true);
    setDeleteError(null);

    try {
      const order = orders.find(o => o.id === deletingOrderId);
      if (!order) throw new Error('Pedido no encontrado');

      // 1. Check for wholesale_payments (completed/paid)
      const { data: paymentData, error: paymentErr } = await supabase
        .from('wholesale_payments')
        .select('id')
        .eq('wholesale_order_id', deletingOrderId)
        .in('status', ['completed', 'paid'])
        .limit(1);

      if (paymentErr) throw paymentErr;
      if (paymentData && paymentData.length > 0) {
        setDeleteError('No se puede eliminar este pedido porque ya tiene pagos registrados.');
        return;
      }

      // 2. Check for commission_events (available/paid)
      const { data: commissionData, error: commissionErr } = await supabase
        .from('commission_events')
        .select('id')
        .eq('source_type', 'wholesale_sale')
        .eq('source_id', deletingOrderId)
        .in('status', ['available', 'paid'])
        .limit(1);

      if (commissionErr) throw commissionErr;
      if (commissionData && commissionData.length > 0) {
        setDeleteError('No se puede eliminar este pedido porque ya tiene comisiones liberadas o pagadas.');
        return;
      }

      // 3. Cancel any pending commission events
      const { data: pendingCommissions, error: pendingErr } = await supabase
        .from('commission_events')
        .select('id')
        .eq('source_type', 'wholesale_sale')
        .eq('source_id', deletingOrderId)
        .eq('status', 'pending');

      if (pendingErr) throw pendingErr;

      if (pendingCommissions && pendingCommissions.length > 0) {
        for (const commission of pendingCommissions) {
          const { error: cancelErr } = await supabase
            .from('commission_events')
            .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
            .eq('id', commission.id);

          if (cancelErr) {
            console.error('Error cancelling commission:', {
              orderId: deletingOrderId,
              commissionId: commission.id,
              error: cancelErr,
            });
            throw new Error(`No se pudo cancelar la comisión: ${cancelErr.message}`);
          }
        }
      }

      // 4. Delete wholesale_order (items will cascade automatically via FK ON DELETE CASCADE)
      const { data: deletedOrders, error: orderErr } = await supabase
        .from('wholesale_orders')
        .delete()
        .eq('id', deletingOrderId)
        .select('id');

      if (orderErr) {
        console.error('Error deleting order:', {
          orderId: deletingOrderId,
          step: 'delete_order',
          error: orderErr,
        });
        throw new Error(`No se pudo eliminar el pedido: ${orderErr.message}`);
      }

      // CRITICAL: Verify that order was actually deleted
      if (!deletedOrders || deletedOrders.length === 0) {
        console.error('Order still exists after delete attempt:', {
          orderId: deletingOrderId,
          deletedRowCount: 0,
        });
        throw new Error('Supabase no eliminó la orden. Revisar RLS/permisos o si existe constraint.');
      }

      console.log('Order deleted:', { orderId: deletingOrderId, count: deletedOrders?.length || 0 });

      // 5. Verify order no longer exists
      const { data: verifyOrder, error: verifyErr } = await supabase
        .from('wholesale_orders')
        .select('id')
        .eq('id', deletingOrderId)
        .maybeSingle();

      if (verifyErr) {
        console.error('Error verifying order deletion:', {
          orderId: deletingOrderId,
          step: 'verify_deletion',
          error: verifyErr,
        });
        throw new Error(`No se pudo verificar la eliminación: ${verifyErr.message}`);
      }

      if (verifyOrder !== null) {
        console.error('Order still exists after deletion verification:', {
          orderId: deletingOrderId,
          orderData: verifyOrder,
        });
        throw new Error('El pedido aún existe en la base de datos después de la eliminación.');
      }

      console.log('Order verified as deleted:', { orderId: deletingOrderId });

      // 6. Optionally verify items were cascaded (should be 0 rows due to ON DELETE CASCADE)
      const { data: remainingItems, error: itemsVerifyErr } = await supabase
        .from('wholesale_order_items')
        .select('id')
        .eq('wholesale_order_id', deletingOrderId);

      if (itemsVerifyErr) {
        console.warn('Warning: Could not verify CASCADE deletion of items:', {
          orderId: deletingOrderId,
          error: itemsVerifyErr,
        });
      } else {
        console.log('Items cascaded deleted:', { orderId: deletingOrderId, remainingCount: remainingItems?.length || 0 });
      }

      // 7. ONLY NOW remove from UI (after confirming Supabase success)
      setOrders(prev => prev.filter(o => o.id !== deletingOrderId));
      setDeletingOrderId(null);

      // 8. Notify parent to refresh summary totals
      if (onOrderDeleted) {
        onOrderDeleted();
      }

    } catch (err: any) {
      console.error('Error deleting order - TRANSACTION FAILED:', {
        orderId: deletingOrderId,
        error: err.message,
        fullError: err,
      });
      setDeleteError(err.message || 'No se pudo eliminar el pedido. La información no fue modificada.');
    } finally {
      setDeleteLoading(false);
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
                    <button
                      onClick={() => handleEditOrder(order.id)}
                      className="block w-full text-left px-3 py-2 text-xs text-[#F6E7C1] hover:bg-[#1a0f00] flex items-center gap-2"
                    >
                      <Edit2 size={12} />
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeleteOrder(order.id)}
                      className="block w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-[#1a0f00] flex items-center gap-2 border-t border-[#5a3a1a]"
                    >
                      <Trash2 size={12} />
                      Eliminar
                    </button>
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

      {/* Delete Confirmation Modal */}
      {deletingOrderId && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#D6A23A] border border-[#a87820] rounded-lg max-w-sm w-full p-6 shadow-xl">
            <h3 className="text-lg font-bold text-[#111111] mb-4">
              ¿Eliminar este pedido?
            </h3>
            
            {deleteError && (
              <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-sm text-red-800">
                {deleteError}
              </div>
            )}

            {!deleteError && (
              <div className="mb-6 space-y-2 text-sm text-[#374151]">
                <div>
                  <p className="text-xs font-semibold text-[#6b7280]">Folio</p>
                  <p>{orders.find(o => o.id === deletingOrderId)?.id.slice(0, 8)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#6b7280]">Fecha</p>
                  <p>{fmtDate(orders.find(o => o.id === deletingOrderId)?.order_date)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#6b7280]">Total</p>
                  <p>{fmtCurrency(orders.find(o => o.id === deletingOrderId)?.total?.total_amount || 0)}</p>
                </div>
                <p className="text-xs italic text-[#6b7280] mt-3">
                  Esta acción eliminará el pedido y sus productos asociados de forma permanente.
                </p>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setDeletingOrderId(null);
                  setDeleteError(null);
                }}
                disabled={deleteLoading}
                className="px-4 py-2 bg-[#6b7280] hover:bg-[#4b5563] text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteLoading || !!deleteError}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
              >
                {deleteLoading ? 'Eliminando...' : 'Eliminar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WholesaleOrderHistory;
