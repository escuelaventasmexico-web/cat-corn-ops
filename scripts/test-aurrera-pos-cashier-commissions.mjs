import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ANGELICA_USER_ID,
  AURRERA_BRANCH_CODE,
  AURRERA_BRANCH_ID,
  AURRERA_CASHIER_OPTIONS,
  GERARDO_USER_ID,
  buildCheckoutFingerprint,
  getAurreraCashierOption,
} from '../lib/posCashierAttribution.js';

const commissionRates = Object.freeze({
  angelica: Object.freeze({ michi: 2, gato_mayor: 5, jefe_felino: 10 }),
  gerardo: Object.freeze({ michi: 5, gato_mayor: 10, jefe_felino: 15 }),
  administrator: Object.freeze({ michi: 0, gato_mayor: 0, jefe_felino: 0 }),
});

const commissionFor = (cashier, items) => items.reduce(
  (total, item) => total + (commissionRates[cashier][item.presentation] || 0) * item.quantity,
  0,
);

assert.equal(AURRERA_BRANCH_ID, 'e7d54d51-57b3-4aae-9cf5-09aa7ce00202');
assert.equal(AURRERA_BRANCH_CODE, 'aurrera_la_luna_02');
assert.equal(ANGELICA_USER_ID, 'b5fe98b7-d5ff-457e-8176-ed66a13af84b');
assert.equal(GERARDO_USER_ID, '682568c5-4339-4af5-85ef-71c8b2febd59');
assert.deepEqual(AURRERA_CASHIER_OPTIONS.map(option => option.key), [
  'angelica', 'gerardo', 'administrator',
]);
assert.equal(getAurreraCashierOption('angelica')?.recipientId, ANGELICA_USER_ID);
assert.equal(getAurreraCashierOption('gerardo')?.recipientId, GERARDO_USER_ID);
assert.equal(getAurreraCashierOption('administrator')?.recipientId, null);
assert.equal(getAurreraCashierOption(null), null, 'el selector no preselecciona a nadie');

const scenarios = [
  ['Angélica: 1 Michi', 'angelica', [{ presentation: 'michi', quantity: 1 }], 2],
  ['Gerardo: 1 Michi', 'gerardo', [{ presentation: 'michi', quantity: 1 }], 5],
  ['Angélica: 1 Gato Mayor', 'angelica', [{ presentation: 'gato_mayor', quantity: 1 }], 5],
  ['Gerardo: 1 Gato Mayor', 'gerardo', [{ presentation: 'gato_mayor', quantity: 1 }], 10],
  ['Angélica: 1 Jefe Felino', 'angelica', [{ presentation: 'jefe_felino', quantity: 1 }], 10],
  ['Gerardo: 1 Jefe Felino', 'gerardo', [{ presentation: 'jefe_felino', quantity: 1 }], 15],
  ['Angélica: una de cada presentación', 'angelica', [
    { presentation: 'michi', quantity: 1 },
    { presentation: 'gato_mayor', quantity: 1 },
    { presentation: 'jefe_felino', quantity: 1 },
  ], 17],
  ['Gerardo: una de cada presentación', 'gerardo', [
    { presentation: 'michi', quantity: 1 },
    { presentation: 'gato_mayor', quantity: 1 },
    { presentation: 'jefe_felino', quantity: 1 },
  ], 30],
  ['Administrador: cualquier venta', 'administrator', [
    { presentation: 'jefe_felino', quantity: 99 },
  ], 0],
  ['Cantidades múltiples', 'angelica', [
    { presentation: 'michi', quantity: 3 },
    { presentation: 'gato_mayor', quantity: 2 },
  ], 16],
  ['Producto no elegible', 'gerardo', [{ presentation: 'bebida', quantity: 4 }], 0],
];

for (const [name, cashier, items, expected] of scenarios) {
  assert.equal(commissionFor(cashier, items), expected, name);
}

const checkout = {
  branchId: AURRERA_BRANCH_ID,
  cart: [{ id: 'product-1', quantity: 1, price: 50 }],
  cashInput: 50,
  cardInput: 0,
  transferInput: 0,
  customerId: null,
  promotionCode: null,
};
const fingerprint = buildCheckoutFingerprint(checkout);
assert.equal(buildCheckoutFingerprint({ ...checkout }), fingerprint, 'un reintento idéntico conserva su huella');
assert.notEqual(
  buildCheckoutFingerprint({ ...checkout, cart: [{ ...checkout.cart[0], quantity: 2 }] }),
  fingerprint,
  'cambiar el carrito invalida la atribución pendiente',
);
assert.notEqual(
  buildCheckoutFingerprint({ ...checkout, branchId: 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101' }),
  fingerprint,
  'cambiar de sucursal invalida la atribución pendiente',
);
assert.notEqual(
  buildCheckoutFingerprint({ ...checkout, cashInput: 0, cardInput: 50 }),
  fingerprint,
  'cambiar el pago invalida la atribución pendiente',
);

const migration = readFileSync(
  new URL('../supabase/migrations/20261017_aurrera_pos_cashier_commissions.sql', import.meta.url),
  'utf8',
);
const verifier = readFileSync(
  new URL('../supabase/verification/20261017_verify_aurrera_pos_cashier_commissions.sql', import.meta.url),
  'utf8',
);
const pos = readFileSync(new URL('../pages/POS.tsx', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../components/pos/AurreraCashierModal.tsx', import.meta.url), 'utf8');

assert.equal(
  createHash('sha256').update(migration.trimEnd()).digest('hex'),
  'd5e1d29eda023d91c275674d243b8858fd8eee03233929b0a25130acc821a20e',
  'la migración local debe coincidir con la V3 exacta revisada',
);

assert.match(modal, /¿Quién realizó esta venta\?/);
assert.match(modal, /disabled=\{!selected\}/, 'no se puede continuar sin selección');
assert.match(pos, /selectedBranch\?\.id === AURRERA_BRANCH_ID && !deliveryPlatform/);
assert.match(pos, /create_aurrera_attributed_pos_sale/);
assert.match(pos, /checkoutInFlightRef\.current/);
assert.match(pos, /pendingAurreraAttribution\.fingerprint !== checkoutFingerprint/);

assert.match(migration, /SECURITY INVOKER/i, 'el RPC debe respetar RLS del usuario autenticado');
assert.match(migration, /16e8a0a2171410877c5ed096c2324942/, 'V3 protege el motor POS auditado');
assert.match(migration, /Deployment bridge:[\s\S]*?previous frontend has no attribution fields/i);
assert.match(migration, /ON CONFLICT \(checkout_token\) DO NOTHING/i, 'el cobro debe ser idempotente');
assert.match(migration, /PERFORM public\.sync_pos_commission_for_sale_item/i, 'reutiliza el motor POS existente');
assert.match(migration, /CASE WHEN v_transfer > 0 THEN 1 ELSE 0 END/i, 'V3 valida pagos mixtos de dos o más medios');
assert.match(migration, /p_cash_session_id IS NOT NULL AND v_sale\.cash_session_id IS DISTINCT FROM p_cash_session_id/i);
assert.match(migration, /stored sale total differs from the submitted total/i);
assert.doesNotMatch(migration, /server-calculated sale total/i, 'V3 no exagera la validación de precios del cliente');
assert.match(migration, /v_sale\.pos_commission_attribution = 'administrator'[\s\S]*?RETURN NULL/i);
assert.match(migration, /v_recipient_id := v_sale\.pos_commission_recipient_id/i);
assert.match(migration, /v_recipient_id := v_sale\.cashier_id/i, 'Chipitlán conserva el flujo legado');
assert.match(migration, /product_combos/i, 'se conserva la resolución existente de combos');
assert.match(migration, /ON CONFLICT DO NOTHING[\s\S]*?RETURNING id INTO v_event_id/i);
assert.doesNotMatch(migration, /UPDATE\s+public\.sales/i, 'no reescribe ventas históricas');
assert.doesNotMatch(migration, /UPDATE\s+public\.commission_events/i, 'no reescribe comisiones históricas');
assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.commission_rules/i, 'reutiliza las tarifas desplegadas');

assert.match(verifier, /VERIFICADOR V3 SOLO LECTURA/);
assert.match(verifier, /BEGIN READ ONLY;/);
const v3VerifierChecks = [
  'nullable_typed_columns',
  'unique_checkout_token',
  'attribution_trigger_installed',
  'immutable_attribution_and_rollout_bridge',
  'existing_pos_commission_engine_reused',
  'checkout_atomic_idempotent_and_mixed_payments',
  'expected_pos_rates_exact',
  'no_duplicate_pos_event_by_source_item',
  'administrator_has_zero_commissions',
  'employee_events_match_recipient',
  'admin_requires_authorized_session',
  'cash_session_retry_handles_implicit_session',
  'checkout_security_invoker',
];
for (const check of v3VerifierChecks) {
  assert.match(verifier, new RegExp(`AS ${check}`), `falta el control V3 ${check}`);
}
assert.equal(v3VerifierChecks.length, 13, 'el contrato remoto V3 contiene 13 controles');
assert.match(verifier, /ROLLBACK;\s*$/);

console.log(`OK: ${scenarios.length} escenarios de comisión y contratos de selector, idempotencia, RLS y devoluciones`);
