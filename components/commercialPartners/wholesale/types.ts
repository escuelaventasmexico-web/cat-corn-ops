// ── Wholesale (Mayoreo) module types ────────────────────────────────────────

export type ContractStatus = 'draft' | 'generated' | 'reviewed' | 'activated' | 'cancelled';
export type OrderStatus = 'draft' | 'delivered' | 'cancelled';
export type PaymentStatus = 'pending' | 'partial' | 'paid' | 'cancelled';
export type PaymentMethod = 'cash' | 'transfer' | 'card' | 'other';
export type DocumentType = 'ine_front' | 'ine_back' | 'business_photo' | 'contract_pdf' | 'signed_contract_photo';

export interface WholesaleProduct {
  id: string;
  product_code: string;
  product_name: string;
  product_variant: string;
  product_size: string;
  wholesale_price: number;
  active: boolean;
  created_at?: string;
}

export interface WholesaleOrderItem {
  id: string;
  wholesale_order_id: string;
  partner_id: string;
  product_code: string;
  product_name: string;
  product_variant: string;
  product_size: string;
  quantity: number;
  unit_price: number;
  subtotal?: number;
  notes?: string | null;
}

export interface WholesaleOrder {
  id: string;
  partner_id: string;
  contract_id?: string | null;
  order_date: string;
  delivery_date: string;
  payment_terms_hours: number;
  minimum_order_pieces: number;
  order_status: OrderStatus;
  notes?: string | null;
  created_at?: string;
}

export interface WholesaleOrderTotal {
  wholesale_order_id: string;
  partner_id: string;
  total_pieces: number;
  total_amount: number;
  total_paid: number;
  pending_amount: number;
  computed_payment_status: PaymentStatus;
}

export interface WholesalePayment {
  id: string;
  partner_id: string;
  wholesale_order_id?: string | null;
  amount: number;
  payment_method: PaymentMethod;
  reference?: string | null;
  notes?: string | null;
  payment_date: string;
  created_at?: string;
}

export interface WholesaleContract {
  id: string;
  partner_id: string;
  privacy_consent_accepted: boolean;
  privacy_consent_at: string;
  contract_status: ContractStatus;
  generated_at?: string | null;
  reviewed_at?: string | null;
  activated_at?: string | null;
  ine_front_storage_path: string;
  ine_back_storage_path: string;
  business_photo_storage_path: string;
  contract_pdf_storage_path?: string | null;
  signed_contract_storage_path?: string | null;
  created_at?: string;
}

export interface WholesaleDocument {
  id: string;
  partner_id: string;
  contract_id?: string | null;
  document_type: DocumentType;
  storage_bucket: string;
  storage_path: string;
  created_at?: string;
}

export interface WholesaleSummary {
  partner_id: string;
  folio: string;
  business_name: string;
  responsible_name: string;
  partner_model: string;
  wholesale_status?: string | null;
  total_purchased: number;
  total_paid: number;
  pending_balance: number;
  total_pieces: number;
  purchase_count: number;
  last_purchase_date?: string | null;
}

export interface WholesaleTopProduct {
  product_code: string;
  product_name: string;
  product_variant: string;
  product_size: string;
  total_quantity: number;
  total_amount: number;
}

// ── UI/UX Constants ────────────────────────────────────────────────────────

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'Borrador',
  generated: 'Generado',
  reviewed: 'Revisado',
  activated: 'Activado',
  cancelled: 'Cancelado',
};

export const CONTRACT_STATUS_COLORS: Record<ContractStatus, string> = {
  draft: 'bg-gray-100 text-gray-800 border-gray-300',
  generated: 'bg-blue-100 text-blue-800 border-blue-300',
  reviewed: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  activated: 'bg-green-100 text-green-800 border-green-300',
  cancelled: 'bg-red-100 text-red-800 border-red-300',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Borrador',
  delivered: 'Entregada',
  cancelled: 'Cancelada',
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  draft: 'bg-gray-100 text-gray-800 border-gray-300',
  delivered: 'bg-blue-100 text-blue-800 border-blue-300',
  cancelled: 'bg-red-100 text-red-800 border-red-300',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pendiente',
  partial: 'Parcial',
  paid: 'Pagado',
  cancelled: 'Cancelado',
};

export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  pending: 'bg-red-100 text-red-800 border-red-300',
  partial: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  paid: 'bg-green-100 text-green-800 border-green-300',
  cancelled: 'bg-gray-100 text-gray-800 border-gray-300',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta',
  other: 'Otro',
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  ine_front: 'INE Frente',
  ine_back: 'INE Reverso',
  business_photo: 'Foto del Negocio',
  contract_pdf: 'Contrato PDF',
  signed_contract_photo: 'Contrato Firmado',
};

// ── Validation helpers ──────────────────────────────────────────────────────

export const MINIMUM_ORDER_PIECES = 10;
export const PAYMENT_TERMS_HOURS = 72;
export const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

// ── Formatting helpers ──────────────────────────────────────────────────────

export const fmtCurrency = (amount: number | null | undefined): string => {
  if (amount == null) return '$0.00';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(amount);
};

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    const date = new Date(iso);
    return date.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
};

export const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  try {
    const date = new Date(iso);
    return date.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
};

// ── Tailwind classes ────────────────────────────────────────────────────────

export const CARD_CLS =
  'rounded-lg border border-[#e8d5a0] bg-[#fffbf0] p-4';

export const INPUT_CLS =
  'w-full bg-white border border-[#c49330] rounded-lg px-3 py-2 text-[#111111] placeholder:text-[#9a8a7a] text-sm focus:outline-none focus:ring-2 focus:ring-[#D6A23A] disabled:bg-white disabled:opacity-100 disabled:text-[#111111] read-only:bg-white read-only:text-[#111111]';

export const SELECT_CLS =
  'w-full bg-white border border-[#c49330] rounded-lg px-3 py-2 text-[#111111] text-sm focus:outline-none focus:ring-2 focus:ring-[#D6A23A] disabled:bg-white disabled:opacity-100 disabled:text-[#111111]';

export const BUTTON_PRIMARY_CLS =
  'px-4 py-2 bg-[#D6A23A] text-[#111111] font-semibold rounded-lg hover:bg-[#c49330] transition-colors disabled:bg-[#e8d3a0] disabled:text-[#6b5a3a] disabled:opacity-100 disabled:cursor-not-allowed';

export const BUTTON_SECONDARY_CLS =
  'px-4 py-2 bg-white border border-[#c49330] text-[#111111] font-semibold rounded-lg hover:bg-[#f5e9c8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export const BUTTON_ADD_CLS =
  'px-2 py-1 text-sm bg-white border border-[#c49330] text-[#111111] font-semibold rounded hover:bg-[#f7e6bd] transition-colors disabled:bg-[#e8d3a0] disabled:text-[#6b5a3a] disabled:opacity-100 disabled:cursor-not-allowed';

export const BUTTON_DANGER_CLS =
  'px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export const LABEL_CLS = 'block text-sm font-medium text-[#4a2c0a] mb-1';

// ── Utility functions ──────────────────────────────────────────────────────

export const todayISO = (): string => {
  const now = new Date();
  return now.toISOString().split('T')[0];
};

export const generateDocumentPath = (
  partnerId: string,
  documentType: DocumentType,
  originalFilename: string,
): string => {
  const timestamp = Date.now();
  return `${partnerId}/wholesale/${timestamp}-${documentType}-${originalFilename}`;
};
