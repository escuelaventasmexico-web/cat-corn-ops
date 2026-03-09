import { supabase } from '../supabase';

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
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  cash_sales_total: number;
  card_sales_total: number;
  withdrawals_total: number;
  expected_cash: number;
  counted_cash: number | null;
  difference: number | null;
  sales_count: number;
  withdrawals_count: number;
  opened_by: string | null;
  closed_by: string | null;
  notes: string | null;
  close_notes: string | null;
}

/** Result from close_cash_register_session RPC */
export interface CloseResult {
  expected_cash: number;
  counted_cash: number;
  difference: number;
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

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch the current open cash-register status from the Supabase view.
 * Returns EMPTY_CASH_STATUS when no session is open.
 */
export async function fetchCashStatus(): Promise<CashRegisterStatus> {
  if (!supabase) return EMPTY_CASH_STATUS;

  const { data, error } = await supabase
    .from('v_open_cash_register_status')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[CASH] Error fetching status:', error.message);
    return EMPTY_CASH_STATUS;
  }

  if (!data) return EMPTY_CASH_STATUS;

  const status: CashRegisterStatus = {
    session_id: data.session_id ?? null,
    opening_cash: Number(data.opening_cash ?? 0),
    cash_sales_total: Number(data.cash_sales_total ?? 0),
    card_sales_total: Number(data.card_sales_total ?? 0),
    withdrawals_total: Number(data.withdrawals_total ?? 0),
    current_cash: Number(data.current_cash ?? 0),
    needs_withdrawal: Boolean(data.needs_withdrawal),
    opened_at: data.opened_at ?? null,
    opened_by: data.opened_by ?? null,
    notes: data.notes ?? null,
  };

  console.log('[CASH] open status', status);
  return status;
}

/**
 * Open a new cash register session via the Supabase RPC.
 * Throws on error (e.g. a session is already open).
 */
export async function openCashRegister(
  openingCash: number,
  notes?: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase no configurado');

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('No hay usuario autenticado');

  const { error } = await supabase.rpc('open_cash_register_session', {
    p_opening_cash: openingCash,
    p_opened_by: user.id,
    p_notes: notes || null,
  });

  if (error) {
    console.error('[CASH] Error opening register:', error.message);
    throw new Error(error.message);
  }
}

/**
 * Fetch the open session id (lightweight call used right before inserting a sale).
 * Returns null when no session is open.
 */
export async function getOpenSessionId(): Promise<string | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.rpc('get_open_cash_register_session');

  if (error) {
    console.error('[CASH] Error getting open session:', error.message);
    return null;
  }

  // The RPC may return a UUID string or an object with an id field
  if (typeof data === 'string') return data || null;
  if (data && typeof data === 'object' && 'id' in data) return (data as { id: string }).id;
  return null;
}

// ─── Withdrawal ───────────────────────────────────────────────────────────────

/**
 * Register a cash withdrawal for the currently open session.
 */
export async function registerWithdrawal(
  sessionId: string,
  amount: number,
  reason: string,
  notes?: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase no configurado');

  let userId: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch { /* auth optional per spec */ }

  const { error } = await supabase.rpc('register_cash_withdrawal', {
    p_session_id: sessionId,
    p_amount: amount,
    p_reason: reason,
    p_trigger_type: 'manual',
    p_created_by: userId,
    p_notes: notes || null,
  });

  if (error) {
    console.error('[CASH] Error registering withdrawal:', error.message);
    throw new Error(error.message);
  }
}

// ─── Close session ────────────────────────────────────────────────────────────

/**
 * Close the currently open cash register session.
 * Returns the close result with expected / counted / difference.
 */
export async function closeCashRegister(
  sessionId: string,
  countedCash: number,
  notes?: string,
): Promise<CloseResult> {
  if (!supabase) throw new Error('Supabase no configurado');

  let userId: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch { /* ok */ }

  const { data, error } = await supabase.rpc('close_cash_register_session', {
    p_session_id: sessionId,
    p_counted_cash: countedCash,
    p_closed_by: userId,
    p_notes: notes || null,
  });

  if (error) {
    console.error('[CASH] Error closing register:', error.message);
    throw new Error(error.message);
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

// ─── History ──────────────────────────────────────────────────────────────────

/**
 * Fetch the sessions summary from the view, most recent first.
 */
export async function fetchSessionsHistory(): Promise<CashSessionSummary[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('v_cash_register_sessions_summary')
    .select('*')
    .order('opened_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[CASH] Error fetching sessions history:', error.message);
    return [];
  }

  return (data || []).map((d: Record<string, unknown>) => ({
    session_id: String(d.session_id ?? ''),
    status: String(d.status ?? ''),
    opened_at: String(d.opened_at ?? ''),
    closed_at: d.closed_at ? String(d.closed_at) : null,
    opening_cash: Number(d.opening_cash ?? 0),
    cash_sales_total: Number(d.cash_sales_total ?? 0),
    card_sales_total: Number(d.card_sales_total ?? 0),
    withdrawals_total: Number(d.withdrawals_total ?? 0),
    expected_cash: Number(d.expected_cash ?? 0),
    counted_cash: d.counted_cash != null ? Number(d.counted_cash) : null,
    difference: d.difference != null ? Number(d.difference) : null,
    sales_count: Number(d.sales_count ?? 0),
    withdrawals_count: Number(d.withdrawals_count ?? 0),
    opened_by: d.opened_by ? String(d.opened_by) : null,
    closed_by: d.closed_by ? String(d.closed_by) : null,
    notes: d.notes ? String(d.notes) : null,
    close_notes: d.close_notes ? String(d.close_notes) : null,
  }));
}

// ─── Session detail ───────────────────────────────────────────────────────────

/**
 * Fetch all sales linked to a specific cash session.
 */
export async function fetchSessionSales(sessionId: string): Promise<CashSessionSale[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('sales')
    .select('id, created_at, payment_method, total, customer_id, promotion_code, loyalty_reward_applied, loyalty_discount_amount')
    .eq('cash_session_id', sessionId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[CASH] Error fetching session sales:', error.message);
    return [];
  }

  return (data || []).map((d: Record<string, unknown>) => ({
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
 */
export async function fetchSessionWithdrawals(sessionId: string): Promise<CashSessionWithdrawal[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('cash_withdrawals')
    .select('id, withdrawn_at, amount, reason, trigger_type, notes')
    .eq('session_id', sessionId)
    .order('withdrawn_at', { ascending: false });

  if (error) {
    console.error('[CASH] Error fetching session withdrawals:', error.message);
    return [];
  }

  return (data || []).map((d: Record<string, unknown>) => ({
    id: String(d.id ?? ''),
    withdrawn_at: String(d.withdrawn_at ?? ''),
    amount: Number(d.amount ?? 0),
    reason: String(d.reason ?? ''),
    trigger_type: String(d.trigger_type ?? ''),
    notes: d.notes ? String(d.notes) : null,
  }));
}
