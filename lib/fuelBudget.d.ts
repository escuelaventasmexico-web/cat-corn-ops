import type { ExpenseConceptCode } from './expenseClassification.js';

export type FuelVehicleCode = 'UTILITY' | 'MANAGERIAL';
export const FUEL_VEHICLE_CODES: readonly FuelVehicleCode[];
export const FUEL_BUDGET_WARNING_RATIO: 0.8;
export function isFuelConcept(conceptCode?: string | null): boolean;
export function isFuelVehicleCode(vehicleCode?: string | null): vehicleCode is FuelVehicleCode;
export function getFuelVehicleLabel(vehicleCode?: string | null): string;
export function summarizeFuelBudgetExpenses(expenses: ReadonlyArray<{
  amount_mxn?: number | string | null;
  concept_code?: string | null;
  fuel_vehicle_code?: string | null;
}>): {
  usedMxn: number;
  usageByVehicle: Record<'UTILITY' | 'MANAGERIAL' | 'UNASSIGNED', number>;
  matchingExpenseCount: number;
  unassignedVehicle: { count: number; amountMxn: number };
};
export function calculateFuelBudgetProjection(input: {
  globalLimitMxn: number | null;
  vehicleLimitsMxn?: Partial<Record<FuelVehicleCode, number | null>>;
  usedExcludingEditedExpenseMxn?: number;
  usageByVehicleExcludingEditedExpense?: Partial<Record<FuelVehicleCode, number>>;
  amountMxn?: number;
  conceptCode?: ExpenseConceptCode | string | null;
  fuelVehicleCode?: FuelVehicleCode | string | null;
}): {
  total: {
    projectedUsedMxn: number;
    warningThresholdMxn: number | null;
    remainingMxn: number | null;
    exceededMxn: number;
    isAtWarning: boolean;
    isOverBudget: boolean;
  };
  vehicle: {
    projectedUsedMxn: number;
    warningThresholdMxn: number | null;
    remainingMxn: number | null;
    exceededMxn: number;
    isAtWarning: boolean;
    isOverBudget: boolean;
  };
  vehicleCode: FuelVehicleCode | null;
};
