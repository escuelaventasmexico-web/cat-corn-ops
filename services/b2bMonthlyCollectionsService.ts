import { supabase } from '../supabase';

export type B2BCollectionSourceType = 'comodato' | 'mayoreo';
export type B2BCollectionPaymentStatus = 'pending' | 'partial' | 'paid';

export interface B2BMonthlyCollectionProduct {
  product_id: string | null;
  product_name: string | null;
  product_variant: string | null;
  product_size: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  historical_identity_unverified: boolean;
}

export interface B2BMonthlyCollectionOperation {
  source_type: B2BCollectionSourceType;
  operation_id: string;
  operation_folio: string;
  partner_id: string;
  partner_folio: string | null;
  business_name: string | null;
  responsible_name: string | null;
  partner_model: string | null;
  operation_date: string;
  operation_date_source: 'settlement_created_at' | 'released_at' | 'delivery_date_historical_fallback' | 'order_date_historical_fallback';
  registered_at: string;
  payment_due_at: string | null;
  total_due: number;
  total_paid: number;
  pending_amount: number;
  payment_status: B2BCollectionPaymentStatus;
  /** Calendar business date (AAAA-MM-DD); never format as a UTC timestamp. */
  fully_paid_on: string | null;
  days_waiting_payment: number;
  days_overdue: number;
  products: B2BMonthlyCollectionProduct[];
}

export interface B2BPaymentSpeedRanking {
  partner_id: string;
  partner_folio: string | null;
  business_name: string | null;
  median_days: number;
  operations_count: number;
}

export interface B2BMonthlyCollectionsReport {
  month_start: string;
  month_end: string;
  summary: {
    operations_count: number;
    total_generated: number;
    total_paid_for_operations: number;
    pending_amount_for_operations: number;
    pending_operations_count: number;
    partial_operations_count: number;
    partners_with_pending_count: number;
    oldest_pending_operation: { operation_folio: string; business_name: string | null; registered_at: string; days_waiting_payment: number; pending_amount: number } | null;
    collected_during_month: number;
  };
  operations: B2BMonthlyCollectionOperation[];
  payment_speed_rankings: { fastest_partner: B2BPaymentSpeedRanking | null; slowest_partner: B2BPaymentSpeedRanking | null };
  aging: Record<'days_0_2' | 'days_3_7' | 'days_8_15' | 'days_over_15', number>;
}

const monthBoundary = (month: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('Mes inválido. Usa el formato AAAA-MM.');
  const year = Number(match[1]);
  const zeroBasedMonth = Number(match[2]) - 1;
  if (zeroBasedMonth < 0 || zeroBasedMonth > 11) throw new Error('Mes inválido.');
  const next = new Date(Date.UTC(year, zeroBasedMonth + 1, 1));
  return { start: `${match[1]}-${match[2]}-01`, end: next.toISOString().slice(0, 10) };
};

/** Calls the read-only SQL report using business-date month boundaries. */
export const getB2BMonthlyCollectionsReport = async (month: string): Promise<B2BMonthlyCollectionsReport> => {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { start, end } = monthBoundary(month);
  const { data, error } = await supabase.rpc('get_b2b_monthly_collections_report', { p_month_start: start, p_month_end: end });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('El reporte mensual de cobranza devolvió una respuesta inválida.');
  return data as B2BMonthlyCollectionsReport;
};

export const getMexicoCityCurrentMonth = (): string => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  if (!year || !month) throw new Error('No se pudo resolver el mes actual.');
  return `${year}-${month}`;
};
