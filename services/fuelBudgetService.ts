import { supabase } from '../supabase';
import type { FuelVehicleCode } from '../lib/fuelBudget.js';

export interface FuelBudgetSnapshot {
  month_start: string;
  global_limit_mxn: number | null;
  warning_threshold_mxn: number | null;
  used_mxn: number;
  remaining_mxn: number | null;
  exceeded_mxn: number;
  vehicle_limits_mxn: Record<FuelVehicleCode, number | null>;
  usage_by_vehicle: Record<FuelVehicleCode | 'UNASSIGNED', number>;
  vehicle_status: Record<FuelVehicleCode, {
    limit_mxn: number | null;
    warning_threshold_mxn: number | null;
    used_mxn: number;
    remaining_mxn: number | null;
    exceeded_mxn: number;
  }>;
  matching_expense_count: number;
  unassigned_vehicle: { count: number; amount_mxn: number };
  is_vehicle_breakdown_complete: boolean;
}

const requireClient = () => {
  if (!supabase) throw new Error('Supabase no está configurado');
  return supabase;
};

export async function getFuelBudgetSnapshot(
  monthStart: string,
  excludeExpenseId?: string | null,
): Promise<FuelBudgetSnapshot> {
  const { data, error } = await requireClient().rpc('finance_month_fuel_budget', {
    p_month_start: monthStart,
    p_exclude_expense_id: excludeExpenseId || null,
  });
  if (error) throw error;
  return data as FuelBudgetSnapshot;
}

export async function saveFuelBudgetLimits(
  monthStart: string,
  globalLimitMxn: number,
  utilityLimitMxn: number,
  managerialLimitMxn: number,
): Promise<void> {
  const { error } = await requireClient().rpc('finance_set_month_fuel_budget', {
    p_month_start: monthStart,
    p_global_limit_mxn: globalLimitMxn,
    p_utility_limit_mxn: utilityLimitMxn,
    p_managerial_limit_mxn: managerialLimitMxn,
  });
  if (error) throw error;
}
