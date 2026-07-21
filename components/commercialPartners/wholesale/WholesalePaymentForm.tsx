import React, { useEffect, useState } from 'react';
import { supabase } from '../../../supabase';
import { CreditCard, Loader2, X, AlertCircle } from 'lucide-react';
import { WholesaleSummary, fmtCurrency, INPUT_CLS, SELECT_CLS, LABEL_CLS, CARD_CLS, BUTTON_PRIMARY_CLS, todayISO } from './types';
import {
  createPaymentVerificationRequest,
  submitPaymentVerificationRequest,
  uploadPaymentProof,
} from '../../../lib/paymentVerificationRpcs';

interface Props {
  partnerId: string;
  onClose: () => void;
  onSaved: () => void;
}

type Step = 'form' | 'proof' | 'success';

interface PendingOrder {
  id: string;
  order_folio: string;
  pending_amount: number;
}

const WholesalePaymentForm: React.FC<Props> = ({ partnerId, onClose, onSaved }) => {
  const [summary, setSummary] = useState<WholesaleSummary | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('form');
  const [successData, setSuccessData] = useState<{ folio: string; amount: number } | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderConfirmation, setOrderConfirmation] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      // Get current user role
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        setUserRole(profile?.role || null);
      }

      // Load summary
      const { data: summaryData, error: summaryError } = await supabase
        .from('v_commercial_partner_wholesale_summary')
        .select('*')
        .eq('partner_id', partnerId)
        .single();

      if (summaryError && summaryError.code !== 'PGRST116') throw summaryError;
      if (summaryData) setSummary(summaryData as WholesaleSummary);

      // Load pending orders from v_wholesale_order_totals
      const { data: ordersData, error: ordersError } = await supabase
        .from('v_wholesale_order_totals')
        .select('wholesale_order_id, pending_amount')
        .eq('partner_id', partnerId)
        .gt('pending_amount', 0.005)
        .order('pending_amount', { ascending: false });

      if (ordersError && ordersError.code !== 'PGRST116') throw ordersError;

      // Fetch order folios
      if (ordersData && ordersData.length > 0) {
        const orderIds = ordersData.map(o => o.wholesale_order_id);
        const { data: orderDetails } = await supabase
          .from('wholesale_orders')
          .select('id, order_folio: id')
          .in('id', orderIds);

        const ordersWithFolios: PendingOrder[] = ordersData.map(order => {
          const detail = orderDetails?.find(d => d.id === order.wholesale_order_id);
          return {
            id: order.wholesale_order_id,
            order_folio: detail?.id ? detail.id.slice(0, 8) : order.wholesale_order_id.slice(0, 8),
            pending_amount: order.pending_amount,
          };
        });

        console.log('WHOLESALE PENDING ORDERS', ordersWithFolios);
        setPendingOrders(ordersWithFolios);

        // Auto-select if only one pending order
        if (ordersWithFolios.length === 1) {
          setSelectedOrderId(ordersWithFolios[0].id);
          setAmount(ordersWithFolios[0].pending_amount.toFixed(2));
        }
      } else {
        setPendingOrders([]);
      }
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Error al cargar datos. Revisa la conexión.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setError('Ingresa un monto válido mayor a cero.');
      return;
    }

    if (!supabase) {
      setError('Supabase no configurado');
      return;
    }

    // Vendor flow: use verification system
    if (userRole === 'socios_comerciales') {
      if (!selectedOrderId) {
        setError('Selecciona una orden');
        return;
      }

      setSaving(true);
      setError(null);

      try {
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('No authenticated user');

        // Step 1: Create payment verification request
        const createResult = await createPaymentVerificationRequest(
          'mayoreo',
          partnerId,
          paymentDate,
          amountNum,
          method as 'cash' | 'transfer',
          null,
          selectedOrderId,
          reference.trim() || null,
          notes.trim() || null
        );

        if (!createResult || !createResult.requestId) {
          throw new Error('Failed to create payment verification request');
        }

        console.log('WHOLESALE VERIFICATION CREATED', createResult);

        // Step 2: Handle proof upload if transfer
        let proofPath = null;
        let proofMimeType = null;
        let proofFileName = null;
        let proofSizeBytes = null;

        if (method === 'transfer' && proofFile) {
          try {
            proofPath = await uploadPaymentProof(
              user.id,
              createResult.requestId,
              proofFile
            );
            proofMimeType = proofFile.type;
            proofFileName = proofFile.name;
            proofSizeBytes = proofFile.size;
          } catch (uploadErr) {
            console.error('WHOLESALE PROOF UPLOAD ERROR', uploadErr);
            setError('No se pudo cargar el comprobante. Intenta nuevamente.');
            setSaving(false);
            return;
          }
        }

        // Step 3: Submit payment verification request
        const submitResult = await submitPaymentVerificationRequest(
          createResult.requestId,
          proofPath,
          proofFileName,
          proofMimeType,
          proofSizeBytes
        );

        if (!submitResult) {
          throw new Error('Failed to submit payment verification request');
        }

        console.log('WHOLESALE VERIFICATION SUBMITTED', submitResult);

        // Success!
        setSuccessData({
          folio: createResult.folio,
          amount: amountNum,
        });
        setStep('success');

        // Close after 3 seconds and refresh
        setTimeout(() => {
          onSaved();
          onClose();
        }, 3000);
      } catch (err) {
        console.error('WHOLESALE VERIFICATION CREATE ERROR', err);
        setError(err instanceof Error ? err.message : 'Error al reportar pago');
      } finally {
        setSaving(false);
      }
      return;
    }

    // Admin flow: direct insert (keep existing behavior)
    setSaving(true);
    setError(null);

    try {
      const { error: insertErr } = await supabase
        .from('wholesale_payments')
        .insert({
          partner_id: partnerId,
          wholesale_order_id: selectedOrderId,
          amount: amountNum,
          payment_method: method,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
          payment_date: paymentDate,
        });

      if (insertErr) throw insertErr;
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Error al registrar pago');
    } finally {
      setSaving(false);
    }
  };

  const amountNum = parseFloat(amount) || 0;
  const pending = summary?.pending_balance ?? 0;
  const remaining = pending - amountNum;

  // Success screen for vendor
  if (step === 'success' && successData) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg max-w-sm w-full p-6">
          <div className="text-center">
            <div className="mb-4 inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full">
              <CreditCard className="w-8 h-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-green-600 mb-2">
              ¡Cobro Reportado!
            </h2>
            <p className="text-gray-700 mb-4">
              El cobro de {fmtCurrency(successData.amount)} fue enviado para revisión administrativa. La comisión permanecerá pendiente hasta que Cat Corn confirme el ingreso.
            </p>
            <div className={CARD_CLS}>
              <div className="text-sm text-gray-600">Folio</div>
              <div className="font-mono font-bold text-lg">{successData.folio}</div>
              <div className="text-sm text-gray-600 mt-2">Monto</div>
              <div className="font-bold text-lg">{fmtCurrency(successData.amount)}</div>
              <div className="text-sm text-gray-600 mt-2">Estado</div>
              <div className="font-semibold text-yellow-600">Pendiente de revisión</div>
            </div>
            <p className="text-xs text-gray-500 mt-4">
              El saldo y comisión se actualizarán cuando se confirme el cobro.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Proof upload screen for vendor (transfer only)
  if (step === 'proof') {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg max-w-sm w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Comprobante de Transferencia</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label className={LABEL_CLS}>Comprobante de Transferencia *</label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                className={INPUT_CLS}
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                PDF, JPG, PNG o WEBP - Máx. 10 MB
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep('form')}
                className="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
                disabled={saving}
              >
                Atrás
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                disabled={saving || !proofFile}
              >
                {saving ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Reportando...
                  </>
                ) : (
                  'Reportar Cobro'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Main form
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-20 px-4 pb-8 overflow-y-auto">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-[#D6A23A] shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex justify-between items-center px-6 pt-5 pb-3 border-b border-[#c49330]">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-[#4a2c0a]" />
            <h2 className="text-lg font-bold text-[#111111]">
              {userRole === 'socios_comerciales' ? 'Reportar Cobro Mayoreo' : 'Registrar Pago Mayoreo'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#c49330]/50 text-[#374151]">
            ✕
          </button>
        </div>

        <div className="px-6 py-4">
          {error && <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg text-red-800 text-sm">{error}</div>}

          {loading ? (
            <div className="text-center py-4">
              <Loader2 className="animate-spin mx-auto" size={24} />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Info message for vendor */}
              {userRole === 'socios_comerciales' && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
                  El cobro será enviado a revisión administrativa. El saldo y tu comisión se actualizarán cuando Cat Corn confirme que recibió el dinero.
                </div>
              )}

              {summary && (
                <div className={CARD_CLS}>
                  <p className="text-xs text-[#6b5c40] mb-2 font-medium">Resumen Mayoreo</p>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#9a8060]">Total Comprado:</span>
                      <span className="font-semibold" style={{ color: '#111111' }}>{fmtCurrency(summary.total_purchased || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#9a8060]">Total Pagado:</span>
                      <span className="font-semibold text-green-700" style={{ color: '#15803d' }}>{fmtCurrency(summary.total_paid || 0)}</span>
                    </div>
                    <div className="pt-1 border-t border-[#e8d5a0] flex justify-between">
                      <span className="text-[#9a8060] font-semibold">Saldo Pendiente:</span>
                      <span className={`text-lg font-bold ${pending > 0 ? 'text-red-600' : 'text-green-600'}`} style={{ color: pending > 0 ? '#dc2626' : '#16a34a' }}>
                        {fmtCurrency(pending)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Order selector for vendor or admin */}
              {(userRole === 'socios_comerciales' || userRole === 'admin') && pendingOrders.length > 0 && (
                <div>
                  <label className={LABEL_CLS}>Orden que está pagando *</label>
                  <select
                    value={selectedOrderId || ''}
                    onChange={(e) => {
                      const orderId = e.target.value;
                      setSelectedOrderId(orderId);
                      const order = pendingOrders.find(o => o.id === orderId);
                      if (order) {
                        setAmount(order.pending_amount.toFixed(2));
                      }
                    }}
                    className={SELECT_CLS}
                    required
                  >
                    <option value="">Selecciona orden</option>
                    {pendingOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        Orden {o.order_folio} — saldo pendiente {fmtCurrency(o.pending_amount)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Selecciona la orden que estás pagando
                  </p>
                </div>
              )}

              {pendingOrders.length === 0 && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-yellow-800 text-sm">
                    No hay órdenes con saldo pendiente.
                  </p>
                </div>
              )}

              <div>
                <label className={LABEL_CLS}>Monto *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className={INPUT_CLS}
                  placeholder="0.00"
                  style={{ color: '#111111', WebkitTextFillColor: '#111111', backgroundColor: '#ffffff' }}
                />
              </div>

              <div>
                <label className={LABEL_CLS}>Método de Pago *</label>
                <select 
                  value={method} 
                  onChange={e => setMethod(e.target.value)} 
                  className={SELECT_CLS}
                  style={{ color: '#111111', WebkitTextFillColor: '#111111', backgroundColor: '#ffffff' }}
                >
                  <option value="cash" style={{ color: '#111111', backgroundColor: '#ffffff' }}>Efectivo</option>
                  <option value="transfer" style={{ color: '#111111', backgroundColor: '#ffffff' }}>Transferencia</option>
                  <option value="card" style={{ color: '#111111', backgroundColor: '#ffffff' }}>Tarjeta</option>
                  <option value="other" style={{ color: '#111111', backgroundColor: '#ffffff' }}>Otro</option>
                </select>
              </div>

              <div>
                <label className={LABEL_CLS}>Referencia (opcional)</label>
                <input
                  type="text"
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                  className={INPUT_CLS}
                  placeholder="Folio de comprobante, referencia bancaria, etc."
                  style={{ color: '#111111', WebkitTextFillColor: '#111111', backgroundColor: '#ffffff' }}
                />
              </div>

              <div>
                <label className={LABEL_CLS}>Fecha de Pago *</label>
                <input 
                  type="date" 
                  value={paymentDate} 
                  onChange={e => setPaymentDate(e.target.value)} 
                  className={INPUT_CLS}
                  style={{ color: '#111111', WebkitTextFillColor: '#111111', backgroundColor: '#ffffff' }}
                />
              </div>

              <div>
                <label className={LABEL_CLS}>Notas (opcional)</label>
                <textarea 
                  value={notes} 
                  onChange={e => setNotes(e.target.value)} 
                  className={INPUT_CLS} 
                  rows={2} 
                  placeholder="Notas internas..."
                  style={{ color: '#111111', WebkitTextFillColor: '#111111', backgroundColor: '#ffffff' }}
                />
              </div>

              {/* Cash confirmation for vendor */}
              {userRole === 'socios_comerciales' && method === 'cash' && (
                <label className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={orderConfirmation}
                    onChange={(e) => setOrderConfirmation(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-green-700">
                    Confirmo que el cliente entregó este monto en efectivo
                  </span>
                </label>
              )}

              {amountNum > 0 && (
                <div className={`${CARD_CLS} ${remaining >= 0 ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
                  <p className="text-xs text-[#6b5c40] mb-2">Resumen del pago</p>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span style={{ color: '#111111' }}>Monto a pagar:</span>
                      <span className="font-semibold" style={{ color: '#111111' }}>{fmtCurrency(amountNum)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: '#111111' }}>Saldo actual:</span>
                      <span className="font-semibold" style={{ color: '#111111' }}>{fmtCurrency(pending)}</span>
                    </div>
                    <div className="pt-1 border-t border-[#e8d5a0] flex justify-between">
                      <span className="font-semibold" style={{ color: '#111111' }}>Saldo después del pago:</span>
                      <span className={`font-bold ${remaining >= 0 ? 'text-green-600' : 'text-red-600'}`} style={{ color: remaining >= 0 ? '#16a34a' : '#dc2626' }}>{fmtCurrency(remaining)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#c49330] bg-[#fff8e6]">
          <button onClick={onClose} className="px-4 py-2 bg-white border border-[#c49330] text-[#111111] font-semibold rounded hover:bg-[#f5e9c8]">
            Cancelar
          </button>
          <button
            onClick={() => {
              // For vendor: check if cash (needs confirmation) or transfer (needs to upload proof)
              if (userRole === 'socios_comerciales') {
                if (method === 'transfer') {
                  setStep('proof');
                } else if (method === 'cash' && !orderConfirmation) {
                  setError('Debes confirmar que recibiste el efectivo');
                } else {
                  handleSave();
                }
              } else {
                // Admin: direct save
                handleSave();
              }
            }}
            disabled={!amount || parseFloat(amount) <= 0 || saving || pendingOrders.length === 0}
            className={BUTTON_PRIMARY_CLS}
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {userRole === 'socios_comerciales' ? 'Reportando...' : 'Registrando...'}
              </>
            ) : (
              userRole === 'socios_comerciales' ? 'Reportar Cobro' : 'Registrar Pago'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WholesalePaymentForm;
