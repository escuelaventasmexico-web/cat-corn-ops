/**
 * Payment Verification System Types
 * Sistema de verificación de cobros reportados por vendedores
 */

export type PaymentVerificationStatus = 
  | 'draft'           // Creado pero no enviado
  | 'pending_review'  // Enviado, esperando revisión admin
  | 'approved'        // Admin aprobó, pago creado
  | 'rejected'        // Admin rechazó
  | 'cancelled';      // Cancelado por vendedor o admin

export type PaymentScheme = 'comodato' | 'mayoreo';
export type PaymentMethod = 'cash' | 'transfer';

/**
 * Solicitud de verificación de cobro
 * Representa un reporte de pago que espera aprobación de admin
 */
export interface PartnerPaymentVerificationRequest {
  id: string;
  folio: string;  // COBRO-YYYYMM-##### generado automáticamente
  partner_id: string;
  scheme: PaymentScheme;
  
  // Referencia a operación (una o la otra debe existir)
  movement_id: string | null;        // Para comodato
  wholesale_order_id: string | null;  // Para mayoreo
  
  // Información del pago reportado
  payment_date: string;  // ISO 8601
  amount: number;
  payment_method: PaymentMethod;
  payment_reference: string | null;  // Número de comprobante/cheque
  notes: string | null;
  
  // Comprobante (obligatorio para transferencias en pending_review+)
  proof_path: string | null;           // storage path
  proof_file_name: string | null;
  proof_mime_type: string | null;
  proof_size_bytes: number | null;
  
  // Estado y auditoría
  status: PaymentVerificationStatus;
  
  // Info de submitido
  submitted_by: string | null;  // user_id que envió
  submitted_at: string | null;   // ISO 8601
  
  // Info de revisión (admin)
  reviewed_by: string | null;    // user_id del admin que revisó
  reviewed_at: string | null;    // ISO 8601
  review_notes: string | null;   // Notas del admin al aprobar
  rejection_reason: string | null; // Motivo de rechazo (si rejected)
  cancel_reason: string | null;   // Motivo de cancelación (si cancelled)
  
  // Pago creado como resultado (si approved)
  approved_payment_id: string | null;
  
  // Timestamps
  created_at: string;  // ISO 8601
  updated_at: string;  // ISO 8601
}

/**
 * Respuesta de crear solicitud (draft)
 */
export interface CreatePaymentVerificationResponse {
  id: string;
  folio: string;
  status: 'draft';
  amount: number;
  scheme: PaymentScheme;
  created_at: string;
  message: string;
}

/**
 * Respuesta de enviar solicitud (submit)
 */
export interface SubmitPaymentVerificationResponse {
  id: string;
  status: 'pending_review';
  submitted_at: string;
  message: string;
}

/**
 * Respuesta de aprobar/rechazar
 */
export interface ApprovalResponse {
  success: boolean;
  request_id: string;
  status: PaymentVerificationStatus;
  payment_id?: string;        // Si fue aprobado
  rejection_reason?: string;  // Si fue rechazado
  message: string;
}

/**
 * Registro del historial de verificaciones
 */
export interface PaymentVerificationHistoryRecord {
  id: string;
  folio: string;
  partner_id: string;
  partner_name: string;  // De la vista
  scheme: PaymentScheme;
  amount: number;
  payment_date: string;
  payment_method: PaymentMethod;
  status: PaymentVerificationStatus;
  status_label: string;  // Traducido español
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;  // Nombre del admin
  rejection_reason: string | null;
  created_at: string;
}

/**
 * Solicitud pendiente para dashboard admin
 */
export interface PendingPaymentVerification {
  id: string;
  folio: string;
  partner_id: string;
  partner_name: string;
  vendor_name: string;           // Quien reportó
  scheme: PaymentScheme;
  amount: number;
  payment_date: string;
  payment_method: PaymentMethod;
  current_balance: number;       // Balance actual del socio
  submitted_at: string;
  notes: string | null;
  has_proof: boolean;
  proof_mime_type: string | null;
}

/**
 * Parámetros para crear solicitud
 */
export interface CreatePaymentVerificationParams {
  scheme: PaymentScheme;
  partner_id: string;
  movement_id?: string | null;
  wholesale_order_id?: string | null;
  payment_date: Date;
  amount: number;
  payment_method: PaymentMethod;
  payment_reference?: string | null;
  notes?: string | null;
}

/**
 * Parámetros para enviar solicitud
 */
export interface SubmitPaymentVerificationParams {
  request_id: string;
  proof_path?: string | null;
  proof_file_name?: string | null;
  proof_mime_type?: string | null;
  proof_size_bytes?: number | null;
}

/**
 * Parámetros para aprobar
 */
export interface ApprovePaymentVerificationParams {
  request_id: string;
  review_notes?: string;
}

/**
 * Parámetros para rechazar
 */
export interface RejectPaymentVerificationParams {
  request_id: string;
  rejection_reason: string; // Obligatorio
}

/**
 * Parámetros para cancelar
 */
export interface CancelPaymentVerificationParams {
  request_id: string;
  cancel_reason?: string;
}

/**
 * Información de comprobante para mostrar/descargar
 */
export interface PaymentProofInfo {
  path: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url?: string;  // URL firmada temporal (5 minutos)
  uploadedAt?: string;
}

/**
 * Error específico del sistema de verificación
 */
export interface PaymentVerificationError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Estados para traducción
 */
export const PAYMENT_VERIFICATION_STATUS_LABELS: Record<PaymentVerificationStatus, string> = {
  'draft': 'Borrador',
  'pending_review': 'En revisión',
  'approved': 'Aprobado',
  'rejected': 'Rechazado',
  'cancelled': 'Cancelado',
};

/**
 * Colores para mostrar estados
 */
export const PAYMENT_VERIFICATION_STATUS_COLORS: Record<PaymentVerificationStatus, string> = {
  'draft': 'bg-gray-500',
  'pending_review': 'bg-yellow-500',
  'approved': 'bg-green-500',
  'rejected': 'bg-red-500',
  'cancelled': 'bg-gray-400',
};

/**
 * Iconos para estados
 */
export const PAYMENT_VERIFICATION_STATUS_ICONS: Record<PaymentVerificationStatus, string> = {
  'draft': 'document',
  'pending_review': 'clock',
  'approved': 'check-circle',
  'rejected': 'x-circle',
  'cancelled': 'ban',
};
