import React, { useState } from 'react';
import { supabase } from '../../../supabase';
import { CreditCard, Loader2 } from 'lucide-react';
import { WholesaleSummary, fmtCurrency, INPUT_CLS, SELECT_CLS, LABEL_CLS, CARD_CLS, BUTTON_PRIMARY_CLS, todayISO } from './types';

interface Props {
  partnerId: string;
  onClose: () => void;
  onSaved: () => void;
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

  React.useEffect(() => {
    loadBalance();
  }, []);

  const loadBalance = async () => {
    if (!supabase) return;
    try {
      const { data, error: queryError } = await supabase
        .from('v_commercial_partner_wholesale_summary')
        .select('*')
        .eq('partner_id', partnerId)
        .single();

      if (queryError) throw queryError;
      setSummary(data as WholesaleSummary);
    } catch (err: any) {
      setError(err.message || 'Error al cargar saldo');
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

    setSaving(true);
    setError(null);

    try {
      const { error: insertErr } = await supabase
        .from('wholesale_payments')
        .insert({
          partner_id: partnerId,
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

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-20 px-4 pb-8 overflow-y-auto">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-[#D6A23A] shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex justify-between items-center px-6 pt-5 pb-3 border-b border-[#c49330]">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-[#4a2c0a]" />
            <h2 className="text-lg font-bold text-[#111111]">Registrar Pago Mayoreo</h2>
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
            onClick={handleSave}
            disabled={!amount || parseFloat(amount) <= 0 || saving}
            className={BUTTON_PRIMARY_CLS}
          >
            {saving ? 'Registrando...' : 'Registrar Pago'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WholesalePaymentForm;
