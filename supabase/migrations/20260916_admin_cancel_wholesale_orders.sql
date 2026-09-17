-- Audited Mayoreo cancellation for labelled but unreleased orders.
-- This migration intentionally preserves the delete guards and every
-- historical source, item, label and audit row.

BEGIN;

-- Keep the existing public control for Comodato only. Mayoreo must use the
-- password-verified RPC below, so an authenticated caller cannot bypass the
-- server-side secondary-password check by calling the old three-argument RPC.
CREATE OR REPLACE FUNCTION public.admin_cancel_commercial_delivery(
  p_source_type TEXT,
  p_source_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_type TEXT := LOWER(BTRIM(p_source_type));
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_actor UUID;
  v_partner UUID;
  v_status TEXT;
  v_now TIMESTAMPTZ := now();
  v_total_units INTEGER;
  v_total_active INTEGER;
  v_blocked INTEGER;
  v_voided INTEGER;
  v_previous_states JSONB;
BEGIN
  IF v_type NOT IN ('comodato', 'mayoreo') THEN
    RAISE EXCEPTION 'source_type must be comodato or mayoreo';
  END IF;
  IF v_type = 'mayoreo' THEN
    RAISE EXCEPTION 'Wholesale orders must use admin_cancel_wholesale_order';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'An administrator reason of at least 10 characters is required';
  END IF;

  SELECT movement.partner_id, movement.status::TEXT
    INTO v_partner, v_status
  FROM public.commercial_partner_movements AS movement
  WHERE movement.id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commercial delivery source not found'; END IF;

  v_actor := public._commercial_delivery_actor(v_partner, true);
  IF v_status <> 'pending_release' THEN RAISE EXCEPTION 'Only a pending_release delivery can be cancelled'; END IF;

  PERFORM 1 FROM public.commercial_delivery_units AS unit
  WHERE unit.source_type = 'comodato' AND unit.movement_id = p_source_id
  FOR UPDATE;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE unit.status IN ('generated', 'printed', 'scanned')),
    COUNT(*) FILTER (WHERE unit.status IN ('released', 'spoiled', 'returned_good'))
  INTO v_total_units, v_total_active, v_blocked
  FROM public.commercial_delivery_units AS unit
  WHERE unit.source_type = 'comodato' AND unit.movement_id = p_source_id;

  IF v_total_active = 0 THEN RAISE EXCEPTION 'The delivery has no active labelled units to cancel'; END IF;
  IF v_blocked > 0 THEN RAISE EXCEPTION 'A delivery with released, spoiled, or returned units cannot be cancelled'; END IF;
  IF EXISTS (SELECT 1 FROM public.commercial_partner_payments AS payment WHERE payment.movement_id = p_source_id)
    OR EXISTS (
      SELECT 1 FROM public.commercial_partner_movement_items AS item
      WHERE item.movement_id = p_source_id
        AND (COALESCE(item.quantity_sold, 0) > 0 OR COALESCE(item.quantity_withdrawn, 0) > 0 OR COALESCE(item.quantity_spoiled, 0) > 0)
    ) THEN
    RAISE EXCEPTION 'A delivery with payments or downstream inventory consequences cannot be cancelled';
  END IF;

  SELECT COALESCE(jsonb_object_agg(state.status, state.count), '{}'::JSONB)
    INTO v_previous_states
  FROM (
    SELECT unit.status, COUNT(*)::INTEGER AS count
    FROM public.commercial_delivery_units AS unit
    WHERE unit.source_type = 'comodato' AND unit.movement_id = p_source_id
    GROUP BY unit.status
  ) AS state;

  UPDATE public.commercial_partner_movements SET status = 'cancelled' WHERE id = p_source_id;
  UPDATE public.commercial_delivery_units AS unit
  SET status = 'voided', voided_at = v_now, voided_by = v_actor, void_reason = v_reason
  WHERE unit.source_type = 'comodato' AND unit.movement_id = p_source_id
    AND unit.status IN ('generated', 'printed', 'scanned');
  GET DIAGNOSTICS v_voided = ROW_COUNT;

  PERFORM public._commercial_delivery_audit(
    'admin_delivery_cancelled', v_partner, p_source_id, NULL, NULL, v_reason,
    jsonb_build_object(
      'source_type', 'comodato', 'source_id', p_source_id,
      'total_units', v_total_units, 'voided_units', v_voided,
      'previous_states', v_previous_states, 'cancelled_at', v_now
    )
  );

  RETURN jsonb_build_object(
    'source_id', p_source_id, 'source_type', 'comodato', 'voided_units', v_voided,
    'cancelled_at', v_now, 'final_status', 'cancelled'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_wholesale_order(
  p_order_id UUID,
  p_reason TEXT,
  p_admin_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_actor UUID;
  v_partner UUID;
  v_status TEXT;
  v_password_valid BOOLEAN := FALSE;
  v_now TIMESTAMPTZ := now();
  v_total_units INTEGER;
  v_allowed_units INTEGER;
  v_incompatible_units INTEGER;
  v_voided_units INTEGER;
  v_previous_states JSONB;
BEGIN
  IF p_order_id IS NULL THEN RAISE EXCEPTION 'Wholesale order is required'; END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'An administrator reason of at least 10 characters is required';
  END IF;
  IF NULLIF(p_admin_password, '') IS NULL THEN
    RAISE EXCEPTION 'Administrator password is required';
  END IF;

  SELECT orders.partner_id, orders.order_status::TEXT
    INTO v_partner, v_status
  FROM public.wholesale_orders AS orders
  WHERE orders.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wholesale order not found'; END IF;

  -- Requires an authenticated, active administrator before any sensitive check.
  v_actor := public._commercial_delivery_actor(v_partner, true);
  SELECT COALESCE(verification.success, FALSE)
    INTO v_password_valid
  FROM public.verify_financial_access_password(p_admin_password) AS verification
  LIMIT 1;
  IF NOT v_password_valid THEN RAISE EXCEPTION 'Administrator password is invalid'; END IF;

  IF v_status = 'cancelled' THEN RAISE EXCEPTION 'This wholesale order is already cancelled'; END IF;
  IF v_status <> 'pending_release' THEN
    RAISE EXCEPTION 'Only an unreleased pending wholesale order can be cancelled';
  END IF;

  -- Lock every related row before checking the complete cancellation contract.
  PERFORM 1 FROM public.commercial_delivery_units AS unit
  WHERE unit.source_type = 'mayoreo' AND unit.wholesale_order_id = p_order_id
  FOR UPDATE;
  PERFORM 1 FROM public.wholesale_payments AS payment
  WHERE payment.wholesale_order_id = p_order_id
  FOR UPDATE;
  PERFORM 1 FROM public.partner_payment_verification_requests AS request
  WHERE request.scheme = 'mayoreo' AND request.wholesale_order_id = p_order_id
  FOR UPDATE;
  PERFORM 1 FROM public.commission_events AS event
  WHERE event.source_id = p_order_id
  FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.wholesale_payments AS payment WHERE payment.wholesale_order_id = p_order_id) THEN
    RAISE EXCEPTION 'The wholesale order cannot be cancelled because it has registered payments, including partial payments';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.partner_payment_verification_requests AS request
    WHERE request.scheme = 'mayoreo'
      AND request.wholesale_order_id = p_order_id
      AND LOWER(COALESCE(request.status::TEXT, '')) = 'approved'
  ) THEN
    RAISE EXCEPTION 'The wholesale order cannot be cancelled because it has an approved payment request';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commission_events AS event WHERE event.source_id = p_order_id) THEN
    RAISE EXCEPTION 'The wholesale order cannot be cancelled because it has downstream commission consequences';
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE unit.status IN ('generated', 'printed', 'scanned')),
    COUNT(*) FILTER (WHERE unit.status NOT IN ('generated', 'printed', 'scanned'))
  INTO v_total_units, v_allowed_units, v_incompatible_units
  FROM public.commercial_delivery_units AS unit
  WHERE unit.source_type = 'mayoreo' AND unit.wholesale_order_id = p_order_id;

  IF v_total_units = 0 THEN RAISE EXCEPTION 'The wholesale order has no commercial labels to cancel'; END IF;
  IF v_incompatible_units > 0 OR v_allowed_units <> v_total_units THEN
    RAISE EXCEPTION 'The wholesale order cannot be cancelled because it has released, returned, spoiled, replaced, voided, or other incompatible labels';
  END IF;

  SELECT COALESCE(jsonb_object_agg(state.status, state.count), '{}'::JSONB)
    INTO v_previous_states
  FROM (
    SELECT unit.status, COUNT(*)::INTEGER AS count
    FROM public.commercial_delivery_units AS unit
    WHERE unit.source_type = 'mayoreo' AND unit.wholesale_order_id = p_order_id
    GROUP BY unit.status
  ) AS state;

  -- The source and unit triggers remain enabled. Their guarded transitions
  -- accept only pending_release -> cancelled and allowed -> voided here.
  UPDATE public.wholesale_orders
  SET order_status = 'cancelled', payment_due_at = NULL
  WHERE id = p_order_id;

  UPDATE public.commercial_delivery_units AS unit
  SET status = 'voided', voided_at = v_now, voided_by = v_actor, void_reason = v_reason
  WHERE unit.source_type = 'mayoreo'
    AND unit.wholesale_order_id = p_order_id
    AND unit.status IN ('generated', 'printed', 'scanned');
  GET DIAGNOSTICS v_voided_units = ROW_COUNT;

  PERFORM public._commercial_delivery_audit(
    'admin_delivery_cancelled', v_partner, NULL, p_order_id, NULL, v_reason,
    jsonb_build_object(
      'source_type', 'mayoreo', 'source_id', p_order_id,
      'total_units', v_total_units, 'voided_units', v_voided_units,
      'previous_states', v_previous_states, 'cancelled_at', v_now
    )
  );

  RETURN jsonb_build_object(
    'source_id', p_order_id, 'source_type', 'mayoreo', 'voided_units', v_voided_units,
    'cancelled_at', v_now, 'final_status', 'cancelled'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cancel_commercial_delivery(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_commercial_delivery(TEXT, UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_cancel_wholesale_order(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_wholesale_order(UUID, TEXT, TEXT) TO authenticated;

COMMIT;
