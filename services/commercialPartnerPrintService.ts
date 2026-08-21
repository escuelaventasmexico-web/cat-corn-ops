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
 */
export async function getCurrentStockComodato(
  partnerId: string,
  partnerData: { folio: string; business_name: string; responsible_name: string; partner_model: string }
): Promise<CommercialPartnerPrintData | null> {
  if (!supabase) return null;
  try {
    // Fetch from view: only items currently in possession (current_quantity > 0)
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
