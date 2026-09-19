-- Additive, read-only source for the monthly B2B report.
-- Existing B2B views and report RPCs intentionally remain unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_b2b_monthly_analysis(
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
      (p_month_start - INTERVAL '1 month')::DATE AS previous_month_start,
      p_month_start AS previous_month_end,
      (p_month_start::TIMESTAMP AT TIME ZONE 'America/Mexico_City') AS month_start_at,
      (p_month_end::TIMESTAMP AT TIME ZONE 'America/Mexico_City') AS month_end_at
  ),
  periods AS (
    SELECT 'selected'::TEXT AS period_key, month_start AS start_date, month_end AS end_date,
      month_start_at AS start_at, month_end_at AS end_at
    FROM params
    UNION ALL
    SELECT 'previous'::TEXT, previous_month_start, previous_month_end,
      (previous_month_start::TIMESTAMP AT TIME ZONE 'America/Mexico_City'),
      (previous_month_end::TIMESTAMP AT TIME ZONE 'America/Mexico_City')
    FROM params
  ),
  comodato_operations AS (
    SELECT
      movement.id AS operation_id,
      movement.partner_id,
      movement.movement_date::DATE AS operation_date,
      COALESCE(SUM(item.amount_due) FILTER (WHERE COALESCE(item.quantity_sold, 0) > 0), 0)::NUMERIC AS amount,
      COALESCE(SUM(item.quantity_sold) FILTER (WHERE COALESCE(item.quantity_sold, 0) > 0), 0)::NUMERIC AS units
    FROM public.commercial_partner_movements AS movement
    JOIN public.commercial_partner_movement_items AS item ON item.movement_id = movement.id
    WHERE movement.movement_type = 'settlement'
      AND movement.status = 'completed'
    GROUP BY movement.id, movement.partner_id, movement.movement_date
    HAVING COALESCE(SUM(item.quantity_sold) FILTER (WHERE COALESCE(item.quantity_sold, 0) > 0), 0) > 0
  ),
  wholesale_operations AS (
    SELECT
      orders.id AS operation_id,
      orders.partner_id,
      (COALESCE(
        orders.released_at,
        orders.delivery_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
        orders.order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City'
      ) AT TIME ZONE 'America/Mexico_City')::DATE AS operation_date,
      COALESCE(SUM(COALESCE(item.subtotal, item.quantity * item.unit_price)), 0)::NUMERIC AS amount,
      COALESCE(SUM(item.quantity), 0)::NUMERIC AS units
    FROM public.wholesale_orders AS orders
    JOIN public.wholesale_order_items AS item ON item.wholesale_order_id = orders.id
    WHERE orders.order_status IN ('delivered', 'completed')
    GROUP BY orders.id, orders.partner_id, orders.released_at, orders.delivery_date, orders.order_date
    HAVING COALESCE(SUM(item.quantity), 0) > 0
  ),
  comodato_generated AS (
    SELECT period.period_key, operation.partner_id,
      COALESCE(SUM(operation.amount), 0)::NUMERIC AS amount,
      COALESCE(SUM(operation.units), 0)::NUMERIC AS units
    FROM periods AS period
    JOIN comodato_operations AS operation
      ON operation.operation_date >= period.start_date
     AND operation.operation_date < period.end_date
    GROUP BY period.period_key, operation.partner_id
  ),
  wholesale_generated AS (
    SELECT period.period_key, operation.partner_id,
      COALESCE(SUM(operation.amount), 0)::NUMERIC AS amount,
      COALESCE(SUM(operation.units), 0)::NUMERIC AS units
    FROM periods AS period
    JOIN wholesale_operations AS operation
      ON operation.operation_date >= period.start_date
     AND operation.operation_date < period.end_date
    GROUP BY period.period_key, operation.partner_id
  ),
  piece_generated AS (
    SELECT period.period_key,
      COALESCE(SUM(sale.total_amount), 0)::NUMERIC AS amount,
      COALESCE(SUM(item_units.units), 0)::NUMERIC AS units
    FROM periods AS period
    JOIN public.seller_piece_sales AS sale
      ON sale.sale_date >= period.start_at
     AND sale.sale_date < period.end_at
     AND sale.status = 'confirmed'
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(item.quantity), 0)::NUMERIC AS units
      FROM public.seller_piece_sale_items AS item
      WHERE item.sale_id = sale.id
    ) AS item_units ON TRUE
    GROUP BY period.period_key
  ),
  comodato_paid AS (
    SELECT period.period_key, payment.partner_id,
      COALESCE(SUM(payment.amount), 0)::NUMERIC AS amount
    FROM periods AS period
    JOIN public.commercial_partner_payments AS payment
      ON (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE >= period.start_date
     AND (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE < period.end_date
    JOIN public.commercial_partner_movements AS movement
      ON movement.id = payment.movement_id
     AND movement.movement_type = 'settlement'
     AND movement.status = 'completed'
    WHERE payment.status IN ('completed', 'paid')
    GROUP BY period.period_key, payment.partner_id
  ),
  wholesale_paid AS (
    SELECT period.period_key, payment.partner_id,
      COALESCE(SUM(payment.amount), 0)::NUMERIC AS amount
    FROM periods AS period
    JOIN public.wholesale_payments AS payment
      ON (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE >= period.start_date
     AND (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE < period.end_date
    JOIN public.wholesale_orders AS orders
      ON orders.id = payment.wholesale_order_id
     AND orders.order_status IN ('delivered', 'completed')
    WHERE payment.status IN ('completed', 'paid')
    GROUP BY period.period_key, payment.partner_id
  ),
  piece_paid AS (
    SELECT period.period_key, COALESCE(SUM(payment.amount), 0)::NUMERIC AS amount
    FROM periods AS period
    JOIN public.seller_piece_payments AS payment
      ON (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE >= period.start_date
     AND (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE < period.end_date
    JOIN public.seller_piece_sales AS sale
      ON sale.id = payment.sale_id
     AND sale.status = 'confirmed'
    WHERE payment.status = 'completed'
    GROUP BY period.period_key
  ),
  summaries AS (
    SELECT
      period.period_key,
      COALESCE((SELECT SUM(generated.amount) FROM comodato_generated AS generated WHERE generated.period_key = period.period_key), 0)::NUMERIC AS comodato_generated,
      COALESCE((SELECT SUM(generated.units) FROM comodato_generated AS generated WHERE generated.period_key = period.period_key), 0)::NUMERIC AS comodato_units,
      COALESCE((SELECT SUM(paid.amount) FROM comodato_paid AS paid WHERE paid.period_key = period.period_key), 0)::NUMERIC AS comodato_paid,
      COALESCE((SELECT SUM(generated.amount) FROM wholesale_generated AS generated WHERE generated.period_key = period.period_key), 0)::NUMERIC AS wholesale_purchased,
      COALESCE((SELECT SUM(generated.units) FROM wholesale_generated AS generated WHERE generated.period_key = period.period_key), 0)::NUMERIC AS wholesale_units,
      COALESCE((SELECT SUM(paid.amount) FROM wholesale_paid AS paid WHERE paid.period_key = period.period_key), 0)::NUMERIC AS wholesale_paid,
      COALESCE((SELECT generated.amount FROM piece_generated AS generated WHERE generated.period_key = period.period_key), 0)::NUMERIC AS piece_generated,
      COALESCE((SELECT generated.units FROM piece_generated AS generated WHERE generated.period_key = period.period_key), 0)::NUMERIC AS piece_units,
      COALESCE((SELECT paid.amount FROM piece_paid AS paid WHERE paid.period_key = period.period_key), 0)::NUMERIC AS piece_paid
    FROM periods AS period
  ),
  current_operation_payments AS (
    SELECT operation.operation_id, 'comodato'::TEXT AS source_type,
      COALESCE(SUM(payment.amount) FILTER (WHERE payment.status IN ('completed', 'paid')), 0)::NUMERIC AS total_paid
    FROM comodato_operations AS operation
    LEFT JOIN public.commercial_partner_payments AS payment ON payment.movement_id = operation.operation_id
    GROUP BY operation.operation_id
    UNION ALL
    SELECT operation.operation_id, 'mayoreo'::TEXT,
      COALESCE(SUM(payment.amount) FILTER (WHERE payment.status IN ('completed', 'paid')), 0)::NUMERIC
    FROM wholesale_operations AS operation
    LEFT JOIN public.wholesale_payments AS payment ON payment.wholesale_order_id = operation.operation_id
    GROUP BY operation.operation_id
  ),
  ranking_rows AS (
    SELECT operation.partner_id,
      operation.amount AS comodato_generated,
      0::NUMERIC AS wholesale_purchased,
      operation.units AS comodato_units,
      0::NUMERIC AS wholesale_units,
      GREATEST(operation.amount - COALESCE(payment.total_paid, 0), 0)::NUMERIC AS pending_amount
    FROM comodato_operations AS operation
    JOIN params ON operation.operation_date >= params.month_start AND operation.operation_date < params.month_end
    LEFT JOIN current_operation_payments AS payment
      ON payment.operation_id = operation.operation_id AND payment.source_type = 'comodato'
    UNION ALL
    SELECT operation.partner_id,
      0::NUMERIC,
      operation.amount,
      0::NUMERIC,
      operation.units,
      GREATEST(operation.amount - COALESCE(payment.total_paid, 0), 0)::NUMERIC
    FROM wholesale_operations AS operation
    JOIN params ON operation.operation_date >= params.month_start AND operation.operation_date < params.month_end
    LEFT JOIN current_operation_payments AS payment
      ON payment.operation_id = operation.operation_id AND payment.source_type = 'mayoreo'
  ),
  ranking_paid AS (
    SELECT partner_id, SUM(amount)::NUMERIC AS paid_amount
    FROM (
      SELECT partner_id, amount FROM comodato_paid WHERE period_key = 'selected'
      UNION ALL
      SELECT partner_id, amount FROM wholesale_paid WHERE period_key = 'selected'
    ) AS payments
    GROUP BY partner_id
  ),
  rankings AS (
    SELECT COALESCE(JSONB_AGG(TO_JSONB(row) ORDER BY row.b2b_total_generated DESC, row.business_name, row.partner_id), '[]'::JSONB) AS value
    FROM (
      SELECT
        partner.id AS partner_id,
        partner.folio::TEXT AS folio,
        partner.business_name,
        partner.responsible_name,
        partner.partner_model::TEXT AS partner_model,
        COALESCE(SUM(source.comodato_generated), 0)::NUMERIC AS comodato_generated,
        COALESCE(SUM(source.wholesale_purchased), 0)::NUMERIC AS wholesale_purchased,
        (COALESCE(SUM(source.comodato_generated), 0) + COALESCE(SUM(source.wholesale_purchased), 0))::NUMERIC AS b2b_total_generated,
        COALESCE(MAX(paid.paid_amount), 0)::NUMERIC AS b2b_total_paid,
        COALESCE(SUM(source.pending_amount), 0)::NUMERIC AS b2b_pending_balance,
        (COALESCE(SUM(source.comodato_units), 0) + COALESCE(SUM(source.wholesale_units), 0))::NUMERIC AS b2b_total_units,
        NULL::DATE AS last_purchase_date
      FROM ranking_rows AS source
      JOIN public.commercial_partners AS partner ON partner.id = source.partner_id
      LEFT JOIN ranking_paid AS paid ON paid.partner_id = source.partner_id
      GROUP BY partner.id, partner.folio, partner.business_name, partner.responsible_name, partner.partner_model
    ) AS row
  )
  SELECT JSONB_BUILD_OBJECT(
    'month_start', p_month_start,
    'month_end', p_month_end,
    'selected', (
      SELECT JSONB_BUILD_OBJECT(
        'comodato_generated', comodato_generated,
        'comodato_paid', comodato_paid,
        'comodato_units', comodato_units,
        'wholesale_purchased', wholesale_purchased,
        'wholesale_paid', wholesale_paid,
        'wholesale_units', wholesale_units,
        'piece_generated', piece_generated,
        'piece_paid', piece_paid,
        'piece_units', piece_units,
        'total_generated', comodato_generated + wholesale_purchased + piece_generated,
        'total_paid', comodato_paid + wholesale_paid + piece_paid,
        'total_units', comodato_units + wholesale_units + piece_units
      )
      FROM summaries WHERE period_key = 'selected'
    ),
    'previous', (
      SELECT JSONB_BUILD_OBJECT(
        'comodato_generated', comodato_generated,
        'comodato_paid', comodato_paid,
        'comodato_units', comodato_units,
        'wholesale_purchased', wholesale_purchased,
        'wholesale_paid', wholesale_paid,
        'wholesale_units', wholesale_units,
        'piece_generated', piece_generated,
        'piece_paid', piece_paid,
        'piece_units', piece_units,
        'total_generated', comodato_generated + wholesale_purchased + piece_generated,
        'total_paid', comodato_paid + wholesale_paid + piece_paid,
        'total_units', comodato_units + wholesale_units + piece_units
      )
      FROM summaries WHERE period_key = 'previous'
    ),
    'rankings', (SELECT value FROM rankings)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_b2b_monthly_analysis(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_b2b_monthly_analysis(DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_b2b_monthly_analysis(DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_b2b_monthly_analysis(DATE, DATE) IS
  'Read-only monthly B2B metrics and rankings. Uses commercial dates for operations and approval payment_date for collections.';

NOTIFY pgrst, 'reload schema';

COMMIT;
