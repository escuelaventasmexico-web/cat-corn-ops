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
  orderCollections?: number;
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

export interface OpeningDayPosSummaryInput {
  default_position?: 'BEFORE_OPENING' | 'AFTER_OPENING' | null;
  count?: number;
  amount_mxn?: number;
  sales?: Array<{
    amount_mxn?: number;
    individual_position?: 'BEFORE_OPENING' | 'AFTER_OPENING' | null;
    effective_position?: 'BEFORE_OPENING' | 'AFTER_OPENING' | null;
  }>;
}

export interface OpeningDayPosSummary {
  status: 'EMPTY' | 'PENDING' | 'ALL_AFTER' | 'ALL_BEFORE' | 'MIXED';
  isResolved: boolean;
  count: number;
  amountMxn: number;
  afterCount: number;
  afterAmountMxn: number;
  beforeCount: number;
  beforeAmountMxn: number;
  unresolvedCount: number;
}

export function summarizeOpeningDayPos(input?: OpeningDayPosSummaryInput): OpeningDayPosSummary;
