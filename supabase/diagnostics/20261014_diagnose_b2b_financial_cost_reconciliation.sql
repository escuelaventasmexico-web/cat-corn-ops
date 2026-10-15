BEGIN;
SET TRANSACTION READ ONLY;

WITH params AS (
  SELECT
    DATE '2026-10-01' AS start_date,
    DATE '2026-11-01' AS end_date_exclusive,
    TIMESTAMPTZ '2026-10-01 00:00:00-06' AS start_at,
    TIMESTAMPTZ '2026-11-01 00:00:00-06' AS end_at_exclusive
),
comodato_products AS (
  SELECT
    item.movement_id AS operation_id,
    SUM(COALESCE(item.quantity_sold, 0))::NUMERIC AS units,
    SUM(COALESCE(item.amount_due, 0))::NUMERIC AS recorded_amount,
    SUM(GREATEST(COALESCE(item.amount_due, 0) - COALESCE(adjustment.amount, 0), 0))::NUMERIC AS summary_amount,
    SUM(
      CASE
        WHEN COALESCE(item.amount_due, 0) = 0
          THEN COALESCE(item.quantity_sold, 0) * COALESCE(item.price_to_catcorn, 0)
        ELSE item.amount_due
      END
    )::NUMERIC AS products_amount,
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'item_id', item.id,
      'product_id', item.product_id,
      'product_name', item.product_name,
      'product_variant', item.product_variant,
      'product_size', item.product_size,
      'quantity', COALESCE(item.quantity_sold, 0),
      'unit_price', COALESCE(item.price_to_catcorn, 0),
      'recorded_amount_due', COALESCE(item.amount_due, 0),
      'approved_adjustments', COALESCE(adjustment.amount, 0),
      'summary_effective_amount', GREATEST(COALESCE(item.amount_due, 0) - COALESCE(adjustment.amount, 0), 0),
      'products_report_amount', CASE
        WHEN COALESCE(item.amount_due, 0) = 0
          THEN COALESCE(item.quantity_sold, 0) * COALESCE(item.price_to_catcorn, 0)
        ELSE item.amount_due
      END
    ) ORDER BY item.id) FILTER (WHERE COALESCE(item.quantity_sold, 0) > 0) AS products
  FROM public.commercial_partner_movement_items AS item
  LEFT JOIN LATERAL (
    SELECT SUM(COALESCE(adjustment_item.amount_adjusted, 0))::NUMERIC AS amount
    FROM public.commercial_partner_movement_items AS adjustment_item
    JOIN public.commercial_partner_movements AS adjustment_movement
      ON adjustment_movement.id = adjustment_item.movement_id
    WHERE adjustment_item.adjusts_movement_item_id = item.id
      AND LOWER(BTRIM(adjustment_movement.movement_type::TEXT)) = 'adjustment'
      AND LOWER(BTRIM(adjustment_movement.status::TEXT)) = 'completed'
  ) AS adjustment ON TRUE
  GROUP BY item.movement_id
),
comodato_payments AS (
  SELECT
    payment.movement_id AS operation_id,
    SUM(payment.amount) FILTER (WHERE payment.status IN ('completed', 'paid'))::NUMERIC AS paid_all_time,
    SUM(payment.amount) FILTER (
      WHERE payment.status IN ('completed', 'paid')
        AND (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE >= params.start_date
        AND (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE < params.end_date_exclusive
    )::NUMERIC AS paid_in_period,
    SUM(payment.amount) FILTER (
      WHERE payment.status IN ('completed', 'paid')
        AND (payment.payment_date AT TIME ZONE 'UTC')::DATE >= params.start_date
        AND (payment.payment_date AT TIME ZONE 'UTC')::DATE < params.end_date_exclusive
    )::NUMERIC AS paid_in_collections_period,
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'payment_id', payment.id,
      'payment_date', payment.payment_date,
      'amount', payment.amount,
      'status', payment.status
    ) ORDER BY payment.payment_date, payment.created_at, payment.id)
      FILTER (WHERE payment.status IN ('completed', 'paid')) AS payments
  FROM public.commercial_partner_payments AS payment
  CROSS JOIN params
  WHERE payment.movement_id IS NOT NULL
  GROUP BY payment.movement_id
),
comodato_operations AS (
  SELECT
    'comodato'::TEXT AS modality,
    movement.id AS operation_id,
    movement.partner_id,
    COALESCE(NULLIF(partner.business_name, ''), NULLIF(partner.responsible_name, ''), movement.partner_id::TEXT) AS partner_name,
    movement.movement_date::DATE AS movement_date,
    movement.movement_date::DATE AS products_recognition_date,
    movement.movement_date::DATE AS summary_recognition_date,
    (movement.created_at AT TIME ZONE 'America/Mexico_City')::DATE AS collections_recognition_date,
    movement.created_at AS registered_at,
    movement.status::TEXT AS operation_status,
    movement.movement_type::TEXT AS operation_type,
    COALESCE(products.units, 0) AS units,
    COALESCE(products.recorded_amount, 0) AS recorded_amount,
    COALESCE(products.products_amount, 0) AS products_recognized_amount,
    COALESCE(products.summary_amount, 0) AS summary_recognized_amount,
    COALESCE(payment.paid_in_period, 0) AS paid_in_period,
    COALESCE(payment.paid_in_collections_period, 0) AS paid_in_collections_period,
    COALESCE(payment.paid_all_time, 0) AS paid_all_time,
    GREATEST(COALESCE(products.summary_amount, 0) - COALESCE(payment.paid_all_time, 0), 0) AS pending_all_time,
    products.products,
    payment.payments,
    movement.status = 'completed'
      AND movement.movement_type::TEXT IN ('settlement', 'liquidacion', 'liquidation')
      AND movement.movement_date >= params.start_date
      AND movement.movement_date < params.end_date_exclusive AS included_in_products,
    movement.status = 'completed'
      AND movement.movement_type = 'settlement'
      AND movement.movement_date >= params.start_date
      AND movement.movement_date < params.end_date_exclusive AS included_in_summary,
    movement.status = 'completed'
      AND movement.movement_type = 'settlement'
      AND movement.created_at >= params.start_at
      AND movement.created_at < params.end_at_exclusive AS included_in_collections_operations,
    'commercial_partner_movements + commercial_partner_movement_items'::TEXT AS source
  FROM public.commercial_partner_movements AS movement
  JOIN comodato_products AS products ON products.operation_id = movement.id AND products.units > 0
  JOIN public.commercial_partners AS partner ON partner.id = movement.partner_id
  LEFT JOIN comodato_payments AS payment ON payment.operation_id = movement.id
  CROSS JOIN params
  WHERE (
      movement.movement_date >= params.start_date
      AND movement.movement_date < params.end_date_exclusive
    ) OR (
      movement.created_at >= params.start_at
      AND movement.created_at < params.end_at_exclusive
    ) OR COALESCE(payment.paid_in_period, 0) <> 0
      OR COALESCE(payment.paid_in_collections_period, 0) <> 0
),
wholesale_products AS (
  SELECT
    item.wholesale_order_id AS operation_id,
    SUM(COALESCE(item.quantity, 0))::NUMERIC AS units,
    SUM(COALESCE(item.subtotal, item.quantity * item.unit_price, 0))::NUMERIC AS amount,
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'item_id', item.id,
      'product_id', NULLIF(TO_JSONB(item)->>'product_id', '')::UUID,
      'product_code', item.product_code,
      'product_name', item.product_name,
      'product_variant', item.product_variant,
      'product_size', item.product_size,
      'quantity', COALESCE(item.quantity, 0),
      'unit_price', COALESCE(item.unit_price, 0),
      'amount', COALESCE(item.subtotal, item.quantity * item.unit_price, 0)
    ) ORDER BY item.id) AS products
  FROM public.wholesale_order_items AS item
  GROUP BY item.wholesale_order_id
),
wholesale_payments AS (
  SELECT
    payment.wholesale_order_id AS operation_id,
    SUM(payment.amount) FILTER (WHERE payment.status IN ('completed', 'paid'))::NUMERIC AS paid_all_time,
    SUM(payment.amount) FILTER (
      WHERE payment.status IN ('completed', 'paid')
        AND (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE >= params.start_date
        AND (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE < params.end_date_exclusive
    )::NUMERIC AS paid_in_period,
    SUM(payment.amount) FILTER (
      WHERE payment.status IN ('completed', 'paid')
        AND (payment.payment_date AT TIME ZONE 'UTC')::DATE >= params.start_date
        AND (payment.payment_date AT TIME ZONE 'UTC')::DATE < params.end_date_exclusive
    )::NUMERIC AS paid_in_collections_period,
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'payment_id', payment.id,
      'payment_date', payment.payment_date,
      'amount', payment.amount,
      'status', payment.status
    ) ORDER BY payment.payment_date, payment.created_at, payment.id)
      FILTER (WHERE payment.status IN ('completed', 'paid')) AS payments
  FROM public.wholesale_payments AS payment
  CROSS JOIN params
  WHERE payment.wholesale_order_id IS NOT NULL
  GROUP BY payment.wholesale_order_id
),
wholesale_operations AS (
  SELECT
    'mayoreo'::TEXT AS modality,
    orders.id AS operation_id,
    orders.partner_id,
    COALESCE(NULLIF(partner.business_name, ''), NULLIF(partner.responsible_name, ''), orders.partner_id::TEXT) AS partner_name,
    orders.delivery_date::DATE AS movement_date,
    orders.delivery_date::DATE AS products_recognition_date,
    (COALESCE(
      orders.released_at,
      orders.delivery_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
      orders.order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City'
    ) AT TIME ZONE 'America/Mexico_City')::DATE AS summary_recognition_date,
    (COALESCE(
      orders.released_at,
      orders.delivery_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
      orders.order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City'
    ) AT TIME ZONE 'America/Mexico_City')::DATE AS collections_recognition_date,
    orders.created_at AS registered_at,
    orders.order_status::TEXT AS operation_status,
    'wholesale_order'::TEXT AS operation_type,
    products.units,
    products.amount AS recorded_amount,
    products.amount AS products_recognized_amount,
    products.amount AS summary_recognized_amount,
    COALESCE(payment.paid_in_period, 0) AS paid_in_period,
    COALESCE(payment.paid_in_collections_period, 0) AS paid_in_collections_period,
    COALESCE(payment.paid_all_time, 0) AS paid_all_time,
    GREATEST(products.amount - COALESCE(payment.paid_all_time, 0), 0) AS pending_all_time,
    products.products,
    payment.payments,
    orders.order_status = 'delivered'
      AND orders.delivery_date >= params.start_date
      AND orders.delivery_date < params.end_date_exclusive AS included_in_products,
    orders.order_status IN ('delivered', 'completed')
      AND (COALESCE(
        orders.released_at,
        orders.delivery_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
        orders.order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City'
      ) AT TIME ZONE 'America/Mexico_City')::DATE >= params.start_date
      AND (COALESCE(
        orders.released_at,
        orders.delivery_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
        orders.order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City'
      ) AT TIME ZONE 'America/Mexico_City')::DATE < params.end_date_exclusive AS included_in_summary,
    orders.order_status IN ('delivered', 'completed')
      AND COALESCE(
        orders.released_at,
        orders.delivery_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
        orders.order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City'
      ) >= params.start_at
      AND COALESCE(
        orders.released_at,
        orders.delivery_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
        orders.order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City'
      ) < params.end_at_exclusive AS included_in_collections_operations,
    'wholesale_orders + wholesale_order_items'::TEXT AS source
  FROM public.wholesale_orders AS orders
  JOIN wholesale_products AS products ON products.operation_id = orders.id AND products.units > 0
  JOIN public.commercial_partners AS partner ON partner.id = orders.partner_id
  LEFT JOIN wholesale_payments AS payment ON payment.operation_id = orders.id
  CROSS JOIN params
  WHERE (
      orders.delivery_date >= params.start_date
      AND orders.delivery_date < params.end_date_exclusive
    ) OR (
      (COALESCE(
        orders.released_at,
        orders.delivery_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
        orders.order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City'
      ) AT TIME ZONE 'America/Mexico_City')::DATE >= params.start_date
      AND (COALESCE(
        orders.released_at,
        orders.delivery_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
        orders.order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City'
      ) AT TIME ZONE 'America/Mexico_City')::DATE < params.end_date_exclusive
    ) OR COALESCE(payment.paid_in_period, 0) <> 0
      OR COALESCE(payment.paid_in_collections_period, 0) <> 0
),
commercial_operations AS (
  SELECT * FROM comodato_operations
  UNION ALL
  SELECT * FROM wholesale_operations
),
piece_operations AS (
  SELECT
    sale.id AS operation_id,
    sale.sale_date,
    sale.status,
    sale.total_amount::NUMERIC AS generated_amount,
    COALESCE(items.units, 0) AS units,
    COALESCE(payment.paid_in_period, 0) AS paid_in_period,
    COALESCE(payment.paid_all_time, 0) AS paid_all_time,
    GREATEST(sale.total_amount - COALESCE(payment.paid_all_time, 0), 0)::NUMERIC AS pending_all_time,
    items.products,
    sale.status = 'confirmed'
      AND sale.sale_date >= params.start_at
      AND sale.sale_date < params.end_at_exclusive AS included_in_summary
  FROM public.seller_piece_sales AS sale
  LEFT JOIN LATERAL (
    SELECT SUM(item.quantity)::NUMERIC AS units,
      JSONB_AGG(TO_JSONB(item) ORDER BY item.id) AS products
    FROM public.seller_piece_sale_items AS item
    WHERE item.sale_id = sale.id
  ) AS items ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      SUM(payment.amount) FILTER (WHERE payment.status = 'completed')::NUMERIC AS paid_all_time,
      SUM(payment.amount) FILTER (
        WHERE payment.status = 'completed'
          AND (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE >= params.start_date
          AND (payment.payment_date AT TIME ZONE 'America/Mexico_City')::DATE < params.end_date_exclusive
      )::NUMERIC AS paid_in_period
    FROM public.seller_piece_payments AS payment
    WHERE payment.sale_id = sale.id
  ) AS payment ON TRUE
  CROSS JOIN params
  WHERE (
      sale.sale_date >= params.start_at
      AND sale.sale_date < params.end_at_exclusive
    ) OR COALESCE(payment.paid_in_period, 0) <> 0
),
payment_duplicate_candidates AS (
  SELECT 'comodato'::TEXT AS modality, payment.movement_id AS operation_id,
    payment.payment_date, payment.amount, COUNT(*) AS occurrences,
    ARRAY_AGG(payment.id ORDER BY payment.id) AS payment_ids
  FROM public.commercial_partner_payments AS payment
  WHERE payment.status IN ('completed', 'paid') AND payment.movement_id IS NOT NULL
  GROUP BY payment.movement_id, payment.payment_date, payment.amount
  HAVING COUNT(*) > 1
  UNION ALL
  SELECT 'mayoreo', payment.wholesale_order_id, payment.payment_date, payment.amount,
    COUNT(*), ARRAY_AGG(payment.id ORDER BY payment.id)
  FROM public.wholesale_payments AS payment
  WHERE payment.status IN ('completed', 'paid') AND payment.wholesale_order_id IS NOT NULL
  GROUP BY payment.wholesale_order_id, payment.payment_date, payment.amount
  HAVING COUNT(*) > 1
),
orphan_payments AS (
  SELECT 'comodato'::TEXT AS modality, payment.id AS payment_id,
    payment.movement_id AS operation_id, payment.payment_date, payment.amount, payment.status
  FROM public.commercial_partner_payments AS payment
  LEFT JOIN public.commercial_partner_movements AS movement ON movement.id = payment.movement_id
  WHERE payment.movement_id IS NOT NULL AND movement.id IS NULL
  UNION ALL
  SELECT 'mayoreo', payment.id, payment.wholesale_order_id,
    payment.payment_date, payment.amount, payment.status
  FROM public.wholesale_payments AS payment
  LEFT JOIN public.wholesale_orders AS orders ON orders.id = payment.wholesale_order_id
  WHERE payment.wholesale_order_id IS NOT NULL AND orders.id IS NULL
),
current_balances AS (
  SELECT partner_id, business_name, comodato_pending, wholesale_pending, b2b_pending_balance
  FROM public.v_b2b_pending_balances
  WHERE COALESCE(b2b_pending_balance, 0) <> 0
),
waste_costs AS (
  SELECT
    event.product_key,
    event.product_id,
    MAX(event.product_name) AS product_name,
    MAX(event.product_variant) AS product_variant,
    MAX(event.product_size) AS product_size,
    SUM(event.quantity)::NUMERIC AS waste_units,
    MAX(event.production_unit_cost)::NUMERIC AS registered_unit_cost,
    SUM(event.production_cost_total)::NUMERIC AS registered_total_cost,
    MAX(event.public_unit_price)::NUMERIC AS public_unit_price,
    SUM(event.public_value_total)::NUMERIC AS theoretical_public_value,
    ARRAY_AGG(DISTINCT event.pricing_source ORDER BY event.pricing_source) AS pricing_sources
  FROM public.v_b2b_waste_events_normalized AS event
  CROSS JOIN params
  WHERE event.event_date >= params.start_date
    AND event.event_date < params.end_date_exclusive
  GROUP BY event.product_key, event.product_id
),
delivery_cost_snapshots AS (
  SELECT
    unit.product_id,
    MIN(unit.unit_cost)::NUMERIC AS minimum_snapshot_cost,
    MAX(unit.unit_cost)::NUMERIC AS maximum_snapshot_cost,
    AVG(unit.unit_cost)::NUMERIC AS average_snapshot_cost,
    COUNT(*) FILTER (WHERE unit.unit_cost IS NOT NULL) AS snapshot_count
  FROM public.commercial_delivery_units AS unit
  WHERE unit.product_id IS NOT NULL
  GROUP BY unit.product_id
),
recipe_costs AS (
  SELECT
    product.id AS product_id,
    COUNT(recipe_item.*) AS ingredient_count,
    COUNT(recipe_item.*) FILTER (
      WHERE COALESCE(
        NULLIF(TO_JSONB(material)->>'unit_cost', '')::NUMERIC,
        NULLIF(TO_JSONB(material)->>'cost_per_unit', '')::NUMERIC,
        NULLIF(TO_JSONB(material)->>'cost', '')::NUMERIC
      ) IS NULL
    ) AS ingredients_without_cost,
    CASE
      WHEN COUNT(recipe_item.*) > 0 AND COUNT(recipe_item.*) FILTER (
        WHERE COALESCE(
          NULLIF(TO_JSONB(material)->>'unit_cost', '')::NUMERIC,
          NULLIF(TO_JSONB(material)->>'cost_per_unit', '')::NUMERIC,
          NULLIF(TO_JSONB(material)->>'cost', '')::NUMERIC
        ) IS NULL
      ) = 0 THEN SUM(
        recipe_item.qty_per_unit * COALESCE(
          NULLIF(TO_JSONB(material)->>'unit_cost', '')::NUMERIC,
          NULLIF(TO_JSONB(material)->>'cost_per_unit', '')::NUMERIC,
          NULLIF(TO_JSONB(material)->>'cost', '')::NUMERIC
        )
      )
    END::NUMERIC AS recipe_unit_cost_candidate,
    JSONB_AGG(JSONB_BUILD_OBJECT(
      'raw_material_id', material.id,
      'name', material.name,
      'unit', material.unit,
      'qty_per_unit', recipe_item.qty_per_unit,
      'available_cost_metadata', TO_JSONB(material) - 'current_stock'
    ) ORDER BY material.name) FILTER (WHERE recipe_item.raw_material_id IS NOT NULL) AS ingredients
  FROM public.products AS product
  LEFT JOIN public.product_recipe_items AS recipe_item ON recipe_item.product_id = product.id
  LEFT JOIN public.raw_materials AS material ON material.id = recipe_item.raw_material_id
  GROUP BY product.id
),
cost_audit AS (
  SELECT
    waste.*,
    product.sku_code,
    product.unit_cost::NUMERIC AS current_product_unit_cost,
    recipe.recipe_unit_cost_candidate,
    CASE
      WHEN recipe.recipe_unit_cost_candidate IS NOT NULL
        THEN recipe.recipe_unit_cost_candidate * waste.waste_units
    END::NUMERIC AS recipe_total_cost_candidate,
    CASE
      WHEN recipe.recipe_unit_cost_candidate IS NOT NULL
        THEN (recipe.recipe_unit_cost_candidate * waste.waste_units) - waste.registered_total_cost
    END::NUMERIC AS difference_from_registered,
    recipe.ingredient_count,
    recipe.ingredients_without_cost,
    recipe.ingredients,
    snapshot.minimum_snapshot_cost,
    snapshot.maximum_snapshot_cost,
    snapshot.average_snapshot_cost,
    snapshot.snapshot_count,
    CASE
      WHEN recipe.recipe_unit_cost_candidate IS NULL THEN 'products.unit_cost only; recipe cost unavailable or incomplete'
      ELSE 'recipe candidate requires manual validation of raw-material cost units'
    END AS cost_confidence
  FROM waste_costs AS waste
  LEFT JOIN public.products AS product ON product.id = waste.product_id
  LEFT JOIN recipe_costs AS recipe ON recipe.product_id = waste.product_id
  LEFT JOIN delivery_cost_snapshots AS snapshot ON snapshot.product_id = waste.product_id
),
report_outputs AS (
  SELECT
    public.get_b2b_product_analytics(params.start_at, params.end_at_exclusive) AS products_report,
    public.get_b2b_monthly_analysis(params.start_date, params.end_date_exclusive) AS monthly_summary,
    public.get_b2b_monthly_collections_report(params.start_date, params.end_date_exclusive) AS collections_report
  FROM params
),
catalog_contracts AS (
  SELECT JSONB_OBJECT_AGG(contract_name, definition) AS definitions
  FROM (
    SELECT FORMAT(
      '%I.%I(%s)',
      namespace.nspname,
      proc.proname,
      pg_get_function_identity_arguments(proc.oid)
    ) AS contract_name,
    pg_get_functiondef(proc.oid) AS definition
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname IN (
        'get_b2b_product_analytics',
        'get_b2b_monthly_analysis',
        'get_b2b_monthly_collections_report'
      )
    UNION ALL
    SELECT FORMAT('%I.%I', namespace.nspname, class.relname), pg_get_viewdef(class.oid, TRUE)
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname IN (
        'v_b2b_dashboard_summary',
        'v_b2b_pending_balances',
        'v_b2b_waste_events_normalized'
      )
  ) AS contract
)
SELECT JSONB_BUILD_OBJECT(
  'period', JSONB_BUILD_OBJECT(
    'start_date', params.start_date,
    'end_date_exclusive', params.end_date_exclusive,
    'timezone', 'America/Mexico_City'
  ),
  'report_outputs', (SELECT TO_JSONB(output) FROM report_outputs AS output),
  'commercial_operation_reconciliation', COALESCE((
    SELECT JSONB_AGG(TO_JSONB(operation) ORDER BY operation.modality, operation.products_recognition_date, operation.operation_id)
    FROM commercial_operations AS operation
    WHERE operation.included_in_products
      OR operation.included_in_summary
      OR operation.included_in_collections_operations
      OR operation.paid_in_period <> 0
      OR operation.paid_in_collections_period <> 0
  ), '[]'::JSONB),
  'piece_sale_reconciliation', COALESCE((
    SELECT JSONB_AGG(TO_JSONB(operation) ORDER BY operation.sale_date, operation.operation_id)
    FROM piece_operations AS operation
    WHERE operation.included_in_summary OR operation.paid_in_period <> 0
  ), '[]'::JSONB),
  'recognition_differences', JSONB_BUILD_OBJECT(
    'only_in_products', COALESCE((SELECT JSONB_AGG(TO_JSONB(operation)) FROM commercial_operations AS operation WHERE included_in_products AND NOT included_in_summary), '[]'::JSONB),
    'only_in_summary', COALESCE((SELECT JSONB_AGG(TO_JSONB(operation)) FROM commercial_operations AS operation WHERE included_in_summary AND NOT included_in_products), '[]'::JSONB),
    'different_recognition_dates', COALESCE((SELECT JSONB_AGG(TO_JSONB(operation)) FROM commercial_operations AS operation WHERE products_recognition_date IS DISTINCT FROM summary_recognition_date), '[]'::JSONB),
    'different_collections_recognition_dates', COALESCE((SELECT JSONB_AGG(TO_JSONB(operation)) FROM commercial_operations AS operation WHERE summary_recognition_date IS DISTINCT FROM collections_recognition_date), '[]'::JSONB),
    'different_comodato_amount_rules', COALESCE((SELECT JSONB_AGG(TO_JSONB(operation)) FROM commercial_operations AS operation WHERE modality = 'comodato' AND products_recognized_amount IS DISTINCT FROM summary_recognized_amount), '[]'::JSONB)
  ),
  'current_accumulated_balances', COALESCE((SELECT JSONB_AGG(TO_JSONB(balance) ORDER BY b2b_pending_balance DESC) FROM current_balances AS balance), '[]'::JSONB),
  'duplicate_payment_candidates', COALESCE((SELECT JSONB_AGG(TO_JSONB(candidate)) FROM payment_duplicate_candidates AS candidate), '[]'::JSONB),
  'orphan_payments', COALESCE((SELECT JSONB_AGG(TO_JSONB(payment)) FROM orphan_payments AS payment), '[]'::JSONB),
  'waste_cost_and_public_price_audit', COALESCE((SELECT JSONB_AGG(TO_JSONB(cost) ORDER BY waste_units DESC, product_name) FROM cost_audit AS cost), '[]'::JSONB),
  'cost_settings', COALESCE((
    SELECT JSONB_AGG(TO_JSONB(setting) ORDER BY setting.key)
    FROM public.app_settings AS setting
    WHERE setting.key LIKE 'cost_per_gram_%'
  ), '[]'::JSONB),
  'deployed_contracts', (SELECT definitions FROM catalog_contracts)
) AS diagnostic
FROM params;

ROLLBACK;
