/* ── Piece Sales Types ──────────────────────────────────────── */

export interface PieceSaleProduct {
  product_id: string;
  product_name: string;
  original_name: string;
  product_variant: string;
  product_size: string;
  product_grams: string;
  sku_code: string;
  retail_price: number;
  product_key: string;
  rule_id: string;
  unit_commission: number;
}

export interface PieceSaleItem {
  product_id: string;
  quantity: number;
}

export interface PieceSaleItemDisplay extends PieceSaleProduct {
  quantity: number;
  subtotal: number;
  commission_total: number;
}

export interface PieceSaleRequest {
  p_sale_date: string;
  p_payment_method: 'cash' | 'transfer';
  p_items: PieceSaleItem[];
  p_payment_reference?: string | null;
  p_notes?: string | null;
}

export interface PieceSaleResponse {
  sale_id: string;
  sale_folio: string;
  request_id: string;
  request_folio: string;
  total_amount: number;
  total_commission: number;
  request_status: string;
}

/* ── Piece Sale History Item (from v_piece_sale_history.items) ──── */
export interface PieceSaleHistoryItem {
  item_id: string;
  product_id: string;
  product_sku: string | null;
  product_name: string;
  product_variant: string | null;
  product_size: string | null;
  quantity: number | string;
  unit_retail_price: number | string;
  subtotal: number | string;
  unit_commission: number | string;
  commission_total: number | string;
}

/* ── Piece Sale Item Snapshot (from corrections) ──────────────────── */
export interface PieceSaleItemSnapshot {
  product_id: string;
  product_sku: string | null;
  product_name: string;
  product_variant: string | null;
  product_size: string | null;
  product_grams: number | string | null;
  product_key: string;
  quantity: number | string;
  unit_retail_price: number | string;
  subtotal: number | string;
  rule_id: string;
  unit_commission: number | string;
  commission_total: number | string;
}

/* ── Piece Sale Correction (from v_piece_sale_correction_history) ──── */
export interface PieceSaleCorrection {
  correction_id: string;
  sale_id: string;
  sale_folio: string;
  sale_item_id: string;
  seller_id: string;
  seller_name: string | null;
  corrected_by: string;
  corrected_by_name: string | null;
  correction_reason: string;
  before_snapshot: PieceSaleItemSnapshot;
  after_snapshot: PieceSaleItemSnapshot;
  previous_sale_total: number | string;
  new_sale_total: number | string;
  previous_commission_total: number | string;
  new_commission_total: number | string;
  payment_request_reset: boolean;
  payment_request_id: string | null;
  corrected_at: string;
}

/* ── Piece Sale History Row (from v_piece_sale_history) ──────────── */
export interface PieceSaleHistory {
  sale_id: string;
  folio: string;
  seller_id: string;
  seller_name: string;
  sale_date: string;
  payment_method: string;
  payment_reference: string | null;
  notes: string | null;
  total_amount: number | string | null;
  total_commission: number | string | null;
  status: string;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  total_units: number | string | null;
  items: PieceSaleHistoryItem[] | string | null;
  /* Correction tracking columns */
  corrections_count: number | string | null;
  latest_correction_reason: string | null;
  latest_correction_at: string | null;
  latest_corrected_by_name: string | null;
  has_corrections: boolean | null;
  /* Payment verification tracking (enriched from partner_payment_verification_requests) */
  verification_reviewed_at?: string | null;
  verification_reviewed_by_name?: string | null;
  verification_rejection_reason?: string | null;
  /* Legacy fields for backwards compatibility */
  sale_folio?: string;
  units_sold?: number | null;
  request_id?: string;
  request_folio?: string;
  request_status?: string;
}

export interface SellerCommissionMonthlySummary {
  monthly_sales_amount: number;
  monthly_sales_count: number;
  total_commission_pending: number;
  total_commission_available: number;
  monthly_payments_under_review: number;
}

export interface SellerPieceStock {
  product_id: string;
  product_name: string;
  product_variant: string;
  product_size: string;
  assigned_net_units: number | null;
  sold_units: number | null;
  informational_balance: number | null;
}

export interface PieceSalesDashboardSummary {
  total_reported: number;
  total_confirmed: number;
  total_units_sold: number;
  total_amount_reported: number;
  total_amount_confirmed: number;
  pending_review_count: number;
  total_commission_generated: number;
  total_commission_available: number;
}

export interface PieceSalesBySeller {
  seller_id: string;
  seller_name: string;
  sales_count: number;
  units_sold: number;
  total_amount: number;
  total_commission: number;
  confirmed_sales: number;
  pending_reviews: number;
}

export interface PieceSalesTopProduct {
  product_id: string;
  product_name: string;
  product_variant: string;
  product_size: string;
  units_sold: number;
  total_amount: number;
  sales_count: number;
}

export interface PieceSalePaymentRequest {
  p_sale_id: string;
  p_payment_date: string;
  p_payment_method: 'cash' | 'transfer';
  p_payment_reference?: string | null;
  p_notes?: string | null;
}
