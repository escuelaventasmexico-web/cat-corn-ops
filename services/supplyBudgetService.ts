import { supabase } from '../supabase';

export interface SupplyBudgetSnapshot {
  month_start: string;
  limit_mxn: number | null;
  warning_threshold_mxn: number | null;
  used_mxn: number;
  remaining_mxn: number | null;
  exceeded_mxn: number;
  usage_by_destination: {
    AURRERA: number;
    CHIPITLAN: number;
    SHARED: number;
    UNASSIGNED: number;
  };
  matching_expense_count: number;
  unassigned_supply: {
    count: number;
    amount_mxn: number;
  };
  potential_supply_unclassified: {
    count: number;
    amount_mxn: number;
  };
  confirmed_non_supply: {
    count: number;
    amount_mxn: number;
  };
  is_total_definitive: boolean;
  is_destination_breakdown_complete: boolean;
}

const requireClient = () => {
  if (!supabase) throw new Error('Supabase no está configurado');
  return supabase;
};

export async function getSupplyBudgetSnapshot(
  monthStart: string,
  excludeExpenseId?: string | null,
): Promise<SupplyBudgetSnapshot> {
  const { data, error } = await requireClient().rpc('finance_month_supply_budget', {
    p_month_start: monthStart,
    p_exclude_expense_id: excludeExpenseId || null,
  });
  if (error) throw error;
  return data as SupplyBudgetSnapshot;
}

export async function saveSupplyBudgetLimit(monthStart: string, limitMxn: number): Promise<void> {
  const { error } = await requireClient().rpc('finance_set_month_supply_budget', {
    p_month_start: monthStart,
    p_limit_mxn: limitMxn,
  });
  if (error) throw error;
}
