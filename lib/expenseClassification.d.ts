export type ExpenseConceptCode = 'CORN' | 'OIL' | 'SEASONINGS' | 'CARAMEL' | 'PACKAGING' | 'FUEL' | 'SERVICES' | 'COMMISSIONS' | 'OTHER';
export type ManualExpenseDestinationScope = 'AURRERA' | 'CHIPITLAN' | 'SHARED';
export type ExpenseDestinationScope = ManualExpenseDestinationScope | 'MIXED' | 'UNKNOWN';
export type ExpenseClassificationStatus = 'CLASSIFIED' | 'SYSTEM';

export interface ExpenseClassificationOption<T extends string> {
  id: T;
  label: string;
}

export interface ClassifiableExpense {
  amount_mxn?: number | string | null;
  concept_code?: ExpenseConceptCode | null;
  destination_scope?: ExpenseDestinationScope | null;
  classification_status?: ExpenseClassificationStatus | null;
}

export const EXPENSE_CONCEPT_OPTIONS: readonly ExpenseClassificationOption<ExpenseConceptCode>[];
export const EXPENSE_DESTINATION_OPTIONS: readonly ExpenseClassificationOption<ManualExpenseDestinationScope>[];
export const EXPENSE_REPORT_DESTINATION_OPTIONS: readonly ExpenseClassificationOption<ExpenseDestinationScope>[];
export const PENDING_CLASSIFICATION_LABEL: 'Pendiente de clasificar';
export function getExpenseConceptLabel(code?: string | null): string;
export function getExpenseDestinationLabel(scope?: string | null): string;
export function isExpenseClassificationComplete(expense?: ClassifiableExpense | null): boolean;
export function filterExpensesByClassification<T extends ClassifiableExpense>(
  expenses: readonly T[],
  conceptFilter?: ExpenseConceptCode | 'ALL' | 'PENDING',
  destinationFilter?: ExpenseDestinationScope | 'ALL' | 'PENDING',
): T[];
export function sumExpensesOnce(expenses: readonly ClassifiableExpense[]): number;
export function summarizePendingClassification(expenses: readonly ClassifiableExpense[]): {
  count: number;
  amount_mxn: number;
};
export function resolveCommissionDestination(
  resolvedEventDestinations: readonly (ManualExpenseDestinationScope | null | undefined)[],
): 'AURRERA' | 'CHIPITLAN' | 'MIXED' | 'UNKNOWN';
