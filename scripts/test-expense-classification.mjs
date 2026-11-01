import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXPENSE_CONCEPT_OPTIONS,
  EXPENSE_DESTINATION_OPTIONS,
  EXPENSE_REPORT_DESTINATION_OPTIONS,
  filterExpensesByClassification,
  getExpenseConceptLabel,
  getExpenseDestinationLabel,
  getExpenseSaveErrorMessage,
  getLegacyExpenseCategory,
  isExpenseClassificationComplete,
  resolveCommissionDestination,
  summarizePendingClassification,
  sumExpensesOnce,
} from '../lib/expenseClassification.js';
import {
  EXPENSE_TIME_ZONE,
  getInitialExpenseDate,
  getMexicoCityExpenseDate,
} from '../lib/expenseDate.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261031200000_expense_concept_destination.sql');
const diagnostic = read('../supabase/diagnostics/20261031_diagnose_expense_concept_destination.sql');
const verification = read('../supabase/verification/20261031200000_verify_expense_concept_destination.sql');
const enforcement = read('../supabase/pending/20261031210000_enforce_manual_expense_classification.sql');
const enforcementVerification = read('../supabase/verification/20261031210000_verify_manual_expense_classification_enforcement.sql');
const conceptExpansion = read('../supabase/migrations/20261031203000_add_payroll_rent_expense_concepts.sql');
const conceptExpansionVerification = read('../supabase/verification/20261031203000_verify_payroll_rent_expense_concepts.sql');
const form = read('../components/finance/ExpenseFormModal.tsx');
const manager = read('../components/finance/ExpensesManager.tsx');
const exporter = read('../lib/exportExpenses.ts');
const publicationNotes = read('../docs/finance-expense-classification.md');

assert.equal(EXPENSE_TIME_ZONE, 'America/Mexico_City');
assert.equal(
  getMexicoCityExpenseDate('2026-11-01T05:59:59Z'),
  '2026-10-31',
  'UTC ya está en noviembre, pero Ciudad de México sigue en octubre',
);
assert.equal(
  getMexicoCityExpenseDate('2026-11-01T06:00:00Z'),
  '2026-11-01',
  'la fecha cambia al llegar la medianoche de Ciudad de México',
);
assert.equal(
  getInitialExpenseDate('2026-10-14', '2026-11-01T05:59:59Z'),
  '2026-10-14',
  'guardar y volver a editar conserva la fecha civil almacenada',
);
assert.equal(getInitialExpenseDate(null, '2026-11-01T05:59:59Z'), '2026-10-31');
assert.throws(() => getInitialExpenseDate('31/10/2026'), /inválida/);

assert.deepEqual(
  EXPENSE_CONCEPT_OPTIONS.map(option => option.id),
  ['CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING', 'FUEL', 'SERVICES', 'PAYROLL', 'RENT', 'COMMISSIONS', 'OTHER'],
);
assert.deepEqual(
  EXPENSE_REPORT_DESTINATION_OPTIONS.map(option => option.id),
  ['AURRERA', 'CHIPITLAN', 'SHARED', 'MIXED', 'UNKNOWN'],
);
assert.deepEqual(
  EXPENSE_DESTINATION_OPTIONS.map(option => option.id),
  ['AURRERA', 'CHIPITLAN', 'SHARED'],
);
assert.equal(getExpenseConceptLabel(null), 'Pendiente de clasificar');
assert.equal(getExpenseDestinationLabel(null), 'Pendiente de clasificar');
assert.equal(getExpenseConceptLabel('CORN'), 'Maíz');
assert.equal(getExpenseDestinationLabel('CHIPITLAN'), 'Chipitlán');
assert.equal(getExpenseConceptLabel('COMMISSIONS'), 'Comisiones');
assert.equal(getExpenseConceptLabel('PAYROLL'), 'Nómina');
assert.equal(getExpenseConceptLabel('RENT'), 'Renta');
assert.equal(getExpenseDestinationLabel('UNKNOWN'), 'Destino por determinar');
assert.equal(getExpenseDestinationLabel('MIXED'), 'Mixto');
assert.equal(getLegacyExpenseCategory('PAYROLL'), 'PAYROLL');
assert.equal(getLegacyExpenseCategory('RENT'), 'RENT');
assert.equal(getLegacyExpenseCategory(''), null);
assert.match(
  getExpenseSaveErrorMessage(new TypeError('Failed to fetch')),
  /No se pudo conectar con Supabase[\s\S]*no se guardó/i,
);
assert.match(
  getExpenseSaveErrorMessage({ code: '23502', message: 'null value in column "category" violates not-null constraint' }),
  /falta un dato obligatorio[\s\S]*no se guardó/i,
);

const fixtures = [
  { id: 'legacy', amount_mxn: 100, concept_code: null, destination_scope: null, classification_status: null },
  { id: 'aurrera', amount_mxn: 250, concept_code: 'OIL', destination_scope: 'AURRERA', classification_status: 'CLASSIFIED' },
  { id: 'shared', amount_mxn: 600, concept_code: 'PACKAGING', destination_scope: 'SHARED', classification_status: 'CLASSIFIED' },
  { id: 'commission-unknown', amount_mxn: 50, concept_code: 'COMMISSIONS', destination_scope: 'UNKNOWN', classification_status: 'SYSTEM' },
  { id: 'commission-mixed', amount_mxn: 75, concept_code: 'COMMISSIONS', destination_scope: 'MIXED', classification_status: 'SYSTEM' },
];
assert.equal(isExpenseClassificationComplete(fixtures[0]), false);
assert.equal(isExpenseClassificationComplete(fixtures[1]), true);
assert.equal(isExpenseClassificationComplete(fixtures[3]), false);
assert.equal(isExpenseClassificationComplete(fixtures[4]), true);
assert.deepEqual(filterExpensesByClassification(fixtures, 'PENDING', 'ALL').map(row => row.id), ['legacy']);
assert.deepEqual(filterExpensesByClassification(fixtures, 'ALL', 'SHARED').map(row => row.id), ['shared']);
assert.deepEqual(filterExpensesByClassification(fixtures, 'ALL', 'PENDING').map(row => row.id), ['legacy', 'commission-unknown']);
assert.equal(sumExpensesOnce(fixtures), 1075);
assert.equal(sumExpensesOnce(filterExpensesByClassification(fixtures, 'ALL', 'SHARED')), 600,
  'A shared central purchase is represented and summed once');
assert.deepEqual(summarizePendingClassification(fixtures), { count: 2, amount_mxn: 150 });

assert.equal(resolveCommissionDestination(['AURRERA', 'AURRERA']), 'AURRERA');
assert.equal(resolveCommissionDestination(['CHIPITLAN']), 'CHIPITLAN');
assert.equal(resolveCommissionDestination(['AURRERA', 'CHIPITLAN']), 'MIXED');
assert.equal(resolveCommissionDestination(['AURRERA', null]), 'UNKNOWN');
assert.equal(resolveCommissionDestination([]), 'UNKNOWN');

const historicalObligations = Array.from({ length: 4 }, (_, index) => ({
  id: `legacy-${index + 1}`,
  effective_from: '1900-01-01',
  effective_to: '2026-10-31',
}));
const novemberObligations = Array.from({ length: 10 }, (_, index) => ({
  id: `november-${index + 1}`,
  effective_from: '2026-11-01',
  effective_to: null,
}));
const effectiveOn = (rows, date) => rows.filter(row => (
  row.effective_from <= date && (!row.effective_to || row.effective_to >= date)
));
const obligationFixtures = [...historicalObligations, ...novemberObligations];
assert.equal(effectiveOn(obligationFixtures, '2026-10-31').length, 4);
assert.equal(effectiveOn(obligationFixtures, '2026-11-01').length, 10);

const octoberAngelicaPayroll = {
  amount_mxn: 1250,
  concept_code: 'PAYROLL',
  category: getLegacyExpenseCategory('PAYROLL'),
  destination_scope: 'SHARED',
  classification_status: 'CLASSIFIED',
  fixed_cost_id: null,
  expense_date: '2026-10-31',
};
assert.equal(isExpenseClassificationComplete(octoberAngelicaPayroll), true);
assert.equal(octoberAngelicaPayroll.fixed_cost_id, null,
  'October payroll must not link to a November obligation');
assert.equal(octoberAngelicaPayroll.category, 'PAYROLL',
  'new capture mirrors the stable concept into the required legacy category column');
assert.equal(octoberAngelicaPayroll.amount_mxn, 1250, 'classification preserves the real amount');
assert.equal(octoberAngelicaPayroll.expense_date, '2026-10-31', 'classification preserves the real date');

assert.match(migration, /^BEGIN;/m);
assert.match(migration, /COMMIT;\s*$/);
assert.match(migration, /ADD COLUMN concept_code TEXT/);
assert.match(migration, /ADD COLUMN destination_scope TEXT/);
assert.match(migration, /ADD COLUMN classification_status TEXT/);
assert.match(migration, /expenses_classification_consistency_check CHECK \(\([\s\S]*\) IS TRUE\)/);
assert.match(migration, /NEW\.commission_settlement_id IS NOT NULL[\s\S]*NEW\.concept_code := 'COMMISSIONS'/);
assert.match(migration, /v_unresolved_event_count > 0 THEN 'UNKNOWN'/);
assert.match(migration, /v_resolved_destination_count = 1 THEN v_single_destination[\s\S]*ELSE 'MIXED'/);
assert.doesNotMatch(migration, /NEW\.destination_scope := 'SHARED'/);
assert.match(migration, /NEW\.destination_scope := v_fixed_scope/);
assert.match(migration, /UPDATE OF[\s\S]*type, expense_date, fixed_cost_id/);
assert.match(migration, /Classify this pending expense before changing type, date or fixed-cost obligation/);
assert.match(migration, /NULL across all three columns is the backwards-compatible\/pending state/);
assert.doesNotMatch(migration, /\bUPDATE\s+public\.expenses\b/i);
assert.doesNotMatch(migration, /\bINSERT\s+INTO\s+public\.expenses\b/i);
assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.finance_month_summary/);
assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.create_expense_for_paid_commission_settlement/);
assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.protect_commission_settlement_expense/);

assert.match(enforcement, /^BEGIN;/m);
assert.match(enforcement, /COMMIT;\s*$/);
assert.match(enforcement, /TG_OP = 'INSERT'/);
assert.match(enforcement, /New manual expenses require concept and destination/);
assert.match(enforcement, /NEW\.type IS DISTINCT FROM OLD\.type/);
assert.doesNotMatch(enforcement, /\bUPDATE\s+public\.expenses\b/i);
assert.doesNotMatch(enforcement, /\bINSERT\s+INTO\s+public\.expenses\b/i);

assert.match(conceptExpansion, /^BEGIN;/m);
assert.match(conceptExpansion, /COMMIT;\s*$/);
assert.match(conceptExpansion, /'PAYROLL', 'RENT', 'COMMISSIONS'/);
assert.match(conceptExpansion, /DATE '2026-10-31'[\s\S]*\) <> 4/);
assert.match(conceptExpansion, /DATE '2026-11-01'[\s\S]*\) <> 10/);
assert.match(conceptExpansion, /Phase 2 manual enforcement is already enabled/);
assert.doesNotMatch(conceptExpansion, /\bUPDATE\s+public\.expenses\b/i);
assert.doesNotMatch(conceptExpansion, /\bINSERT\s+INTO\s+public\.expenses\b/i);

assert.match(form, /EXPENSE_CONCEPT_OPTIONS/);
assert.match(form, /getInitialExpenseDate\(expense\?\.expense_date\)/);
assert.doesNotMatch(form, /new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/);
assert.match(form, /EXPENSE_DESTINATION_OPTIONS/);
assert.match(form, /Se toma de la obligación seleccionada/);
assert.match(form, /Hasta el 31\/10\/2026 sólo aparecen las obligaciones históricas vigentes/);
assert.match(form, /classification_status: classificationComplete \? 'CLASSIFIED' : null/);
assert.match(form, /!expense \? \{ category: legacyCategory \} : \{\}/);
assert.match(form, /role="alert"/);
assert.match(form, /getExpenseSaveErrorMessage/);
assert.doesNotMatch(form, /value=\{formData\.category\}/);
assert.match(manager, /Pendientes de clasificar/);
assert.match(manager, /getExpenseConceptLabel/);
assert.match(manager, /getExpenseDestinationLabel/);
assert.match(manager, /EXPENSE_REPORT_DESTINATION_OPTIONS/);
assert.match(exporter, /'Concepto', 'Destino'/);
assert.match(exporter, /'Por Concepto'/);
assert.match(exporter, /'Por Destino'/);

const withoutComments = sql => sql
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n')
  .replace(/'(?:''|[^'])*'/g, "''");
const forbiddenWrites = /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE)\b/i;
assert.doesNotMatch(withoutComments(diagnostic), forbiddenWrites);
assert.match(diagnostic, /COUNT\(DISTINCT source_type\)/);
assert.match(diagnostic, /october_core_data_md5/);
assert.doesNotMatch(withoutComments(verification), forbiddenWrites);
assert.doesNotMatch(verification, /all_checks_passed/);
assert.match(verification, /commission_contract AS/);
assert.match(verification, /pending_classification_count/);
assert.match(verification, /pending_classification_amount_mxn/);
assert.match(verification, /classification_complete/);
assert.match(verification, /compatibility_mode_allows_pending/);
assert.doesNotMatch(withoutComments(enforcementVerification), forbiddenWrites);
assert.doesNotMatch(enforcementVerification, /all_checks_passed/);
assert.match(enforcementVerification, /manual_enforcement_enabled/);
assert.match(enforcementVerification, /pending_classification_amount_mxn/);
assert.doesNotMatch(withoutComments(conceptExpansionVerification), forbiddenWrites);
assert.match(conceptExpansionVerification, /october_effective_obligation_count/);
assert.match(conceptExpansionVerification, /november_effective_obligation_count/);
assert.match(conceptExpansionVerification, /manual_enforcement_enabled/);
assert.match(conceptExpansionVerification, /pending_classification_amount_mxn/);

assert.match(publicationNotes, /Aplicar la migración transaccional/);
assert.match(publicationNotes, /Publicar la interfaz antes de la fase 1 no es compatible/);
assert.match(publicationNotes, /No se incorpora una clasificación automática/);

console.log('OK: clasificación prospectiva, legado pendiente, destino fijo heredado, compra compartida única y contratos preservados');
