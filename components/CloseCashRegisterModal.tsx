import React, { useState } from 'react';
import { X, Lock, DollarSign, Banknote, CreditCard, ArrowDownCircle, CheckCircle, AlertTriangle } from 'lucide-react';
import { closeCashRegister } from '../lib/cashRegister';
import type { CashRegisterStatus, CloseResult } from '../lib/cashRegister';

interface Props {
  status: CashRegisterStatus;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Modal to close the current cash register session.
 * Shows a pre-close summary, asks for counted cash, then shows the result.
 */
export const CloseCashRegisterModal: React.FC<Props> = ({ status, onClose, onSuccess }) => {
  const [countedCash, setCountedCash] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);

  // Expected = cash sales + card sales − withdrawals (fondo NOT included)
  const expectedCash = status.cash_sales_total + status.card_sales_total - status.withdrawals_total;

  const handleSubmit = async () => {
    if (!status.session_id) return;
    setSaving(true);
    setError(null);
    try {
      const result = await closeCashRegister(
        status.session_id,
        countedCash,
        notes.trim() || undefined,
      );
      // Always use our local expectedCash — the RPC may still have the old
      // formula that includes opening_cash (fondo) in expected.
      const finalResult: CloseResult = {
        expected_cash: expectedCash,
        counted_cash: result.counted_cash || countedCash,
        difference: countedCash - expectedCash,
      };
      setCloseResult(finalResult);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  // ── Post-close result screen ─────────────────────────────────────────────
  if (closeResult) {
    const diff = closeResult.difference;
    const isMatch = Math.abs(diff) < 0.5;
    const isSurplus = diff > 0.5;

    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onSuccess}>
        <div className="bg-cc-surface border border-white/10 rounded-xl p-6 w-96 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="text-center mb-5">
            {isMatch ? (
              <CheckCircle size={48} className="mx-auto text-green-400 mb-2" />
            ) : (
              <AlertTriangle size={48} className="mx-auto text-yellow-400 mb-2" />
            )}
            <h3 className="font-bold text-xl text-cc-cream">Caja Cerrada</h3>
          </div>

          <div className="space-y-3 mb-6">
            <div className="flex justify-between items-center px-3 py-2.5 bg-black/30 rounded-lg border border-white/5">
              <span className="text-sm text-cc-text-muted">Efectivo esperado</span>
              <span className="text-lg font-bold text-cc-cream">${closeResult.expected_cash.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center px-3 py-2.5 bg-black/30 rounded-lg border border-white/5">
              <span className="text-sm text-cc-text-muted">Efectivo contado</span>
              <span className="text-lg font-bold text-cc-primary">${closeResult.counted_cash.toFixed(2)}</span>
            </div>
            <div className={`flex justify-between items-center px-3 py-2.5 rounded-lg border ${
              isMatch
                ? 'bg-green-500/10 border-green-500/30'
                : isSurplus
                  ? 'bg-yellow-500/10 border-yellow-500/30'
                  : 'bg-red-500/10 border-red-500/30'
            }`}>
              <span className="text-sm text-cc-text-muted">Diferencia</span>
              <span className={`text-lg font-bold ${
                isMatch ? 'text-green-400' : isSurplus ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {diff >= 0 ? '+' : ''}${diff.toFixed(2)}
              </span>
            </div>
          </div>

          <button
            onClick={onSuccess}
            className="w-full py-2.5 bg-cc-primary hover:bg-cc-primary/90 text-cc-bg font-bold text-sm rounded-lg transition-colors"
          >
            Aceptar
          </button>
        </div>
      </div>
    );
  }

  // ── Pre-close form ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-cc-surface border border-white/10 rounded-xl p-6 w-96 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex justify-between items-center mb-5">
          <h3 className="font-bold text-cc-cream flex items-center gap-2">
            <Lock size={18} className="text-red-400" />
            Cerrar Caja
          </h3>
          <button onClick={onClose} className="text-cc-text-muted hover:text-cc-text-main transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Pre-close summary */}
        <div className="space-y-2 mb-5">
          <h4 className="text-xs font-bold text-cc-text-muted uppercase tracking-wide mb-2">Resumen de caja</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center justify-between px-3 py-2 bg-black/30 rounded-lg border border-white/5">
              <span className="text-cc-text-muted flex items-center gap-1"><DollarSign size={11} /> Fondo</span>
              <span className="font-semibold text-cc-cream">${status.opening_cash.toFixed(0)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 bg-black/30 rounded-lg border border-white/5">
              <span className="text-cc-text-muted flex items-center gap-1"><Banknote size={11} /> Efectivo</span>
              <span className="font-semibold text-green-400">${status.cash_sales_total.toFixed(0)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 bg-black/30 rounded-lg border border-white/5">
              <span className="text-cc-text-muted flex items-center gap-1"><CreditCard size={11} /> Tarjeta</span>
              <span className="font-semibold text-blue-400">${status.card_sales_total.toFixed(0)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 bg-black/30 rounded-lg border border-white/5">
              <span className="text-cc-text-muted flex items-center gap-1"><ArrowDownCircle size={11} /> Retiros</span>
              <span className="font-semibold text-orange-400">-${status.withdrawals_total.toFixed(0)}</span>
            </div>
          </div>
          <div className="flex justify-between items-center px-3 py-2.5 bg-cc-primary/10 border border-cc-primary/20 rounded-lg">
            <span className="text-sm font-medium text-cc-text-muted">Efectivo esperado</span>
            <span className="text-xl font-bold text-cc-primary">${expectedCash.toFixed(2)}</span>
          </div>
        </div>

        <div className="space-y-4">
          {/* Counted cash */}
          <div>
            <label className="block text-xs font-medium text-cc-text-muted mb-1.5">
              Efectivo contado real
            </label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cc-text-muted" />
              <input
                type="number"
                min="0"
                step="0.5"
                value={countedCash || ''}
                onChange={(e) => setCountedCash(parseFloat(e.target.value) || 0)}
                className="w-full bg-black/30 border border-white/10 rounded-lg pl-8 pr-4 py-2.5 text-lg font-bold text-cc-cream focus:ring-2 focus:ring-red-400/50 outline-none text-right"
                placeholder="0.00"
                autoFocus
              />
            </div>
            {countedCash > 0 && (
              <div className={`mt-2 text-xs font-medium text-right ${
                Math.abs(countedCash - expectedCash) < 0.5
                  ? 'text-green-400'
                  : countedCash > expectedCash
                    ? 'text-yellow-400'
                    : 'text-red-400'
              }`}>
                Diferencia: {(countedCash - expectedCash) >= 0 ? '+' : ''}${(countedCash - expectedCash).toFixed(2)}
              </div>
            )}
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
              placeholder="Ej: Cierre turno matutino"
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-cream placeholder-gray-500 focus:ring-1 focus:ring-red-400/50 outline-none"
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
            disabled={saving}
            className="w-full py-2.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 font-bold text-sm rounded-lg border border-red-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? 'Cerrando caja…' : (
              <>
                <Lock size={16} /> Confirmar Cierre de Caja
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
