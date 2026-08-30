import { supabase } from '../supabase';
import type { B2BBalanceDetailResponse } from '../components/commercialPartners/reports/b2bReportTypes';

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
  notes?: string;
  movement_id?: string;
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
      .select('id, partner_id, movement_id, payment_date, amount, payment_method, reference, notes')
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
          movement_id: payment.movement_id,
          reference: payment.reference,
          notes: payment.notes,
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
 * Detailed commercial collection item with enriched partner and product information
 */
export interface CommercialCollectionDetail extends CommercialCollectionItem {
  partner?: {
    id: string;
    folio?: string | null;
    business_name?: string | null;
    responsible_name?: string | null;
  } | null;

  movement?: {
    id: string;
    movement_type?: string | null;
    movement_date?: string | null;
    status?: string | null;
  } | null;

  products?: Array<{
    product_name?: string | null;
    product_variant?: string | null;
    product_size?: string | null;
    quantity_sold: number;
    price_to_catcorn: number;
    amount_due: number;
  }>;
}

/**
 * Enrich commercial collection items with partner, movement, and product details
 * Uses batch queries to avoid N+1 problem
 * NO modifications to payment amounts or dates
 *
 * @param breakdown Original breakdown array from getCommercialCollections
 * @returns Array of enriched detail items
 */
export async function getCommercialCollectionDetails(
  breakdown: CommercialCollectionItem[]
): Promise<CommercialCollectionDetail[]> {
  if (!supabase || !breakdown || breakdown.length === 0) {
    return breakdown as CommercialCollectionDetail[];
  }

  try {
    // Extract unique IDs for batch queries
    const partnerIds = Array.from(new Set(breakdown.filter(b => b.partner_id).map(b => b.partner_id!)));
    const movementIds = Array.from(new Set(breakdown.filter(b => b.movement_id).map(b => b.movement_id!)));

    // Batch queries for partners, movements, and product items
    const [partnersResult, movementsResult, itemsResult] = await Promise.all([
      partnerIds.length > 0
        ? supabase
            .from('commercial_partners')
            .select('id, folio, business_name, responsible_name')
            .in('id', partnerIds)
        : Promise.resolve({ data: [], error: null }),

      movementIds.length > 0
        ? supabase
            .from('commercial_partner_movements')
            .select('id, partner_id, movement_type, movement_date, status')
            .in('id', movementIds)
        : Promise.resolve({ data: [], error: null }),

      movementIds.length > 0
        ? supabase
            .from('commercial_partner_movement_items')
            .select('movement_id, product_name, product_variant, product_size, quantity_sold, price_to_catcorn, amount_due')
            .in('movement_id', movementIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    // Create lookup maps
    const partnersById = new Map(
      (partnersResult.data || []).map(p => [
        p.id,
        {
          id: p.id,
          folio: p.folio,
          business_name: p.business_name,
          responsible_name: p.responsible_name,
        },
      ])
    );

    const movementsById = new Map(
      (movementsResult.data || []).map(m => [
        m.id,
        {
          id: m.id,
          movement_type: m.movement_type,
          movement_date: m.movement_date,
          status: m.status,
        },
      ])
    );

    const itemsByMovementId = new Map<string, any[]>();
    (itemsResult.data || []).forEach(item => {
      const movId = item.movement_id;
      if (Number(item.quantity_sold) > 0) {
        if (!itemsByMovementId.has(movId)) {
          itemsByMovementId.set(movId, []);
        }
        itemsByMovementId.get(movId)!.push({
          product_name: item.product_name,
          product_variant: item.product_variant,
          product_size: item.product_size,
          quantity_sold: Number(item.quantity_sold),
          price_to_catcorn: Number(item.price_to_catcorn),
          amount_due: Number(item.amount_due),
        });
      }
    });

    // Enrich breakdown items
    return breakdown.map(item => {
      const detail: CommercialCollectionDetail = { ...item };

      if (item.partner_id && partnersById.has(item.partner_id)) {
        detail.partner = partnersById.get(item.partner_id) || null;
      } else if (item.partner_id) {
        detail.partner = { id: item.partner_id };
      }

      if (item.movement_id && movementsById.has(item.movement_id)) {
        detail.movement = movementsById.get(item.movement_id) || null;
        detail.products = itemsByMovementId.get(item.movement_id) || [];
      }

      return detail;
    });
  } catch (err: any) {
    console.error('Error enriching commercial collection details:', err);
    // Return original breakdown on error (graceful degradation)
    return breakdown as CommercialCollectionDetail[];
  }
}

/**
 * Represents a summary of sales and payments for a single channel
 */
export interface SalesChannelSummary {
  generated: number;
  paid: number;
  pending: number;
  units: number;
  sellers: number;
  error?: string;
}

/**
 * Get Venta por Pieza (Piece Sales) summary for a date range
 * Calculates VENDIDO from confirmed piece sales only
 * Calculates COBRADO from seller_piece_payments.status='completed'
 * Calculates PENDIENTE from actionable sales in draft or pending_review
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
    sellers: 0,
  };

  if (!supabase) {
    result.error = 'Supabase no configurado';
    return result;
  }

  try {
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    // Confirmed sales drive sold amount, units, and distinct sellers.
    // Draft and pending_review sales drive the actionable pending amount.
    const { data: pieceSales, error: salesErr } = await supabase
      .from('v_piece_sale_history')
      .select('sale_id, seller_id, total_amount, total_units, status')
      .gte('sale_date', startISO)
      .lt('sale_date', endISO)
      .in('status', ['confirmed', 'draft', 'pending_review']);

    if (salesErr) {
      console.error('Error loading piece sales:', salesErr);
      result.error = 'No se pudieron cargar las ventas por pieza';
      return result;
    }

    let confirmedTotal = 0;
    let pendingTotal = 0;
    let confirmedUnits = 0;
    const confirmedSellerIds = new Set<string>();

    for (const sale of pieceSales ?? []) {
      if (sale.status === 'confirmed') {
        confirmedTotal += Number(sale.total_amount) || 0;
        confirmedUnits += Number(sale.total_units) || 0;
        if (sale.seller_id) confirmedSellerIds.add(sale.seller_id);
      } else {
        pendingTotal += Number(sale.total_amount) || 0;
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
      .lt('payment_date', endISO);

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

    result.generated = Math.round(confirmedTotal * 100) / 100;
    result.paid = Math.round(cobradoTotal * 100) / 100;
    result.pending = Math.round(pendingTotal * 100) / 100;
    result.units = confirmedUnits;
    result.sellers = confirmedSellerIds.size;
  } catch (err: any) {
    console.error('Unexpected error in getPieceSaleSummary:', err);
    result.error = 'No se pudieron cargar los datos de venta por pieza';
  }

  return result;
}

/**
 * Get detailed B2B balance information by calling the RPC get_b2b_balance_detail
 * This returns complete data for the balance detail modal
 *
 * @param startDate Start date for Venta por Pieza period (UTC)
 * @param endDate End date for Venta por Pieza period (UTC)
 * @returns B2BBalanceDetailResponse with summary, partners, and sellers
 */
export async function getB2BBalanceDetail(
  startDate: Date,
  endDate: Date
): Promise<{ data: B2BBalanceDetailResponse | null; error: string | null }> {
  if (!supabase) {
    return {
      data: null,
      error: 'Supabase no configurado',
    };
  }

  try {
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    console.log('Calling get_b2b_balance_detail with:', {
      p_piece_start: startISO,
      p_piece_end: endISO,
    });

    const { data, error } = await supabase.rpc('get_b2b_balance_detail', {
      p_piece_start: startISO,
      p_piece_end: endISO,
    });

    if (error) {
      console.error('Error calling get_b2b_balance_detail:', error);
      return {
        data: null,
        error: error.message || 'Error al cargar detalles de saldo',
      };
    }

    if (!data) {
      console.warn('RPC returned no data');
      return {
        data: null,
        error: 'Sin datos disponibles',
      };
    }

    // Type the response
    const typedData: B2BBalanceDetailResponse = data as B2BBalanceDetailResponse;

    console.log('B2B_BALANCE_DETAIL_RPC_RESPONSE', {
      summary: typedData.summary,
      partnersCount: typedData.partners?.length ?? 0,
      sellersCount: typedData.piece_sales_by_seller?.length ?? 0,
    });

    return {
      data: typedData,
      error: null,
    };
  } catch (err: any) {
    console.error('Unexpected error in getB2BBalanceDetail:', err);
    return {
      data: null,
      error: err?.message || 'Error inesperado al cargar detalles de saldo',
    };
  }
}
