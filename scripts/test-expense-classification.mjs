import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  EXPENSE_CONCEPT_OPTIONS,
  EXPENSE_DESTINATION_OPTIONS,
  EXPENSE_REPORT_DESTINATION_OPTIONS,
  PAYROLL_REPORT_GROUP,
  filterExpensesByClassification,
  getExpenseBudgetDestination,
  getExpenseCommissionOrigin,
  getExpenseConceptLabel,
  getExpenseConceptGroupLabel,
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
const enforcement = read('../supabase/applied-manually/20261031210000_enforce_manual_expense_classification.sql');
const enforcementVerification = read('../supabase/verification/20261031210000_verify_manual_expense_classification_enforcement.sql');
const conceptExpansion = read('../supabase/migrations/20261031203000_add_payroll_rent_expense_concepts.sql');
const conceptExpansionVerification = read('../supabase/verification/20261031203000_verify_payroll_rent_expense_concepts.sql');
const commissionExpenseMigration = read('../migration_commission_settlement_expenses.sql');
const form = read('../components/finance/ExpenseFormModal.tsx');
const manager = read('../components/finance/ExpensesManager.tsx');
const exporter = read('../lib/exportExpenses.ts');
const publicationNotes = read('../docs/finance-expense-classification.md');
const withoutComments = sql => sql
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n')
  .replace(/'(?:''|[^'])*'/g, "''");
const forbiddenWrites = /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE)\b/i;

const sha256 = value => createHash('sha256').update(value).digest('hex');
assert.equal(
  sha256(enforcement),
  '4435e50d61a699eae53b4442f2b04d2872d788edf01115742a671ef36feadf81',
  'the repository must preserve the exact phase 2 SQL applied manually',
);
assert.equal(
  sha256(enforcementVerification),
  'ca97c793c0fc871f4f71cc5b77b84cc92c917b2184f4c89463ceb0e7e4487caf',
  'the repository must preserve the exact phase 2 verification SQL',
);
assert.equal(
  existsSync(new URL('../supabase/migrations/20261031210000_enforce_manual_expense_classification.sql', import.meta.url)),
  false,
  'the manually applied phase 2 must stay outside the automatic migration directory',
);

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
  ['CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING', 'STATIONERY', 'CLEANING', 'FUEL', 'SERVICES', 'PAYROLL', 'RENT', 'COMMISSIONS', 'OTHER'],
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
assert.equal(getExpenseConceptLabel('STATIONERY'), 'Papelería');
assert.equal(getExpenseConceptLabel('CLEANING'), 'Limpieza');
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
assert.deepEqual(filterExpensesByClassification(fixtures, 'ALL', 'SHARED').map(row => row.id), ['shared', 'commission-unknown', 'commission-mixed']);
assert.deepEqual(filterExpensesByClassification(fixtures, 'ALL', 'PENDING').map(row => row.id), ['legacy', 'commission-unknown']);
assert.equal(sumExpensesOnce(fixtures), 1075);
assert.equal(sumExpensesOnce(filterExpensesByClassification(fixtures, 'ALL', 'SHARED')), 725,
  'shared purchases and commissions are each represented and summed once');
assert.deepEqual(summarizePendingClassification(fixtures), { count: 2, amount_mxn: 150 });

assert.equal(resolveCommissionDestination(['AURRERA', 'AURRERA']), 'AURRERA');
assert.equal(resolveCommissionDestination(['CHIPITLAN']), 'CHIPITLAN');
assert.equal(resolveCommissionDestination(['AURRERA', 'CHIPITLAN']), 'MIXED');
assert.equal(resolveCommissionDestination(['AURRERA', null]), 'UNKNOWN');
assert.equal(resolveCommissionDestination([]), 'UNKNOWN');

const isInvalidNewAutomaticCommission = expense => (
  expense.commission_settlement_id != null
  && expense.classification_status != null
  && !(
    expense.classification_status === 'SYSTEM'
    && expense.concept_code === 'COMMISSIONS'
    && ['AURRERA', 'CHIPITLAN', 'MIXED', 'UNKNOWN'].includes(expense.destination_scope)
  )
);
const historicalAutomaticCommission = {
  amount_mxn: 75,
  commission_settlement_id: 'historical-settlement',
  concept_code: null,
  destination_scope: null,
  classification_status: null,
};
const malformedNewAutomaticCommission = {
  amount_mxn: 75,
  commission_settlement_id: 'new-settlement',
  concept_code: 'OTHER',
  destination_scope: 'SHARED',
  classification_status: 'CLASSIFIED',
};
assert.equal(isInvalidNewAutomaticCommission(historicalAutomaticCommission), false,
  'historical automatic commission remains pending and does not fail structural checks');
assert.equal(isExpenseClassificationComplete(historicalAutomaticCommission), false,
  'historical automatic commission is still reported as pending');
assert.equal(isInvalidNewAutomaticCommission(malformedNewAutomaticCommission), true,
  'a newly classified automatic commission with the wrong system tuple is invalid');

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

const automaticCommission = {
  amount_mxn: 100,
  concept_code: 'COMMISSIONS',
  destination_scope: 'AURRERA',
  commission_origin_scope: null,
  classification_status: 'SYSTEM',
};
assert.equal(getExpenseConceptGroupLabel('PAYROLL'), 'Nómina');
assert.equal(getExpenseConceptGroupLabel('COMMISSIONS'), 'Nómina');
assert.equal(PAYROLL_REPORT_GROUP, 'PAYROLL_GROUP');
const payrollGroupFixtures = [
  { id: 'payroll', amount_mxn: 1250, concept_code: 'PAYROLL', destination_scope: 'SHARED', classification_status: 'CLASSIFIED' },
  { ...automaticCommission, id: 'commission' },
  { id: 'service', amount_mxn: 500, concept_code: 'SERVICES', destination_scope: 'SHARED', classification_status: 'CLASSIFIED' },
];
assert.deepEqual(
  filterExpensesByClassification(payrollGroupFixtures, PAYROLL_REPORT_GROUP, 'ALL').map(row => row.id),
  ['payroll', 'commission'],
  'the payroll report group includes fixed payroll and each commission row exactly once',
);
assert.equal(
  sumExpensesOnce(filterExpensesByClassification(payrollGroupFixtures, PAYROLL_REPORT_GROUP, 'ALL')),
  1350,
  'the grouped payroll filter does not duplicate commissions',
);
assert.equal(getExpenseBudgetDestination(automaticCommission), 'SHARED',
  'commission reporting uses the shared budget destination');
assert.equal(getExpenseCommissionOrigin(automaticCommission), 'AURRERA',
  'legacy commission destination remains available as operational origin');
assert.equal(filterExpensesByClassification([automaticCommission], 'ALL', 'SHARED').length, 1,
  'shared report filter includes automatic commissions once');

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
assert.match(enforcement, /create_expense_for_paid_commission_settlement/);
assert.match(enforcement, /commission_settlement_paid_expense_trigger/);
assert.match(enforcement, /expenses_commission_settlement_id_key/);
assert.match(enforcement, /protect_commission_settlement_expense_trigger/);
assert.match(enforcement, /PAYROLL/);
assert.match(enforcement, /RENT/);
assert.match(enforcement, /REVOKE INSERT, UPDATE ON TABLE public\.expenses FROM authenticated/);
assert.match(enforcement, /REVOKE INSERT \(commission_settlement_id\), UPDATE \(commission_settlement_id\)/);
assert.match(enforcement, /GRANT INSERT \([\s\S]*concept_code[\s\S]*classification_status[\s\S]*TO authenticated/);
assert.match(enforcement, /HAS_COLUMN_PRIVILEGE\([\s\S]*commission_settlement_id[\s\S]*'INSERT'/);
assert.match(enforcement, /v_commission_writer_security_definer/);
assert.match(enforcement, /rolbypassrls/);
const authenticatedColumnGrants = [...enforcement.matchAll(
  /GRANT (?:INSERT|UPDATE) \(([\s\S]*?)\) ON TABLE public\.expenses TO authenticated;/g,
)];
assert.equal(authenticatedColumnGrants.length, 2);
for (const [, grantedColumns] of authenticatedColumnGrants) {
  assert.doesNotMatch(grantedColumns, /commission_settlement_id/,
    'the authenticated client must never receive the automatic settlement link');
  assert.match(grantedColumns, /concept_code/);
  assert.match(grantedColumns, /destination_scope/);
  assert.match(grantedColumns, /classification_status/);
}
for (const automaticWriterColumn of [
  'expense_date', 'amount_mxn', 'type', 'category', 'vendor', 'has_invoice',
  'payment_method', 'notes', 'fixed_cost_id', 'created_by', 'commission_settlement_id',
]) {
  assert.match(enforcement, new RegExp(
    `HAS_COLUMN_PRIVILEGE\\(v_commission_writer_owner, 'public\\.expenses', '${automaticWriterColumn}', 'INSERT'\\)`,
  ));
}
assert.doesNotMatch(enforcement, /^\s*UPDATE\s+public\.expenses\b/im);
assert.doesNotMatch(enforcement, /^\s*INSERT\s+INTO\s+public\.expenses\b/im);

assert.match(commissionExpenseMigration, /CREATE OR REPLACE FUNCTION public\.create_expense_for_paid_commission_settlement/);
assert.match(commissionExpenseMigration, /INSERT INTO public\.expenses[\s\S]*category[\s\S]*commission_settlement_id/);
assert.match(commissionExpenseMigration, /'Comisiones'/);
assert.match(commissionExpenseMigration, /'OTHER'::public\.expense_type/,
  'the visual payroll-group change must preserve the deployed internal commission type');
assert.doesNotMatch(commissionExpenseMigration, /'VARIABLE'::public\.expense_type/,
  'this publication must not move commissions between P&L buckets');
assert.match(commissionExpenseMigration, /ON CONFLICT ON CONSTRAINT expenses_commission_settlement_id_key/);
assert.match(commissionExpenseMigration, /CREATE TRIGGER commission_settlement_paid_expense_trigger/);
assert.match(commissionExpenseMigration, /CREATE TRIGGER protect_commission_settlement_expense_trigger/);

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
assert.match(exporter, /'Grupo', 'Concepto', 'Destino presupuestal', 'Origen de comisión'/);
assert.match(exporter, /'Por Concepto'/);
assert.match(exporter, /'Por Grupo'/);
assert.match(exporter, /'Por Destino'/);
assert.match(exporter, /'👥 NÓMINA'/);
assert.match(exporter, /'Nómina fija'/);
assert.match(exporter, /'Comisiones'/);
assert.doesNotMatch(exporter, /👥 PERSONAL/);

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
assert.match(enforcementVerification, /legacy_pending_compatibility_valid/);
assert.match(enforcementVerification, /fixed_expense_obligation_contract_valid/);
assert.match(enforcementVerification, /pending_classification_amount_mxn/);
assert.match(enforcementVerification, /automatic_commission_writer_valid/);
assert.match(enforcementVerification, /automatic_commission_generation_trigger_valid/);
assert.match(enforcementVerification, /automatic_commission_idempotency_valid/);
assert.match(enforcementVerification, /automatic_commission_protection_valid/);
assert.match(enforcementVerification, /invalid_classified_manual_count/);
assert.match(enforcementVerification, /invalid_new_automatic_commission_count/);
assert.match(enforcementVerification, /legacy_automatic_commission_pending_count/);
assert.match(enforcementVerification, /commission_settlement_id_write_protected/);
assert.match(enforcementVerification, /authenticated_manual_columns_valid/);
assert.match(enforcementVerification, /structural_checks_passed/);
assert.doesNotMatch(withoutComments(conceptExpansionVerification), forbiddenWrites);
assert.match(conceptExpansionVerification, /october_effective_obligation_count/);
assert.match(conceptExpansionVerification, /november_effective_obligation_count/);
assert.match(conceptExpansionVerification, /manual_enforcement_enabled/);
assert.match(conceptExpansionVerification, /pending_classification_amount_mxn/);

assert.match(publicationNotes, /Aplicar la migración transaccional/);
assert.match(publicationNotes, /Publicar la interfaz antes de la fase 1 no es compatible/);
assert.match(publicationNotes, /No se incorpora una clasificación automática/);

console.log('OK: clasificación prospectiva, legado pendiente, destino fijo heredado, compra compartida única y contratos preservados');
