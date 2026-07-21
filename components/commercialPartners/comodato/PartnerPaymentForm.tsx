import React, { useEffect, useState } from 'react';
import { X, AlertCircle, CreditCard } from 'lucide-react';
import { supabase } from '../../../supabase';
import {
  PartnerOperationalSummary,
  PAYMENT_METHODS,
  INPUT_CLS,
  SELECT_CLS,
  LABEL_CLS,
  CARD_CLS,
  todayISO,
  fmtCurrency,
} from './types';
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

const PartnerPaymentForm: React.FC<Props> = ({ partnerId, onClose, onSaved }) => {
  const [summary, setSummary] = useState<PartnerOperationalSummary | null>(null);
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('form');
  const [successData, setSuccessData] = useState<{ folio: string; amount: number } | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [selectedMovementId, setSelectedMovementId] = useState<string | null>(null);
  const [movements, setMovements] = useState<Array<{ id: string; date: string; pending: number; totalDue: number; totalPaid: number }>>([]);

  // Load current balance and movements
  useEffect(() => {
    if (!supabase) return;
    (async () => {
      try {
        // Load overall balance summary
        const { data } = await supabase!
          .from('v_commercial_partner_operational_summary')
          .select('pending_balance, total_due, total_paid')
          .eq('partner_id', partnerId)
          .maybeSingle();

        if (data) {
          setSummary(data as PartnerOperationalSummary);
        } else {
          // Fallback: sum from items table (more reliable)
          const [movItemRes, payRes] = await Promise.all([
            supabase!
              .from('commercial_partner_movement_items')
              .select('amount_due')
              .eq('partner_id', partnerId),
            supabase!
              .from('commercial_partner_payments')
              .select('amount')
              .eq('partner_id', partnerId),
          ]);
          const totalGenerated = (movItemRes.data ?? []).reduce((s: number, r: any) => s + (r.amount_due ?? 0), 0);
          const totalPaid = (payRes.data ?? []).reduce((s: number, r: any) => s + (r.amount ?? 0), 0);
          setSummary({ partner_id: partnerId, total_due: totalGenerated, total_paid: totalPaid, pending_balance: totalGenerated - totalPaid });
        }

        // Load settlement movements for comodato using SEPARATE QUERIES (no complex embeds)
        console.log('CURRENT PARTNER ID', partnerId);

        // Step 1: Get all settlement movements for this partner
        const { data: movData, error: movError } = await supabase!
          .from('commercial_partner_movements')
          .select('id, movement_date')
          .eq('partner_id', partnerId)
          .eq('movement_type', 'settlement')
          .eq('status', 'completed')
          .order('movement_date', { ascending: false });

        console.log('SETTLEMENT MOVEMENTS', movData);
        if (movError) {
          console.error('LOAD SETTLEMENT MOVEMENTS ERROR', movError);
          setError('No se pudieron cargar los adeudos. Revisa la conexión o los permisos.');
          setMovements([]);
          return;
        }

        if (!movData || movData.length === 0) {
          console.log('No settlement movements found for partner', partnerId);
          setMovements([]);
          return;
        }

        const movementIds = movData.map((m: any) => m.id);
        console.log('SETTLEMENT MOVEMENT IDS', movementIds);

        // Step 2: Get all items for these movements (with quantity_sold > 0)
        const { data: items, error: itemError } = await supabase!
          .from('commercial_partner_movement_items')
          .select('movement_id, amount_due, quantity_sold')
          .in('movement_id', movementIds)
          .gt('quantity_sold', 0);

        console.log('SETTLEMENT ITEMS', items);
        if (itemError) {
          console.error('LOAD SETTLEMENT ITEMS ERROR', itemError);
          setError('No se pudieron cargar los detalles de adeudos. Revisa los permisos.');
          setMovements([]);
          return;
        }

        // Step 3: Get all payments for these movements (completed or paid)
        const { data: payments, error: payError } = await supabase!
          .from('commercial_partner_payments')
          .select('movement_id, amount, status')
          .in('movement_id', movementIds)
          .in('status', ['completed', 'paid']);

        console.log('SETTLEMENT PAYMENTS', payments);
        if (payError) {
          console.error('LOAD SETTLEMENT PAYMENTS ERROR', payError);
          setError('No se pudieron cargar los pagos registrados. Revisa los permisos.');
          setMovements([]);
          return;
        }

        // Step 4: Calculate pending balance in TypeScript
        const movWithBalance = movData.map((mov: any) => {
          const movItems = items?.filter((item: any) => item.movement_id === mov.id) ?? [];
          const movPayments = payments?.filter((pay: any) => pay.movement_id === mov.id) ?? [];

          const totalDue = movItems.reduce((s: number, item: any) => s + (parseFloat(item.amount_due) || 0), 0);
          const totalPaid = movPayments.reduce((s: number, pay: any) => s + (parseFloat(pay.amount) || 0), 0);
          const pending = totalDue - totalPaid;

          return {
            id: mov.id,
            date: mov.movement_date,
            pending: pending,
            totalDue: totalDue,
            totalPaid: totalPaid,
          };
        });

        console.log('CALCULATED PENDING SETTLEMENTS', movWithBalance);

        // Filter to show only movements with pending balance > 0.005
        const pendingSettlements = movWithBalance.filter((m: any) => m.pending > 0.005);
        console.log('FILTERED PENDING SETTLEMENTS', pendingSettlements);
        setMovements(pendingSettlements);

        // Auto-select if only one pending settlement
        if (pendingSettlements.length === 1 && !selectedMovementId) {
          setSelectedMovementId(pendingSettlements[0].id);
          setAmount(pendingSettlements[0].pending.toFixed(2));
          console.log('AUTO-SELECTED SETTLEMENT', pendingSettlements[0]);
        }
      } catch (err) {
        console.error('Error loading movements:', err);
        setError('Error al cargar liquidaciones');
      }
    })();
  }, [partnerId]);

  // Handle payment submission using RPC workflow
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !date || !selectedMovementId) {
      setError('Completa todos los campos');
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Monto debe ser un número positivo');
      return;
    }

    if (summary && amountNum > (summary.pending_balance || 0)) {
      setError(`Monto no puede exceder saldo pendiente (${fmtCurrency(summary.pending_balance || 0)})`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Get current user
      const { data: { user } } = await supabase!.auth.getUser();
      if (!user) throw new Error('No authenticated user');

      // Step 1: Create payment verification request
      const createResult = await createPaymentVerificationRequest(
        'comodato',
        partnerId,
        date,
        amountNum,
        method as 'cash' | 'transfer',
        selectedMovementId,
        null,
        reference.trim() || null,
        notes.trim() || null
      );

      if (!createResult || !createResult.requestId) {
        throw new Error('Failed to create payment verification request');
      }

      // Step 2: Handle proof upload if transfer
      let proofPath = null;
      let proofMimeType = null;
      let proofFileName = null;
      let proofSizeBytes = null;

      if (method === 'transfer' && proofFile) {
        proofPath = await uploadPaymentProof(
          user.id,
          createResult.requestId,
          proofFile
        );
        proofMimeType = proofFile.type;
        proofFileName = proofFile.name;
        proofSizeBytes = proofFile.size;
      }

      // Step 3: Submit payment verification request
      await submitPaymentVerificationRequest(
        createResult.requestId,
        proofPath,
        proofFileName,
        proofMimeType,
        proofSizeBytes
      );

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
      console.error('Payment submission error:', err);
      setError(err instanceof Error ? err.message : 'Error al reportar pago');
    } finally {
      setSaving(false);
    }
  };

  // Render based on current step
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
              El pago ha sido reportado. Está en espera de revisión para liberar la comisión.
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

          <form onSubmit={handleSubmit} className="space-y-4">
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
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                className={INPUT_CLS}
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                PDF, JPG o PNG - Máx. 10 MB
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
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
                disabled={saving || !proofFile}
              >
                {saving ? 'Reportando...' : 'Reportar Cobro'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Reportar Cobro</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {summary && (
          <div className="mb-4 p-3 bg-blue-50 rounded-lg">
            <p className="text-sm text-gray-600">Saldo Pendiente</p>
            <p className="text-xl font-bold text-blue-600">{fmtCurrency(summary.pending_balance)}</p>
          </div>
        )}

        <form onSubmit={(e) => {
          if (method === 'transfer') {
            e.preventDefault();
            setStep('proof');
          } else {
            handleSubmit(e);
          }
        }} className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Settlement selector - improved UX */}
          {!error && movements.length === 0 ? (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-yellow-800 text-sm">
                No se encontró una liquidación pendiente para este socio.
              </p>
            </div>
          ) : !error && movements.length > 0 ? (
            <div>
              <label className={LABEL_CLS}>Adeudo que está pagando *</label>
              <select
                value={selectedMovementId || ''}
                onChange={(e) => {
                  const movId = e.target.value;
                  setSelectedMovementId(movId);
                  // Auto-fill amount based on selection
                  const selected = movements.find((m) => m.id === movId);
                  if (selected) {
                    setAmount(selected.pending.toFixed(2));
                  }
                }}
                className={SELECT_CLS}
                required
              >
                <option value="">Selecciona liquidación</option>
                {movements.map((m) => (
                  <option key={m.id} value={m.id}>
                    Liquidación del {new Date(m.date).toLocaleDateString('es-MX')} — saldo pendiente {fmtCurrency(m.pending)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Selecciona la liquidación que estás pagando
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Fecha *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={INPUT_CLS}
                required
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Monto *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={INPUT_CLS}
                placeholder="0.00"
                required
              />
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Método de Pago *</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className={SELECT_CLS}
              required
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_CLS}>Referencia</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className={INPUT_CLS}
              placeholder="Ej: Cheque #123, Referencia"
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={INPUT_CLS}
              rows={2}
              placeholder="Observaciones adicionales..."
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
              disabled={saving || movements.length === 0}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              disabled={saving || movements.length === 0}
            >
              {saving ? (
                <>
                  <span className="animate-spin">⏳</span>
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
};

export default PartnerPaymentForm;
