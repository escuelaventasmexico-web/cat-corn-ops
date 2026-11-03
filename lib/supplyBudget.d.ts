import type { ExpenseConceptCode } from './expenseClassification.js';

export const SUPPLY_CONCEPT_CODES: readonly ExpenseConceptCode[];
export const SUPPLY_BUDGET_WARNING_RATIO: 0.8;
export function isSupplyConcept(conceptCode?: string | null): boolean;
export function getMonthStart(dateOnly?: string | null): string | null;
export function summarizeSupplyBudgetExpenses(expenses: ReadonlyArray<{
  amount_mxn?: number | string | null;
  concept_code?: string | null;
  destination_scope?: string | null;
}>): {
  usedMxn: number;
  usageByDestination: Record<'AURRERA' | 'CHIPITLAN' | 'SHARED' | 'UNASSIGNED', number>;
  matchingExpenseCount: number;
  unassignedSupply: { count: number; amountMxn: number };
  potentialSupplyUnclassified: { count: number; amountMxn: number };
  confirmedNonSupply: { count: number; amountMxn: number };
};
export function calculateSupplyBudgetProjection(input: {
  limitMxn: number | null;
  usedExcludingEditedExpenseMxn?: number;
  amountMxn?: number;
  conceptCode?: string | null;
}): {
  projectedUsedMxn: number;
  warningThresholdMxn: number | null;
  remainingMxn: number | null;
  exceededMxn: number;
  isAtWarning: boolean;
  isOverBudget: boolean;
};
