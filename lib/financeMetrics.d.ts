export interface FinanceRpcSummary {
  sales_mtd_mxn: number;
  sales_cash_mxn?: number;
  sales_card_mxn?: number;
  sales_transfer_mxn?: number;
  sales_projection_mxn?: number;
  sales_target_mxn?: number;
  expenses_fixed_mxn: number;
  expenses_variable_mxn: number;
  expenses_other_mxn: number;
  expenses_total_mxn: number;
  fixed_plan_mxn: number;
  fixed_covered_mxn: number;
  fixed_pending_mxn: number;
  pnl?: Record<string, number>;
  [key: string]: unknown;
}

export interface FinancePresentation extends FinanceRpcSummary {
  physical_sales_generated_mxn: number;
  b2b_generated_mxn: number;
  commercial_collections: number;
  pnl: {
    sales_mxn: number;
    cogs_variable_purchases_mxn: number;
    gross_profit_mxn: number;
    fixed_expenses_mxn: number;
    other_expenses_mxn: number;
    net_profit_mxn: number;
  };
}

export function summarizeNonRefundedSales(rows: Array<Record<string, unknown>>): {
  total: number;
  cash: number;
  card: number;
  transfer: number;
  ticketCount: number;
};

export function buildFinancePresentation(
  rpcSummary: FinanceRpcSummary,
  options?: {
    b2bGenerated?: number;
    b2bCollected?: number;
    projectionDaysElapsed?: number;
    projectionDaysInMonth?: number;
  },
): FinancePresentation;

export function getFinanceSurfaceFigures(presentation: FinancePresentation): {
  sales: number;
  variableExpenses: number;
  grossProfit: number;
  netProfit: number;
  b2bCollected: number;
};
