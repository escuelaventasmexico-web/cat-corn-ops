// Wholesale Debt Authorization Types

export interface WholesaleDebtAuthorizationRequest {
  id: string;
  request_id: string;
  partner_id: string;
  partner_folio: string;
  business_name: string;
  partner_model: string;
  wholesale_status?: string | null;

  requested_by: string;
  requested_by_name?: string;
  request_reason: string;
  requested_at?: string;

  comodato_pending_balance_snapshot: number;
  comodato_stock_units_snapshot: number;

  current_comodato_pending_balance?: number;
  current_comodato_stock_units?: number;

  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'used';

  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
  rejection_reason?: string | null;

  approved_at?: string | null;
  used_at?: string | null;
  used_contract_id?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;

  created_at?: string;
  updated_at?: string;
}

export const AUTH_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Autorizada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
  used: 'Utilizada',
};

export const AUTH_STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  pending: {
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
  },
  approved: {
    bg: 'bg-green-50',
    text: 'text-green-800',
    border: 'border-green-200',
  },
  rejected: {
    bg: 'bg-red-50',
    text: 'text-red-800',
    border: 'border-red-200',
  },
  cancelled: {
    bg: 'bg-gray-50',
    text: 'text-gray-800',
    border: 'border-gray-200',
  },
  used: {
    bg: 'bg-blue-50',
    text: 'text-blue-800',
    border: 'border-blue-200',
  },
};
