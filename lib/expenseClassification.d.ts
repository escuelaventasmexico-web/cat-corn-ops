export type ExpenseConceptCode = 'CORN' | 'OIL' | 'SEASONINGS' | 'CARAMEL' | 'PACKAGING' | 'STATIONERY' | 'CLEANING' | 'FUEL' | 'SERVICES' | 'MAINTENANCE' | 'OPERATIONS_MANAGEMENT' | 'PAYROLL' | 'RENT' | 'COMMISSIONS' | 'OTHER';
export type ManualExpenseDestinationScope = 'AURRERA' | 'CHIPITLAN' | 'SHARED' | 'ENRIQUE';
export type ExpenseDestinationScope = ManualExpenseDestinationScope | 'MIXED' | 'UNKNOWN';
export type ExpenseClassificationStatus = 'CLASSIFIED' | 'SYSTEM';
export type ExpenseConceptFilter = ExpenseConceptCode | 'ALL' | 'PENDING' | 'PAYROLL_GROUP';

export interface ExpenseClassificationOption<T extends string> {
  id: T;
  label: string;
}

export interface ClassifiableExpense {
  amount_mxn?: number | string | null;
  concept_code?: ExpenseConceptCode | null;
  destination_scope?: ExpenseDestinationScope | null;
  commission_origin_scope?: ExpenseDestinationScope | null;
  classification_status?: ExpenseClassificationStatus | null;
}

export const EXPENSE_CONCEPT_OPTIONS: readonly ExpenseClassificationOption<ExpenseConceptCode>[];
export const EXPENSE_DESTINATION_OPTIONS: readonly ExpenseClassificationOption<ManualExpenseDestinationScope>[];
export const EXPENSE_REPORT_DESTINATION_OPTIONS: readonly ExpenseClassificationOption<ExpenseDestinationScope>[];
export const PENDING_CLASSIFICATION_LABEL: 'Pendiente de clasificar';
export const PAYROLL_REPORT_GROUP: 'PAYROLL_GROUP';
export function getExpenseConceptLabel(code?: string | null): string;
export function getExpenseDestinationLabel(scope?: string | null): string;
export function getExpenseConceptGroupLabel(code?: string | null): string;
export function getExpenseBudgetDestination(expense?: ClassifiableExpense | null): ExpenseDestinationScope | null;
export function getExpenseCommissionOrigin(expense?: ClassifiableExpense | null): ExpenseDestinationScope | null;
export function getLegacyExpenseCategory(code?: string | null): ExpenseConceptCode | null;
export function getSuggestedExpenseConceptForFixedCost(fixedCost?: {
  name?: string | null;
  category?: string | null;
  obligation_code?: string | null;
} | null): 'MAINTENANCE' | null;
export function getExpenseSaveErrorMessage(error?: {
  message?: unknown;
  details?: unknown;
  code?: unknown;
} | null): string;
export function isExpenseClassificationComplete(expense?: ClassifiableExpense | null): boolean;
export function filterExpensesByClassification<T extends ClassifiableExpense>(
  expenses: readonly T[],
  conceptFilter?: ExpenseConceptFilter,
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
