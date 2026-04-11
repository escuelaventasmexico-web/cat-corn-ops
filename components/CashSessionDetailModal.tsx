import { useEffect, useState, useCallback } from 'react';
import {
  X,
  Banknote,
  CreditCard,
  ArrowDownCircle,
  DollarSign,
  Receipt,
  Tag,
  Gift,
  Sparkles,
  ShoppingBag,
  Download,
  Loader2,
  Lock,
  Printer,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { supabase } from '../supabase';
import type {
  CashSessionSummary,
  CashSessionSale,
  CashSessionWithdrawal,
} from '../lib/cashRegister';
import { fetchAndPrintCorteDeCaja } from '../lib/cashRegister';
import { formatDateTimeMX } from '../lib/datetime';

interface Props {
  session: CashSessionSummary;
  onClose: () => void;
  /** When provided, shows a "Cerrar caja" button for open sessions */
  onCloseRegister?: () => void;
}

const normalizePaymentLabel = (raw: string): string => {
  const m = raw.toLowerCase().trim();
  if (m.includes('efect') || m === 'cash') return 'Efectivo';
  if (m.includes('tarj') || m.includes('card')) return 'Tarjeta';
  if (m.includes('transfer')) return 'Transferencia';
  if (m.includes('mix')) return 'Mixto';
  return raw || 'Otro';
};

const paymentColor = (raw: string): string => {
  const m = raw.toLowerCase().trim();
  if (m.includes('efect') || m === 'cash') return 'text-green-400';
  if (m.includes('tarj') || m.includes('card')) return 'text-blue-400';
  if (m.includes('transfer')) return 'text-violet-300';
  return 'text-cc-text-muted';
};

export const CashSessionDetailModal = ({ session: s, onClose, onCloseRegister }: Props) => {
  const [sales, setSales] = useState<CashSessionSale[]>([]);
  const [withdrawals, setWithdrawals] = useState<CashSessionWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [printingCorte, setPrintingCorte] = useState(false);
  const [printCorteMsg, setPrintCorteMsg] = useState<string | null>(null);

  const handleExportCashSessionExcel = useCallback(async () => {
    if (loading) return;
    setExporting(true);
    try {
      const fmtDate = (d: string | null) => (d ? formatDateTimeMX(d) : '');

      /** Translate promotion_code to a readable label */
      const promoLabel = (code: string | null): string => {
        if (!code) return '';
        const c = code.toUpperCase();
        if (c.includes('INSTAGRAM') && c.includes('15')) return 'Instagram 15%';
        if (c.includes('INSTAGRAM')) return 'Instagram';
        // Generic: strip underscores and capitalise
        return code.replace(/_/g, ' ').replace(/PROMO\s*/i, '').trim() || code;
      };

      /** Build a short product summary for a sale given its items */
      const buildExcelProductSummary = (
        items: { quantity: number; name: string }[],
      ): string => {
        if (!items || items.length === 0) return 'Venta';
        const grouped: Record<string, number> = {};
        for (const it of items) {
          const n = it.name || 'Producto';
          grouped[n] = (grouped[n] || 0) + it.quantity;
        }
        const entries = Object.entries(grouped);
        if (entries.length === 1) {
          const [name, qty] = entries[0];
          return qty > 1 ? `${qty} × ${name}` : name;
        }
        const parts = entries.map(([name, qty]) => (qty > 1 ? `${qty} × ${name}` : name));
        const full = parts.join(' + ');
        if (full.length <= 60) return full;
        return `${parts[0]} + ${entries.length - 1} más`;
      };

      /* ── Fetch sale_items with product names for all session sales ── */
      let saleItemsMap: Record<string, { quantity: number; name: string }[]> = {};
      if (supabase && sales.length > 0) {
        try {
          const saleIds = sales.map((sa) => sa.id);
          const { data: siData } = await supabase
            .from('sale_items')
            .select('sale_id, quantity, products(name, flavor, size, grams)')
            .in('sale_id', saleIds);
          if (siData) {
            for (const row of siData as any[]) {
              const sid = String(row.sale_id);
              if (!saleItemsMap[sid]) saleItemsMap[sid] = [];
              const p = Array.isArray(row.products) ? row.products[0] : row.products;
              const nameParts: string[] = [];
              if (p?.flavor) nameParts.push(p.flavor);
              if (p?.name) nameParts.push(p.name);
              if (p?.size) nameParts.push(p.size);
              if (p?.grams) nameParts.push(`${p.grams}g`);
              saleItemsMap[sid].push({
                quantity: Number(row.quantity ?? 1),
                name: nameParts.length > 0 ? nameParts.join(' ') : (p?.name || 'Producto'),
              });
            }
          }
        } catch (err) {
          console.warn('[EXPORT] Could not fetch sale_items for Excel:', err);
        }
      }

      /* ── Hoja 1: Resumen ─────────────────────────────────── */
      const resumenData = [
        ['Campo', 'Valor'],
        ['ID sesión', resolvedSessionId || s.session_id],
        ['Estado', s.status === 'open' ? 'Abierta' : 'Cerrada'],
        ['Fecha apertura', fmtDate(s.opened_at)],
        ['Fecha cierre', fmtDate(s.closed_at)],
        ['Fondo inicial', s.opening_cash],
        ['Ventas efectivo', s.cash_sales_total],
        ['Ventas tarjeta', s.card_sales_total],
        ['Retiros', s.withdrawals_total],
        ['Efectivo esperado', s.expected_cash],
        ['Efectivo contado', s.counted_cash ?? ''],
        ['Diferencia', s.difference ?? ''],
        ['Número de ventas', s.sales_count],
        ['Número de retiros', s.withdrawals_count],
        ['Notas apertura', s.notes ?? ''],
        ['Notas cierre', s.close_notes ?? ''],
      ];
      const wsResumen = XLSX.utils.aoa_to_sheet(resumenData);
      wsResumen['!cols'] = [{ wch: 22 }, { wch: 40 }];

      /* ── Hoja 2: Ventas ──────────────────────────────────── */
      const ventasRows = sales.map((sale) => ({
        'Fecha / hora': fmtDate(sale.created_at),
        'Productos vendidos': buildExcelProductSummary(saleItemsMap[sale.id] || []),
        'Método de pago': normalizePaymentLabel(sale.payment_method),
        'Promoción': promoLabel(sale.promotion_code),
        'Descuento': sale.loyalty_discount_amount > 0 ? sale.loyalty_discount_amount : '',
        Total: sale.total,
      }));
      const wsVentas = XLSX.utils.json_to_sheet(ventasRows);
      wsVentas['!cols'] = [
        { wch: 22 }, { wch: 44 }, { wch: 16 }, { wch: 18 },
        { wch: 12 }, { wch: 12 },
      ];

      /* ── Hoja 3: Retiros ─────────────────────────────────── */
      const retirosRows = withdrawals.map((w) => ({
        'Fecha / hora': fmtDate(w.withdrawn_at),
        'ID retiro': w.id,
        Monto: w.amount,
        Motivo: w.reason,
        trigger_type: w.trigger_type,
        Notas: w.notes ?? '',
      }));
      const wsRetiros = XLSX.utils.json_to_sheet(retirosRows);
      wsRetiros['!cols'] = [
        { wch: 22 }, { wch: 38 }, { wch: 12 }, { wch: 28 },
        { wch: 14 }, { wch: 30 },
      ];

      /* ── Workbook ────────────────────────────────────────── */
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');
      XLSX.utils.book_append_sheet(wb, wsVentas, 'Ventas');
      XLSX.utils.book_append_sheet(wb, wsRetiros, 'Retiros');

      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

      /* ── File name ──────────────────────────────────────── */
      const d = new Date(s.opened_at);
      const pad = (n: number) => String(n).padStart(2, '0');
      const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
      const fileName = `CATCORN_CorteCaja_${datePart}.xlsx`;

      saveAs(
        new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        fileName,
      );
    } catch (err) {
      console.error('[EXPORT] Error exporting cash session:', err);
      alert('Error al exportar. Intenta de nuevo.');
    } finally {
      setExporting(false);
    }
  }, [loading, s, sales, withdrawals]);

  // Resolve the real UUID — the view may expose it as 'id' or 'session_id'
  const resolvedSessionId =
    (s.session_id && s.session_id.length > 8 ? s.session_id : null)
    ?? ((s as unknown as Record<string, unknown>).id
      ? String((s as unknown as Record<string, unknown>).id)
      : null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);

      console.log('[CORTE FIX] session recibido:', s);
      console.log('[CORTE FIX] resolvedSessionId:', resolvedSessionId);

      if (!resolvedSessionId) {
        console.error('[CORTE FIX] No valid session id found', s);
        setSales([]);
        setWithdrawals([]);
        setLoading(false);
        return;
      }

      let loadedSales: CashSessionSale[] = [];
      let loadedWithdrawals: CashSessionWithdrawal[] = [];

      if (supabase) {
        // ── Sales: query view directly ──────────────────────
        try {
          const { data: salesData, error: salesErr } = await supabase
            .from('v_cash_register_session_sales')
            .select('*')
            .eq('session_id', resolvedSessionId);

          console.log('[CORTE] sales view error:', salesErr?.message ?? 'none');
          console.log('[CORTE] sales view data:', salesData?.length ?? 0, 'rows');

          if (!salesErr && salesData) {
            loadedSales = salesData.map((d: Record<string, unknown>) => ({
              id: String(d.sale_id ?? d.id ?? ''),
              created_at: String(d.created_at ?? ''),
              payment_method: String(d.payment_method ?? ''),
              total: Number(d.total ?? 0),
              customer_id: d.customer_id ? String(d.customer_id) : null,
              promotion_code: d.promotion_code ? String(d.promotion_code) : null,
              loyalty_reward_applied: Boolean(d.loyalty_reward_applied),
              loyalty_discount_amount: Number(d.loyalty_discount_amount ?? 0),
            }));
          } else {
            // Fallback: query sales table directly
            console.warn('[CORTE] Falling back to sales table');
            const { data: fallback } = await supabase
              .from('sales')
              .select('id, created_at, payment_method, total, customer_id, promotion_code, loyalty_reward_applied, loyalty_discount_amount')
              .eq('cash_session_id', resolvedSessionId);
            if (fallback) {
              loadedSales = fallback.map((d: Record<string, unknown>) => ({
                id: String(d.id ?? ''),
                created_at: String(d.created_at ?? ''),
                payment_method: String(d.payment_method ?? ''),
                total: Number(d.total ?? 0),
                customer_id: d.customer_id ? String(d.customer_id) : null,
                promotion_code: d.promotion_code ? String(d.promotion_code) : null,
                loyalty_reward_applied: Boolean(d.loyalty_reward_applied),
                loyalty_discount_amount: Number(d.loyalty_discount_amount ?? 0),
              }));
            }
          }
        } catch (err) {
          console.error('[CORTE] Exception loading sales:', err);
        }

        // ── Withdrawals: query view directly ────────────────
        try {
          const { data: wdData, error: wdErr } = await supabase
            .from('v_cash_register_session_withdrawals')
            .select('*')
            .eq('session_id', resolvedSessionId);

          console.log('[CORTE] withdrawals view error:', wdErr?.message ?? 'none');
          console.log('[CORTE] withdrawals view data:', wdData?.length ?? 0, 'rows');

          if (!wdErr && wdData) {
            loadedWithdrawals = wdData.map((d: Record<string, unknown>) => ({
              id: String(d.withdrawal_id ?? d.id ?? ''),
              withdrawn_at: String(d.withdrawn_at ?? ''),
              amount: Number(d.amount ?? 0),
              reason: String(d.reason ?? ''),
              trigger_type: String(d.trigger_type ?? ''),
              notes: d.notes ? String(d.notes) : null,
            }));
          } else {
            // Fallback: query cash_withdrawals table directly
            console.warn('[CORTE] Falling back to cash_withdrawals table');
            const { data: fallback } = await supabase
              .from('cash_withdrawals')
              .select('id, withdrawn_at, amount, reason, trigger_type, notes')
              .eq('session_id', resolvedSessionId);
            if (fallback) {
              loadedWithdrawals = fallback.map((d: Record<string, unknown>) => ({
                id: String(d.id ?? ''),
                withdrawn_at: String(d.withdrawn_at ?? ''),
                amount: Number(d.amount ?? 0),
                reason: String(d.reason ?? ''),
                trigger_type: String(d.trigger_type ?? ''),
                notes: d.notes ? String(d.notes) : null,
              }));
            }
          }
        } catch (err) {
          console.error('[CORTE] Exception loading withdrawals:', err);
        }
      }

      if (!cancelled) {
        console.log('[CORTE] Setting state — sales:', loadedSales.length, 'withdrawals:', loadedWithdrawals.length);
        setSales(loadedSales);
        setWithdrawals(loadedWithdrawals);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [resolvedSessionId]);

  const isOpen = s.status === 'open';
  const diff = s.difference;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-cc-surface border border-white/10 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="p-5 border-b border-white/10 bg-white/5 flex items-start justify-between flex-shrink-0">
          <div>
            <h3 className="text-xl font-bold text-cc-cream mb-1">Detalle del Corte</h3>
            <div className="flex items-center gap-3 text-xs text-cc-text-muted flex-wrap">
              <span className="font-mono">#{(resolvedSessionId || '').substring(0, 8).toUpperCase()}</span>
              <span>•</span>
              {isOpen ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Abierta
                </span>
              ) : (
                <span className="text-[10px] font-bold text-cc-text-muted bg-white/5 px-2 py-0.5 rounded-full">
                  Cerrada
                </span>
              )}
              <span>•</span>
              <span>{formatDateTimeMX(s.opened_at)}</span>
              {s.closed_at && (
                <>
                  <span>→</span>
                  <span>{formatDateTimeMX(s.closed_at)}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isOpen && onCloseRegister && (
              <button
                onClick={onCloseRegister}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all
                  bg-red-500/15 text-red-400 border border-red-500/30
                  hover:bg-red-500/25 hover:border-red-500/50"
              >
                <Lock size={14} />
                Cerrar caja
              </button>
            )}
            <button
              onClick={handleExportCashSessionExcel}
              disabled={loading || exporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all
                bg-cc-primary/15 text-cc-primary border border-cc-primary/30
                hover:bg-cc-primary/25 hover:border-cc-primary/50
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {exporting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              {exporting ? 'Exportando…' : 'Exportar Excel'}
            </button>
            <button
              onClick={async () => {
                setPrintingCorte(true);
                setPrintCorteMsg(null);
                try {
                  await fetchAndPrintCorteDeCaja(s);
                  setPrintCorteMsg('✅ Corte impreso');
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : 'Error de impresión';
                  setPrintCorteMsg('❌ ' + msg);
                } finally {
                  setPrintingCorte(false);
                }
              }}
              disabled={loading || printingCorte}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all
                bg-white/10 text-cc-cream border border-white/20
                hover:bg-white/15 hover:border-white/30
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {printingCorte ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Printer size={14} />
              )}
              {printingCorte ? 'Imprimiendo…' : 'Imprimir Corte'}
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X size={20} className="text-cc-text-muted hover:text-cc-text-main" />
            </button>
          </div>
        </div>

        {/* Print status message */}
        {printCorteMsg && (
          <div className={`px-5 py-2 text-xs text-center ${printCorteMsg.startsWith('✅') ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
            {printCorteMsg}
          </div>
        )}

        {/* ── Scrollable body ────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* ── Financial summary cards ──────────────────────────── */}
          <div>
            <h4 className="text-xs font-bold text-cc-text-muted uppercase tracking-wide mb-3">
              Resumen financiero
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard
                icon={<DollarSign size={14} />}
                label="Fondo inicial"
                value={`$${s.opening_cash.toFixed(2)}`}
                color="text-cc-cream"
              />
              <SummaryCard
                icon={<Banknote size={14} />}
                label="Ventas efectivo"
                value={`$${s.cash_sales_total.toFixed(2)}`}
                color="text-green-400"
              />
              <SummaryCard
                icon={<CreditCard size={14} />}
                label="Ventas tarjeta"
                value={`$${s.card_sales_total.toFixed(2)}`}
                color="text-blue-400"
              />
              <SummaryCard
                icon={<ArrowDownCircle size={14} />}
                label="Retiros"
                value={s.withdrawals_total > 0 ? `-$${s.withdrawals_total.toFixed(2)}` : '$0.00'}
                color="text-orange-400"
              />
            </div>

            {/* Expected / Counted / Difference row */}
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="px-3 py-2.5 bg-cc-primary/10 border border-cc-primary/20 rounded-lg">
                <div className="text-[10px] text-cc-text-muted uppercase mb-0.5">Esperado</div>
                <div className="text-lg font-bold text-cc-primary">
                  ${s.expected_cash.toFixed(2)}
                </div>
              </div>
              <div className="px-3 py-2.5 bg-black/30 border border-white/5 rounded-lg">
                <div className="text-[10px] text-cc-text-muted uppercase mb-0.5">Contado</div>
                <div className="text-lg font-bold text-cc-cream">
                  {s.counted_cash != null ? `$${s.counted_cash.toFixed(2)}` : '—'}
                </div>
              </div>
              <div
                className={`px-3 py-2.5 rounded-lg border ${
                  diff == null
                    ? 'bg-black/30 border-white/5'
                    : Math.abs(diff) < 0.5
                      ? 'bg-green-500/10 border-green-500/30'
                      : diff > 0
                        ? 'bg-yellow-500/10 border-yellow-500/30'
                        : 'bg-red-500/10 border-red-500/30'
                }`}
              >
                <div className="text-[10px] text-cc-text-muted uppercase mb-0.5">Diferencia</div>
                <div
                  className={`text-lg font-bold ${
                    diff == null
                      ? 'text-cc-text-muted'
                      : Math.abs(diff) < 0.5
                        ? 'text-green-400'
                        : diff > 0
                          ? 'text-yellow-400'
                          : 'text-red-400'
                  }`}
                >
                  {diff != null ? `${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}` : '—'}
                </div>
              </div>
            </div>

            {/* Notes */}
            {(s.notes || s.close_notes) && (
              <div className="mt-3 text-xs text-cc-text-muted space-y-1">
                {s.notes && <p><span className="font-medium text-cc-cream">Notas apertura:</span> {s.notes}</p>}
                {s.close_notes && <p><span className="font-medium text-cc-cream">Notas cierre:</span> {s.close_notes}</p>}
              </div>
            )}
          </div>

          {/* ── Sales table ──────────────────────────────────────── */}
          <div>
            <h4 className="text-xs font-bold text-cc-text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
              <Receipt size={14} className="text-cc-primary" />
              Ventas del corte ({loading ? '…' : sales.length})
            </h4>

            {loading ? (
              <div className="text-center text-cc-text-muted text-sm py-8 animate-pulse">
                Cargando ventas…
              </div>
            ) : sales.length === 0 ? (
              <div className="text-center text-cc-text-muted py-8 bg-black/20 rounded-lg border border-white/5">
                <ShoppingBag size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No hay ventas en este corte</p>
              </div>
            ) : (
              <div className="bg-black/20 rounded-lg border border-white/5 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-cc-text-muted border-b border-white/10 bg-black/20">
                        <th className="text-left py-2.5 px-3 font-medium">Fecha</th>
                        <th className="text-left py-2.5 px-3 font-medium">ID</th>
                        <th className="text-center py-2.5 px-3 font-medium">Método</th>
                        <th className="text-right py-2.5 px-3 font-medium">Total</th>
                        <th className="text-center py-2.5 px-3 font-medium">Promo</th>
                        <th className="text-center py-2.5 px-3 font-medium">Fidelidad</th>
                        <th className="text-right py-2.5 px-3 font-medium">Desc. Fidelidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sales.map((sale) => (
                        <tr
                          key={sale.id}
                          className="border-b border-white/5 hover:bg-white/5 transition-colors"
                        >
                          <td className="py-2.5 px-3 text-cc-text-muted whitespace-nowrap">
                            {formatDateTimeMX(sale.created_at)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-cc-text-main">
                            #{sale.id.substring(0, 8).toUpperCase()}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`font-semibold ${paymentColor(sale.payment_method)}`}>
                              {normalizePaymentLabel(sale.payment_method)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-cc-primary">
                            ${sale.total.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {sale.promotion_code ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-cc-accent/10 text-cc-accent px-1.5 py-0.5 rounded-full">
                                {sale.promotion_code.includes('INSTAGRAM') ? (
                                  <><Sparkles size={9} /> IG</>
                                ) : (
                                  <><Tag size={9} /> {sale.promotion_code.slice(0, 10)}</>
                                )}
                              </span>
                            ) : (
                              <span className="text-cc-text-muted/40">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {sale.loyalty_reward_applied ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded-full">
                                <Gift size={9} /> Sí
                              </span>
                            ) : (
                              <span className="text-cc-text-muted/40">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {sale.loyalty_discount_amount > 0 ? (
                              <span className="font-semibold text-green-400">
                                -${sale.loyalty_discount_amount.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-cc-text-muted/40">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ── Withdrawals table ────────────────────────────────── */}
          <div>
            <h4 className="text-xs font-bold text-cc-text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
              <ArrowDownCircle size={14} className="text-orange-400" />
              Retiros del corte ({loading ? '…' : withdrawals.length})
            </h4>

            {loading ? (
              <div className="text-center text-cc-text-muted text-sm py-8 animate-pulse">
                Cargando retiros…
              </div>
            ) : withdrawals.length === 0 ? (
              <div className="text-center text-cc-text-muted py-8 bg-black/20 rounded-lg border border-white/5">
                <ArrowDownCircle size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No hay retiros en este corte</p>
              </div>
            ) : (
              <div className="bg-black/20 rounded-lg border border-white/5 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-cc-text-muted border-b border-white/10 bg-black/20">
                        <th className="text-left py-2.5 px-3 font-medium">Fecha</th>
                        <th className="text-right py-2.5 px-3 font-medium">Monto</th>
                        <th className="text-left py-2.5 px-3 font-medium">Motivo</th>
                        <th className="text-center py-2.5 px-3 font-medium">Tipo</th>
                        <th className="text-left py-2.5 px-3 font-medium">Notas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {withdrawals.map((w) => (
                        <tr
                          key={w.id}
                          className="border-b border-white/5 hover:bg-white/5 transition-colors"
                        >
                          <td className="py-2.5 px-3 text-cc-text-muted whitespace-nowrap">
                            {formatDateTimeMX(w.withdrawn_at)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-orange-400">
                            -${w.amount.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-cc-text-main">
                            {w.reason}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                              w.trigger_type === 'manual'
                                ? 'bg-white/5 text-cc-text-muted'
                                : 'bg-orange-500/15 text-orange-400'
                            }`}>
                              {w.trigger_type}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-cc-text-muted">
                            {w.notes || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Small helper component ─────────────────────────────────────────────── */

function SummaryCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="px-3 py-2.5 bg-black/30 rounded-lg border border-white/5">
      <div className="text-[10px] text-cc-text-muted uppercase mb-0.5 flex items-center gap-1">
        {icon} {label}
      </div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}
