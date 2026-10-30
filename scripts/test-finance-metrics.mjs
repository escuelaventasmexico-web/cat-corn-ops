import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildFinancePresentation,
  getFinanceSurfaceFigures,
  summarizeNonRefundedSales,
} from '../lib/financeMetrics.js';

const validSales = [12_000, 10_000, 9_640, 10_000].map((total, index) => ({
  id: `valid-${index}`,
  total,
  card_amount: index === 1 ? total : 0,
  transfer_amount: index === 2 ? total : 0,
  is_refunded: false,
}));
const refundedSales = [80, 90, 70, 100].map((total, index) => ({
  id: `refunded-${index}`,
  total,
  card_amount: index === 1 ? total : 0,
  transfer_amount: index === 2 ? total : 0,
  is_refunded: true,
}));

const nonRefunded = summarizeNonRefundedSales([...validSales, ...refundedSales]);
assert.equal(nonRefunded.total, 41_640, 'las cuatro devoluciones por $340 quedan fuera de ventas');
assert.equal(nonRefunded.ticketCount, 4, 'las devoluciones quedan fuera del conteo de tickets');
assert.equal(nonRefunded.card, 10_000, 'los métodos sólo incluyen ventas no devueltas');
assert.equal(nonRefunded.transfer, 9_640, 'los métodos sólo incluyen ventas no devueltas');
assert.equal(nonRefunded.cash, 22_000, 'el efectivo excluye devoluciones');

const rpcSummary = {
  sales_mtd_mxn: nonRefunded.total,
  sales_cash_mxn: nonRefunded.cash,
  sales_card_mxn: nonRefunded.card,
  sales_transfer_mxn: nonRefunded.transfer,
  sales_projection_mxn: nonRefunded.total,
  sales_target_mxn: 55_000,
  expenses_fixed_mxn: 13_670,
  expenses_variable_mxn: 15_909.85,
  expenses_other_mxn: 1_400,
  expenses_total_mxn: 30_979.85,
  fixed_plan_mxn: 9_590,
  fixed_covered_mxn: 13_670,
  fixed_pending_mxn: 0,
  pnl: {},
};

const october = buildFinancePresentation(rpcSummary, {
  b2bGenerated: 3_525,
  // Includes a confirmed October collection for an operation generated in another month.
  b2bCollected: 3_615,
  projectionDaysElapsed: 31,
  projectionDaysInMonth: 31,
});
assert.equal(october.sales_mtd_mxn, 45_165, 'ventas = no devueltas + B2B generado');
assert.equal(october.commercial_collections, 3_615, 'la cobranza se informa separada');
assert.equal(october.pnl.gross_profit_mxn, 29_255.15);
assert.equal(october.pnl.net_profit_mxn, 14_185.15);

const withoutCollections = buildFinancePresentation(rpcSummary, {
  b2bGenerated: 3_525,
  b2bCollected: 0,
  projectionDaysElapsed: 31,
  projectionDaysInMonth: 31,
});
assert.equal(october.sales_mtd_mxn, withoutCollections.sales_mtd_mxn, 'cobrar una venta de otro mes no crea venta nueva');
assert.equal(october.pnl.net_profit_mxn, withoutCollections.pnl.net_profit_mxn, 'la cobranza no altera utilidad');

const figures = getFinanceSurfaceFigures(october);
assert.equal(figures.sales, october.sales_mtd_mxn, 'Resumen y exportación comparten ventas');
assert.equal(figures.sales, october.pnl.sales_mxn, 'Resumen y P&L comparten ventas');
assert.equal(figures.grossProfit, october.pnl.gross_profit_mxn, 'P&L y exportación comparten utilidad bruta');
assert.equal(figures.netProfit, october.pnl.net_profit_mxn, 'Resumen, P&L y exportación comparten utilidad neta');
assert.equal(figures.b2bCollected, 3_615);

const migration = readFileSync(
  new URL('../supabase/migrations/20261030_finance_generated_sales_consistency.sql', import.meta.url),
  'utf8',
);
for (const rpc of ['finance_month_summary', 'finance_daily_series', 'finance_daily_breakdown', 'finance_calendar_with_yoy']) {
  assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}`), `${rpc} queda versionada`);
}
assert.ok(
  (migration.match(/is_refunded = FALSE/g) ?? []).length >= 5,
  'resumen, series, desglose, calendario actual y comparación anual excluyen devoluciones',
);

console.log('OK: devoluciones, métodos, B2B generado/cobrado y conciliación Resumen/P&L/exportación');
