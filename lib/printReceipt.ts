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

    const detail = `  ${item.size}  ${item.quantity} x $${item.unitPrice.toFixed(2)}`;
    const lineTotal = item.lineTotal - (item.discount || 0);
    cmds.push(escRow(detail, '$' + lineTotal.toFixed(2)));

    if ((item.discount ?? 0) > 0) {
      cmds.push('  Desc: -$' + (item.discount ?? 0).toFixed(2) + LF);
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
