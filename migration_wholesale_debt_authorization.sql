/* ═══════════════════════════════════════════════════════════════════════════════
   MIGRATION: Wholesale Debt Authorization System
   Version: 20260807
   Purpose: Allow vendors with pending comodato debt to activate mayoreo
            and operate in both modalities simultaneously, with admin approval.
   ═════════════════════════════════════════════════════════════════════════════ */

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTIONS: Comodato balance and stock calculations
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_partner_comodato_pending_balance(
  p_partner_id UUID
)
RETURNS NUMERIC AS $$
DECLARE
  v_total_due NUMERIC;
  v_total_paid NUMERIC;
  v_pending_balance NUMERIC;
BEGIN
  -- Calculate total due from completed settlements with quantity_sold > 0
  SELECT COALESCE(SUM(CAST(cpmi.amount_due AS NUMERIC)), 0)
  INTO v_total_due
  FROM public.commercial_partner_movement_items cpmi
  INNER JOIN public.commercial_partner_movements cpm 
    ON cpmi.movement_id = cpm.id
  WHERE cpm.partner_id = p_partner_id
    AND cpm.movement_type = 'settlement'
    AND cpm.status = 'completed'
    AND cpmi.quantity_sold > 0;

  -- Calculate total paid
  SELECT COALESCE(SUM(CAST(cpp.amount AS NUMERIC)), 0)
  INTO v_total_paid
  FROM public.commercial_partner_payments cpp
  WHERE cpp.partner_id = p_partner_id
    AND cpp.status IN ('completed', 'paid');

  -- Calculate pending balance (ensure non-negative)
  v_pending_balance := GREATEST(v_total_due - v_total_paid, 0);

  RETURN v_pending_balance;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.get_partner_comodato_stock_units(
  p_partner_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  v_stock_units INTEGER;
BEGIN
  -- Sum current_quantity from v_commercial_partner_current_stock for the partner
  SELECT COALESCE(SUM(GREATEST(vcpcs.current_quantity::INTEGER, 0)), 0)
  INTO v_stock_units
  FROM public.v_commercial_partner_current_stock vcpcs
  WHERE vcpcs.partner_id = p_partner_id;

  RETURN v_stock_units;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLE: wholesale_debt_authorization_requests
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.wholesale_debt_authorization_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  partner_id UUID NOT NULL
    REFERENCES public.commercial_partners(id) ON DELETE RESTRICT,

  requested_by UUID NOT NULL
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT,

  request_reason TEXT NOT NULL
    CHECK (char_length(request_reason) >= 10),

  comodato_pending_balance_snapshot NUMERIC(12, 2) NOT NULL DEFAULT 0,
  comodato_stock_units_snapshot INTEGER NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'used')),

  reviewed_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  rejection_reason TEXT,

  approved_at TIMESTAMPTZ,

  used_at TIMESTAMPTZ,
  used_contract_id UUID REFERENCES public.commercial_partner_contracts(id) ON DELETE RESTRICT,

  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═════════════════════════════════════════════════════════════════════════════
-- INDEXES: wholesale_debt_authorization_requests
-- ═════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_wholesale_debt_auth_partner_id
  ON public.wholesale_debt_authorization_requests(partner_id);

CREATE INDEX IF NOT EXISTS idx_wholesale_debt_auth_requested_by
  ON public.wholesale_debt_authorization_requests(requested_by);

CREATE INDEX IF NOT EXISTS idx_wholesale_debt_auth_status
  ON public.wholesale_debt_authorization_requests(status);

CREATE INDEX IF NOT EXISTS idx_wholesale_debt_auth_created_at
  ON public.wholesale_debt_authorization_requests(created_at);

CREATE INDEX IF NOT EXISTS idx_wholesale_debt_auth_reviewed_by
  ON public.wholesale_debt_authorization_requests(reviewed_by);

-- Unique partial index: prevent duplicate pending or approved requests per partner
CREATE UNIQUE INDEX IF NOT EXISTS idx_wholesale_debt_auth_unique_active_per_partner
  ON public.wholesale_debt_authorization_requests(partner_id)
  WHERE status IN ('pending', 'approved');

-- ═════════════════════════════════════════════════════════════════════════════
-- VIEW: v_wholesale_debt_authorization_requests
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_wholesale_debt_authorization_requests
WITH (security_invoker = true) AS
SELECT
  wdar.id AS request_id,
  wdar.partner_id,
  cp.folio AS partner_folio,
  cp.business_name,
  cp.partner_model,
  cp.wholesale_status,

  wdar.requested_by,
  up_requested.full_name AS requested_by_name,
  wdar.request_reason,
  wdar.requested_at,

  wdar.comodato_pending_balance_snapshot,
  wdar.comodato_stock_units_snapshot,

  public.get_partner_comodato_pending_balance(wdar.partner_id) AS current_comodato_pending_balance,
  public.get_partner_comodato_stock_units(wdar.partner_id) AS current_comodato_stock_units,

  wdar.status,

  wdar.reviewed_by,
  up_reviewed.full_name AS reviewed_by_name,
  wdar.reviewed_at,
  wdar.review_notes,
  wdar.rejection_reason,

  wdar.approved_at,
  wdar.used_at,
  wdar.used_contract_id,
  wdar.cancelled_at,
  wdar.cancel_reason,

  wdar.created_at,
  wdar.updated_at
FROM public.wholesale_debt_authorization_requests wdar
LEFT JOIN public.commercial_partners cp ON wdar.partner_id = cp.id
LEFT JOIN public.user_profiles up_requested ON wdar.requested_by = up_requested.id
LEFT JOIN public.user_profiles up_reviewed ON wdar.reviewed_by = up_reviewed.id
ORDER BY wdar.created_at DESC;

-- ═════════════════════════════════════════════════════════════════════════════
-- RPC: request_wholesale_debt_authorization
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.request_wholesale_debt_authorization(
  p_partner_id UUID,
  p_reason TEXT
)
RETURNS TABLE (
  request_id UUID,
  status TEXT,
  pending_balance NUMERIC,
  stock_units INTEGER,
  message TEXT
) AS $$
DECLARE
  v_current_user_id UUID;
  v_user_role TEXT;
  v_partner_record RECORD;
  v_pending_balance NUMERIC;
  v_stock_units INTEGER;
  v_request_id UUID;
  v_existing_active RECORD;
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
    RAISE EXCEPTION 'Insufficient permissions to request authorization';
  END IF;

  -- Validate reason
  IF p_reason IS NULL OR char_length(p_reason) < 10 THEN
    RAISE EXCEPTION 'Reason must be at least 10 characters';
  END IF;

  -- Fetch partner
  SELECT * INTO v_partner_record FROM public.commercial_partners WHERE id = p_partner_id;

  IF v_partner_record IS NULL THEN
    RAISE EXCEPTION 'Partner not found';
  END IF;

  -- If socios_comerciales, verify assignment
  IF v_user_role = 'socios_comerciales' THEN
    IF v_partner_record.assigned_to IS NULL OR v_partner_record.assigned_to != v_current_user_id THEN
      RAISE EXCEPTION 'You are not assigned to this partner';
    END IF;
  END IF;

  -- Partner must be comodato model
  IF v_partner_record.partner_model != 'comodato' THEN
    RAISE EXCEPTION 'Partner must be in comodato model to request authorization';
  END IF;

  -- Partner must not already have active mayoreo
  IF v_partner_record.wholesale_status = 'active' THEN
    RAISE EXCEPTION 'Partner already has active mayoreo status';
  END IF;

  -- Check for existing pending or approved request
  SELECT * INTO v_existing_active
  FROM public.wholesale_debt_authorization_requests
  WHERE partner_id = p_partner_id
    AND status IN ('pending', 'approved')
  LIMIT 1;

  IF v_existing_active IS NOT NULL THEN
    RAISE EXCEPTION 'Partner already has an active authorization request';
  END IF;

  -- Calculate current balances
  v_pending_balance := public.get_partner_comodato_pending_balance(p_partner_id);
  v_stock_units := public.get_partner_comodato_stock_units(p_partner_id);

  -- Pending balance must be > 0.005
  IF v_pending_balance <= 0.005 THEN
    RAISE EXCEPTION 'Partner does not have pending comodato balance. Use normal wholesale activation instead.';
  END IF;

  -- Create request
  INSERT INTO public.wholesale_debt_authorization_requests (
    partner_id,
    requested_by,
    request_reason,
    comodato_pending_balance_snapshot,
    comodato_stock_units_snapshot,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_partner_id,
    v_current_user_id,
    p_reason,
    v_pending_balance,
    v_stock_units,
    'pending',
    NOW(),
    NOW()
  )
  RETURNING id INTO v_request_id;

  RETURN QUERY SELECT
    v_request_id,
    'pending'::TEXT,
    v_pending_balance,
    v_stock_units,
    'Authorization request created successfully. Awaiting admin review.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ═════════════════════════════════════════════════════════════════════════════
-- RPC: approve_wholesale_debt_authorization
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.approve_wholesale_debt_authorization(
  p_request_id UUID,
  p_review_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  request_id UUID,
  partner_id UUID,
  status TEXT,
  approved_at TIMESTAMPTZ,
  message TEXT
) AS $$
DECLARE
  v_current_user_id UUID;
  v_user_role TEXT;
  v_request_record RECORD;
  v_partner_record RECORD;
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
    RAISE EXCEPTION 'Only administrators can approve authorization requests';
  END IF;

  -- Fetch request with lock
  SELECT * INTO v_request_record
  FROM public.wholesale_debt_authorization_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_request_record IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  -- Status must be pending
  IF v_request_record.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not in pending status';
  END IF;

  -- Verify partner still exists
  SELECT * INTO v_partner_record FROM public.commercial_partners WHERE id = v_request_record.partner_id;

  IF v_partner_record IS NULL THEN
    RAISE EXCEPTION 'Partner no longer exists';
  END IF;

  -- Partner should not already have active mayoreo
  IF v_partner_record.wholesale_status = 'active' THEN
    RAISE EXCEPTION 'Partner already has active mayoreo';
  END IF;

  -- Update request to approved
  UPDATE public.wholesale_debt_authorization_requests
  SET
    status = 'approved',
    reviewed_by = v_current_user_id,
    reviewed_at = NOW(),
    approved_at = NOW(),
    review_notes = p_review_notes,
    updated_at = NOW()
  WHERE id = p_request_id;

  RETURN QUERY SELECT
    p_request_id,
    v_request_record.partner_id,
    'approved'::TEXT,
    NOW(),
    'Authorization approved. Vendor can now activate mayoreo.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ═════════════════════════════════════════════════════════════════════════════
-- RPC: reject_wholesale_debt_authorization
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reject_wholesale_debt_authorization(
  p_request_id UUID,
  p_rejection_reason TEXT
)
RETURNS TABLE (
  request_id UUID,
  partner_id UUID,
  status TEXT,
  rejection_reason TEXT,
  message TEXT
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
    RAISE EXCEPTION 'Only administrators can reject authorization requests';
  END IF;

  -- Validate reason
  IF p_rejection_reason IS NULL OR char_length(p_rejection_reason) < 5 THEN
    RAISE EXCEPTION 'Rejection reason must be at least 5 characters';
  END IF;

  -- Fetch request
  SELECT * INTO v_request_record
  FROM public.wholesale_debt_authorization_requests
  WHERE id = p_request_id;

  IF v_request_record IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  -- Cannot reject already used or rejected
  IF v_request_record.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Cannot reject request with status: %', v_request_record.status;
  END IF;

  -- Update request to rejected
  UPDATE public.wholesale_debt_authorization_requests
  SET
    status = 'rejected',
    reviewed_by = v_current_user_id,
    reviewed_at = NOW(),
    rejection_reason = p_rejection_reason,
    updated_at = NOW()
  WHERE id = p_request_id;

  RETURN QUERY SELECT
    p_request_id,
    v_request_record.partner_id,
    'rejected'::TEXT,
    p_rejection_reason,
    'Authorization request rejected.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ═════════════════════════════════════════════════════════════════════════════
-- RPC: cancel_wholesale_debt_authorization
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cancel_wholesale_debt_authorization(
  p_request_id UUID,
  p_cancel_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  request_id UUID,
  partner_id UUID,
  status TEXT,
  cancelled_at TIMESTAMPTZ,
  message TEXT
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
  SELECT * INTO v_request_record
  FROM public.wholesale_debt_authorization_requests
  WHERE id = p_request_id;

  IF v_request_record IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  -- Authorization: creator or admin
  IF v_user_role NOT IN ('admin') AND v_request_record.requested_by != v_current_user_id THEN
    RAISE EXCEPTION 'You do not have permission to cancel this request';
  END IF;

  -- Can only cancel pending or approved
  IF v_request_record.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Cannot cancel request with status: %', v_request_record.status;
  END IF;

  -- Update request to cancelled
  UPDATE public.wholesale_debt_authorization_requests
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    cancel_reason = COALESCE(p_cancel_reason, 'Cancelled'),
    updated_at = NOW()
  WHERE id = p_request_id;

  RETURN QUERY SELECT
    p_request_id,
    v_request_record.partner_id,
    'cancelled'::TEXT,
    NOW(),
    'Authorization request cancelled.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ═════════════════════════════════════════════════════════════════════════════
-- FUNCTION: prevent_wholesale_activation_with_comodato_debt (MODIFIED)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prevent_wholesale_activation_with_comodato_debt()
RETURNS TRIGGER AS $$
DECLARE
  v_is_activation_transition BOOLEAN;
  v_pending_balance NUMERIC;
  v_approved_auth RECORD;
BEGIN
  -- Check if this update is transitioning to active wholesale status
  v_is_activation_transition := (
    NEW.wholesale_status = 'active'
    AND (OLD.wholesale_status IS NULL OR OLD.wholesale_status != 'active')
  );

  IF NOT v_is_activation_transition THEN
    RETURN NEW;
  END IF;

  -- Calculate current pending balance using helper
  v_pending_balance := public.get_partner_comodato_pending_balance(NEW.id);

  -- If pending balance <= 0.005, allow normal activation
  IF v_pending_balance <= 0.005 THEN
    RETURN NEW;
  END IF;

  -- If pending balance > 0.005, require an approved authorization
  SELECT * INTO v_approved_auth
  FROM public.wholesale_debt_authorization_requests
  WHERE partner_id = NEW.id
    AND status = 'approved'
    AND used_at IS NULL
  FOR UPDATE
  LIMIT 1;

  IF v_approved_auth IS NULL THEN
    RAISE EXCEPTION
      'Partner must settle comodato debt of $% before activating mayoreo. '
      'If simultaneous operation is needed, request administrator authorization.',
      TO_CHAR(v_pending_balance, '999,999.99');
  END IF;

  -- Authorization exists and is approved; transition will proceed
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure trigger exists and is attached to commercial_partners
DROP TRIGGER IF EXISTS trg_prevent_wholesale_activation_with_debt ON public.commercial_partners;

CREATE TRIGGER trg_prevent_wholesale_activation_with_debt
BEFORE UPDATE ON public.commercial_partners
FOR EACH ROW
EXECUTE FUNCTION public.prevent_wholesale_activation_with_comodato_debt();

-- ═════════════════════════════════════════════════════════════════════════════
-- RPC: activate_wholesale_partner (MODIFIED)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.activate_wholesale_partner(
  p_contract_id UUID
)
RETURNS TABLE (
  partner_id UUID,
  contract_id UUID,
  partner_model TEXT,
  wholesale_status TEXT
) AS $$
DECLARE
  v_current_user_id UUID;
  v_user_role TEXT;
  v_contract_record RECORD;
  v_partner_record RECORD;
  v_pending_balance NUMERIC;
  v_approved_auth RECORD;
BEGIN
  -- Get current user
  v_current_user_id := auth.uid();
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  -- Get user role
  SELECT role INTO v_user_role FROM public.user_profiles WHERE id = v_current_user_id;

  -- Only admin can activate
  IF v_user_role != 'admin' THEN
    RAISE EXCEPTION 'Only administrators can activate wholesale partners';
  END IF;

  -- Fetch contract with all validations
  SELECT * INTO v_contract_record
  FROM public.commercial_partner_contracts
  WHERE id = p_contract_id;

  IF v_contract_record IS NULL THEN
    RAISE EXCEPTION 'Contract not found';
  END IF;

  -- Validate contract status
  IF v_contract_record.contract_status NOT IN ('generated', 'reviewed') THEN
    RAISE EXCEPTION 'Contract status must be generated or reviewed to activate';
  END IF;

  -- Validate required documents
  IF NOT (
    v_contract_record.privacy_consent_signed
    AND v_contract_record.ine_front_uploaded
    AND v_contract_record.ine_back_uploaded
    AND v_contract_record.business_photo_uploaded
    AND v_contract_record.contract_pdf_generated
    AND v_contract_record.contract_signed_uploaded
  ) THEN
    RAISE EXCEPTION 'All required documents must be uploaded before activation';
  END IF;

  -- Fetch partner
  SELECT * INTO v_partner_record FROM public.commercial_partners WHERE id = v_contract_record.partner_id;

  IF v_partner_record IS NULL THEN
    RAISE EXCEPTION 'Partner not found';
  END IF;

  -- Calculate current pending balance
  v_pending_balance := public.get_partner_comodato_pending_balance(v_partner_record.id);

  -- CASE A: Pending balance <= 0.005 — Normal activation
  IF v_pending_balance <= 0.005 THEN
    -- Update contract
    UPDATE public.commercial_partner_contracts
    SET
      contract_status = 'activated',
      activated_at = NOW(),
      activated_by = v_current_user_id,
      reviewed_at = NOW(),
      reviewed_by = v_current_user_id,
      updated_at = NOW()
    WHERE id = p_contract_id;

    -- Update partner to mayoreo-only model
    UPDATE public.commercial_partners
    SET
      partner_model = 'mayoreo',
      wholesale_status = 'active',
      wholesale_activated_at = NOW(),
      wholesale_contract_id = p_contract_id,
      updated_at = NOW()
    WHERE id = v_partner_record.id;

    RETURN QUERY SELECT
      v_partner_record.id,
      p_contract_id,
      'mayoreo'::TEXT,
      'active'::TEXT;

  -- CASE B: Pending balance > 0.005 — Dual activation with authorization
  ELSE
    -- Look for approved authorization
    SELECT * INTO v_approved_auth
    FROM public.wholesale_debt_authorization_requests
    WHERE partner_id = v_partner_record.id
      AND status = 'approved'
      AND used_at IS NULL
    FOR UPDATE
    LIMIT 1;

    IF v_approved_auth IS NULL THEN
      RAISE EXCEPTION
        'Partner has pending comodato balance of $%. '
        'Authorized admin approval required for dual-model activation. '
        'Request authorization from an administrator.',
        TO_CHAR(v_pending_balance, '999,999.99');
    END IF;

    -- Update contract
    UPDATE public.commercial_partner_contracts
    SET
      contract_status = 'activated',
      activated_at = NOW(),
      activated_by = v_current_user_id,
      reviewed_at = NOW(),
      reviewed_by = v_current_user_id,
      updated_at = NOW()
    WHERE id = p_contract_id;

    -- Update partner to dual model: comodato + active mayoreo
    UPDATE public.commercial_partners
    SET
      partner_model = 'comodato',
      wholesale_status = 'active',
      wholesale_activated_at = NOW(),
      wholesale_contract_id = p_contract_id,
      updated_at = NOW()
    WHERE id = v_partner_record.id;

    -- Mark authorization as used
    UPDATE public.wholesale_debt_authorization_requests
    SET
      status = 'used',
      used_at = NOW(),
      used_contract_id = p_contract_id,
      updated_at = NOW()
    WHERE id = v_approved_auth.id;

    RETURN QUERY SELECT
      v_partner_record.id,
      p_contract_id,
      'comodato'::TEXT,
      'active'::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ═════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.wholesale_debt_authorization_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Admins see all requests
CREATE POLICY IF NOT EXISTS "admin_see_all_auth_requests"
  ON public.wholesale_debt_authorization_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Policy: Vendors see own requests and requests for their assigned partners
CREATE POLICY IF NOT EXISTS "vendor_see_own_and_assigned_auth_requests"
  ON public.wholesale_debt_authorization_requests
  FOR SELECT
  USING (
    requested_by = auth.uid()
    OR partner_id IN (
      SELECT id FROM public.commercial_partners
      WHERE assigned_to = auth.uid()
    )
  );

-- Policy: No direct inserts (use RPC)
CREATE POLICY IF NOT EXISTS "no_direct_inserts_auth"
  ON public.wholesale_debt_authorization_requests
  FOR INSERT
  WITH CHECK (false);

-- Policy: No direct updates (use RPC)
CREATE POLICY IF NOT EXISTS "no_direct_updates_auth"
  ON public.wholesale_debt_authorization_requests
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

-- Policy: No direct deletes (use RPC)
CREATE POLICY IF NOT EXISTS "no_direct_deletes_auth"
  ON public.wholesale_debt_authorization_requests
  FOR DELETE
  USING (false);

-- ═════════════════════════════════════════════════════════════════════════════
-- GRANTS
-- ═════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.request_wholesale_debt_authorization(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_wholesale_debt_authorization(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_wholesale_debt_authorization(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_wholesale_debt_authorization(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.reject_wholesale_debt_authorization(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_wholesale_debt_authorization(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_wholesale_debt_authorization(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_wholesale_debt_authorization(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_partner_comodato_pending_balance(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_comodato_pending_balance(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_partner_comodato_stock_units(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_comodato_stock_units(UUID) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- SCHEMA RELOAD NOTIFICATION
-- ═════════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- VALIDATION QUERIES (COMMENTED)
-- ═════════════════════════════════════════════════════════════════════════════

/*

-- 1. Verify table creation
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'wholesale_debt_authorization_requests';

-- 2. Verify view creation
SELECT table_name FROM information_schema.views
WHERE table_schema = 'public' AND table_name = 'v_wholesale_debt_authorization_requests';

-- 3. Verify RPC functions exist
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name IN (
  'request_wholesale_debt_authorization',
  'approve_wholesale_debt_authorization',
  'reject_wholesale_debt_authorization',
  'cancel_wholesale_debt_authorization'
);

-- 4. Verify helpers exist
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name IN (
  'get_partner_comodato_pending_balance',
  'get_partner_comodato_stock_units'
);

-- 5. Verify trigger still exists
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.commercial_partners'::regclass AND tgname = 'trg_prevent_wholesale_activation_with_debt';

-- 6. Verify RLS is enabled
SELECT relname FROM pg_class
WHERE relname = 'wholesale_debt_authorization_requests' AND relrowsecurity = true;

-- 7. Verify activate_wholesale_partner still exists
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'activate_wholesale_partner';

-- 8. Verify commission conversion rules untouched
SELECT rule_id, scheme, product_key FROM public.commission_rules
WHERE scheme = 'conversion' AND product_key = 'comodato_a_mayoreo';

-- 9. Verify commission_events untouched
SELECT COUNT(*) FROM public.commission_events
WHERE source_type = 'conversion_bonus';

-- 10. Verify comodato movements untouched (no inadvertent changes)
SELECT COUNT(*) FROM public.commercial_partner_movements
WHERE movement_type = 'settlement';

*/

