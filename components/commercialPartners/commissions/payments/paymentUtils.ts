/* ── Commission Payment Utilities ────────────────────────────────────── */

import { supabase } from '../../../../supabase';
import {
  CommissionSettlementHistory,
  CommissionSettlementDetail,
  CommissionAvailableForPayment,
  CommissionSettlementPreview,
} from '../commissionTypes';

export const formatSupabaseError = (
  error: unknown,
  fallback = 'Ocurrió un error inesperado'
): string => {
  if (!error || typeof error !== 'object') {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  const record = error as Record<string, unknown>;
  const fields: Array<[string, unknown]> = [
    ['message', record.message],
    ['details', record.details],
    ['hint', record.hint],
    ['code', record.code],
  ];
  const lines = fields
    .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
    .map(([label, value]) => `${label}: ${String(value)}`);

  return lines.length > 0 ? lines.join('\n') : fallback;
};

/**
 * Load the exact candidate universe used by create_commission_settlement.
 */
export const getCommissionSettlementPreview = async (
  sellerId: string,
  periodStart: string,
  periodEnd: string
): Promise<CommissionSettlementPreview> => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.rpc('get_commission_settlement_preview', {
    p_seller_id: sellerId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });

  if (error) {
    console.error('SETTLEMENT PREVIEW ERROR', error);
    throw error;
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return {
    available_total: Number(row?.available_total || 0),
    event_count: Number(row?.event_count || 0),
    first_available_date: typeof row?.first_available_date === 'string' ? row.first_available_date : null,
    last_available_date: typeof row?.last_available_date === 'string' ? row.last_available_date : null,
    existing_draft_id: typeof row?.existing_draft_id === 'string' ? row.existing_draft_id : null,
    existing_draft_folio: typeof row?.existing_draft_folio === 'string' ? row.existing_draft_folio : null,
    existing_draft_total: Number(row?.existing_draft_total || 0),
    existing_draft_created_at: typeof row?.existing_draft_created_at === 'string' ? row.existing_draft_created_at : null,
    existing_draft_period_start: typeof row?.existing_draft_period_start === 'string' ? row.existing_draft_period_start : null,
    existing_draft_period_end: typeof row?.existing_draft_period_end === 'string' ? row.existing_draft_period_end : null,
    existing_draft_event_count: Number(row?.existing_draft_event_count || 0),
  };
};

/**
 * Sanitize file name for storage
 */
export const sanitizeFileName = (name: string): string => {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .toLowerCase();
};

/**
 * Create commission settlement (draft)
 */
export const createCommissionSettlement = async (
  sellerId: string,
  periodStart: string,
  periodEnd: string,
  amount: number
) => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.rpc('create_commission_settlement', {
    p_seller_id: sellerId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_amount: amount,
  });

  if (error) {
    console.error('CREATE SETTLEMENT ERROR', error);
    throw error;
  }

  // Normalize response (can be array or object)
  const result = Array.isArray(data) ? data[0] : data;

  return {
    settlement_id: result.settlement_id,
    folio: result.folio,
    total_amount: Number(result.total_amount || 0),
    event_count: Number(result.event_count || 0),
  };
};

/**
 * Pay commission settlement
 */
export const payCommissionSettlement = async (
  settlementId: string,
  paymentMethod: 'transfer' | 'cash',
  proofPath: string | null = null,
  proofFileName: string | null = null,
  proofMimeType: string | null = null,
  reference: string | null = null,
  notes: string | null = null,
  cashConfirmed: boolean = false
) => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.rpc('pay_commission_settlement', {
    p_settlement_id: settlementId,
    p_payment_method: paymentMethod,
    p_payment_reference: reference,
    p_payment_proof_path: proofPath,
    p_payment_proof_file_name: proofFileName,
    p_payment_proof_mime_type: proofMimeType,
    p_cash_confirmed: cashConfirmed,
    p_notes: notes,
  });

  if (error) {
    console.error('PAY SETTLEMENT ERROR', error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
};

/**
 * Cancel commission settlement draft
 */
export const cancelCommissionSettlementDraft = async (
  settlementId: string,
  reason: string | null = null
) => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.rpc('cancel_commission_settlement_draft', {
    p_settlement_id: settlementId,
    p_reason: reason,
  });

  if (error) {
    console.error('CANCEL SETTLEMENT ERROR', error);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
};

/**
 * Load settlement history
 */
export const loadSettlementHistory = async (sellerId: string) => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('v_commission_settlement_history')
    .select('*')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('SETTLEMENT HISTORY ERROR', error);
    throw error;
  }

  return (data as CommissionSettlementHistory[]) || [];
};

/**
 * Load settlement detail
 */
export const loadSettlementDetail = async (settlementId: string) => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('v_commission_settlement_detail')
    .select('*')
    .eq('settlement_id', settlementId);

  if (error) {
    console.error('SETTLEMENT DETAIL ERROR', error);
    throw error;
  }

  return (data as CommissionSettlementDetail[]) || [];
};

/**
 * Load available for payment
 */
export const loadAvailableForPayment = async (sellerId: string) => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase
    .from('v_commissions_available_for_payment')
    .select('*')
    .eq('seller_id', sellerId)
    .maybeSingle();

  if (error) {
    console.error('AVAILABLE FOR PAYMENT ERROR', error);
    throw error;
  }

  return (data as CommissionAvailableForPayment) || null;
};

/**
 * Upload payment proof
 */
export const uploadPaymentProof = async (
  file: File,
  sellerId: string,
  settlementId: string
) => {
  if (!supabase) throw new Error('Supabase not configured');

  const safeName = sanitizeFileName(file.name);
  const proofPath = `${sellerId}/${settlementId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from('commission-proofs')
    .upload(proofPath, file, {
      upsert: false,
      contentType: file.type,
    });

  if (uploadError) {
    console.error('UPLOAD PROOF ERROR', uploadError);
    throw uploadError;
  }

  return proofPath;
};

/**
 * Create signed URL for proof
 */
export const createSignedProofUrl = async (proofPath: string) => {
  if (!supabase) throw new Error('Supabase not configured');

  const { data, error } = await supabase.storage
    .from('commission-proofs')
    .createSignedUrl(proofPath, 300);

  if (error) {
    console.error('SIGNED URL ERROR', error);
    throw error;
  }

  return data.signedUrl;
};
