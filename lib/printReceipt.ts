/**
 * Thermal receipt printing via QZ Tray (ESC/POS raw commands).
 * Uses QZ Tray exclusively — no browser window.print().
 */
import type { ReceiptData } from '../components/TicketReceipt';
import { printRaw, getSavedPrinterName } from './qzService';

// ─── 58 mm thermal: 32 chars per line at normal font ─────────────────
const LINE_W = 32;

// ─── ESC/POS constants ───────────────────────────────────────────────
const ESC = '\x1B';
const GS = '\x1D';

const INIT = ESC + '\x40';                  // Initialize printer
const CENTER = ESC + '\x61\x01';            // Center align
const LEFT = ESC + '\x61\x00';              // Left align
const BOLD_ON = ESC + '\x45\x01';           // Bold on
const BOLD_OFF = ESC + '\x45\x00';          // Bold off
const DOUBLE_SIZE = GS + '\x21\x11';        // Double width+height
const NORMAL_SIZE = GS + '\x21\x00';        // Normal size
const LF = '\x0A';                          // Line feed
const CUT = GS + '\x56\x41\x03';           // Partial cut with feed

// ─── Helpers ─────────────────────────────────────────────────────────

/** Pad / truncate a left-aligned string to `w` chars. */
function padR(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
}
/** Right-align a string to `w` chars. */
function padL(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : ' '.repeat(w - s.length) + s;
}
/** Two-column row: label left, value right. */
function escRow(label: string, value: string): string {
  const valW = Math.max(value.length, 10);
  const labW = LINE_W - valW;
  return padR(label, labW) + padL(value, valW) + LF;
}
/** Dashed separator line. */
function divider(): string {
  return '-'.repeat(LINE_W) + LF;
}

// ─── Build ESC/POS receipt data ──────────────────────────────────────

export function buildEscPosReceipt(data: ReceiptData): string[] {
  const folio = data.saleId.slice(0, 8).toUpperCase();
  const dateStr = data.date.toLocaleDateString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const timeStr = data.date.toLocaleTimeString('es-MX', {
    hour: '2-digit', minute: '2-digit',
  });
  const methodLabel =
    data.method === 'MIXED' ? 'Mixto'
      : data.method === 'TRANSFER' ? 'Transferencia'
      : data.method === 'CARD' ? 'Tarjeta' : 'Efectivo';

  const cmds: string[] = [];

  // ── Init ──
  cmds.push(INIT);

  // ── Header ──
  cmds.push(CENTER + BOLD_ON + DOUBLE_SIZE);
  cmds.push('CAT CORN' + LF);
  cmds.push(NORMAL_SIZE + BOLD_OFF);
  cmds.push(dateStr + '  ' + timeStr + LF);
  cmds.push('Folio: ' + folio + LF);
  cmds.push(LEFT);

  // ── Divider ──
  cmds.push(divider());

  // ── Items ──
  for (const item of data.items) {
    const name = (item.name || '').slice(0, LINE_W);
    cmds.push(BOLD_ON + name + BOLD_OFF + LF);

    // Always derive the final line total from the base unit price,
    // NOT from item.lineTotal which may already be post-discount.
    const disc = item.discount || 0;
    const lineSubtotal = item.unitPrice * item.quantity;
    const lineFinal = lineSubtotal - disc;

    const detail = `  ${item.size}  ${item.quantity} x $${item.unitPrice.toFixed(2)}`;
    cmds.push(escRow(detail, '$' + lineFinal.toFixed(2)));

    if (disc > 0) {
      const reason = item.discountReason || '';
      const discLabel = reason === 'PROMO_SATURDAY_SABORES_50'
        ? '  Promo sab sabores 50%: -$' + disc.toFixed(2)
        : reason === 'PROMO_FRIDAY_MANTEQUILLA_2X1'
          ? '  Promo viernes mantequilla 2x1: -$' + disc.toFixed(2)
          : reason === 'PROMOCION_INSTAGRAM_15'
            ? '  Promo Instagram 15%: -$' + disc.toFixed(2)
            : '  Desc: -$' + disc.toFixed(2);
      cmds.push(discLabel + LF);
    }
  }

  // ── Divider ──
  cmds.push(divider());

  // ── Totals ──
  if (data.totalDiscount > 0) {
    cmds.push(escRow('Subtotal', '$' + data.subtotal.toFixed(2)));
    cmds.push(escRow('Descuento', '-$' + data.totalDiscount.toFixed(2)));
  }
  cmds.push(BOLD_ON);
  cmds.push(escRow('TOTAL', '$' + data.total.toFixed(2)));
  cmds.push(BOLD_OFF);

  // ── Divider ──
  cmds.push(divider());

  // ── Payment ──
  cmds.push(escRow('Metodo', methodLabel));
  if (data.method === 'MIXED') {
    cmds.push(escRow('  Efectivo', '$' + data.cashAmount.toFixed(2)));
    cmds.push(escRow('  Tarjeta', '$' + data.cardAmount.toFixed(2)));
  }
  if (data.method === 'CASH' && data.cashAmount > 0) {
    cmds.push(escRow('Recibido', '$' + data.cashAmount.toFixed(2)));
  }
  if (data.changeAmount > 0) {
    cmds.push(escRow('Cambio', '$' + data.changeAmount.toFixed(2)));
  }

  // ── Customer ──
  if (data.customerName) {
    cmds.push(divider());
    cmds.push(CENTER + 'Cliente: ' + data.customerName + LF + LEFT);
  }

  // ── Footer ──
  cmds.push(LF);
  cmds.push(CENTER + BOLD_ON);
  cmds.push('Gracias por tu compra!' + LF);
  cmds.push(BOLD_OFF + LEFT);

  // Feed + cut
  cmds.push(LF + LF + LF + LF);
  cmds.push(CUT);

  return cmds;
}

// ─── Print via QZ Tray ───────────────────────────────────────────────

const TAG = '[Print]';

/**
 * Print a receipt via QZ Tray ESC/POS.
 *
 * This is the ONLY print path — no browser window.print() fallback.
 * Both the post-checkout "¿Imprimir ticket?" flow and the
 * "Reimprimir último ticket" button call this same function.
 *
 * Throws if no printer is configured or if QZ Tray fails,
 * so the caller can show an appropriate message to the user.
 */
export async function printSaleReceipt(data: ReceiptData): Promise<void> {
  const printerName = getSavedPrinterName();
  const folio = data.saleId.slice(0, 8).toUpperCase();

  console.info(TAG, `🧾 Imprimiendo ticket — Folio: ${folio}, Total: $${data.total.toFixed(2)}, Método: ${data.method}`);

  if (!printerName) {
    console.error(TAG, '❌ No hay impresora configurada. Ve a Configurar Impresora.');
    throw new Error('No hay impresora configurada. Configura tu impresora en el POS.');
  }

  console.info(TAG, `🖨️ Impresora: "${printerName}"`);
  console.info(TAG, '📝 Generando comandos ESC/POS...');
  const cmds = buildEscPosReceipt(data);
  console.info(TAG, `📦 ${cmds.length} fragmentos ESC/POS generados`);

  console.info(TAG, '📤 Enviando a QZ Tray...');
  await printRaw(printerName, cmds);
  console.info(TAG, `✅ Ticket enviado correctamente — Folio: ${folio}`);
}

// ─── Corte de Caja (Cash Cut) Receipt ────────────────────────────────

/** A single transaction line in the corte detail section */
export interface CorteTransaction {
  time: string;            // e.g. "01:15 pm"
  concept: string;         // e.g. "Venta - Ticket #A1B2C3D4 - Caramelo Mini Michi 60g"
  paymentMethod: string;   // e.g. "Efectivo", "Tarjeta", "Retiro"
  amount: number;          // signed: positive for sales, negative for withdrawals
}

/** Full data needed to print a corte de caja ticket */
export interface CorteDeCajaData {
  sessionId: string;
  status: 'open' | 'closed';
  printDate: Date;
  openedAt: Date;
  closedAt: Date | null;
  openingCash: number;
  cashSalesTotal: number;
  cardSalesTotal: number;
  withdrawalsTotal: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  salesCount: number;
  withdrawalsCount: number;
  ticketPromedio: number;
  transactions: CorteTransaction[];
}

/**
 * Build a product summary for a ticket concept line.
 *   1 product  → full name
 *   2-3 prods  → names joined with " + "
 *   4+ prods   → "X productos"
 */
export function buildProductSummary(
  items: { quantity: number; name: string }[],
): string {
  if (!items || items.length === 0) return '';
  const grouped: Record<string, number> = {};
  for (const it of items) {
    const n = it.name || 'Producto';
    grouped[n] = (grouped[n] || 0) + it.quantity;
  }
  const entries = Object.entries(grouped);
  const totalItems = entries.reduce((s, [, q]) => s + q, 0);

  if (entries.length === 1) {
    const [name, qty] = entries[0];
    return qty > 1 ? `${qty}x ${name}` : name;
  }
  if (entries.length <= 3) {
    const parts = entries.map(([name, qty]) => (qty > 1 ? `${qty}x ${name}` : name));
    const joined = parts.join(' + ');
    // Truncate if too long for thermal paper
    if (joined.length <= 50) return joined;
  }
  return `${totalItems} productos`;
}

/** Build ESC/POS commands for a corte de caja ticket */
export function buildCorteDeCajaReceipt(data: CorteDeCajaData): string[] {
  const cmds: string[] = [];

  const fmtDate = (d: Date) =>
    d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Mexico_City' });
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Mexico_City' });
  const fmtDateTime = (d: Date) => `${fmtDate(d)} ${fmtTime(d)}`;

  const sessionFolio = data.sessionId.slice(0, 8).toUpperCase();
  const statusLabel = data.status === 'open' ? 'Abierta' : 'Cerrada';

  // ── Init ──
  cmds.push(INIT);

  // ── Header ──
  cmds.push(CENTER + BOLD_ON + DOUBLE_SIZE);
  cmds.push('CAT CORN' + LF);
  cmds.push(NORMAL_SIZE);
  cmds.push('CORTE DE CAJA' + LF);
  cmds.push(BOLD_OFF);
  cmds.push(LF);
  cmds.push('Impresion: ' + fmtDateTime(data.printDate) + LF);
  cmds.push('Sesion: #' + sessionFolio + LF);
  cmds.push('Estado: ' + statusLabel + LF);
  cmds.push(LEFT);
  cmds.push(LF);
  cmds.push(escRow('Apertura', fmtDateTime(data.openedAt)));
  if (data.closedAt) {
    cmds.push(escRow('Cierre', fmtDateTime(data.closedAt)));
  } else {
    cmds.push(escRow('Cierre', 'En proceso'));
  }

  // ── Summary ──
  cmds.push(divider());
  cmds.push(BOLD_ON + CENTER + 'RESUMEN' + LF + LEFT + BOLD_OFF);
  cmds.push(divider());

  cmds.push(escRow('Fondo', '$' + data.openingCash.toFixed(2)));
  cmds.push(escRow('Efectivo', '$' + data.cashSalesTotal.toFixed(2)));
  cmds.push(escRow('Tarjeta', '$' + data.cardSalesTotal.toFixed(2)));
  cmds.push(escRow('Retiros', data.withdrawalsTotal > 0 ? '-$' + data.withdrawalsTotal.toFixed(2) : '$0.00'));
  cmds.push(BOLD_ON);
  cmds.push(escRow('Esperado', '$' + data.expectedCash.toFixed(2)));
  cmds.push(BOLD_OFF);
  if (data.countedCash != null) {
    cmds.push(escRow('Contado', '$' + data.countedCash.toFixed(2)));
  }
  if (data.difference != null) {
    const diffStr = (data.difference >= 0 ? '+$' : '-$') + Math.abs(data.difference).toFixed(2);
    cmds.push(escRow('Diferencia', diffStr));
  }
  cmds.push(escRow('Ventas', String(data.salesCount)));
  const ticketPromedioStr = '$' + data.ticketPromedio.toFixed(2);
  cmds.push(escRow('Ticket Promedio', ticketPromedioStr));
  cmds.push(escRow('Retiros', String(data.withdrawalsCount)));

  // ── Transactions detail ──
  if (data.transactions.length > 0) {
    cmds.push(divider());
    cmds.push(BOLD_ON + CENTER + 'DETALLE' + LF + LEFT + BOLD_OFF);
    cmds.push(divider());

    for (const tx of data.transactions) {
      // Line 1: time + payment method + amount (right-aligned)
      const amtStr = tx.amount < 0
        ? '-$' + Math.abs(tx.amount).toFixed(2)
        : '$' + tx.amount.toFixed(2);
      const methodShort = tx.paymentMethod.slice(0, 4);
      const headerLine = tx.time + ' ' + methodShort;
      cmds.push(escRow(headerLine, amtStr));

      // Line 2: concept (may wrap across multiple lines)
      const concept = tx.concept;
      // Split concept into lines that fit in LINE_W - 2 (indented)
      const maxConceptW = LINE_W - 2;
      let remaining = concept;
      while (remaining.length > 0) {
        const chunk = remaining.slice(0, maxConceptW);
        remaining = remaining.slice(maxConceptW);
        cmds.push('  ' + chunk + LF);
      }
    }
  }

  // ── Footer ──
  cmds.push(divider());
  const totalTx = data.transactions.reduce((s, tx) => s + tx.amount, 0);
  cmds.push(BOLD_ON);
  cmds.push(escRow('TOTAL TX', '$' + totalTx.toFixed(2)));
  cmds.push(BOLD_OFF);
  cmds.push(divider());
  cmds.push(LF);
  cmds.push(CENTER + 'Fin de corte' + LF);
  cmds.push(LEFT);

  // Feed + cut
  cmds.push(LF + LF + LF + LF);
  cmds.push(CUT);

  return cmds;
}

/**
 * Print a corte de caja ticket via QZ Tray ESC/POS.
 * Throws if no printer is configured or if QZ Tray fails.
 */
export async function printCorteDeCaja(data: CorteDeCajaData): Promise<void> {
  const printerName = getSavedPrinterName();
  const sessionFolio = data.sessionId.slice(0, 8).toUpperCase();

  console.info(TAG, `📋 Imprimiendo corte de caja — Sesión: #${sessionFolio}`);

  if (!printerName) {
    console.error(TAG, '❌ No hay impresora configurada.');
    throw new Error('No hay impresora configurada. Configura tu impresora en el POS.');
  }

  console.info(TAG, `🖨️ Impresora: "${printerName}"`);
  const cmds = buildCorteDeCajaReceipt(data);
  console.info(TAG, `📦 ${cmds.length} fragmentos ESC/POS generados para corte`);

  await printRaw(printerName, cmds);
  console.info(TAG, `✅ Corte de caja enviado — Sesión: #${sessionFolio}`);
}

// ─── Label Printing via QZ Tray ──────────────────────────────────────

/** Data needed to print product labels */
export interface LabelPrintData {
  productName: string;
  size: string;
  sku: string;
  barcodeValue: string;
  price: number;
}

/**
 * Build ESC/POS commands for a single product label.
 *
 * Layout (centered on 58 mm / 32-char thermal paper):
 *   ─ Product name (bold)
 *   ─ Size
 *   ─ ESC/POS barcode (CODE128, HRI text below)
 *   ─ SKU
 *   ─ Price (bold, double size)
 *   ─ Separator + cut
 */
function buildLabelCommands(label: LabelPrintData): string[] {
  const cmds: string[] = [];

  // ── Init ──
  cmds.push(INIT);

  // ── Small top margin ──
  cmds.push(LF);

  // ── Product name (centered, bold) ──
  cmds.push(CENTER + BOLD_ON);
  // Wrap name if longer than LINE_W
  const name = label.productName;
  for (let i = 0; i < name.length; i += LINE_W) {
    cmds.push(name.slice(i, i + LINE_W) + LF);
  }
  cmds.push(BOLD_OFF);

  // ── Size ──
  cmds.push(label.size + LF);
  cmds.push(LF);

  // ── Barcode (ESC/POS native CODE128) ──
  if (label.barcodeValue) {
    const bc = label.barcodeValue;

    // HRI (human-readable interpretation) position: below barcode
    // GS H 2  → print HRI below bars
    cmds.push(GS + '\x48\x02');

    // HRI font: Font A (normal)
    // GS f 0
    cmds.push(GS + '\x66\x00');

    // Barcode width: 2 dots
    // GS w 2
    cmds.push(GS + '\x77\x02');

    // Barcode height: 60 dots
    // GS h 60
    cmds.push(GS + '\x68\x3C');

    // Print CODE128 barcode
    // GS k 73 len {data}
    // 73 = CODE128 (type B auto)
    const barcodeBytes = '\x1D\x6B\x49' + String.fromCharCode(bc.length) + bc;
    cmds.push(barcodeBytes);

    cmds.push(LF);
  }

  cmds.push(LF);

  // ── SKU ──
  cmds.push(CENTER);
  cmds.push('SKU: ' + label.sku + LF);

  // ── Price (bold, double size) ──
  cmds.push(BOLD_ON + DOUBLE_SIZE);
  cmds.push('$' + label.price.toFixed(2) + LF);
  cmds.push(NORMAL_SIZE + BOLD_OFF);

  // ── Day key (small, centered — internal mark) ──
  const dayMap: Record<number, string> = { 0:'D', 1:'L', 2:'M', 3:'MR', 4:'J', 5:'V', 6:'S' };
  const todayKey = dayMap[new Date().getDay()];
  cmds.push(CENTER + todayKey + LF);

  // ── Bottom margin + cut ──
  cmds.push(LF + LF + LF);
  cmds.push(CUT);

  return cmds;
}

/**
 * Print product labels via QZ Tray ESC/POS.
 *
 * Sends `quantity` identical labels to the configured thermal printer.
 * Uses native ESC/POS CODE128 barcode commands — no image rendering.
 *
 * @throws if no printer configured or QZ Tray is not running
 */
export async function printLabelViaQZ(
  label: LabelPrintData,
  quantity: number,
): Promise<void> {
  const printerName = getSavedPrinterName();

  console.info(TAG, `🏷️ Imprimiendo ${quantity} etiqueta(s) — ${label.productName}`);

  if (!printerName) {
    console.error(TAG, '❌ No hay impresora configurada.');
    throw new Error('No hay impresora configurada. Configura tu impresora en el POS.');
  }

  // Build commands: N copies of the same label
  const allCmds: string[] = [];
  for (let i = 0; i < quantity; i++) {
    allCmds.push(...buildLabelCommands(label));
  }

  console.info(TAG, `🖨️ Impresora: "${printerName}"`);
  console.info(TAG, `📦 ${allCmds.length} fragmentos ESC/POS para ${quantity} etiqueta(s)`);

  await printRaw(printerName, allCmds);
  console.info(TAG, `✅ ${quantity} etiqueta(s) enviada(s) — ${label.productName}`);
}

// ─── Order bag label (customer name only) ────────────────────────────

/**
 * Print a minimal thermal label with the customer name.
 * Used to identify order bags — NOT a full receipt.
 *
 * Uses the same QZ Tray / ESC-POS infrastructure and saved printer
 * as ticket printing, re-printing and cash register cuts.
 */
export async function printOrderLabel(customerName: string): Promise<void> {
  const name = (customerName || '').trim().toUpperCase();
  if (!name) {
    throw new Error('No hay nombre de cliente para imprimir la etiqueta.');
  }

  const printerName = getSavedPrinterName();
  if (!printerName) {
    throw new Error('No hay impresora configurada. Configura tu impresora en el POS.');
  }

  const cmds: string[] = [
    INIT,
    LF + LF,                             // feed before
    CENTER,
    BOLD_ON,
    'PEDIDO' + LF,
    DOUBLE_SIZE,
    name + LF,
    NORMAL_SIZE,
    BOLD_OFF,
    divider(),
    LF + LF + LF,                        // feed for easy cutting
    CUT,
  ];

  console.info(TAG, `🏷️ Etiqueta pedido → "${name}" en "${printerName}"`);
  await printRaw(printerName, cmds);
  console.info(TAG, `✅ Etiqueta impresa — ${name}`);
}

// ─── Generic / manual label ──────────────────────────────────────────

/**
 * Print simple informational labels for manually-priced products.
 * No SKU, no barcode — just name, price, and a "Venta genérica" tag.
 *
 * Layout (centered, 58 mm thermal):
 *   CAT CORN
 *   ────────────────
 *   <Product Name>
 *   (wrapped if long)
 *   ────────────────
 *   Precio: $XX.XX
 *   Venta genérica
 *   DD/MM/YYYY
 *   ════════════════  + cut
 */
export async function printGenericLabelViaQZ(
  productName: string,
  price: number,
  quantity: number,
): Promise<void> {
  const printerName = getSavedPrinterName();
  if (!printerName) {
    throw new Error('No hay impresora configurada. Configura tu impresora en el POS.');
  }

  const name = productName.trim();

  // Date string in Mexico format
  const now = new Date();
  const dateStr = now.toLocaleDateString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'America/Mexico_City',
  });

  // Build one label's ESC/POS commands
  const buildOne = (): string[] => {
    const c: string[] = [];
    c.push(INIT);
    c.push(LF);

    // Header: brand
    c.push(CENTER + BOLD_ON + DOUBLE_SIZE);
    c.push('CAT CORN' + LF);
    c.push(NORMAL_SIZE + BOLD_OFF);
    c.push('-'.repeat(LINE_W) + LF);

    // Product name (centered, bold, auto-wrap)
    c.push(CENTER + BOLD_ON);
    for (let i = 0; i < name.length; i += LINE_W) {
      c.push(name.slice(i, i + LINE_W) + LF);
    }
    c.push(BOLD_OFF);
    c.push('-'.repeat(LINE_W) + LF);

    // Price (large)
    c.push(CENTER + BOLD_ON + DOUBLE_SIZE);
    c.push('$' + price.toFixed(2) + LF);
    c.push(NORMAL_SIZE + BOLD_OFF);

    // Tag line
    c.push(CENTER);
    c.push('Venta generica' + LF);

    // Date
    c.push(dateStr + LF);

    // Footer
    c.push(LF + LF + LF);
    c.push(CUT);

    return c;
  };

  const allCmds: string[] = [];
  for (let i = 0; i < quantity; i++) {
    allCmds.push(...buildOne());
  }

  console.info(TAG, `🏷️ Etiqueta genérica × ${quantity} → "${name}" $${price} en "${printerName}"`);
  await printRaw(printerName, allCmds);
  console.info(TAG, `✅ ${quantity} etiqueta(s) genérica(s) impresa(s) — ${name}`);
}
