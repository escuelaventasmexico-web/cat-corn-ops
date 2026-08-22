/**
 * ESC/POS receipt builders for Commercial Partner printing.
 * 
 * Reuses constants and helpers from printReceipt.ts:
 * - LINE_W = 32 chars (58mm thermal)
 * - ESC/POS commands (INIT, CENTER, BOLD, DOUBLE_SIZE, LF, CUT)
 * - Formatting functions (padR, padL, escRow, divider)
 * 
 * Exports:
 * - buildComodatoDeliveryReceipt() → ESC/POS string[] for delivery
 * - buildCurrentStockReceipt() → ESC/POS string[] for stock
 * - buildMayoreoOrderReceipt() → ESC/POS string[] for mayoreo order
 */

import type { CommercialPartnerPrintData } from '../services/commercialPartnerPrintService';

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

// ─── Helpers (copied from printReceipt.ts) ───────────────────────────

/**
 * Pad / truncate a left-aligned string to `w` chars.
 */
function padR(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
}

/**
 * Right-align a string to `w` chars.
 */
function padL(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : ' '.repeat(w - s.length) + s;
}

/**
 * Two-column row: label left, value right.
 */
function escRow(label: string, value: string): string {
  const valW = Math.max(value.length, 10);
  const labW = LINE_W - valW;
  return padR(label, labW) + padL(value, valW) + LF;
}

/**
 * Dashed separator line.
 */
function divider(): string {
  return '-'.repeat(LINE_W) + LF;
}

/**
 * Format date as DD/MM/YYYY (Spanish locale).
 */
function fmtDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Format time as HH:MM (24-hour format).
 */
function fmtTime(date: Date): string {
  return date.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ─── ESC/POS Receipt Builders ────────────────────────────────────────

/**
 * Build ESC/POS commands for a Comodato delivery receipt.
 * 
 * Sections:
 * 1. Header: CAT CORN / SOCIOS COMERCIALES
 * 2. Meta: Fecha, Hora, Socio, Folio, Responsable, Modalidad
 * 3. Divider
 * 4. COMPROBANTE DE ENTREGA section with items (product, quantity, price)
 * 5. Totals: Total piezas, Total valor Cat Corn
 * 6. Firma line
 * 7. Footer + cut
 */
export function buildComodatoDeliveryReceipt(data: CommercialPartnerPrintData): string[] {
  const cmds: string[] = [];
  
  // ── Initialize ──
  cmds.push(INIT);

  // ── Header ──
  cmds.push(CENTER + BOLD_ON + DOUBLE_SIZE);
  cmds.push('CAT CORN' + LF);
  cmds.push(NORMAL_SIZE + BOLD_OFF);
  cmds.push('SOCIOS COMERCIALES' + LF);
  cmds.push(LEFT + LF);

  // ── Print Date/Time ──
  const printTimeStr = fmtTime(data.printDate);
  const printDateStr = data.printDate.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  cmds.push(escRow('Fecha impresión:', printDateStr));
  cmds.push(escRow('Hora:', printTimeStr));

  // ── Partner Info ──
  cmds.push(divider());
  cmds.push(BOLD_ON + 'SOCIO COMERCIAL' + BOLD_OFF + LF);
  cmds.push(escRow('Socio:', data.partner.business_name.slice(0, LINE_W - 8)));
  cmds.push(escRow('Folio:', data.partner.folio));
  cmds.push(escRow('Responsable:', data.partner.responsible_name.slice(0, LINE_W - 14)));
  cmds.push(escRow('Modalidad:', data.partner.partner_model));

  // ── Divider before movement details ──
  cmds.push(divider());

  // ── Movement Info ──
  if (data.comodato?.movement) {
    cmds.push(BOLD_ON + 'COMPROBANTE DE ENTREGA' + BOLD_OFF + LF);
    const movDateStr = fmtDate(data.comodato.movement.movement_date);
    cmds.push(escRow('Fecha:', movDateStr));
    cmds.push(LF);
  }

  // ── Items ──
  if (data.comodato?.items && data.comodato.items.length > 0) {
    let totalPiezas = 0;
    let totalValor = 0;

    for (const item of data.comodato.items) {
      const quantity = item.quantity_delivered ?? 0;
      const price = item.price_to_catcorn ?? 0;
      const lineValue = quantity * price;

      totalPiezas += quantity;
      totalValor += lineValue;

      // Product name (truncate to fit)
      let productLine = item.product_name;
      if (item.product_variant) {
        productLine += ` — ${item.product_variant}`;
      }
      if (item.product_size) {
        productLine += ` ${item.product_size}`;
      }
      cmds.push(BOLD_ON + productLine.slice(0, LINE_W) + BOLD_OFF + LF);

      // Quantity x Price = Total
      const qtyStr = `${quantity} piezas`;
      cmds.push(escRow(qtyStr, `$${lineValue.toFixed(0)}`));
    }

    // Divider before totals
    cmds.push(divider());

    // Totals
    cmds.push(BOLD_ON);
    cmds.push(escRow('Total piezas:', `${totalPiezas}`));
    cmds.push(escRow('Valor Cat Corn:', `$${totalValor.toFixed(0)}`));
    cmds.push(BOLD_OFF);
  }

  // ── Signature section ──
  cmds.push(divider());
  cmds.push('Firma vendedor' + LF);
  cmds.push('_' + '_'.repeat(LINE_W - 2) + LF);
  cmds.push(LF);
  cmds.push('Firma socio comercial' + LF);
  cmds.push('_' + '_'.repeat(LINE_W - 2) + LF);

  // ── Footer ──
  cmds.push(LF);
  cmds.push(CENTER);
  cmds.push('Cat Corn' + LF);
  cmds.push('Socios Comerciales' + LF);
  cmds.push(LEFT);

  // Feed + cut
  cmds.push(LF + LF + LF + LF);
  cmds.push(CUT);

  return cmds;
}

/**
 * Build ESC/POS commands for a current stock receipt (Existencia Actual).
 * 
 * Shows the COMPLETE CYCLE:
 * 1. Last delivery date & quantity
 * 2. Pieces sold/liquidated AFTER delivery
 * 3. Pieces spoiled (merma)
 * 4. Pieces withdrawn (retiro)
 * 5. Pieces currently in possession
 * 6. Pieces with pending balance
 * 7. Total value in hand
 * 8. Total generated
 * 9. Total paid
 * 10. Total pending
 * 11. Cuadre de piezas (validation)
 */
export function buildCurrentStockReceipt(data: CommercialPartnerPrintData): string[] {
  const cmds: string[] = [];
  
  // ── Initialize ──
  cmds.push(INIT);

  // ── Header ──
  cmds.push(CENTER + BOLD_ON + DOUBLE_SIZE);
  cmds.push('CAT CORN' + LF);
  cmds.push(NORMAL_SIZE + BOLD_OFF);
  cmds.push('SOCIOS COMERCIALES' + LF);
  cmds.push(LEFT + LF);

  // ── Print Date/Time ──
  const printTimeStr = fmtTime(data.printDate);
  const printDateStr = data.printDate.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  cmds.push(escRow('Fecha:', printDateStr));
  cmds.push(escRow('Hora:', printTimeStr));

  // ── Partner Info ──
  cmds.push(divider());
  cmds.push(BOLD_ON + 'SOCIO COMERCIAL' + BOLD_OFF + LF);
  cmds.push(escRow('Socio:', data.partner.business_name.slice(0, LINE_W - 8)));
  cmds.push(escRow('Folio:', data.partner.folio));
  cmds.push(escRow('Responsable:', data.partner.responsible_name.slice(0, LINE_W - 14)));
  cmds.push(escRow('Modalidad:', data.partner.partner_model));

  // ─────────────────────────────────────────────────────────
  // SECTION 1: ÚLTIMA ENTREGA (Last Delivery)
  // ─────────────────────────────────────────────────────────
  if (data.lastDelivery) {
    cmds.push(divider());
    cmds.push(BOLD_ON + 'ÚLTIMA ENTREGA' + BOLD_OFF + LF);
    cmds.push(escRow('Fecha:', fmtDate(data.lastDelivery.movement_date)));
    cmds.push(escRow('Piezas entregadas:', `${data.lastDelivery.quantity_delivered}`));
  }

  // ─────────────────────────────────────────────────────────
  // SECTION 2: ESTADO DE LA ÚLTIMA ENTREGA (Movement Cycle Summary)
  // ─────────────────────────────────────────────────────────
  cmds.push(divider());
  cmds.push(BOLD_ON + 'ESTADO DE LA ÚLTIMA ENTREGA' + BOLD_OFF + LF);

  const cycleData = data.movementCycle;
  if (cycleData) {
    // Line 1: Vendidas / Liquidadas
    cmds.push(escRow(
      'Vendidas / liquidadas:',
      `${cycleData.settlements.total_sold} piezas`
    ));

    // Line 2: Merma
    cmds.push(escRow(
      'Merma:',
      `${cycleData.spoilage.total} piezas`
    ));

    // Line 3: Retiradas
    cmds.push(escRow(
      'Retiradas:',
      `${cycleData.withdrawal.total} piezas`
    ));
  }

  // Line 4: En posesión actualmente
  let totalEnPosesion = 0;
  if (data.currentStock?.items) {
    totalEnPosesion = data.currentStock.items.reduce(
      (sum, item) => sum + (item.current_quantity ?? 0),
      0
    );
  }
  cmds.push(escRow(
    'En posesión actualmente:',
    `${totalEnPosesion} piezas`
  ));

  // ─────────────────────────────────────────────────────────
  // SECTION 3: EXISTENCIA ACTUAL EN POSESIÓN (Current Stock Items)
  // ─────────────────────────────────────────────────────────
  cmds.push(divider());
  cmds.push(BOLD_ON + 'EXISTENCIA ACTUAL' + BOLD_OFF + LF);
  cmds.push('EN POSESIÓN' + LF);

  if (data.currentStock?.items && data.currentStock.items.length > 0) {
    let totalPiezas = 0;
    let totalValor = 0;

    for (const item of data.currentStock.items) {
      const quantity = item.current_quantity ?? 0;
      const price = item.last_price_to_catcorn ?? 0;
      const lineValue = quantity * price;

      totalPiezas += quantity;
      totalValor += lineValue;

      // Product name
      let productLine = item.product_name;
      if (item.product_variant) {
        productLine += ` — ${item.product_variant}`;
      }
      if (item.product_size) {
        productLine += ` ${item.product_size}`;
      }
      cmds.push(LF + BOLD_ON + productLine.slice(0, LINE_W) + BOLD_OFF + LF);
      cmds.push(escRow(`${quantity} piezas`, `$${lineValue.toFixed(2)}`));
    }

    cmds.push(divider());
    cmds.push(BOLD_ON);
    cmds.push(escRow('Total en posesión:', `${totalPiezas} piezas`));
    cmds.push(escRow('Valor Cat Corn:', `$${totalValor.toFixed(2)}`));
    cmds.push(BOLD_OFF);
  } else {
    cmds.push('Existencia actual: 0 piezas' + LF);
    cmds.push(divider());
  }

  // ─────────────────────────────────────────────────────────
  // SECTION 4: DETALLE (Detail breakdown per product)
  // ─────────────────────────────────────────────────────────
  if (data.lastDeliveryItems && data.lastDeliveryItems.length > 0) {
    cmds.push(LF);
    cmds.push(BOLD_ON + 'DETALLE' + BOLD_OFF + LF);

    // Create a map of product key to (delivered, sold, spoiled, withdrawn, inStock)
    const productMap = new Map<string, {
      product_name: string;
      product_variant?: string;
      product_size?: string;
      delivered: number;
      sold: number;
      spoiled: number;
      withdrawn: number;
      inStock: number;
    }>();

    // Initialize with delivery items
    for (const item of data.lastDeliveryItems) {
      const key = `${item.product_name}|${item.product_variant ?? ''}|${item.product_size ?? ''}`;
      productMap.set(key, {
        product_name: item.product_name,
        product_variant: item.product_variant,
        product_size: item.product_size,
        delivered: item.quantity_delivered,
        sold: 0,
        spoiled: 0,
        withdrawn: 0,
        inStock: 0,
      });
    }

    // Add settlement data (sold)
    if (cycleData?.settlements.items) {
      for (const item of cycleData.settlements.items) {
        const key = `${item.product_name}|${item.product_variant ?? ''}|${item.product_size ?? ''}`;
        const existing = productMap.get(key);
        if (existing) {
          existing.sold += item.quantity;
        }
      }
    }

    // Add spoilage data
    if (cycleData?.spoilage.items) {
      for (const item of cycleData.spoilage.items) {
        const key = `${item.product_name}|${item.product_variant ?? ''}|${item.product_size ?? ''}`;
        const existing = productMap.get(key);
        if (existing) {
          existing.spoiled += item.quantity;
        }
      }
    }

    // Add withdrawal data
    if (cycleData?.withdrawal.items) {
      for (const item of cycleData.withdrawal.items) {
        const key = `${item.product_name}|${item.product_variant ?? ''}|${item.product_size ?? ''}`;
        const existing = productMap.get(key);
        if (existing) {
          existing.withdrawn += item.quantity;
        }
      }
    }

    // Add current stock data
    if (data.currentStock?.items) {
      for (const item of data.currentStock.items) {
        const key = `${item.product_name}|${item.product_variant ?? ''}|${item.product_size ?? ''}`;
        const existing = productMap.get(key);
        if (existing) {
          existing.inStock = item.current_quantity ?? 0;
        }
      }
    }

    // Render detail table
    for (const prod of Array.from(productMap.values())) {
      let prodLine = prod.product_name;
      if (prod.product_variant) {
        prodLine += ` — ${prod.product_variant}`;
      }
      if (prod.product_size) {
        prodLine += ` (${prod.product_size})`;
      }
      cmds.push(LF + BOLD_ON + prodLine.slice(0, LINE_W) + BOLD_OFF + LF);
      cmds.push(escRow('Entregado:', `${prod.delivered}`));
      cmds.push(escRow('Liquidado:', `${prod.sold}`));
      cmds.push(escRow('Merma:', `${prod.spoiled}`));
      cmds.push(escRow('Retiro:', `${prod.withdrawn}`));
      cmds.push(escRow('En posesión:', `${prod.inStock}`));
    }
  }

  // ─────────────────────────────────────────────────────────
  // SECTION 5: COBRANZA (Payment Summary)
  // ─────────────────────────────────────────────────────────
  cmds.push(divider());
  cmds.push(BOLD_ON + 'COBRANZA' + BOLD_OFF + LF);

  if (data.financialSummary) {
    // Pieces with pending balance
    cmds.push('Piezas en liquidaciones' + LF);
    cmds.push('con saldo pendiente:' + LF);
    cmds.push(escRow('', `${data.financialSummary.piecesWithPendingBalance}`));
    cmds.push(LF);

    // Financial totals
    cmds.push(BOLD_ON);
    cmds.push(escRow('Total generado:', `$${data.financialSummary.total_generated.toFixed(2)}`));
    cmds.push(escRow('Total cobrado:', `$${data.financialSummary.total_paid.toFixed(2)}`));
    cmds.push(NORMAL_SIZE);
    cmds.push(divider());
    cmds.push(DOUBLE_SIZE + BOLD_ON);
    cmds.push('PENDIENTE POR COBRAR:' + LF);
    cmds.push(`$${data.financialSummary.pending_balance.toFixed(2)}` + LF);
    cmds.push(NORMAL_SIZE + BOLD_OFF);
  }

  // ── Signature section ──
  cmds.push(divider());
  cmds.push('Firma vendedor' + LF);
  cmds.push('_' + '_'.repeat(LINE_W - 2) + LF);
  cmds.push(LF);
  cmds.push('Firma socio comercial' + LF);
  cmds.push('Nombre: ' + padR(data.partner.responsible_name, LINE_W - 8) + LF);
  cmds.push('_' + '_'.repeat(LINE_W - 2) + LF);

  // ── Footer ──
  cmds.push(LF);
  cmds.push(CENTER);
  cmds.push('Cat Corn' + LF);
  cmds.push('Socios Comerciales' + LF);
  cmds.push(LEFT);

  // Feed + cut
  cmds.push(LF + LF + LF + LF);
  cmds.push(CUT);

  return cmds;
}

/**
 * Build ESC/POS commands for a mayoreo order receipt.
 * 
 * Sections:
 * 1. Header: CAT CORN / SOCIOS COMERCIALES
 * 2. Meta: Fecha, Hora, Socio, Folio, Responsable, Modalidad
 * 3. PEDIDO MAYOREO section with items (product, quantity, unit price, subtotal)
 * 4. Totals: Total piezas, Total valor
 * 5. Firma line
 * 6. Footer + cut
 */
export function buildMayoreoOrderReceipt(data: CommercialPartnerPrintData): string[] {
  const cmds: string[] = [];
  
  // ── Initialize ──
  cmds.push(INIT);

  // ── Header ──
  cmds.push(CENTER + BOLD_ON + DOUBLE_SIZE);
  cmds.push('CAT CORN' + LF);
  cmds.push(NORMAL_SIZE + BOLD_OFF);
  cmds.push('SOCIOS COMERCIALES' + LF);
  cmds.push(LEFT + LF);

  // ── Print Date/Time ──
  const printTimeStr = fmtTime(data.printDate);
  const printDateStr = data.printDate.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  cmds.push(escRow('Fecha impresión:', printDateStr));
  cmds.push(escRow('Hora:', printTimeStr));

  // ── Partner Info ──
  cmds.push(divider());
  cmds.push(BOLD_ON + 'SOCIO COMERCIAL' + BOLD_OFF + LF);
  cmds.push(escRow('Socio:', data.partner.business_name.slice(0, LINE_W - 8)));
  cmds.push(escRow('Folio:', data.partner.folio));
  cmds.push(escRow('Responsable:', data.partner.responsible_name.slice(0, LINE_W - 14)));
  cmds.push(escRow('Modalidad:', data.partner.partner_model));

  // ── Divider before order details ──
  cmds.push(divider());

  // ── Order Info ──
  if (data.mayoreo?.order) {
    cmds.push(BOLD_ON + 'PEDIDO MAYOREO' + BOLD_OFF + LF);
    const orderDateStr = fmtDate(data.mayoreo.order.order_date);
    cmds.push(escRow('Fecha pedido:', orderDateStr));
    if (data.mayoreo.order.folio) {
      cmds.push(escRow('Folio:', data.mayoreo.order.folio));
    }
    cmds.push(LF);
  }

  // ── Items ──
  if (data.mayoreo?.items && data.mayoreo.items.length > 0) {
    let totalPiezas = 0;
    let totalValor = 0;

    for (const item of data.mayoreo.items) {
      const quantity = item.quantity ?? 0;
      const unitPrice = item.unit_price ?? 0;
      const lineValue = quantity * unitPrice;

      totalPiezas += quantity;
      totalValor += lineValue;

      // Product name
      let productLine = item.product_name;
      if (item.product_variant) {
        productLine += ` — ${item.product_variant}`;
      }
      if (item.product_size) {
        productLine += ` ${item.product_size}`;
      }
      cmds.push(BOLD_ON + productLine.slice(0, LINE_W) + BOLD_OFF + LF);

      // Quantity x Unit Price = Total
      const qtyStr = `${quantity} piezas`;
      cmds.push(escRow(qtyStr, `$${lineValue.toFixed(0)}`));
    }

    // Divider before totals
    cmds.push(divider());

    // Totals
    cmds.push(BOLD_ON);
    cmds.push(escRow('Total piezas:', `${totalPiezas}`));
    cmds.push(escRow('Valor total:', `$${totalValor.toFixed(0)}`));
    cmds.push(BOLD_OFF);
  }

  // ── Signature section ──
  cmds.push(divider());
  cmds.push('Firma vendedor' + LF);
  cmds.push('_' + '_'.repeat(LINE_W - 2) + LF);
  cmds.push(LF);
  cmds.push('Firma socio comercial' + LF);
  cmds.push('_' + '_'.repeat(LINE_W - 2) + LF);

  // ── Footer ──
  cmds.push(LF);
  cmds.push(CENTER);
  cmds.push('Cat Corn' + LF);
  cmds.push('Socios Comerciales' + LF);
  cmds.push(LEFT);

  // Feed + cut
  cmds.push(LF + LF + LF + LF);
  cmds.push(CUT);

  return cmds;
}

/**
 * Convert ESC/POS command array to human-readable text preview.
 * Used for preview modal before printing.
 */
export function escPosToTextPreview(cmds: string[]): string {
  let text = '';
  let centered = false;

  for (const cmd of cmds) {
    if (cmd === CENTER) {
      centered = true;
    } else if (cmd === LEFT) {
      centered = false;
    } else if (cmd === BOLD_ON) {
      // bold = true;
    } else if (cmd === BOLD_OFF) {
      // bold = false;
    } else if (cmd === DOUBLE_SIZE) {
      // doubleSize = true;
    } else if (cmd === NORMAL_SIZE) {
      // doubleSize = false;
    } else if (cmd === LF) {
      text += '\n';
    } else if (cmd.includes('—') || cmd.includes('-') || cmd.match(/^-+$/)) {
      // Separator or product line
      text += cmd;
    } else if (cmd.length > 0 && !cmd.includes('\x1B') && !cmd.includes('\x1D')) {
      // Regular text content
      if (centered) {
        text += '  ' + cmd + '\n';
      } else {
        text += cmd;
      }
    }
  }

  return text;
}
