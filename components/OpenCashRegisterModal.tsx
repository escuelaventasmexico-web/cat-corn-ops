import React, { useState } from 'react';
import { X, Wallet, DollarSign } from 'lucide-react';
import { openCashRegister } from '../lib/cashRegister';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Modal to open a new cash register session.
 */
export const OpenCashRegisterModal: React.FC<Props> = ({ onClose, onSuccess }) => {
  const [openingCash, setOpeningCash] = useState<number>(500);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (openingCash < 0) {
      setError('El fondo inicial no puede ser negativo');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await openCashRegister(openingCash, notes.trim() || undefined);
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      // Friendly message for "already open" error
      if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('ya existe') || msg.toLowerCase().includes('abierta')) {
        setError('Ya existe una caja abierta. Cierra la caja actual antes de abrir una nueva.');
      } else {
        setError(msg);
      }
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
            <Wallet size={18} className="text-cc-primary" />
            Abrir Caja
          </h3>
          <button
            onClick={onClose}
            className="text-cc-text-muted hover:text-cc-text-main transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Opening cash */}
          <div>
            <label className="block text-xs font-medium text-cc-text-muted mb-1.5">
              Fondo inicial
            </label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cc-text-muted" />
              <input
                type="number"
                min="0"
                step="50"
                value={openingCash || ''}
                onChange={(e) => setOpeningCash(parseFloat(e.target.value) || 0)}
                className="w-full bg-black/30 border border-white/10 rounded-lg pl-8 pr-4 py-2.5 text-lg font-bold text-cc-cream focus:ring-2 focus:ring-cc-primary outline-none text-right"
                placeholder="0"
                autoFocus
              />
            </div>
            {/* Quick amounts */}
            <div className="flex gap-1.5 mt-2">
              {[200, 500, 1000].map((amt) => (
                <button
                  key={amt}
                  onClick={() => setOpeningCash(amt)}
                  className={`flex-1 py-1 text-xs font-bold rounded-md border transition-all ${
                    openingCash === amt
                      ? 'bg-cc-primary/20 border-cc-primary text-cc-primary'
                      : 'bg-white/5 border-white/10 text-cc-text-muted hover:bg-white/10'
                  }`}
                >
                  ${amt}
                </button>
              ))}
            </div>
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
              placeholder="Ej: Turno matutino"
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-cc-cream placeholder-gray-500 focus:ring-1 focus:ring-cc-primary outline-none"
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
            disabled={saving || openingCash < 0}
            className="w-full py-2.5 bg-cc-primary hover:bg-cc-primary/90 text-cc-bg font-bold text-sm rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? 'Abriendo caja…' : (
              <>
                <Wallet size={16} /> Abrir Caja
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
