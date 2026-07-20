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

interface Props {
  partnerId: string;
  partnerStatus: string;
  onClose: () => void;
  onSaved: () => void;
}

const PartnerPaymentForm: React.FC<Props> = ({ partnerId, partnerStatus, onClose, onSaved }) => {
  const [summary, setSummary] = useState<PartnerOperationalSummary | null>(null);
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current balance
  useEffect(() => {
    if (!supabase) return;
    (async () => {
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
    })();
  }, [partnerId]);

  const handleSubmit = async () => {
    if (!supabase) return;
    setError(null);

    // ── Status guard ─────────────────────────────────────────────────────────
    const NON_COMMERCIAL = ['prospecto', 'en_negociacion', 'rechazado'];
    if (NON_COMMERCIAL.includes(partnerStatus)) {
      setError('Este socio aún no está activo para movimientos comerciales.');
      return;
    }

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setError('Ingresa un monto válido mayor a cero.');
      return;
    }
    if (!date) {
      setError('Selecciona la fecha del pago.');
      return;
    }

    setSaving(true);

    const { error: insertErr } = await supabase
      .from('commercial_partner_payments')
      .insert({
        partner_id: partnerId,
        payment_date: date,
        amount: amountNum,
        payment_method: method,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        status: 'completed',
      });

    if (insertErr) {
      setError(insertErr.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    onSaved();
  };

  const balance = summary?.pending_balance ?? null;
  const amountNum = parseFloat(amount) || 0;
  const remaining = balance != null ? balance - amountNum : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-20 px-4 pb-8">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-2xl bg-[#D6A23A] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 pt-5 pb-3 border-b border-[#c49330]">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-[#4a2c0a]" />
            <h2 className="text-lg font-bold text-[#111111]">Registrar Pago</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#c49330]/50 text-[#374151] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 flex flex-col gap-4">
          {/* Balance summary */}
          {balance != null && (
            <div className={CARD_CLS}>
              <p className="text-xs text-[#6b5c40] mb-2 font-medium">Resumen de saldo</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-[#9a8060]">Total generado</p>
                  <p className="font-semibold text-[#111111]">{fmtCurrency(summary?.total_due)}</p>
                </div>
                <div>
                  <p className="text-xs text-[#9a8060]">Ya cobrado</p>
                  <p className="font-semibold text-green-700">{fmtCurrency(summary?.total_paid)}</p>
                </div>
                <div className="col-span-2 pt-2 border-t border-[#e8d5a0]">
                  <p className="text-xs text-[#9a8060]">Saldo pendiente</p>
                  <p className={`text-lg font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {fmtCurrency(balance)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Date */}
          <div>
            <label className={LABEL_CLS}>Fecha del pago *</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className={INPUT_CLS}
            />
          </div>

          {/* Amount */}
          <div>
            <label className={LABEL_CLS}>Monto recibido *</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              placeholder="0.00"
              onChange={e => setAmount(e.target.value)}
              className={INPUT_CLS}
            />
            {remaining != null && amountNum > 0 && (
              <p className={`text-xs mt-1 ${remaining <= 0 ? 'text-green-700' : 'text-[#6b5c40]'}`}>
                {remaining <= 0
                  ? `Saldo cubierto${remaining < 0 ? ` — adelanto de ${fmtCurrency(Math.abs(remaining))}` : ''}`
                  : `Quedará pendiente: ${fmtCurrency(remaining)}`}
              </p>
            )}
          </div>

          {/* Method */}
          <div>
            <label className={LABEL_CLS}>Método de pago *</label>
            <select
              value={method}
              onChange={e => setMethod(e.target.value)}
              className={`${SELECT_CLS} bg-white`}
            >
              {PAYMENT_METHODS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Reference */}
          <div>
            <label className={LABEL_CLS}>Referencia / Folio</label>
            <input
              type="text"
              value={reference}
              placeholder="Número de transferencia, folio, etc."
              onChange={e => setReference(e.target.value)}
              className={INPUT_CLS}
            />
          </div>

          {/* Notes */}
          <div>
            <label className={LABEL_CLS}>Notas</label>
            <textarea
              value={notes}
              rows={2}
              placeholder="Observaciones del pago..."
              onChange={e => setNotes(e.target.value)}
              className={`${INPUT_CLS} resize-none`}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-red-700 text-sm p-3 rounded-lg bg-red-50 border border-red-200">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1 pb-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl border-2 border-[#c49330] text-[#4a2c0a] font-semibold hover:bg-[#f5e9c8] transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-[#2d1a00] text-[#F6E7C1] font-semibold hover:bg-[#4a2c0a] transition-colors disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Registrar pago'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PartnerPaymentForm;
