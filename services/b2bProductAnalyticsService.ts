import { supabase } from '../supabase';
import type { B2BProductAnalyticsResponse } from '../components/commercialPartners/reports/b2bReportTypes';

const MEXICO_CITY_UTC_OFFSET = '-06:00';

export const toMexicoCityPeriodBoundary = (dateOnly: string): string =>
  `${dateOnly}T00:00:00${MEXICO_CITY_UTC_OFFSET}`;

export async function getB2BProductAnalytics(
  startDate: string,
  endDateExclusive: string
): Promise<B2BProductAnalyticsResponse> {
  if (!supabase) {
    throw new Error('Supabase no está configurado');
  }

  const { data, error } = await supabase.rpc('get_b2b_product_analytics', {
    p_start_date: toMexicoCityPeriodBoundary(startDate),
    p_end_date_exclusive: toMexicoCityPeriodBoundary(endDateExclusive),
  });

  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('La RPC de productos B2B devolvió una respuesta inválida.');
  }

  return data as B2BProductAnalyticsResponse;
}
