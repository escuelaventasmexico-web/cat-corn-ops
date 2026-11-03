import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calculateSupplyBudgetProjection,
  getMonthStart,
  isSupplyConcept,
  summarizeSupplyBudgetExpenses,
  SUPPLY_CONCEPT_CODES,
} from '../lib/supplyBudget.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/applied-manually/20261102230000_finance_supply_purchase_budget.sql');
const verification = read('../supabase/verification/20261102230000_verify_finance_supply_purchase_budget.sql');
const panel = read('../components/finance/SupplyBudgetPanel.tsx');
const form = read('../components/finance/ExpenseFormModal.tsx');
const finance = read('../pages/Finanzas.tsx');

assert.deepEqual(SUPPLY_CONCEPT_CODES, ['CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING']);
for (const concept of SUPPLY_CONCEPT_CODES) assert.equal(isSupplyConcept(concept), true);
for (const concept of ['FUEL', 'SERVICES', 'PAYROLL', 'COMMISSIONS', 'OTHER']) assert.equal(isSupplyConcept(concept), false);
assert.equal(getMonthStart('2026-11-30'), '2026-11-01');
assert.equal(getMonthStart('2026-12-01'), '2026-12-01');
assert.equal(getMonthStart('invalid'), null);

const classifiedBudget = summarizeSupplyBudgetExpenses([
  { amount_mxn: 100, concept_code: 'CORN', destination_scope: 'UNKNOWN' },
  { amount_mxn: 200, concept_code: 'OIL', destination_scope: 'SHARED' },
  { amount_mxn: 75, concept_code: 'COMMISSIONS', destination_scope: 'UNKNOWN' },
  { amount_mxn: 50, concept_code: null, destination_scope: null },
]);
assert.equal(classifiedBudget.usedMxn, 300,
  'a recognized supply with unknown destination remains in the global total');
assert.deepEqual(classifiedBudget.usageByDestination, {
  AURRERA: 0,
  CHIPITLAN: 0,
  SHARED: 200,
  UNASSIGNED: 100,
});
assert.equal(Object.values(classifiedBudget.usageByDestination).reduce((sum, amount) => sum + amount, 0), 300,
  'all destination buckets, including unassigned, reconcile to the global total');
assert.deepEqual(classifiedBudget.unassignedSupply, { count: 1, amountMxn: 100 });
assert.deepEqual(classifiedBudget.potentialSupplyUnclassified, { count: 1, amountMxn: 50 },
  'only a missing concept remains a potential supply expense');
assert.deepEqual(classifiedBudget.confirmedNonSupply, { count: 1, amountMxn: 75 });
assert.equal(classifiedBudget.potentialSupplyUnclassified.amountMxn, 50,
  'a COMMISSIONS expense with UNKNOWN destination does not raise the potential-supply alert');

const atEighty = calculateSupplyBudgetProjection({
  limitMxn: 10000,
  usedExcludingEditedExpenseMxn: 7500,
  amountMxn: 500,
  conceptCode: 'CORN',
});
assert.equal(atEighty.projectedUsedMxn, 8000);
assert.equal(atEighty.warningThresholdMxn, 8000);
assert.equal(atEighty.isAtWarning, true);
assert.equal(atEighty.isOverBudget, false);

const overBudget = calculateSupplyBudgetProjection({
  limitMxn: 10000,
  usedExcludingEditedExpenseMxn: 9500,
  amountMxn: 900,
  conceptCode: 'PACKAGING',
});
assert.equal(overBudget.projectedUsedMxn, 10400);
assert.equal(overBudget.exceededMxn, 400);
assert.equal(overBudget.isOverBudget, true);

const editingWithoutDoubleCount = calculateSupplyBudgetProjection({
  limitMxn: 10000,
  // The monthly RPC already excluded the old MXN 1,000 expense.
  usedExcludingEditedExpenseMxn: 7000,
  amountMxn: 1200,
  conceptCode: 'OIL',
});
assert.equal(editingWithoutDoubleCount.projectedUsedMxn, 8200);
assert.notEqual(editingWithoutDoubleCount.projectedUsedMxn, 9200);

const creditPurchase = calculateSupplyBudgetProjection({
  limitMxn: 10000,
  usedExcludingEditedExpenseMxn: 2000,
  amountMxn: 3000,
  conceptCode: 'CARAMEL',
});
assert.equal(creditPurchase.projectedUsedMxn, 5000,
  'budget consumption depends on the expense registration, not the liquidity instrument');

const unconfiguredMonth = calculateSupplyBudgetProjection({
  limitMxn: null,
  usedExcludingEditedExpenseMxn: 500,
  amountMxn: 250,
  conceptCode: 'SEASONINGS',
});
assert.equal(unconfiguredMonth.projectedUsedMxn, 750);
assert.equal(unconfiguredMonth.remainingMxn, null);
assert.equal(unconfiguredMonth.isAtWarning, false);
assert.equal(unconfiguredMonth.isOverBudget, false);

assert.match(migration, /^BEGIN;/m);
assert.match(migration, /COMMIT;\s*$/);
assert.match(migration, /APPLIED MANUALLY IN SUPABASE: do not execute this migration again/);
assert.match(migration, /VALUES \(DATE '2026-11-01', 10000\.00\)/);
assert.match(migration, /ON CONFLICT \(month_start\) DO NOTHING/);
assert.match(migration, /finance_has_available_funds_access/);
assert.equal((migration.match(/finance_has_available_funds_access\(\) IS NOT TRUE/g) || []).length, 2,
  'both RPCs deny false and null access results');
assert.match(migration, /p_exclude_expense_id/);
assert.match(migration, /expense\.id <> p_exclude_expense_id/);
assert.match(migration, /'CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING'/);
assert.match(migration, /expense\.destination_scope = 'SHARED'/);
assert.match(migration, /'UNASSIGNED', v_unassigned/);
assert.match(migration, /'potential_supply_unclassified'/);
assert.match(migration, /'confirmed_non_supply'/);
assert.doesNotMatch(migration, /UPDATE\s+public\.expenses/i);
assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.expenses/i);
assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.finance_month_summary/i);
assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.finance_month_available_funds/i);
assert.doesNotMatch(migration, /finance_credit_card_payments[\s\S]*SUM/i,
  'card payments must not consume the supply budget');

assert.match(verification, /READ-ONLY/);
assert.doesNotMatch(verification, /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/im);
assert.match(verification, /destination_breakdown_sums_to_global/);
assert.match(verification, /commission_unknown_does_not_raise_supply_alert/);
assert.match(verification, /calculation_rule_checks_passed/);
assert.match(verification, /all_checks_passed/);

assert.match(panel, /Sin presupuesto definido/);
assert.match(panel, /Aurrera/);
assert.match(panel, /Chipitlán/);
assert.match(panel, /Compartido/);
assert.match(panel, /Compartido cuenta una sola vez/);
assert.match(panel, /Sin destino asignado/);
assert.match(panel, /Ya están incluidos una sola vez/);
assert.match(panel, /Podrían corresponder a insumos/);
assert.match(panel, /concepto confirmado que no corresponde a insumos/);
assert.match(form, /Acumulado proyectado/);
assert.match(form, /al menos el 80%/);
assert.match(form, /La compra rebasará el límite/);
assert.match(form, /Puedes registrar el gasto real/);
assert.match(form, /getSupplyBudgetSnapshot\(monthStart, expense\?\.id\)/);
assert.match(form, /La compra a crédito consume este presupuesto al registrarse/);
assert.match(finance, /SupplyBudgetPanel monthStartISO=\{monthStartISO\}/);

console.log('✓ finance supply-purchase budget tests passed');
