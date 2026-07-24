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

export interface PieceSaleHistory {
  sale_id: string;
  sale_folio: string;
  sale_date: string;
  seller_id: string;
  seller_name: string;
  total_amount: number | null;
  total_commission: number | null;
  units_sold: number | null;
  payment_method: string;
  payment_reference: string | null;
  notes: string | null;
  status: 'draft' | 'pending_review' | 'payment_rejected' | 'confirmed' | 'cancelled';
  request_id: string;
  request_folio: string;
  request_status: string;
}

export interface SellerCommissionMonthlySummary {
  total_commission_pending: number | null;
  total_commission_available: number | null;
  pending_reviews: number | null;
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
