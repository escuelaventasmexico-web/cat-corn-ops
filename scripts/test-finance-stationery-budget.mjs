import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  calculateStationeryBudgetProjection,
  isStationeryConcept,
  STATIONERY_BUDGET_WARNING_RATIO,
  STATIONERY_CONCEPT_CODE,
} from '../lib/stationeryBudget.js';
import { getLegacyExpenseCategory } from '../lib/expenseClassification.js';
import { isSupplyConcept } from '../lib/supplyBudget.js';
import { isFuelConcept } from '../lib/fuelBudget.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/applied-manually/20261105120000_finance_stationery_budget.sql');
const verification = read('../supabase/verification/20261105120000_verify_finance_stationery_budget.sql');
const form = read('../components/finance/ExpenseFormModal.tsx');
const panel = read('../components/finance/StationeryBudgetPanel.tsx');
const finance = read('../pages/Finanzas.tsx');
const classification = read('../lib/expenseClassification.js');
const sha256 = value => createHash('sha256').update(value).digest('hex');

assert.equal(
  sha256(migration),
  '68b39b1028f24ef544bb1b71474d23d5a61e414a82792a733f4d8867f9769448',
  'the repository must preserve the exact stationery SQL applied manually',
);
assert.equal(
  existsSync(new URL('../supabase/migrations/20261105120000_finance_stationery_budget.sql', import.meta.url)),
  false,
  'the manually applied migration must stay outside the automatic migration directory',
);

assert.equal(STATIONERY_CONCEPT_CODE, 'STATIONERY');
assert.equal(STATIONERY_BUDGET_WARNING_RATIO, 0.8);
assert.equal(isStationeryConcept('STATIONERY'), true);
assert.equal(isSupplyConcept('STATIONERY'), false,
  'stationery remains independent from the supply-purchase budget');
assert.equal(isFuelConcept('STATIONERY'), false,
  'stationery remains independent from the fuel budget');
for (const concept of ['PACKAGING', 'SERVICES', 'OTHER', null]) {
  assert.equal(isStationeryConcept(concept), false);
}
assert.equal(getLegacyExpenseCategory('STATIONERY'), 'STATIONERY');
assert.match(classification, /\{ id: 'STATIONERY', label: 'Papelería' \}/);

const atEighty = calculateStationeryBudgetProjection({
  limitMxn: 500,
  usedExcludingEditedExpenseMxn: 300,
  amountMxn: 100,
  conceptCode: 'STATIONERY',
});
assert.equal(atEighty.projectedUsedMxn, 400);
assert.equal(atEighty.warningThresholdMxn, 400);
assert.equal(atEighty.remainingMxn, 100);
assert.equal(atEighty.isAtWarning, true);
assert.equal(atEighty.isOverBudget, false);

const exactLimit = calculateStationeryBudgetProjection({
  limitMxn: 500,
  usedExcludingEditedExpenseMxn: 400,
  amountMxn: 100,
  conceptCode: 'STATIONERY',
});
assert.equal(exactLimit.projectedUsedMxn, 500);
assert.equal(exactLimit.isOverBudget, false, 'spending exactly the limit remains allowed');

const blockedOverage = calculateStationeryBudgetProjection({
  limitMxn: 500,
  usedExcludingEditedExpenseMxn: 400,
  amountMxn: 101,
  conceptCode: 'STATIONERY',
});
assert.equal(blockedOverage.projectedUsedMxn, 501);
assert.equal(blockedOverage.exceededMxn, 1);
assert.equal(blockedOverage.isOverBudget, true);

const editedReplacement = calculateStationeryBudgetProjection({
  limitMxn: 500,
  // The RPC excludes the edited MXN 100 row before adding its replacement.
  usedExcludingEditedExpenseMxn: 250,
  amountMxn: 125,
  conceptCode: 'STATIONERY',
});
assert.equal(editedReplacement.projectedUsedMxn, 375);
assert.notEqual(editedReplacement.projectedUsedMxn, 475,
  'editing replaces the previous amount instead of counting it twice');

const creditPurchase = calculateStationeryBudgetProjection({
  limitMxn: 500,
  usedExcludingEditedExpenseMxn: 200,
  amountMxn: 150,
  conceptCode: 'STATIONERY',
});
assert.equal(creditPurchase.projectedUsedMxn, 350,
  'budget use depends on expense registration, regardless of payment instrument');

const differentConcept = calculateStationeryBudgetProjection({
  limitMxn: 500,
  usedExcludingEditedExpenseMxn: 200,
  amountMxn: 150,
  conceptCode: 'PACKAGING',
});
assert.equal(differentConcept.projectedUsedMxn, 200,
  'packaging remains in the independent supply budget, not stationery');

const noBudget = calculateStationeryBudgetProjection({
  limitMxn: null,
  usedExcludingEditedExpenseMxn: 50,
  amountMxn: 75,
  conceptCode: 'STATIONERY',
});
assert.equal(noBudget.projectedUsedMxn, 125);
assert.equal(noBudget.remainingMxn, null);
assert.equal(noBudget.isAtWarning, false);
assert.equal(noBudget.isOverBudget, false);

assert.match(migration, /^BEGIN;/m);
assert.match(migration, /COMMIT;\s*$/);
assert.match(migration, /REVIEWED LOCALLY ONLY/);
assert.match(migration, /'STATIONERY'/);
assert.match(migration, /VALUES \(DATE '2026-11-01', 500\.00\)/);
assert.match(migration, /ON CONFLICT \(month_start\) DO NOTHING/,
  'the November seed must not overwrite an existing reviewed limit');
assert.match(migration, /finance_calculate_stationery_budget/,
  'the RPC and verifier share a canonical calculation');
assert.equal((migration.match(/finance_has_available_funds_access\(\) IS NOT TRUE/g) || []).length, 2,
  'both public RPCs deny false and null access results');
assert.match(migration, /p_exclude_expense_id/);
assert.match(migration, /expense\.id <> p_exclude_expense_id/);
assert.match(migration, /CREATE TRIGGER enforce_stationery_budget_limit_trigger/);
assert.match(migration, /v_projected_used > v_limit/);
assert.match(migration, /FOR UPDATE/,
  'the database serializes concurrent captures against the same monthly budget');
assert.match(migration, /enforce_stationery_budget_limit\(\)[\s\S]*SECURITY DEFINER/,
  'the trigger can read and lock the protected budget table');
assert.match(migration, /BEFORE INSERT OR UPDATE OF expense_date, amount_mxn, concept_code/);
assert.doesNotMatch(migration, /UPDATE\s+public\.expenses/i,
  'historical expenses must not be modified');
assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.expenses/i,
  'the migration must not create expenses');
assert.doesNotMatch(migration, /finance_credit_card_payments[\s\S]*SUM/i,
  'credit-card payments must not consume the stationery budget');
assert.doesNotMatch(migration, /GRANT INSERT \(commission_settlement_id/);

assert.match(verification, /READ-ONLY/);
assert.doesNotMatch(verification, /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/im);
assert.match(verification, /actual_credit_purchase_counted_once/);
assert.match(verification, /actual_unclassified_not_inferred/);
assert.match(verification, /functional_calculation_checks_passed/);
assert.match(verification, /all_checks_passed/);

assert.match(panel, /Presupuesto mensual de papelería/);
assert.match(panel, /Sin presupuesto definido/);
assert.match(panel, /Gasto acumulado/);
assert.match(panel, /Disponible/);
assert.match(panel, /hojas de sticker, tinta, hojas blancas y rollos térmicos/);
assert.match(panel, /No se asignaron automáticamente a papelería/);
assert.match(panel, /Editar límite/);
assert.match(form, /getStationeryBudgetSnapshot\(monthStart, expense\?\.id\)/);
assert.match(form, /latestStationeryBudget/,
  'save rechecks the latest monthly use before any expense write');
assert.match(form, /El gasto superaría el presupuesto mensual de papelería/);
assert.match(form, /disabled=\{saving \|\| Boolean\(stationeryProjection\?\.isOverBudget\)\}/);
assert.match(form, /al menos el 80% del presupuesto/);
assert.match(form, /La compra a crédito consume este presupuesto al registrarse/);
assert.match(finance, /StationeryBudgetPanel monthStartISO=\{monthStartISO\}/);

console.log('✓ finance stationery budget tests passed');
