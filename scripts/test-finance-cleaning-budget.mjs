import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  calculateCleaningBudgetProjection,
  isCleaningConcept,
  CLEANING_BUDGET_WARNING_RATIO,
  CLEANING_CONCEPT_CODE,
} from '../lib/cleaningBudget.js';
import { getLegacyExpenseCategory } from '../lib/expenseClassification.js';
import { isSupplyConcept } from '../lib/supplyBudget.js';
import { isFuelConcept } from '../lib/fuelBudget.js';
import { isStationeryConcept } from '../lib/stationeryBudget.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/applied-manually/20261106120000_finance_cleaning_budget.sql');
const verification = read('../supabase/verification/20261106120000_verify_finance_cleaning_budget.sql');
const form = read('../components/finance/ExpenseFormModal.tsx');
const panel = read('../components/finance/CleaningBudgetPanel.tsx');
const finance = read('../pages/Finanzas.tsx');
const classification = read('../lib/expenseClassification.js');
const sha256 = value => createHash('sha256').update(value).digest('hex');

assert.equal(
  sha256(migration),
  '4d99d146b4095da1546f7b30af0c3640b5616cd04b3982d39dc161e9da2c054a',
  'the repository must preserve the exact cleaning SQL applied manually',
);
assert.equal(
  existsSync(new URL('../supabase/migrations/20261106120000_finance_cleaning_budget.sql', import.meta.url)),
  false,
  'the manually applied migration must stay outside the automatic migration directory',
);

assert.equal(CLEANING_CONCEPT_CODE, 'CLEANING');
assert.equal(CLEANING_BUDGET_WARNING_RATIO, 0.8);
assert.equal(isCleaningConcept('CLEANING'), true);
assert.equal(isSupplyConcept('CLEANING'), false,
  'cleaning remains independent from the supply-purchase budget');
assert.equal(isFuelConcept('CLEANING'), false,
  'cleaning remains independent from the fuel budget');
assert.equal(isStationeryConcept('CLEANING'), false,
  'cleaning remains independent from the stationery budget');
for (const concept of ['STATIONERY', 'SERVICES', 'OTHER', null]) {
  assert.equal(isCleaningConcept(concept), false);
}
assert.equal(getLegacyExpenseCategory('CLEANING'), 'CLEANING');
assert.match(classification, /\{ id: 'CLEANING', label: 'Limpieza' \}/);

const atEighty = calculateCleaningBudgetProjection({
  limitMxn: 350,
  usedExcludingEditedExpenseMxn: 180,
  amountMxn: 100,
  conceptCode: 'CLEANING',
});
assert.equal(atEighty.projectedUsedMxn, 280);
assert.equal(atEighty.warningThresholdMxn, 280);
assert.equal(atEighty.remainingMxn, 70);
assert.equal(atEighty.isAtWarning, true);
assert.equal(atEighty.isOverBudget, false);

const exactLimit = calculateCleaningBudgetProjection({
  limitMxn: 350,
  usedExcludingEditedExpenseMxn: 250,
  amountMxn: 100,
  conceptCode: 'CLEANING',
});
assert.equal(exactLimit.projectedUsedMxn, 350);
assert.equal(exactLimit.isOverBudget, false);

const advisoryOverage = calculateCleaningBudgetProjection({
  limitMxn: 350,
  usedExcludingEditedExpenseMxn: 250,
  amountMxn: 101,
  conceptCode: 'CLEANING',
});
assert.equal(advisoryOverage.projectedUsedMxn, 351);
assert.equal(advisoryOverage.exceededMxn, 1);
assert.equal(advisoryOverage.isOverBudget, true);

const editedReplacement = calculateCleaningBudgetProjection({
  limitMxn: 350,
  // The RPC excludes the old MXN 100 row before adding its replacement.
  usedExcludingEditedExpenseMxn: 100,
  amountMxn: 120,
  conceptCode: 'CLEANING',
});
assert.equal(editedReplacement.projectedUsedMxn, 220);
assert.notEqual(editedReplacement.projectedUsedMxn, 320,
  'editing replaces the previous amount instead of counting it twice');

const creditPurchase = calculateCleaningBudgetProjection({
  limitMxn: 350,
  usedExcludingEditedExpenseMxn: 100,
  amountMxn: 80,
  conceptCode: 'CLEANING',
});
assert.equal(creditPurchase.projectedUsedMxn, 180,
  'budget use depends on expense registration, regardless of payment instrument');

const differentConcept = calculateCleaningBudgetProjection({
  limitMxn: 350,
  usedExcludingEditedExpenseMxn: 100,
  amountMxn: 80,
  conceptCode: 'SERVICES',
});
assert.equal(differentConcept.projectedUsedMxn, 100,
  'services remain outside the independent cleaning budget');

const noBudget = calculateCleaningBudgetProjection({
  limitMxn: null,
  usedExcludingEditedExpenseMxn: 50,
  amountMxn: 75,
  conceptCode: 'CLEANING',
});
assert.equal(noBudget.projectedUsedMxn, 125);
assert.equal(noBudget.remainingMxn, null);
assert.equal(noBudget.isAtWarning, false);
assert.equal(noBudget.isOverBudget, false);

assert.match(migration, /^BEGIN;/m);
assert.match(migration, /COMMIT;\s*$/);
assert.match(migration, /REVIEWED LOCALLY ONLY/);
assert.match(migration, /'CLEANING'/);
assert.match(migration, /VALUES \(DATE '2026-11-01', 350\.00\)/);
assert.match(migration, /ON CONFLICT \(month_start\) DO NOTHING/,
  'the November seed must not overwrite an existing reviewed limit');
assert.match(migration, /finance_calculate_cleaning_budget/,
  'the RPC and verifier share a canonical calculation');
assert.equal((migration.match(/finance_has_available_funds_access\(\) IS NOT TRUE/g) || []).length, 2,
  'both public RPCs deny false and null access results');
assert.match(migration, /p_exclude_expense_id/);
assert.match(migration, /expense\.id <> p_exclude_expense_id/);
assert.doesNotMatch(migration, /CREATE TRIGGER enforce_cleaning_budget_limit_trigger/,
  'cleaning overage remains advisory because the requirement only asks for a warning');
assert.doesNotMatch(migration, /UPDATE\s+public\.expenses/i,
  'historical expenses must not be modified');
assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.expenses/i,
  'the migration must not create expenses');
assert.doesNotMatch(migration, /finance_credit_card_payments[\s\S]*SUM/i,
  'credit-card payments must not consume the cleaning budget');
assert.doesNotMatch(migration, /GRANT INSERT \(commission_settlement_id/);

assert.match(verification, /READ-ONLY/);
assert.doesNotMatch(verification, /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/im);
assert.match(verification, /actual_credit_purchase_counted_once/);
assert.match(verification, /actual_unclassified_not_inferred/);
assert.match(verification, /actual_overage_reported_without_reclassification/);
assert.match(verification, /overage_remains_advisory/);
assert.match(verification, /functional_calculation_checks_passed/);
assert.match(verification, /all_checks_passed/);

assert.match(panel, /Presupuesto mensual de limpieza/);
assert.match(panel, /Sin presupuesto definido/);
assert.match(panel, /Gasto acumulado/);
assert.match(panel, /Disponible/);
assert.match(panel, /servitoallas, jabón Roma, Fabuloso, bolsas de basura y productos para control de plagas/);
assert.match(panel, /No se asignaron automáticamente a limpieza/);
assert.match(panel, /Editar límite/);
assert.match(form, /getCleaningBudgetSnapshot\(monthStart, expense\?\.id\)/);
assert.match(form, /El gasto rebasará el límite/);
assert.match(form, /Puedes registrar el gasto real/);
assert.match(form, /al menos el 80% del presupuesto/);
assert.match(form, /La compra a crédito consume este presupuesto al registrarse/);
assert.doesNotMatch(form, /disabled=\{saving \|\| Boolean\(cleaningProjection\?\.isOverBudget\)\}/,
  'cleaning overage warns but does not block an actual expense');
assert.match(finance, /CleaningBudgetPanel monthStartISO=\{monthStartISO\}/);

console.log('✓ finance cleaning budget tests passed');
