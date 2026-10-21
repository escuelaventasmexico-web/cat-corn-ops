import { supabase } from '../supabase';
import { mexicoCityDateStartISO } from '../lib/datetime';
import {
  buildFinanceSalesBreakdown,
  type FinanceSaleSourceRow,
  type FinanceSalesBreakdown,
} from '../lib/financeSalesBreakdown.js';

const describeError = (error: unknown): string => {
  if (!error || typeof error !== 'object') return String(error ?? 'Error desconocido');
  const value = error as Record<string, unknown>;
  return [value.message, value.details, value.hint, value.code]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' · ');
};

export const getFinanceSalesBreakdown = async (
  startBusinessDate: string,
  endBusinessDateExclusive: string,
): Promise<FinanceSalesBreakdown> => {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { data, error } = await supabase
    .from('sales')
    .select('id, total, payment_method, promotion_code, sale_origin, created_at, branch_id, cashier_id, pos_commission_attribution, pos_commission_recipient_id')
    .gte('created_at', mexicoCityDateStartISO(startBusinessDate))
    .lt('created_at', mexicoCityDateStartISO(endBusinessDateExclusive))
    .eq('is_refunded', false)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw new Error(`No se pudo cargar el desglose de ventas: ${describeError(error)}`);
  const rows = (data ?? []) as FinanceSaleSourceRow[];
  const cashierIds = [...new Set(rows.map(row => row.cashier_id).filter((id): id is string => Boolean(id)))];
  let administratorUserIds: string[] = [];
  if (cashierIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('id, role')
      .in('id', cashierIds);
    if (profilesError) throw new Error(`No se pudo identificar a los cajeros: ${describeError(profilesError)}`);
    administratorUserIds = (profiles ?? [])
      .filter(profile => String(profile.role).toLowerCase() === 'admin')
      .map(profile => profile.id);
  }
  return buildFinanceSalesBreakdown(rows, { administratorUserIds });
};

export interface ConfirmedPieceSalePeriodSummary {
  generated: number;
  pending: number;
}

/** Generated amount and current unpaid balance of confirmed piece-sale operations created in a period. */
export const getConfirmedPieceSalePeriodSummary = async (
  startBusinessDate: string,
  endBusinessDateExclusive: string,
): Promise<ConfirmedPieceSalePeriodSummary> => {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { data: sales, error: salesError } = await supabase
    .from('v_piece_sale_history')
    .select('sale_id, total_amount')
    .eq('status', 'confirmed')
    .gte('sale_date', mexicoCityDateStartISO(startBusinessDate))
    .lt('sale_date', mexicoCityDateStartISO(endBusinessDateExclusive));
  if (salesError) throw new Error(`No se pudo cargar el saldo de venta por pieza: ${describeError(salesError)}`);

  const uniqueSales = new Map<string, number>();
  for (const sale of sales ?? []) uniqueSales.set(sale.sale_id, Number(sale.total_amount) || 0);
  const saleIds = [...uniqueSales.keys()];
  if (saleIds.length === 0) return { generated: 0, pending: 0 };

  const paidBySale = new Map<string, number>();
  for (let index = 0; index < saleIds.length; index += 100) {
    const { data: payments, error: paymentsError } = await supabase
      .from('seller_piece_payments')
      .select('id, sale_id, amount')
      .eq('status', 'completed')
      .in('sale_id', saleIds.slice(index, index + 100));
    if (paymentsError) throw new Error(`No se pudo cargar el saldo de venta por pieza: ${describeError(paymentsError)}`);
    const uniquePayments = new Map<string, { saleId: string; amount: number }>();
    for (const payment of payments ?? []) uniquePayments.set(payment.id, {
      saleId: payment.sale_id,
      amount: Number(payment.amount) || 0,
    });
    for (const payment of uniquePayments.values()) {
      paidBySale.set(payment.saleId, (paidBySale.get(payment.saleId) ?? 0) + payment.amount);
    }
  }

  const generated = [...uniqueSales.values()].reduce((sum, amount) => sum + amount, 0);
  const pending = [...uniqueSales.entries()].reduce(
    (sum, [saleId, total]) => sum + Math.max(total - (paidBySale.get(saleId) ?? 0), 0),
    0,
  );
  return {
    generated: Math.round(generated * 100) / 100,
    pending: Math.round(pending * 100) / 100,
  };
};
