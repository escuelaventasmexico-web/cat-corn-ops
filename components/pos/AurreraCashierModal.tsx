import { UserCheck, X } from 'lucide-react';
import {
  AURRERA_CASHIER_OPTIONS,
  type AurreraCashierKey,
} from '../../lib/posCashierAttribution.js';

interface AurreraCashierModalProps {
  selected: AurreraCashierKey | null;
  administratorAllowed: boolean;
  onSelect: (key: AurreraCashierKey) => void;
  onCancel: () => void;
  onContinue: () => void;
}

export const AurreraCashierModal = ({
  selected,
  administratorAllowed,
  onSelect,
  onCancel,
  onContinue,
}: AurreraCashierModalProps) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="aurrera-cashier-title"
      className="w-full max-w-md rounded-2xl border border-white/10 bg-[#211f1f] p-5 shadow-2xl"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-cc-primary/15 text-cc-primary">
            <UserCheck size={21} />
          </div>
          <h2 id="aurrera-cashier-title" className="text-xl font-bold text-cc-cream">
            ¿Quién realizó esta venta?
          </h2>
          <p className="mt-1 text-sm text-cc-text-muted">
            Selecciona al responsable antes de continuar con el cobro.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancelar selección de cajero"
          className="rounded-lg p-2 text-cc-text-muted transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={18} />
        </button>
      </div>

      <div role="radiogroup" aria-label="Responsable de la venta" className="space-y-2">
        {AURRERA_CASHIER_OPTIONS.map(option => {
          const disabled = option.key === 'administrator' && !administratorAllowed;
          const checked = selected === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              onClick={() => onSelect(option.key)}
              className={`w-full rounded-xl border p-3 text-left transition-all ${
                checked
                  ? 'border-cc-primary bg-cc-primary/15 ring-1 ring-cc-primary/40'
                  : 'border-white/10 bg-black/20 hover:border-white/25 hover:bg-white/5'
              } disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <span className="flex items-center gap-3">
                <span className={`h-4 w-4 rounded-full border ${checked ? 'border-cc-primary bg-cc-primary shadow-[inset_0_0_0_3px_#211f1f]' : 'border-white/30'}`} />
                <span>
                  <span className="block font-semibold text-cc-cream">{option.label}</span>
                  <span className="block text-xs text-cc-text-muted">{option.description}</span>
                  {disabled && (
                    <span className="mt-1 block text-[11px] text-amber-300">
                      Requiere una sesión autenticada de administrador.
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-cc-text-main transition-colors hover:bg-white/10"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={!selected}
          className="rounded-lg bg-cc-primary px-4 py-2.5 text-sm font-bold text-cc-bg transition-colors hover:bg-cc-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continuar con cobro
        </button>
      </div>
    </div>
  </div>
);
