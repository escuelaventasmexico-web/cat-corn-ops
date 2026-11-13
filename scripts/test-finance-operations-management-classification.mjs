import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  EXPENSE_CONCEPT_OPTIONS,
  EXPENSE_DESTINATION_OPTIONS,
  EXPENSE_REPORT_DESTINATION_OPTIONS,
  filterExpensesByClassification,
  getExpenseConceptLabel,
  getExpenseDestinationLabel,
  getLegacyExpenseCategory,
  isExpenseClassificationComplete,
  sumExpensesOnce,
} from '../lib/expenseClassification.js';
import { isSupplyConcept } from '../lib/supplyBudget.js';
import { isFuelConcept } from '../lib/fuelBudget.js';
import { isStationeryConcept } from '../lib/stationeryBudget.js';
import { isCleaningConcept } from '../lib/cleaningBudget.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/applied-manually/20261111180000_add_operations_management_expense_classification.sql');
const verification = read('../supabase/verification/20261111180000_verify_operations_management_expense_classification.sql');
const form = read('../components/finance/ExpenseFormModal.tsx');
const manager = read('../components/finance/ExpensesManager.tsx');
const exporter = read('../lib/exportExpenses.ts');
const docs = read('../docs/finance-expense-classification.md');
const publicationDocs = read('../docs/finance-operations-management-classification.md');
const withoutCommentsAndStrings = sql => sql
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n')
  .replace(/'(?:''|[^'])*'/g, "''");
const sha256 = value => createHash('sha256').update(value).digest('hex');

assert.equal(
  sha256(migration),
  'd768ca28d1c35eaa0e3b12eff0147f9e47628a4173081353e9a6bc1d913438e6',
  'the repository must preserve the exact SQL applied manually',
);
assert.equal(
  sha256(verification),
  'bc9f77a9c3ec87444bb82f0dffa59ca7bc32ca9b7d911b606e23b8b46ab039fd',
  'the repository must preserve the verified read-only SQL',
);

assert.equal(EXPENSE_CONCEPT_OPTIONS.some(option => (
  option.id === 'OPERATIONS_MANAGEMENT'
  && option.label === 'Gastos dirección operativa'
)), true);
assert.equal(EXPENSE_DESTINATION_OPTIONS.some(option => (
  option.id === 'ENRIQUE' && option.label === 'Enrique'
)), true);
assert.equal(EXPENSE_REPORT_DESTINATION_OPTIONS.some(option => (
  option.id === 'ENRIQUE' && option.label === 'Enrique'
)), true);
assert.equal(getExpenseConceptLabel('OPERATIONS_MANAGEMENT'), 'Gastos dirección operativa');
assert.equal(getExpenseDestinationLabel('ENRIQUE'), 'Enrique');
assert.equal(getLegacyExpenseCategory('OPERATIONS_MANAGEMENT'), 'OPERATIONS_MANAGEMENT');

const historicalOther = {
  id: 'historical-other', amount_mxn: 6000, concept_code: 'OTHER',
  destination_scope: 'SHARED', classification_status: 'CLASSIFIED',
};
const operationsExpense = {
  id: 'operations-management', amount_mxn: 750,
  concept_code: 'OPERATIONS_MANAGEMENT', destination_scope: 'ENRIQUE',
  classification_status: 'CLASSIFIED',
};
const fixtures = [historicalOther, operationsExpense];
assert.equal(isExpenseClassificationComplete(operationsExpense), true);
assert.deepEqual(
  filterExpensesByClassification(fixtures, 'OPERATIONS_MANAGEMENT', 'ENRIQUE').map(row => row.id),
  ['operations-management'],
);
assert.equal(sumExpensesOnce(filterExpensesByClassification(fixtures, 'OPERATIONS_MANAGEMENT', 'ENRIQUE')), 750);
assert.equal(historicalOther.concept_code, 'OTHER', 'historical OTHER remains unchanged');

for (const isSpecialBudgetConcept of [
  isSupplyConcept, isFuelConcept, isStationeryConcept, isCleaningConcept,
]) {
  assert.equal(isSpecialBudgetConcept('OPERATIONS_MANAGEMENT'), false);
}

assert.match(form, /EXPENSE_CONCEPT_OPTIONS/);
assert.match(form, /EXPENSE_DESTINATION_OPTIONS/);
assert.match(form, /expense\?\.destination_scope === 'ENRIQUE'/);
assert.match(manager, /EXPENSE_CONCEPT_OPTIONS/);
assert.match(manager, /EXPENSE_REPORT_DESTINATION_OPTIONS/);
assert.match(manager, /getExpenseConceptLabel/);
assert.match(manager, /getExpenseDestinationLabel/);
assert.match(exporter, /getExpenseConceptLabel\(e\.concept_code\)/);
assert.match(exporter, /getExpenseDestinationLabel\(getExpenseBudgetDestination\(e\)\)/);

assert.match(migration, /^BEGIN;/m);
assert.match(migration, /COMMIT;\s*$/);
assert.match(migration, /'OPERATIONS_MANAGEMENT'/);
assert.match(migration, /'ENRIQUE'/);
assert.match(migration, /destination_scope IN \('AURRERA', 'CHIPITLAN', 'SHARED', 'ENRIQUE'\)/);
assert.match(migration, /v_fixed_scope NOT IN \('AURRERA', 'CHIPITLAN', 'SHARED'\)/);
assert.doesNotMatch(migration, /v_fixed_scope NOT IN \([^)]*ENRIQUE/);
assert.match(migration, /NEW\.destination_scope := 'SHARED'/);
assert.match(migration, /NEW\.commission_origin_scope := CASE/);
assert.doesNotMatch(migration, /^\s*(UPDATE|INSERT INTO|DELETE FROM)\s+public\.expenses\b/im);
assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.finance_/i);
assert.doesNotMatch(migration, /GRANT\s+(INSERT|UPDATE)[\s\S]*commission_settlement_id/i);
assert.equal(
  existsSync(new URL('../supabase/migrations/20261111180000_add_operations_management_expense_classification.sql', import.meta.url)),
  false,
  'the manually applied migration must stay outside the automatic migration directory',
);

assert.match(verification, /STRICTLY READ ONLY/);
assert.doesNotMatch(
  withoutCommentsAndStrings(verification),
  /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|CALL|DO)\b/i,
);
assert.match(verification, /operations_management_isolated_from_special_budgets/);
assert.match(verification, /historical_other_expense_count/);
assert.match(verification, /commission_link_write_still_protected/);
assert.match(verification, /fixed_cost_destinations_unchanged/);
assert.match(docs, /OPERATIONS_MANAGEMENT/);
assert.match(docs, /ENRIQUE/);
assert.match(docs, /no reclasifica filas `OTHER`/);
assert.match(publicationDocs, /se aplicó manualmente en Supabase/);
assert.match(publicationDocs, /Se retiró de `supabase\/migrations`/);

console.log('✓ operations-management concept and Enrique destination tests passed');
