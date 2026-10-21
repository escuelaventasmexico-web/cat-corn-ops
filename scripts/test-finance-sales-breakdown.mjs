import assert from 'node:assert/strict';
import {
  ANGELICA_USER_ID,
  AURRERA_BRANCH_ID,
  GERARDO_USER_ID,
} from '../lib/posCashierAttribution.js';
import {
  buildFinanceSalesBreakdown,
  buildSalesParticipation,
  calculateGeneratedGrandTotal,
  CHIPITLAN_BRANCH_ID,
} from '../lib/financeSalesBreakdown.js';

const row = (id, overrides = {}) => ({
  id,
  total: 100,
  payment_method: 'CASH',
  promotion_code: null,
  sale_origin: 'pos',
  created_at: '2026-10-19T18:00:00.000Z',
  branch_id: CHIPITLAN_BRANCH_ID,
  pos_commission_attribution: null,
  pos_commission_recipient_id: null,
  ...overrides,
});

const rows = [
  row('chip-angelica', { total: 120, cashier_id: ANGELICA_USER_ID }),
  row('chip-gerardo', { total: 70, cashier_id: GERARDO_USER_ID }),
  row('chip-admin', { total: 30, cashier_id: 'admin-user-id' }),
  row('chip-unattributed', { total: 20, cashier_id: 'unknown-user-id' }),
  row('angelica', { total: 200, branch_id: AURRERA_BRANCH_ID, pos_commission_attribution: 'employee', pos_commission_recipient_id: ANGELICA_USER_ID }),
  row('gerardo', { total: 300, branch_id: AURRERA_BRANCH_ID, pos_commission_attribution: 'employee', pos_commission_recipient_id: GERARDO_USER_ID }),
  row('admin', { total: 150, branch_id: AURRERA_BRANCH_ID, pos_commission_attribution: 'administrator' }),
  row('legacy', { total: 50, branch_id: AURRERA_BRANCH_ID, cashier_id: ANGELICA_USER_ID }),
  row('order', { total: 80, sale_origin: 'order' }),
  row('legacy-order', { total: 40, sale_origin: null, promotion_code: 'ORDER_CHECKOUT' }),
  row('delivery', { total: 90, sale_origin: 'delivery' }),
  row('angelica', { total: 999, branch_id: AURRERA_BRANCH_ID, pos_commission_attribution: 'employee', pos_commission_recipient_id: ANGELICA_USER_ID }),
];

const result = buildFinanceSalesBreakdown(rows, { administratorUserIds: ['admin-user-id'] });
const byBranch = Object.fromEntries(result.branches.map(item => [item.key, item]));
const bySeller = Object.fromEntries(result.sellers.map(item => [item.key, item]));

assert.equal(result.reconciliation.uniqueRows, 11, 'deduplica por sales.id');
assert.equal(result.reconciliation.duplicateRows, 1);
assert.equal(result.channels.pos.total, 940);
assert.equal(result.channels.orders.total, 120);
assert.equal(result.channels.delivery.total, 90);
assert.equal(result.salesTotal, 1150, 'cada canal se suma una sola vez');
assert.equal(byBranch.chipitlan.total, 240);
assert.equal(byBranch.aurrera.total, 700);
assert.equal(bySeller.angelica.total, 320, 'Aurrera atribuida + Chipitlán por cashier_id');
assert.equal(bySeller.gerardo.total, 370, 'Aurrera atribuida + Chipitlán por cashier_id');
assert.equal(bySeller.administrator.total, 180);
assert.equal(bySeller.unattributed.total, 70, 'Aurrera histórica y cajero no reconocido');
assert.equal(bySeller.angelica.tickets, 2);
assert.equal(bySeller.angelica.averageTicket, 160);
assert.equal(bySeller.angelica.sharePercent, (320 / 940) * 100);
assert.equal(result.reconciliation.sellersTotal, 940);
assert.equal(result.reconciliation.sellersMatchPos, true);
const gerardoPosBeforeKpi = bySeller.gerardo.total;
const b2bGeneratedForKpi = 400;
assert.equal(gerardoPosBeforeKpi + b2bGeneratedForKpi, 770, 'KPI Gerardo = POS Gerardo + B2B generado');
assert.equal(bySeller.gerardo.total, gerardoPosBeforeKpi, 'el KPI no modifica las ventas POS de Gerardo');
assert.equal(result.reconciliation.sellersTotal, 940, 'el B2B no entra en la conciliación POS');
assert.equal(calculateGeneratedGrandTotal(result.salesTotal, 400), 1550);
assert.notEqual(calculateGeneratedGrandTotal(result.salesTotal, 400), 1800, 'la cobranza no se suma otra vez al total generado');

const participation = buildSalesParticipation(result, 400);
assert.equal(participation.total, 1550);
assert.equal(participation.items.reduce((sum, item) => sum + item.amount, 0), participation.total);
assert.equal(Math.round(participation.items.reduce((sum, item) => sum + item.percentage, 0) * 1e8) / 1e8, 100);
assert.deepEqual(participation.items.map(item => item.label), [
  'Chipitlán 01', 'Aurrera La Luna 02', 'Socios Comerciales', 'Pedidos', 'Delivery',
]);
assert.equal(participation.amountMatchesTotal, true);

console.log('OK: canales, dona 100%, atribución Aurrera/Chipitlán, históricos y conciliación POS');
