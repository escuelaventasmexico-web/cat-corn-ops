-- Read-only verification for confirmed piece-sale metrics and informational stock.
-- Run after 20260823_exclude_rejected_piece_sales_from_informational_stock.sql.
-- Returns exactly one row containing one JSONB object.

WITH params AS (
  SELECT
    TIMESTAMPTZ '2026-08-01 00:00:00+00' AS period_start,
    TIMESTAMPTZ '2026-09-01 00:00:00+00' AS period_end
),
period_sales AS (
  SELECT
    h.sale_id,
    h.folio,
    h.seller_id,
    h.seller_name,
    h.sale_date,
    h.total_amount::NUMERIC AS total_amount,
    h.total_commission::NUMERIC AS total_commission,
    h.total_units::NUMERIC AS total_units,
    h.status
  FROM public.v_piece_sale_history AS h
  CROSS JOIN params AS p
  WHERE h.sale_date >= p.period_start
    AND h.sale_date < p.period_end
),
confirmed_summary AS (
  SELECT
    COUNT(*) AS sales_count,
    COALESCE(SUM(total_amount), 0) AS sold_amount,
    COALESCE(SUM(total_units), 0) AS sold_units,
    COUNT(DISTINCT seller_id) AS distinct_sellers
  FROM period_sales
  WHERE status = 'confirmed'
),
confirmed_payments AS (
  SELECT COALESCE(SUM(p.amount), 0)::NUMERIC AS paid_amount
  FROM public.seller_piece_payments AS p
  CROSS JOIN params AS period
  WHERE p.status = 'completed'
    AND p.payment_date >= period.period_start
    AND p.payment_date < period.period_end
),
actionable_summary AS (
  SELECT
    COUNT(*) AS operation_count,
    COALESCE(SUM(total_amount), 0) AS pending_amount
  FROM period_sales
  WHERE status IN ('draft', 'pending_review')
),
rejected_summary AS (
  SELECT
    COUNT(*) AS operation_count,
    COALESCE(SUM(total_amount), 0) AS rejected_amount,
    COALESCE(SUM(total_units), 0) AS rejected_units
  FROM period_sales
  WHERE status = 'payment_rejected'
),
payments_by_sale AS (
  SELECT
    r.piece_sale_id AS sale_id,
    COALESCE(
      SUM(p.amount) FILTER (WHERE p.status = 'completed'),
      0
    )::NUMERIC AS paid_lifetime
  FROM public.partner_payment_verification_requests AS r
  LEFT JOIN public.seller_piece_payments AS p
    ON p.id = r.approved_payment_id
  WHERE r.scheme = 'venta_pieza'
    AND r.piece_sale_id IS NOT NULL
  GROUP BY r.piece_sale_id
),
operation_balances AS (
  SELECT
    s.*,
    COALESCE(p.paid_lifetime, 0) AS paid_lifetime,
    GREATEST(s.total_amount - COALESCE(p.paid_lifetime, 0), 0) AS balance
  FROM period_sales AS s
  LEFT JOIN payments_by_sale AS p
    ON p.sale_id = s.sale_id
),
non_rejected_with_balance AS (
  SELECT *
  FROM operation_balances
  WHERE status NOT IN ('payment_rejected', 'cancelled')
    AND balance > 0
),
target_folios AS (
  SELECT *
  FROM operation_balances
  WHERE folio IN ('VP-202608-00003', 'VP-202608-00004')
),
target_folio_check AS (
  SELECT
    COUNT(*) AS operation_count,
    COALESCE(BOOL_AND(
      status = 'payment_rejected'
      AND total_amount = 65
      AND total_units = 1
      AND paid_lifetime = 0
    ), false) AS values_match
  FROM target_folios
),
rejected_commission_events AS (
  SELECT
    s.sale_id,
    s.folio,
    ce.id AS commission_event_id,
    ce.commission_amount,
    ce.status AS internal_status,
    EXISTS (
      SELECT 1
      FROM public.v_commission_events_effective AS effective
      WHERE effective.id = ce.id
    ) AS appears_in_effective_view
  FROM period_sales AS s
  JOIN public.commission_events AS ce
    ON ce.source_type = 'piece_sale'
   AND ce.source_id = s.sale_id
  WHERE s.status = 'payment_rejected'
),
rejected_commission_leaks AS (
  SELECT *
  FROM rejected_commission_events
  WHERE appears_in_effective_view
),
affected_products AS (
  SELECT
    s.seller_id,
    i.product_id,
    COALESCE(SUM(i.quantity), 0)::NUMERIC AS rejected_units
  FROM period_sales AS s
  JOIN public.seller_piece_sale_items AS i
    ON i.sale_id = s.sale_id
  WHERE s.status = 'payment_rejected'
  GROUP BY s.seller_id, i.product_id
),
expected_stock AS (
  SELECT
    ap.seller_id,
    ap.product_id,
    ap.rejected_units,
    stock.product_name,
    stock.product_variant,
    stock.product_size,
    stock.assigned_net_units,
    stock.sold_units AS view_sold_units,
    stock.informational_balance AS view_informational_balance,
    COALESCE((
      SELECT SUM(i.quantity)
      FROM public.seller_piece_sales AS s
      JOIN public.seller_piece_sale_items AS i
        ON i.sale_id = s.id
      WHERE s.seller_id = ap.seller_id
        AND i.product_id = ap.product_id
        AND s.status NOT IN ('cancelled', 'payment_rejected')
    ), 0)::NUMERIC AS expected_sold_units
  FROM affected_products AS ap
  LEFT JOIN public.v_seller_piece_stock AS stock
    ON stock.seller_id = ap.seller_id
   AND stock.product_id = ap.product_id
),
stock_checks AS (
  SELECT
    es.*,
    (
      es.assigned_net_units - es.expected_sold_units
    ) AS expected_informational_balance,
    es.view_sold_units IS NOT DISTINCT FROM es.expected_sold_units
      AND es.view_informational_balance IS NOT DISTINCT FROM
        (es.assigned_net_units - es.expected_sold_units) AS matches_expected_view
  FROM expected_stock AS es
),
stock_mismatches AS (
  SELECT *
  FROM stock_checks
  WHERE NOT matches_expected_view
),
view_predicate_check AS (
  SELECT
    PG_GET_VIEWDEF(
      TO_REGCLASS('public.v_seller_piece_stock'),
      true
    ) AS view_definition,
    PG_GET_VIEWDEF(
      TO_REGCLASS('public.v_seller_piece_stock'),
      true
    ) ~* 'payment_rejected' AS excludes_payment_rejected
)
SELECT JSONB_BUILD_OBJECT(
  'all_checks_passed',
    (SELECT sold_amount = 853 AND sold_units = 12 AND distinct_sellers = 1
     FROM confirmed_summary)
    AND (SELECT paid_amount = 853 FROM confirmed_payments)
    AND (SELECT pending_amount = 0 FROM actionable_summary)
    AND (SELECT operation_count = 2 AND rejected_amount = 130 AND rejected_units = 2
         FROM rejected_summary)
    AND (SELECT COUNT(*) = 0 FROM non_rejected_with_balance)
    AND (SELECT operation_count = 2 AND values_match FROM target_folio_check)
    AND (SELECT COUNT(*) = 0 FROM rejected_commission_leaks)
    AND (SELECT COUNT(*) = 0 FROM stock_mismatches)
    AND (SELECT excludes_payment_rejected FROM view_predicate_check),
  'period', (
    SELECT JSONB_BUILD_OBJECT(
      'start_utc', period_start,
      'end_utc_exclusive', period_end
    )
    FROM params
  ),
  'confirmed_sales', (SELECT TO_JSONB(x) FROM confirmed_summary AS x),
  'confirmed_payments', (SELECT TO_JSONB(x) FROM confirmed_payments AS x),
  'actionable_pending', (SELECT TO_JSONB(x) FROM actionable_summary AS x),
  'payment_rejected', (SELECT TO_JSONB(x) FROM rejected_summary AS x),
  'non_rejected_with_balance', COALESCE(
    (SELECT JSONB_AGG(TO_JSONB(x) ORDER BY x.sale_date) FROM non_rejected_with_balance AS x),
    '[]'::JSONB
  ),
  'target_folios', COALESCE(
    (SELECT JSONB_AGG(TO_JSONB(x) ORDER BY x.folio) FROM target_folios AS x),
    '[]'::JSONB
  ),
  'target_folio_check', (SELECT TO_JSONB(x) FROM target_folio_check AS x),
  'rejected_commission_events', COALESCE(
    (SELECT JSONB_AGG(TO_JSONB(x) ORDER BY x.folio, x.commission_event_id)
     FROM rejected_commission_events AS x),
    '[]'::JSONB
  ),
  'rejected_commission_leaks', COALESCE(
    (SELECT JSONB_AGG(TO_JSONB(x)) FROM rejected_commission_leaks AS x),
    '[]'::JSONB
  ),
  'informational_stock', JSONB_BUILD_OBJECT(
    'checks', COALESCE(
      (SELECT JSONB_AGG(TO_JSONB(x) ORDER BY x.product_id) FROM stock_checks AS x),
      '[]'::JSONB
    ),
    'mismatches', COALESCE(
      (SELECT JSONB_AGG(TO_JSONB(x) ORDER BY x.product_id) FROM stock_mismatches AS x),
      '[]'::JSONB
    ),
    'view_predicate_check', (SELECT TO_JSONB(x) FROM view_predicate_check AS x)
  )
) AS piece_sale_metrics_verification;
