/**
 * Payment Verification RPC Utilities
 * Wrappers para llamar a las funciones RPC del sistema de verificación de cobros
 */

import { supabase } from '../supabase';
import {
  PartnerPaymentVerificationRequest,
  CreatePaymentVerificationParams,
  SubmitPaymentVerificationParams,
  ApprovePaymentVerificationParams,
  RejectPaymentVerificationParams,
  CancelPaymentVerificationParams,
  PendingPaymentVerification,
  PaymentVerificationHistoryRecord,
  PaymentVerificationError,
} from '../types/paymentVerification';

/**
 * Validar que Supabase está configurado
 */
function ensureSupabase() {
  if (!supabase) {
    throw createError('SUPABASE_NOT_CONFIGURED', 'Supabase no está configurado');
  }
  return supabase;
}

/**
 * Errores conocidos del sistema
 */
const PaymentVerificationErrors = {
  INVALID_SCHEME: 'INVALID_SCHEME',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  MISSING_MOVEMENT_ID: 'MISSING_MOVEMENT_ID',
  MISSING_WHOLESALE_ORDER_ID: 'MISSING_WHOLESALE_ORDER_ID',
  PARTNER_NOT_FOUND: 'PARTNER_NOT_FOUND',
  MOVEMENT_NOT_FOUND: 'MOVEMENT_NOT_FOUND',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  INVALID_REQUEST_STATUS: 'INVALID_REQUEST_STATUS',
  UNAUTHORIZED: 'UNAUTHORIZED',
  DEBT_EXISTS: 'DEBT_EXISTS',
  TRANSFER_PROOF_REQUIRED: 'TRANSFER_PROOF_REQUIRED',
};

/**
 * Crear solicitud de verificación (draft)
 * No requiere comprobante aún, status será 'draft'
 */
export async function createPaymentVerificationRequest(
  params: CreatePaymentVerificationParams
): Promise<PartnerPaymentVerificationRequest> {
  const {
    scheme,
    partner_id,
    movement_id,
    wholesale_order_id,
    payment_date,
    amount,
    payment_method,
    payment_reference,
    notes,
  } = params;

  if (!['comodato', 'mayoreo'].includes(scheme)) {
    throw createError('INVALID_SCHEME', `Esquema inválido: ${scheme}`);
  }

  if (amount <= 0) {
    throw createError('INVALID_AMOUNT', 'El monto debe ser mayor a 0');
  }

  if (scheme === 'comodato' && !movement_id) {
    throw createError(
      'MISSING_MOVEMENT_ID',
      'Movement ID requerido para comodato'
    );
  }

  if (scheme === 'mayoreo' && !wholesale_order_id) {
    throw createError(
      'MISSING_WHOLESALE_ORDER_ID',
      'Wholesale order ID requerido para mayoreo'
    );
  }

  const sb = ensureSupabase();
  const { data, error } = await sb.rpc(
    'create_partner_payment_verification_request',
    {
      p_scheme: scheme,
      p_partner_id: partner_id,
      p_movement_id: movement_id || null,
      p_wholesale_order_id: wholesale_order_id || null,
      p_payment_date: payment_date.toISOString(),
      p_amount: amount,
      p_payment_method: payment_method,
      p_payment_reference: payment_reference || null,
      p_notes: notes || null,
    }
  );

  if (error) {
    throw parseRpcError(error);
  }

  return data as PartnerPaymentVerificationRequest;
}

/**
 * Enviar solicitud a revisión (draft → pending_review)
 * Para transferencias, requiere comprobante
 */
export async function submitPaymentVerificationRequest(
  params: SubmitPaymentVerificationParams
): Promise<PartnerPaymentVerificationRequest> {
  const {
    request_id,
    proof_path,
    proof_file_name,
    proof_mime_type,
    proof_size_bytes,
  } = params;

  const sb = ensureSupabase();
  const { data, error } = await sb.rpc(
    'submit_partner_payment_verification_request',
    {
      p_request_id: request_id,
      p_proof_path: proof_path || null,
      p_proof_file_name: proof_file_name || null,
      p_proof_mime_type: proof_mime_type || null,
      p_proof_size_bytes: proof_size_bytes || null,
    }
  );

  if (error) {
    throw parseRpcError(error);
  }

  return data as PartnerPaymentVerificationRequest;
}

/**
 * Aprobar solicitud (admin only)
 * Crea el pago real y dispara triggers de comisión
 */
export async function approvePaymentVerificationRequest(
  params: ApprovePaymentVerificationParams
): Promise<PartnerPaymentVerificationRequest> {
  const { request_id, review_notes } = params;

  const sb = ensureSupabase();

  // Verificar permisos de admin
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    throw createError('UNAUTHORIZED', 'Usuario no autenticado');
  }

  const { data: profile } = await sb
    .from('user_profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();

  if (profile?.role !== 'admin') {
    throw createError('UNAUTHORIZED', 'Solo administradores pueden aprobar');
  }

  const { data, error } = await sb.rpc(
    'approve_partner_payment_verification_request',
    {
      p_request_id: request_id,
      p_review_notes: review_notes || null,
    }
  );

  if (error) {
    throw parseRpcError(error);
  }

  return data as PartnerPaymentVerificationRequest;
}

/**
 * Rechazar solicitud (admin only)
 */
export async function rejectPaymentVerificationRequest(
  params: RejectPaymentVerificationParams
): Promise<PartnerPaymentVerificationRequest> {
  const { request_id, rejection_reason } = params;

  if (!rejection_reason || rejection_reason.trim().length === 0) {
    throw createError('INVALID_REASON', 'Motivo de rechazo requerido');
  }

  const sb = ensureSupabase();

  // Verificar permisos de admin
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    throw createError('UNAUTHORIZED', 'Usuario no autenticado');
  }

  const { data: profile } = await sb
    .from('user_profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();

  if (profile?.role !== 'admin') {
    throw createError('UNAUTHORIZED', 'Solo administradores pueden rechazar');
  }

  const { data, error } = await sb.rpc(
    'reject_partner_payment_verification_request',
    {
      p_request_id: request_id,
      p_rejection_reason: rejection_reason,
    }
  );

  if (error) {
    throw parseRpcError(error);
  }

  return data as PartnerPaymentVerificationRequest;
}

/**
 * Cancelar solicitud (vendedor su propio, admin todos)
 */
export async function cancelPaymentVerificationRequest(
  params: CancelPaymentVerificationParams
): Promise<PartnerPaymentVerificationRequest> {
  const { request_id, cancel_reason } = params;

  const sb = ensureSupabase();
  const { data, error } = await sb.rpc(
    'cancel_partner_payment_verification_request',
    {
      p_request_id: request_id,
      p_cancel_reason: cancel_reason || null,
    }
  );

  if (error) {
    throw parseRpcError(error);
  }

  return data as PartnerPaymentVerificationRequest;
}

/**
 * Cargar solicitudes pendientes de revisión (admin)
 */
export async function loadPendingPaymentVerifications(): Promise<
  PendingPaymentVerification[]
> {
  const sb = ensureSupabase();
  const { data, error } = await sb
    .from('v_pending_payment_verifications')
    .select('*')
    .order('submitted_at', { ascending: true });

  if (error) {
    throw parseRpcError(error);
  }

  return (data || []) as PendingPaymentVerification[];
}

/**
 * Cargar historial de verificaciones del vendedor/admin
 */
export async function loadPaymentVerificationHistory(
  partnerId?: string
): Promise<PaymentVerificationHistoryRecord[]> {
  const sb = ensureSupabase();
  let query = sb.from('v_partner_payment_verification_history').select('*');

  if (partnerId) {
    query = query.eq('partner_id', partnerId);
  }

  const { data, error } = await query.order('created_at', {
    ascending: false,
  });

  if (error) {
    throw parseRpcError(error);
  }

  return (data || []) as PaymentVerificationHistoryRecord[];
}

/**
 * Obtener una solicitud por ID
 */
export async function getPaymentVerificationRequest(
  requestId: string
): Promise<PartnerPaymentVerificationRequest> {
  const sb = ensureSupabase();
  const { data, error } = await sb
    .from('partner_payment_verification_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (error) {
    throw parseRpcError(error);
  }

  return data as PartnerPaymentVerificationRequest;
}

/**
 * Cargar comprobante (obtener URL firmada)
 */
export async function getProofSignedUrl(
  proofPath: string,
  expirySeconds: number = 300
): Promise<string> {
  const sb = ensureSupabase();
  const { data, error } = await sb.storage
    .from('customer-payment-proofs')
    .createSignedUrl(proofPath, expirySeconds);

  if (error) {
    throw createError(
      'PROOF_URL_ERROR',
      `No se pudo generar URL del comprobante: ${error.message}`
    );
  }

  return data.signedUrl;
}

/**
 * Subir comprobante a storage
 */
export async function uploadPaymentProof(
  requestId: string,
  file: File
): Promise<string> {
  const sb = ensureSupabase();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    throw createError('UNAUTHORIZED', 'Usuario no autenticado');
  }

  // Validar tipo de archivo
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowedTypes.includes(file.type)) {
    throw createError(
      'INVALID_FILE_TYPE',
      `Tipo de archivo no permitido: ${file.type}`
    );
  }

  // Validar tamaño (10 MB)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    throw createError(
      'FILE_TOO_LARGE',
      `Archivo muy grande. Máximo 10 MB (tu archivo: ${(file.size / 1024 / 1024).toFixed(2)} MB)`
    );
  }

  // Path: {user_id}/{request_id}/{timestamp}-{filename}
  const timestamp = Date.now();
  const path = `${userData.user.id}/${requestId}/${timestamp}-${file.name}`;

  const { error } = await sb.storage
    .from('customer-payment-proofs')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    throw createError(
      'UPLOAD_ERROR',
      `Error al subir archivo: ${error.message}`
    );
  }

  return path;
}

/**
 * Eliminar comprobante (admin only)
 */
export async function deletePaymentProof(proofPath: string): Promise<void> {
  const sb = ensureSupabase();

  // Verificar permisos de admin
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    throw createError('UNAUTHORIZED', 'Usuario no autenticado');
  }

  const { data: profile } = await sb
    .from('user_profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();

  if (profile?.role !== 'admin') {
    throw createError('UNAUTHORIZED', 'Solo administradores pueden eliminar');
  }

  const { error } = await sb.storage
    .from('customer-payment-proofs')
    .remove([proofPath]);

  if (error) {
    throw createError(
      'DELETE_ERROR',
      `Error al eliminar archivo: ${error.message}`
    );
  }
}

/**
 * Obtener conteo de solicitudes pendientes
 */
export async function getPendingVerificationCount(): Promise<number> {
  const sb = ensureSupabase();
  const { count, error } = await sb
    .from('v_pending_payment_verifications')
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw parseRpcError(error);
  }

  return count || 0;
}

/**
 * Crear error estructurado
 */
function createError(code: string, message: string, details?: Record<string, unknown>): PaymentVerificationError {
  return {
    code,
    message,
    details,
  } as any;
}

/**
 * Parsear error de RPC
 */
function parseRpcError(error: any): PaymentVerificationError {
  const message = error.message || 'Error desconocido';
  
  // Intentar extraer código de error de mensaje RPC
  let code = 'RPC_ERROR';
  
  if (message.includes('INVALID_SCHEME')) code = 'INVALID_SCHEME';
  else if (message.includes('INVALID_AMOUNT')) code = 'INVALID_AMOUNT';
  else if (message.includes('MISSING_MOVEMENT_ID')) code = 'MISSING_MOVEMENT_ID';
  else if (message.includes('MISSING_WHOLESALE_ORDER_ID')) code = 'MISSING_WHOLESALE_ORDER_ID';
  else if (message.includes('PARTNER_NOT_FOUND')) code = 'PARTNER_NOT_FOUND';
  else if (message.includes('MOVEMENT_NOT_FOUND')) code = 'MOVEMENT_NOT_FOUND';
  else if (message.includes('ORDER_NOT_FOUND')) code = 'ORDER_NOT_FOUND';
  else if (message.includes('INSUFFICIENT_BALANCE')) code = 'INSUFFICIENT_BALANCE';
  else if (message.includes('INVALID_REQUEST_STATUS')) code = 'INVALID_REQUEST_STATUS';
  else if (message.includes('DEBT_EXISTS')) code = 'DEBT_EXISTS';
  else if (message.includes('TRANSFER_PROOF_REQUIRED')) code = 'TRANSFER_PROOF_REQUIRED';
  else if (message.includes('unauthorized') || message.includes('permission')) code = 'UNAUTHORIZED';
  else if (message.includes('row-level security policy')) code = 'RLS_VIOLATION';

  return {
    code,
    message,
    details: { originalError: error },
  };
}

export { PaymentVerificationErrors };
