-- Definitive commercial income exists only when an administrator approves it.
-- The request payment_date remains the seller-reported audit date.

BEGIN;

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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_user_id UUID;
  v_user_role TEXT;
  v_request public.partner_payment_verification_requests%ROWTYPE;
  v_approved_payment_id UUID;
  v_current_balance NUMERIC;
  v_total_due NUMERIC;
  v_total_paid NUMERIC;
  v_now TIMESTAMPTZ;
BEGIN
  v_now := now();
  v_current_user_id := auth.uid();
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  SELECT role INTO v_user_role FROM public.user_profiles WHERE id = v_current_user_id;
  IF v_user_role <> 'admin' THEN
    RAISE EXCEPTION 'Only administrators can approve payment requests';
  END IF;

  SELECT * INTO v_request
  FROM public.partner_payment_verification_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  -- The same locked request is always returned; it never creates a second payment.
  IF v_request.status = 'approved' AND v_request.approved_payment_id IS NOT NULL THEN
    RETURN QUERY SELECT v_request.id, v_request.folio, v_request.approved_payment_id,
      v_request.amount, v_request.status, v_request.reviewed_at;
    RETURN;
  END IF;

  IF v_request.status <> 'pending_review' THEN
    RAISE EXCEPTION 'Request is not pending review. Current status: %', v_request.status;
  END IF;
  IF v_request.payment_method = 'transfer' AND v_request.proof_path IS NULL THEN
    RAISE EXCEPTION 'Transfer payment must have proof before approval';
  END IF;

  IF v_request.scheme = 'comodato' THEN
    SELECT COALESCE(SUM(amount_due), 0) INTO v_total_due
    FROM public.commercial_partner_movement_items
    WHERE movement_id = v_request.movement_id AND quantity_sold > 0;

    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM public.commercial_partner_payments
    WHERE movement_id = v_request.movement_id AND status IN ('completed', 'paid');

    v_current_balance := v_total_due - v_total_paid;
    IF v_current_balance IS NULL OR v_current_balance < v_request.amount THEN
      RAISE EXCEPTION 'Current balance insufficient for this payment. Available: %', v_current_balance;
    END IF;

    INSERT INTO public.commercial_partner_payments (
      partner_id, movement_id, payment_date, amount, payment_method, reference,
      notes, received_by, status, created_at, updated_at
    ) VALUES (
      v_request.partner_id, v_request.movement_id, v_now, v_request.amount,
      v_request.payment_method, v_request.payment_reference, v_request.notes,
      v_request.submitted_by, 'completed', v_now, v_now
    ) RETURNING id INTO v_approved_payment_id;

  ELSIF v_request.scheme = 'mayoreo' THEN
    SELECT pending_amount INTO v_current_balance
    FROM public.v_wholesale_order_totals
    WHERE wholesale_order_id = v_request.wholesale_order_id;

    IF v_current_balance IS NULL THEN
      SELECT COALESCE(total_amount, 0) INTO v_total_due
      FROM public.wholesale_orders WHERE id = v_request.wholesale_order_id;
      SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
      FROM public.wholesale_payments
      WHERE wholesale_order_id = v_request.wholesale_order_id AND status IN ('completed', 'paid');
      v_current_balance := v_total_due - v_total_paid;
    END IF;
    IF v_current_balance IS NULL OR v_current_balance < v_request.amount THEN
      RAISE EXCEPTION 'Current balance insufficient for this payment. Available: %', v_current_balance;
    END IF;

    INSERT INTO public.wholesale_payments (
      partner_id, wholesale_order_id, payment_date, amount, payment_method, reference,
      notes, received_by, status, created_at, updated_at
    ) VALUES (
      v_request.partner_id, v_request.wholesale_order_id, v_now, v_request.amount,
      v_request.payment_method, v_request.payment_reference, v_request.notes,
      v_request.submitted_by, 'completed', v_now, v_now
    ) RETURNING id INTO v_approved_payment_id;

  ELSIF v_request.scheme = 'venta_pieza' THEN
    SELECT public.get_piece_sale_pending_balance(v_request.piece_sale_id) INTO v_current_balance;
    IF v_current_balance IS NULL OR v_current_balance < v_request.amount THEN
      RAISE EXCEPTION 'Current balance insufficient for this payment. Available: %', v_current_balance;
    END IF;

    INSERT INTO public.seller_piece_payments (
      seller_id, sale_id, request_id, payment_date, amount, payment_method,
      reference, status, notes, created_at
    ) VALUES (
      v_request.submitted_by, v_request.piece_sale_id, v_request.id, v_now,
      v_request.amount, v_request.payment_method, v_request.payment_reference,
      'completed', v_request.notes, v_now
    ) RETURNING id INTO v_approved_payment_id;
  ELSE
    RAISE EXCEPTION 'Unsupported payment request scheme: %', v_request.scheme;
  END IF;

  UPDATE public.partner_payment_verification_requests
  SET status = 'approved', reviewed_by = v_current_user_id, reviewed_at = v_now,
      review_notes = p_review_notes, approved_payment_id = v_approved_payment_id,
      updated_at = v_now
  WHERE id = v_request.id;

  RETURN QUERY SELECT v_request.id, v_request.folio, v_approved_payment_id,
    v_request.amount, 'approved'::TEXT, v_now;
END;
$$;

-- Backfill only exact, approved links. No source, amount, partner, or date lookup
-- is used to discover a payment: approved_payment_id is the sole primary link.
UPDATE public.commercial_partner_payments AS payment
SET payment_date = request.reviewed_at
FROM public.partner_payment_verification_requests AS request
WHERE request.status = 'approved'
  AND request.scheme = 'comodato'
  AND request.reviewed_at IS NOT NULL
  AND request.approved_payment_id = payment.id
  AND payment.partner_id = request.partner_id
  AND payment.movement_id = request.movement_id
  AND payment.status IN ('completed', 'paid');

UPDATE public.wholesale_payments AS payment
SET payment_date = request.reviewed_at
FROM public.partner_payment_verification_requests AS request
WHERE request.status = 'approved'
  AND request.scheme = 'mayoreo'
  AND request.reviewed_at IS NOT NULL
  AND request.approved_payment_id = payment.id
  AND payment.partner_id = request.partner_id
  AND payment.wholesale_order_id = request.wholesale_order_id
  AND payment.status IN ('completed', 'paid');

UPDATE public.seller_piece_payments AS payment
SET payment_date = request.reviewed_at
FROM public.partner_payment_verification_requests AS request
WHERE request.status = 'approved'
  AND request.scheme = 'venta_pieza'
  AND request.reviewed_at IS NOT NULL
  AND request.approved_payment_id = payment.id
  AND payment.request_id = request.id
  AND payment.sale_id = request.piece_sale_id
  AND payment.status = 'completed';

-- Preserve the most recently deployed report definition and change only its
-- accounting-day interpretation for definitive payment timestamps.
DO $$
DECLARE
  v_definition TEXT;
  v_updated_definition TEXT;
BEGIN
  SELECT pg_get_functiondef('public.get_b2b_monthly_collections_report(date,date)'::REGPROCEDURE)
  INTO v_definition;

  IF POSITION('(payment.payment_date at time zone ''america/mexico_city'')::date' IN LOWER(v_definition)) > 0 THEN
    NULL;
  ELSIF LOWER(v_definition) LIKE '%payment.payment_date at time zone ''utc''%' THEN
    v_updated_definition := REGEXP_REPLACE(
      v_definition,
      E'\\(payment\\.payment_date\\s+AT\\s+TIME\\s+ZONE\\s+''UTC''\\)::DATE',
      '(payment.payment_date AT TIME ZONE ''America/Mexico_City'')::DATE',
      'gi'
    );
    IF v_updated_definition = v_definition THEN
      RAISE EXCEPTION 'No se pudo reemplazar la agrupación UTC de get_b2b_monthly_collections_report';
    END IF;
    EXECUTE v_updated_definition;
  ELSE
    RAISE EXCEPTION 'No se pudo verificar la semántica de payment_date de get_b2b_monthly_collections_report';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_partner_payment_verification_request(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_partner_payment_verification_request(UUID, TEXT) TO authenticated;

COMMIT;
