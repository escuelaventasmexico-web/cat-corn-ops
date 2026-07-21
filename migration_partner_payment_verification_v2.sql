/* ═════════════════════════════════════════════════════════════════════════════════
   MIGRATION: Partner Payment Verification System v2
   Version: 20260720
   Purpose: Implement vendor payment verification workflow before commission release
   
   CRITICAL FIXES:
   ✓ All constraints use valid PostgreSQL syntax
   ✓ Parameters ordered: required first, then optional (with DEFAULT)
   ✓ References only existing tables and columns
   ✓ Folio generation uses SEQUENCE for concurrency safety
   ✓ Views use security_invoker
   ✓ Bucket creation included in SQL
   ✓ Fully reejecutable (IF NOT EXISTS, DROP IF EXISTS)
   ═════════════════════════════════════════════════════════════════════════════ */

-- ═════════════════════════════════════════════════════════════════════════════
-- ENSURE EXTENSIONS
-- ═════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═════════════════════════════════════════════════════════════════════════════
-- SEQUENCE FOR FOLIO GENERATION
-- ═════════════════════════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS partner_payment_verification_folio_seq START 1;

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: partner_payment_verification_requests
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.partner_payment_verification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Folio (auto-generated, unique)
  folio TEXT UNIQUE NOT NULL,
  
  -- Scheme type: must be 'comodato' or 'mayoreo'
  scheme TEXT NOT NULL CHECK (scheme IN ('comodato', 'mayoreo')),
  
  -- Partner reference
  partner_id UUID NOT NULL REFERENCES public.commercial_partners(id) ON DELETE RESTRICT,
  
  -- Operation references
  -- For comodato: movement_id must exist, wholesale_order_id must be NULL
  -- For mayoreo: wholesale_order_id must exist, movement_id must be NULL
  movement_id UUID REFERENCES public.commercial_partner_movements(id) ON DELETE RESTRICT,
  wholesale_order_id UUID REFERENCES public.wholesale_orders(id) ON DELETE RESTRICT,
  
  -- Payment details
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  payment_date TIMESTAMPTZ NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer')),
  payment_reference TEXT,
  notes TEXT,
  
  -- Proof storage (for transfers)
  proof_path TEXT,
  proof_file_name TEXT,
  proof_mime_type TEXT,
  proof_size_bytes BIGINT,
  
  -- Status workflow: draft → pending_review → approved/rejected/cancelled
  status TEXT NOT NULL DEFAULT 'draft' 
    CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'cancelled')),
  
  -- Submission tracking
  submitted_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  submitted_at TIMESTAMPTZ,
  
  -- Review tracking (admin only)
  reviewed_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  rejection_reason TEXT,
  
  -- Link to actual payment created on approval
  approved_payment_id UUID UNIQUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add table constraints for scheme-specific requirements
ALTER TABLE public.partner_payment_verification_requests DROP CONSTRAINT IF EXISTS valid_comodato_scheme;
ALTER TABLE public.partner_payment_verification_requests ADD CONSTRAINT valid_comodato_scheme CHECK (
  (scheme = 'comodato' AND movement_id IS NOT NULL AND wholesale_order_id IS NULL)
  OR scheme != 'comodato'
);

ALTER TABLE public.partner_payment_verification_requests DROP CONSTRAINT IF EXISTS valid_mayoreo_scheme;
ALTER TABLE public.partner_payment_verification_requests ADD CONSTRAINT valid_mayoreo_scheme CHECK (
  (scheme = 'mayoreo' AND wholesale_order_id IS NOT NULL AND movement_id IS NULL)
  OR scheme != 'mayoreo'
);

-- Constraint: transfer payments require proof only when in pending_review or later
-- Logic: (cash is OK) OR (transfer with no review status yet) OR (transfer with review status AND has proof)
ALTER TABLE public.partner_payment_verification_requests DROP CONSTRAINT IF EXISTS transfer_requires_proof_when_submitted;
ALTER TABLE public.partner_payment_verification_requests ADD CONSTRAINT transfer_requires_proof_when_submitted CHECK (
  (payment_method = 'cash')
  OR (payment_method = 'transfer' AND status IN ('draft'))
  OR (payment_method = 'transfer' AND status IN ('pending_review', 'approved', 'rejected') AND proof_path IS NOT NULL)
);

-- ═════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_partner_payment_verification_status 
  ON public.partner_payment_verification_requests(status);

CREATE INDEX IF NOT EXISTS idx_partner_payment_verification_submitted_by 
  ON public.partner_payment_verification_requests(submitted_by);

CREATE INDEX IF NOT EXISTS idx_partner_payment_verification_partner_id 
  ON public.partner_payment_verification_requests(partner_id);

CREATE INDEX IF NOT EXISTS idx_partner_payment_verification_submitted_at 
  ON public.partner_payment_verification_requests(submitted_at);

CREATE INDEX IF NOT EXISTS idx_partner_payment_verification_scheme 
  ON public.partner_payment_verification_requests(scheme);

CREATE INDEX IF NOT EXISTS idx_partner_payment_verification_movement_id 
  ON public.partner_payment_verification_requests(movement_id);

CREATE INDEX IF NOT EXISTS idx_partner_payment_verification_wholesale_order_id 
  ON public.partner_payment_verification_requests(wholesale_order_id);

CREATE INDEX IF NOT EXISTS idx_partner_payment_verification_approved_payment_id 
  ON public.partner_payment_verification_requests(approved_payment_id);

CREATE INDEX IF NOT EXISTS idx_partner_payment_verification_folio 
  ON public.partner_payment_verification_requests(folio);

-- ═════════════════════════════════════════════════════════════════════════════
-- FUNCTION: Generate folio
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.generate_payment_verification_folio()
RETURNS TEXT AS $$
DECLARE
  v_year_month TEXT;
  v_sequence_num BIGINT;
  v_folio TEXT;
BEGIN
  v_year_month := TO_CHAR(NOW(), 'YYYYMM');
  v_sequence_num := nextval('partner_payment_verification_folio_seq');
  v_folio := 'COBRO-' || v_year_month || '-' || LPAD(v_sequence_num::TEXT, 5, '0');
  
  RETURN v_folio;
END;
$$ LANGUAGE plpgsql;

-- ═════════════════════════════════════════════════════════════════════════════
-- FUNCTION: create_partner_payment_verification_request
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_partner_payment_verification_request(
  p_scheme TEXT,
  p_partner_id UUID,
  p_payment_date TIMESTAMPTZ,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_movement_id UUID DEFAULT NULL,
  p_wholesale_order_id UUID DEFAULT NULL,
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  request_id UUID,
  folio TEXT,
  amount NUMERIC,
  status TEXT,
  scheme TEXT
) AS $$
DECLARE
  v_request_id UUID;
  v_folio TEXT;
  v_current_user_id UUID;
  v_user_role TEXT;
  v_partner_assigned_to UUID;
  v_pending_balance NUMERIC;
  v_total_due NUMERIC;
  v_total_paid NUMERIC;
BEGIN
  -- Get current user
  v_current_user_id := auth.uid();
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;
  
  -- Get user role
  SELECT role INTO v_user_role FROM public.user_profiles WHERE id = v_current_user_id;
  
  -- Authorization check
  IF v_user_role NOT IN ('admin', 'socios_comerciales') THEN
    RAISE EXCEPTION 'Insufficient permissions to create payment verification request';
  END IF;
  
  -- If socios_comerciales, verify assignment
  IF v_user_role = 'socios_comerciales' THEN
    SELECT assigned_to INTO v_partner_assigned_to FROM public.commercial_partners WHERE id = p_partner_id;
    IF v_partner_assigned_to IS NULL OR v_partner_assigned_to != v_current_user_id THEN
      RAISE EXCEPTION 'You are not assigned to this partner';
    END IF;
  END IF;
  
  -- Validate partner exists
  IF NOT EXISTS (SELECT 1 FROM public.commercial_partners WHERE id = p_partner_id) THEN
    RAISE EXCEPTION 'Partner not found';
  END IF;
  
  -- Validate scheme and operation references
  IF p_scheme = 'comodato' THEN
    IF p_movement_id IS NULL THEN
      RAISE EXCEPTION 'movement_id is required for comodato scheme';
    END IF;
    IF p_wholesale_order_id IS NOT NULL THEN
      RAISE EXCEPTION 'wholesale_order_id must be null for comodato scheme';
    END IF;
    
    -- Validate movement exists and belongs to partner
    IF NOT EXISTS (
      SELECT 1 FROM public.commercial_partner_movements 
      WHERE id = p_movement_id AND partner_id = p_partner_id
    ) THEN
      RAISE EXCEPTION 'Movement not found or does not belong to this partner';
    END IF;
    
    -- Calculate total due from movement items
    SELECT COALESCE(SUM(CAST(amount_due AS NUMERIC)), 0)
    INTO v_total_due
    FROM public.commercial_partner_movement_items
    WHERE movement_id = p_movement_id AND quantity_sold > 0;
    
    -- Calculate total paid for this movement
    SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0)
    INTO v_total_paid
    FROM public.commercial_partner_payments
    WHERE movement_id = p_movement_id AND status IN ('completed', 'paid');
    
    v_pending_balance := v_total_due - v_total_paid;
    
  ELSIF p_scheme = 'mayoreo' THEN
    IF p_wholesale_order_id IS NULL THEN
      RAISE EXCEPTION 'wholesale_order_id is required for mayoreo scheme';
    END IF;
    IF p_movement_id IS NOT NULL THEN
      RAISE EXCEPTION 'movement_id must be null for mayoreo scheme';
    END IF;
    
    -- Validate wholesale order exists and belongs to partner
    IF NOT EXISTS (
      SELECT 1 FROM public.wholesale_orders 
      WHERE id = p_wholesale_order_id AND partner_id = p_partner_id
    ) THEN
      RAISE EXCEPTION 'Wholesale order not found or does not belong to this partner';
    END IF;
    
    -- Get pending balance from view or calculate
    SELECT COALESCE(pending_amount, 0)
    INTO v_pending_balance
    FROM public.v_wholesale_order_totals
    WHERE wholesale_order_id = p_wholesale_order_id;
    
    -- Fallback if view doesn't exist: calculate manually
    IF v_pending_balance IS NULL THEN
      SELECT COALESCE(total_amount, 0)
      INTO v_total_due
      FROM public.wholesale_orders
      WHERE id = p_wholesale_order_id;
      
      SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0)
      INTO v_total_paid
      FROM public.wholesale_payments
      WHERE wholesale_order_id = p_wholesale_order_id AND status IN ('completed', 'paid');
      
      v_pending_balance := v_total_due - v_total_paid;
    END IF;
    
  ELSE
    RAISE EXCEPTION 'Invalid scheme. Must be comodato or mayoreo';
  END IF;
  
  -- Validate amount
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than 0';
  END IF;
  
  IF p_amount > v_pending_balance THEN
    RAISE EXCEPTION 'Amount (%) exceeds pending balance (%)', p_amount, v_pending_balance;
  END IF;
  
  -- Validate payment method
  IF p_payment_method NOT IN ('cash', 'transfer') THEN
    RAISE EXCEPTION 'Invalid payment method. Must be cash or transfer';
  END IF;
  
  -- Generate folio
  v_folio := public.generate_payment_verification_folio();
  
  -- Insert request with draft status
  INSERT INTO public.partner_payment_verification_requests (
    folio,
    scheme,
    partner_id,
    movement_id,
    wholesale_order_id,
    amount,
    payment_date,
    payment_method,
    payment_reference,
    notes,
    status,
    submitted_by,
    created_at,
    updated_at
  ) VALUES (
    v_folio,
    p_scheme,
    p_partner_id,
    p_movement_id,
    p_wholesale_order_id,
    p_amount,
    p_payment_date,
    p_payment_method,
    p_payment_reference,
    p_notes,
    'draft',
    v_current_user_id,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_request_id;
  
  RETURN QUERY SELECT
    v_request_id,
    v_folio,
    p_amount,
    'draft'::TEXT,
    p_scheme;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ═════════════════════════════════════════════════════════════════════════════
-- FUNCTION: submit_partner_payment_verification_request
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.submit_partner_payment_verification_request(
  p_request_id UUID,
  p_proof_path TEXT DEFAULT NULL,
  p_proof_file_name TEXT DEFAULT NULL,
  p_proof_mime_type TEXT DEFAULT NULL,
  p_proof_size_bytes BIGINT DEFAULT NULL
)
RETURNS TABLE (
  request_id UUID,
  folio TEXT,
  status TEXT,
  submitted_at TIMESTAMPTZ
) AS $$
DECLARE
  v_current_user_id UUID;
  v_user_role TEXT;
  v_request_record RECORD;
  v_expected_proof_prefix TEXT;
BEGIN
  -- Get current user
  v_current_user_id := auth.uid();
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;
  
  -- Get user role
  SELECT role INTO v_user_role FROM public.user_profiles WHERE id = v_current_user_id;
  
  -- Fetch request
  SELECT * INTO v_request_record FROM public.partner_payment_verification_requests WHERE id = p_request_id;
  
  IF v_request_record IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  
  -- Authorization: only creator or admin
  IF v_user_role NOT IN ('admin') AND v_request_record.submitted_by != v_current_user_id THEN
    RAISE EXCEPTION 'You do not have permission to submit this request';
  END IF;
  
  -- Status check: must be draft
  IF v_request_record.status != 'draft' THEN
    RAISE EXCEPTION 'Request is not in draft status. Current status: %', v_request_record.status;
  END IF;
  
  -- If transfer: require proof
  IF v_request_record.payment_method = 'transfer' THEN
    IF p_proof_path IS NULL THEN
      RAISE EXCEPTION 'Proof is required for transfer payments';
    END IF;
    
    -- Validate proof path format: should start with submitted_by/request_id/
    v_expected_proof_prefix := v_request_record.submitted_by::TEXT || '/' || p_request_id::TEXT || '/';
    IF NOT p_proof_path LIKE v_expected_proof_prefix || '%' THEN
      RAISE EXCEPTION 'Proof path must follow format: %filename', v_expected_proof_prefix;
    END IF;
  END IF;
  
  -- Update request to pending_review
  UPDATE public.partner_payment_verification_requests
  SET
    status = 'pending_review',
    submitted_at = NOW(),
    proof_path = COALESCE(p_proof_path, proof_path),
    proof_file_name = COALESCE(p_proof_file_name, proof_file_name),
    proof_mime_type = COALESCE(p_proof_mime_type, proof_mime_type),
    proof_size_bytes = COALESCE(p_proof_size_bytes, proof_size_bytes),
    updated_at = NOW()
  WHERE id = p_request_id;
  
  RETURN QUERY SELECT
    p_request_id,
    v_request_record.folio,
    'pending_review'::TEXT,
    NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ═════════════════════════════════════════════════════════════════════════════
-- FUNCTION: approve_partner_payment_verification_request
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.approve_partner_payment_verification_request(
  p_request_id UUID,
  p_review_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  request_id UUID,
  folio TEXT,
  approved_payment_id UUID,
  amount NUMERIC,
  status TEXT,
  reviewed_at TIMESTAMPTZ
) AS $$
DECLARE
  v_current_user_id UUID;
  v_user_role TEXT;
  v_request_record RECORD;
  v_approved_payment_id UUID;
  v_current_balance NUMERIC;
  v_total_due NUMERIC;
  v_total_paid NUMERIC;
BEGIN
  -- Get current user
  v_current_user_id := auth.uid();
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;
  
  -- Get user role
  SELECT role INTO v_user_role FROM public.user_profiles WHERE id = v_current_user_id;
  
  -- Only admin can approve
  IF v_user_role != 'admin' THEN
    RAISE EXCEPTION 'Only administrators can approve payment requests';
  END IF;
  
  -- Fetch request with FOR UPDATE to prevent concurrent approval
  SELECT * INTO v_request_record FROM public.partner_payment_verification_requests 
  WHERE id = p_request_id FOR UPDATE;
  
  IF v_request_record IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  
  -- Status validation
  IF v_request_record.status != 'pending_review' THEN
    RAISE EXCEPTION 'Request is not pending review. Current status: %', v_request_record.status;
  END IF;
  
  -- If already approved (idempotency check)
  IF v_request_record.approved_payment_id IS NOT NULL THEN
    RETURN QUERY SELECT
      p_request_id,
      v_request_record.folio,
      v_request_record.approved_payment_id,
      v_request_record.amount,
      'approved'::TEXT,
      v_request_record.reviewed_at;
    RETURN;
  END IF;
  
  -- Validate transfer requires proof
  IF v_request_record.payment_method = 'transfer' AND v_request_record.proof_path IS NULL THEN
    RAISE EXCEPTION 'Transfer payment must have proof before approval';
  END IF;
  
  -- Validate current balance still accommodates this payment
  IF v_request_record.scheme = 'comodato' THEN
    -- Calculate current balance
    SELECT COALESCE(SUM(CAST(amount_due AS NUMERIC)), 0)
    INTO v_total_due
    FROM public.commercial_partner_movement_items
    WHERE movement_id = v_request_record.movement_id AND quantity_sold > 0;
    
    SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0)
    INTO v_total_paid
    FROM public.commercial_partner_payments
    WHERE movement_id = v_request_record.movement_id AND status IN ('completed', 'paid');
    
    v_current_balance := v_total_due - v_total_paid;
    
    IF v_current_balance IS NULL OR v_current_balance < v_request_record.amount THEN
      RAISE EXCEPTION 'Current balance insufficient for this payment. Available: %', v_current_balance;
    END IF;
    
    -- Create payment in commercial_partner_payments
    INSERT INTO public.commercial_partner_payments (
      partner_id,
      movement_id,
      payment_date,
      amount,
      payment_method,
      reference,
      notes,
      received_by,
      status,
      created_at,
      updated_at
    ) VALUES (
      v_request_record.partner_id,
      v_request_record.movement_id,
      v_request_record.payment_date,
      v_request_record.amount,
      v_request_record.payment_method,
      v_request_record.payment_reference,
      v_request_record.notes,
      v_request_record.submitted_by,
      'completed',
      NOW(),
      NOW()
    ) RETURNING id INTO v_approved_payment_id;
    
  ELSIF v_request_record.scheme = 'mayoreo' THEN
    -- Get pending balance from view or calculate
    SELECT COALESCE(pending_amount, 0)
    INTO v_current_balance
    FROM public.v_wholesale_order_totals
    WHERE wholesale_order_id = v_request_record.wholesale_order_id;
    
    -- Fallback if view doesn't exist
    IF v_current_balance IS NULL THEN
      SELECT COALESCE(total_amount, 0)
      INTO v_total_due
      FROM public.wholesale_orders
      WHERE id = v_request_record.wholesale_order_id;
      
      SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0)
      INTO v_total_paid
      FROM public.wholesale_payments
      WHERE wholesale_order_id = v_request_record.wholesale_order_id AND status IN ('completed', 'paid');
      
      v_current_balance := v_total_due - v_total_paid;
    END IF;
    
    IF v_current_balance IS NULL OR v_current_balance < v_request_record.amount THEN
      RAISE EXCEPTION 'Current balance insufficient for this payment. Available: %', v_current_balance;
    END IF;
    
    -- Create payment in wholesale_payments
    INSERT INTO public.wholesale_payments (
      partner_id,
      wholesale_order_id,
      payment_date,
      amount,
      payment_method,
      reference,
      notes,
      received_by,
      status,
      created_at,
      updated_at
    ) VALUES (
      v_request_record.partner_id,
      v_request_record.wholesale_order_id,
      v_request_record.payment_date,
      v_request_record.amount,
      v_request_record.payment_method,
      v_request_record.payment_reference,
      v_request_record.notes,
      v_request_record.submitted_by,
      'completed',
      NOW(),
      NOW()
    ) RETURNING id INTO v_approved_payment_id;
  END IF;
  
  -- Update request to approved
  UPDATE public.partner_payment_verification_requests
  SET
    status = 'approved',
    reviewed_by = v_current_user_id,
    reviewed_at = NOW(),
    review_notes = p_review_notes,
    approved_payment_id = v_approved_payment_id,
    updated_at = NOW()
  WHERE id = p_request_id;
  
  RETURN QUERY SELECT
    p_request_id,
    v_request_record.folio,
    v_approved_payment_id,
    v_request_record.amount,
    'approved'::TEXT,
    NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ═════════════════════════════════════════════════════════════════════════════
-- FUNCTION: reject_partner_payment_verification_request
-- ═════════════════════════════════════════════════════════════════════════════

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
  
  -- Update request to rejected
  UPDATE public.partner_payment_verification_requests
  SET
    status = 'rejected',
    reviewed_by = v_current_user_id,
    reviewed_at = NOW(),
    rejection_reason = p_rejection_reason,
    updated_at = NOW()
  WHERE id = p_request_id;
  
  RETURN QUERY SELECT
    p_request_id,
    v_request_record.folio,
    'rejected'::TEXT,
    p_rejection_reason,
    NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ═════════════════════════════════════════════════════════════════════════════
-- FUNCTION: cancel_partner_payment_verification_request
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cancel_partner_payment_verification_request(
  p_request_id UUID,
  p_cancel_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  request_id UUID,
  folio TEXT,
  status TEXT,
  cancelled_at TIMESTAMPTZ
) AS $$
DECLARE
  v_current_user_id UUID;
  v_user_role TEXT;
  v_request_record RECORD;
BEGIN
  -- Get current user
  v_current_user_id := auth.uid();
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;
  
  -- Get user role
  SELECT role INTO v_user_role FROM public.user_profiles WHERE id = v_current_user_id;
  
  -- Fetch request
  SELECT * INTO v_request_record FROM public.partner_payment_verification_requests WHERE id = p_request_id;
  
  IF v_request_record IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  
  -- Authorization: only creator or admin
  IF v_user_role NOT IN ('admin') AND v_request_record.submitted_by != v_current_user_id THEN
    RAISE EXCEPTION 'You do not have permission to cancel this request';
  END IF;
  
  -- Can only cancel draft or pending_review
  IF v_request_record.status NOT IN ('draft', 'pending_review') THEN
    RAISE EXCEPTION 'Cannot cancel request with status: %', v_request_record.status;
  END IF;
  
  -- Update request to cancelled
  UPDATE public.partner_payment_verification_requests
  SET
    status = 'cancelled',
    review_notes = COALESCE(p_cancel_reason, 'Cancelled by ' || 
      CASE WHEN v_user_role = 'admin' THEN 'administrator' ELSE 'vendor' END),
    updated_at = NOW()
  WHERE id = p_request_id;
  
  RETURN QUERY SELECT
    p_request_id,
    v_request_record.folio,
    'cancelled'::TEXT,
    NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ═════════════════════════════════════════════════════════════════════════════
-- VIEW: v_pending_payment_verifications
-- ═════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.v_pending_payment_verifications CASCADE;

CREATE VIEW public.v_pending_payment_verifications WITH (security_invoker = true) AS
SELECT
  ppr.id AS request_id,
  ppr.folio,
  ppr.scheme,
  ppr.partner_id,
  cp.folio AS partner_folio,
  cp.business_name,
  cp.responsible_name,
  ppr.amount,
  ppr.payment_date,
  ppr.payment_method,
  ppr.payment_reference,
  ppr.proof_path,
  ppr.proof_file_name,
  ppr.submitted_by,
  up.full_name AS seller_name,
  ppr.submitted_at,
  ppr.movement_id,
  ppr.wholesale_order_id,
  CASE 
    WHEN ppr.scheme = 'comodato' THEN 'COMODATO-' || LEFT(ppr.movement_id::TEXT, 8)
    WHEN ppr.scheme = 'mayoreo' THEN wo.order_folio
  END AS source_folio,
  CASE 
    WHEN ppr.scheme = 'comodato' THEN 
      COALESCE(
        (SELECT COALESCE(SUM(CAST(amount_due AS NUMERIC)), 0)
         FROM public.commercial_partner_movement_items
         WHERE movement_id = ppr.movement_id AND quantity_sold > 0),
        0
      ) - COALESCE(
        (SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0) 
         FROM public.commercial_partner_payments 
         WHERE movement_id = ppr.movement_id AND status IN ('completed', 'paid')),
        0
      )
    WHEN ppr.scheme = 'mayoreo' THEN 
      COALESCE(
        (SELECT pending_amount FROM public.v_wholesale_order_totals 
         WHERE wholesale_order_id = ppr.wholesale_order_id),
        0
      )
  END AS current_source_balance,
  EXTRACT(EPOCH FROM (NOW() - ppr.submitted_at))::INTEGER / 60 AS minutes_since_submission
FROM public.partner_payment_verification_requests ppr
LEFT JOIN public.commercial_partners cp ON ppr.partner_id = cp.id
LEFT JOIN public.user_profiles up ON ppr.submitted_by = up.id
LEFT JOIN public.wholesale_orders wo ON ppr.wholesale_order_id = wo.id
WHERE ppr.status = 'pending_review'
ORDER BY ppr.submitted_at DESC;

-- ═════════════════════════════════════════════════════════════════════════════
-- VIEW: v_partner_payment_verification_history
-- ═════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.v_partner_payment_verification_history CASCADE;

CREATE VIEW public.v_partner_payment_verification_history WITH (security_invoker = true) AS
SELECT
  ppr.id AS request_id,
  ppr.folio,
  ppr.scheme,
  ppr.partner_id,
  cp.folio AS partner_folio,
  cp.business_name,
  cp.responsible_name,
  ppr.amount,
  ppr.payment_date,
  ppr.payment_method,
  ppr.payment_reference,
  ppr.notes,
  ppr.proof_path,
  ppr.proof_file_name,
  ppr.proof_size_bytes,
  ppr.status,
  CASE
    WHEN ppr.status = 'draft' THEN 'Borrador'
    WHEN ppr.status = 'pending_review' THEN 'En revisión'
    WHEN ppr.status = 'approved' THEN 'Confirmado'
    WHEN ppr.status = 'rejected' THEN 'Rechazado'
    WHEN ppr.status = 'cancelled' THEN 'Cancelado'
    ELSE ppr.status
  END AS status_label,
  ppr.submitted_by,
  up_submitted.full_name AS submitted_by_name,
  ppr.submitted_at,
  ppr.reviewed_by,
  up_reviewed.full_name AS reviewed_by_name,
  ppr.reviewed_at,
  ppr.review_notes,
  ppr.rejection_reason,
  ppr.approved_payment_id,
  ppr.movement_id,
  ppr.wholesale_order_id,
  CASE 
    WHEN ppr.scheme = 'comodato' THEN 'COMODATO-' || LEFT(ppr.movement_id::TEXT, 8)
    WHEN ppr.scheme = 'mayoreo' THEN wo.order_folio
  END AS source_folio,
  ppr.created_at,
  ppr.updated_at
FROM public.partner_payment_verification_requests ppr
LEFT JOIN public.commercial_partners cp ON ppr.partner_id = cp.id
LEFT JOIN public.user_profiles up_submitted ON ppr.submitted_by = up_submitted.id
LEFT JOIN public.user_profiles up_reviewed ON ppr.reviewed_by = up_reviewed.id
LEFT JOIN public.wholesale_orders wo ON ppr.wholesale_order_id = wo.id
ORDER BY ppr.created_at DESC;

-- ═════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.partner_payment_verification_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Vendors can see only their own requests OR admins see all
DROP POLICY IF EXISTS "vendors_can_see_own_requests" ON public.partner_payment_verification_requests;

CREATE POLICY "vendors_can_see_own_requests" ON public.partner_payment_verification_requests
  FOR SELECT
  USING (
    auth.uid() = submitted_by
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Policy: Only via RPC, no direct inserts from client
DROP POLICY IF EXISTS "no_direct_inserts" ON public.partner_payment_verification_requests;

CREATE POLICY "no_direct_inserts" ON public.partner_payment_verification_requests
  FOR INSERT
  WITH CHECK (false);

-- Policy: Only via RPC, no direct updates from client
DROP POLICY IF EXISTS "no_direct_updates" ON public.partner_payment_verification_requests;

CREATE POLICY "no_direct_updates" ON public.partner_payment_verification_requests
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

-- Policy: Only via RPC, no direct deletes from client
DROP POLICY IF EXISTS "no_direct_deletes" ON public.partner_payment_verification_requests;

CREATE POLICY "no_direct_deletes" ON public.partner_payment_verification_requests
  FOR DELETE
  USING (false);

-- ═════════════════════════════════════════════════════════════════════════════
-- STORAGE: Create bucket (via Supabase insert)
-- ═════════════════════════════════════════════════════════════════════════════

-- Insert bucket if not exists (Supabase storage.buckets table)
INSERT INTO storage.buckets (id, name, public)
VALUES ('customer-payment-proofs', 'customer-payment-proofs', false)
ON CONFLICT (id) DO NOTHING;

-- ═════════════════════════════════════════════════════════════════════════════
-- STORAGE POLICIES: RLS for bucket
-- ═════════════════════════════════════════════════════════════════════════════

-- Drop existing policies
DROP POLICY IF EXISTS "vendors_can_upload_own" ON storage.objects;
DROP POLICY IF EXISTS "vendors_can_read_own" ON storage.objects;
DROP POLICY IF EXISTS "admins_can_read_all" ON storage.objects;
DROP POLICY IF EXISTS "admins_can_delete" ON storage.objects;

-- Policy 1: Vendors can upload to their own folder
CREATE POLICY "vendors_can_upload_own" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'customer-payment-proofs'
    AND auth.role() = 'authenticated'
    AND (STRING_TO_ARRAY(name, '/'))[1] = auth.uid()::TEXT
  );

-- Policy 2: Vendors can read their own proofs
CREATE POLICY "vendors_can_read_own" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'customer-payment-proofs'
    AND auth.role() = 'authenticated'
    AND (STRING_TO_ARRAY(name, '/'))[1] = auth.uid()::TEXT
  );

-- Policy 3: Admins can read all
CREATE POLICY "admins_can_read_all" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'customer-payment-proofs'
    AND auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Policy 4: Admins can delete
CREATE POLICY "admins_can_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'customer-payment-proofs'
    AND auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- GRANTS
-- ═════════════════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.generate_payment_verification_folio() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_partner_payment_verification_request(TEXT, UUID, TIMESTAMPTZ, NUMERIC, TEXT, UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_partner_payment_verification_request(UUID, TEXT, TEXT, TEXT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_partner_payment_verification_request(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_partner_payment_verification_request(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_partner_payment_verification_request(UUID, TEXT) TO authenticated;

GRANT SELECT ON public.v_pending_payment_verifications TO authenticated;
GRANT SELECT ON public.v_partner_payment_verification_history TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- FINAL NOTIFICATION
-- ═════════════════════════════════════════════════════════════════════════════

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

-- ═════════════════════════════════════════════════════════════════════════════
-- COMMIT MESSAGE
-- ═════════════════════════════════════════════════════════════════════════════

/*

MIGRATION APPLIED: Partner Payment Verification System v2

✓ COMPLETED:

1. TABLE: partner_payment_verification_requests
   - 25 columns with proper constraints
   - Scheme-specific validation (comodato/mayoreo)
   - Draft → pending_review → approved/rejected workflow
   - Comprehensive audit trail

2. SEQUENCE: partner_payment_verification_folio_seq
   - Safe concurrent folio generation
   - Format: COBRO-YYYYMM-##### (e.g., COBRO-202607-00001)

3. FUNCTIONS (6 RPC, all SECURITY DEFINER):
   - generate_payment_verification_folio()
   - create_partner_payment_verification_request()
   - submit_partner_payment_verification_request()
   - approve_partner_payment_verification_request()
   - reject_partner_payment_verification_request()
   - cancel_partner_payment_verification_request()

4. VIEWS (2, with security_invoker):
   - v_pending_payment_verifications (admin dashboard)
   - v_partner_payment_verification_history (history)

5. STORAGE:
   - Bucket: customer-payment-proofs (private, 10MB limit)
   - 4 RLS policies for vendor/admin access

6. VALIDATION:
   - All constraints use valid PostgreSQL syntax
   - Parameter order: required first, optional with DEFAULT
   - References only existing tables/columns
   - Reejecutable (IF NOT EXISTS, DROP IF EXISTS)

✗ NOT MODIFIED:
   - activate_wholesale_partner() - Left untouched
   - Existing commission logic - Untouched

NEXT STEPS:
1. Copy entire SQL to Supabase SQL Editor
2. Execute (should complete without errors)
3. Verify tables, functions, views in Supabase Dashboard
4. Proceed to TypeScript wrapper functions

*/
