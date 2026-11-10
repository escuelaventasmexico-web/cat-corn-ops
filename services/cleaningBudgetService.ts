import { supabase } from '../supabase';

export interface CleaningBudgetSnapshot {
  month_start: string;
  limit_mxn: number | null;
  warning_threshold_mxn: number | null;
  used_mxn: number;
  remaining_mxn: number | null;
  exceeded_mxn: number;
  matching_expense_count: number;
  unclassified_expenses: {
    count: number;
    amount_mxn: number;
  };
  is_total_definitive: boolean;
}

const requireClient = () => {
  if (!supabase) throw new Error('Supabase no está configurado');
  return supabase;
};

export async function getCleaningBudgetSnapshot(
  monthStart: string,
  excludeExpenseId?: string | null,
): Promise<CleaningBudgetSnapshot> {
  const { data, error } = await requireClient().rpc('finance_month_cleaning_budget', {
    p_month_start: monthStart,
    p_exclude_expense_id: excludeExpenseId || null,
  });
  if (error) throw error;
  return data as CleaningBudgetSnapshot;
}

export async function saveCleaningBudgetLimit(monthStart: string, limitMxn: number): Promise<void> {
  const { error } = await requireClient().rpc('finance_set_month_cleaning_budget', {
    p_month_start: monthStart,
    p_limit_mxn: limitMxn,
  });
  if (error) throw error;
}
