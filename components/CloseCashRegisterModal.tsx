import React, { useEffect, useState } from 'react';
import { X, Lock, DollarSign, Banknote, CreditCard, ArrowDownCircle, CheckCircle, AlertTriangle, Printer, Loader2, Scale, Droplets, Info } from 'lucide-react';
import { closeCashRegisterForBranch, fetchAndPrintCorteDeCaja, fetchCashInventoryControlForBranch, fetchCashInventorySessionState } from '../lib/cashRegister';
import type { CashInventoryContractState, CashInventorySessionState, CashRegisterStatus, CloseResult, CashSessionSummary } from '../lib/cashRegister';
import type { Branch } from '../contexts/BranchContext';

interface Props {
  branch: Branch;
  status: CashRegisterStatus;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Modal to close the current cash register session.
 * Shows a pre-close summary, asks for counted cash, then shows the result.
 */
export const CloseCashRegisterModal: React.FC<Props> = ({ branch, status, onClose, onSuccess }) => {
  const [contractState, setContractState] = useState<CashInventoryContractState>({ status: 'loading' });
  const [countedCash, setCountedCash] = useState<number>(0);
  const [cornKg, setCornKg] = useState('');
  const [oilLiters, setOilLiters] = useState('');
  const [inventoryState, setInventoryState] = useState<CashInventorySessionState | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printMsg, setPrintMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContractState({ status: 'loading' });
    setInventoryLoading(true);
    setInventoryState(null);
    setError(null);
    setCornKg('');
    setOilLiters('');

    void fetchCashInventoryControlForBranch(branch.id)
      .then(async (contract) => {
        if (cancelled) return;
        setContractState({ status: 'ready', contract });
        if (!(contract.control_enabled && contract.requires_closing_counts)) {
          setInventoryLoading(false);
          return;
        }
        if (!status.session_id) {
          throw new Error('No se encontró la sesión abierta que se desea cerrar');
        }
        const state = await fetchCashInventorySessionState(branch.id, status.session_id);
        if (cancelled) return;
        setInventoryState(state);
        if (state.opening.corn_kg == null || state.opening.oil_liters == null) {
          throw new Error('La sesión no tiene los conteos iniciales obligatorios y no puede cerrarse desde este flujo.');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'No se pudieron cargar los conteos iniciales';
        setContractState({ status: 'error', error: message });
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setInventoryLoading(false);
      });

    return () => { cancelled = true; };
  }, [branch.id, status.session_id]);

  const contract = contractState.status === 'ready' ? contractState.contract : null;
  const requiresInventoryCounts = Boolean(
    contract?.control_enabled && contract.requires_closing_counts,
  );

  const parseInventoryCount = (raw: string, label: string): number | null => {
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

  const parsedCornPreview = /^\d+(?:\.\d{1,3})?$/.test(cornKg.trim()) ? Number(cornKg) : null;
  const parsedOilPreview = /^\d+(?:\.\d{1,3})?$/.test(oilLiters.trim()) ? Number(oilLiters) : null;

  /** Build a CashSessionSummary from the status (and optional close result) so we can print */
  const buildSessionForPrint = (result?: CloseResult | null): CashSessionSummary => ({
    session_id: status.session_id || '',
    branch_id: branch.id,
    status: result ? 'closed' : 'open',
    opened_at: status.opened_at || new Date().toISOString(),
    closed_at: result ? new Date().toISOString() : null,
    opening_cash: status.opening_cash,
    cash_sales_total: status.cash_sales_total,
    card_sales_total: status.card_sales_total,
    withdrawals_total: status.withdrawals_total,
    expected_cash: status.opening_cash + status.cash_sales_total - status.withdrawals_total,
    counted_cash: result?.counted_cash ?? null,
    difference: result?.difference ?? null,
    sales_count: 0,
    withdrawals_count: 0,
    opened_by: status.opened_by,
    closed_by: null,
    notes: status.notes,
    close_notes: null,
  });

  const handlePrintCorte = async (result?: CloseResult | null) => {
    setPrinting(true);
    setPrintMsg(null);
    try {
      await fetchAndPrintCorteDeCaja(buildSessionForPrint(result));
      setPrintMsg('✅ Corte impreso');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error de impresión';
      setPrintMsg('❌ ' + msg);
    } finally {
      setPrinting(false);
    }
  };

  // Expected = fondo + cash sales − withdrawals (card/transfer NOT included — not physical cash)
  const expectedCash = status.opening_cash + status.cash_sales_total - status.withdrawals_total;

  const handleSubmit = async () => {
    if (!status.session_id) return;
    if (contractState.status !== 'ready') {
      setError(contractState.status === 'error'
        ? contractState.error
        : 'Espera a que termine de cargar el control de caja');
      return;
    }
    if (requiresInventoryCounts && (
      inventoryLoading
      || !inventoryState
      || inventoryState.opening.corn_kg == null
      || inventoryState.opening.oil_liters == null
    )) {
      setError('No se puede cerrar hasta validar los conteos iniciales de la sesión.');
      return;
    }
    const parsedCorn = requiresInventoryCounts
      ? parseInventoryCount(cornKg, 'Maíz disponible')
      : null;
    if (requiresInventoryCounts && parsedCorn === null) return;
    const parsedOil = requiresInventoryCounts
      ? parseInventoryCount(oilLiters, 'Aceite disponible')
      : null;
    if (requiresInventoryCounts && parsedOil === null) return;

    setSaving(true);
    setError(null);
    try {
      const result = await closeCashRegisterForBranch(
        branch.id,
        status.session_id,
        countedCash,
        contractState.contract,
        notes.trim() || undefined,
        requiresInventoryCounts
          ? { cornKg: parsedCorn!, oilLiters: parsedOil! }
          : undefined,
      );
      // Always use our local expectedCash — the RPC may still have the old
      // formula that includes opening_cash (fondo) in expected.
      const finalResult: CloseResult = {
        expected_cash: expectedCash,
        counted_cash: result.counted_cash ?? countedCash,
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
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm" onClick={onSuccess}>
        <div className="w-96 rounded-xl border border-white/10 bg-[#17130f] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
            <div className="flex justify-between items-center px-3 py-2.5 bg-blue-500/10 rounded-lg border border-blue-500/20">
              <span className="text-sm text-cc-text-muted flex items-center gap-1"><CreditCard size={13} className="text-blue-400" /> Tarjeta esperada</span>
              <span className="text-lg font-bold text-blue-400">${status.card_sales_total.toFixed(2)}</span>
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

          <div className="space-y-2">
            <button
              onClick={() => handlePrintCorte(closeResult)}
              disabled={printing}
              className="w-full py-2.5 bg-white/10 hover:bg-white/15 text-cc-cream font-bold text-sm rounded-lg border border-white/10 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {printing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
              {printing ? 'Imprimiendo…' : 'Imprimir Corte'}
            </button>
            {printMsg && (
              <div className={`text-xs text-center ${printMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
                {printMsg}
              </div>
            )}
            <button
              onClick={onSuccess}
              className="w-full py-2.5 bg-cc-primary hover:bg-cc-primary/90 text-cc-bg font-bold text-sm rounded-lg transition-colors"
            >
              Aceptar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Pre-close form ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[92vh] w-[28rem] overflow-y-auto rounded-xl border border-white/10 bg-[#17130f] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
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

        <p className="mb-4 text-xs text-cc-primary">Sucursal: <span className="font-bold">{branch.name}</span></p>

        {contractState.status === 'loading' && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-cc-text-muted">
            <Loader2 size={14} className="animate-spin" /> Consultando control de caja…
          </div>
        )}

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
          <div className="flex justify-between items-center px-3 py-2.5 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <span className="text-sm font-medium text-cc-text-muted flex items-center gap-1"><CreditCard size={13} className="text-blue-400" /> Tarjeta esperada</span>
            <span className="text-xl font-bold text-blue-400">${status.card_sales_total.toFixed(2)}</span>
          </div>
        </div>

        <div className="space-y-4">
          {requiresInventoryCounts && (
            <div className="space-y-3 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3">
              <div className="flex items-start gap-2 text-xs text-amber-200">
                <Info size={14} className="mt-0.5 flex-shrink-0" />
                <span>El conteo final quedará auditado. No modifica el inventario contable.</span>
              </div>
              {inventoryLoading ? (
                <div className="flex items-center gap-2 text-xs text-cc-text-muted">
                  <Loader2 size={13} className="animate-spin" /> Cargando conteos iniciales…
                </div>
              ) : inventoryState?.opening.corn_kg != null && inventoryState.opening.oil_liters != null ? (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-black/25 p-2">
                    <span className="block text-cc-text-muted">Maíz inicial</span>
                    <strong className="text-cc-cream">{inventoryState.opening.corn_kg.toFixed(3)} kg</strong>
                  </div>
                  <div className="rounded-md bg-black/25 p-2">
                    <span className="block text-cc-text-muted">Aceite inicial</span>
                    <strong className="text-cc-cream">{inventoryState.opening.oil_liters.toFixed(3)} L</strong>
                  </div>
                </div>
              ) : null}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-cc-text-muted">
                  {contract?.corn_label || 'Peso del maíz'} final ({contract?.corn_unit || 'kg'})
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
                    className="w-full rounded-lg border border-white/10 bg-black/30 py-2.5 pl-9 pr-10 text-right text-lg font-bold text-cc-cream outline-none focus:ring-2 focus:ring-red-400/50"
                    placeholder="0.000"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-cc-text-muted">{contract?.corn_unit || 'kg'}</span>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-cc-text-muted">
                  {contract?.oil_label || 'Aceite'} final ({contract?.oil_unit || 'L'})
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
                    className="w-full rounded-lg border border-white/10 bg-black/30 py-2.5 pl-9 pr-10 text-right text-lg font-bold text-cc-cream outline-none focus:ring-2 focus:ring-red-400/50"
                    placeholder="0.000"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-cc-text-muted">{contract?.oil_unit || 'L'}</span>
                </div>
              </div>

              {inventoryState?.opening.corn_kg != null && parsedCornPreview != null &&
                inventoryState.opening.oil_liters != null && parsedOilPreview != null && (
                <div className="space-y-1 rounded-md border border-white/10 bg-black/25 p-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-cc-text-muted">Diferencia maíz</span>
                    <span>{(parsedCornPreview - inventoryState.opening.corn_kg).toFixed(3)} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-cc-text-muted">Consumo aparente maíz</span>
                    <span>{(inventoryState.opening.corn_kg - parsedCornPreview).toFixed(3)} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-cc-text-muted">Diferencia aceite</span>
                    <span>{(parsedOilPreview - inventoryState.opening.oil_liters).toFixed(3)} L</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-cc-text-muted">Consumo aparente aceite</span>
                    <span>{(inventoryState.opening.oil_liters - parsedOilPreview).toFixed(3)} L</span>
                  </div>
                  <p className="pt-1 text-[10px] leading-relaxed text-amber-200/80">
                    El consumo aparente no es consumo real autoritativo: no incorpora compras, producción, mermas ni transferencias.
                  </p>
                </div>
              )}
            </div>
          )}

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

          {/* Print corte (pre-close) */}
          <button
            onClick={() => handlePrintCorte()}
            disabled={printing || saving}
            className="w-full py-2 bg-white/10 hover:bg-white/15 text-cc-cream font-medium text-xs rounded-lg border border-white/10 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {printing ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
            {printing ? 'Imprimiendo…' : 'Imprimir Corte Parcial'}
          </button>
          {printMsg && (
            <div className={`text-xs text-center ${printMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
              {printMsg}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={contractState.status !== 'ready' || saving || (requiresInventoryCounts && (
              inventoryLoading
              || !inventoryState
              || inventoryState.opening.corn_kg == null
              || inventoryState.opening.oil_liters == null
              || !cornKg.trim()
              || !oilLiters.trim()
            ))}
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
