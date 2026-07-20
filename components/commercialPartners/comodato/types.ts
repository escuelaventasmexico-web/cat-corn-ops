// ── Phase 2 types for Commercial Partners – Comodato module ──────────────────

export type MovementType = 'delivery' | 'settlement' | 'withdrawal' | 'spoilage' | 'adjustment' | 'visit';

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  delivery:   'Entrega',
  settlement: 'Liquidación',
  withdrawal: 'Retiro',
  spoilage:   'Merma',
  adjustment: 'Ajuste',
  visit:      'Visita',
};

export const MOVEMENT_TYPE_COLORS: Record<MovementType, string> = {
  delivery:   'bg-blue-100 text-blue-800 border-blue-300',
  settlement: 'bg-green-100 text-green-800 border-green-300',
  withdrawal: 'bg-orange-100 text-orange-800 border-orange-300',
  spoilage:   'bg-red-100 text-red-800 border-red-300',
  adjustment: 'bg-purple-100 text-purple-800 border-purple-300',
  visit:      'bg-gray-100 text-gray-800 border-gray-300',
};

export interface PartnerMovementItem {
  id: string;
  movement_id: string;
  product_id?: string | null;
  product_name: string;
  product_variant?: string | null;
  product_size?: string | null;
  quantity_delivered: number;
  quantity_sold: number;
  quantity_withdrawn: number;
  quantity_spoiled: number;
  price_to_catcorn: number;
  suggested_retail_price?: number | null;
  amount_due: number;
  spoilage_absorbed_by?: string | null;
  notes?: string | null;
}

export interface PartnerMovement {
  id: string;
  partner_id: string;
  movement_type: MovementType;
  movement_date: string;
  status: string;
  total_amount_due: number;
  next_visit_date?: string | null;
  next_visit_reason?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  commercial_partner_movement_items?: PartnerMovementItem[];
}

export interface PartnerPayment {
  id: string;
  partner_id: string;
  movement_id?: string | null;
  payment_date: string;
  amount: number;
  payment_method: string;
  reference?: string | null;
  notes?: string | null;
  status: string;
  created_at: string;
}

export interface PartnerOperationalSummary {
  partner_id: string;
  pending_balance?: number | null;
  total_due?: number | null;
  total_paid?: number | null;
  total_units_in_partner?: number | null;
  last_movement_date?: string | null;
  next_visit_date?: string | null;
  next_visit_reason?: string | null;
}

export interface PartnerCurrentStockItem {
  partner_id: string;
  product_name: string;
  product_variant?: string | null;
  product_size?: string | null;
  total_delivered?: number | null;
  total_sold?: number | null;
  total_withdrawn?: number | null;
  total_spoiled?: number | null;
  adjustments?: number | null;
  current_quantity?: number | null;
  last_price_to_catcorn?: number | null;
  last_suggested_retail_price?: number | null;
}

export const PAYMENT_METHODS = [
  { value: 'cash',     label: 'Efectivo' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'card',     label: 'Tarjeta' },
  { value: 'other',    label: 'Otro' },
];

export const SPOILAGE_ABSORBED_BY = [
  { value: 'catcorn', label: 'Cat Corn absorbe' },
  { value: 'partner', label: 'Socio absorbe' },
];

// ── Shared UI helpers ─────────────────────────────────────────────────────────
export const fmtCurrency = (n?: number | null) => {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
};

export const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};

export const todayISO = () => new Date().toISOString().split('T')[0];

// ── Shared input / select class strings (mustard theme) ──────────────────────
export const INPUT_CLS =
  'w-full bg-white border border-[#c49330] rounded-lg px-3 py-2 text-sm text-[#111111] placeholder:text-[#6b7280] focus:outline-none focus:border-[#7a4a0a] transition-colors disabled:bg-white disabled:text-[#111111] disabled:opacity-100 read-only:bg-white read-only:text-[#111111] read-only:opacity-100';

export const SELECT_CLS =
  'w-full bg-white border border-[#c49330] rounded-lg px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#7a4a0a] transition-colors disabled:bg-white disabled:text-[#111111] disabled:opacity-100';

export const LABEL_CLS = 'block text-xs font-medium text-[#374151] mb-1';
export const SECTION_TITLE_CLS = 'text-xs font-semibold text-[#4a2c0a] uppercase tracking-wider';
export const CARD_CLS = 'rounded-xl bg-[#fff8e6] border border-[#c49330] p-4';
