/* ── B2B Report Types ─────────────────────────────────────────── */

export interface B2BDashboardSummary {
  total_partners: number;
  active_partners: number;
  prospect_partners: number;
  negotiating_partners: number;
  paused_partners: number;
  rejected_partners: number;
  inactive_partners: number;
  comodato_partners: number;
  wholesale_partners: number;
  partners_with_pending_balance: number;
  comodato_generated_total: number;
  comodato_paid_total: number;
  comodato_pending_total: number;
  wholesale_purchased_total: number;
  wholesale_paid_total: number;
  wholesale_pending_total: number;
  b2b_total_generated: number;
  b2b_total_paid: number;
  b2b_pending_balance: number;
  comodato_units_in_partner: number;
  wholesale_total_pieces: number;
  b2b_total_units: number;
  // Venta por Pieza fields (loaded in component, not from SQL view)
  pieceSale_generated_total?: number;
  pieceSale_paid_total?: number;
  pieceSale_pending_total?: number;
  pieceSale_total_pieces?: number;
}

export interface B2BPartnerRanking {
  partner_id: string;
  folio: string;
  business_name: string;
  responsible_name: string;
  partner_model: string;
  b2b_total_generated: number;
  comodato_generated: number;
  wholesale_purchased: number;
  b2b_total_paid: number;
  b2b_pending_balance: number;
  b2b_total_units: number;
  last_purchase_date: string | null;
}

export interface B2BPendingBalance {
  partner_id: string;
  folio: string;
  business_name: string;
  responsible_name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  business_type: string | null;
  status: string;
  partner_model: string;
  comodato_pending: number;
  wholesale_pending: number;
  b2b_pending_balance: number;
  comodato_generated: number;
  wholesale_purchased: number;
  b2b_total_generated: number;
  comodato_paid: number;
  wholesale_paid: number;
  b2b_total_paid: number;
  last_purchase_date: string | null;
  collection_status: string;
}

export interface B2BTopProduct {
  product_name: string;
  variant_name: string | null;
  size: string | null;
  total_units: number | null;
  total_amount: number | null;
  comodato_units: number | null;
  comodato_amount: number | null;
  wholesale_units: number | null;
  wholesale_amount: number | null;
  partner_count: number | null;
  rank: number | null;
}

export interface B2BUpcomingVisit {
  id: string;
  folio: string | null;
  business_name: string;
  responsible_name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  next_visit_date: string | null;
  visit_reason: string | null;
  days_until_visit: number | null;
  total_pending: number | null;
  partner_model: string;
}

export interface B2BComodatoExpired {
  id: string;
  folio: string | null;
  business_name: string;
  responsible_name: string;
  phone: string | null;
  contract_end_date: string | null;
  days_expired: number | null;
  units_in_possession: number | null;
  pending_balance: number | null;
}

export interface B2BPartnerMap {
  partner_id: string;
  folio: string | null;
  business_name: string;
  responsible_name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  business_type: string | null;
  status: string | null;
  partner_model: string;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  formatted_address: string | null;
  location_notes: string | null;
  latitude: number | null;
  longitude: number | null;
  next_visit_date: string | null;
  next_visit_reason: string | null;
  comodato_generated: number | null;
  wholesale_purchased: number | null;
  b2b_total_generated: number | null;
  b2b_pending_balance: number | null;
  map_marker_type: 'saldo_pendiente' | 'mayoreo' | 'comodato' | 'en_negociacion' | 'activo' | 'otro' | null;
}

export interface B2BSalesByZone {
  state_name: string | null;
  city_name: string | null;
  neighborhood: string | null;
  partners_count: number;
  comodato_partners: number;
  wholesale_partners: number;
  active_partners: number;
  b2b_total_generated: number;
  b2b_total_paid: number;
  b2b_pending_balance: number;
}

export interface B2BPipelineByStatus {
  status: string;
  partner_count: number | null;
  total_generated: number | null;
  total_pending: number | null;
}

export interface B2BConversionSummary {
  total_registered: number | null;
  prospects: number | null;
  in_negotiation: number | null;
  active: number | null;
  rejected: number | null;
  conversion_rate: number | null;
}

export interface B2BCollectionReport {
  total_pending: number | null;
  partners_with_pending: number | null;
  largest_debtor_name: string | null;
  largest_debtor_amount: number | null;
}

/* ── B2B Balance Detail (Modal) ──────────────────────────────────── */

export interface B2BComodatoStockItem {
  product_name: string;
  product_variant: string | null;
  product_size: string | null;
  total_delivered: number;
  total_sold: number;
  total_withdrawn: number;
  total_spoiled: number;
  total_adjusted: number;
  current_quantity: number;
  last_price_to_catcorn: number | null;
  last_suggested_retail_price: number | null;
  first_delivery_at: string | null;
  last_delivery_at: string | null;
}

export interface B2BComodatoSettlement {
  movement_id: string;
  movement_date: string;
  total_due: number;
  linked_paid: number;
  pending_amount: number;
  payment_status: 'pending' | 'liquidated';
  last_linked_payment_at: string | null;
  products_sold: Array<{
    product_name: string;
    product_variant: string | null;
    product_size: string | null;
    quantity_sold: number;
  }>;
}

export interface B2BComodatoDetail {
  generated: number;
  paid: number;
  pending: number;
  units_in_partner: number;
  stock_units: number;
  last_payment_at: string | null;
  oldest_settlement_at: string | null;
  oldest_stock_delivery_at: string | null;
  unallocated_confirmed_payments: number;
  stock: B2BComodatoStockItem[];
  settlements: B2BComodatoSettlement[];
}

export interface B2BWholesaleOrder {
  order_id: string;
  order_folio: string;
  order_date: string;
  delivery_date: string | null;
  payment_due_at: string | null;
  order_status: string;
  total_pieces: number;
  total_amount: number;
  total_paid: number;
  pending_amount: number;
  payment_status: 'pending' | 'liquidated';
  liquidation_date: string | null;
  products: Array<{
    product_name: string;
    product_variant: string | null;
    product_size: string | null;
    quantity: number;
    unit_price: number;
  }>;
}

export interface B2BWholesaleDetail {
  purchased: number;
  paid: number;
  pending: number;
  total_pieces: number;
  purchase_count: number;
  last_purchase_date: string | null;
  oldest_delivery_date: string | null;
  orders: B2BWholesaleOrder[];
}

export interface B2BBalancePartner {
  partner_id: string;
  folio: string;
  business_name: string;
  responsible_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  business_type: string | null;
  partner_status: string;
  partner_model: string;
  financial_status: 'pending' | 'liquidated';
  total_generated: number;
  total_paid: number;
  pending_amount: number;
  oldest_relevant_date: string | null;
  comodato: B2BComodatoDetail | null;
  wholesale: B2BWholesaleDetail | null;
}

export interface B2BPieceSaleItem {
  product_name: string;
  product_variant: string | null;
  product_size: string | null;
  quantity: number;
  unit_retail_price: number;
  subtotal: number;
}

export interface B2BPieceSaleDetail {
  folio: string;
  sale_date: string;
  status: string;
  payment_method: string | null;
  total_amount: number;
  paid_lifetime: number;
  pending_lifetime: number;
  last_payment_at: string | null;
  items: B2BPieceSaleItem[];
}

export interface B2BPieceSellerDetail {
  seller_id: string;
  seller_name: string;
  generated_in_period: number;
  paid_in_period: number;
  pending_in_period: number;
  financial_status: 'pending' | 'liquidated';
  sales_in_period: B2BPieceSaleDetail[];
}

export interface B2BBalanceSummary {
  comodato_generated: number;
  comodato_paid: number;
  comodato_pending: number;
  comodato_partners: number;
  wholesale_generated: number;
  wholesale_paid: number;
  wholesale_pending: number;
  wholesale_partners: number;
  b2b_generated: number;
  b2b_paid: number;
  b2b_pending_balance: number;
  b2b_partners_with_pending: number;
  piece_sale_generated: number;
  piece_sale_paid: number;
  piece_sale_pending: number;
  piece_sale_sellers_with_pending: number;
  combined_pending_total: number;
  piece_sale_period: {
    start_date: string;
    end_date: string;
  };
}

export interface B2BBalanceDetailResponse {
  summary: B2BBalanceSummary;
  partners: B2BBalancePartner[];
  piece_sales_by_seller: B2BPieceSellerDetail[];
}
