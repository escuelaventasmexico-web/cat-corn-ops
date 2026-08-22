/**
 * Print service for Commercial Partners (Comodato / Mayoreo).
 * 
 * Provides:
 * - Query functions to fetch movement/stock data for printing
 * - Type definitions for print data models
 * - Integration with existing QZ Tray + printReceipt infrastructure
 */

import { supabase } from '../supabase';
import type { PartnerMovementItem, PartnerCurrentStockItem } from '../components/commercialPartners/comodato/types';

/**
 * Print options available for commercial partners.
 * Determines which data is fetched and how ticket is formatted.
 */
export type CommercialPrintOption = 
  | 'last_delivery_comodato'
  | 'delivery_by_date_comodato'
  | 'current_stock'
  | 'last_order_mayoreo'
  | 'order_by_date_mayoreo';

/**
 * Complete data model for printing a commercial partner receipt.
 * Used as intermediate between DB queries and ESC/POS builders.
 */
export interface CommercialPartnerPrintData {
  // Partner info
  partner: {
    id: string;
    folio: string;
    business_name: string;
    responsible_name: string;
    partner_model: string;
  };

  // Print metadata
  printDate: Date;
  printOption: CommercialPrintOption;

  // Movement data (for Comodato deliveries/settlements)
  comodato?: {
    movement?: {
      id: string;
      movement_date: string;
      movement_type: string;
      status: string;
    };
    items: PartnerMovementItem[];
  };

  // Current stock (for existencia actual)
  currentStock?: {
    items: PartnerCurrentStockItem[];
  };

  // Order data (for Mayoreo)
  mayoreo?: {
    order?: {
      id: string;
      folio?: string;
      order_date: string;
      delivery_date?: string | null;
      status?: string;
    };
    items: {
      product_name: string;
      product_variant?: string | null;
      product_size?: string | null;
      quantity: number;
      unit_price: number;
    }[];
  };

  // Optional seller info (if resolvable from created_by)
  seller?: {
    name: string;
  };

  // Extended info for currentStock (Existencia Actual) - FULL CYCLE
  lastDelivery?: {
    movement_date: string;
    id: string;
    quantity_delivered: number;
  } | null;
  
  // Last delivery items (for detail section)
  lastDeliveryItems?: Array<{
    product_name: string;
    product_variant?: string;
    product_size?: string;
    quantity_delivered: number;
  }> | null;
  
  // Movement cycle after last delivery: settlements + spoilage + withdrawal
  movementCycle?: {
    settlements: {
      items: Array<{
        product_name: string;
        product_variant?: string;
        product_size?: string;
        quantity: number;
        amount_due: number;
      }>;
      total_sold: number;
      total_due: number;
    };
    spoilage: {
      items: Array<{
        product_name: string;
        product_variant?: string;
        product_size?: string;
        quantity: number;
      }>;
      total: number;
    };
    withdrawal: {
      items: Array<{
        product_name: string;
        product_variant?: string;
        product_size?: string;
        quantity: number;
      }>;
      total: number;
    };
  } | null;

  // Financial summary (for cobranza section)
  financialSummary?: {
    total_generated: number;
    total_paid: number;
    pending_balance: number;
    piecesWithPendingBalance: number; // quantity_sold from settlements with saldo
  } | null;
}

/**
 * Get the last delivery for a comodato partner.
 * 
 * Query: commercial_partner_movements (movement_type='delivery', status='completed')
 * Order by movement_date DESC, limit 1
 */
export async function getLastDeliveryComodato(
  partnerId: string,
  partnerData: { folio: string; business_name: string; responsible_name: string; partner_model: string }
): Promise<CommercialPartnerPrintData | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('commercial_partner_movements')
      .select('*, commercial_partner_movement_items(*)')
      .eq('partner_id', partnerId)
      .eq('movement_type', 'delivery')
      .eq('status', 'completed')
      .order('movement_date', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      console.error('[Print] Error fetching last delivery:', error);
      return null;
    }

    return {
      partner: {
        id: partnerId,
        folio: partnerData.folio,
        business_name: partnerData.business_name,
        responsible_name: partnerData.responsible_name,
        partner_model: partnerData.partner_model,
      },
      printDate: new Date(),
      printOption: 'last_delivery_comodato',
      comodato: {
        movement: {
          id: data.id,
          movement_date: data.movement_date,
          movement_type: data.movement_type,
          status: data.status,
        },
        items: data.commercial_partner_movement_items || [],
      },
    };
  } catch (err) {
    console.error('[Print] Exception in getLastDeliveryComodato:', err);
    return null;
  }
}

/**
 * Get all deliveries for a comodato partner on a specific date.
 * 
 * Query: commercial_partner_movements (movement_type='delivery', date match)
 * Order by movement_date DESC
 */
export async function getDeliveriesByDateComodato(
  partnerId: string,
  date: Date,
  partnerData: { folio: string; business_name: string; responsible_name: string; partner_model: string }
): Promise<CommercialPartnerPrintData[]> {
  if (!supabase) return [];
  try {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    
    const { data, error } = await supabase
      .from('commercial_partner_movements')
      .select('*, commercial_partner_movement_items(*)')
      .eq('partner_id', partnerId)
      .eq('movement_type', 'delivery')
      .gte('movement_date', dateStr)
      .lt('movement_date', new Date(date.getTime() + 86400000).toISOString().split('T')[0])
      .order('movement_date', { ascending: false });

    if (error) {
      console.error('[Print] Error fetching deliveries by date:', error);
      return [];
    }

    return (data || []).map(mov => ({
      partner: {
        id: partnerId,
        folio: partnerData.folio,
        business_name: partnerData.business_name,
        responsible_name: partnerData.responsible_name,
        partner_model: partnerData.partner_model,
      },
      printDate: new Date(),
      printOption: 'delivery_by_date_comodato',
      comodato: {
        movement: {
          id: mov.id,
          movement_date: mov.movement_date,
          movement_type: mov.movement_type,
          status: mov.status,
        },
        items: mov.commercial_partner_movement_items || [],
      },
    }));
  } catch (err) {
    console.error('[Print] Exception in getDeliveriesByDateComodato:', err);
    return [];
  }
}

/**
 * Get current stock for a partner.
 * 
 * Query: v_commercial_partner_current_stock
 * Shows what the partner has in possession now (current_quantity > 0).
 * NO date filter - this is a STATE, not a historical movement.
 * 
 * EXTENDED: Also fetches last delivery date, merma/withdrawal, and financial summary.
 */
export async function getCurrentStockComodato(
  partnerId: string,
  partnerData: { folio: string; business_name: string; responsible_name: string; partner_model: string }
): Promise<CommercialPartnerPrintData | null> {
  if (!supabase) return null;
  try {
    // 1. Fetch current stock items
    const { data, error } = await supabase
      .from('v_commercial_partner_current_stock')
      .select('*')
      .eq('partner_id', partnerId)
      .gt('current_quantity', 0)
      .order('product_name', { ascending: true });

    if (error) {
      console.error('[Print] Error fetching current stock:', error);
      return null;
    }

    const items = (data || []) as PartnerCurrentStockItem[];

    // 2. Fetch last delivery (with items and quantity)
    const lastDelivery = await getLastDeliveryDateComodato(partnerId);

    // 3. Fetch complete movement cycle after last delivery
    const movementCycle = await getMovementsCycleAfterLastDelivery(
      partnerId,
      lastDelivery?.movement_date
    );

    // 4. Fetch financial summary (in parallel)
    const financialSummary = await getComodatoFinancialSummary(partnerId);

    return {
      partner: {
        id: partnerId,
        folio: partnerData.folio,
        business_name: partnerData.business_name,
        responsible_name: partnerData.responsible_name,
        partner_model: partnerData.partner_model,
      },
      printDate: new Date(),
      printOption: 'current_stock',
      currentStock: {
        items,
      },
      lastDelivery: lastDelivery ? {
        movement_date: lastDelivery.movement_date,
        id: lastDelivery.id,
        quantity_delivered: lastDelivery.quantity_delivered,
      } : null,
      lastDeliveryItems: lastDelivery?.items?.map(item => ({
        product_name: item.product_name,
        product_variant: item.product_variant,
        product_size: item.product_size,
        quantity_delivered: item.quantity_delivered,
      })) || null,
      movementCycle: movementCycle || null,
      financialSummary: financialSummary || null,
    };
  } catch (err) {
    console.error('[Print] Exception in getCurrentStockComodato:', err);
    return null;
  }
}

/**
 * Get the last order for a mayoreo partner.
 * 
 * Query: wholesale_orders (partner_id, order_status='delivered')
 * Order by order_date DESC, then created_at DESC, limit 1
 * Joins: wholesale_order_items (with historical unit_price)
 * 
 * IMPORTANT: Uses wholesale_order_items.unit_price (historical),
 * NOT wholesale_price_catalog (which applies only to new orders).
 */
export async function getLastOrderMayoreo(
  partnerId: string,
  partnerData: { folio: string; business_name: string; responsible_name: string; partner_model: string }
): Promise<CommercialPartnerPrintData | null> {
  if (!supabase) return null;
  try {
    // Fetch last delivered wholesale order with its items
    const { data, error } = await supabase
      .from('wholesale_orders')
      .select('*, wholesale_order_items(*)')
      .eq('partner_id', partnerId)
      .eq('order_status', 'delivered')
      .order('order_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      console.error('[Print] Error fetching last mayoreo order:', error);
      return null;
    }

    return {
      partner: {
        id: partnerId,
        folio: partnerData.folio,
        business_name: partnerData.business_name,
        responsible_name: partnerData.responsible_name,
        partner_model: partnerData.partner_model,
      },
      printDate: new Date(),
      printOption: 'last_order_mayoreo',
      mayoreo: {
        order: {
          id: data.id,
          folio: data.folio,
          order_date: data.order_date,
          delivery_date: data.delivery_date,
          status: data.order_status,
        },
        items: (data.wholesale_order_items || []).map((item: any) => ({
          product_name: item.product_name,
          product_variant: item.product_variant,
          product_size: item.product_size,
          quantity: item.quantity,
          unit_price: item.unit_price, // ← Historical price from order, NOT from catalog
        })),
      },
    };
  } catch (err) {
    console.error('[Print] Exception in getLastOrderMayoreo:', err);
    return null;
  }
}

/**
 * Get all orders for a mayoreo partner on a specific date.
 * 
 * Query: wholesale_orders (partner_id, order_date match, order_status='delivered')
 * Order by order_date DESC, created_at DESC
 */
export async function getOrdersByDateMayoreo(
  partnerId: string,
  date: Date,
  partnerData: { folio: string; business_name: string; responsible_name: string; partner_model: string }
): Promise<CommercialPartnerPrintData[]> {
  if (!supabase) return [];
  try {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const nextDateStr = new Date(date.getTime() + 86400000).toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('wholesale_orders')
      .select('*, wholesale_order_items(*)')
      .eq('partner_id', partnerId)
      .eq('order_status', 'delivered')
      .gte('order_date', dateStr)
      .lt('order_date', nextDateStr)
      .order('order_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Print] Error fetching mayoreo orders by date:', error);
      return [];
    }

    return (data || []).map(order => ({
      partner: {
        id: partnerId,
        folio: partnerData.folio,
        business_name: partnerData.business_name,
        responsible_name: partnerData.responsible_name,
        partner_model: partnerData.partner_model,
      },
      printDate: new Date(),
      printOption: 'order_by_date_mayoreo',
      mayoreo: {
        order: {
          id: order.id,
          folio: order.folio,
          order_date: order.order_date,
          delivery_date: order.delivery_date,
          status: order.order_status,
        },
        items: (order.wholesale_order_items || []).map((item: any) => ({
          product_name: item.product_name,
          product_variant: item.product_variant,
          product_size: item.product_size,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
      },
    }));
  } catch (err) {
    console.error('[Print] Exception in getOrdersByDateMayoreo:', err);
    return [];
  }
}

/**
 * Get the last delivery for a comodato partner (for CurrentStock receipt).
 * Returns date, id, and total quantity delivered.
 */
export async function getLastDeliveryDateComodato(partnerId: string) {
  if (!supabase) return null;
  try {
    const { data: movement, error } = await supabase
      .from('commercial_partner_movements')
      .select('id, movement_date, commercial_partner_movement_items(*)')
      .eq('partner_id', partnerId)
      .eq('movement_type', 'delivery')
      .eq('status', 'completed')
      .order('movement_date', { ascending: false })
      .limit(1)
      .single();

    if (error || !movement) {
      console.log('[Print] No last delivery found:', error?.message);
      return null;
    }

    // Calculate total quantity delivered
    const totalDelivered = (movement.commercial_partner_movement_items || [])
      .reduce((sum: number, item: any) => sum + (item.quantity_delivered ?? 0), 0);

    return {
      id: movement.id,
      movement_date: movement.movement_date,
      quantity_delivered: totalDelivered,
      items: movement.commercial_partner_movement_items || [],
    };
  } catch (err) {
    console.error('[Print] Exception in getLastDeliveryDateComodato:', err);
    return null;
  }
}

/**
 * Get complete movement cycle AFTER last delivery:
 * - Settlements (liquidaciones): quantity_sold + amount_due
 * - Spoilage (merma): quantity_spoiled
 * - Withdrawal (retiro): quantity_withdrawn
 * 
 * IMPORTANT: Use correct field per movement_type to fix merma bug
 */
export async function getMovementsCycleAfterLastDelivery(
  partnerId: string,
  lastDeliveryDate?: string
) {
  if (!supabase) return null;
  try {
    // If no lastDeliveryDate provided, fetch it first
    let refDate = lastDeliveryDate;
    if (!refDate) {
      const lastDel = await getLastDeliveryDateComodato(partnerId);
      if (!lastDel) {
        console.log('[Print] No reference date for movements query');
        return {
          settlements: { items: [], total_sold: 0, total_due: 0 },
          spoilage: { items: [], total: 0 },
          withdrawal: { items: [], total: 0 },
        };
      }
      refDate = lastDel.movement_date;
    }

    // Query ALL movements AFTER last delivery with settlement/spoilage/withdrawal types
    const { data: movements, error: movError } = await supabase
      .from('commercial_partner_movements')
      .select('id, movement_type, commercial_partner_movement_items(*)')
      .eq('partner_id', partnerId)
      .in('movement_type', ['settlement', 'spoilage', 'withdrawal'])
      .eq('status', 'completed')
      .gte('movement_date', refDate)
      .order('movement_date', { ascending: false });

    if (movError) {
      console.error('[Print] Error fetching movement cycle:', movError);
      return {
        settlements: { items: [], total_sold: 0, total_due: 0 },
        spoilage: { items: [], total: 0 },
        withdrawal: { items: [], total: 0 },
      };
    }

    const settlementItems: Array<{
      product_name: string;
      product_variant?: string;
      product_size?: string;
      quantity: number;
      amount_due: number;
    }> = [];
    const spoilageItems: Array<{
      product_name: string;
      product_variant?: string;
      product_size?: string;
      quantity: number;
    }> = [];
    const withdrawalItems: Array<{
      product_name: string;
      product_variant?: string;
      product_size?: string;
      quantity: number;
    }> = [];

    let settlementTotalSold = 0;
    let settlementTotalDue = 0;
    let spoilageTotal = 0;
    let withdrawalTotal = 0;

    for (const mov of movements || []) {
      for (const item of mov.commercial_partner_movement_items || []) {
        if (mov.movement_type === 'settlement') {
          // For settlement: use quantity_sold and amount_due
          const qty = item.quantity_sold ?? 0;
          const due = item.amount_due ?? 0;
          
          if (qty > 0) {
            settlementItems.push({
              product_name: item.product_name ?? 'Unknown',
              product_variant: item.product_variant,
              product_size: item.product_size,
              quantity: qty,
              amount_due: due,
            });
            settlementTotalSold += qty;
            settlementTotalDue += due;
          }
        } else if (mov.movement_type === 'spoilage') {
          // For spoilage: use quantity_spoiled (FIX: was using quantity_delivered)
          const qty = item.quantity_spoiled ?? 0;
          
          if (qty > 0) {
            spoilageItems.push({
              product_name: item.product_name ?? 'Unknown',
              product_variant: item.product_variant,
              product_size: item.product_size,
              quantity: qty,
            });
            spoilageTotal += qty;
          }
        } else if (mov.movement_type === 'withdrawal') {
          // For withdrawal: use quantity_withdrawn
          const qty = item.quantity_withdrawn ?? 0;
          
          if (qty > 0) {
            withdrawalItems.push({
              product_name: item.product_name ?? 'Unknown',
              product_variant: item.product_variant,
              product_size: item.product_size,
              quantity: qty,
            });
            withdrawalTotal += qty;
          }
        }
      }
    }

    return {
      settlements: { items: settlementItems, total_sold: settlementTotalSold, total_due: settlementTotalDue },
      spoilage: { items: spoilageItems, total: spoilageTotal },
      withdrawal: { items: withdrawalItems, total: withdrawalTotal },
    };
  } catch (err) {
    console.error('[Print] Exception in getMovementsCycleAfterLastDelivery:', err);
    return {
      settlements: { items: [], total_sold: 0, total_due: 0 },
      spoilage: { items: [], total: 0 },
      withdrawal: { items: [], total: 0 },
    };
  }
}

/**
 * DEPRECATED: Use getMovementsCycleAfterLastDelivery instead
 */
export async function getMermaAndWithdrawalAfterLastDelivery(
  partnerId: string,
  lastDeliveryDate?: string
) {
  const result = await getMovementsCycleAfterLastDelivery(partnerId, lastDeliveryDate);
  if (!result) return null;
  
  return {
    spoilage: result.spoilage,
    withdrawal: result.withdrawal,
  };
}

/**
 * Get financial summary for a comodato partner.
 * Uses the existing RPC or fallback query to get:
 * - total_generated (sum of settlements with quantity_sold > 0)
 * - total_paid (sum of payments)
 * - pending_balance (total_generated - total_paid)
 */
export async function getComodatoFinancialSummary(partnerId: string) {
  if (!supabase) return null;
  try {
    let totalGenerated = 0;
    let totalPaid = 0;
    let piecesWithPendingBalance = 0;

    // Query 1: Get total generated from ALL movement items
    const { data: settlementData, error: settlementErr } = await supabase
      .from('commercial_partner_movement_items')
      .select('amount_due, quantity_sold')
      .eq('partner_id', partnerId);

    if (!settlementErr && settlementData) {
      totalGenerated = settlementData.reduce((sum, row: any) => sum + (row.amount_due ?? 0), 0);
    }

    // Query 2: Get total paid from payments
    const { data: paymentData, error: paymentErr } = await supabase
      .from('commercial_partner_payments')
      .select('amount')
      .eq('partner_id', partnerId)
      .in('status', ['completed', 'paid']);

    if (!paymentErr && paymentData) {
      totalPaid = paymentData.reduce((sum, row: any) => sum + (row.amount ?? 0), 0);
    }

    // Query 3: Get pieces from settlements that have pending balance
    // For now, we'll count quantity_sold from settlement movements with unpaid amounts
    const { data: settlementsWithPending, error: settPendErr } = await supabase
      .from('commercial_partner_movements')
      .select('id, commercial_partner_movement_items(quantity_sold, amount_due, commercial_partner_payments(amount))')
      .eq('partner_id', partnerId)
      .eq('movement_type', 'settlement')
      .eq('status', 'completed');

    if (!settPendErr && settlementsWithPending) {
      for (const mov of settlementsWithPending) {
        for (const item of mov.commercial_partner_movement_items || []) {
          const itemAmountDue = item.amount_due ?? 0;
          const itemQtySold = item.quantity_sold ?? 0;
          
          // Sum payments for this item
          const itemPaid = (item.commercial_partner_payments || [])
            .reduce((sum: number, pmt: any) => sum + (pmt.amount ?? 0), 0);
          
          // If item has pending balance, add its quantity to pieces count
          if (itemAmountDue > itemPaid) {
            piecesWithPendingBalance += itemQtySold;
          }
        }
      }
    }

    const pendingBalance = Math.max(0, totalGenerated - totalPaid);

    return {
      total_generated: totalGenerated,
      total_paid: totalPaid,
      pending_balance: pendingBalance,
      piecesWithPendingBalance: piecesWithPendingBalance,
    };
  } catch (err) {
    console.error('[Print] Exception in getComodatoFinancialSummary:', err);
    return {
      total_generated: 0,
      total_paid: 0,
      pending_balance: 0,
      piecesWithPendingBalance: 0,
    };
  }
}

/**
 * Helper: Get partner basic info for print context.
 */
export async function getPartnerForPrint(partnerId: string) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('commercial_partners')
      .select('id, folio, business_name, responsible_name, partner_model')
      .eq('id', partnerId)
      .single();

    if (error || !data) {
      console.error('[Print] Error fetching partner:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[Print] Exception in getPartnerForPrint:', err);
    return null;
  }
}
