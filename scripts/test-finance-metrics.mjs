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
assert.equal(figures.netProfit, october.pnl.net_profit_mxn, 'Resumen, P&L y exportación comparten el resultado según registros');
assert.equal(figures.b2bCollected, 3_615);

const novemberPhoto = buildFinancePresentation({
  sales_mtd_mxn: 285,
  expenses_fixed_mxn: 6_000,
  expenses_variable_mxn: 390,
  expenses_other_mxn: 100,
  pnl: {},
}, {
  b2bGenerated: 0,
  b2bCollected: 0,
});
assert.equal(novemberPhoto.sales_mtd_mxn, 285, 'el saldo inicial no se incorpora a las ventas del periodo');
assert.equal(novemberPhoto.expenses_total_mxn, 6_490, 'los gastos de la fotografía se cuentan una sola vez');
assert.equal(novemberPhoto.pnl.net_profit_mxn, -6_205, 'el resultado según registros es $285 - $6,490 = -$6,205');

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

const presentationFiles = [
  '../pages/Finanzas.tsx',
  '../components/finance/PLDetailedView.tsx',
  '../components/finance/FinanceSummaryPanel.tsx',
  '../lib/exportPnL.ts',
].map(path => readFileSync(new URL(path, import.meta.url), 'utf8'));
for (const source of presentationFiles) {
  assert.match(source, /Resultado según registros/, 'las superficies financieras usan el mismo nombre');
  assert.doesNotMatch(source, /Utilidad Neta|Utilidad neta|Margen Neto|Margen neto|Margen de Utilidad/,
    'las superficies no conservan etiquetas contradictorias');
}
assert.match(presentationFiles[0], /El saldo inicial se considera sólo en Dinero disponible/);
assert.match(presentationFiles[1], /contador pagado en noviembre por octubre/);
assert.match(presentationFiles[3], /compras de inventario todavía no vendido/);

console.log('OK: devoluciones, B2B, conciliación y resultado $285 - $6,490 = -$6,205');
