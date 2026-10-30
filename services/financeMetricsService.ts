import { supabase } from '../supabase';
import { buildFinancePresentation, type FinancePresentation, type FinanceRpcSummary } from '../lib/financeMetrics.js';
import { getB2BMonthlyCollectionsReport } from './b2bMonthlyCollectionsService';
import { getCommercialCollections, getMexicoCityPaymentDate, type CommercialCollections } from './commercialCollectionsService';
import { mexicoCityDateStartISO } from '../lib/datetime';

type B2BSource = 'comodato' | 'mayoreo' | 'venta_pieza';

export interface B2BFinanceMetrics {
  generated: number;
  collected: number;
  pending: number;
  generatedBySource: Record<B2BSource, number>;
  collectedBySource: Record<B2BSource, number>;
  generatedByDate: Record<string, number>;
  collectedByDate: Record<string, number>;
  collections: CommercialCollections;
}

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const nextMonthDate = (monthStart: string): string => {
  const [year, month] = monthStart.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
};

const asUtcCalendarDate = (date: string): Date => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const operationBusinessDate = (operationDate: string, source: string): string => {
  if (source.endsWith('_historical_fallback')) return operationDate.slice(0, 10);
  return getMexicoCityPaymentDate(new Date(operationDate));
};

export const getB2BFinanceMetrics = async (
  periodStart: string,
  periodEndExclusive: string,
): Promise<B2BFinanceMetrics> => {
  if (!supabase) throw new Error('Supabase no está configurado');
  if (periodStart.slice(0, 7) !== new Date(`${periodEndExclusive}T12:00:00Z`).toISOString().slice(0, 7)
      && periodEndExclusive !== nextMonthDate(`${periodStart.slice(0, 7)}-01`)) {
    throw new Error('El periodo financiero B2B debe pertenecer a un solo mes.');
  }

  const month = periodStart.slice(0, 7);
  const [report, collections, pieceResult] = await Promise.all([
    getB2BMonthlyCollectionsReport(month),
    getCommercialCollections(asUtcCalendarDate(periodStart), asUtcCalendarDate(periodEndExclusive)),
    supabase
      .from('v_piece_sale_history')
      .select('sale_id, sale_date, total_amount')
      .eq('status', 'confirmed')
      .gte('sale_date', mexicoCityDateStartISO(periodStart))
      .lt('sale_date', mexicoCityDateStartISO(periodEndExclusive)),
  ]);
  if (collections.error) throw new Error(collections.error);
  if (pieceResult.error) throw pieceResult.error;

  const generatedBySource: Record<B2BSource, number> = { comodato: 0, mayoreo: 0, venta_pieza: 0 };
  const generatedByDate: Record<string, number> = {};
  let pending = 0;

  for (const operation of report.operations) {
    const businessDate = operationBusinessDate(operation.operation_date, operation.operation_date_source);
    if (businessDate < periodStart || businessDate >= periodEndExclusive) continue;
    const amount = Number(operation.total_due) || 0;
    generatedBySource[operation.source_type] += amount;
    generatedByDate[businessDate] = (generatedByDate[businessDate] ?? 0) + amount;
    pending += Number(operation.pending_amount) || 0;
  }

  const uniquePieceSales = new Map<string, { date: string; amount: number }>();
  for (const sale of pieceResult.data ?? []) {
    uniquePieceSales.set(sale.sale_id, {
      date: getMexicoCityPaymentDate(new Date(sale.sale_date)),
      amount: Number(sale.total_amount) || 0,
    });
  }
  const pieceSaleIds = [...uniquePieceSales.keys()];
  const paidByPieceSale = new Map<string, number>();
  for (let offset = 0; offset < pieceSaleIds.length; offset += 100) {
    const { data: payments, error } = await supabase
      .from('seller_piece_payments')
      .select('id, sale_id, amount')
      .eq('status', 'completed')
      .in('sale_id', pieceSaleIds.slice(offset, offset + 100));
    if (error) throw error;
    const uniquePayments = new Map<string, { saleId: string; amount: number }>();
    for (const payment of payments ?? []) uniquePayments.set(payment.id, {
      saleId: payment.sale_id,
      amount: Number(payment.amount) || 0,
    });
    for (const payment of uniquePayments.values()) {
      paidByPieceSale.set(payment.saleId, (paidByPieceSale.get(payment.saleId) ?? 0) + payment.amount);
    }
  }
  for (const [saleId, sale] of uniquePieceSales) {
    generatedBySource.venta_pieza += sale.amount;
    generatedByDate[sale.date] = (generatedByDate[sale.date] ?? 0) + sale.amount;
    pending += Math.max(sale.amount - (paidByPieceSale.get(saleId) ?? 0), 0);
  }

  const collectedByDate: Record<string, number> = {};
  for (const payment of collections.breakdown) {
    collectedByDate[payment.business_date] = (collectedByDate[payment.business_date] ?? 0) + payment.amount;
  }

  return {
    generated: roundMoney(Object.values(generatedBySource).reduce((sum, amount) => sum + amount, 0)),
    collected: collections.total,
    pending: roundMoney(pending),
    generatedBySource: {
      comodato: roundMoney(generatedBySource.comodato),
      mayoreo: roundMoney(generatedBySource.mayoreo),
      venta_pieza: roundMoney(generatedBySource.venta_pieza),
    },
    collectedBySource: {
      comodato: collections.bySource.comodato,
      mayoreo: collections.bySource.mayoreo,
      venta_pieza: collections.bySource.pieceSale,
    },
    generatedByDate: Object.fromEntries(Object.entries(generatedByDate).map(([date, amount]) => [date, roundMoney(amount)])),
    collectedByDate: Object.fromEntries(Object.entries(collectedByDate).map(([date, amount]) => [date, roundMoney(amount)])),
    collections,
  };
};

export const getFinanceMonthPresentation = async (monthStart: string): Promise<FinancePresentation> => {
  if (!supabase) throw new Error('Supabase no está configurado');
  const monthEnd = nextMonthDate(monthStart);
  const [{ data, error }, b2b] = await Promise.all([
    supabase.rpc('finance_month_summary', { p_month_start: monthStart }),
    getB2BFinanceMetrics(monthStart, monthEnd),
  ]);
  if (error) throw error;

  const [year, month] = monthStart.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const currentBusinessDate = getMexicoCityPaymentDate(new Date());
  const currentMonth = currentBusinessDate.slice(0, 7);
  const daysElapsed = monthStart.slice(0, 7) === currentMonth
    ? Number(currentBusinessDate.slice(8, 10))
    : daysInMonth;

  return buildFinancePresentation(data as FinanceRpcSummary, {
    b2bGenerated: b2b.generated,
    b2bCollected: b2b.collected,
    projectionDaysElapsed: daysElapsed,
    projectionDaysInMonth: daysInMonth,
  });
};
