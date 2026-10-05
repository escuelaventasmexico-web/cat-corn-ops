import { supabase } from '../supabase';
import { printCorteDeCaja, buildProductSummary } from './printReceipt';
import type { CorteDeCajaData, CorteTransaction } from './printReceipt';
import { supabaseError } from './supabaseError';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape returned by the view v_open_cash_register_status */
export interface CashRegisterStatus {
  session_id: string | null;
  opening_cash: number;
  cash_sales_total: number;
  card_sales_total: number;
  withdrawals_total: number;
  current_cash: number;
  needs_withdrawal: boolean;
  opened_at: string | null;
  opened_by: string | null;
  notes: string | null;
}

/** Shape returned by the view v_cash_register_sessions_summary */
export interface CashSessionSummary {
  session_id: string;
  branch_id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  /** Calculated from actual sales rows with payment_method = CASH */
  cash_sales_total: number;
  /** Calculated from actual sales rows with payment_method = CARD */
  card_sales_total: number;
  /** Calculated from actual cash_withdrawals rows */
  withdrawals_total: number;
  /** opening_cash + cash_sales − withdrawals (card NOT included — not physical cash) */
  expected_cash: number;
  counted_cash: number | null;
  /** counted_cash - expected_cash */
  difference: number | null;
  sales_count: number;
  withdrawals_count: number;
  opened_by: string | null;
  closed_by: string | null;
  notes: string | null;
  close_notes: string | null;
  inventory_opening_corn_kg?: number | null;
  inventory_closing_corn_kg?: number | null;
  inventory_opening_oil_liters?: number | null;
  inventory_closing_oil_liters?: number | null;
}

/** Result from close_cash_register_session RPC */
export interface CloseResult {
  expected_cash: number;
  counted_cash: number;
  difference: number;
}

export interface CashInventoryInput {
  cornKg: number;
  oilLiters: number;
}

export interface CashInventoryControlContract {
  branch_id: string;
  control_enabled: boolean;
  requires_opening_counts: boolean;
  requires_closing_counts: boolean;
  corn_label: string;
  corn_unit: string;
  oil_label: string;
  oil_unit: string;
}

export type CashInventoryContractState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; contract: CashInventoryControlContract };

export type CashInventoryPhase = 'opening' | 'closing';

export function resolveCashInventoryFlow(
  state: CashInventoryContractState,
  branchId: string,
  phase: CashInventoryPhase,
): 'controlled' | 'legacy' {
  if (state.status !== 'ready') {
    throw new Error('El contrato de control de caja todavía no está disponible');
  }
  if (state.contract.branch_id !== branchId) {
    throw new Error('El contrato de control de caja no corresponde a la sucursal seleccionada');
  }

  const required = phase === 'opening'
    ? state.contract.requires_opening_counts
    : state.contract.requires_closing_counts;
  return state.contract.control_enabled && required ? 'controlled' : 'legacy';
}

export interface CashInventoryCountPhase {
  corn_kg: number | null;
  oil_liters: number | null;
  counted_at: string | null;
}

export interface CashInventorySessionState {
  controlled: boolean;
  opening: CashInventoryCountPhase;
  closing: CashInventoryCountPhase;
  close_summary: Record<string, unknown> | null;
}

export interface CashInventoryHistoryRow {
  cash_session_id: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  session_status: string;
  opened_at: string;
  closed_at: string | null;
  phase: 'opening' | 'closing';
  counted_at: string;
  counted_by: string;
  counted_by_name: string;
  corn_kg: number;
  oil_liters: number;
  corn_g: number;
  oil_ml: number;
  opening_cash: number;
  counted_cash: number | null;
  expected_cash: number | null;
  cash_difference: number | null;
  close_summary: Record<string, unknown> | null;
}

/** A sale belonging to a cash session (detail view) */
export interface CashSessionSale {
  id: string;
  created_at: string;
  payment_method: string;
  total: number;
  customer_id: string | null;
  promotion_code: string | null;
  loyalty_reward_applied: boolean;
  loyalty_discount_amount: number;
}

/** A withdrawal belonging to a cash session (detail view) */
export interface CashSessionWithdrawal {
  id: string;
  withdrawn_at: string;
  amount: number;
  reason: string;
  trigger_type: string;
  notes: string | null;
}

/** Null-safe default when no session is open */
export const EMPTY_CASH_STATUS: CashRegisterStatus = {
  session_id: null,
  opening_cash: 0,
  cash_sales_total: 0,
  card_sales_total: 0,
  withdrawals_total: 0,
  current_cash: 0,
  needs_withdrawal: false,
  opened_at: null,
  opened_by: null,
  notes: null,
};

export async function fetchCashInventoryControlForBranch(
  branchId: string,
): Promise<CashInventoryControlContract> {
  if (!supabase) throw new Error('Supabase no configurado');

  const { data, error } = await supabase.rpc('get_cash_inventory_control_for_branch', {
    p_branch_id: branchId,
  });
  if (error) {
    console.error('[CASH] Error fetching branch cash-control contract:', error);
    throw supabaseError(error, 'No se pudo consultar el control de caja de la sucursal');
  }
  if (!data || typeof data !== 'object') {
    throw new Error('La RPC de control de caja devolvió un contrato vacío');
  }

  const value = data as Record<string, unknown>;
  if (
    String(value.branch_id || '') !== branchId
    || typeof value.control_enabled !== 'boolean'
    || typeof value.requires_opening_counts !== 'boolean'
    || typeof value.requires_closing_counts !== 'boolean'
    || typeof value.corn_label !== 'string'
    || typeof value.corn_unit !== 'string'
    || typeof value.oil_label !== 'string'
    || typeof value.oil_unit !== 'string'
  ) {
    throw new Error('La RPC de control de caja devolvió un contrato inválido');
  }

  return value as unknown as CashInventoryControlContract;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** Fetch the current open session strictly for one authorized branch. */
export async function fetchCashStatus(branchId: string): Promise<CashRegisterStatus> {
  if (!supabase) return EMPTY_CASH_STATUS;

  const { data: sessionRow, error: sessionErr } = await supabase
    .from('cash_register_sessions')
    .select('*')
    .eq('branch_id', branchId)
    .eq('status', 'open')
    .is('closed_at', null)
    .maybeSingle();

  if (sessionErr) {
    console.error('[CASH] Error fetching branch register:', sessionErr);
    throw supabaseError(sessionErr, 'No se pudo consultar la caja de la sucursal');
  }

  if (!sessionRow) {
    return EMPTY_CASH_STATUS;
  }

  const sessionId: string = sessionRow.id as string;
  console.log('[CASH] Found open session via direct query:', sessionId);

  // Aggregate sales for this session
  const { data: salesRows } = await supabase
    .from('sales')
    .select('payment_method, total, cash_amount, card_amount')
    .eq('branch_id', branchId)
    .eq('cash_session_id', sessionId)
    .eq('is_refunded', false)
    .eq('sale_origin', 'pos');

  let cashSalesTotal = 0;
  let cardSalesTotal = 0;
  for (const sale of salesRows || []) {
    const method = String(sale.payment_method ?? '').toUpperCase();
    const amount = Number(sale.total ?? 0);
    const cashAmt = sale.cash_amount != null ? Number(sale.cash_amount) : null;
    const cardAmt = sale.card_amount != null ? Number(sale.card_amount) : null;
    if (method === 'MIXED' && cashAmt != null && cardAmt != null) {
      cashSalesTotal += cashAmt;
      cardSalesTotal += cardAmt;
    } else if (method === 'CASH') {
      cashSalesTotal += amount;
    } else if (method === 'CARD') {
      cardSalesTotal += amount;
    } else if (method === 'TRANSFER') {
      // Transfer doesn't go into register cash or card — it's separate
      // No impact on cash register totals
    } else {
      // Legacy MIXED without split columns — attribute to cash
      cashSalesTotal += amount;
    }
  }

  // Aggregate withdrawals
  const { data: wdRows } = await supabase
    .from('cash_withdrawals')
    .select('amount')
    .eq('session_id', sessionId);

  let withdrawalsTotal = 0;
  for (const w of wdRows || []) withdrawalsTotal += Number(w.amount ?? 0);

  const openingCash = Number(sessionRow.opening_cash ?? 0);
  const currentCash = openingCash + cashSalesTotal - withdrawalsTotal;

  const status: CashRegisterStatus = {
    session_id: sessionId,
    opening_cash: openingCash,
    cash_sales_total: cashSalesTotal,
    card_sales_total: cardSalesTotal,
    withdrawals_total: withdrawalsTotal,
    current_cash: currentCash,
    needs_withdrawal: currentCash > 5000,
    opened_at: (sessionRow.opened_at as string) ?? null,
    opened_by: (sessionRow.opened_by as string) ?? null,
    notes: (sessionRow.notes as string) ?? null,
  };

  console.log('[CASH] open status (fallback)', status);
  return status;
}

/**
 * Open a new cash register session via the Supabase RPC.
 * Throws on error (e.g. a session is already open).
 */
export async function openCashRegisterForBranch(
  branchId: string,
  openingCash: number,
  contract: CashInventoryControlContract,
  notes?: string,
  inventory?: CashInventoryInput,
): Promise<void> {
  if (!supabase) throw new Error('Supabase no configurado');

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('No hay usuario autenticado');

  const flow = resolveCashInventoryFlow({ status: 'ready', contract }, branchId, 'opening');
  if (flow === 'controlled' && !inventory) {
    throw new Error('Los conteos de maíz y aceite son obligatorios para abrir esta sucursal');
  }
  if (flow === 'legacy' && inventory) {
    throw new Error('La sucursal seleccionada no usa conteos de inventario en la apertura');
  }

  const { error } = flow === 'controlled'
    ? await supabase.rpc('open_cash_register_with_inventory_for_branch', {
        p_branch_id: branchId,
        p_opening_cash: openingCash,
        p_corn_kg: inventory!.cornKg,
        p_oil_liters: inventory!.oilLiters,
        p_notes: notes || null,
      })
    : await supabase.rpc('open_cash_register_session_for_branch', {
        p_branch_id: branchId,
        p_opening_cash: openingCash,
        p_opened_by: user.id,
        p_notes: notes || null,
      });

  if (error) {
    console.error('[CASH] Error opening register:', error);
    throw supabaseError(error, 'No se pudo abrir la caja');
  }
}

/**
 * Fetch the open session id for one branch immediately before a POS insert.
 * No global-table fallback is allowed: a missing result means that branch has
 * no open session.
 * Returns null when no session is open.
 */
export async function getOpenSessionIdForBranch(branchId: string): Promise<string | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.rpc('get_open_cash_register_session_for_branch', {
    p_branch_id: branchId,
  });

  if (error) {
    console.error('[CASH] Error fetching open session:', error);
    throw supabaseError(error, 'No se pudo consultar la caja de la sucursal');
  }

  // The RPC may return a UUID string or an object with an id field
  if (typeof data === 'string' && data) return data;
  if (data && typeof data === 'object' && 'id' in data) return (data as { id: string }).id;

  return null;
}

// ─── Withdrawal ───────────────────────────────────────────────────────────────

/**
 * Register a cash withdrawal for the currently open session.
 */
export async function registerWithdrawalForBranch(
  branchId: string,
  sessionId: string,
  amount: number,
  reason: string,
  notes?: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase no configurado');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No hay usuario autenticado');

  const { error } = await supabase.rpc('register_cash_withdrawal_for_branch', {
    p_branch_id: branchId,
    p_session_id: sessionId,
    p_amount: amount,
    p_reason: reason,
    p_trigger_type: 'manual',
    p_created_by: user.id,
    p_notes: notes || null,
  });

  if (error) {
    console.error('[CASH] Error registering withdrawal:', error);
    throw supabaseError(error, 'No se pudo registrar el retiro');
  }
}

// ─── Close session ────────────────────────────────────────────────────────────

/**
 * Close the currently open cash register session.
 * Returns the close result with expected / counted / difference.
 */
export async function closeCashRegisterForBranch(
  branchId: string,
  sessionId: string,
  countedCash: number,
  contract: CashInventoryControlContract,
  notes?: string,
  inventory?: CashInventoryInput,
): Promise<CloseResult> {
  if (!supabase) throw new Error('Supabase no configurado');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No hay usuario autenticado');

  const flow = resolveCashInventoryFlow({ status: 'ready', contract }, branchId, 'closing');
  if (flow === 'controlled' && !inventory) {
    throw new Error('Los conteos de maíz y aceite son obligatorios para cerrar esta sucursal');
  }
  if (flow === 'legacy' && inventory) {
    throw new Error('La sucursal seleccionada no usa conteos de inventario en el cierre');
  }

  const { data, error } = flow === 'controlled'
    ? await supabase.rpc('close_cash_register_with_inventory_for_branch', {
        p_branch_id: branchId,
        p_session_id: sessionId,
        p_counted_cash: countedCash,
        p_corn_kg: inventory!.cornKg,
        p_oil_liters: inventory!.oilLiters,
        p_notes: notes || null,
      })
    : await supabase.rpc('close_cash_register_session_for_branch', {
        p_branch_id: branchId,
        p_session_id: sessionId,
        p_counted_cash: countedCash,
        p_closed_by: user.id,
        p_notes: notes || null,
      });

  if (error) {
    console.error('[CASH] Error closing register:', error);
    throw supabaseError(error, 'No se pudo cerrar la caja');
  }

  // The RPC might return a JSON object or void – normalise
  if (data && typeof data === 'object') {
    return {
      expected_cash: Number((data as Record<string, unknown>).expected_cash ?? 0),
      counted_cash: Number((data as Record<string, unknown>).counted_cash ?? countedCash),
      difference: Number((data as Record<string, unknown>).difference ?? 0),
    };
  }

  // If the RPC doesn't return data, build a synthetic result from the status we
  // already had before close (caller can pass it in via the UI).
  return { expected_cash: 0, counted_cash: countedCash, difference: 0 };
}

export async function fetchCashInventorySessionState(
  branchId: string,
  sessionId: string,
): Promise<CashInventorySessionState> {
  if (!supabase) throw new Error('Supabase no configurado');

  const { data, error } = await supabase.rpc('get_cash_inventory_session_state', {
    p_branch_id: branchId,
    p_session_id: sessionId,
  });
  if (error) {
    console.error('[CASH] Error fetching inventory session state:', error);
    throw supabaseError(error, 'No se pudieron consultar los conteos de la sesión');
  }

  const value = (data || {}) as Record<string, any>;
  const normalizePhase = (phase: Record<string, unknown> | null | undefined): CashInventoryCountPhase => ({
    corn_kg: phase?.corn_kg == null ? null : Number(phase.corn_kg),
    oil_liters: phase?.oil_liters == null ? null : Number(phase.oil_liters),
    counted_at: phase?.counted_at ? String(phase.counted_at) : null,
  });

  return {
    controlled: Boolean(value.controlled),
    opening: normalizePhase(value.opening),
    closing: normalizePhase(value.closing),
    close_summary: value.close_summary || null,
  };
}

export async function fetchCashInventoryHistoryAdmin(): Promise<CashInventoryHistoryRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_cash_inventory_history_admin');
  if (error) {
    console.error('[CASH] Error fetching inventory history:', error);
    throw supabaseError(error, 'No se pudo consultar el historial de conteos');
  }

  return ((data || []) as Record<string, unknown>[]).map((row) => ({
    cash_session_id: String(row.cash_session_id),
    branch_id: String(row.branch_id),
    branch_code: String(row.branch_code),
    branch_name: String(row.branch_name),
    session_status: String(row.session_status),
    opened_at: String(row.opened_at),
    closed_at: row.closed_at ? String(row.closed_at) : null,
    phase: String(row.phase) as 'opening' | 'closing',
    counted_at: String(row.counted_at),
    counted_by: String(row.counted_by),
    counted_by_name: String(row.counted_by_name || 'Usuario'),
    corn_kg: Number(row.corn_kg),
    oil_liters: Number(row.oil_liters),
    corn_g: Number(row.corn_g),
    oil_ml: Number(row.oil_ml),
    opening_cash: Number(row.opening_cash),
    counted_cash: row.counted_cash == null ? null : Number(row.counted_cash),
    expected_cash: row.expected_cash == null ? null : Number(row.expected_cash),
    cash_difference: row.cash_difference == null ? null : Number(row.cash_difference),
    close_summary: (row.close_summary as Record<string, unknown> | null) || null,
  }));
}

// ─── History ──────────────────────────────────────────────────────────────────

/**
 * Fetch the sessions summary from the view, most recent first.
 */
export async function fetchSessionsHistory(branchId: string): Promise<CashSessionSummary[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('v_cash_register_sessions_summary')
    .select('*')
    .eq('branch_id', branchId)
    .order('opened_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[CASH] Error fetching sessions history:', error);
    throw supabaseError(error, 'No se pudo consultar el historial de cortes');
  }

  const sessions = (data || []).map((d: Record<string, unknown>) => {
    // Prefer calculated_* columns from the view; fall back to old column names
    const cashSales = Number(d.calculated_cash_sales ?? d.cash_sales_total ?? 0);
    const cardSales = Number(d.calculated_card_sales ?? d.card_sales_total ?? 0);
    const wdTotal = Number(d.calculated_withdrawals_total ?? d.withdrawals_total ?? 0);
    const openingCash = Number(d.opening_cash ?? 0);
    // expected = fondo + cash sales − withdrawals (card NOT included — not physical cash)
    // Always compute in JS — the DB view may still have the old formula
    const expectedCash = openingCash + cashSales - wdTotal;
    const countedCash = d.counted_cash != null ? Number(d.counted_cash) : null;
    // Always compute difference from our JS expected — DB columns may have old formula
    const diff = countedCash != null ? countedCash - expectedCash : null;

    return {
      session_id: String(d.session_id ?? d.id ?? ''),
      branch_id: String(d.branch_id ?? branchId),
      status: String(d.status ?? ''),
      opened_at: String(d.opened_at ?? ''),
      closed_at: d.closed_at ? String(d.closed_at) : null,
      opening_cash: openingCash,
      cash_sales_total: cashSales,
      card_sales_total: cardSales,
      withdrawals_total: wdTotal,
      expected_cash: expectedCash,
      counted_cash: countedCash,
      difference: diff,
      sales_count: Number(d.sales_count ?? 0),
      withdrawals_count: Number(d.withdrawals_count ?? 0),
      opened_by: d.opened_by ? String(d.opened_by) : null,
      closed_by: d.closed_by ? String(d.closed_by) : null,
      notes: d.notes ? String(d.notes) : null,
      close_notes: d.close_notes ? String(d.close_notes) : null,
    };
  });

  // The count history is administrative and optional. Legacy sessions keep
  // rendering even when the incremental migration has not been installed yet.
  try {
    const countRows = await fetchCashInventoryHistoryAdmin();
    const countsBySession = new Map<string, Partial<CashSessionSummary>>();
    countRows.forEach((row) => {
      const current = countsBySession.get(row.cash_session_id) || {};
      if (row.phase === 'opening') {
        current.inventory_opening_corn_kg = row.corn_kg;
        current.inventory_opening_oil_liters = row.oil_liters;
      } else {
        current.inventory_closing_corn_kg = row.corn_kg;
        current.inventory_closing_oil_liters = row.oil_liters;
      }
      countsBySession.set(row.cash_session_id, current);
    });
    return sessions.map((session) => ({
      ...session,
      ...(countsBySession.get(session.session_id) || {}),
    }));
  } catch (inventoryError) {
    console.warn('[CASH] Inventory count history unavailable:', inventoryError);
    return sessions;
  }
}

// ─── Session detail ───────────────────────────────────────────────────────────

/**
 * Fetch all sales linked to a specific cash session.
 * Uses the v_cash_register_session_sales view; falls back to the sales table
 * only when the view query errors.
 */
export async function fetchSessionSales(sessionId: string, branchId: string): Promise<CashSessionSale[]> {
  if (!supabase) return [];

  console.log('[CASH] Fetching sales for session', sessionId);

  // 1) Primary: query the dedicated view
  const { data: viewData, error: viewErr } = await supabase
    .from('v_cash_register_session_sales')
    .select('*')
    .eq('session_id', sessionId)
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false });

  if (!viewErr) {
    const rows = (viewData || []) as Record<string, unknown>[];
    console.log('[CASH] v_cash_register_session_sales returned', rows.length, 'rows');
    return rows.map((d) => ({
      id: String(d.sale_id ?? d.id ?? ''),
      created_at: String(d.created_at ?? ''),
      payment_method: String(d.payment_method ?? ''),
      total: Number(d.total ?? 0),
      customer_id: d.customer_id ? String(d.customer_id) : null,
      promotion_code: d.promotion_code ? String(d.promotion_code) : null,
      loyalty_reward_applied: Boolean(d.loyalty_reward_applied),
      loyalty_discount_amount: Number(d.loyalty_discount_amount ?? 0),
    }));
  }

  // 2) Fallback: view errored — try the sales table directly
  console.warn('[CASH] View v_cash_register_session_sales unavailable, falling back:', viewErr.message);

  const { data: tableData, error: tableErr } = await supabase
    .from('sales')
    .select('id, created_at, payment_method, total, customer_id, promotion_code, loyalty_reward_applied, loyalty_discount_amount')
    .eq('branch_id', branchId)
    .eq('cash_session_id', sessionId)
    .eq('is_refunded', false)
    .eq('sale_origin', 'pos')
    .order('created_at', { ascending: false });

  if (tableErr) {
    console.error('[CASH] Error fetching session sales from table:', tableErr.message);
    return [];
  }

  const fallbackRows = (tableData || []) as Record<string, unknown>[];
  console.log('[CASH] sales table fallback returned', fallbackRows.length, 'rows');
  return fallbackRows.map((d) => ({
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

/**
 * Fetch all withdrawals linked to a specific cash session.
 * Uses the v_cash_register_session_withdrawals view; falls back to the table
 * only when the view query errors.
 */
export async function fetchSessionWithdrawals(sessionId: string): Promise<CashSessionWithdrawal[]> {
  if (!supabase) return [];

  console.log('[CASH] Fetching withdrawals for session', sessionId);

  // 1) Primary: query the dedicated view
  const { data: viewData, error: viewErr } = await supabase
    .from('v_cash_register_session_withdrawals')
    .select('*')
    .eq('session_id', sessionId)
    .order('withdrawn_at', { ascending: false });

  if (!viewErr) {
    const rows = (viewData || []) as Record<string, unknown>[];
    console.log('[CASH] v_cash_register_session_withdrawals returned', rows.length, 'rows');
    return rows.map((d) => ({
      id: String(d.withdrawal_id ?? d.id ?? ''),
      withdrawn_at: String(d.withdrawn_at ?? ''),
      amount: Number(d.amount ?? 0),
      reason: String(d.reason ?? ''),
      trigger_type: String(d.trigger_type ?? ''),
      notes: d.notes ? String(d.notes) : null,
    }));
  }

  // 2) Fallback: view errored — try the table directly
  console.warn('[CASH] View v_cash_register_session_withdrawals unavailable, falling back:', viewErr.message);

  const { data: tableData, error: tableErr } = await supabase
    .from('cash_withdrawals')
    .select('id, withdrawn_at, amount, reason, trigger_type, notes')
    .eq('session_id', sessionId)
    .order('withdrawn_at', { ascending: false });

  if (tableErr) {
    console.error('[CASH] Error fetching session withdrawals from table:', tableErr.message);
    return [];
  }

  const fallbackRows = (tableData || []) as Record<string, unknown>[];
  console.log('[CASH] cash_withdrawals table fallback returned', fallbackRows.length, 'rows');
  return fallbackRows.map((d) => ({
    id: String(d.id ?? ''),
    withdrawn_at: String(d.withdrawn_at ?? ''),
    amount: Number(d.amount ?? 0),
    reason: String(d.reason ?? ''),
    trigger_type: String(d.trigger_type ?? ''),
    notes: d.notes ? String(d.notes) : null,
  }));
}

// ─── Print Corte de Caja ──────────────────────────────────────────────────────

const normalizePaymentLabel = (raw: string): string => {
  const m = raw.toLowerCase().trim();
  if (m.includes('efect') || m === 'cash') return 'Efectivo';
  if (m.includes('tarj') || m.includes('card')) return 'Tarjeta';
  if (m.includes('mix')) return 'Mixto';
  return raw || 'Otro';
};

/**
 * Fetch all data for a cash session and print the corte de caja ticket.
 * Works for both open and closed sessions.
 */
export async function fetchAndPrintCorteDeCaja(
  session: CashSessionSummary,
): Promise<void> {
  if (!supabase) throw new Error('Supabase no configurado');

  const sessionId =
    (session.session_id && session.session_id.length > 8 ? session.session_id : null)
    ?? ((session as unknown as Record<string, unknown>).id
      ? String((session as unknown as Record<string, unknown>).id)
      : '');

  if (!sessionId) throw new Error('No se encontró un ID de sesión válido');

  console.info('[CORTE PRINT] Fetching data for session', sessionId);

  // 1. Fetch sales for this session (view already excludes refunded; filter here as safety net)
  const allSales = await fetchSessionSales(sessionId, session.branch_id);
  const sales = allSales.filter(s => !(s as unknown as Record<string,unknown>).is_refunded);

  // 2. Fetch sale_items with product names for all sales
  let saleItemsMap: Record<string, { quantity: number; name: string }[]> = {};
  if (sales.length > 0) {
    try {
      const saleIds = sales.map((sa) => sa.id);
      const { data: siData } = await supabase
        .from('sale_items')
        .select('sale_id, quantity, products(product_name, name, size, grams)')
        .in('sale_id', saleIds);
      if (siData) {
        for (const row of siData as any[]) {
          const sid = String(row.sale_id);
          if (!saleItemsMap[sid]) saleItemsMap[sid] = [];
          const p = Array.isArray(row.products) ? row.products[0] : row.products;
          const productName = p?.product_name || p?.name || 'Producto';
          const size = p?.size || '';
          const grams = p?.grams ? `${p.grams}g` : '';
          const fullName = [productName, size, grams].filter(Boolean).join(' ');
          saleItemsMap[sid].push({
            quantity: Number(row.quantity ?? 1),
            name: fullName,
          });
        }
      }
    } catch (err) {
      console.warn('[CORTE PRINT] Could not fetch sale_items:', err);
    }
  }

  // 3. Fetch withdrawals
  const withdrawals = await fetchSessionWithdrawals(sessionId);

  // 4. Build transaction list sorted chronologically
  const transactions: CorteTransaction[] = [];

  for (const sale of sales) {
    const d = new Date(sale.created_at);
    const time = d.toLocaleTimeString('es-MX', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Mexico_City',
    });
    const folio = sale.id.slice(0, 8).toUpperCase();
    const items = saleItemsMap[sale.id] || [];
    const productDesc = buildProductSummary(items);
    const concept = productDesc
      ? `Venta #${folio} - ${productDesc}`
      : `Venta #${folio}`;

    transactions.push({
      time,
      concept,
      paymentMethod: normalizePaymentLabel(sale.payment_method),
      amount: sale.total,
    });
  }

  for (const wd of withdrawals) {
    const d = new Date(wd.withdrawn_at);
    const time = d.toLocaleTimeString('es-MX', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Mexico_City',
    });
    transactions.push({
      time,
      concept: wd.reason ? `Retiro - ${wd.reason}` : 'Retiro de caja',
      paymentMethod: 'Retiro',
      amount: -wd.amount,
    });
  }

  // Sort by original timestamp (sales.created_at / withdrawals.withdrawn_at)
  const allTimestamps: { ts: string; idx: number }[] = [
    ...sales.map((s, i) => ({ ts: s.created_at, idx: i })),
    ...withdrawals.map((w, i) => ({ ts: w.withdrawn_at, idx: sales.length + i })),
  ];
  allTimestamps.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const sortedTransactions = allTimestamps.map((t) => transactions[t.idx]);

  // 5. Build and print
  // Use actual fetched arrays as source of truth for counts (not session.sales_count
  // which may be stale from the DB view or 0 when built from CashRegisterStatus).
  const actualSalesCount = sales.length;
  const actualWithdrawalsCount = withdrawals.length;
  const totalSalesAmount = sales.reduce((sum, s) => sum + s.total, 0);
  const ticketPromedio = actualSalesCount > 0
    ? Math.round((totalSalesAmount / actualSalesCount) * 100) / 100
    : 0;

  const corteData: CorteDeCajaData = {
    sessionId,
    status: session.status === 'open' ? 'open' : 'closed',
    printDate: new Date(),
    openedAt: new Date(session.opened_at),
    closedAt: session.closed_at ? new Date(session.closed_at) : null,
    openingCash: session.opening_cash,
    cashSalesTotal: session.cash_sales_total,
    cardSalesTotal: session.card_sales_total,
    withdrawalsTotal: session.withdrawals_total,
    expectedCash: session.expected_cash,
    countedCash: session.counted_cash,
    difference: session.difference,
    salesCount: actualSalesCount,
    withdrawalsCount: actualWithdrawalsCount,
    ticketPromedio,
    transactions: sortedTransactions,
  };

  await printCorteDeCaja(corteData);
}
