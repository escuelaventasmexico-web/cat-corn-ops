import { supabase } from '../supabase';

/**
 * Represents a single commercial collection item
 */
export interface CommercialCollectionItem {
  id: string;
  source_type: 'comodato' | 'mayoreo' | 'venta_pieza';
  payment_date: string;
  amount: number;
  payment_method: 'cash' | 'transfer';
  partner_id?: string;
  seller_id?: string;
  reference?: string;
}

/**
 * Aggregated commercial collections summary
 */
export interface CommercialCollections {
  total: number;
  cash: number;
  transfer: number;
  bySource: {
    comodato: number;
    mayoreo: number;
    pieceSale: number;
  };
  breakdown: CommercialCollectionItem[];
  error?: string;
}

/**
 * Get commercial collections (confirmed payments from partners) within a date range
 * Includes ONLY confirmed payments:
 * - Comodato: commercial_partner_payments with status in (completed, paid)
 * - Mayoreo: wholesale_payments with status in (completed, paid)
 * - Venta Pieza: seller_piece_payments with status='completed'
 *
 * If ANY source fails, returns error. No partial totals.
 *
 * @param startDate Start date (inclusive) in UTC
 * @param endDate End date (inclusive) in UTC
 * @returns CommercialCollections object with totals and breakdown
 */
export async function getCommercialCollections(
  startDate: Date,
  endDate: Date
): Promise<CommercialCollections> {
  const result: CommercialCollections = {
    total: 0,
    cash: 0,
    transfer: 0,
    bySource: {
      comodato: 0,
      mayoreo: 0,
      pieceSale: 0,
    },
    breakdown: [],
  };

  if (!supabase) {
    result.error = 'Supabase no configurado';
    return result;
  }

  try {
    // Convert dates to ISO strings for comparison
    // Payment dates are stored as calendar dates in UTC (e.g., 2026-08-07T00:00:00.000Z)
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    let comodatoTotal = 0;
    let mayoreoTotal = 0;
    let pieceSaleTotal = 0;
    let comodatoError: any = null;
    let mayoreoError: any = null;
    let pieceSaleError: any = null;

    // ===================================================================
    // 1. COMODATO: commercial_partner_payments
    // ===================================================================
    const { data: comodatoPayments, error: comodatoErr } = await supabase
      .from('commercial_partner_payments')
      .select('id, partner_id, payment_date, amount, payment_method')
      .in('status', ['completed', 'paid'])
      .gte('payment_date', startISO)
      .lte('payment_date', endISO);

    if (comodatoErr) {
      comodatoError = comodatoErr;
      console.error('Error loading comodato payments:', comodatoErr);
    } else if (comodatoPayments) {
      for (const payment of comodatoPayments) {
        const amount = Number(payment.amount) || 0;
        const method = (payment.payment_method || '').toLowerCase() as 'cash' | 'transfer';

        comodatoTotal += amount;
        result.bySource.comodato += amount;

        if (method === 'cash') {
          result.cash += amount;
        } else if (method === 'transfer') {
          result.transfer += amount;
        }

        result.breakdown.push({
          id: payment.id,
          source_type: 'comodato',
          payment_date: payment.payment_date,
          amount,
          payment_method: method,
          partner_id: payment.partner_id,
        });
      }
    }

    // ===================================================================
    // 2. MAYOREO: wholesale_payments
    // ===================================================================
    const { data: mayoreoPayments, error: mayoreoErr } = await supabase
      .from('wholesale_payments')
      .select('id, partner_id, payment_date, amount, payment_method')
      .in('status', ['completed', 'paid'])
      .gte('payment_date', startISO)
      .lte('payment_date', endISO);

    if (mayoreoErr) {
      mayoreoError = mayoreoErr;
      console.error('Error loading mayoreo payments:', mayoreoErr);
    } else if (mayoreoPayments) {
      for (const payment of mayoreoPayments) {
        const amount = Number(payment.amount) || 0;
        const method = (payment.payment_method || '').toLowerCase() as 'cash' | 'transfer';

        mayoreoTotal += amount;
        result.bySource.mayoreo += amount;

        if (method === 'cash') {
          result.cash += amount;
        } else if (method === 'transfer') {
          result.transfer += amount;
        }

        result.breakdown.push({
          id: payment.id,
          source_type: 'mayoreo',
          payment_date: payment.payment_date,
          amount,
          payment_method: method,
          partner_id: payment.partner_id,
        });
      }
    }

    // ===================================================================
    // 3. VENTA POR PIEZA: seller_piece_payments (NOT verification_requests)
    //    Only status='completed' constitutes confirmed payment
    // ===================================================================
    const { data: pieceSalePayments, error: pieceSaleErr } = await supabase
      .from('seller_piece_payments')
      .select('id, seller_id, payment_date, amount, payment_method')
      .eq('status', 'completed')
      .gte('payment_date', startISO)
      .lte('payment_date', endISO);

    if (pieceSaleErr) {
      pieceSaleError = pieceSaleErr;
      console.error('Error loading piece sale payments:', pieceSaleErr);
    } else if (pieceSalePayments) {
      for (const payment of pieceSalePayments) {
        const amount = Number(payment.amount) || 0;
        const method = (payment.payment_method || '').toLowerCase() as 'cash' | 'transfer';

        pieceSaleTotal += amount;
        result.bySource.pieceSale += amount;

        if (method === 'cash') {
          result.cash += amount;
        } else if (method === 'transfer') {
          result.transfer += amount;
        }

        result.breakdown.push({
          id: payment.id,
          source_type: 'venta_pieza',
          payment_date: payment.payment_date,
          amount,
          payment_method: method,
          seller_id: payment.seller_id,
        });
      }
    }

    // Check if ANY source failed - if so, return error (NO PARTIAL TOTALS)
    if (comodatoError || mayoreoError || pieceSaleError) {
      const failedSources: string[] = [];
      if (comodatoError) failedSources.push('commercial_partner_payments');
      if (mayoreoError) failedSources.push('wholesale_payments');
      if (pieceSaleError) failedSources.push('seller_piece_payments');

      result.error = `No se pudieron cargar todos los cobros de Socios Comerciales. Fuentes fallidas: ${failedSources.join(', ')}`;
      result.total = 0;
      result.cash = 0;
      result.transfer = 0;
      result.bySource = { comodato: 0, mayoreo: 0, pieceSale: 0 };
      result.breakdown = [];
      return result;
    }

    // All sources succeeded - calculate totals
    result.total = comodatoTotal + mayoreoTotal + pieceSaleTotal;

    // Round all money values to 2 decimals
    result.total = Math.round(result.total * 100) / 100;
    result.cash = Math.round(result.cash * 100) / 100;
    result.transfer = Math.round(result.transfer * 100) / 100;
    result.bySource.comodato = Math.round(result.bySource.comodato * 100) / 100;
    result.bySource.mayoreo = Math.round(result.bySource.mayoreo * 100) / 100;
    result.bySource.pieceSale = Math.round(result.bySource.pieceSale * 100) / 100;
  } catch (err: any) {
    console.error('Unexpected error in getCommercialCollections:', err);
    result.error = 'No se pudieron cargar todos los cobros de Socios Comerciales.';
    result.total = 0;
    result.cash = 0;
    result.transfer = 0;
    result.bySource = { comodato: 0, mayoreo: 0, pieceSale: 0 };
    result.breakdown = [];
  }

  return result;
}

/**
 * Format a CommercialCollections object for display
 * @param collections The collections object to format
 * @returns Formatted string representation
 */
export function formatCommercialCollections(collections: CommercialCollections): string {
  if (collections.error) {
    return `Error: ${collections.error}`;
  }

  const lines = [
    `Total: $${collections.total.toFixed(2)}`,
    `  Comodato: $${collections.bySource.comodato.toFixed(2)}`,
    `  Mayoreo: $${collections.bySource.mayoreo.toFixed(2)}`,
    `  Venta Pieza: $${collections.bySource.pieceSale.toFixed(2)}`,
    `Métodos:`,
    `  Efectivo: $${collections.cash.toFixed(2)}`,
    `  Transferencia: $${collections.transfer.toFixed(2)}`,
  ];

  return lines.join('\n');
}

/**
 * Get today's commercial collections (payment_date in UTC calendar)
 * @returns CommercialCollections for today
 */
export async function getTodayCommercialCollections(): Promise<CommercialCollections> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  return getCommercialCollections(today, tomorrow);
}

/**
 * Get this month's commercial collections (payment_date in UTC calendar)
 * @returns CommercialCollections for current month
 */
export async function getMonthCommercialCollections(): Promise<CommercialCollections> {
  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));

  return getCommercialCollections(monthStart, monthEnd);
}

/**
 * Represents a summary of sales and payments for a single channel
 */
export interface SalesChannelSummary {
  generated: number;
  paid: number;
  pending: number;
  units: number;
  error?: string;
}

/**
 * Get Venta por Pieza (Piece Sales) summary for a date range
 * Calculates VENDIDO from seller_piece_sales.total_amount
 * Calculates COBRADO from seller_piece_payments.status='completed'
 * Calculates PENDIENTE as (vendido - cobrado)
 *
 * @param startDate Start date (inclusive) in UTC calendar
 * @param endDate End date (inclusive) in UTC calendar
 * @returns SalesChannelSummary with vendido, cobrado, pendiente, and piece count
 */
export async function getPieceSaleSummary(
  startDate: Date,
  endDate: Date
): Promise<SalesChannelSummary> {
  const result: SalesChannelSummary = {
    generated: 0,
    paid: 0,
    pending: 0,
    units: 0,
  };

  if (!supabase) {
    result.error = 'Supabase no configurado';
    return result;
  }

  try {
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    // ===================================================================
    // 1. VENDIDO: seller_piece_sales.total_amount (all sales in period)
    // ===================================================================
    const { data: pieceSales, error: salesErr } = await supabase
      .from('seller_piece_sales')
      .select('id, total_amount')
      .gte('sale_date', startISO)
      .lte('sale_date', endISO);

    if (salesErr) {
      console.error('Error loading piece sales:', salesErr);
      result.error = 'No se pudieron cargar las ventas por pieza';
      return result;
    }

    let vendidoTotal = 0;
    if (pieceSales) {
      for (const sale of pieceSales) {
        vendidoTotal += Number(sale.total_amount) || 0;
      }
    }

    // ===================================================================
    // 2. COBRADO: seller_piece_payments.status='completed' (confirmed payments)
    // ===================================================================
    const { data: pieceSalePayments, error: paymentsErr } = await supabase
      .from('seller_piece_payments')
      .select('id, amount')
      .eq('status', 'completed')
      .gte('payment_date', startISO)
      .lte('payment_date', endISO);

    if (paymentsErr) {
      console.error('Error loading piece sale payments:', paymentsErr);
      result.error = 'No se pudieron cargar los cobros de venta por pieza';
      return result;
    }

    let cobradoTotal = 0;
    if (pieceSalePayments) {
      for (const payment of pieceSalePayments) {
        cobradoTotal += Number(payment.amount) || 0;
      }
    }

    // ===================================================================
    // 3. PIEZAS: seller_piece_sale_items.quantity (total units in period)
    // ===================================================================
    const { data: pieceCounts, error: countErr } = await supabase
      .from('seller_piece_sale_items')
      .select('quantity')
      .gte('created_at', startISO)
      .lte('created_at', endISO);

    if (countErr) {
      console.error('Error loading piece counts:', countErr);
      result.error = 'No se pudieron cargar las cantidades de piezas';
      return result;
    }

    let piecesTotal = 0;
    if (pieceCounts) {
      for (const item of pieceCounts) {
        piecesTotal += Number(item.quantity) || 0;
      }
    }

    // ===================================================================
    // Calculate results
    // ===================================================================
    result.generated = Math.round(vendidoTotal * 100) / 100;
    result.paid = Math.round(cobradoTotal * 100) / 100;
    result.pending = Math.round((vendidoTotal - cobradoTotal) * 100) / 100;
    result.units = piecesTotal;
  } catch (err: any) {
    console.error('Unexpected error in getPieceSaleSummary:', err);
    result.error = 'No se pudieron cargar los datos de venta por pieza';
  }

  return result;
}
