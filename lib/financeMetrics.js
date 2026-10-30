const money = value => Math.round((Number(value) || 0) * 100) / 100;

export const summarizeNonRefundedSales = rows => {
  const included = (rows ?? []).filter(row => row?.is_refunded === false);
  const total = money(included.reduce((sum, row) => sum + (Number(row.total) || 0), 0));
  const card = money(included.reduce((sum, row) => sum + (Number(row.card_amount) || 0), 0));
  const transfer = money(included.reduce((sum, row) => sum + (Number(row.transfer_amount) || 0), 0));
  return {
    total,
    cash: money(total - card - transfer),
    card,
    transfer,
    ticketCount: included.length,
  };
};

/**
 * Produces the one canonical presentation model shared by Resumen, P&L and
 * their export. Confirmed B2B collections are deliberately informational:
 * they never change generated sales or profit.
 */
export const buildFinancePresentation = (
  rpcSummary,
  { b2bGenerated = 0, b2bCollected = 0, projectionDaysElapsed, projectionDaysInMonth } = {},
) => {
  const physicalSales = money(rpcSummary?.sales_mtd_mxn);
  const generatedSales = money(physicalSales + b2bGenerated);
  const variableExpenses = money(rpcSummary?.expenses_variable_mxn);
  const fixedExpenses = money(rpcSummary?.expenses_fixed_mxn);
  const otherExpenses = money(rpcSummary?.expenses_other_mxn);
  const totalExpenses = money(fixedExpenses + variableExpenses + otherExpenses);
  const grossProfit = money(generatedSales - variableExpenses);
  const netProfit = money(generatedSales - totalExpenses);
  const canProject = Number(projectionDaysElapsed) > 0 && Number(projectionDaysInMonth) > 0;

  return {
    ...rpcSummary,
    physical_sales_generated_mxn: physicalSales,
    b2b_generated_mxn: money(b2bGenerated),
    commercial_collections: money(b2bCollected),
    sales_mtd_mxn: generatedSales,
    sales_projection_mxn: canProject
      ? money((generatedSales / Number(projectionDaysElapsed)) * Number(projectionDaysInMonth))
      : money(rpcSummary?.sales_projection_mxn),
    expenses_fixed_mxn: fixedExpenses,
    expenses_variable_mxn: variableExpenses,
    expenses_other_mxn: otherExpenses,
    expenses_total_mxn: totalExpenses,
    pnl: {
      ...(rpcSummary?.pnl ?? {}),
      sales_mxn: generatedSales,
      cogs_variable_purchases_mxn: variableExpenses,
      gross_profit_mxn: grossProfit,
      fixed_expenses_mxn: fixedExpenses,
      other_expenses_mxn: otherExpenses,
      net_profit_mxn: netProfit,
    },
  };
};

export const getFinanceSurfaceFigures = presentation => ({
  sales: money(presentation?.sales_mtd_mxn),
  variableExpenses: money(presentation?.expenses_variable_mxn),
  grossProfit: money(presentation?.pnl?.gross_profit_mxn),
  netProfit: money(presentation?.pnl?.net_profit_mxn),
  b2bCollected: money(presentation?.commercial_collections),
});
