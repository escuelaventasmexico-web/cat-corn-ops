import { supabase } from '../../../../supabase';
import { getMexicoCityDateKey } from '../../../../lib/datetime';
import {
  CommissionPaymentOverview,
  CommissionPaymentRecord,
} from '../commissionTypes';
import { loadSettlementHistory } from './paymentUtils';

interface SettlementItemRow {
  settlement_id: string;
  commission_event_id: string;
  amount: number | string;
}

interface CommissionEventConceptRow {
  id: string;
  earned_at: string;
  source_type: string;
  metadata: Record<string, unknown> | string | null;
}

const chunk = <T,>(values: T[], size = 200): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
};

const parseMetadata = (
  value: CommissionEventConceptRow['metadata']
): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const isExtraDay = (event: CommissionEventConceptRow | undefined): boolean => {
  if (!event || event.source_type !== 'adjustment') return false;
  return parseMetadata(event.metadata).adjustment_type === 'extra_day';
};

const emptyBreakdown = () => ({
  commercial: 0,
  extraDays: 0,
  otherAdjustments: 0,
  earnedDates: [] as string[],
});

export const loadCommissionPaymentOverview = async (
  sellerId: string,
  monthStart: string,
  monthEndExclusive: string
): Promise<CommissionPaymentOverview> => {
  if (!supabase) throw new Error('Supabase no está configurado');

  const [settlements, pendingResult] = await Promise.all([
    loadSettlementHistory(sellerId),
    supabase
      .from('v_seller_commission_monthly_summary')
      .select('pending_total')
      .eq('seller_id', sellerId),
  ]);

  if (pendingResult.error) {
    console.error('COMMISSION HISTORICAL PENDING ERROR', pendingResult.error);
    throw pendingResult.error;
  }

  const paidSettlements = settlements.filter(settlement => settlement.status === 'paid');
  const settlementIds = paidSettlements.map(settlement => settlement.settlement_id);
  const items: SettlementItemRow[] = [];

  for (const ids of chunk(settlementIds)) {
    if (ids.length === 0) continue;
    const { data, error } = await supabase
      .from('commission_settlement_items')
      .select('settlement_id, commission_event_id, amount')
      .in('settlement_id', ids);

    if (error) {
      console.error('COMMISSION PAYMENT ITEMS ERROR', error);
      throw error;
    }
    items.push(...((data as SettlementItemRow[]) || []));
  }

  const eventIds = Array.from(new Set(items.map(item => item.commission_event_id)));
  const events: CommissionEventConceptRow[] = [];

  for (const ids of chunk(eventIds)) {
    if (ids.length === 0) continue;
    const { data, error } = await supabase
      .from('commission_events')
      .select('id, earned_at, source_type, metadata')
      .in('id', ids);

    if (error) {
      console.error('COMMISSION PAYMENT EVENTS ERROR', error);
      throw error;
    }
    events.push(...((data as CommissionEventConceptRow[]) || []));
  }

  const eventById = new Map(events.map(event => [event.id, event]));
  const missingEventIds = eventIds.filter(eventId => !eventById.has(eventId));
  if (missingEventIds.length > 0) {
    throw new Error(
      `No se pudo conciliar el historial: faltan ${missingEventIds.length} eventos de comisión vinculados.`
    );
  }
  const breakdownBySettlement = new Map<string, ReturnType<typeof emptyBreakdown>>();

  items.forEach(item => {
    const breakdown = breakdownBySettlement.get(item.settlement_id) ?? emptyBreakdown();
    const amount = Number(item.amount || 0);
    const event = eventById.get(item.commission_event_id);

    if (isExtraDay(event)) {
      breakdown.extraDays += amount;
    } else if (event?.source_type === 'adjustment') {
      breakdown.otherAdjustments += amount;
    } else {
      breakdown.commercial += amount;
    }

    if (event?.earned_at) breakdown.earnedDates.push(getMexicoCityDateKey(event.earned_at));
    breakdownBySettlement.set(item.settlement_id, breakdown);
  });

  const enrichedSettlements: CommissionPaymentRecord[] = settlements.map(settlement => {
    const breakdown = breakdownBySettlement.get(settlement.settlement_id) ?? emptyBreakdown();
    const earnedDates = breakdown.earnedDates.sort((left, right) => left.localeCompare(right));
    const conceptsTotal = breakdown.commercial
      + breakdown.extraDays
      + breakdown.otherAdjustments;
    return {
      ...settlement,
      earned_period_start: earnedDates[0] ?? null,
      earned_period_end: earnedDates[earnedDates.length - 1] ?? null,
      commercial_commissions_amount: breakdown.commercial,
      extra_days_amount: breakdown.extraDays,
      other_adjustments_amount: breakdown.otherAdjustments,
      concept_breakdown_matches_total: settlement.status !== 'paid'
        || Math.abs(conceptsTotal - Number(settlement.total_amount || 0)) <= 0.005,
    };
  });

  const paymentsDuringMonth = enrichedSettlements.filter(settlement => {
    if (settlement.status !== 'paid' || !settlement.paid_at) return false;
    const paidDate = getMexicoCityDateKey(settlement.paid_at);
    return paidDate >= monthStart && paidDate < monthEndExclusive;
  });

  const sum = (
    rows: CommissionPaymentRecord[],
    selector: (row: CommissionPaymentRecord) => number
  ) => rows.reduce((total, row) => total + selector(row), 0);

  const paidDuringMonth = sum(paymentsDuringMonth, row => Number(row.total_amount || 0));
  const commercialPaidDuringMonth = sum(
    paymentsDuringMonth,
    row => row.commercial_commissions_amount
  );
  const extraDaysPaidDuringMonth = sum(paymentsDuringMonth, row => row.extra_days_amount);
  const otherAdjustmentsPaidDuringMonth = sum(
    paymentsDuringMonth,
    row => row.other_adjustments_amount
  );

  return {
    month_start: monthStart,
    month_end_exclusive: monthEndExclusive,
    paid_during_month: paidDuringMonth,
    total_historical_paid: sum(
      enrichedSettlements.filter(row => row.status === 'paid'),
      row => Number(row.total_amount || 0)
    ),
    historical_pending_release: (pendingResult.data || []).reduce(
      (total, row) => total + Number(row.pending_total || 0),
      0
    ),
    commercial_paid_during_month: commercialPaidDuringMonth,
    extra_days_paid_during_month: extraDaysPaidDuringMonth,
    other_adjustments_paid_during_month: otherAdjustmentsPaidDuringMonth,
    month_concepts_match_paid_total: Math.abs(
      commercialPaidDuringMonth
      + extraDaysPaidDuringMonth
      + otherAdjustmentsPaidDuringMonth
      - paidDuringMonth
    ) <= 0.005,
    payments_during_month: paymentsDuringMonth,
    settlements: enrichedSettlements,
  };
};
