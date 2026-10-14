import { supabase } from '../supabase';
import type { B2BProductAnalyticsResponse, B2BWasteAnalyticsResponse } from '../components/commercialPartners/reports/b2bReportTypes';

const MEXICO_CITY_UTC_OFFSET = '-06:00';

const describeSupabaseError = (error: unknown): string => {
  if (!error || typeof error !== 'object') return String(error ?? 'Error desconocido');
  const value = error as Record<string, unknown>;
  return [value.message, value.details, value.hint, value.code]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' · ');
};

export const toMexicoCityPeriodBoundary = (dateOnly: string): string =>
  `${dateOnly}T00:00:00${MEXICO_CITY_UTC_OFFSET}`;

export async function getB2BProductAnalytics(
  startDate: string,
  endDateExclusive: string
): Promise<B2BProductAnalyticsResponse> {
  if (!supabase) {
    throw new Error('Supabase no está configurado');
  }

  const [{ data, error }, { data: wasteData, error: wasteError }] = await Promise.all([
    supabase.rpc('get_b2b_product_analytics', {
      p_start_date: toMexicoCityPeriodBoundary(startDate),
      p_end_date_exclusive: toMexicoCityPeriodBoundary(endDateExclusive),
    }),
    supabase.rpc('get_b2b_waste_analytics_admin', {
      p_period_start: startDate,
      p_period_end_exclusive: endDateExclusive,
    }),
  ]);

  if (error) throw new Error(`Error en análisis de productos B2B: ${describeSupabaseError(error)}`);
  if (wasteError) throw new Error(`Error en conciliación de merma B2B: ${describeSupabaseError(wasteError)}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('La RPC de productos B2B devolvió una respuesta inválida.');
  }
  if (!wasteData || typeof wasteData !== 'object' || Array.isArray(wasteData)) {
    throw new Error('La RPC de merma B2B devolvió una respuesta inválida.');
  }

  return {
    ...(data as Omit<B2BProductAnalyticsResponse, 'waste'>),
    waste: wasteData as B2BWasteAnalyticsResponse,
  };
}
