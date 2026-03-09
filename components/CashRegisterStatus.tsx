import React from 'react';
import { Banknote, CreditCard, AlertTriangle, Wallet, ArrowDownCircle, DollarSign, Lock } from 'lucide-react';
import type { CashRegisterStatus } from '../lib/cashRegister';

interface Props {
  status: CashRegisterStatus;
  loading: boolean;
  onOpenRegister: () => void;
  onWithdrawal?: () => void;
  onCloseRegister?: () => void;
}

/**
 * Compact cash-register status widget shown at the top of the POS sidebar.
 */
export const CashRegisterStatusPanel: React.FC<Props> = ({ status, loading, onOpenRegister, onWithdrawal, onCloseRegister }) => {
  const isOpen = !!status.session_id;

  if (loading) {
    return (
      <div className="p-3 bg-black/20 border-b border-white/5 text-center text-cc-text-muted text-xs animate-pulse">
        Cargando estado de caja…
      </div>
    );
  }

  // ── No session open ──────────────────────────────────────────────────────
  if (!isOpen) {
    return (
      <div className="p-3 bg-red-500/5 border-b border-red-500/20">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-bold text-red-400 uppercase tracking-wide">Sin caja abierta</span>
          </div>
        </div>
        <p className="text-[11px] text-red-300/70 mb-2.5">
          Debes abrir una caja antes de registrar ventas.
        </p>
        <button
          onClick={onOpenRegister}
          className="w-full py-2 bg-cc-primary hover:bg-cc-primary/90 text-cc-bg text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
        >
          <Wallet size={14} /> Abrir Caja
        </button>
      </div>
    );
  }

  // ── Session open ─────────────────────────────────────────────────────────
  const openedTime = status.opened_at
    ? new Date(status.opened_at).toLocaleTimeString('es-MX', {
        timeZone: 'America/Mexico_City',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    : '';

  return (
    <div className="p-3 bg-black/20 border-b border-white/5 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-xs font-bold text-green-400 uppercase tracking-wide">Caja abierta</span>
        </div>
        {openedTime && (
          <span className="text-[10px] text-cc-text-muted">desde {openedTime}</span>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="text-cc-text-muted flex items-center gap-1"><DollarSign size={10} /> Fondo</span>
          <span className="font-semibold text-cc-cream">${status.opening_cash.toFixed(0)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-cc-text-muted flex items-center gap-1"><Wallet size={10} /> En caja</span>
          <span className="font-bold text-cc-primary">${status.current_cash.toFixed(0)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-cc-text-muted flex items-center gap-1"><Banknote size={10} /> Efectivo</span>
          <span className="font-semibold text-green-400">${status.cash_sales_total.toFixed(0)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-cc-text-muted flex items-center gap-1"><CreditCard size={10} /> Tarjeta</span>
          <span className="font-semibold text-blue-400">${status.card_sales_total.toFixed(0)}</span>
        </div>
        {status.withdrawals_total > 0 && (
          <div className="flex items-center justify-between col-span-2">
            <span className="text-cc-text-muted flex items-center gap-1"><ArrowDownCircle size={10} /> Retiros</span>
            <span className="font-semibold text-orange-400">-${status.withdrawals_total.toFixed(0)}</span>
          </div>
        )}
      </div>

      {/* Withdrawal alert */}
      {status.needs_withdrawal && (
        <div className="flex items-start gap-2 px-2.5 py-2 bg-orange-500/10 border border-orange-500/30 rounded-lg">
          <AlertTriangle size={14} className="text-orange-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-orange-300 leading-tight">
            Efectivo en caja ≥ $1,000. Registra un retiro de resguardo.
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-1.5">
        {onWithdrawal && (
          <button
            onClick={onWithdrawal}
            className={`flex-1 py-1.5 text-[10px] font-bold rounded-md border transition-all flex items-center justify-center gap-1 ${
              status.needs_withdrawal
                ? 'bg-orange-500/15 border-orange-500/40 text-orange-400 hover:bg-orange-500/25 animate-pulse'
                : 'bg-white/5 border-white/10 text-cc-text-muted hover:bg-white/10 hover:text-cc-text-main'
            }`}
          >
            <ArrowDownCircle size={11} /> Retiro
          </button>
        )}
        {onCloseRegister && (
          <button
            onClick={onCloseRegister}
            className="flex-1 py-1.5 text-[10px] font-bold rounded-md border bg-white/5 border-white/10 text-cc-text-muted hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition-all flex items-center justify-center gap-1"
          >
            <Lock size={11} /> Cerrar caja
          </button>
        )}
      </div>
    </div>
  );
};
