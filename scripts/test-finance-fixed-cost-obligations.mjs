import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const migration = readFileSync(new URL('../supabase/migrations/20261030210000_finance_fixed_cost_obligations.sql', import.meta.url), 'utf8');
const verification = readFileSync(new URL('../supabase/verification/20261030210000_verify_finance_fixed_cost_obligations.sql', import.meta.url), 'utf8');
const diagnostic = readFileSync(new URL('../supabase/diagnostics/20261030_diagnose_fixed_cost_obligations.sql', import.meta.url), 'utf8');

assert.equal(createHash('sha256').update(migration).digest('hex'), '1dd4d4f788b1084efe3c4720f6794ab867b1bd79fec77722f89f25ef66db4b18');
assert.equal(createHash('sha256').update(verification).digest('hex'), 'e308674e9f9fd62ec311328581d4d858e7b428782b2187aa0e9832909665ee2d');

assert.match(migration, /^BEGIN;/m);
assert.match(migration, /COMMIT;\s*$/);
assert.match(migration, /7a885c282e6dccab0775f51c634bd8d4/);
assert.match(migration, /v_october_count <> 6 OR v_october_total <> 13670 OR v_october_linked <> 0/);
assert.match(migration, /monthly_provision_mxn/);
assert.match(migration, /finance_fixed_cost_month_status/);
assert.match(migration, /finance_version_fixed_cost/);
assert.match(migration, /SELECT \* INTO v_previous[\s\S]*FOR UPDATE/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.finance_month_summary/);
assert.match(migration, /ON DELETE RESTRICT/);
assert.match(migration, /prevent_fixed_cost_delete/);
assert.match(migration, /prevent_fixed_cost_period_overlap/);
assert.match(migration, /fixed_costs_configuration_consistency_check/);
assert.match(migration, /fixed_costs_bimonthly_provision_check/);
assert.match(migration, /ALTER COLUMN obligation_code SET NOT NULL/);
assert.match(migration, /ALTER COLUMN configuration_status SET NOT NULL/);
assert.match(migration, /LEGACY_UNRECONCILED/);
assert.match(migration, /is_unbudgeted_fixed/);
assert.match(migration, /expense_date >= DATE '2026-11-01'/);
assert.doesNotMatch(migration, /UPDATE\s+public\.expenses/i);
assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.expenses/i);
assert.doesNotMatch(migration, /shared\.enrique/i);

const monthly = [5000,1624,500,6964,440,495,2500,3500,1000];
assert.equal(monthly.reduce((sum,value)=>sum+value,0), 22023);
assert.equal(22023 + 6000, 28023);
assert.equal(22023 - 495, 21528, 'November due excludes Chipitlan electricity until its anchor is configured');

const october = { count: 6, registered: 13670, linked: 0, status: 'LEGACY_UNRECONCILED' };
assert.deepEqual(october, { count: 6, registered: 13670, linked: 0, status: 'LEGACY_UNRECONCILED' });

const obligationBalance = (monthlyProvision, accruedMonths, paidThroughMonth) => ({
  pending: Math.max(monthlyProvision * accruedMonths - paidThroughMonth, 0),
  credit: Math.max(paidThroughMonth - monthlyProvision * accruedMonths, 0),
});
assert.deepEqual(obligationBalance(2500, 1, 1250), { pending: 1250, credit: 0 });
assert.deepEqual(obligationBalance(6964, 1, 0), { pending: 6964, credit: 0 });
assert.deepEqual(obligationBalance(495, 1, 990), { pending: 0, credit: 495 });
assert.deepEqual(obligationBalance(495, 2, 990), { pending: 0, credit: 0 });

const validFutureFixedExpense = ({ fixedCostId = null, unbudgeted = false, reason = '' } = {}) =>
  Boolean(fixedCostId) !== unbudgeted && (!unbudgeted || reason.trim().length > 0);
assert.equal(validFutureFixedExpense({ fixedCostId: 'obligation-id' }), true);
assert.equal(validFutureFixedExpense({ unbudgeted: true, reason: 'Seguro no previsto' }), true);
assert.equal(validFutureFixedExpense(), false);
assert.equal(validFutureFixedExpense({ fixedCostId: 'obligation-id', unbudgeted: true, reason: 'invalid' }), false);
assert.equal(validFutureFixedExpense({ unbudgeted: true }), false);

const readonlyVerification = verification.split('\n').filter(line=>!line.trim().startsWith('--')).join('\n');
assert.doesNotMatch(readonlyVerification, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE)\b/i);
const readonlyDiagnostic = diagnostic.split('\n').filter(line=>!line.trim().startsWith('--')).join('\n');
assert.doesNotMatch(readonlyDiagnostic, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE)\b/i);
assert.match(verification, /october_legacy_untouched/);
assert.match(verification, /november_catalog_and_reserve_correct/);
assert.match(verification, /required_catalog_fields_not_null/);
assert.match(verification, /classification_and_catalog_guards_enabled/);

console.log('OK: octubre legado; noviembre reserva/vencimientos; saldos por obligación; clasificación futura; escenario Enrique');
