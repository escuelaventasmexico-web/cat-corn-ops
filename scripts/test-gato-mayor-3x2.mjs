import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildGatoMayor3x2Group,
  evaluateGatoMayor3x2Groups,
  reconcileGatoMayor3x2Groups,
} from '../lib/gatoMayor3x2.js';

const product = (id, sku_code, price, quantity) => ({
  id, sku_code, price, quantity, name: sku_code, product_name: sku_code,
});
const group = (id, selections) => buildGatoMayor3x2Group(id, selections);

{
  const cart = [product('sabor', 'SBGM180', 65, 3)];
  const result = evaluateGatoMayor3x2Groups(cart, [group('11111111-1111-4111-8111-111111111111', { sabor: 3 })]);
  assert.equal(result.totalDiscount, 65);
  assert.equal(result.cart[0].price * 3 - result.cart[0].discount_amount, 130);
  assert.equal(result.groups[0].units.length, 3);
  assert.equal(result.groups[0].units.filter(unit => unit.free).length, 1);
}

{
  const cart = [
    product('salada', 'SLGM180', 50, 1),
    product('sabor', 'SBGM180', 65, 1),
    product('caramelo', 'CAGM180', 90, 1),
  ];
  const result = evaluateGatoMayor3x2Groups(cart, [group('22222222-2222-4222-8222-222222222222', { salada: 1, sabor: 1, caramelo: 1 })]);
  assert.equal(result.totalDiscount, 50);
  assert.equal(result.groups[0].freeProductId, 'salada');
  assert.equal(cart.reduce((sum, item) => sum + item.price, 0) - result.totalDiscount, 155);
}

{
  const cart = [product('salada', 'SLGM180', 50, 3)];
  const result = evaluateGatoMayor3x2Groups(cart, [group('88888888-8888-4888-8888-888888888888', { salada: 3 })]);
  assert.equal(result.totalDiscount, 50);
  assert.equal(150 - result.totalDiscount, 100);
}

{
  const cart = [product('sabor', 'SBGM180', 65, 6)];
  const result = evaluateGatoMayor3x2Groups(cart, [
    group('99999999-9999-4999-8999-999999999991', { sabor: 3 }),
    group('99999999-9999-4999-8999-999999999992', { sabor: 3 }),
  ]);
  assert.equal(390 - result.totalDiscount, 260);
  assert.equal(result.groups.length * 5, 10);
}

{
  const cart = [product('salada', 'SLGM180', 50, 3), product('caramelo', 'CAGM180', 90, 3)];
  const groups = [
    group('33333333-3333-4333-8333-333333333333', { salada: 3 }),
    group('44444444-4444-4444-8444-444444444444', { caramelo: 3 }),
  ];
  const result = evaluateGatoMayor3x2Groups(cart, groups);
  assert.equal(result.groups.length, 2);
  assert.equal(result.totalDiscount, 140);
}

{
  const cart = [product('salada', 'SLGM180', 50, 3), product('normal', 'OTHER', 40, 2)];
  const result = evaluateGatoMayor3x2Groups(cart, [group('55555555-5555-4555-8555-555555555555', { salada: 3 })]);
  assert.equal(result.totalDiscount, 50);
  assert.equal(result.cart.find(item => item.id === 'normal').discount_amount, undefined);
}

{
  const cart = [product('salada', 'SLGM180', 50, 2)];
  assert.equal(reconcileGatoMayor3x2Groups(cart, [group('66666666-6666-4666-8666-666666666666', { salada: 3 })]).length, 0);
}

{
  const cart = [product('salada', 'SLGM180', 50, 3), product('other', 'OTHER', 999, 1)];
  const invalid = group('77777777-7777-4777-8777-777777777777', { salada: 2, other: 1 });
  // Frontend eligibility never offers OTHER; backend also validates exact SKUs.
  assert.equal(reconcileGatoMayor3x2Groups(cart, [invalid]).length, 0);
}

const migration = fs.readFileSync(new URL('../supabase/migrations/20261020_gato_mayor_3x2_promotion.sql', import.meta.url), 'utf8');
assert.match(migration, /v_expected_total := round\(v_base_total - v_discount_total, 2\)/);
assert.match(migration, /promotion_group_id UUID/);
assert.match(migration, /promo_group\.id = event\.source_item_id/);
assert.match(migration, /v_actual_commissions <> v_expected_commissions/);
assert.match(migration, /DELETE FROM public\.commission_events/);
assert.match(migration, /'SLGM180', 'SBGM180', 'CAGM180'/);
assert.match(migration, /p_checkout_token::TEXT/);
assert.match(migration, /request_payload IS DISTINCT FROM v_payload/);
assert.match(migration, /CASE WHEN p_branch_id = v_aurrera THEN p_checkout_token ELSE NULL END/);
assert.match(migration, /snapshot_sale_item_cost|sale_items\(/);
assert.doesNotMatch(migration, /UPDATE public\.sales\s+SET[\s\S]*WHERE[\s\S]*created_at/);

assert.match(migration, /'pos_sale', v_sale_id, v_group\.id/);

console.log('OK: cálculo, grupos, mezcla, selección incompleta y contrato SQL 3 × 2.');
