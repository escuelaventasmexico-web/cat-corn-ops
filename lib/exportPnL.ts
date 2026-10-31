import * as XLSX from 'xlsx';
import { getFinanceSurfaceFigures } from './financeMetrics.js';

interface PLData {
  sales_mxn: number;
  cogs_variable_purchases_mxn: number;
  gross_profit_mxn: number;
  fixed_expenses_mxn: number;
  other_expenses_mxn: number;
  net_profit_mxn: number;
}

interface FinanceSummary {
  sales_mtd_mxn: number;
  physical_sales_generated_mxn?: number;
  b2b_generated_mxn?: number;
  commercial_collections?: number;
  sales_projection_mxn?: number;
  sales_target_mxn?: number;
  expenses_fixed_mxn: number;
  expenses_variable_mxn: number;
  expenses_other_mxn: number;
  expenses_total_mxn: number;
  fixed_plan_mxn: number;
  fixed_covered_mxn: number | null;
  fixed_pending_mxn: number | null;
  fixed_reserved_mxn?: number;
  fixed_due_mxn?: number;
  fixed_registered_mxn?: number;
  fixed_reconciliation_status?: string;
  pnl?: PLData;
}

/**
 * Format number as MXN currency
 */
const formatMXN = (value: number): string => {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
};

/**
 * Format number as percentage with 2 decimals
 */
const formatPercent = (value: number): string => {
  return `${value.toFixed(2)}%`;
};

/**
 * Export P&L data to Excel file with 3 sheets: Resumen, P&L, Detalle
 */
export const exportPnLToExcel = (data: FinanceSummary, monthStart: string) => {
  if (!data || !data.pnl) {
    throw new Error('No hay datos de P&L para exportar');
  }

  const pnl = data.pnl;
  const figures = getFinanceSurfaceFigures(data as any);
  
  // Calculate margins (avoid NaN)
  const grossMargin = pnl.sales_mxn > 0 ? (pnl.gross_profit_mxn / pnl.sales_mxn) * 100 : 0;
  const netMargin = pnl.sales_mxn > 0 ? (pnl.net_profit_mxn / pnl.sales_mxn) * 100 : 0;

  // =========================================
  // SHEET 1: RESUMEN (Tabla legible)
  // =========================================
  const resumenData = [
    ['Concepto', 'Monto', 'Nota'],
    ['Mes Consultado', monthStart, ''],
    ['Ventas generadas del mes (MXN)', formatMXN(figures.sales), 'Ventas no devueltas + B2B generado'],
    ['Ventas físicas no devueltas (MXN)', formatMXN(data.physical_sales_generated_mxn ?? 0), ''],
    ['Ventas B2B generadas (MXN)', formatMXN(data.b2b_generated_mxn ?? 0), ''],
    ['Cobranza B2B (MXN)', formatMXN(data.commercial_collections ?? 0), 'Indicador separado; no se suma a ventas'],
    ['Proyección Mensual (MXN)', formatMXN(data.sales_projection_mxn ?? 0), 'Estimado basado en ventas diarias'],
    ['Meta de Ventas (MXN)', formatMXN(data.sales_target_mxn ?? 0), ''],
    ['Gastos del Mes (Total) (MXN)', formatMXN(data.expenses_total_mxn), 'Suma de todos los gastos'],
    ['Gastos Fijos Pagados (MXN)', formatMXN(data.expenses_fixed_mxn), 'Gastos fijos efectivamente pagados'],
    ['Gastos variables registrados (MXN)', formatMXN(data.expenses_variable_mxn), 'No representa costo de producción consumido'],
    ['Otros Gastos (MXN)', formatMXN(data.expenses_other_mxn), 'Gastos no clasificados'],
    ['Apartado de fijos del mes (MXN)', formatMXN(data.fixed_reserved_mxn ?? data.fixed_plan_mxn), 'Provisión mensual conocida'],
    ['Pagos fijos que vencen (MXN)', formatMXN(data.fixed_due_mxn ?? 0), 'Sólo obligaciones con importe y calendario configurados'],
    ['Pagos fijos registrados (MXN)', formatMXN(data.fixed_registered_mxn ?? data.expenses_fixed_mxn), 'Todos los gastos FIXED registrados'],
    ['Estado de conciliación', data.fixed_reconciliation_status ?? '', 'No se infieren vínculos históricos'],
    ['Utilidad Neta (MXN)', formatMXN(figures.netProfit), 'Resultado final después de gastos'],
    ['Margen Neto (%)', formatPercent(netMargin), 'Utilidad Neta / Ventas']
  ];

  const wsResumen = XLSX.utils.aoa_to_sheet(resumenData);
  
  // Set column widths
  wsResumen['!cols'] = [
    { wch: 35 },  // Concepto
    { wch: 20 },  // Monto
    { wch: 40 }   // Nota
  ];

  // Make header row bold (row 0)
  if (!wsResumen['A1']) wsResumen['A1'] = { t: 's', v: 'Concepto' };
  wsResumen['A1'].s = { font: { bold: true } };
  if (!wsResumen['B1']) wsResumen['B1'] = { t: 's', v: 'Monto' };
  wsResumen['B1'].s = { font: { bold: true } };
  if (!wsResumen['C1']) wsResumen['C1'] = { t: 's', v: 'Nota' };
  wsResumen['C1'].s = { font: { bold: true } };

  // =========================================
  // SHEET 2: P&L (Estado de Resultados)
  // =========================================
  const pnlData = [
    ['Concepto', 'MXN'],
    ['Ventas', formatMXN(figures.sales)],
    ['(-) Gastos variables registrados', formatMXN(figures.variableExpenses)],
    ['(=) Resultado tras gastos variables', formatMXN(figures.grossProfit)],
    ['(-) Gastos Fijos Pagados', formatMXN(pnl.fixed_expenses_mxn)],
    ['(-) Otros Gastos', formatMXN(pnl.other_expenses_mxn)],
    ['(=) Utilidad Neta', formatMXN(figures.netProfit)],
    ['', ''], // Spacer
    ['Margen tras gastos variables (%)', formatPercent(grossMargin)],
    ['Margen Neto (%)', formatPercent(netMargin)]
  ];

  const wsPnL = XLSX.utils.aoa_to_sheet(pnlData);
  
  // Set column widths
  wsPnL['!cols'] = [
    { wch: 35 },  // Concepto
    { wch: 20 }   // MXN
  ];

  // Make header row bold
  if (!wsPnL['A1']) wsPnL['A1'] = { t: 's', v: 'Concepto' };
  wsPnL['A1'].s = { font: { bold: true } };
  if (!wsPnL['B1']) wsPnL['B1'] = { t: 's', v: 'MXN' };
  wsPnL['B1'].s = { font: { bold: true } };

  // =========================================
  // SHEET 3: DETALLE (Con nombres legibles)
  // =========================================
  const detalleData: Array<[string, string]> = [
    ['Concepto', 'Valor'],
    ['Mes consultado (inicio)', monthStart],
    ['Ventas generadas del mes', formatMXN(data.sales_mtd_mxn)],
    ['Ventas físicas no devueltas', formatMXN(data.physical_sales_generated_mxn ?? 0)],
    ['Ventas B2B generadas', formatMXN(data.b2b_generated_mxn ?? 0)],
    ['Cobranza B2B (no sumada a ventas)', formatMXN(data.commercial_collections ?? 0)],
    ['Proyección mensual', formatMXN(data.sales_projection_mxn ?? 0)],
    ['Meta mensual', formatMXN(data.sales_target_mxn ?? 0)],
    ['Gastos fijos pagados', formatMXN(data.expenses_fixed_mxn)],
    ['Gastos variables', formatMXN(data.expenses_variable_mxn)],
    ['Otros gastos', formatMXN(data.expenses_other_mxn)],
    ['Gastos totales', formatMXN(data.expenses_total_mxn)],
    ['Apartado de gastos fijos del mes', formatMXN(data.fixed_reserved_mxn ?? data.fixed_plan_mxn)],
    ['Pagos fijos que vencen este mes', formatMXN(data.fixed_due_mxn ?? 0)],
    ['Pagos fijos registrados', formatMXN(data.fixed_registered_mxn ?? data.expenses_fixed_mxn)],
    ['Estado de conciliación', data.fixed_reconciliation_status ?? ''],
    ['', ''],
    ['--- Estado de Resultados (P&L) ---', ''],
    ['P&L: Ventas', formatMXN(figures.sales)],
    ['P&L: Gastos variables registrados', formatMXN(figures.variableExpenses)],
    ['P&L: Resultado tras gastos variables', formatMXN(figures.grossProfit)],
    ['P&L: Gastos fijos pagados', formatMXN(pnl.fixed_expenses_mxn)],
    ['P&L: Otros gastos', formatMXN(pnl.other_expenses_mxn)],
    ['P&L: Utilidad neta', formatMXN(figures.netProfit)],
    ['', ''],
    ['--- Márgenes Calculados ---', ''],
    ['Margen tras gastos variables (%)', formatPercent(grossMargin)],
    ['Margen neto (%)', formatPercent(netMargin)]
  ];

  const wsDetalle = XLSX.utils.aoa_to_sheet(detalleData);
  
  // Set column widths
  wsDetalle['!cols'] = [
    { wch: 40 },  // Concepto
    { wch: 25 }   // Valor
  ];

  // Make header row bold
  if (!wsDetalle['A1']) wsDetalle['A1'] = { t: 's', v: 'Concepto' };
  wsDetalle['A1'].s = { font: { bold: true } };
  if (!wsDetalle['B1']) wsDetalle['B1'] = { t: 's', v: 'Valor' };
  wsDetalle['B1'].s = { font: { bold: true } };

  // =========================================
  // CREATE WORKBOOK AND EXPORT
  // =========================================
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');
  XLSX.utils.book_append_sheet(wb, wsPnL, 'P&L');
  XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle');

  // Generate filename: CATCORN_PnL_YYYY-MM.xlsx
  const fileName = `CATCORN_PnL_${monthStart.substring(0, 7)}.xlsx`;

  // Download file
  XLSX.writeFile(wb, fileName);
};
