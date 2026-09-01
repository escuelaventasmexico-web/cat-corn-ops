import { supabase } from '../supabase';

export type CommercialDeliverySourceType = 'comodato' | 'mayoreo';
export type CommercialDeliveryUnitStatus =
  | 'generated' | 'printed' | 'scanned' | 'released'
  | 'returned_good' | 'spoiled' | 'voided' | 'replaced';

export interface CommercialDeliveryUnit {
  id: string;
  barcode_value: string;
  scan_code: string;
  source_type: CommercialDeliverySourceType;
  partner_id: string;
  movement_id?: string | null;
  wholesale_order_id?: string | null;
  source_item_id: string;
  product_id: string;
  product_code?: string | null;
  product_name: string;
  product_variant?: string | null;
  product_size?: string | null;
  unit_price: number;
  unit_cost?: number | null;
  status: CommercialDeliveryUnitStatus;
  generated_at: string;
  printed_at?: string | null;
  released_at?: string | null;
  returned_good_at?: string | null;
  returned_good_by?: string | null;
  return_movement_id?: string | null;
  commercial_partners?: { business_name?: string | null; responsible_name?: string | null } | null;
  print_count: number;
  last_reprint_reason?: string | null;
  void_reason?: string | null;
  commercial_partner_movements?: { status?: string | null; movement_date?: string | null } | null;
  wholesale_orders?: { order_status?: string | null; order_date?: string | null } | null;
}

export interface AdminCommercialDeliveryResult {
  source_id: string;
  source_type: CommercialDeliverySourceType;
  released_units?: number;
  previously_scanned_units?: number;
  bypassed_units?: number;
  voided_units?: number;
  released_at?: string;
  cancelled_at?: string;
  final_status: 'completed' | 'delivered' | 'cancelled';
}

interface B2BProductMappingRow {
  source_product_code: string;
  product_id: string | null;
}

interface ComodatoSourceRow {
  id: string;
  status: string | null;
  movement_date: string | null;
}

interface WholesaleSourceRow {
  id: string;
  order_status: string | null;
  order_date: string | null;
}

const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
  if (!supabase) throw new Error('Supabase no configurado');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
};

/**
 * Resolves only the explicit B2B source codes selected by the commercial
 * catalog. It deliberately does not inspect product names, POS prices or SKUs.
 */
export const resolveActiveComodatoProductIds = async (sourceProductCodes: string[]) => {
  if (!supabase) throw new Error('Supabase no configurado');

  const uniqueCodes = [...new Set(sourceProductCodes.map(code => code.trim()).filter(Boolean))];
  if (uniqueCodes.length === 0) return new Map<string, string>();

  const { data, error } = await supabase
    .from('b2b_product_mappings')
    .select('source_product_code, product_id')
    .eq('source_catalog', 'comodato')
    .eq('active', true)
    .is('valid_to', null)
    .in('source_product_code', uniqueCodes);

  if (error) throw error;

  const rowsByCode = new Map<string, B2BProductMappingRow[]>();
  for (const row of (data ?? []) as B2BProductMappingRow[]) {
    const rows = rowsByCode.get(row.source_product_code) ?? [];
    rows.push(row);
    rowsByCode.set(row.source_product_code, rows);
  }

  const resolved = new Map<string, string>();
  for (const code of uniqueCodes) {
    const matches = rowsByCode.get(code) ?? [];
    if (matches.length !== 1 || !matches[0].product_id) {
      throw new Error(`No existe una relación activa única de Comodato para el código ${code}.`);
    }
    resolved.set(code, matches[0].product_id);
  }

  return resolved;
};

export const createComodatoDeliveryWithUnits = (args: {
  partnerId: string; movementDate: string; nextVisitDate?: string; nextVisitReason?: string; notes?: string;
  items: Record<string, unknown>[];
}) => rpc<{ movement_id: string; units_generated: number }>('create_comodato_delivery_with_units', {
  p_partner_id: args.partnerId,
  p_movement_date: args.movementDate,
  p_next_visit_date: args.nextVisitDate || null,
  p_next_visit_reason: args.nextVisitReason || null,
  p_notes: args.notes || null,
  p_items: args.items,
});

export const createWholesaleOrderWithUnits = (args: {
  partnerId: string; orderDate: string; notes?: string; paymentTermsHours?: number; items: Record<string, unknown>[];
}) => rpc<{ wholesale_order_id: string; units_generated: number }>('create_wholesale_order_with_units', {
  p_partner_id: args.partnerId,
  p_order_date: args.orderDate,
  p_notes: args.notes || null,
  p_payment_terms_hours: args.paymentTermsHours ?? 72,
  p_items: args.items,
});

export const markCommercialDeliveryUnitsPrinted = (unitIds: string[], reason?: string) =>
  rpc<{ printed: number }>('mark_commercial_delivery_units_printed', {
    p_unit_ids: unitIds,
    p_reprint_reason: reason || null,
  });

export const scanCommercialDeliveryUnitForRelease = (barcode: string, partnerId: string) =>
  rpc<{ released: boolean; scanned: number; total: number; released_at?: string }>('scan_commercial_delivery_unit_for_release', {
    p_barcode_value: barcode.trim(), p_partner_id: partnerId,
  });

export const registerPartnerSpoilageByBarcode = (barcode: string, partnerId: string, reason?: string) =>
  rpc<{ movement_id: string; product_name: string; released_at: string; unit_cost?: number }>('register_partner_spoilage_by_barcode', {
    p_barcode_value: barcode.trim(), p_partner_id: partnerId, p_reason: reason || null,
  });

export const registerPartnerSpoilageException = (partnerId: string, item: Record<string, unknown>, reason: string) =>
  rpc<{ movement_id: string }>('register_partner_spoilage_exception', {
    p_partner_id: partnerId, p_item: item, p_reason: reason,
  });

export const findCommercialDeliveryUnitForPartner = async (barcode: string, partnerId: string) => {
  if (!supabase) throw new Error('Supabase no configurado');
  const scanCode = barcode.trim();
  if (!/^\d{16}$/.test(scanCode)) {
    throw new Error('El código de etiqueta debe contener exactamente 16 dígitos.');
  }
  const { data, error } = await supabase.from('commercial_delivery_units')
    .select('*, commercial_partners(business_name, responsible_name)')
    .eq('scan_code', scanCode)
    .eq('partner_id', partnerId).maybeSingle();
  if (error) throw error;
  return data as CommercialDeliveryUnit | null;
};

export const registerPartnerReturnByBarcode = (barcode: string, partnerId: string, reason?: string) =>
  rpc<{ delivery_unit: CommercialDeliveryUnit; movement_id: string; status: 'returned_good' }>('register_partner_return_by_barcode', {
    p_barcode_value: barcode.trim(), p_partner_id: partnerId, p_reason: reason || null,
  });

export const registerPartnerReturnException = (partnerId: string, item: Record<string, unknown>, reason: string) =>
  rpc<{ movement_id: string; exception: true; status: 'returned_good' }>('register_partner_return_exception', {
    p_partner_id: partnerId, p_item: item, p_reason: reason,
  });

export const adminForceReleaseCommercialDelivery = (args: {
  sourceType: CommercialDeliverySourceType; sourceId: string; reason: string;
}) => rpc<AdminCommercialDeliveryResult>('admin_force_release_commercial_delivery', {
  p_source_type: args.sourceType,
  p_source_id: args.sourceId,
  p_reason: args.reason.trim(),
});

export const adminCancelCommercialDelivery = (args: {
  sourceType: CommercialDeliverySourceType; sourceId: string; reason: string;
}) => rpc<AdminCommercialDeliveryResult>('admin_cancel_commercial_delivery', {
  p_source_type: args.sourceType,
  p_source_id: args.sourceId,
  p_reason: args.reason.trim(),
});

export const listCommercialDeliveryUnits = async (partnerId: string, sourceType?: CommercialDeliverySourceType) => {
  if (!supabase) throw new Error('Supabase no configurado');

  let query = supabase.from('commercial_delivery_units')
    .select('*, commercial_partners(business_name, responsible_name)')
    .eq('partner_id', partnerId)
    .order('generated_at', { ascending: false });
  if (sourceType) query = query.eq('source_type', sourceType);

  const { data, error } = await query;
  if (error) throw error;
  const units = (data ?? []) as CommercialDeliveryUnit[];

  // commercial_delivery_units has more than one FK path to movement records.
  // Load the two source tables explicitly so PostgREST never has to guess an
  // embedded relationship.
  const movementIds = [...new Set(units.map(unit => unit.movement_id).filter((id): id is string => Boolean(id)))];
  const wholesaleOrderIds = [...new Set(units.map(unit => unit.wholesale_order_id).filter((id): id is string => Boolean(id)))];

  const movementsById = new Map<string, Omit<ComodatoSourceRow, 'id'>>();
  if (movementIds.length > 0) {
    const { data: movementData, error: movementError } = await supabase
      .from('commercial_partner_movements')
      .select('id, status, movement_date')
      .in('id', movementIds);
    if (movementError) throw movementError;
    for (const movement of (movementData ?? []) as ComodatoSourceRow[]) {
      movementsById.set(movement.id, {
        status: movement.status,
        movement_date: movement.movement_date,
      });
    }
  }

  const wholesaleOrdersById = new Map<string, Omit<WholesaleSourceRow, 'id'>>();
  if (wholesaleOrderIds.length > 0) {
    const { data: orderData, error: orderError } = await supabase
      .from('wholesale_orders')
      .select('id, order_status, order_date')
      .in('id', wholesaleOrderIds);
    if (orderError) throw orderError;
    for (const order of (orderData ?? []) as WholesaleSourceRow[]) {
      wholesaleOrdersById.set(order.id, {
        order_status: order.order_status,
        order_date: order.order_date,
      });
    }
  }

  return units.map(unit => ({
    ...unit,
    commercial_partner_movements: unit.movement_id
      ? movementsById.get(unit.movement_id) ?? null
      : null,
    wholesale_orders: unit.wholesale_order_id
      ? wholesaleOrdersById.get(unit.wholesale_order_id) ?? null
      : null,
  }));
};
