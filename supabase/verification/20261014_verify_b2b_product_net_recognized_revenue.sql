-- CAT CORN | Verificacion read-only de la RPC Productos B2B revisada.
-- Ejecutar despues de aplicar la migracion revisada.
BEGIN;

SET TRANSACTION READ ONLY;



WITH function_contract AS MATERIALIZED (

  SELECT

    proc.oid,

    proc.prosecdef,

    proc.provolatile,

    proc.proconfig,

    LOWER(pg_get_functiondef(proc.oid)) AS definition

  FROM pg_proc AS proc

  JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace

  WHERE namespace.nspname = 'public'

    AND proc.proname = 'get_b2b_product_analytics'

    AND pg_get_function_identity_arguments(proc.oid) =

      'p_start_date timestamp with time zone, p_end_date_exclusive timestamp with time zone'

),

bounds AS (

  SELECT

    DATE '2026-10-01' AS start_date,

    DATE '2026-11-01' AS end_date_exclusive,

    TIMESTAMPTZ '2026-10-01 00:00:00-06' AS start_at,

    TIMESTAMPTZ '2026-11-01 00:00:00-06' AS end_at_exclusive

),

original_item_adjustments AS MATERIALIZED (

  SELECT

    original.id AS original_item_id,

    COALESCE(SUM(adjustment.amount_adjusted) FILTER (

      WHERE LOWER(BTRIM(adjustment_movement.movement_type::TEXT)) = 'adjustment'

        AND LOWER(BTRIM(adjustment_movement.status::TEXT)) = 'completed'

    ), 0)::NUMERIC AS approved_adjustment_amount

  FROM public.commercial_partner_movement_items AS original

  LEFT JOIN public.commercial_partner_movement_items AS adjustment

    ON adjustment.adjusts_movement_item_id = original.id

  LEFT JOIN public.commercial_partner_movements AS adjustment_movement

    ON adjustment_movement.id = adjustment.movement_id

  GROUP BY original.id

),

expected_rows AS MATERIALIZED (

  SELECT

    'comodato'::TEXT AS source_type,

    item.id AS source_item_id,

    item.quantity_sold::NUMERIC AS units,

    COALESCE(item.amount_due, 0)::NUMERIC AS gross_amount,

    adjustment.approved_adjustment_amount,

    GREATEST(

      COALESCE(item.amount_due, 0) - adjustment.approved_adjustment_amount,

      0

    )::NUMERIC AS net_amount

  FROM public.commercial_partner_movements AS movement

  JOIN public.commercial_partner_movement_items AS item

    ON item.movement_id = movement.id

  JOIN original_item_adjustments AS adjustment

    ON adjustment.original_item_id = item.id

  CROSS JOIN bounds

  WHERE COALESCE(item.quantity_sold, 0) > 0

    AND movement.movement_date >= bounds.start_date

    AND movement.movement_date < bounds.end_date_exclusive

    AND LOWER(BTRIM(movement.status::TEXT)) = 'completed'

    AND public.normalize_b2b_product_identity_text(movement.movement_type::TEXT)

      IN ('settlement', 'liquidacion', 'liquidation')



  UNION ALL



  SELECT

    'mayoreo',

    item.id,

    item.quantity::NUMERIC,

    COALESCE(item.subtotal, item.quantity * item.unit_price, 0)::NUMERIC,

    0::NUMERIC,

    COALESCE(item.subtotal, item.quantity * item.unit_price, 0)::NUMERIC

  FROM public.wholesale_orders AS orders

  JOIN public.wholesale_order_items AS item

    ON item.wholesale_order_id = orders.id

  CROSS JOIN bounds

  WHERE COALESCE(item.quantity, 0) > 0

    AND orders.delivery_date >= bounds.start_date

    AND orders.delivery_date < bounds.end_date_exclusive

    AND LOWER(BTRIM(orders.order_status::TEXT)) = 'delivered'

),

over_adjusted_items AS (

  SELECT source_item_id, units, gross_amount, approved_adjustment_amount

  FROM expected_rows

  WHERE source_type = 'comodato'

    AND approved_adjustment_amount > gross_amount

),

expected_totals AS (

  SELECT

    COALESCE(SUM(units), 0)::NUMERIC AS units,

    COALESCE(SUM(gross_amount), 0)::NUMERIC AS gross_amount,

    COALESCE(SUM(approved_adjustment_amount), 0)::NUMERIC AS approved_adjustments,

    COALESCE(SUM(net_amount), 0)::NUMERIC AS net_amount,

    COALESCE(SUM(net_amount) FILTER (WHERE source_type = 'comodato'), 0)::NUMERIC AS comodato_net,

    COALESCE(SUM(net_amount) FILTER (WHERE source_type = 'mayoreo'), 0)::NUMERIC AS wholesale_net

  FROM expected_rows

),

rpc_output AS MATERIALIZED (

  SELECT public.get_b2b_product_analytics(

    bounds.start_at,

    bounds.end_at_exclusive

  )::JSONB AS result

  FROM bounds

),

empty_period_output AS MATERIALIZED (

  SELECT public.get_b2b_product_analytics(

    TIMESTAMPTZ '1900-01-01 00:00:00-06',

    TIMESTAMPTZ '1900-02-01 00:00:00-06'

  )::JSONB AS result

),

rpc_totals AS (

  SELECT

    NULLIF(result->'summary'->>'units_sold', '')::NUMERIC AS units,

    NULLIF(result->'summary'->>'gross_recognized_revenue', '')::NUMERIC AS gross_amount,

    NULLIF(result->'summary'->>'approved_adjustments', '')::NUMERIC AS approved_adjustments,

    NULLIF(result->'summary'->>'generated_revenue', '')::NUMERIC AS net_amount,

    NULLIF(result->'summary'->>'comodato_revenue', '')::NUMERIC AS comodato_net,

    NULLIF(result->'summary'->>'wholesale_revenue', '')::NUMERIC AS wholesale_net

  FROM rpc_output

),

rpc_product_totals AS (

  SELECT

    COALESCE(SUM(NULLIF(product->>'units_sold', '')::NUMERIC), 0) AS units,

    COALESCE(SUM(NULLIF(product->>'gross_recognized_revenue', '')::NUMERIC), 0) AS gross_amount,

    COALESCE(SUM(NULLIF(product->>'approved_adjustments', '')::NUMERIC), 0) AS approved_adjustments,

    COALESCE(SUM(NULLIF(product->>'generated_revenue', '')::NUMERIC), 0) AS net_amount

  FROM rpc_output

  CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(result->'products') AS product

),

known_movement_expectations AS (

  SELECT *

  FROM (VALUES

    ('3e05c745-45d1-4292-9a71-8d3b099c6bb4'::UUID, 250::NUMERIC, 170::NUMERIC, 80::NUMERIC),

    ('3eda6964-a8b8-4238-a228-9772359dc9d3'::UUID, 350::NUMERIC, 350::NUMERIC, 0::NUMERIC),

    ('a9181e9d-0d7a-4e55-822e-fcef90bf00ac'::UUID, 180::NUMERIC, 60::NUMERIC, 120::NUMERIC)

  ) AS expected(movement_id, expected_gross, expected_adjustments, expected_net)

),

known_movement_actuals AS (

  SELECT

    expected.*,

    COALESCE(SUM(COALESCE(original.amount_due, 0)), 0)::NUMERIC AS actual_gross,

    COALESCE(SUM(adjustment.approved_adjustment_amount), 0)::NUMERIC AS actual_adjustments,

    COALESCE(SUM(GREATEST(

      COALESCE(original.amount_due, 0) - adjustment.approved_adjustment_amount,

      0

    )), 0)::NUMERIC AS actual_net

  FROM known_movement_expectations AS expected

  LEFT JOIN public.commercial_partner_movement_items AS original

    ON original.movement_id = expected.movement_id

   AND COALESCE(original.quantity_sold, 0) > 0

  LEFT JOIN original_item_adjustments AS adjustment

    ON adjustment.original_item_id = original.id

  GROUP BY expected.movement_id, expected.expected_gross,

    expected.expected_adjustments, expected.expected_net

),

synthetic_formula_cases AS (

  SELECT *

  FROM (VALUES

    ('without_adjustment'::TEXT, 100::NUMERIC, 0::NUMERIC, 100::NUMERIC),

    ('partial_adjustment', 100, 40, 60),

    ('total_adjustment', 100, 100, 0)

  ) AS test_case(name, gross_amount, approved_adjustments, expected_net)

),

related_report_contracts AS (

  SELECT

    proc.proname,

    LOWER(pg_get_functiondef(proc.oid)) AS definition

  FROM pg_proc AS proc

  JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace

  WHERE namespace.nspname = 'public'

    AND proc.proname IN (

      'get_b2b_monthly_analysis',

      'get_b2b_monthly_collections_report'

    )

),

checks AS (

  SELECT

    (SELECT COUNT(*) FROM function_contract) = 1 AS rpc_exists_once,

    COALESCE((SELECT NOT prosecdef AND provolatile = 's' FROM function_contract), FALSE)

      AS remains_stable_security_invoker,

    COALESCE((SELECT ARRAY_TO_STRING(proconfig, ',') LIKE '%search_path=public%' FROM function_contract), FALSE)

      AS preserves_search_path,

    COALESCE((SELECT

      POSITION('adjustment_item.adjusts_movement_item_id::text = mf.source_item_id::text' IN definition) > 0

      AND POSITION('adjustment_item.amount_adjusted' IN definition) > 0

      AND POSITION('adjustment_movement.movement_type::text)) = ''adjustment''' IN definition) > 0

      AND POSITION('adjustment_movement.status::text)) = ''completed''' IN definition) > 0

      FROM function_contract), FALSE) AS uses_only_completed_item_level_adjustments,

    COALESCE((SELECT

      POSITION('greatest(' IN definition) > 0

      AND POSITION('economics.gross_amount - economics.approved_adjustment_amount' IN definition) > 0

      FROM function_contract), FALSE) AS net_amount_cannot_be_negative,

    COALESCE((SELECT

      POSITION('coalesce(mf.recorded_amount, 0)::numeric as gross_amount' IN definition) > 0

      AND POSITION('when mf.source_type = ''comodato'' and mf.recorded_amount = 0' IN definition) = 0

      FROM function_contract), FALSE) AS zero_amount_due_does_not_generate_fictitious_revenue,

    COALESCE((SELECT

      POSITION('quantity_sold as units' IN definition) > 0

      AND POSITION('quantity_sold -' IN definition) = 0

      FROM function_contract), FALSE) AS monetary_adjustments_do_not_reduce_units,

    COALESCE((SELECT

      POSITION('commercial_partner_payments' IN definition) = 0

      AND POSITION('wholesale_payments' IN definition) = 0

      AND POSITION('seller_piece_sales' IN definition) = 0

      FROM function_contract), FALSE) AS recognition_is_independent_of_payments_and_piece_sales,

    COALESCE((SELECT

      POSITION('mf.operation_status = ''completed''' IN definition) > 0

      AND POSITION('mf.operation_status = ''delivered''' IN definition) > 0

      FROM function_contract), FALSE) AS completed_status_filters_are_preserved,

    COALESCE((SELECT

      POSITION('insert into' IN definition) = 0

      AND POSITION('update ' IN definition) = 0

      AND POSITION('delete from' IN definition) = 0

      FROM function_contract), FALSE) AS rpc_is_read_only,

    (SELECT ROW(

        expected.units,

        expected.gross_amount,

        expected.approved_adjustments,

        expected.net_amount,

        expected.comodato_net,

        expected.wholesale_net

      ) IS NOT DISTINCT FROM ROW(

        actual.units,

        actual.gross_amount,

        actual.approved_adjustments,

        actual.net_amount,

        actual.comodato_net,

        actual.wholesale_net

      )

      FROM expected_totals AS expected

      CROSS JOIN rpc_totals AS actual) AS rpc_summary_matches_independent_reconciliation,

    COALESCE((SELECT gross_amount = net_amount + approved_adjustments FROM rpc_totals), FALSE)

      AS gross_equals_net_plus_adjustments,

    NOT EXISTS (SELECT 1 FROM over_adjusted_items) AS no_adjustments_exceed_original_amount,

    (SELECT ROW(summary.units, summary.gross_amount, summary.approved_adjustments, summary.net_amount)

        IS NOT DISTINCT FROM

      ROW(products.units, products.gross_amount, products.approved_adjustments, products.net_amount)

      FROM rpc_totals AS summary

      CROSS JOIN rpc_product_totals AS products) AS product_rows_sum_to_summary,

    NOT EXISTS (

      SELECT 1

      FROM known_movement_actuals

      WHERE actual_gross IS DISTINCT FROM expected_gross

        OR actual_adjustments IS DISTINCT FROM expected_adjustments

        OR actual_net IS DISTINCT FROM expected_net

    ) AS confirmed_adjusted_movements_reconcile,

    NOT EXISTS (

      SELECT 1

      FROM synthetic_formula_cases

      WHERE GREATEST(gross_amount - approved_adjustments, 0) IS DISTINCT FROM expected_net

    ) AS formula_covers_unadjusted_partial_and_total_adjustments,

    COALESCE((SELECT

      NULLIF(result->'summary'->>'units_sold', '')::NUMERIC = 0

      AND NULLIF(result->'summary'->>'gross_recognized_revenue', '')::NUMERIC = 0

      AND NULLIF(result->'summary'->>'approved_adjustments', '')::NUMERIC = 0

      AND NULLIF(result->'summary'->>'generated_revenue', '')::NUMERIC = 0

      AND JSONB_ARRAY_LENGTH(result->'products') = 0

      FROM empty_period_output), FALSE) AS empty_period_returns_zero_sales,

    (SELECT COUNT(*) = 2

      AND BOOL_AND(POSITION('amount_adjusted' IN definition) > 0)

      FROM related_report_contracts) AS summary_and_collections_remain_adjustment_aware

)

SELECT JSONB_BUILD_OBJECT(

  'all_checks_passed',

    rpc_exists_once

    AND remains_stable_security_invoker

    AND preserves_search_path

    AND uses_only_completed_item_level_adjustments

    AND net_amount_cannot_be_negative

    AND zero_amount_due_does_not_generate_fictitious_revenue

    AND monetary_adjustments_do_not_reduce_units

    AND recognition_is_independent_of_payments_and_piece_sales

    AND completed_status_filters_are_preserved

    AND rpc_is_read_only

    AND rpc_summary_matches_independent_reconciliation

    AND gross_equals_net_plus_adjustments

    AND no_adjustments_exceed_original_amount

    AND product_rows_sum_to_summary

    AND confirmed_adjusted_movements_reconcile

    AND formula_covers_unadjusted_partial_and_total_adjustments

    AND empty_period_returns_zero_sales

    AND summary_and_collections_remain_adjustment_aware,

  'checks', TO_JSONB(checks),

  'period', JSONB_BUILD_OBJECT(

    'start_date', (SELECT start_date FROM bounds),

    'end_date_exclusive', (SELECT end_date_exclusive FROM bounds)

  ),

  'independent_expected_totals', (SELECT TO_JSONB(row) FROM expected_totals AS row),

  'rpc_summary_totals', (SELECT TO_JSONB(row) FROM rpc_totals AS row),

  'rpc_product_totals', (SELECT TO_JSONB(row) FROM rpc_product_totals AS row),

  'confirmed_movement_reconciliation', COALESCE((

    SELECT JSONB_AGG(TO_JSONB(row) ORDER BY movement_id)

    FROM known_movement_actuals AS row

  ), '[]'::JSONB),

  'over_adjusted_items', COALESCE((

    SELECT JSONB_AGG(TO_JSONB(row))

    FROM over_adjusted_items AS row

  ), '[]'::JSONB)

) AS verification

FROM checks;



ROLLBACK;