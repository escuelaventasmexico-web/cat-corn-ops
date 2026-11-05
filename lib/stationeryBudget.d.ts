import type { ExpenseConceptCode } from './expenseClassification.js';

export const STATIONERY_CONCEPT_CODE: 'STATIONERY';
export const STATIONERY_BUDGET_WARNING_RATIO: 0.8;
export function isStationeryConcept(conceptCode?: string | null): boolean;
export function calculateStationeryBudgetProjection(input: {
  limitMxn: number | null;
  usedExcludingEditedExpenseMxn?: number;
  amountMxn?: number;
  conceptCode?: ExpenseConceptCode | string | null;
}): {
  projectedUsedMxn: number;
  warningThresholdMxn: number | null;
  remainingMxn: number | null;
  exceededMxn: number;
  isAtWarning: boolean;
  isOverBudget: boolean;
};
