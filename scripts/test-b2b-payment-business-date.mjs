import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  assertBusinessDate,
  getMexicoCityDate,
  resolveLegacyB2BPaymentBusinessDate,
} from '../lib/b2bPaymentBusinessDate.js';

const resolve = (paymentDate, createdAt, businessDate = null) =>
  resolveLegacyB2BPaymentBusinessDate({ paymentDate, createdAt, businessDate });

const cases = [
  ['historical real instant', '2026-09-27T04:47:35.936237+00:00', '2026-09-27T04:47:35.936237+00:00', null, '2026-09-26'],
  ['Guacamayas UTC-today defect', '2026-10-15T00:00:00+00:00', '2026-10-15T05:17:23.897986+00:00', null, '2026-10-14'],
  ['Marea same local and UTC day', '2026-10-15T00:00:00+00:00', '2026-10-15T23:08:35.617451+00:00', null, '2026-10-15'],
  ['captured before 18:00 Mexico', '2026-10-15T17:59:00Z', '2026-10-15T17:59:00Z', null, '2026-10-15'],
  ['captured after 18:00 Mexico', '2026-10-16T01:00:00Z', '2026-10-16T01:00:00Z', null, '2026-10-15'],
  ['effective yesterday selected today', '2026-10-14T00:00:00Z', '2026-10-15T20:00:00Z', null, '2026-10-14'],
  ['month end real instant', '2026-11-01T05:59:59Z', '2026-11-01T05:59:59Z', null, '2026-10-31'],
  ['next month real instant', '2026-11-01T06:00:00Z', '2026-11-01T06:00:00Z', null, '2026-11-01'],
  ['explicit canonical date wins', '2026-10-16T01:00:00Z', '2026-10-16T01:00:00Z', '2026-10-13', '2026-10-13'],
];

for (const [name, paymentDate, createdAt, businessDate, expected] of cases) {
  assert.equal(resolve(paymentDate, createdAt, businessDate), expected, name);
}

assert.equal(getMexicoCityDate('2026-10-15T05:59:59Z'), '2026-10-14');
assert.equal(getMexicoCityDate('2026-10-15T06:00:00Z'), '2026-10-15');
assert.equal(assertBusinessDate('2026-10-15'), '2026-10-15');
assert.throws(() => assertBusinessDate('2026-02-30'), /inválida/);

const rpcMigration = readFileSync(
  new URL('../supabase/migrations/20261016_sync_deployed_b2b_monthly_rpc_definitions.sql', import.meta.url),
  'utf8',
);
const deployedRpcFingerprints = {
  get_b2b_monthly_analysis: {
    length: 16709,
    sha256: 'f8291dbd2c49f9507ca2b3078a8de7223214eef790bda1f4a5d958d8fab51b28',
    resolverReferences: 6,
  },
  get_b2b_monthly_collections_report: {
    length: 14701,
    sha256: '413d71ed45924410141b0e7b5ee2c08f581791995c312da02d747ee4f7cdddb8',
    resolverReferences: 8,
  },
};

for (const [name, expected] of Object.entries(deployedRpcFingerprints)) {
  const start = rpcMigration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `${name} debe existir en la migración sincronizada`);
  const terminator = '$function$';
  const end = rpcMigration.indexOf(`${terminator};`, start);
  assert.notEqual(end, -1, `${name} debe conservar el delimitador exportado`);
  const definition = rpcMigration.slice(start, end + terminator.length);
  assert.equal(definition.length, expected.length, `${name}: longitud de producción`);
  assert.equal(
    createHash('sha256').update(definition).digest('hex'),
    expected.sha256,
    `${name}: SHA-256 de producción`,
  );
  assert.equal(
    definition.match(/resolve_b2b_payment_business_date/g)?.length ?? 0,
    expected.resolverReferences,
    `${name}: referencias al resolvedor`,
  );
}

const baseMigration = readFileSync(
  new URL('../supabase/migrations/20261015_fix_b2b_payment_business_date.sql', import.meta.url),
  'utf8',
).toLowerCase();
assert.match(baseMigration, /with \(security_invoker = true\)/, 'la vista canónica conserva RLS del invocador');
assert.match(baseMigration, /old\.business_date is not distinct from new\.business_date/, 'el trigger sincroniza correcciones aprobadas');
assert.match(baseMigration, /old\.approved_payment_id is not distinct from new\.approved_payment_id/, 'el trigger conserva idempotencia por pago aprobado');
assert.doesNotMatch(baseMigration, /pg_get_functiondef/, 'la migración base no reconstruye las RPC mensuales');

console.log(`OK: ${cases.length + 4} pruebas de fecha y 2 huellas RPC B2B`);
