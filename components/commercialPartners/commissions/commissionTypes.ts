/* ── Commission Module Types ─────────────────────────────────────── */

export type CommissionStatus = 'pending' | 'available' | 'paid' | 'cancelled';
export type CommissionPaymentStatus = CommissionStatus | 'partially_paid';
export type SourceType =
  | 'comodato_sale'
  | 'wholesale_sale'
  | 'piece_sale'
  | 'conversion_bonus'
  | 'adjustment'
  | 'pos_sale';

export interface SellerCommissionMonthlySummary {
  seller_id: string;
  month_start: string;
  month_end: string;
  generated_total: number;
  available_total: number;
  pending_total: number;
  paid_total: number;
  comodato_units: number;
  wholesale_units: number;
  conversion_count: number;
  partners_count: number;
  events_count: number | string;
}

export interface CommissionMovement {
  commission_event_id: string;
  seller_id: string;
  partner_id: string | null;
  partner_folio: string | null;
  business_name: string | null;
  responsible_name: string | null;
  earned_at: string;
  source_type: SourceType;
  source_id: string | null;
  source_item_id: string | null;
  source_folio: string | null;
  product_key: string | null;
  product_name: string | null;
  product_variant: string | null;
  product_size: string | null;
  quantity: number | string | null;
  unit_commission: number | string | null;
  commission_amount: number | string;
  paid_amount: number | string;
  remaining_amount: number | string;
  reserved_amount: number | string;
  allocatable_amount: number | string;
  release_condition: string;
  status: CommissionStatus;
  payment_status: CommissionPaymentStatus;
  available_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  metadata?: Record<string, unknown> | string | null;
}

export interface CommissionSettlement {
  id: string;
  seller_id: string;
  month_start: string;
  month_end: string;
  total_amount: number;
  status: 'draft' | 'paid' | 'cancelled';
  paid_at: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  created_at: string;
}

export interface CommissionSettlementHistory {
  settlement_id: string;
  seller_id: string;
  folio: string;
  month_start: string;
  month_end: string;
  period_label: string;
  event_count: number;
  total_amount: number | string;
  status: 'draft' | 'paid' | 'cancelled';
  payment_method: string | null;
  paid_at: string | null;
  created_at: string;
  payment_proof_path: string | null;
  has_payment_proof: boolean;
}

export interface CommissionSettlementDetail {
  settlement_id: string;
  commission_event_id: string;
  earned_at: string;
  business_name: string;
  partner_folio: string;
  product_name: string | null;
  product_variant: string | null;
  product_size: string | null;
  source_type: SourceType;
  quantity: number | string;
  unit_commission: number | string;
  settlement_item_amount: number | string;
}

export interface CommissionAvailableForPayment {
  seller_id: string;
  available_amount: number | string;
  available_event_count: number;
  has_draft_settlement: boolean;
  draft_settlement_id: string | null;
}

export interface SellerCommissionTargetProgress {
  seller_id: string;
  month_start: string;
  target_commission_amount: number;
  generated_total: number;
  progress_percentage: number;
}

export interface SellerMonthlyPartnerProgress {
  seller_id: string;
  seller_name: string;
  month_start: string;
  target_active_partners: number | null;
  achieved_active_partners: number;
  remaining_active_partners: number | null;
  progress_percentage: number | null;
}

export interface CommissionRule {
  id: string;
  schema_name: string;
  product_name: string;
  product_variant: string;
  commission_amount: number;
  effective_from: string;
  effective_until: string | null;
  is_active: boolean;
  rule_type: 'comodato' | 'wholesale' | 'conversion';
}

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
}

export interface CommissionFilters {
  status: CommissionStatus | 'todos';
  sourceType: SourceType | 'todos';
  searchQuery: string;
}
