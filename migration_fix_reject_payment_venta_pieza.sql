-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION: Fix reject_partner_payment_verification_request to handle venta_pieza
-- ═════════════════════════════════════════════════════════════════════════════
-- 
-- PURPOSE:
-- When rejecting a payment verification for scheme='venta_pieza', also update
-- the related seller_piece_sales.status to 'payment_rejected' so the sale can be
-- corrected and re-submitted by the seller.
--
-- CHANGES:
-- 1. Update RPC to include venta_pieza handling
-- 2. When rejecting venta_pieza: mark seller_piece_sales.status = 'payment_rejected'
-- 3. Preserve rejection_reason in request record for audit trail
-- ═════════════════════════════════════════════════════════════════════════════

-- DROP existing function to replace it
DROP FUNCTION IF EXISTS public.reject_partner_payment_verification_request(UUID, TEXT);

-- CREATE UPDATED FUNCTION
CREATE OR REPLACE FUNCTION public.reject_partner_payment_verification_request(
  p_request_id UUID,
  p_rejection_reason TEXT
)
RETURNS TABLE (
  request_id UUID,
  folio TEXT,
  status TEXT,
  rejection_reason TEXT,
  reviewed_at TIMESTAMPTZ
) AS $$
DECLARE
  v_current_user_id UUID;
  v_user_role TEXT;
  v_request_record RECORD;
  v_scheme TEXT;
  v_source_folio TEXT;
BEGIN
  -- Get current user
  v_current_user_id := auth.uid();
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;
  
  -- Get user role
  SELECT role INTO v_user_role FROM public.user_profiles WHERE id = v_current_user_id;
  
  -- Only admin can reject
  IF v_user_role != 'admin' THEN
    RAISE EXCEPTION 'Only administrators can reject payment requests';
  END IF;
  
  -- Validate reason
  IF p_rejection_reason IS NULL OR p_rejection_reason = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;
  
  -- Fetch request
  SELECT * INTO v_request_record FROM public.partner_payment_verification_requests WHERE id = p_request_id;
  
  IF v_request_record IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  
  -- Cannot reject approved requests
  IF v_request_record.status = 'approved' THEN
    RAISE EXCEPTION 'Cannot reject an already approved request';
  END IF;
  
  -- Extract scheme and source_folio for handling venta_pieza
  v_scheme := v_request_record.scheme;
  v_source_folio := v_request_record.source_folio;
  
  -- Update request to rejected
  UPDATE public.partner_payment_verification_requests
  SET
    status = 'rejected',
    reviewed_by = v_current_user_id,
    reviewed_at = NOW(),
    rejection_reason = p_rejection_reason,
    updated_at = NOW()
  WHERE id = p_request_id;
  
  -- If this is a venta_pieza rejection, also mark the sale as payment_rejected
  -- This allows the seller to correct and re-submit the sale
  IF v_scheme = 'venta_pieza' AND v_source_folio IS NOT NULL THEN
    UPDATE public.seller_piece_sales
    SET
      status = 'payment_rejected',
      updated_at = NOW()
    WHERE folio = v_source_folio;
  END IF;
  
  RETURN QUERY SELECT
    p_request_id,
    v_request_record.folio,
    'rejected'::TEXT,
    p_rejection_reason,
    NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Verify the function was created
SELECT 
  p.oid::regprocedure as function_signature,
  p.prokind as kind
FROM pg_proc p
WHERE p.proname = 'reject_partner_payment_verification_request';
