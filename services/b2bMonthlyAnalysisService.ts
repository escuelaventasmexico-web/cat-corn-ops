import { supabase } from '../supabase';
import type { B2BPartnerRanking } from '../components/commercialPartners/reports/b2bReportTypes';

export interface B2BMonthlyMetrics {
  comodato_generated: number;
  comodato_paid: number;
  comodato_units: number;
  wholesale_purchased: number;
  wholesale_paid: number;
  wholesale_units: number;
  piece_generated: number;
  piece_paid: number;
  piece_units: number;
  total_generated: number;
  total_paid: number;
  total_units: number;
}

export interface B2BMonthlyAnalysis {
  month_start: string;
  month_end: string;
  selected: B2BMonthlyMetrics;
  previous: B2BMonthlyMetrics;
  rankings: B2BPartnerRanking[];
}

export const getMexicoCityCurrentMonth = (): string => {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const year = values.find(value => value.type === 'year')?.value;
  const month = values.find(value => value.type === 'month')?.value;
  if (!year || !month) throw new Error('No se pudo resolver el mes actual.');
  return `${year}-${month}`;
};

export const getMonthBounds = (month: string): { start: string; endExclusive: string } => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('Mes inválido. Usa el formato AAAA-MM.');
  const year = Number(match[1]);
  const zeroBasedMonth = Number(match[2]) - 1;
  if (zeroBasedMonth < 0 || zeroBasedMonth > 11) throw new Error('Mes inválido.');
  const end = new Date(Date.UTC(year, zeroBasedMonth + 1, 1));
  return { start: `${match[1]}-${match[2]}-01`, endExclusive: end.toISOString().slice(0, 10) };
};

export const getB2BMonthlyAnalysis = async (month: string): Promise<B2BMonthlyAnalysis> => {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { start, endExclusive } = getMonthBounds(month);
  const { data, error } = await supabase.rpc('get_b2b_monthly_analysis', {
    p_month_start: start,
    p_month_end: endExclusive,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('El análisis mensual B2B devolvió una respuesta inválida.');
  }
  return data as B2BMonthlyAnalysis;
};
