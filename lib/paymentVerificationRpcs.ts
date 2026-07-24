/**
 * Payment Verification RPC Wrappers
 * 
 * Interfaces with the payment verification workflow:
 * 1. Vendors report payments (cash or transfer)
 * 2. Admins review and approve/reject
 * 3. Approved payments are recorded in actual payment tables
 */

import { supabase } from '../supabase';

// ═════════════════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════════════════

export interface PaymentVerificationRequest {
  id: string;
  folio: string;
  scheme: 'comodato' | 'mayoreo';
  partner_id: string;
  movement_id: string | null;
  wholesale_order_id: string | null;
  amount: number;
  payment_date: string;
  payment_method: 'cash' | 'transfer';
  payment_reference: string | null;
  notes: string | null;
  proof_path: string | null;
  proof_file_name: string | null;
  proof_mime_type: string | null;
  proof_size_bytes: number | null;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'cancelled';
  submitted_by: string;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  rejection_reason: string | null;
  approved_payment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PendingPaymentVerification {
  request_id: string;
  folio: string;
  scheme: 'comodato' | 'mayoreo';
  partner_id: string;
  partner_folio: string;
  business_name: string;
  responsible_name: string | null;
  amount: number;
  payment_date: string;
  payment_method: 'cash' | 'transfer';
  payment_reference: string | null;
  proof_path: string | null;
  proof_file_name: string | null;
  submitted_by: string;
  seller_name: string;
  submitted_at: string;
  movement_id: string | null;
  wholesale_order_id: string | null;
  source_folio: string;
  current_source_balance: number;
  minutes_since_submission: number;
}

export interface PaymentVerificationHistory {
  request_id: string;
  folio: string;
  scheme: 'comodato' | 'mayoreo';
  partner_id: string;
  partner_folio: string;
  business_name: string;
  responsible_name: string | null;
  amount: number;
  payment_date: string;
  payment_method: 'cash' | 'transfer';
  payment_reference: string | null;
  notes: string | null;
  proof_path: string | null;
  proof_file_name: string | null;
  proof_size_bytes: number | null;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'cancelled';
  status_label: string;
  submitted_by: string;
  submitted_by_name: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  rejection_reason: string | null;
  approved_payment_id: string | null;
  movement_id: string | null;
  wholesale_order_id: string | null;
  source_folio: string;
  created_at: string;
  updated_at: string;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. CREATE PAYMENT VERIFICATION REQUEST (Draft)
// ═════════════════════════════════════════════════════════════════════════════

export async function createPaymentVerificationRequest(
  scheme: 'comodato' | 'mayoreo',
  partnerId: string,
  paymentDate: string,
  amount: number,
  paymentMethod: 'cash' | 'transfer',
  movementId?: string | null,
  wholesaleOrderId?: string | null,
  paymentReference?: string | null,
  notes?: string | null
): Promise<{ requestId: string; folio: string } | null> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    const { data, error } = await supabase.rpc(
      'create_partner_payment_verification_request',
      {
        p_scheme: scheme,
        p_partner_id: partnerId,
        p_payment_date: paymentDate,
        p_amount: amount,
        p_payment_method: paymentMethod,
        p_movement_id: movementId || null,
        p_wholesale_order_id: wholesaleOrderId || null,
        p_payment_reference: paymentReference || null,
        p_notes: notes || null,
      }
    );

    if (error) {
      console.error('Error creating payment verification request:', error);
      throw error;
    }

    if (data && data.length > 0) {
      return {
        requestId: data[0].request_id,
        folio: data[0].folio,
      };
    }

    return null;
  } catch (err: any) {
    console.error('Exception creating payment verification request:', err);
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. SUBMIT PAYMENT VERIFICATION REQUEST (Draft → Pending Review)
// ═════════════════════════════════════════════════════════════════════════════

export async function submitPaymentVerificationRequest(
  requestId: string,
  proofPath?: string | null,
  proofFileName?: string | null,
  proofMimeType?: string | null,
  proofSizeBytes?: number | null
): Promise<{ status: string; submittedAt: string } | null> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  // Validación obligatoria de requestId
  if (typeof requestId !== 'string' || requestId.trim() === '') {
    console.error('Invalid requestId:', requestId);
    throw new Error('requestId es obligatorio para enviar el cobro a revisión.');
  }

  console.log('Submitting payment verification', {
    requestId,
    proofPath,
    proofFileName,
    proofMimeType,
    proofSizeBytes,
  });

  try {
    const rpcPayload = {
      p_request_id: requestId,
      p_proof_path: proofPath ?? null,
      p_proof_file_name: proofFileName ?? null,
      p_proof_mime_type: proofMimeType ?? null,
      p_proof_size_bytes: proofSizeBytes ?? null,
    };

    console.log('RPC payload:', rpcPayload);

    const { data, error } = await supabase.rpc(
      'submit_partner_payment_verification_request',
      rpcPayload
    );

    if (error) {
      console.error('Error submitting payment verification request:', error);
      throw error;
    }

    if (data && data.length > 0) {
      return {
        status: data[0].status,
        submittedAt: data[0].submitted_at,
      };
    }

    return null;
  } catch (err: any) {
    console.error('Exception submitting payment verification request:', err);
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. APPROVE PAYMENT VERIFICATION REQUEST (Pending → Approved + Create Payment)
// ═════════════════════════════════════════════════════════════════════════════

export async function approvePaymentVerificationRequest(
  requestId: string,
  reviewNotes?: string | null
): Promise<{ status: string; approvedPaymentId: string } | null> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    const { data, error } = await supabase.rpc(
      'approve_partner_payment_verification_request',
      {
        p_request_id: requestId,
        p_review_notes: reviewNotes || null,
      }
    );

    if (error) {
      console.error('Error approving payment verification request:', error);
      throw error;
    }

    if (data && data.length > 0) {
      return {
        status: data[0].status,
        approvedPaymentId: data[0].approved_payment_id,
      };
    }

    return null;
  } catch (err: any) {
    console.error('Exception approving payment verification request:', err);
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. REJECT PAYMENT VERIFICATION REQUEST (Pending → Rejected)
// ═════════════════════════════════════════════════════════════════════════════

export async function rejectPaymentVerificationRequest(
  requestId: string,
  rejectionReason: string
): Promise<{ status: string; rejectionReason: string } | null> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  if (!rejectionReason || rejectionReason.trim() === '') {
    throw new Error('Rejection reason is required');
  }

  try {
    const { data, error } = await supabase.rpc(
      'reject_partner_payment_verification_request',
      {
        p_request_id: requestId,
        p_rejection_reason: rejectionReason,
      }
    );

    if (error) {
      console.error('Error rejecting payment verification request:', error);
      throw error;
    }

    if (data && data.length > 0) {
      return {
        status: data[0].status,
        rejectionReason: data[0].rejection_reason,
      };
    }

    return null;
  } catch (err: any) {
    console.error('Exception rejecting payment verification request:', err);
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. CANCEL PAYMENT VERIFICATION REQUEST (Draft/Pending → Cancelled)
// ═════════════════════════════════════════════════════════════════════════════

export async function cancelPaymentVerificationRequest(
  requestId: string,
  cancelReason?: string | null
): Promise<{ status: string } | null> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    const { data, error } = await supabase.rpc(
      'cancel_partner_payment_verification_request',
      {
        p_request_id: requestId,
        p_cancel_reason: cancelReason || null,
      }
    );

    if (error) {
      console.error('Error cancelling payment verification request:', error);
      throw error;
    }

    if (data && data.length > 0) {
      return {
        status: data[0].status,
      };
    }

    return null;
  } catch (err: any) {
    console.error('Exception cancelling payment verification request:', err);
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// QUERY: Get pending payment verifications (Admin)
// ═════════════════════════════════════════════════════════════════════════════

export async function getPendingPaymentVerifications(): Promise<PendingPaymentVerification[]> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    const { data, error } = await supabase
      .from('v_pending_payment_verifications')
      .select('*')
      .order('submitted_at', { ascending: false });

    if (error) {
      console.error('Error fetching pending payment verifications:', error);
      throw error;
    }

    return data || [];
  } catch (err: any) {
    console.error('Exception fetching pending payment verifications:', err);
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// QUERY: Get payment verification history (Vendor + Admin)
// ═════════════════════════════════════════════════════════════════════════════

export async function getPaymentVerificationHistory(
  partnerId?: string | null
): Promise<PaymentVerificationHistory[]> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    let query = supabase
      .from('v_partner_payment_verification_history')
      .select('*');

    if (partnerId) {
      query = query.eq('partner_id', partnerId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching payment verification history:', error);
      throw error;
    }

    return data || [];
  } catch (err: any) {
    console.error('Exception fetching payment verification history:', err);
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STORAGE: Upload payment proof
// ═════════════════════════════════════════════════════════════════════════════

export async function uploadPaymentProof(
  userId: string,
  requestId: string,
  file: File
): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    // Sanitize filename
    const safeFileName = file.name
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, '_')
      .substring(0, 100);

    const timestamp = Date.now();
    const filePath = `${userId}/${requestId}/${timestamp}-${safeFileName}`;

    const { error } = await supabase.storage
      .from('customer-payment-proofs')
      .upload(filePath, file, {
        upsert: false, // Don't overwrite
        contentType: file.type,
      });

    if (error) {
      console.error('Error uploading payment proof:', error);
      throw error;
    }

    return filePath;
  } catch (err: any) {
    console.error('Exception uploading payment proof:', err);
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STORAGE: Get signed URL for proof (Admin review)
// ═════════════════════════════════════════════════════════════════════════════

export async function getPaymentProofSignedUrl(
  proofPath: string,
  expirationSeconds: number = 300
): Promise<string | null> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    const { data, error } = await supabase.storage
      .from('customer-payment-proofs')
      .createSignedUrl(proofPath, expirationSeconds);

    if (error) {
      console.error('Error creating signed URL for proof:', error);
      throw error;
    }

    return data?.signedUrl || null;
  } catch (err: any) {
    console.error('Exception creating signed URL for proof:', err);
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// QUERY: Get comodato pending balance (for blocking mayoreo activation)
// ═════════════════════════════════════════════════════════════════════════════

export async function getComodatoPendingBalance(
  partnerId: string
): Promise<number> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    const { data, error } = await supabase
      .from('v_commercial_partner_operational_summary')
      .select('pending_balance')
      .eq('partner_id', partnerId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching comodato pending balance:', error);
      throw error;
    }

    return data?.pending_balance || 0;
  } catch (err: any) {
    console.error('Exception fetching comodato pending balance:', err);
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// QUERY: Check if vendor has pending payment verifications
// ═════════════════════════════════════════════════════════════════════════════

export async function getVendorPendingPaymentVerifications(
  vendorId: string,
  partnerId: string
): Promise<PaymentVerificationHistory[]> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    const { data, error } = await supabase
      .from('v_partner_payment_verification_history')
      .select('*')
      .eq('partner_id', partnerId)
      .eq('submitted_by', vendorId)
      .eq('status', 'pending_review')
      .order('submitted_at', { ascending: false });

    if (error) {
      console.error('Error fetching vendor pending verifications:', error);
      throw error;
    }

    return data || [];
  } catch (err: any) {
    console.error('Exception fetching vendor pending verifications:', err);
    throw err;
  }
}
