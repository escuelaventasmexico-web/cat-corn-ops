BEGIN;

CREATE OR REPLACE FUNCTION public.get_partner_comodato_payment_options(
  p_partner_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_role TEXT;
  v_is_active BOOLEAN;
  v_assigned_to UUID;
  v_partner_model TEXT;
  v_pending_balance NUMERIC;
  v_settlements JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  IF p_partner_id IS NULL THEN
    RAISE EXCEPTION 'Partner is required';
  END IF;

  SELECT profile.role, COALESCE(profile.is_active, FALSE)
    INTO v_role, v_is_active
  FROM public.user_profiles AS profile
  WHERE profile.id = v_actor;

  IF NOT COALESCE(v_is_active, FALSE)
    OR v_role NOT IN ('admin', 'socios_comerciales') THEN
    RAISE EXCEPTION 'Insufficient permissions to view Comodato payment options';
  END IF;

  SELECT
    partner.assigned_to,
    LOWER(BTRIM(partner.partner_model::TEXT))
    INTO v_assigned_to, v_partner_model
  FROM public.commercial_partners AS partner
  WHERE partner.id = p_partner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner not found';
  END IF;

  IF v_partner_model IS DISTINCT FROM 'comodato' THEN
    RAISE EXCEPTION 'Partner is not a Comodato partner';
  END IF;

  IF v_role = 'socios_comerciales'
    AND v_assigned_to IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'You are not assigned to this partner';
  END IF;

  SELECT public.get_partner_comodato_pending_balance(p_partner_id)
    INTO v_pending_balance;

  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'movement_id', movement_with_balance.id,
        'movement_date', movement_with_balance.movement_date,
        'pending_balance', movement_with_balance.pending_balance,
        'has_active_request', movement_with_balance.has_active_request
      )
      ORDER BY movement_with_balance.movement_date DESC,
        movement_with_balance.id
    ) FILTER (WHERE movement_with_balance.pending_balance > 0.005),
    '[]'::JSONB
  )
    INTO v_settlements
  FROM (
    SELECT
      movement.id,
      movement.movement_date,
      public.get_comodato_movement_pending_balance(movement.id)
        AS pending_balance,
      EXISTS (
        SELECT 1
        FROM public.partner_payment_verification_requests AS request
        WHERE request.scheme = 'comodato'
          AND request.partner_id = p_partner_id
          AND request.movement_id = movement.id
          AND LOWER(BTRIM(request.status)) IN ('draft', 'pending_review')
      ) AS has_active_request
    FROM public.commercial_partner_movements AS movement
    WHERE movement.partner_id = p_partner_id
      AND LOWER(BTRIM(movement.movement_type)) = 'settlement'
      AND LOWER(BTRIM(movement.status)) = 'completed'
  ) AS movement_with_balance;

  RETURN JSONB_BUILD_OBJECT(
    'partner_id', p_partner_id,
    'pending_balance', COALESCE(v_pending_balance, 0),
    'settlements', COALESCE(v_settlements, '[]'::JSONB)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_partner_comodato_payment_options(UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_partner_comodato_payment_options(UUID)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.get_partner_comodato_payment_options(UUID)
  TO authenticated;

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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_id UUID;
  v_folio TEXT;
  v_current_user_id UUID := auth.uid();
  v_user_role TEXT;
  v_user_is_active BOOLEAN;
  v_partner_assigned_to UUID;
  v_pending_balance NUMERIC;
  v_total_due NUMERIC;
  v_total_paid NUMERIC;
BEGIN
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  SELECT profile.role, COALESCE(profile.is_active, FALSE)
    INTO v_user_role, v_user_is_active
  FROM public.user_profiles AS profile
  WHERE profile.id = v_current_user_id;

  IF NOT COALESCE(v_user_is_active, FALSE)
    OR v_user_role NOT IN ('admin', 'socios_comerciales') THEN
    RAISE EXCEPTION 'Insufficient permissions to create payment verification request';
  END IF;

  IF v_user_role = 'socios_comerciales' THEN
    SELECT partner.assigned_to
      INTO v_partner_assigned_to
    FROM public.commercial_partners AS partner
    WHERE partner.id = p_partner_id;

    IF v_partner_assigned_to IS NULL
      OR v_partner_assigned_to <> v_current_user_id THEN
      RAISE EXCEPTION 'You are not assigned to this partner';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.commercial_partners AS partner
    WHERE partner.id = p_partner_id
  ) THEN
    RAISE EXCEPTION 'Partner not found';
  END IF;

  IF p_scheme = 'comodato' THEN
    IF p_movement_id IS NULL THEN
      RAISE EXCEPTION 'movement_id is required for comodato scheme';
    END IF;
    IF p_wholesale_order_id IS NOT NULL THEN
      RAISE EXCEPTION 'wholesale_order_id must be null for comodato scheme';
    END IF;

    PERFORM 1
    FROM public.commercial_partner_movements AS movement
    WHERE movement.id = p_movement_id
      AND movement.partner_id = p_partner_id
      AND LOWER(BTRIM(movement.movement_type)) = 'settlement'
      AND LOWER(BTRIM(movement.status)) = 'completed'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Completed settlement not found or does not belong to this partner';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.partner_payment_verification_requests AS request
      WHERE request.scheme = 'comodato'
        AND request.partner_id = p_partner_id
        AND request.movement_id = p_movement_id
        AND LOWER(BTRIM(request.status)) IN ('draft', 'pending_review')
    ) THEN
      RAISE EXCEPTION 'This settlement already has an active payment verification request';
    END IF;

    SELECT public.get_comodato_movement_pending_balance(p_movement_id)
      INTO v_pending_balance;
  ELSIF p_scheme = 'mayoreo' THEN
    IF p_wholesale_order_id IS NULL THEN
      RAISE EXCEPTION 'wholesale_order_id is required for mayoreo scheme';
    END IF;
    IF p_movement_id IS NOT NULL THEN
      RAISE EXCEPTION 'movement_id must be null for mayoreo scheme';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.wholesale_orders AS wholesale_order
      WHERE wholesale_order.id = p_wholesale_order_id
        AND wholesale_order.partner_id = p_partner_id
    ) THEN
      RAISE EXCEPTION 'Wholesale order not found or does not belong to this partner';
    END IF;

    SELECT COALESCE(order_totals.pending_amount, 0)
      INTO v_pending_balance
    FROM public.v_wholesale_order_totals AS order_totals
    WHERE order_totals.wholesale_order_id = p_wholesale_order_id;

    IF v_pending_balance IS NULL THEN
      SELECT COALESCE(wholesale_order.total_amount, 0)
        INTO v_total_due
      FROM public.wholesale_orders AS wholesale_order
      WHERE wholesale_order.id = p_wholesale_order_id;

      SELECT COALESCE(SUM(payment.amount), 0)
        INTO v_total_paid
      FROM public.wholesale_payments AS payment
      WHERE payment.wholesale_order_id = p_wholesale_order_id
        AND payment.status IN ('completed', 'paid');

      v_pending_balance := v_total_due - v_total_paid;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid scheme. Must be comodato or mayoreo';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than 0';
  END IF;

  IF v_pending_balance IS NULL OR p_amount > v_pending_balance + 0.005 THEN
    RAISE EXCEPTION 'Amount (%) exceeds current pending balance (%)',
      p_amount, COALESCE(v_pending_balance, 0);
  END IF;

  IF p_payment_method NOT IN ('cash', 'transfer') THEN
    RAISE EXCEPTION 'Invalid payment method. Must be cash or transfer';
  END IF;

  v_folio := public.generate_payment_verification_folio();

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
$$;

REVOKE ALL ON FUNCTION public.create_partner_payment_verification_request(
  TEXT, UUID, TIMESTAMPTZ, NUMERIC, TEXT, UUID, UUID, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_partner_payment_verification_request(
  TEXT, UUID, TIMESTAMPTZ, NUMERIC, TEXT, UUID, UUID, TEXT, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_partner_payment_verification_request(
  TEXT, UUID, TIMESTAMPTZ, NUMERIC, TEXT, UUID, UUID, TEXT, TEXT
) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
