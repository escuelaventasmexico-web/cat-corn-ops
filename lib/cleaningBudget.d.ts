import type { ExpenseConceptCode } from './expenseClassification.js';

export const CLEANING_CONCEPT_CODE: 'CLEANING';
export const CLEANING_BUDGET_WARNING_RATIO: 0.8;
export function isCleaningConcept(conceptCode?: string | null): boolean;
export function calculateCleaningBudgetProjection(input: {
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
