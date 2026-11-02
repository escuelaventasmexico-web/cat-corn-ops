export type AvailableFundsStatus = 'MISSING_OPENING' | 'INCOMPLETE' | 'EXACT';
export type ExpenseLiquidityTreatment = 'IMMEDIATE' | 'CREDIT' | 'PENDING';
export type ExpensePaymentInstrument = 'CASH' | 'TRANSFER' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'MERCADO_PAGO' | 'OTHER';

export interface AvailableFundsLimitationValue {
  count: number;
  amount_mxn: number;
}

export interface AvailableFundsLimitations {
  pending_expenses?: AvailableFundsLimitationValue;
  refunded_pos_sales?: AvailableFundsLimitationValue;
  order_sales?: AvailableFundsLimitationValue;
  delivery_sales?: AvailableFundsLimitationValue;
  unsupported_pos_payments?: AvailableFundsLimitationValue;
  ambiguous_cutoff_movements?: AvailableFundsLimitationValue;
}

export function calculateKnownAvailableFunds(input: {
  openingBalance?: number;
  posCollections?: number;
  b2bCollections?: number;
  immediateExpenses?: number;
  creditCardPayments?: number;
}): number;
export function hasAvailableFundsLimitations(limitations?: AvailableFundsLimitations): boolean;
export function buildAvailableFundsStatus(input: { hasOpeningBalance: boolean; limitations?: AvailableFundsLimitations }): AvailableFundsStatus;
export function getLegacyPaymentMethod(paymentInstrument: ExpensePaymentInstrument): 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';
export function getExpenseLiquidityTreatment(paymentInstrument: ExpensePaymentInstrument): 'IMMEDIATE' | 'CREDIT';
export function isBusinessDateOnOrAfterCutoff(movementDate: string, cutoffBusinessDate: string): boolean;
export function resolveMovementAfterOpening(input: {
  movementDate: string;
  cutoffBusinessDate: string;
  sameDayDecision?: 'BEFORE_OPENING' | 'AFTER_OPENING' | null;
  sameDaySourceDefault?: 'BEFORE_OPENING' | 'AFTER_OPENING' | null;
}): boolean | null;
