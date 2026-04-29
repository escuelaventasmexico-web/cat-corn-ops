import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

interface Expense {
  id: string;
  expense_date: string;
  amount_mxn: number;
  type: 'FIXED' | 'VARIABLE' | 'OTHER';
  category: string | null;
  vendor: string | null;
  has_invoice: boolean;
  payment_method: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';
  notes: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  FIXED: 'Fijo',
  VARIABLE: 'Variable',
  OTHER: 'Otro',
};

const PM_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  OTHER: 'Otro',
};

const BAR_TOTAL = 30;

function makeBar(value: number, max: number): string {
  if (max === 0) return '';
  const filled = Math.round((value / max) * BAR_TOTAL);
  return '█'.repeat(filled) + '░'.repeat(BAR_TOTAL - filled);
}

function pct(value: number, total: number): string {
  if (total === 0) return '0%';
  return ((value / total) * 100).toFixed(1) + '%';
}

function currencyMX(value: number): string {
  return value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Helper: apply bold + background fill to a cell
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function styleHeader(ws: any, cellRef: string, bgColor = 'FFF5E6') {
  if (!ws[cellRef]) return;
  ws[cellRef].s = {
    font: { bold: true },
    fill: { fgColor: { rgb: bgColor }, patternType: 'solid' },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: {
      bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
    },
  };
}

export function exportExpensesToExcel(expenses: Expense[], yearMonth?: string) {
  // Determine YYYY-MM label
  const now = new Date();
  const label = yearMonth ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fileName = `gastos_catcorn_${label}.xlsx`;

  const wb = XLSX.utils.book_new();

  // ─────────────────────────────────────────────────────────────────
  // HOJA 1: Gastos del Mes
  // ─────────────────────────────────────────────────────────────────
  const headers = ['Fecha', 'Tipo', 'Categoría', 'Proveedor', 'Monto (MXN)', 'Método de Pago', 'Factura', 'Notas'];

  const rows = expenses.map((e) => [
    new Date(e.expense_date + 'T12:00:00').toLocaleDateString('es-MX'),
    TYPE_LABELS[e.type] ?? e.type,
    e.category ?? '-',
    e.vendor ?? '-',
    Number(e.amount_mxn),
    PM_LABELS[e.payment_method] ?? e.payment_method,
    e.has_invoice ? 'Sí' : 'No',
    e.notes ?? '',
  ]);

  const ws1 = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Column widths
  ws1['!cols'] = [
    { wch: 14 }, // Fecha
    { wch: 10 }, // Tipo
    { wch: 20 }, // Categoría
    { wch: 24 }, // Proveedor
    { wch: 16 }, // Monto
    { wch: 18 }, // Método de Pago
    { wch: 10 }, // Factura
    { wch: 30 }, // Notas
  ];

  // Style header row
  headers.forEach((_, i) => {
    const ref = XLSX.utils.encode_cell({ r: 0, c: i });
    styleHeader(ws1, ref, 'FF6B00');
    if (ws1[ref]) ws1[ref].s = { ...ws1[ref].s, font: { bold: true, color: { rgb: 'FFFFFF' } } };
  });

  XLSX.utils.book_append_sheet(wb, ws1, 'Gastos del Mes');

  // ─────────────────────────────────────────────────────────────────
  // HOJA 2: Resumen
  // ─────────────────────────────────────────────────────────────────
  const total = expenses.reduce((s, e) => s + Number(e.amount_mxn), 0);
  const totalFijo     = expenses.filter(e => e.type === 'FIXED').reduce((s, e) => s + Number(e.amount_mxn), 0);
  const totalVariable = expenses.filter(e => e.type === 'VARIABLE').reduce((s, e) => s + Number(e.amount_mxn), 0);
  const totalOtro     = expenses.filter(e => e.type === 'OTHER').reduce((s, e) => s + Number(e.amount_mxn), 0);
  const totalCash     = expenses.filter(e => e.payment_method === 'CASH').reduce((s, e) => s + Number(e.amount_mxn), 0);
  const totalCard     = expenses.filter(e => e.payment_method === 'CARD').reduce((s, e) => s + Number(e.amount_mxn), 0);
  const totalTransfer = expenses.filter(e => e.payment_method === 'TRANSFER').reduce((s, e) => s + Number(e.amount_mxn), 0);
  const totalOtherPM  = expenses.filter(e => e.payment_method === 'OTHER').reduce((s, e) => s + Number(e.amount_mxn), 0);
  const totalConFact  = expenses.filter(e => e.has_invoice).reduce((s, e) => s + Number(e.amount_mxn), 0);
  const totalSinFact  = expenses.filter(e => !e.has_invoice).reduce((s, e) => s + Number(e.amount_mxn), 0);

  const resumeData = [
    [`RESUMEN DE GASTOS — ${label}`, ''],
    ['', ''],
    ['📊 TOTALES GENERALES', ''],
    ['Concepto', 'Monto (MXN)'],
    ['Total de gastos del mes', `$${currencyMX(total)}`],
    ['', ''],
    ['📦 POR TIPO', ''],
    ['Concepto', 'Monto (MXN)'],
    [`Gastos Fijos`, `$${currencyMX(totalFijo)}`],
    [`Gastos Variables`, `$${currencyMX(totalVariable)}`],
    [`Otros`, `$${currencyMX(totalOtro)}`],
    ['', ''],
    ['💳 POR MÉTODO DE PAGO', ''],
    ['Método', 'Monto (MXN)'],
    ['Efectivo', `$${currencyMX(totalCash)}`],
    ['Tarjeta', `$${currencyMX(totalCard)}`],
    ['Transferencia', `$${currencyMX(totalTransfer)}`],
    ['Otro', `$${currencyMX(totalOtherPM)}`],
    ['', ''],
    ['🧾 DEDUCIBILIDAD', ''],
    ['Estado', 'Monto (MXN)'],
    ['Con factura', `$${currencyMX(totalConFact)}`],
    ['Sin factura', `$${currencyMX(totalSinFact)}`],
  ];

  const ws2 = XLSX.utils.aoa_to_sheet(resumeData);
  ws2['!cols'] = [{ wch: 32 }, { wch: 20 }];

  // Bold title
  if (ws2['A1']) ws2['A1'].s = { font: { bold: true, sz: 14 } };
  ['A3', 'A7', 'A13', 'A20'].forEach(ref => {
    if (ws2[ref]) ws2[ref].s = { font: { bold: true }, fill: { fgColor: { rgb: 'FFF0E0' }, patternType: 'solid' } };
  });

  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen');

  // ─────────────────────────────────────────────────────────────────
  // HOJA 3: Por Categoría
  // ─────────────────────────────────────────────────────────────────
  const catMap: Record<string, number> = {};
  expenses.forEach(e => {
    const k = e.category ?? 'Sin categoría';
    catMap[k] = (catMap[k] ?? 0) + Number(e.amount_mxn);
  });
  const catRows = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const catMax = catRows[0]?.[1] ?? 0;

  const catData = [
    [`GASTOS POR CATEGORÍA — ${label}`, '', '', ''],
    ['', '', '', ''],
    ['Categoría', 'Monto (MXN)', '% del Total', `Gráfica (barra proporcional)`],
    ...catRows.map(([cat, amt]) => [
      cat,
      Number(amt),
      pct(amt, total),
      makeBar(amt, catMax),
    ]),
    ['', '', '', ''],
    ['TOTAL', `$${currencyMX(total)}`, '100%', ''],
  ];

  const ws3 = XLSX.utils.aoa_to_sheet(catData);
  ws3['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 12 }, { wch: 36 }];
  if (ws3['A1']) ws3['A1'].s = { font: { bold: true, sz: 13 } };
  ['A3', 'B3', 'C3', 'D3'].forEach(ref => styleHeader(ws3, ref, 'FF6B00'));

  XLSX.utils.book_append_sheet(wb, ws3, 'Por Categoría');

  // ─────────────────────────────────────────────────────────────────
  // HOJA 4: Por Proveedor
  // ─────────────────────────────────────────────────────────────────
  const vendorMap: Record<string, number> = {};
  expenses.forEach(e => {
    const k = e.vendor ?? 'Sin proveedor';
    vendorMap[k] = (vendorMap[k] ?? 0) + Number(e.amount_mxn);
  });
  const vendorRows = Object.entries(vendorMap).sort((a, b) => b[1] - a[1]);
  const vendorMax = vendorRows[0]?.[1] ?? 0;

  const vendorData = [
    [`GASTOS POR PROVEEDOR — ${label}`, '', '', ''],
    ['', '', '', ''],
    ['Proveedor', 'Monto (MXN)', '% del Total', 'Gráfica (barra horizontal)'],
    ...vendorRows.map(([v, amt]) => [
      v,
      Number(amt),
      pct(amt, total),
      makeBar(amt, vendorMax),
    ]),
    ['', '', '', ''],
    ['TOTAL', `$${currencyMX(total)}`, '100%', ''],
  ];

  const ws4 = XLSX.utils.aoa_to_sheet(vendorData);
  ws4['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 36 }];
  if (ws4['A1']) ws4['A1'].s = { font: { bold: true, sz: 13 } };
  ['A3', 'B3', 'C3', 'D3'].forEach(ref => styleHeader(ws4, ref, 'FF6B00'));

  XLSX.utils.book_append_sheet(wb, ws4, 'Por Proveedor');

  // ─────────────────────────────────────────────────────────────────
  // HOJA 5: Por Tipo y Método de Pago
  // ─────────────────────────────────────────────────────────────────
  const tipoMax = Math.max(totalFijo, totalVariable, totalOtro);
  const pmMax   = Math.max(totalCash, totalCard, totalTransfer, totalOtherPM);

  const tipoData = [
    [`DISTRIBUCIÓN POR TIPO Y MÉTODO DE PAGO — ${label}`, '', '', ''],
    ['', '', '', ''],
    ['POR TIPO DE GASTO', '', '', ''],
    ['Tipo', 'Monto (MXN)', '% del Total', 'Gráfica'],
    ['Fijo',     Number(totalFijo),     pct(totalFijo, total),     makeBar(totalFijo, tipoMax)],
    ['Variable', Number(totalVariable), pct(totalVariable, total), makeBar(totalVariable, tipoMax)],
    ['Otro',     Number(totalOtro),     pct(totalOtro, total),     makeBar(totalOtro, tipoMax)],
    ['', '', '', ''],
    ['POR MÉTODO DE PAGO', '', '', ''],
    ['Método', 'Monto (MXN)', '% del Total', 'Gráfica'],
    ['Efectivo',      Number(totalCash),     pct(totalCash, total),     makeBar(totalCash, pmMax)],
    ['Tarjeta',       Number(totalCard),     pct(totalCard, total),     makeBar(totalCard, pmMax)],
    ['Transferencia', Number(totalTransfer), pct(totalTransfer, total), makeBar(totalTransfer, pmMax)],
    ['Otro',          Number(totalOtherPM),  pct(totalOtherPM, total),  makeBar(totalOtherPM, pmMax)],
    ['', '', '', ''],
    ['DEDUCIBILIDAD', '', '', ''],
    ['Estado', 'Monto (MXN)', '% del Total', 'Gráfica'],
    ['Con factura', Number(totalConFact), pct(totalConFact, total), makeBar(totalConFact, Math.max(totalConFact, totalSinFact))],
    ['Sin factura', Number(totalSinFact), pct(totalSinFact, total), makeBar(totalSinFact, Math.max(totalConFact, totalSinFact))],
  ];

  const ws5 = XLSX.utils.aoa_to_sheet(tipoData);
  ws5['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 36 }];
  if (ws5['A1']) ws5['A1'].s = { font: { bold: true, sz: 13 } };
  ['A3', 'A9', 'A16'].forEach(ref => {
    if (ws5[ref]) ws5[ref].s = { font: { bold: true }, fill: { fgColor: { rgb: 'FFF0E0' }, patternType: 'solid' } };
  });
  ['A4', 'B4', 'C4', 'D4', 'A10', 'B10', 'C10', 'D10', 'A17', 'B17', 'C17', 'D17'].forEach(ref =>
    styleHeader(ws5, ref, 'FF6B00')
  );

  XLSX.utils.book_append_sheet(wb, ws5, 'Por Tipo y Pago');

  // ─────────────────────────────────────────────────────────────────
  // Write & download
  // ─────────────────────────────────────────────────────────────────
  const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const blob = new Blob([wbOut], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, fileName);
}
