BEGIN;

-- The deployed payment trigger is authoritative. Refuse to install the direct
-- admin path if that single automatic commission-sync path is not present.
DO $$
DECLARE
  v_trigger_count INTEGER;
  v_sync_trigger_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO v_trigger_count
  FROM pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = 'public.commercial_partner_payments'::REGCLASS
    AND NOT trigger_row.tgisinternal
    AND trigger_row.tgname = 'trg_sync_comodato_payment';

  SELECT COUNT(*)::INTEGER
  INTO v_sync_trigger_count
  FROM pg_trigger AS trigger_row
  JOIN pg_proc AS trigger_function
    ON trigger_function.oid = trigger_row.tgfoid
  WHERE trigger_row.tgrelid = 'public.commercial_partner_payments'::REGCLASS
    AND NOT trigger_row.tgisinternal
    AND LOWER(pg_get_functiondef(trigger_function.oid))
      LIKE '%sync_comodato_commissions_for_movement%';

  IF v_trigger_count <> 1 OR v_sync_trigger_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one deployed Comodato payment sync trigger; found named=%, sync_callers=%',
      v_trigger_count,
      v_sync_trigger_count;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_approved_comodato_payment(
  p_request_id UUID,
  p_partner_id UUID,
  p_movement_id UUID,
  p_payment_date TIMESTAMPTZ,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_proof_path TEXT DEFAULT NULL,
  p_proof_file_name TEXT DEFAULT NULL,
  p_proof_mime_type TEXT DEFAULT NULL,
  p_proof_size_bytes BIGINT DEFAULT NULL
)
RETURNS TABLE (
  request_id UUID,
  folio TEXT,
  approved_payment_id UUID,
  amount NUMERIC,
  status TEXT,
  reviewed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_actor_role TEXT;
  v_actor_is_active BOOLEAN;
  v_method TEXT := LOWER(BTRIM(COALESCE(p_payment_method, '')));
  v_effective_balance NUMERIC;
  v_folio TEXT;
  v_payment_id UUID;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_existing_request public.partner_payment_verification_requests%ROWTYPE;
  v_existing_payment public.commercial_partner_payments%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT profile.role, profile.is_active
  INTO v_actor_role, v_actor_is_active
  FROM public.user_profiles AS profile
  WHERE profile.id = v_actor
  FOR SHARE;

  IF NOT FOUND
    OR v_actor_role IS DISTINCT FROM 'admin'
    OR NOT COALESCE(v_actor_is_active, FALSE) THEN
    RAISE EXCEPTION 'Only active administrators can register approved payments';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id is required as the idempotency key';
  END IF;

  IF p_partner_id IS NULL OR p_movement_id IS NULL THEN
    RAISE EXCEPTION 'partner_id and movement_id are required';
  END IF;

  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'payment_date is required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> ROUND(p_amount, 2) THEN
    RAISE EXCEPTION 'amount must be positive and have at most two decimal places';
  END IF;

  IF v_method NOT IN ('cash', 'transfer') THEN
    RAISE EXCEPTION 'payment_method must be cash or transfer';
  END IF;

  IF v_method = 'transfer' AND NULLIF(BTRIM(p_proof_path), '') IS NULL THEN
    RAISE EXCEPTION 'A transfer payment requires proof';
  END IF;

  IF p_proof_size_bytes IS NOT NULL AND p_proof_size_bytes < 0 THEN
    RAISE EXCEPTION 'proof_size_bytes cannot be negative';
  END IF;

  -- Serialize retries that carry the same client-generated request UUID.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));

  SELECT request.*
  INTO v_existing_request
  FROM public.partner_payment_verification_requests AS request
  WHERE request.id = p_request_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_request.scheme IS DISTINCT FROM 'comodato'
      OR v_existing_request.partner_id IS DISTINCT FROM p_partner_id
      OR v_existing_request.movement_id IS DISTINCT FROM p_movement_id
      OR v_existing_request.payment_date IS DISTINCT FROM p_payment_date
      OR v_existing_request.amount IS DISTINCT FROM ROUND(p_amount, 2)
      OR v_existing_request.payment_method IS DISTINCT FROM v_method
      OR COALESCE(v_existing_request.payment_reference, '')
        <> COALESCE(NULLIF(BTRIM(p_payment_reference), ''), '')
      OR COALESCE(v_existing_request.notes, '') <> COALESCE(NULLIF(BTRIM(p_notes), ''), '')
      OR COALESCE(v_existing_request.proof_path, '')
        <> COALESCE(NULLIF(BTRIM(p_proof_path), ''), '')
      OR COALESCE(v_existing_request.proof_file_name, '')
        <> COALESCE(NULLIF(BTRIM(p_proof_file_name), ''), '')
      OR COALESCE(v_existing_request.proof_mime_type, '')
        <> COALESCE(NULLIF(BTRIM(p_proof_mime_type), ''), '')
      OR v_existing_request.proof_size_bytes IS DISTINCT FROM p_proof_size_bytes
      OR v_existing_request.submitted_by IS DISTINCT FROM v_actor
      OR v_existing_request.reviewed_by IS DISTINCT FROM v_actor
      OR v_existing_request.status IS DISTINCT FROM 'approved'
      OR v_existing_request.approved_payment_id IS NULL THEN
      RAISE EXCEPTION 'request_id was already used for a different or incomplete operation';
    END IF;

    SELECT payment.*
    INTO v_existing_payment
    FROM public.commercial_partner_payments AS payment
    WHERE payment.id = v_existing_request.approved_payment_id
    FOR UPDATE;

    IF NOT FOUND
      OR v_existing_payment.partner_id IS DISTINCT FROM p_partner_id
      OR v_existing_payment.movement_id IS DISTINCT FROM p_movement_id
      OR v_existing_payment.payment_date IS DISTINCT FROM p_payment_date
      OR v_existing_payment.amount IS DISTINCT FROM ROUND(p_amount, 2)
      OR v_existing_payment.payment_method IS DISTINCT FROM v_method
      OR COALESCE(v_existing_payment.reference, '')
        <> COALESCE(NULLIF(BTRIM(p_payment_reference), ''), '')
      OR COALESCE(v_existing_payment.notes, '')
        <> COALESCE(NULLIF(BTRIM(p_notes), ''), '')
      OR v_existing_payment.received_by IS DISTINCT FROM v_actor
      OR LOWER(BTRIM(COALESCE(v_existing_payment.status, ''))) NOT IN ('completed', 'paid') THEN
      RAISE EXCEPTION 'The idempotent request does not have its expected completed payment';
    END IF;

    RETURN QUERY
    SELECT
      v_existing_request.id,
      v_existing_request.folio,
      v_existing_request.approved_payment_id,
      v_existing_request.amount,
      v_existing_request.status,
      v_existing_request.reviewed_at;
    RETURN;
  END IF;

  PERFORM partner.id
  FROM public.commercial_partners AS partner
  WHERE partner.id = p_partner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner not found';
  END IF;

  -- Follow the existing approval RPC lock order (request before movement) so a
  -- concurrent manual approval cannot deadlock with a direct admin payment.
  PERFORM request.id
  FROM public.partner_payment_verification_requests AS request
  WHERE request.scheme = 'comodato'
    AND request.partner_id = p_partner_id
    AND request.movement_id = p_movement_id
    AND LOWER(BTRIM(request.status)) IN ('draft', 'pending_review')
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'This settlement already has an active payment verification request';
  END IF;

  PERFORM movement.id
  FROM public.commercial_partner_movements AS movement
  WHERE movement.id = p_movement_id
    AND movement.partner_id = p_partner_id
    AND LOWER(BTRIM(movement.movement_type)) = 'settlement'
    AND LOWER(BTRIM(movement.status)) = 'completed'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Completed settlement not found or does not belong to this partner';
  END IF;

  -- Lock every row consumed by the effective-balance calculation.
  PERFORM item.id
  FROM public.commercial_partner_movement_items AS item
  WHERE item.movement_id = p_movement_id
  FOR UPDATE;

  PERFORM adjustment.id
  FROM public.commercial_partner_movement_items AS adjustment
  JOIN public.commercial_partner_movement_items AS original
    ON original.id = adjustment.adjusts_movement_item_id
  WHERE original.movement_id = p_movement_id
  FOR UPDATE OF adjustment;

  PERFORM payment.id
  FROM public.commercial_partner_payments AS payment
  WHERE payment.movement_id = p_movement_id
  FOR UPDATE;

  -- Recheck after locking the movement to cover a concurrent request creator
  -- that acquired the movement lock before this transaction.
  PERFORM request.id
  FROM public.partner_payment_verification_requests AS request
  WHERE request.scheme = 'comodato'
    AND request.partner_id = p_partner_id
    AND request.movement_id = p_movement_id
    AND LOWER(BTRIM(request.status)) IN ('draft', 'pending_review')
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'This settlement already has an active payment verification request';
  END IF;

  SELECT public.get_comodato_movement_pending_balance(p_movement_id)
  INTO v_effective_balance;

  IF v_effective_balance IS NULL OR v_effective_balance <= 0.005 THEN
    RAISE EXCEPTION 'This settlement has no effective pending balance';
  END IF;

  IF p_amount > v_effective_balance + 0.005 THEN
    RAISE EXCEPTION 'Amount (%) exceeds current effective balance (%)',
      p_amount,
      v_effective_balance;
  END IF;

  v_folio := public.generate_payment_verification_folio();

  -- trg_sync_comodato_payment performs the single canonical commission sync.
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
    p_partner_id,
    p_movement_id,
    p_payment_date,
    ROUND(p_amount, 2),
    v_method,
    NULLIF(BTRIM(p_payment_reference), ''),
    NULLIF(BTRIM(p_notes), ''),
    v_actor,
    'completed',
    v_now,
    v_now
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.partner_payment_verification_requests (
    id,
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
    proof_path,
    proof_file_name,
    proof_mime_type,
    proof_size_bytes,
    status,
    submitted_by,
    submitted_at,
    reviewed_by,
    reviewed_at,
    review_notes,
    approved_payment_id,
    created_at,
    updated_at
  ) VALUES (
    p_request_id,
    v_folio,
    'comodato',
    p_partner_id,
    p_movement_id,
    NULL,
    ROUND(p_amount, 2),
    p_payment_date,
    v_method,
    NULLIF(BTRIM(p_payment_reference), ''),
    NULLIF(BTRIM(p_notes), ''),
    NULLIF(BTRIM(p_proof_path), ''),
    NULLIF(BTRIM(p_proof_file_name), ''),
    NULLIF(BTRIM(p_proof_mime_type), ''),
    p_proof_size_bytes,
    'approved',
    v_actor,
    v_now,
    v_actor,
    v_now,
    'Pago registrado y aprobado directamente por administrador.',
    v_payment_id,
    v_now,
    v_now
  );

  RETURN QUERY
  SELECT
    p_request_id,
    v_folio,
    v_payment_id,
    ROUND(p_amount, 2),
    'approved'::TEXT,
    v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_approved_comodato_payment(
  UUID, UUID, UUID, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_approved_comodato_payment(
  UUID, UUID, UUID, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_create_approved_comodato_payment(
  UUID, UUID, UUID, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) TO authenticated;

-- v_pending_payment_verifications is security_invoker in the deployed schema;
-- this grant lets authenticated users reach the table while its RLS policies
-- continue limiting sellers to their own requests and administrators to all.
GRANT SELECT ON TABLE public.partner_payment_verification_requests TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
