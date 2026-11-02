const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const AVAILABLE_FUNDS_LIMITATION_KEYS = [
  'pending_expenses',
  'refunded_pos_sales',
  'order_sales',
  'delivery_sales',
  'unsupported_pos_payments',
  'ambiguous_cutoff_movements',
];

export const calculateKnownAvailableFunds = ({
  openingBalance = 0,
  posCollections = 0,
  b2bCollections = 0,
  immediateExpenses = 0,
  creditCardPayments = 0,
}) => roundMoney(
  openingBalance
  + posCollections
  + b2bCollections
  - immediateExpenses
  - creditCardPayments,
);

export const hasAvailableFundsLimitations = (limitations = {}) =>
  AVAILABLE_FUNDS_LIMITATION_KEYS.some((key) => Number(limitations[key]?.count ?? limitations[key] ?? 0) > 0);

export const buildAvailableFundsStatus = ({ hasOpeningBalance, limitations = {} }) => {
  if (!hasOpeningBalance) return 'MISSING_OPENING';
  return hasAvailableFundsLimitations(limitations) ? 'INCOMPLETE' : 'EXACT';
};
export const getLegacyPaymentMethod = (paymentInstrument) => {
  if (paymentInstrument === 'CASH') return 'CASH';
  if (paymentInstrument === 'TRANSFER') return 'TRANSFER';
  if (['DEBIT_CARD', 'CREDIT_CARD', 'MERCADO_PAGO'].includes(paymentInstrument)) return 'CARD';
  return 'OTHER';
};

export const getExpenseLiquidityTreatment = (paymentInstrument) =>
  paymentInstrument === 'CREDIT_CARD' ? 'CREDIT' : 'IMMEDIATE';

export const isBusinessDateOnOrAfterCutoff = (movementDate, cutoffBusinessDate) =>
  String(movementDate).slice(0, 10) >= String(cutoffBusinessDate).slice(0, 10);

export const resolveMovementAfterOpening = ({
  movementDate,
  cutoffBusinessDate,
  sameDayDecision = null,
  sameDaySourceDefault = null,
}) => {
  const movement = String(movementDate).slice(0, 10);
  const cutoff = String(cutoffBusinessDate).slice(0, 10);
  if (movement > cutoff) return true;
  if (movement < cutoff) return false;
  if (sameDayDecision === 'AFTER_OPENING') return true;
  if (sameDayDecision === 'BEFORE_OPENING') return false;
  if (sameDaySourceDefault === 'AFTER_OPENING') return true;
  if (sameDaySourceDefault === 'BEFORE_OPENING') return false;
  return null;
};
