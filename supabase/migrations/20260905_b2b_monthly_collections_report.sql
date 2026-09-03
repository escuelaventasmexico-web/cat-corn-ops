-- Read-only source for the B2B Collections report. Existing B2B views and
-- operational/payment flows are intentionally not modified by this migration.

CREATE OR REPLACE FUNCTION public.get_b2b_monthly_collections_report(
  p_month_start DATE,
  p_month_end DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_month_start IS NULL OR p_month_end IS NULL OR p_month_end <= p_month_start THEN
    RAISE EXCEPTION 'p_month_end must be greater than p_month_start';
  END IF;

  WITH
  params AS (
    SELECT
      p_month_start AS month_start,
      p_month_end AS month_end,
      (p_month_start::TIMESTAMP AT TIME ZONE 'America/Mexico_City') AS month_start_at,
      (p_month_end::TIMESTAMP AT TIME ZONE 'America/Mexico_City') AS month_end_at,
      CURRENT_TIMESTAMP AS now_at
  ),
  comodato_products AS (
    SELECT
      item.movement_id AS operation_id,
      COALESCE(SUM(item.amount_due), 0)::NUMERIC AS total_due,
      COALESCE(JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'product_id', item.product_id,
          'product_name', item.product_name,
          'product_variant', item.product_variant,
          'product_size', item.product_size,
          'quantity', COALESCE(item.quantity_sold, 0),
          'unit_price', item.price_to_catcorn,
          'amount', item.amount_due,
          'historical_identity_unverified', item.product_id IS NULL
        ) ORDER BY item.product_name, item.product_variant, item.product_size, item.id
      ) FILTER (WHERE COALESCE(item.quantity_sold, 0) > 0), '[]'::JSONB) AS products
    FROM public.commercial_partner_movement_items AS item
    WHERE COALESCE(item.quantity_sold, 0) > 0
    GROUP BY item.movement_id
  ),
  comodato_payment_rows AS (
    SELECT
      payment.movement_id AS operation_id,
      payment.payment_date,
      payment.created_at,
      payment.amount,
      SUM(payment.amount) OVER (
        PARTITION BY payment.movement_id
        ORDER BY payment.payment_date, payment.created_at, payment.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_paid
    FROM public.commercial_partner_payments AS payment
    WHERE payment.movement_id IS NOT NULL
      AND payment.status IN ('completed', 'paid')
  ),
  comodato_payments AS (
    SELECT
      rows.operation_id,
      COALESCE(SUM(rows.amount), 0)::NUMERIC AS total_paid,
      MIN(rows.payment_date) FILTER (WHERE rows.running_paid >= products.total_due) AS fully_paid_at
    FROM comodato_payment_rows AS rows
    JOIN comodato_products AS products ON products.operation_id = rows.operation_id
    GROUP BY rows.operation_id, products.total_due
  ),
  wholesale_products AS (
    SELECT
      item.wholesale_order_id AS operation_id,
      COALESCE(SUM(COALESCE(item.subtotal, item.quantity * item.unit_price)), 0)::NUMERIC AS total_due,
      COALESCE(JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'product_id', NULLIF(TO_JSONB(item)->>'product_id', '')::UUID,
          'product_name', item.product_name,
          'product_variant', item.product_variant,
          'product_size', item.product_size,
          'quantity', COALESCE(item.quantity, 0),
          'unit_price', item.unit_price,
          'amount', COALESCE(item.subtotal, item.quantity * item.unit_price),
          'historical_identity_unverified', NULLIF(TO_JSONB(item)->>'product_id', '') IS NULL
        ) ORDER BY item.product_name, item.product_variant, item.product_size, item.id
      ), '[]'::JSONB) AS products
    FROM public.wholesale_order_items AS item
    GROUP BY item.wholesale_order_id
  ),
  wholesale_payment_rows AS (
    SELECT
      payment.wholesale_order_id AS operation_id,
      payment.payment_date,
      payment.created_at,
      payment.amount,
      SUM(payment.amount) OVER (
        PARTITION BY payment.wholesale_order_id
        ORDER BY payment.payment_date, payment.created_at, payment.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_paid
    FROM public.wholesale_payments AS payment
    WHERE payment.wholesale_order_id IS NOT NULL
      AND payment.status IN ('completed', 'paid')
  ),
  wholesale_payments AS (
    SELECT
      rows.operation_id,
      COALESCE(SUM(rows.amount), 0)::NUMERIC AS total_paid,
      MIN(rows.payment_date) FILTER (WHERE rows.running_paid >= products.total_due) AS fully_paid_at
    FROM wholesale_payment_rows AS rows
    JOIN wholesale_products AS products ON products.operation_id = rows.operation_id
    GROUP BY rows.operation_id, products.total_due
  ),
  all_operations AS (
    SELECT
      'comodato'::TEXT AS source_type,
      movement.id AS operation_id,
      'COMODATO-' || LEFT(movement.id::TEXT, 8) AS operation_folio,
      movement.partner_id,
      partner.folio::TEXT AS partner_folio,
      partner.business_name,
      partner.responsible_name,
      partner.partner_model::TEXT AS partner_model,
      movement.created_at AS operation_date,
      'settlement_created_at'::TEXT AS operation_date_source,
      movement.created_at AS registered_at,
      NULL::TIMESTAMPTZ AS payment_due_at,
      products.total_due,
      COALESCE(payments.total_paid, 0)::NUMERIC AS total_paid,
      GREATEST(products.total_due - COALESCE(payments.total_paid, 0), 0)::NUMERIC AS pending_amount,
      payments.fully_paid_at,
      products.products
    FROM public.commercial_partner_movements AS movement
    JOIN comodato_products AS products ON products.operation_id = movement.id
    LEFT JOIN comodato_payments AS payments ON payments.operation_id = movement.id
    JOIN public.commercial_partners AS partner ON partner.id = movement.partner_id
    CROSS JOIN params
    WHERE movement.movement_type = 'settlement'
      AND movement.status = 'completed'
      AND movement.created_at >= params.month_start_at
      AND movement.created_at < params.month_end_at
      AND products.total_due > 0

    UNION ALL

    SELECT
      'mayoreo'::TEXT,
      orders.id,
      COALESCE(NULLIF(orders.order_folio::TEXT, ''), 'MAYOREO-' || LEFT(orders.id::TEXT, 8)),
      orders.partner_id,
      partner.folio::TEXT,
      partner.business_name,
      partner.responsible_name,
      partner.partner_model::TEXT,
      COALESCE(
        orders.released_at,
        orders.delivery_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
        orders.order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City'
      ),
      CASE
        WHEN orders.released_at IS NOT NULL THEN 'released_at'
        WHEN orders.delivery_date IS NOT NULL THEN 'delivery_date_historical_fallback'
        ELSE 'order_date_historical_fallback'
      END,
      COALESCE(
        orders.released_at,
        orders.delivery_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
        orders.order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City'
      ),
      orders.payment_due_at,
      products.total_due,
      COALESCE(payments.total_paid, 0)::NUMERIC,
      GREATEST(products.total_due - COALESCE(payments.total_paid, 0), 0)::NUMERIC,
      payments.fully_paid_at,
      products.products
    FROM public.wholesale_orders AS orders
    JOIN wholesale_products AS products ON products.operation_id = orders.id
    LEFT JOIN wholesale_payments AS payments ON payments.operation_id = orders.id
    JOIN public.commercial_partners AS partner ON partner.id = orders.partner_id
    CROSS JOIN params
    WHERE orders.order_status IN ('delivered', 'completed')
      AND COALESCE(
        orders.released_at,
        orders.delivery_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
        orders.order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City'
      ) >= params.month_start_at
      AND COALESCE(
        orders.released_at,
        orders.delivery_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
        orders.order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City'
      ) < params.month_end_at
      AND products.total_due > 0
  ),
  operations AS (
    SELECT
      operation.*,
      CASE
        WHEN operation.total_paid <= 0 THEN 'pending'
        WHEN operation.total_paid < operation.total_due THEN 'partial'
        ELSE 'paid'
      END AS payment_status,
      GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (
          COALESCE(operation.fully_paid_at, params.now_at) - operation.registered_at
        )) / 86400)
      )::INTEGER AS days_waiting_payment
    FROM all_operations AS operation
    CROSS JOIN params
  ),
  payments_collected_in_month AS (
    SELECT COALESCE(SUM(payment.amount), 0)::NUMERIC AS total
    FROM public.commercial_partner_payments AS payment
    CROSS JOIN params
    WHERE payment.status IN ('completed', 'paid')
      -- payment_date is a business calendar date persisted at UTC midnight.
      AND (payment.payment_date AT TIME ZONE 'UTC')::DATE >= params.month_start
      AND (payment.payment_date AT TIME ZONE 'UTC')::DATE < params.month_end
    UNION ALL
    SELECT COALESCE(SUM(payment.amount), 0)::NUMERIC
    FROM public.wholesale_payments AS payment
    CROSS JOIN params
    WHERE payment.status IN ('completed', 'paid')
      AND (payment.payment_date AT TIME ZONE 'UTC')::DATE >= params.month_start
      AND (payment.payment_date AT TIME ZONE 'UTC')::DATE < params.month_end
  ),
  summary AS (
    SELECT JSONB_BUILD_OBJECT(
      'operations_count', COUNT(*),
      'total_generated', COALESCE(SUM(total_due), 0),
      'total_paid_for_operations', COALESCE(SUM(total_paid), 0),
      'pending_amount_for_operations', COALESCE(SUM(pending_amount), 0),
      'pending_operations_count', COUNT(*) FILTER (WHERE payment_status = 'pending'),
      'partial_operations_count', COUNT(*) FILTER (WHERE payment_status = 'partial'),
      'partners_with_pending_count', COUNT(DISTINCT partner_id) FILTER (WHERE pending_amount > 0),
      'oldest_pending_operation', (
        SELECT JSONB_BUILD_OBJECT(
          'operation_id', oldest.operation_id,
          'operation_folio', oldest.operation_folio,
          'business_name', oldest.business_name,
          'registered_at', oldest.registered_at,
          'days_waiting_payment', oldest.days_waiting_payment,
          'pending_amount', oldest.pending_amount
        )
        FROM operations AS oldest
        WHERE oldest.pending_amount > 0
        ORDER BY oldest.registered_at ASC, oldest.operation_id
        LIMIT 1
      ),
      'collected_during_month', (SELECT COALESCE(SUM(total), 0) FROM payments_collected_in_month)
    ) AS value
    FROM operations
  ),
  partner_payment_medians AS (
    SELECT
      partner_id,
      MAX(business_name) AS business_name,
      MAX(partner_folio) AS partner_folio,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_waiting_payment)::NUMERIC AS median_days,
      COUNT(*)::INTEGER AS operations_count
    FROM operations
    WHERE payment_status = 'paid'
    GROUP BY partner_id
    HAVING COUNT(*) >= 3
  ),
  rankings AS (
    SELECT JSONB_BUILD_OBJECT(
      'fastest_partner', (
        SELECT JSONB_BUILD_OBJECT('partner_id', partner_id, 'partner_folio', partner_folio, 'business_name', business_name, 'median_days', median_days, 'operations_count', operations_count)
        FROM partner_payment_medians ORDER BY median_days ASC, operations_count DESC, business_name LIMIT 1
      ),
      'slowest_partner', (
        SELECT JSONB_BUILD_OBJECT('partner_id', partner_id, 'partner_folio', partner_folio, 'business_name', business_name, 'median_days', median_days, 'operations_count', operations_count)
        FROM partner_payment_medians ORDER BY median_days DESC, operations_count DESC, business_name LIMIT 1
      )
    ) AS value
  ),
  aging AS (
    SELECT JSONB_BUILD_OBJECT(
      'days_0_2', COALESCE(SUM(pending_amount) FILTER (WHERE days_waiting_payment BETWEEN 0 AND 2), 0),
      'days_3_7', COALESCE(SUM(pending_amount) FILTER (WHERE days_waiting_payment BETWEEN 3 AND 7), 0),
      'days_8_15', COALESCE(SUM(pending_amount) FILTER (WHERE days_waiting_payment BETWEEN 8 AND 15), 0),
      'days_over_15', COALESCE(SUM(pending_amount) FILTER (WHERE days_waiting_payment > 15), 0)
    ) AS value
    FROM operations
    WHERE pending_amount > 0
  )
  SELECT JSONB_BUILD_OBJECT(
    'month_start', p_month_start,
    'month_end', p_month_end,
    'summary', (SELECT value FROM summary),
    'operations', COALESCE((SELECT JSONB_AGG(TO_JSONB(operation) ORDER BY operation.registered_at DESC, operation.operation_id) FROM operations AS operation), '[]'::JSONB),
    'payment_speed_rankings', (SELECT value FROM rankings),
    'aging', (SELECT value FROM aging)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_b2b_monthly_collections_report(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_b2b_monthly_collections_report(DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_b2b_monthly_collections_report(DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_b2b_monthly_collections_report(DATE, DATE) IS
  'Read-only monthly B2B collections operations. Uses direct operation payment FKs and historical item snapshots.';
