import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAvailableFundsStatus,
  calculateKnownAvailableFunds,
  getExpenseLiquidityTreatment,
  getLegacyPaymentMethod,
  isBusinessDateOnOrAfterCutoff,
  resolveMovementAfterOpening,
} from '../lib/availableFunds.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/applied-manually/20261101090000_finance_available_funds_stage1.sql');
const diagnostic = read('../supabase/diagnostics/20261101_diagnose_available_funds_stage1.sql');
const verification = read('../supabase/verification/20261101090000_verify_finance_available_funds_stage1.sql');
const authenticatedVerification = read('../supabase/verification/20261101091000_verify_finance_available_funds_authenticated.sql');
const enforcement = read('../supabase/pending/20261101100000_enforce_expense_liquidity_classification.sql');
const followup = read('../supabase/applied-manually/20261101220000_available_funds_pos_defaults_commission_liquidity.sql');
const followupVerification = read('../supabase/verification/20261101220000_verify_available_funds_pos_defaults_commission_liquidity.sql');
const panel = read('../components/finance/AvailableFundsPanel.tsx');
const expenseForm = read('../components/finance/ExpenseFormModal.tsx');
const service = read('../services/availableFundsService.ts');

assert.equal(calculateKnownAvailableFunds({ openingBalance: 3920, creditCardPayments: 4940 }), -1020,
  'a real card payment leaves the requested -$1,020 cash-flow balance');
assert.equal(calculateKnownAvailableFunds({
  openingBalance: 10010,
  posCollections: 2500,
  b2bCollections: 800,
  immediateExpenses: 6624,
  creditCardPayments: 1000,
}), 5686);
assert.equal(calculateKnownAvailableFunds({ openingBalance: 10010 }), 10010,
  'the opening balance is not sales or profit');

assert.equal(buildAvailableFundsStatus({ hasOpeningBalance: false }), 'MISSING_OPENING');
assert.equal(buildAvailableFundsStatus({ hasOpeningBalance: true }), 'EXACT');
assert.equal(buildAvailableFundsStatus({ hasOpeningBalance: true, limitations: {
  delivery_sales: { count: 1, amount_mxn: 300 },
} }), 'INCOMPLETE');
assert.equal(getExpenseLiquidityTreatment('CREDIT_CARD'), 'CREDIT');
assert.equal(getExpenseLiquidityTreatment('MERCADO_PAGO'), 'IMMEDIATE');
assert.equal(getLegacyPaymentMethod('DEBIT_CARD'), 'CARD');
assert.equal(getLegacyPaymentMethod('CREDIT_CARD'), 'CARD');
assert.equal(isBusinessDateOnOrAfterCutoff('2026-10-31', '2026-11-01'), false);
assert.equal(isBusinessDateOnOrAfterCutoff('2026-11-01', '2026-11-01'), true);
assert.equal(isBusinessDateOnOrAfterCutoff('2026-11-02', '2026-11-01'), true);
assert.equal(resolveMovementAfterOpening({ movementDate: '2026-11-01', cutoffBusinessDate: '2026-11-01' }), null);
assert.equal(resolveMovementAfterOpening({ movementDate: '2026-11-01', cutoffBusinessDate: '2026-11-01', sameDayDecision: 'AFTER_OPENING' }), true);
assert.equal(resolveMovementAfterOpening({ movementDate: '2026-11-01', cutoffBusinessDate: '2026-11-01', sameDayDecision: 'BEFORE_OPENING' }), false);
assert.equal(resolveMovementAfterOpening({
  movementDate: '2026-11-01', cutoffBusinessDate: '2026-11-01', sameDaySourceDefault: 'AFTER_OPENING',
}), true, 'a joint POS decision resolves all same-day sales without per-sale confirmation');
assert.equal(resolveMovementAfterOpening({
  movementDate: '2026-11-01', cutoffBusinessDate: '2026-11-01',
  sameDayDecision: 'BEFORE_OPENING', sameDaySourceDefault: 'AFTER_OPENING',
}), false, 'an individual exception overrides the joint POS decision');
assert.equal(resolveMovementAfterOpening({ movementDate: '2026-11-02', cutoffBusinessDate: '2026-11-01' }), true);
const diagnosedPos = [65, 65, 65, 90];
assert.equal(diagnosedPos.length, 4);
assert.equal(diagnosedPos.reduce((sum, value) => sum + value, 0), 285);
const realPayments = [
  { expenseDate: '2026-11-01', capturedAt: '2026-11-01T23:59:00Z', amount: 5000, decision: 'AFTER_OPENING' },
  { expenseDate: '2026-11-01', capturedAt: '2026-11-03T18:00:00Z', amount: 1000, decision: 'AFTER_OPENING' },
  { expenseDate: '2026-11-01', capturedAt: '2026-11-10T12:00:00Z', amount: 390, decision: 'AFTER_OPENING' },
];
assert.equal(realPayments.filter(payment =>
  resolveMovementAfterOpening({ movementDate: payment.expenseDate, cutoffBusinessDate: '2026-11-01', sameDayDecision: payment.decision }) === true).length, 3,
  'all three real payments are post-opening by explicit decision, regardless of capturedAt');
assert.equal(realPayments.reduce((sum, payment) => sum + payment.amount, 0), 6390);
assert.equal(calculateKnownAvailableFunds({ openingBalance: 10010, posCollections: 285, immediateExpenses: 6390 }), 3905);
assert.equal(calculateKnownAvailableFunds({ openingBalance: 10010, posCollections: 285, immediateExpenses: 6490 }), 3805,
  'the audited $100 Gerardo cash commission is subtracted once');
assert.equal(resolveMovementAfterOpening({
  movementDate: '2026-11-03', cutoffBusinessDate: '2026-11-01', sameDayDecision: null,
}), true, 'a later refund is detected even when its original sale predates the opening');

assert.match(migration, /^BEGIN;/m);
assert.match(migration, /COMMIT;\s*$/);
assert.match(migration, /cutoff_business_date DATE NOT NULL/);
assert.match(migration, /finance_opening_day_movement_decisions/);
assert.match(migration, /BEFORE_OPENING/);
assert.match(migration, /AFTER_OPENING/);
assert.match(migration, /sale\.created_at AT TIME ZONE 'America\/Mexico_City'/);
assert.match(migration, /finance_is_after_opening/);
assert.match(migration, /v_cutoff_date, expense\.expense_date, 'EXPENSE', expense\.id/);
assert.match(migration, /v_cutoff_date, payment\.payment_date,[\s\S]*'CREDIT_CARD_PAYMENT'/);
assert.doesNotMatch(migration, /expense\.created_at > v_cutoff/);
assert.match(migration, /GRANT INSERT \(liquidity_treatment, payment_instrument, credit_card_id\)/);
assert.match(migration, /Protected commission_settlement_id privileges were restored unexpectedly/);
assert.match(migration, /finance_has_available_funds_access/);
assert.match(migration, /profile\.role = 'admin'/);
assert.match(migration, /finance_card_payments_select_authorized/);
assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.finance_credit_card_payments FROM authenticated/);
assert.match(migration, /enforce_credit_card_payment_history/);
assert.match(migration, /NEW\.amount_mxn IS DISTINCT FROM OLD\.amount_mxn/);
assert.match(migration, /NEW\.payment_date IS DISTINCT FROM OLD\.payment_date/);
assert.match(migration, /NEW\.credit_card_id IS DISTINCT FROM OLD\.credit_card_id/);
assert.match(migration, /NEW\.idempotency_key IS DISTINCT FROM OLD\.idempotency_key/);
assert.match(migration, /finance_reverse_credit_card_payment/);
assert.match(migration, /sale\.refunded_at AT TIME ZONE 'America\/Mexico_City'/);
assert.match(migration, /v_opening_amount \+ v_pos \+ v_b2b - v_expenses - v_card_payments/);
assert.match(migration, /public\.v_b2b_confirmed_payments/);
assert.match(migration, /lower\(COALESCE\(sale\.sale_origin, 'pos'\)\) = 'pos'/);
assert.match(migration, /WHEN 'CARD' THEN COALESCE\(NULLIF\(sale\.card_amount, 0\), sale\.total\)/);
assert.match(migration, /liquidity_treatment = 'CREDIT'/);
assert.match(migration, /finance_credit_card_payments/);
assert.match(migration, /idempotency_key UUID NOT NULL UNIQUE/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /idempotency token was already used with different payment data/);
assert.match(migration, /order_sales/);
assert.match(migration, /delivery_sales/);
assert.match(migration, /refunded_pos_sales/);
assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.finance_month_summary/);
assert.doesNotMatch(migration, /UPDATE\s+public\.expenses/i);
assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.expenses/i);
assert.match(enforcement, /IF TG_OP = 'INSERT'/);
assert.match(enforcement, /historical pending rows remain intact/);
assert.doesNotMatch(enforcement, /UPDATE\s+public\.expenses/i);

assert.match(expenseForm, /Tarjeta de crédito · crea obligación/);
assert.match(expenseForm, /Mercado Pago · disponible\/pago inmediato/);
assert.match(expenseForm, /liquidity_treatment: liquidityTreatment/);
assert.match(expenseForm, /credit_card_id: liquidityTreatment === 'CREDIT'/);
assert.match(panel, /Registrar pago de tarjeta/);
for (const label of ['Saldo inicial', 'Cobros POS', 'Cobranza B2B', 'Gastos pagados', 'Pagos de tarjeta', 'Saldo disponible']) {
  assert.match(panel, new RegExp(label), `el desglose visible incluye ${label}`);
}
assert.match(panel, /Cómo se obtiene el saldo disponible/);
assert.match(panel, /Saldo inicial \+ cobros POS \+ cobranza B2B − gastos pagados − pagos de tarjeta/);
assert.match(panel, /El saldo inicial sólo pertenece a este flujo/);
assert.match(panel, /No se presenta como saldo exacto/, 'se conservan advertencias cuando falta información');
assert.match(panel, /idempotencyKey: paymentToken/);
assert.match(panel, /no crea otro gasto en P&L/);
assert.match(panel, /Ocurrió después/);
assert.match(panel, /Ya incluido/);
assert.match(panel, /Reversar pago de tarjeta/);
assert.match(panel, /registra después un pago nuevo/);
assert.match(service, /finance_register_credit_card_payment/);
assert.match(service, /finance_reverse_credit_card_payment/);
assert.match(service, /listFinanceCreditCardPayments/);
assert.match(service, /finance_opening_day_movement_decisions/);
assert.match(service, /finance_opening_day_source_defaults/);
assert.match(service, /finance_clear_opening_movement_decision/);
assert.match(panel, /Todas ocurrieron después/);
assert.match(panel, /Usar regla conjunta/);

assert.match(followup, /^BEGIN;/m);
assert.match(followup, /COMMIT;\s*$/);
assert.match(followup, /CREATE TABLE public\.finance_opening_day_source_defaults/);
assert.match(followup, /CREATE TABLE public\.finance_expense_liquidity_adjustments/);
assert.match(followup, /individual decisions remain audited overrides/);
assert.match(followup, /COALESCE\([\s\S]*decision\.position = 'AFTER_OPENING'[\s\S]*source_default\.position = 'AFTER_OPENING'/);
assert.match(followup, /NEW\.destination_scope := 'SHARED'/);
assert.match(followup, /NEW\.commission_origin_scope := CASE/);
assert.match(followup, /COALESCE\(adjustment\.liquidity_treatment, expense\.liquidity_treatment\)/);
assert.match(followup, /20261101-2200-4000-8000-000000000100/);
assert.match(followup, /expense\.amount_mxn = 100/);
assert.match(followup, /decision\.position = 'AFTER_OPENING'/);
assert.doesNotMatch(followup, /UPDATE\s+public\.expenses/i);
assert.doesNotMatch(followup, /INSERT\s+INTO\s+public\.expenses/i);
assert.doesNotMatch(followup, /CREATE OR REPLACE FUNCTION public\.finance_month_summary/);
assert.doesNotMatch(followup, /CREATE OR REPLACE FUNCTION public\.create_expense_for_paid_commission_settlement/);

const stripComments = sql => sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
  .replace(/'([^']|'')*'/g, "''");
for (const sql of [diagnostic, verification, followupVerification]) {
  assert.doesNotMatch(stripComments(sql), /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE)\b/i);
}
assert.match(verification, /structural_checks_passed/);
assert.match(verification, /exact_liquidity_classification_complete/);
assert.doesNotMatch(verification, /SELECT\s+public\.finance_month_available_funds/i);
assert.doesNotMatch(verification, /auth\.uid\(\)/);
assert.match(authenticatedVerification, /SET LOCAL ROLE authenticated/);
assert.match(authenticatedVerification, /ARRAY\[5000::NUMERIC, 1000::NUMERIC, 390::NUMERIC\]/);
assert.match(authenticatedVerification, /known_available_mxn'\)::NUMERIC <> -1020/);
assert.match(authenticatedVerification, /v_card_retry_result IS DISTINCT FROM v_card_result/);
assert.match(authenticatedVerification, /non-admin authenticated profile read protected finance rows/);
assert.match(authenticatedVerification, /authenticated unexpectedly changed immutable card-payment facts/);
assert.match(authenticatedVerification, /known_available_mxn'\)::NUMERIC <> 3920/);
assert.match(authenticatedVerification, /finance_reverse_credit_card_payment/);
assert.match(authenticatedVerification, /ROLLBACK;\s*$/);
assert.match(followupVerification, /expected_available_mxn = 3805 AS expected_3805_confirmed/);
assert.match(followupVerification, /structural_checks_passed/);

console.log('OK: corte; POS/MP; B2B cobrado; gastos inmediatos/crédito; pagos parciales; limitaciones; -$1,020');
