import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  EXPENSE_CONCEPT_OPTIONS,
  filterExpensesByClassification,
  getExpenseConceptGroupLabel,
  getExpenseConceptLabel,
  getLegacyExpenseCategory,
  getSuggestedExpenseConceptForFixedCost,
  sumExpensesOnce,
} from '../lib/expenseClassification.js';
import { isSupplyConcept } from '../lib/supplyBudget.js';
import { isFuelConcept } from '../lib/fuelBudget.js';
import { isStationeryConcept } from '../lib/stationeryBudget.js';
import { isCleaningConcept } from '../lib/cleaningBudget.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/applied-manually/20261111120000_add_maintenance_expense_concept.sql');
const verification = read('../supabase/verification/20261111120000_verify_maintenance_expense_concept.sql');
const form = read('../components/finance/ExpenseFormModal.tsx');
const manager = read('../components/finance/ExpensesManager.tsx');
const exporter = read('../lib/exportExpenses.ts');
const docs = read('../docs/finance-maintenance-concept.md');
const withoutComments = sql => sql
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n')
  .replace(/'(?:''|[^'])*'/g, "''");

assert.equal(EXPENSE_CONCEPT_OPTIONS.some(option => (
  option.id === 'MAINTENANCE' && option.label === 'Mantenimiento'
)), true);
assert.equal(getExpenseConceptLabel('MAINTENANCE'), 'Mantenimiento');
assert.equal(getExpenseConceptGroupLabel('MAINTENANCE'), 'Mantenimiento');
assert.equal(getLegacyExpenseCategory('MAINTENANCE'), 'MAINTENANCE');

assert.equal(
  getSuggestedExpenseConceptForFixedCost({ name: 'Mantenimiento del local Aurrera' }),
  'MAINTENANCE',
);
assert.equal(
  getSuggestedExpenseConceptForFixedCost({ name: 'Reparación mensual', category: 'Mantenimiento' }),
  'MAINTENANCE',
);
assert.equal(
  getSuggestedExpenseConceptForFixedCost({ name: 'Servicio del local', obligation_code: 'aurrera.mantenimiento_local' }),
  'MAINTENANCE',
);
assert.equal(getSuggestedExpenseConceptForFixedCost({ name: 'Renta Aurrera' }), null);

const reportFixtures = [
  { id: 'maintenance', amount_mxn: 1624, concept_code: 'MAINTENANCE', destination_scope: 'AURRERA', classification_status: 'CLASSIFIED' },
  { id: 'other', amount_mxn: 200, concept_code: 'OTHER', destination_scope: 'AURRERA', classification_status: 'CLASSIFIED' },
];
const maintenanceRows = filterExpensesByClassification(reportFixtures, 'MAINTENANCE', 'ALL');
assert.deepEqual(maintenanceRows.map(row => row.id), ['maintenance']);
assert.equal(sumExpensesOnce(maintenanceRows), 1624);
assert.equal(reportFixtures[1].concept_code, 'OTHER', 'historical OTHER remains unchanged');

assert.equal(isSupplyConcept('MAINTENANCE'), false);
assert.equal(isFuelConcept('MAINTENANCE'), false);
assert.equal(isStationeryConcept('MAINTENANCE'), false);
assert.equal(isCleaningConcept('MAINTENANCE'), false);

assert.match(form, /getSuggestedExpenseConceptForFixedCost\(fixedCost\)/);
assert.match(form, /concept_code: suggestedConcept \|\| formData\.concept_code/);
assert.match(manager, /EXPENSE_CONCEPT_OPTIONS/);
assert.match(manager, /getExpenseConceptLabel/);
assert.match(exporter, /getExpenseConceptLabel\(e\.concept_code\)/);
assert.match(exporter, /getExpenseConceptGroupLabel\(e\.concept_code\)/);

assert.match(migration, /^BEGIN;/m);
assert.match(migration, /COMMIT;\s*$/);
assert.match(migration, /'MAINTENANCE'/);
assert.equal(
  existsSync(new URL('../supabase/migrations/20261111120000_add_maintenance_expense_concept.sql', import.meta.url)),
  false,
  'the manually applied migration must not remain available to supabase db push',
);
assert.doesNotMatch(migration, /\bUPDATE\s+public\.expenses\b/i);
assert.doesNotMatch(migration, /\bINSERT\s+INTO\s+public\.expenses\b/i);
assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.finance_/i);
assert.doesNotMatch(migration, /GRANT\s+(INSERT|UPDATE)[\s\S]*commission_settlement_id/i);

assert.match(verification, /READ ONLY/);
assert.doesNotMatch(
  withoutComments(verification),
  /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE)\b/i,
);
assert.match(verification, /maintenance_isolated_from_special_budgets/);
assert.match(verification, /historical_other_expense_count/);
assert.match(verification, /commission_link_write_still_protected/);
assert.match(docs, /aplicado manualmente en Supabase y verificado/);
assert.match(docs, /Se retiró de `supabase\/migrations`/);

console.log('✓ finance maintenance concept tests passed');
