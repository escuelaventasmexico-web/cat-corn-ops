-- Version the exact monthly B2B RPC definitions already deployed in production.
-- Source: pg_get_functiondef() export captured on 2026-10-16.
-- This migration follows the canonical business_date/view/trigger migration.
-- Do not rerun it manually against production; it exists to keep Git history
-- and fresh environments aligned with the deployed schema.

BEGIN;

-- FUNCION: get_b2b_monthly_analysis(date,date)
CREATE OR REPLACE FUNCTION public.get_b2b_monthly_analysis(p_month_start date, p_month_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF p_month_start IS NULL OR p_month_end IS NULL THEN
    RAISE EXCEPTION 'El periodo mensual es obligatorio';
  END IF;

  IF p_month_start <> date_trunc('month', p_month_start)::DATE
     OR p_month_end <> (p_month_start + INTERVAL '1 month')::DATE THEN
    RAISE EXCEPTION
      'El periodo debe abarcar exactamente un mes calendario [inicio, fin)';
  END IF;

  WITH
  params AS (
    SELECT
      p_month_start AS month_start,
      p_month_end AS month_end,
      (p_month_start - INTERVAL '1 month')::DATE AS previous_month_start,
      p_month_start AS previous_month_end,
      p_month_start::TIMESTAMP AT TIME ZONE 'America/Mexico_City' AS month_start_at,
      p_month_end::TIMESTAMP AT TIME ZONE 'America/Mexico_City' AS month_end_at
  ),
  periods AS (
    SELECT
      'selected'::TEXT AS period_key,
      month_start AS start_date,
      month_end AS end_date,
      month_start_at AS start_at,
      month_end_at AS end_at
    FROM params

    UNION ALL

    SELECT
      'previous'::TEXT,
      previous_month_start,
      previous_month_end,
      previous_month_start::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
      previous_month_end::TIMESTAMP AT TIME ZONE 'America/Mexico_City'
    FROM params
  ),
  comodato_adjustments AS (
    SELECT
      adjustment.adjusts_movement_item_id AS item_id,
      SUM(COALESCE(adjustment.amount_adjusted, 0))::NUMERIC AS amount_adjusted
    FROM public.commercial_partner_movement_items AS adjustment
    JOIN public.commercial_partner_movements AS adjustment_movement
      ON adjustment_movement.id = adjustment.movement_id
    WHERE adjustment.adjusts_movement_item_id IS NOT NULL
      AND LOWER(BTRIM(COALESCE(adjustment_movement.movement_type::TEXT, ''))) = 'adjustment'
      AND LOWER(BTRIM(COALESCE(adjustment_movement.status::TEXT, ''))) = 'completed'
    GROUP BY adjustment.adjusts_movement_item_id
  ),
  comodato_operations AS (
    SELECT
      movement.id AS operation_id,
      movement.partner_id,
      (movement.movement_date AT TIME ZONE 'America/Mexico_City')::DATE AS operation_date,
      COALESCE(
        SUM(
          GREATEST(
            COALESCE(
              item.amount_due,
              COALESCE(item.quantity_sold, 0) * COALESCE(item.price_to_catcorn, 0),
              0
            ) - COALESCE(adjustment.amount_adjusted, 0),
            0
          )
        ) FILTER (WHERE COALESCE(item.quantity_sold, 0) > 0),
        0
      )::NUMERIC AS amount,
      COALESCE(
        SUM(COALESCE(item.quantity_sold, 0))
          FILTER (WHERE COALESCE(item.quantity_sold, 0) > 0),
        0
      )::NUMERIC AS units
    FROM public.commercial_partner_movements AS movement
    JOIN public.commercial_partner_movement_items AS item
      ON item.movement_id = movement.id
    LEFT JOIN comodato_adjustments AS adjustment
      ON adjustment.item_id = item.id
    WHERE LOWER(BTRIM(COALESCE(movement.movement_type::TEXT, ''))) IN (
        'settlement',
        'liquidacion',
        'liquidación',
        'liquidation'
      )
      AND LOWER(BTRIM(COALESCE(movement.status::TEXT, ''))) = 'completed'
    GROUP BY movement.id, movement.partner_id, movement.movement_date
    HAVING COALESCE(
      SUM(COALESCE(item.quantity_sold, 0))
        FILTER (WHERE COALESCE(item.quantity_sold, 0) > 0),
      0
    ) > 0
  ),
  wholesale_operations AS (
    SELECT
      orders.id AS operation_id,
      orders.partner_id,
      CASE
        WHEN orders.released_at IS NOT NULL
          THEN (orders.released_at AT TIME ZONE 'America/Mexico_City')::DATE
        ELSE COALESCE(orders.delivery_date, orders.order_date)
      END AS operation_date,
      COALESCE(
        SUM(
          COALESCE(
            item.subtotal,
            COALESCE(item.quantity, 0)::NUMERIC * COALESCE(item.unit_price, 0),
            0
          )
        ),
        0
      )::NUMERIC AS amount,
      COALESCE(SUM(COALESCE(item.quantity, 0)), 0)::NUMERIC AS units
    FROM public.wholesale_orders AS orders
    JOIN public.wholesale_order_items AS item
      ON item.wholesale_order_id = orders.id
    WHERE LOWER(BTRIM(COALESCE(orders.order_status::TEXT, ''))) IN (
      'delivered',
      'completed'
    )
    GROUP BY
      orders.id,
      orders.partner_id,
      orders.released_at,
      orders.delivery_date,
      orders.order_date
    HAVING COALESCE(SUM(COALESCE(item.quantity, 0)), 0) > 0
  ),
  comodato_generated AS (
    SELECT
      period.period_key,
      operation.partner_id,
      SUM(operation.amount)::NUMERIC AS amount,
      SUM(operation.units)::NUMERIC AS units
    FROM periods AS period
    JOIN comodato_operations AS operation
      ON operation.operation_date >= period.start_date
     AND operation.operation_date < period.end_date
    GROUP BY period.period_key, operation.partner_id
  ),
  wholesale_generated AS (
    SELECT
      period.period_key,
      operation.partner_id,
      SUM(operation.amount)::NUMERIC AS amount,
      SUM(operation.units)::NUMERIC AS units
    FROM periods AS period
    JOIN wholesale_operations AS operation
      ON operation.operation_date >= period.start_date
     AND operation.operation_date < period.end_date
    GROUP BY period.period_key, operation.partner_id
  ),
  piece_generated AS (
    SELECT
      period.period_key,
      COALESCE(SUM(COALESCE(sale.total_amount, 0)), 0)::NUMERIC AS amount,
      COALESCE(SUM(item_units.units), 0)::NUMERIC AS units
    FROM periods AS period
    JOIN public.seller_piece_sales AS sale
      ON sale.sale_date >= period.start_at
     AND sale.sale_date < period.end_at
     AND LOWER(BTRIM(COALESCE(sale.status::TEXT, ''))) = 'confirmed'
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(COALESCE(item.quantity, 0)), 0)::NUMERIC AS units
      FROM public.seller_piece_sale_items AS item
      WHERE item.sale_id = sale.id
    ) AS item_units ON TRUE
    GROUP BY period.period_key
  ),
  comodato_paid AS (
    SELECT
      period.period_key,
      payment.partner_id,
      COALESCE(SUM(COALESCE(payment.amount, 0)), 0)::NUMERIC AS amount
    FROM periods AS period
    JOIN public.commercial_partner_payments AS payment
      ON public.resolve_b2b_payment_business_date(payment.payment_date, payment.created_at, payment.business_date) >= period.start_date
     AND public.resolve_b2b_payment_business_date(payment.payment_date, payment.created_at, payment.business_date) < period.end_date
    JOIN public.commercial_partner_movements AS movement
      ON movement.id = payment.movement_id
     AND LOWER(BTRIM(COALESCE(movement.movement_type::TEXT, ''))) IN (
       'settlement',
       'liquidacion',
       'liquidación',
       'liquidation'
     )
     AND LOWER(BTRIM(COALESCE(movement.status::TEXT, ''))) = 'completed'
    WHERE LOWER(BTRIM(COALESCE(payment.status::TEXT, ''))) IN ('completed', 'paid')
    GROUP BY period.period_key, payment.partner_id
  ),
  wholesale_paid AS (
    SELECT
      period.period_key,
      payment.partner_id,
      COALESCE(SUM(COALESCE(payment.amount, 0)), 0)::NUMERIC AS amount
    FROM periods AS period
    JOIN public.wholesale_payments AS payment
      ON public.resolve_b2b_payment_business_date(payment.payment_date, payment.created_at, payment.business_date) >= period.start_date
     AND public.resolve_b2b_payment_business_date(payment.payment_date, payment.created_at, payment.business_date) < period.end_date
    JOIN public.wholesale_orders AS orders
      ON orders.id = payment.wholesale_order_id
     AND LOWER(BTRIM(COALESCE(orders.order_status::TEXT, ''))) IN (
       'delivered',
       'completed'
     )
    WHERE LOWER(BTRIM(COALESCE(payment.status::TEXT, ''))) IN ('completed', 'paid')
    GROUP BY period.period_key, payment.partner_id
  ),
  piece_paid AS (
    SELECT
      period.period_key,
      COALESCE(SUM(COALESCE(payment.amount, 0)), 0)::NUMERIC AS amount
    FROM periods AS period
    JOIN public.seller_piece_payments AS payment
      ON public.resolve_b2b_payment_business_date(payment.payment_date, payment.created_at, payment.business_date) >= period.start_date
     AND public.resolve_b2b_payment_business_date(payment.payment_date, payment.created_at, payment.business_date) < period.end_date
    JOIN public.seller_piece_sales AS sale
      ON sale.id = payment.sale_id
     AND LOWER(BTRIM(COALESCE(sale.status::TEXT, ''))) = 'confirmed'
    WHERE LOWER(BTRIM(COALESCE(payment.status::TEXT, ''))) = 'completed'
    GROUP BY period.period_key
  ),
  summaries AS (
    SELECT
      period.period_key,
      COALESCE((
        SELECT SUM(generated.amount)
        FROM comodato_generated AS generated
        WHERE generated.period_key = period.period_key
      ), 0)::NUMERIC AS comodato_generated,
      COALESCE((
        SELECT SUM(generated.units)
        FROM comodato_generated AS generated
        WHERE generated.period_key = period.period_key
      ), 0)::NUMERIC AS comodato_units,
      COALESCE((
        SELECT SUM(paid.amount)
        FROM comodato_paid AS paid
        WHERE paid.period_key = period.period_key
      ), 0)::NUMERIC AS comodato_paid,
      COALESCE((
        SELECT SUM(generated.amount)
        FROM wholesale_generated AS generated
        WHERE generated.period_key = period.period_key
      ), 0)::NUMERIC AS wholesale_purchased,
      COALESCE((
        SELECT SUM(generated.units)
        FROM wholesale_generated AS generated
        WHERE generated.period_key = period.period_key
      ), 0)::NUMERIC AS wholesale_units,
      COALESCE((
        SELECT SUM(paid.amount)
        FROM wholesale_paid AS paid
        WHERE paid.period_key = period.period_key
      ), 0)::NUMERIC AS wholesale_paid,
      COALESCE((
        SELECT generated.amount
        FROM piece_generated AS generated
        WHERE generated.period_key = period.period_key
      ), 0)::NUMERIC AS piece_generated,
      COALESCE((
        SELECT generated.units
        FROM piece_generated AS generated
        WHERE generated.period_key = period.period_key
      ), 0)::NUMERIC AS piece_units,
      COALESCE((
        SELECT paid.amount
        FROM piece_paid AS paid
        WHERE paid.period_key = period.period_key
      ), 0)::NUMERIC AS piece_paid
    FROM periods AS period
  ),
  current_operation_payments AS (
    SELECT
      operation.operation_id,
      'comodato'::TEXT AS source_type,
      COALESCE(
        SUM(COALESCE(payment.amount, 0)) FILTER (
          WHERE LOWER(BTRIM(COALESCE(payment.status::TEXT, ''))) IN ('completed', 'paid')
        ),
        0
      )::NUMERIC AS total_paid
    FROM comodato_operations AS operation
    LEFT JOIN public.commercial_partner_payments AS payment
      ON payment.movement_id = operation.operation_id
    GROUP BY operation.operation_id

    UNION ALL

    SELECT
      operation.operation_id,
      'mayoreo'::TEXT,
      COALESCE(
        SUM(COALESCE(payment.amount, 0)) FILTER (
          WHERE LOWER(BTRIM(COALESCE(payment.status::TEXT, ''))) IN ('completed', 'paid')
        ),
        0
      )::NUMERIC
    FROM wholesale_operations AS operation
    LEFT JOIN public.wholesale_payments AS payment
      ON payment.wholesale_order_id = operation.operation_id
    GROUP BY operation.operation_id
  ),
  ranking_rows AS (
    SELECT
      operation.partner_id,
      operation.operation_date,
      operation.amount AS comodato_generated,
      0::NUMERIC AS wholesale_purchased,
      operation.units AS comodato_units,
      0::NUMERIC AS wholesale_units,
      GREATEST(operation.amount - COALESCE(payment.total_paid, 0), 0)::NUMERIC AS pending_amount
    FROM comodato_operations AS operation
    JOIN params
      ON operation.operation_date >= params.month_start
     AND operation.operation_date < params.month_end
    LEFT JOIN current_operation_payments AS payment
      ON payment.operation_id = operation.operation_id
     AND payment.source_type = 'comodato'

    UNION ALL

    SELECT
      operation.partner_id,
      operation.operation_date,
      0::NUMERIC,
      operation.amount,
      0::NUMERIC,
      operation.units,
      GREATEST(operation.amount - COALESCE(payment.total_paid, 0), 0)::NUMERIC
    FROM wholesale_operations AS operation
    JOIN params
      ON operation.operation_date >= params.month_start
     AND operation.operation_date < params.month_end
    LEFT JOIN current_operation_payments AS payment
      ON payment.operation_id = operation.operation_id
     AND payment.source_type = 'mayoreo'
  ),
  ranking_generated AS (
    SELECT
      partner_id,
      SUM(comodato_generated)::NUMERIC AS comodato_generated,
      SUM(wholesale_purchased)::NUMERIC AS wholesale_purchased,
      SUM(comodato_units)::NUMERIC AS comodato_units,
      SUM(wholesale_units)::NUMERIC AS wholesale_units,
      SUM(pending_amount)::NUMERIC AS pending_amount,
      MAX(operation_date) AS last_purchase_date
    FROM ranking_rows
    GROUP BY partner_id
  ),
  ranking_paid AS (
    SELECT partner_id, SUM(amount)::NUMERIC AS paid_amount
    FROM (
      SELECT partner_id, amount
      FROM comodato_paid
      WHERE period_key = 'selected'

      UNION ALL

      SELECT partner_id, amount
      FROM wholesale_paid
      WHERE period_key = 'selected'
    ) AS payments
    GROUP BY partner_id
  ),
  ranking_partner_keys AS (
    SELECT partner_id FROM ranking_generated
    UNION
    SELECT partner_id FROM ranking_paid
  ),
  rankings AS (
    SELECT COALESCE(
      JSONB_AGG(
        TO_JSONB(ranking_row)
        ORDER BY
          ranking_row.b2b_total_generated DESC,
          ranking_row.b2b_total_paid DESC,
          ranking_row.business_name,
          ranking_row.partner_id
      ),
      '[]'::JSONB
    ) AS value
    FROM (
      SELECT
        partner.id AS partner_id,
        partner.folio::TEXT AS folio,
        partner.business_name,
        partner.responsible_name,
        partner.partner_model::TEXT AS partner_model,
        COALESCE(generated.comodato_generated, 0)::NUMERIC AS comodato_generated,
        COALESCE(generated.wholesale_purchased, 0)::NUMERIC AS wholesale_purchased,
        (
          COALESCE(generated.comodato_generated, 0)
          + COALESCE(generated.wholesale_purchased, 0)
        )::NUMERIC AS b2b_total_generated,
        COALESCE(paid.paid_amount, 0)::NUMERIC AS b2b_total_paid,
        COALESCE(generated.pending_amount, 0)::NUMERIC AS b2b_pending_balance,
        (
          COALESCE(generated.comodato_units, 0)
          + COALESCE(generated.wholesale_units, 0)
        )::NUMERIC AS b2b_total_units,
        generated.last_purchase_date
      FROM ranking_partner_keys AS partner_key
      JOIN public.commercial_partners AS partner
        ON partner.id = partner_key.partner_id
      LEFT JOIN ranking_generated AS generated
        ON generated.partner_id = partner.id
      LEFT JOIN ranking_paid AS paid
        ON paid.partner_id = partner.id
    ) AS ranking_row
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
      FROM summaries
      WHERE period_key = 'selected'
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
      FROM summaries
      WHERE period_key = 'previous'
    ),
    'rankings', (SELECT value FROM rankings)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;


-- FUNCION: get_b2b_monthly_collections_report(date,date)
CREATE OR REPLACE FUNCTION public.get_b2b_monthly_collections_report(p_month_start date, p_month_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  comodato_adjustments AS (
    SELECT
      adjustment.adjusts_movement_item_id AS item_id,
      SUM(COALESCE(adjustment.amount_adjusted, 0))::NUMERIC AS amount_adjusted
    FROM public.commercial_partner_movement_items AS adjustment
    JOIN public.commercial_partner_movements AS adjustment_movement
      ON adjustment_movement.id = adjustment.movement_id
    WHERE adjustment.adjusts_movement_item_id IS NOT NULL
      AND LOWER(BTRIM(COALESCE(adjustment_movement.movement_type::TEXT, ''))) = 'adjustment'
      AND LOWER(BTRIM(COALESCE(adjustment_movement.status::TEXT, ''))) = 'completed'
    GROUP BY adjustment.adjusts_movement_item_id
  ),
  comodato_products AS (
    SELECT
      item.movement_id AS operation_id,
      COALESCE(SUM(GREATEST(
        COALESCE(item.amount_due, 0) - COALESCE(adjustment.amount_adjusted, 0),
        0
      )), 0)::NUMERIC AS total_due,
      COALESCE(JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'product_id', item.product_id,
          'product_name', item.product_name,
          'product_variant', item.product_variant,
          'product_size', item.product_size,
          'quantity', COALESCE(item.quantity_sold, 0),
          'unit_price', item.price_to_catcorn,
          'amount', GREATEST(
            COALESCE(item.amount_due, 0) - COALESCE(adjustment.amount_adjusted, 0),
            0
          ),
          'historical_identity_unverified', item.product_id IS NULL
        ) ORDER BY item.product_name, item.product_variant, item.product_size, item.id
      ) FILTER (WHERE COALESCE(item.quantity_sold, 0) > 0), '[]'::JSONB) AS products
    FROM public.commercial_partner_movement_items AS item
    LEFT JOIN comodato_adjustments AS adjustment
      ON adjustment.item_id = item.id
    WHERE COALESCE(item.quantity_sold, 0) > 0
    GROUP BY item.movement_id
  ),
  comodato_payment_rows AS (
    SELECT
      payment.movement_id AS operation_id,
      -- Use the canonical DATE to avoid shifting confirmed collections across days.
      public.resolve_b2b_payment_business_date(payment.payment_date, payment.created_at, payment.business_date) AS payment_on,
      payment.created_at,
      payment.amount,
      SUM(payment.amount) OVER (
        PARTITION BY payment.movement_id
        ORDER BY public.resolve_b2b_payment_business_date(payment.payment_date, payment.created_at, payment.business_date), payment.created_at, payment.id
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
      MIN(rows.payment_on) FILTER (WHERE rows.running_paid >= products.total_due) AS fully_paid_on
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
      -- Use the canonical DATE to avoid shifting confirmed collections across days.
      public.resolve_b2b_payment_business_date(payment.payment_date, payment.created_at, payment.business_date) AS payment_on,
      payment.created_at,
      payment.amount,
      SUM(payment.amount) OVER (
        PARTITION BY payment.wholesale_order_id
        ORDER BY public.resolve_b2b_payment_business_date(payment.payment_date, payment.created_at, payment.business_date), payment.created_at, payment.id
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
      MIN(rows.payment_on) FILTER (WHERE rows.running_paid >= products.total_due) AS fully_paid_on
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
      payments.fully_paid_on,
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
      payments.fully_paid_on,
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
      CASE
        WHEN operation.fully_paid_on IS NOT NULL THEN
          GREATEST(
            0,
            operation.fully_paid_on - (operation.registered_at AT TIME ZONE 'America/Mexico_City')::DATE
          )
        ELSE
          GREATEST(
            0,
            (params.now_at AT TIME ZONE 'America/Mexico_City')::DATE
            - (operation.registered_at AT TIME ZONE 'America/Mexico_City')::DATE
          )
      END::INTEGER AS days_waiting_payment,
      CASE
        WHEN operation.payment_due_at IS NOT NULL AND operation.pending_amount > 0 THEN
          GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (params.now_at - operation.payment_due_at)) / 86400)
          )::INTEGER
        ELSE 0
      END AS days_overdue
    FROM all_operations AS operation
    CROSS JOIN params
  ),
  payments_collected_in_month AS (
    SELECT COALESCE(SUM(payment.amount), 0)::NUMERIC AS total
    FROM public.commercial_partner_payments AS payment
    CROSS JOIN params
    WHERE payment.status IN ('completed', 'paid')
      -- Filter by the canonical business DATE (not the raw payment timestamp).
      AND public.resolve_b2b_payment_business_date(payment.payment_date, payment.created_at, payment.business_date) >= params.month_start
      AND public.resolve_b2b_payment_business_date(payment.payment_date, payment.created_at, payment.business_date) < params.month_end
    UNION ALL
    SELECT COALESCE(SUM(payment.amount), 0)::NUMERIC
    FROM public.wholesale_payments AS payment
    CROSS JOIN params
    WHERE payment.status IN ('completed', 'paid')
      AND public.resolve_b2b_payment_business_date(payment.payment_date, payment.created_at, payment.business_date) >= params.month_start
      AND public.resolve_b2b_payment_business_date(payment.payment_date, payment.created_at, payment.business_date) < params.month_end
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
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
