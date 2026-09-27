import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, X } from 'lucide-react';
import { supabase } from '../../../supabase';
import { fmtCurrency, fmtDate } from './types';

interface Props {
  partnerId: string;
  partnerName: string;
  partnerFolio?: string | null;
  pendingBalance: number;
  onClose: () => void;
  onSuccess: () => void;
}

interface PreviewItem {
  movement_item_id: string;
  product_id?: string | null;
  product_name: string;
  product_variant?: string | null;
  product_size?: string | null;
  quantity_sold?: number | null;
  amount_due?: number | null;
  quantity_already_adjusted?: number | null;
  amount_already_adjusted?: number | null;
  approved_payment_amount?: number | null;
  commission_event_id?: string | null;
  commission_amount?: number | null;
  unit_commission?: number | null;
  commission_status?: string | null;
  commission_payment_status?: string | null;
  commission_paid_amount?: number | null;
  commission_reserved_amount?: number | null;
  in_non_cancelled_commission_settlement?: boolean;
  has_active_payment_request?: boolean;
  max_adjustable_quantity?: number | null;
  max_adjustable_amount?: number | null;
  estimated_commission_reduction?: number | null;
  blocked?: boolean;
  blocked_reason?: string | null;
}

interface PreviewSettlement {
  settlement_id: string;
  settlement_reference?: string | null;
  movement_date: string;
  items?: PreviewItem[];
}

interface PreviewResponse {
  partner_id: string;
  pending_balance?: number | null;
  settlements?: PreviewSettlement[];
}

interface AdjustmentLine {
  id: string;
  movement_id: string;
  product_name: string;
  product_variant?: string | null;
  product_size?: string | null;
  quantity_sold: number;
  amount_due: number;
  settlementDate: string;
  settlementReference: string;
  previousQuantity: number;
  previousAmount: number;
  approvedPayments: number;
  commissionEventId?: string | null;
  commissionAmount: number;
  unitCommission: number;
  commissionStatus?: string | null;
  commissionPaymentStatus?: string | null;
  commissionPaidAmount: number;
  commissionReservedAmount: number;
  maxAdjustableQuantity: number;
  maxAdjustableAmount: number;
  estimatedCommissionReduction: number;
  isBlocked: boolean;
  blockedReason: string | null;
}

interface AdjustmentResult {
  adjustment_folio?: string;
  adjusted_lines?: number;
  units_restored_to_possession?: number;
  amount_adjusted?: number;
  commission_reduction?: number;
  pending_balance_before?: number;
  pending_balance_after?: number;
  warning?: string;
  created_at?: string;
}

const getErrorParts = (error: unknown) => {
  if (error instanceof Error) return { message: error.message };
  if (!error || typeof error !== 'object') return {};

  const candidate = error as Record<string, unknown>;
  const asText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
  return {
    message: asText(candidate.message),
    details: asText(candidate.details),
    hint: asText(candidate.hint),
    code: asText(candidate.code),
  };
};

const getErrorMessage = (error: unknown, fallback: string, context: 'load' | 'submit') => {
  const parts = getErrorParts(error);
  const message = parts.message || parts.details || parts.hint || fallback;
  if (context === 'load') return message;

  const normalized = message.toLowerCase();
  if (normalized.includes('password') || normalized.includes('contraseña')) return 'La contraseña administrativa es incorrecta.';
  if (normalized.includes('verification request') || normalized.includes('solicitud') || normalized.includes('payment request')) return 'Existe una solicitud de verificación de pago todavía activa.';
  if (normalized.includes('commission') || normalized.includes('comisión')) return 'La comisión está pagada, reservada o comprometida y no se puede ajustar.';
  if (normalized.includes('exceeds') || normalized.includes('superior') || normalized.includes('adjustable')) return 'La cantidad indicada supera las piezas todavía corregibles.';
  if (normalized.includes('below its approved payments') || normalized.includes('pagos aprobados')) return 'El ajuste dejaría la liquidación por debajo de los pagos aprobados.';
  if (normalized.includes('administrator') || normalized.includes('admin')) return 'No tienes permisos administrativos para realizar este ajuste.';
  if (normalized.includes('not found') || normalized.includes('eligible')) return 'El socio o el renglón seleccionado ya no es válido.';
  return message;
};

const asNumber = (value: unknown) => Number(value ?? 0) || 0;

const adjustmentAmountForQuantity = (line: Pick<AdjustmentLine, 'amount_due' | 'previousAmount' | 'quantity_sold' | 'previousQuantity'>, quantity: number) => {
  const stillAdjustable = Math.max(0, line.quantity_sold - line.previousQuantity);
  if (quantity <= 0 || stillAdjustable <= 0) return 0;
  if (quantity >= stillAdjustable) return Math.max(0, line.amount_due - line.previousAmount);
  return Math.round((line.amount_due * quantity / line.quantity_sold) * 100) / 100;
};

export const AdminComodatoBalanceAdjustmentModal: React.FC<Props> = ({
  partnerId,
  partnerName,
  partnerFolio,
  pendingBalance,
  onClose,
  onSuccess,
}) => {
  const [lines, setLines] = useState<AdjustmentLine[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<AdjustmentResult | null>(null);
  const [previewPendingBalance, setPreviewPendingBalance] = useState(pendingBalance);

  const loadLines = useCallback(async () => {
    if (!supabase) {
      setLoadError('No fue posible conectarse para cargar las liquidaciones corregibles.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.rpc('get_admin_comodato_adjustment_preview', {
        p_partner_id: partnerId,
      });
      if (error) throw error;

      const preview = (data ?? {}) as PreviewResponse;
      if (preview.partner_id && preview.partner_id !== partnerId) {
        throw new Error('La vista previa recibida no corresponde al socio seleccionado.');
      }

      setPreviewPendingBalance(asNumber(preview.pending_balance));
      setLines((preview.settlements ?? []).flatMap(settlement =>
        (settlement.items ?? []).map(item => ({
          id: item.movement_item_id,
          movement_id: settlement.settlement_id,
          product_name: item.product_name,
          product_variant: item.product_variant,
          product_size: item.product_size,
          quantity_sold: asNumber(item.quantity_sold),
          amount_due: asNumber(item.amount_due),
          settlementDate: settlement.movement_date,
          settlementReference: settlement.settlement_reference || settlement.settlement_id.slice(0, 8),
          previousQuantity: asNumber(item.quantity_already_adjusted),
          previousAmount: asNumber(item.amount_already_adjusted),
          approvedPayments: asNumber(item.approved_payment_amount),
          commissionEventId: item.commission_event_id,
          commissionAmount: asNumber(item.commission_amount),
          unitCommission: asNumber(item.unit_commission),
          commissionStatus: item.commission_status,
          commissionPaymentStatus: item.commission_payment_status,
          commissionPaidAmount: asNumber(item.commission_paid_amount),
          commissionReservedAmount: asNumber(item.commission_reserved_amount),
          maxAdjustableQuantity: Math.max(0, Math.floor(asNumber(item.max_adjustable_quantity))),
          maxAdjustableAmount: asNumber(item.max_adjustable_amount),
          estimatedCommissionReduction: asNumber(item.estimated_commission_reduction),
          isBlocked: Boolean(item.blocked),
          blockedReason: item.blocked_reason || null,
        })),
      ));
    } catch (error) {
      const parts = getErrorParts(error);
      console.error('[comodato adjustment] Unable to load adjustment data', parts);
      setLoadError(getErrorMessage(error, 'No fue posible cargar las liquidaciones corregibles. Intenta nuevamente.', 'load'));
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

  useEffect(() => { loadLines(); }, [loadLines]);

  const lineState = useMemo(() => {
    const settlementCapacity = new Map<string, number>();
    lines.forEach(line => {
      settlementCapacity.set(
        line.movement_id,
        (settlementCapacity.get(line.movement_id) ?? 0)
          + Math.max(0, line.amount_due - line.previousAmount),
      );
    });
    const settlementPaymentsApplied = new Set<string>();
    lines.forEach(line => {
      if (settlementPaymentsApplied.has(line.movement_id)) return;
      settlementPaymentsApplied.add(line.movement_id);
      settlementCapacity.set(
        line.movement_id,
        Math.max(0, (settlementCapacity.get(line.movement_id) ?? 0) - line.approvedPayments),
      );
    });

    return new Map(lines.map(line => {
      const parsed = quantities[line.id] === undefined || quantities[line.id] === '' ? 0 : Number(quantities[line.id]);
      const remainingQuantity = Math.max(0, line.quantity_sold - line.previousQuantity);
      const otherSelectedAmount = lines
        .filter(other => other.movement_id === line.movement_id && other.id !== line.id && !other.isBlocked)
        .reduce((total, other) => {
          const rawQuantity = quantities[other.id] === undefined || quantities[other.id] === '' ? 0 : Number(quantities[other.id]);
          const quantity = Number.isInteger(rawQuantity) && rawQuantity > 0
            ? Math.min(rawQuantity, Math.max(0, other.quantity_sold - other.previousQuantity))
            : 0;
          return total + adjustmentAmountForQuantity(other, quantity);
        }, 0);
      const availableAmount = Math.max(0, (settlementCapacity.get(line.movement_id) ?? 0) - otherSelectedAmount);
      let correctable = line.isBlocked
        ? 0
        : Math.min(remainingQuantity, line.maxAdjustableQuantity);
      while (correctable > 0 && adjustmentAmountForQuantity(line, correctable) > availableAmount + 0.005) {
        correctable -= 1;
      }
      const isInteger = Number.isInteger(parsed) && parsed >= 0;
      const amount = adjustmentAmountForQuantity(line, parsed);
      return [line.id, {
        parsed,
        correctable,
        isInteger,
        blockedReason: line.blockedReason,
        amount,
      }];
    }));
  }, [lines, quantities]);

  const summary = useMemo(() => {
    const perSettlement = new Map<string, { effective: number; payments: number; selected: number }>();
    let units = 0;
    let amount = 0;
    let commission = 0;
    let invalid = false;
    lines.forEach(line => {
      const state = lineState.get(line.id)!;
      const current = perSettlement.get(line.movement_id) ?? { effective: 0, payments: line.approvedPayments, selected: 0 };
      current.effective += Math.max(0, line.amount_due - line.previousAmount);
      if (state.parsed > 0) {
        if (!state.isInteger || state.parsed > state.correctable || line.isBlocked) {
          invalid = true;
        } else {
          current.selected += state.amount;
          units += state.parsed;
          amount += state.amount;
          commission += state.parsed * line.unitCommission;
        }
      }
      perSettlement.set(line.movement_id, current);
    });
    perSettlement.forEach(value => { if (value.effective - value.selected + 0.005 < value.payments) invalid = true; });
    return { units, amount, commission, invalid, pendingAfter: Math.max(0, previewPendingBalance - amount) };
  }, [lineState, lines, previewPendingBalance]);

  const selectedAdjustments = useMemo(() => lines.flatMap(line => {
    const state = lineState.get(line.id);
    const quantity = state?.parsed ?? 0;
    return !line.isBlocked && state?.isInteger && quantity > 0 && quantity <= state.correctable
      ? [{ settlement_item_id: line.id, quantity }]
      : [];
  }), [lineState, lines]);

  const hasEligibleLines = lines.some(line => !line.isBlocked);

  const canSubmit = selectedAdjustments.length > 0 && reason.trim().length >= 10 && adminPassword.length > 0
    && confirmed && !summary.invalid && !submitting;

  const submit = async () => {
    if (!supabase || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data, error } = await supabase.rpc('admin_adjust_comodato_balance', {
        p_partner_id: partnerId,
        p_adjustments: selectedAdjustments,
        p_reason: reason.trim(),
        p_admin_password: adminPassword,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
      setAdminPassword('');
      setQuantities({});
      setReason('');
      setNotes('');
      setConfirmed(false);
      setResult((data ?? {}) as AdjustmentResult);
      onSuccess();
      await loadLines();
    } catch (error) {
      setSubmitError(getErrorMessage(error, 'No fue posible registrar el ajuste. Intenta nuevamente.', 'submit'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Ajustar saldo pendiente">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-[#a87820] bg-[#fff8e6] p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[#111111]">Ajustar saldo pendiente</h2>
            <p className="text-sm text-[#6b5c40]">{partnerName}{partnerFolio ? ` · ${partnerFolio}` : ''}</p>
            <p className="mt-1 text-sm font-semibold text-red-700">Saldo pendiente actual: {fmtCurrency(previewPendingBalance)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-[#4a2c0a] hover:bg-[#f5e9c8]" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        <div className="mb-5 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <p>Corrección administrativa auditable. El servidor valida las piezas, pagos y comisiones antes de registrar el ajuste.</p>
        </div>

        {loading ? <div className="flex items-center gap-2 py-10 text-sm text-[#6b5c40]"><Loader2 className="h-4 w-4 animate-spin" /> Cargando liquidaciones…</div> : loadError ? (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{loadError}</div>
        ) : (
          <div className="space-y-3">
            {lines.length === 0 ? <p className="py-5 text-sm text-[#6b5c40]">No hay renglones de liquidación para revisar.</p> : null}
            {lines.length > 0 && !hasEligibleLines ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">No existen piezas elegibles para ajustar.</p> : null}
            {lines.map(line => {
              const state = lineState.get(line.id)!;
              const effectiveAmount = Math.max(0, line.amount_due - line.previousAmount);
              return (
                <div key={line.id} className="rounded-xl border border-[#d8bd77] bg-white p-4 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[#111111]">{line.product_name}{line.product_variant ? ` — ${line.product_variant}` : ''}{line.product_size ? ` (${line.product_size})` : ''}</p>
                      <p className="text-xs text-[#6b5c40]">Liquidación {fmtDate(line.settlementDate)} · {line.settlementReference}</p>
                    </div>
                    {line.isBlocked ? <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800">Bloqueado</span> : <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">Corregible</span>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1 text-xs text-[#374151] md:grid-cols-4">
                    <p>Liquidadas: <b>{line.quantity_sold}</b></p><p>Corregidas antes: <b>{line.previousQuantity}</b></p><p>Corregibles: <b>{state.correctable}</b></p><p>Pagos aprobados: <b>{fmtCurrency(line.approvedPayments)}</b></p>
                    <p>Importe original: <b>{fmtCurrency(line.amount_due)}</b></p><p>Corregido antes: <b>{fmtCurrency(line.previousAmount)}</b></p><p>Importe efectivo: <b>{fmtCurrency(effectiveAmount)}</b></p><p>Comisión: <b>{line.commissionEventId ? fmtCurrency(line.commissionAmount) : 'No disponible'}</b></p>
                  </div>
                  {line.commissionEventId && <p className="mt-2 text-xs text-[#6b5c40]">Estado de comisión: {line.commissionPaymentStatus || line.commissionStatus || '—'} · Pagada: {fmtCurrency(line.commissionPaidAmount)} · Reservada: {fmtCurrency(line.commissionReservedAmount)}</p>}
                  {line.blockedReason && <p className="mt-2 flex items-center gap-1 text-xs text-red-700"><AlertTriangle size={13} /> {line.blockedReason}</p>}
                  <label className="mt-3 flex max-w-xs items-center gap-2 text-xs font-medium text-[#374151]">Piezas a corregir
                    <input type="number" min={0} max={state.correctable} step={1} inputMode="numeric" value={quantities[line.id] ?? ''}
                      disabled={line.isBlocked || state.correctable <= 0}
                      onChange={event => setQuantities(current => ({ ...current, [line.id]: event.target.value }))}
                      className="w-20 rounded border border-[#c49330] px-2 py-1 text-sm disabled:bg-gray-100" />
                  </label>
                  {!state.isInteger || state.parsed > state.correctable ? <p className="mt-1 text-xs text-red-700">Indica un entero entre 0 y {state.correctable}.</p> : null}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5 rounded-xl border border-[#c49330] bg-[#f5e9c8] p-4">
          <h3 className="font-semibold text-[#4a2c0a]">Resumen estimado</h3>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm md:grid-cols-5"><p>Piezas: <b>{summary.units}</b></p><p>Reducción estimada de saldo: <b>{fmtCurrency(summary.amount)}</b></p><p>Reducción estimada de comisiones: <b>{fmtCurrency(summary.commission)}</b></p><p>Saldo antes del ajuste: <b>{fmtCurrency(previewPendingBalance)}</b></p><p>Saldo estimado después: <b>{fmtCurrency(summary.pendingAfter)}</b></p></div>
          <p className="mt-3 text-sm font-semibold text-[#7a4a0a]">Este ajuste reducirá el saldo pendiente y cancelará o reducirá las comisiones no pagadas asociadas. Las comisiones pagadas o reservadas no se pueden ajustar. No se modificarán etiquetas físicas.</p>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium text-[#374151]">Motivo del ajuste (mínimo 10 caracteres)<textarea value={reason} onChange={event => setReason(event.target.value)} className="mt-1 min-h-20 w-full rounded border border-[#c49330] p-2" /></label>
          <label className="text-sm font-medium text-[#374151]">Notas (opcional)<textarea value={notes} onChange={event => setNotes(event.target.value)} className="mt-1 min-h-20 w-full rounded border border-[#c49330] p-2" /></label>
          <label className="text-sm font-medium text-[#374151]">Contraseña administrativa<input type="password" autoComplete="current-password" value={adminPassword} onChange={event => setAdminPassword(event.target.value)} className="mt-1 w-full rounded border border-[#c49330] p-2" /></label>
          <label className="mt-6 flex items-start gap-2 text-sm text-[#374151]"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />Confirmo que revisé las piezas y que este ajuste no debe generar comisiones.</label>
        </div>
        {summary.invalid && <p className="mt-3 text-sm text-red-700">Hay una inconsistencia en las cantidades seleccionadas o el saldo de una liquidación.</p>}
        {submitError && <p className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{submitError}</p>}
        {result && <div className="mt-3 rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900"><div className="flex gap-2"><CheckCircle2 className="h-5 w-5 shrink-0" /><div><p className="font-semibold">Ajuste registrado: {result.adjustment_folio || 'sin folio'}</p><p>Piezas corregidas: {result.units_restored_to_possession ?? 0} · Importe ajustado: {fmtCurrency(result.amount_adjusted)} · Comisión reducida: {fmtCurrency(result.commission_reduction)}</p><p>Saldo: {fmtCurrency(result.pending_balance_before)} → {fmtCurrency(result.pending_balance_after)}</p>{result.warning && <p className="mt-1">{result.warning}</p>}</div></div></div>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={submitting} className="rounded bg-gray-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Cerrar</button><button type="button" onClick={submit} disabled={!canSubmit} className="flex items-center gap-2 rounded bg-[#2d1a00] px-4 py-2 text-sm font-semibold text-[#f6e7c1] disabled:cursor-not-allowed disabled:opacity-40">{submitting && <Loader2 className="h-4 w-4 animate-spin" />}{submitting ? 'Procesando…' : 'Confirmar ajuste'}</button></div>
      </div>
    </div>
  );
};

export default AdminComodatoBalanceAdjustmentModal;
