-- Read-only verification for 20260910_partner_payment_approval_accounting_timestamp.sql.
WITH approval_function AS (
  SELECT p.oid, p.prosecdef, p.proconfig, p.prosrc,
    pg_get_function_identity_arguments(p.oid) AS arguments
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'approve_partner_payment_verification_request'
),
b2b_function AS (
  SELECT p.prosrc
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_b2b_monthly_collections_report'
    AND pg_get_function_identity_arguments(p.oid) = 'p_month_start date, p_month_end date'
),
approved_links AS (
  SELECT
    request.id AS request_id,
    request.scheme,
    request.amount AS request_amount,
    request.reviewed_at,
    request.approved_payment_id,
    CASE
      WHEN request.scheme = 'comodato' THEN EXISTS (
        SELECT 1 FROM public.commercial_partner_payments AS payment
        WHERE payment.id = request.approved_payment_id
          AND payment.partner_id = request.partner_id
          AND payment.movement_id = request.movement_id
          AND payment.status IN ('completed', 'paid')
      )
      WHEN request.scheme = 'mayoreo' THEN EXISTS (
        SELECT 1 FROM public.wholesale_payments AS payment
        WHERE payment.id = request.approved_payment_id
          AND payment.partner_id = request.partner_id
          AND payment.wholesale_order_id = request.wholesale_order_id
          AND payment.status IN ('completed', 'paid')
      )
      WHEN request.scheme = 'venta_pieza' THEN EXISTS (
        SELECT 1 FROM public.seller_piece_payments AS payment
        WHERE payment.id = request.approved_payment_id
          AND payment.request_id = request.id
          AND payment.sale_id = request.piece_sale_id
          AND payment.status = 'completed'
      )
      ELSE false
    END AS has_exact_link,
    CASE
      WHEN request.scheme = 'comodato' THEN (
        SELECT payment.payment_date = request.reviewed_at AND payment.amount = request.amount
        FROM public.commercial_partner_payments AS payment WHERE payment.id = request.approved_payment_id
      )
      WHEN request.scheme = 'mayoreo' THEN (
        SELECT payment.payment_date = request.reviewed_at AND payment.amount = request.amount
        FROM public.wholesale_payments AS payment WHERE payment.id = request.approved_payment_id
      )
      WHEN request.scheme = 'venta_pieza' THEN (
        SELECT payment.payment_date = request.reviewed_at AND payment.amount = request.amount
        FROM public.seller_piece_payments AS payment WHERE payment.id = request.approved_payment_id
      )
      ELSE false
    END AS matches_accounting_timestamp_and_amount
  FROM public.partner_payment_verification_requests AS request
  WHERE request.status = 'approved'
    AND request.reviewed_at IS NOT NULL
),
payment_link_counts AS (
  SELECT 'comodato'::TEXT AS source_type, request.approved_payment_id AS payment_id, COUNT(*) AS requests_count
  FROM public.partner_payment_verification_requests AS request
  WHERE request.status = 'approved' AND request.scheme = 'comodato' AND request.approved_payment_id IS NOT NULL
  GROUP BY request.approved_payment_id
  UNION ALL
  SELECT 'mayoreo', request.approved_payment_id, COUNT(*)
  FROM public.partner_payment_verification_requests AS request
  WHERE request.status = 'approved' AND request.scheme = 'mayoreo' AND request.approved_payment_id IS NOT NULL
  GROUP BY request.approved_payment_id
  UNION ALL
  SELECT 'venta_pieza', request.approved_payment_id, COUNT(*)
  FROM public.partner_payment_verification_requests AS request
  WHERE request.status = 'approved' AND request.scheme = 'venta_pieza' AND request.approved_payment_id IS NOT NULL
  GROUP BY request.approved_payment_id
),
september_tenth_diagnostic AS (
  SELECT COUNT(*)::INTEGER AS payments_count, COALESCE(SUM(amount), 0)::NUMERIC AS total_amount
  FROM (
    SELECT payment.amount
    FROM public.partner_payment_verification_requests AS request
    JOIN public.commercial_partner_payments AS payment ON payment.id = request.approved_payment_id
    WHERE request.status = 'approved' AND request.scheme = 'comodato'
      AND (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE = DATE '2026-09-10'
    UNION ALL
    SELECT payment.amount
    FROM public.partner_payment_verification_requests AS request
    JOIN public.wholesale_payments AS payment ON payment.id = request.approved_payment_id
    WHERE request.status = 'approved' AND request.scheme = 'mayoreo'
      AND (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE = DATE '2026-09-10'
    UNION ALL
    SELECT payment.amount
    FROM public.partner_payment_verification_requests AS request
    JOIN public.seller_piece_payments AS payment ON payment.id = request.approved_payment_id
    WHERE request.status = 'approved' AND request.scheme = 'venta_pieza'
      AND (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE = DATE '2026-09-10'
  ) AS payments
),
checks AS (
  SELECT JSONB_BUILD_OBJECT(
    'approval_function_signature_and_security', EXISTS (
      SELECT 1 FROM approval_function
      WHERE arguments = 'p_request_id uuid, p_review_notes text'
        AND prosecdef
        AND COALESCE(array_to_string(proconfig, ','), '') LIKE '%search_path=public, pg_temp%'
    ),
    'approval_uses_one_server_timestamp', EXISTS (
      SELECT 1 FROM approval_function WHERE prosrc LIKE '%v_now := now();%'
    ),
    'approval_writes_v_now_to_all_payment_sources', EXISTS (
      SELECT 1 FROM approval_function
      WHERE prosrc LIKE '%v_request.movement_id, v_now, v_request.amount%'
        AND prosrc LIKE '%v_request.wholesale_order_id, v_now, v_request.amount%'
        AND prosrc LIKE '%v_request.id, v_now,%'
    ),
    'reviewed_at_uses_same_timestamp', EXISTS (
      SELECT 1 FROM approval_function WHERE prosrc LIKE '%reviewed_at = v_now%'
    ),
    'reported_date_is_not_written_to_definitive_payments', EXISTS (
      SELECT 1 FROM approval_function WHERE prosrc NOT LIKE '%v_request.payment_date%'
    ),
    'approval_is_idempotent', EXISTS (
      SELECT 1 FROM approval_function
      WHERE prosrc LIKE '%v_request.status = ''approved'' AND v_request.approved_payment_id IS NOT NULL%'
    ),
    'approved_requests_have_exact_payment_link', NOT EXISTS (
      SELECT 1 FROM approved_links WHERE NOT has_exact_link
    ),
    'approved_exact_links_match_reviewed_at_and_amount', NOT EXISTS (
      SELECT 1 FROM approved_links WHERE has_exact_link AND NOT matches_accounting_timestamp_and_amount
    ),
    'no_payment_is_linked_to_multiple_approved_requests', NOT EXISTS (
      SELECT 1 FROM payment_link_counts WHERE requests_count > 1
    ),
    'b2b_payment_grouping_uses_mexico_city', EXISTS (
      SELECT 1 FROM b2b_function
      WHERE LOWER(prosrc) LIKE '%payment.payment_date at time zone ''america/mexico_city''%'
    ),
    'b2b_payment_ranges_are_semiopen', EXISTS (
      SELECT 1 FROM b2b_function
      WHERE prosrc LIKE '%>= params.month_start%'
        AND prosrc LIKE '%< params.month_end%'
    ),
    'unverifiable_approved_links', COALESCE((SELECT COUNT(*) FROM approved_links WHERE NOT has_exact_link), 0),
    'diagnostic_september_10_2026', (
      SELECT JSONB_BUILD_OBJECT(
        'payments_count', payments_count,
        'total_amount', total_amount,
        'expected_payments_count', 4,
        'expected_total_amount', 440.00,
        'matches_expected_incident_total', payments_count = 4 AND total_amount = 440.00
      )
      FROM september_tenth_diagnostic
    )
  ) AS value
)
SELECT (checks.value || JSONB_BUILD_OBJECT(
  'all_checks_passed', COALESCE((checks.value->>'approval_function_signature_and_security')::BOOLEAN, false)
    AND COALESCE((checks.value->>'approval_uses_one_server_timestamp')::BOOLEAN, false)
    AND COALESCE((checks.value->>'approval_writes_v_now_to_all_payment_sources')::BOOLEAN, false)
    AND COALESCE((checks.value->>'reviewed_at_uses_same_timestamp')::BOOLEAN, false)
    AND COALESCE((checks.value->>'reported_date_is_not_written_to_definitive_payments')::BOOLEAN, false)
    AND COALESCE((checks.value->>'approval_is_idempotent')::BOOLEAN, false)
    AND COALESCE((checks.value->>'approved_requests_have_exact_payment_link')::BOOLEAN, false)
    AND COALESCE((checks.value->>'approved_exact_links_match_reviewed_at_and_amount')::BOOLEAN, false)
    AND COALESCE((checks.value->>'no_payment_is_linked_to_multiple_approved_requests')::BOOLEAN, false)
    AND COALESCE((checks.value->>'b2b_payment_grouping_uses_mexico_city')::BOOLEAN, false)
    AND COALESCE((checks.value->>'b2b_payment_ranges_are_semiopen')::BOOLEAN, false)
)) AS verification
FROM checks;
