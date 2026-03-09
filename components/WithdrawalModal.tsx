import React, { useState } from 'react';
import { X, ArrowDownCircle, DollarSign } from 'lucide-react';
import { registerWithdrawal } from '../lib/cashRegister';

interface Props {
  sessionId: string;
  currentCash: number;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Modal to register a cash withdrawal from the open register.
 */
export const WithdrawalModal: React.FC<Props> = ({ sessionId, currentCash, onClose, onSuccess }) => {
  const [amount, setAmount] = useState<number>(0);
  const [reason, setReason] = useState('Retiro de resguardo');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (amount <= 0) {
      setError('El monto debe ser mayor a $0');
      return;
    }
    if (amount > currentCash) {
      setError(`El monto ($${amount}) excede el efectivo en caja ($${currentCash.toFixed(0)})`);
      return;
    }
    if (!reason.trim()) {
      setError('Ingresa un motivo para el retiro');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await registerWithdrawal(sessionId, amount, reason.trim(), notes.trim() || undefined);
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-cc-surface border border-white/10 rounded-xl p-6 w-80 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-5">
          <h3 className="font-bold text-cc-cream flex items-center gap-2">
            <ArrowDownCircle size={18} className="text-orange-400" />
            Registrar Retiro
          </h3>
          <button onClick={onClose} className="text-cc-text-muted hover:text-cc-text-main transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Current cash info */}
        <div className="mb-4 px-3 py-2 bg-black/30 rounded-lg border border-white/5 flex justify-between items-center text-xs">
          <span className="text-cc-text-muted">Efectivo en caja</span>
          <span className="font-bold text-cc-primary">${currentCash.toFixed(0)}</span>
        </div>

        <div className="space-y-4">
          {/* Amount */}
          <div>
            <label className="block text-xs font-medium text-cc-text-muted mb-1.5">
              Monto del retiro
            </label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cc-text-muted" />
              <input
                type="number"
                min="0"
                step="50"
                value={amount || ''}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                className="w-full bg-black/30 border border-white/10 rounded-lg pl-8 pr-4 py-2.5 text-lg font-bold text-cc-cream focus:ring-2 focus:ring-orange-400/50 outline-none text-right"
                placeholder="0"
                autoFocus
              />
            </div>
            {/* Quick amounts */}
            <div className="flex gap-1.5 mt-2">
              {[200, 500, 800].map((amt) => (
                <button
                  key={amt}
                  onClick={() => setAmount(amt)}
                  className={`flex-1 py-1 text-xs font-bold rounded-md border transition-all ${
                    amount === amt
                      ? 'bg-orange-400/20 border-orange-400 text-orange-400'
                      : 'bg-white/5 border-white/10 text-cc-text-muted hover:bg-white/10'
                  }`}
                >
                  ${amt}
                </button>
              ))}
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-medium text-cc-text-muted mb-1.5">Motivo</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-cream placeholder-gray-500 focus:ring-1 focus:ring-orange-400/50 outline-none"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-cc-text-muted mb-1.5">
              Notas <span className="text-cc-text-muted/50">(opcional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Enviado a oficina"
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-cream placeholder-gray-500 focus:ring-1 focus:ring-orange-400/50 outline-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-500/15 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={saving || amount <= 0}
            className="w-full py-2.5 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 font-bold text-sm rounded-lg border border-orange-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? 'Registrando…' : (
              <>
                <ArrowDownCircle size={16} /> Registrar Retiro
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
