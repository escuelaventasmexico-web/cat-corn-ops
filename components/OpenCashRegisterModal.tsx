import React, { useEffect, useState } from 'react';
import { X, Wallet, DollarSign, Scale, Droplets, Info, Loader2 } from 'lucide-react';
import { fetchCashInventoryControlForBranch, openCashRegisterForBranch } from '../lib/cashRegister';
import type { CashInventoryContractState } from '../lib/cashRegister';
import type { Branch } from '../contexts/BranchContext';

interface Props {
  branch: Branch;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Modal to open a new cash register session.
 */
export const OpenCashRegisterModal: React.FC<Props> = ({ branch, onClose, onSuccess }) => {
  const [contractState, setContractState] = useState<CashInventoryContractState>({ status: 'loading' });
  const [openingCash, setOpeningCash] = useState<number>(500);
  const [cornKg, setCornKg] = useState('');
  const [oilLiters, setOilLiters] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContractState({ status: 'loading' });
    setError(null);
    setCornKg('');
    setOilLiters('');

    void fetchCashInventoryControlForBranch(branch.id)
      .then((contract) => {
        if (!cancelled) setContractState({ status: 'ready', contract });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'No se pudo consultar el control de caja';
        setContractState({ status: 'error', error: message });
        setError(message);
      });

    return () => { cancelled = true; };
  }, [branch.id]);

  const contract = contractState.status === 'ready' ? contractState.contract : null;
  const requiresInventoryCounts = Boolean(
    contract?.control_enabled && contract.requires_opening_counts,
  );

  const handleSubmit = async () => {
    if (contractState.status !== 'ready') {
      setError(contractState.status === 'error'
        ? contractState.error
        : 'Espera a que termine de cargar el control de caja');
      return;
    }
    if (openingCash < 0) {
      setError('El fondo inicial no puede ser negativo');
      return;
    }

    const parseCount = (raw: string, label: string): number | null => {
      if (!raw.trim()) {
        setError(`${label} es obligatorio`);
        return null;
      }
      if (!/^\d+(?:\.\d{1,3})?$/.test(raw.trim())) {
        setError(`${label} debe ser un número no negativo con máximo tres decimales`);
        return null;
      }
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        setError(`${label} debe ser un número finito no negativo`);
        return null;
      }
      return value;
    };

    const parsedCorn = requiresInventoryCounts ? parseCount(cornKg, 'Maíz disponible') : null;
    if (requiresInventoryCounts && parsedCorn === null) return;
    const parsedOil = requiresInventoryCounts ? parseCount(oilLiters, 'Aceite disponible') : null;
    if (requiresInventoryCounts && parsedOil === null) return;

    setSaving(true);
    setError(null);
    try {
      await openCashRegisterForBranch(
        branch.id,
        openingCash,
        contractState.contract,
        notes.trim() || undefined,
        requiresInventoryCounts
          ? { cornKg: parsedCorn!, oilLiters: parsedOil! }
          : undefined,
      );
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-80 rounded-xl border border-white/10 bg-[#17130f] p-6 shadow-2xl"
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

        <p className="mb-4 text-xs text-cc-primary">Sucursal: <span className="font-bold">{branch.name}</span></p>

        {contractState.status === 'loading' && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-cc-text-muted">
            <Loader2 size={14} className="animate-spin" /> Consultando control de caja…
          </div>
        )}

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

          {requiresInventoryCounts && (
            <div className="space-y-3 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3">
              <div className="flex items-start gap-2 text-xs text-amber-200">
                <Info size={14} className="mt-0.5 flex-shrink-0" />
                <span>Este conteo quedará registrado como conteo inicial de caja.</span>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-cc-text-muted">
                  {contract?.corn_label || 'Peso del maíz'} ({contract?.corn_unit || 'kg'})
                </label>
                <div className="relative">
                  <Scale size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cc-text-muted" />
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    inputMode="decimal"
                    value={cornKg}
                    onChange={(event) => setCornKg(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-black/30 py-2.5 pl-9 pr-10 text-right text-lg font-bold text-cc-cream outline-none focus:ring-2 focus:ring-cc-primary"
                    placeholder="0.000"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-cc-text-muted">{contract?.corn_unit || 'kg'}</span>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-cc-text-muted">
                  {contract?.oil_label || 'Aceite'} ({contract?.oil_unit || 'L'})
                </label>
                <div className="relative">
                  <Droplets size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cc-text-muted" />
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    inputMode="decimal"
                    value={oilLiters}
                    onChange={(event) => setOilLiters(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-black/30 py-2.5 pl-9 pr-10 text-right text-lg font-bold text-cc-cream outline-none focus:ring-2 focus:ring-cc-primary"
                    placeholder="0.000"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-cc-text-muted">{contract?.oil_unit || 'L'}</span>
                </div>
              </div>
            </div>
          )}

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
            disabled={contractState.status !== 'ready' || saving || openingCash < 0 || (requiresInventoryCounts && (!cornKg.trim() || !oilLiters.trim()))}
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
