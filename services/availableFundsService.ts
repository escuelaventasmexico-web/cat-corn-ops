import { supabase } from '../supabase';
import type {
  AvailableFundsLimitations,
  AvailableFundsStatus,
  ExpenseLiquidityTreatment,
  ExpensePaymentInstrument,
} from '../lib/availableFunds.js';

export type CreditCardPaymentKind = 'TOTAL' | 'PARTIAL';
export type CreditCardPaymentSource = 'CASH' | 'TRANSFER' | 'DEBIT_CARD' | 'MERCADO_PAGO' | 'OTHER';

export interface FinanceCreditCard {
  id: string;
  name: string;
  active: boolean;
}

export interface FinanceCreditCardPayment {
  id: string;
  credit_card_id: string;
  amount_mxn: number;
  payment_date: string;
  payment_kind: CreditCardPaymentKind;
  source_instrument: CreditCardPaymentSource;
  reference: string | null;
  notes: string | null;
  status: 'POSTED' | 'REVERSED';
  reversed_at: string | null;
  reversal_reason: string | null;
  card: { name: string } | null;
}

export interface AvailableFundsSnapshot {
  month_start: string;
  status: AvailableFundsStatus;
  is_exact: boolean;
  opening_balance: null | {
    id: string;
    amount_mxn: number;
    cutoff_business_date: string;
    notes: string | null;
  };
  inflows: {
    pos_collections_mxn: number;
    b2b_collections_mxn: number;
  };
  outflows: {
    immediate_expenses_mxn: number;
    credit_card_payments_mxn: number;
  };
  informational: {
    credit_purchases_mxn: number;
  };
  known_available_mxn: number | null;
  available_mxn: number | null;
  limitations: AvailableFundsLimitations;
  ambiguous_movements: AvailableFundsMovement[];
  opening_day_pos: {
    default_position: 'BEFORE_OPENING' | 'AFTER_OPENING' | null;
    count: number;
    amount_mxn: number;
    exception_count: number;
    sales: AvailableFundsPosSale[];
  };
}

export interface AvailableFundsMovement {
  source_type: string;
  source_id: string;
  business_date: string;
  amount_mxn: number;
  direction: 'INFLOW' | 'OUTFLOW' | 'LIABILITY' | 'LIMITATION';
  label: string;
}

export interface AvailableFundsPosSale {
  source_id: string;
  business_date: string;
  amount_mxn: number;
  payment_method: string;
  individual_position: 'BEFORE_OPENING' | 'AFTER_OPENING' | null;
  effective_position: 'BEFORE_OPENING' | 'AFTER_OPENING' | null;
}

export interface ExpenseLiquidityFields {
  liquidity_treatment?: ExpenseLiquidityTreatment | null;
  payment_instrument?: ExpensePaymentInstrument | null;
  credit_card_id?: string | null;
}

const requireClient = () => {
  if (!supabase) throw new Error('Supabase no está configurado');
  return supabase;
};
export const getAvailableFundsSnapshot = async (monthStart: string): Promise<AvailableFundsSnapshot> => {
  const { data, error } = await requireClient().rpc('finance_month_available_funds', {
    p_month_start: monthStart,
  });
  if (error) throw error;
  return data as AvailableFundsSnapshot;
};

export const listFinanceCreditCards = async (): Promise<FinanceCreditCard[]> => {
  const { data, error } = await requireClient()
    .from('finance_credit_cards')
    .select('id,name,active')
    .eq('active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as FinanceCreditCard[];
};

export const listFinanceCreditCardPayments = async (
  monthStart: string,
): Promise<FinanceCreditCardPayment[]> => {
  const monthEnd = new Date(`${monthStart}T12:00:00`);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  const monthEndISO = monthEnd.toISOString().slice(0, 10);
  const { data, error } = await requireClient()
    .from('finance_credit_card_payments')
    .select(`
      id,credit_card_id,amount_mxn,payment_date,payment_kind,source_instrument,
      reference,notes,status,reversed_at,reversal_reason,
      card:finance_credit_cards(name)
    `)
    .gte('payment_date', monthStart)
    .lt('payment_date', monthEndISO)
    .order('payment_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as FinanceCreditCardPayment[];
};

export const createFinanceCreditCard = async (name: string): Promise<FinanceCreditCard> => {
  const { data, error } = await requireClient()
    .from('finance_credit_cards')
    .insert({ name: name.trim() })
    .select('id,name,active')
    .single();
  if (error) throw error;
  return data as FinanceCreditCard;
};

export const saveOpeningBalance = async (input: {
  monthStart: string;
  amountMxn: number;
  cutoffBusinessDate: string;
  notes?: string;
}): Promise<void> => {
  const { error } = await requireClient()
    .from('finance_month_opening_balances')
    .upsert({
      month_start: input.monthStart,
      amount_mxn: input.amountMxn,
      cutoff_business_date: input.cutoffBusinessDate,
      notes: input.notes?.trim() || null,
    }, { onConflict: 'month_start' });
  if (error) throw error;
};
export const registerCreditCardPayment = async (input: {
  creditCardId?: string;
  newCardName?: string;
  amountMxn: number;
  paymentDate: string;
  paymentKind: CreditCardPaymentKind;
  sourceInstrument: CreditCardPaymentSource;
  reference?: string;
  notes?: string;
  idempotencyKey: string;
}): Promise<void> => {
  const { error } = await requireClient().rpc('finance_register_credit_card_payment', {
    p_credit_card_id: input.creditCardId || null,
    p_new_card_name: input.newCardName?.trim() || null,
    p_amount_mxn: input.amountMxn,
    p_payment_date: input.paymentDate,
    p_payment_kind: input.paymentKind,
    p_source_instrument: input.sourceInstrument,
    p_reference: input.reference?.trim() || null,
    p_notes: input.notes?.trim() || null,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw error;
};

export const reverseCreditCardPayment = async (input: {
  paymentId: string;
  reason: string;
}): Promise<void> => {
  const { error } = await requireClient().rpc('finance_reverse_credit_card_payment', {
    p_payment_id: input.paymentId,
    p_reversal_reason: input.reason.trim(),
  });
  if (error) throw error;
};

export const saveOpeningMovementDecision = async (input: {
  openingBalanceId: string;
  sourceType: string;
  sourceId: string;
  position: 'BEFORE_OPENING' | 'AFTER_OPENING';
}): Promise<void> => {
  const { error } = await requireClient()
    .from('finance_opening_day_movement_decisions')
    .upsert({
      opening_balance_id: input.openingBalanceId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      position: input.position,
    }, { onConflict: 'opening_balance_id,source_type,source_id' });
  if (error) throw error;
};

export const saveOpeningSourceDefault = async (input: {
  openingBalanceId: string;
  sourceType: 'POS_SALE';
  position: 'BEFORE_OPENING' | 'AFTER_OPENING';
  notes?: string;
}): Promise<void> => {
  const { error } = await requireClient()
    .from('finance_opening_day_source_defaults')
    .upsert({
      opening_balance_id: input.openingBalanceId,
      source_type: input.sourceType,
      position: input.position,
      notes: input.notes?.trim() || null,
    }, { onConflict: 'opening_balance_id,source_type' });
  if (error) throw error;
};

export const clearOpeningMovementDecision = async (input: {
  openingBalanceId: string;
  sourceType: string;
  sourceId: string;
}): Promise<void> => {
  const { error } = await requireClient().rpc('finance_clear_opening_movement_decision', {
    p_opening_balance_id: input.openingBalanceId,
    p_source_type: input.sourceType,
    p_source_id: input.sourceId,
  });
  if (error) throw error;
};
