import type { Workbook as ExcelWorkbook, Worksheet } from 'exceljs';
import { saveAs } from 'file-saver';
import {
  CommissionStatementReport,
  formatCommissionDate,
  formatCommissionPeriod,
  getCommissionBusinessDate,
  getMovementCounterparty,
  getMovementDescription,
  getMovementDisplayStatus,
  getMovementFinancials,
  getMovementFolio,
  getStatementSourceLabel,
} from '../components/commercialPartners/commissions/commissionStatementReport';
import {
  getPaymentStatusLabel,
  parseNumericValue,
} from '../components/commercialPartners/commissions/commissionUtils';
import {
  createProductCommissionChartImage,
  ProductCommissionChartImage,
} from './createProductCommissionChartImage';

interface ExportCommissionStatementOptions {
  report: CommissionStatementReport;
  sellerName: string;
  monthStart: string;
}

type SheetValue = string | number | null;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HEADER_FILL = 'F4C542';
const HEADER_TEXT = '1C1A1A';
const CURRENCY_FORMAT = '$#,##0.00;[Red]-$#,##0.00';

const sanitizeFilenameSegment = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .replace(/\s+/g, '-')
  .replace(/[^a-zA-Z0-9_-]/g, '');

const generatedAtLabel = (): string => new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  dateStyle: 'long',
  timeStyle: 'short',
}).format(new Date());

const styleTitle = (worksheet: Worksheet, rowNumber: number, lastColumn: number): void => {
  const row = worksheet.getRow(rowNumber);
  row.font = { bold: true, size: 15, color: { argb: 'FF1F2937' } };
  row.height = 24;
  worksheet.mergeCells(rowNumber, 1, rowNumber, lastColumn);
};

const styleHeaderRow = (worksheet: Worksheet, rowNumber: number, columnCount: number): void => {
  const row = worksheet.getRow(rowNumber);
  row.height = 32;
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = row.getCell(column);
    cell.font = { bold: true, color: { argb: `FF${HEADER_TEXT}` } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_FILL}` } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFC89B1F' } } };
  }
};

const setCurrencyCells = (
  worksheet: Worksheet,
  startRow: number,
  endRow: number,
  columns: number[]
): void => {
  if (endRow < startRow) return;
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    columns.forEach(column => {
      const cell = worksheet.getRow(rowNumber).getCell(column);
      if (typeof cell.value === 'number') cell.numFmt = CURRENCY_FORMAT;
    });
  }
};

const setColumnWidths = (worksheet: Worksheet, widths: number[]): void => {
  widths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });
};

const configurePrintableSheet = (
  worksheet: Worksheet,
  printArea: string,
  landscape = true
): void => {
  worksheet.pageSetup.orientation = landscape ? 'landscape' : 'portrait';
  worksheet.pageSetup.fitToPage = true;
  worksheet.pageSetup.fitToWidth = 1;
  worksheet.pageSetup.fitToHeight = 0;
  worksheet.pageSetup.horizontalCentered = true;
  worksheet.pageSetup.margins = {
    left: 0.3,
    right: 0.3,
    top: 0.5,
    bottom: 0.5,
    header: 0.2,
    footer: 0.2,
  };
  worksheet.pageSetup.printArea = printArea;
  worksheet.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
};

const buildDetailSheet = (
  workbook: ExcelWorkbook,
  report: CommissionStatementReport,
  sellerName: string,
  monthStart: string
): Worksheet => {
  const worksheet = workbook.addWorksheet('Detalle');
  const metadataRows: SheetValue[][] = [
    ['ESTADO DE CUENTA DE COMISIONES'],
    ['Vendedor', sellerName],
    ['Periodo', formatCommissionPeriod(monthStart)],
    ['Fecha de generación', generatedAtLabel()],
    ['Total generado', report.totals.generated],
    ['Pagado', report.totals.paid],
    ['Pendiente de liberación', report.totals.pending],
    ['Saldo liberado', report.totals.releasedOutstanding],
    ['Reservado', report.totals.reserved],
    ['Disponible para liquidar', report.totals.allocatable],
    [],
    ['DESGLOSE POR ORIGEN'],
  ];
  worksheet.addRows(metadataRows);
  styleTitle(worksheet, 1, 18);
  styleTitle(worksheet, 12, 18);
  setCurrencyCells(worksheet, 5, 10, [2]);

  const sourceHeaderRow = worksheet.rowCount + 1;
  const sourceHeaders = ['Tipo', 'Generado', 'Pagado', 'Pendiente', 'Saldo liberado', 'Reservado', 'Disponible', 'Movimientos'];
  worksheet.addRow(sourceHeaders);
  styleHeaderRow(worksheet, sourceHeaderRow, sourceHeaders.length);
  const sourceStartRow = worksheet.rowCount + 1;
  worksheet.addRows(report.sourceBreakdown.map(source => [
    source.label,
    source.generated,
    source.paid,
    source.pending,
    source.releasedOutstanding,
    source.reserved,
    source.allocatable,
    source.movements,
  ]));
  setCurrencyCells(worksheet, sourceStartRow, worksheet.rowCount, [2, 3, 4, 5, 6, 7]);

  worksheet.addRow([]);
  const movementHeaderRow = worksheet.rowCount + 1;
  const movementHeaders = [
    'Fecha', 'Tipo', 'Folio', 'Socio o canal', 'Descripción', 'Producto', 'Variante',
    'Presentación', 'Cantidad', 'Comisión unitaria', 'Generada', 'Pagada', 'Pendiente',
    'Saldo liberado', 'Reservada', 'Disponible', 'Estado de comisión', 'Estado del pago',
  ];
  worksheet.addRow(movementHeaders);
  styleHeaderRow(worksheet, movementHeaderRow, movementHeaders.length);
  const movementStartRow = worksheet.rowCount + 1;
  worksheet.addRows(report.allMovements.map(movement => {
    const amounts = getMovementFinancials(movement);
    return [
      formatCommissionDate(getCommissionBusinessDate(movement)),
      getStatementSourceLabel(movement),
      getMovementFolio(movement),
      getMovementCounterparty(movement),
      getMovementDescription(movement),
      movement.product_name ?? '—',
      movement.product_variant ?? '—',
      movement.product_size ?? '—',
      parseNumericValue(movement.quantity),
      parseNumericValue(movement.unit_commission),
      parseNumericValue(movement.commission_amount),
      parseNumericValue(movement.paid_amount),
      amounts.pending,
      amounts.releasedOutstanding,
      amounts.reserved,
      amounts.allocatable,
      movement.status === 'cancelled'
        ? 'Cancelada — excluida de totales'
        : getMovementDisplayStatus(movement),
      getPaymentStatusLabel(movement.payment_status),
    ];
  }));
  const movementEndRow = worksheet.rowCount;
  setCurrencyCells(worksheet, movementStartRow, movementEndRow, [10, 11, 12, 13, 14, 15, 16]);
  report.allMovements.forEach((movement, index) => {
    if (movement.status !== 'cancelled') return;
    const row = worksheet.getRow(movementStartRow + index);
    row.font = { color: { argb: 'FF6B7280' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  });

  worksheet.addRow([]);
  const totalRow = worksheet.addRow([
    'TOTALES EFECTIVOS', '', '', '', '', '', '', '', '', '',
    report.totals.generated,
    report.totals.paid,
    report.totals.pending,
    report.totals.releasedOutstanding,
    report.totals.reserved,
    report.totals.allocatable,
    '', '',
  ]);
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CC' } };
  setCurrencyCells(worksheet, totalRow.number, totalRow.number, [11, 12, 13, 14, 15, 16]);

  setColumnWidths(worksheet, [
    15, 22, 20, 24, 30, 24, 18, 18, 11, 17, 15, 15, 15, 17, 15, 15, 29, 22,
  ]);
  configurePrintableSheet(worksheet, `A1:R${worksheet.rowCount}`);
  return worksheet;
};

const buildExtraDaysSheet = (
  workbook: ExcelWorkbook,
  report: CommissionStatementReport
): Worksheet => {
  const worksheet = workbook.addWorksheet('Días extra');
  worksheet.addRow(['DÍAS EXTRA']);
  styleTitle(worksheet, 1, 10);

  const mainHeaders = [
    'Fecha', 'Descripción', 'Pago extra generado', 'Pago extra pagado',
    'Pago extra disponible', 'Otras comisiones generadas', 'Total generado del día', 'Estado',
  ];
  worksheet.addRow(mainHeaders);
  styleHeaderRow(worksheet, 2, mainHeaders.length);
  const mainStartRow = worksheet.rowCount + 1;
  worksheet.addRows(report.extraDays.map(day => [
    formatCommissionDate(day.businessDate),
    day.description,
    day.generated,
    day.paid,
    day.available,
    day.otherGenerated,
    day.dayGeneratedTotal,
    day.statusLabel,
  ]));
  setCurrencyCells(worksheet, mainStartRow, worksheet.rowCount, [3, 4, 5, 6, 7]);

  worksheet.addRow([]);
  const detailTitleRow = worksheet.addRow(['OTRAS COMISIONES GENERADAS EN ESAS FECHAS']);
  styleTitle(worksheet, detailTitleRow.number, 10);
  const detailHeaders = [
    'Fecha del día extra', 'Tipo', 'Producto', 'Variante', 'Presentación',
    'Cantidad', 'Generada', 'Pagada', 'Disponible', 'Estado',
  ];
  const detailHeaderRow = worksheet.addRow(detailHeaders);
  styleHeaderRow(worksheet, detailHeaderRow.number, detailHeaders.length);
  const detailStartRow = worksheet.rowCount + 1;
  worksheet.addRows(report.extraDays.flatMap(day => day.otherMovements.map(movement => [
    formatCommissionDate(day.businessDate),
    getStatementSourceLabel(movement),
    movement.product_name ?? getMovementDescription(movement),
    movement.product_variant ?? '—',
    movement.product_size ?? '—',
    parseNumericValue(movement.quantity),
    parseNumericValue(movement.commission_amount),
    parseNumericValue(movement.paid_amount),
    movement.status === 'available' ? parseNumericValue(movement.allocatable_amount) : 0,
    getMovementDisplayStatus(movement),
  ])));
  setCurrencyCells(worksheet, detailStartRow, worksheet.rowCount, [7, 8, 9]);

  setColumnWidths(worksheet, [18, 34, 24, 20, 22, 27, 24, 27, 18, 25]);
  configurePrintableSheet(worksheet, `A1:J${worksheet.rowCount}`);
  return worksheet;
};

const buildProductsSheet = (
  workbook: ExcelWorkbook,
  report: CommissionStatementReport,
  chartImage: ProductCommissionChartImage | null
): Worksheet => {
  const worksheet = workbook.addWorksheet('Por producto');
  worksheet.addRow(['COMISIÓN GENERADA POR PRODUCTO']);
  styleTitle(worksheet, 1, 11);
  worksheet.addRow(['Comisiones generadas por productos', report.productGenerated]);
  worksheet.addRow(['Conceptos no asociados a bolsas', report.nonProductGenerated]);
  worksheet.addRow(['Total generado', report.totals.generated]);
  setCurrencyCells(worksheet, 2, 4, [2]);
  worksheet.addRow([]);

  const headers = [
    'Familia', 'Variantes', 'Unidades', 'Movimientos', 'Generada', 'Pagada', 'Pendiente',
    'Saldo liberado', 'Reservada', 'Disponible', 'Porcentaje',
  ];
  const headerRow = worksheet.addRow(headers);
  styleHeaderRow(worksheet, headerRow.number, headers.length);
  const productStartRow = worksheet.rowCount + 1;
  worksheet.addRows(report.productBreakdown.map(product => [
    product.family,
    product.variants.join(', ') || '—',
    product.units,
    product.movements,
    product.generated,
    product.paid,
    product.pending,
    product.releasedOutstanding,
    product.reserved,
    product.allocatable,
    product.percentage / 100,
  ]));
  const productEndRow = worksheet.rowCount;
  setCurrencyCells(worksheet, productStartRow, productEndRow, [5, 6, 7, 8, 9, 10]);
  for (let rowNumber = productStartRow; rowNumber <= productEndRow; rowNumber += 1) {
    worksheet.getRow(rowNumber).getCell(11).numFmt = '0.0%';
  }

  setColumnWidths(worksheet, [24, 38, 12, 14, 16, 16, 16, 18, 16, 16, 14]);

  const imageTopRow = Math.max(11, worksheet.rowCount + 1);
  let printEndRow: number;
  if (chartImage) {
    const imageId = workbook.addImage({ base64: chartImage.dataUrl, extension: 'png' });
    worksheet.addImage(imageId, {
      tl: { col: 0, row: imageTopRow },
      ext: { width: chartImage.width, height: chartImage.height },
    });
    const imageRows = Math.ceil(chartImage.height / 20);
    printEndRow = imageTopRow + imageRows + 1;
  } else {
    const messageRow = worksheet.getRow(imageTopRow + 1);
    messageRow.getCell(1).value = 'No existen comisiones generadas por productos durante este periodo.';
    messageRow.getCell(1).font = { italic: true, color: { argb: 'FF4B5563' } };
    worksheet.mergeCells(messageRow.number, 1, messageRow.number, 11);
    printEndRow = messageRow.number;
  }

  configurePrintableSheet(worksheet, `A1:K${printEndRow}`);
  return worksheet;
};

export const exportCommissionStatement = async ({
  report,
  sellerName,
  monthStart,
}: ExportCommissionStatementOptions): Promise<void> => {
  if (!report.reconciliation.isValid) {
    throw new Error('El estado de cuenta no está conciliado y no puede descargarse.');
  }

  let chartImage: ProductCommissionChartImage | null;
  try {
    chartImage = createProductCommissionChartImage(report.productBreakdown);
  } catch (chartError) {
    console.error('[COMMISSION STATEMENT] Product chart generation failed', chartError);
    throw new Error('No fue posible generar la gráfica del estado de cuenta.');
  }

  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cat Corn OPS';
  workbook.created = new Date();
  workbook.modified = new Date();

  buildDetailSheet(workbook, report, sellerName, monthStart);
  buildExtraDaysSheet(workbook, report);
  try {
    buildProductsSheet(workbook, report, chartImage);
  } catch (imageError) {
    console.error('[COMMISSION STATEMENT] Product chart embedding failed', imageError);
    throw new Error('No fue posible generar la gráfica del estado de cuenta.');
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer);
  const period = formatCommissionPeriod(monthStart).replace(/\s+de\s+/g, '-');
  const fileName = [
    'estado-cuenta-comisiones',
    sanitizeFilenameSegment(sellerName),
    sanitizeFilenameSegment(period),
  ].filter(Boolean).join('-') + '.xlsx';

  saveAs(new Blob([bytes], { type: XLSX_MIME }), fileName);
};
