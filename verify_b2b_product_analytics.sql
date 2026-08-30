-- Read-only verification for the B2B product analytics RPC.
-- Run only after 20260828_b2b_product_analytics.sql has been applied.
-- Returns exactly one row containing one JSONB object.

WITH rpc_result AS (
  SELECT public.get_b2b_product_analytics(
    TIMESTAMPTZ '2026-08-01 00:00:00-06',
    TIMESTAMPTZ '2026-09-01 00:00:00-06'
  ) AS report
),
summary AS (
  SELECT report->'summary' AS value
  FROM rpc_result
),
products AS (
  SELECT product
  FROM rpc_result
  CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(report->'products') AS elements(product)
),
spoilage_partners AS (
  SELECT partner
  FROM rpc_result
  CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(report->'spoilage_by_partner') AS elements(partner)
),
michi_sabores AS (
  SELECT product
  FROM products
  WHERE public.normalize_b2b_product_identity_text(product->>'product_name') = 'michi'
    AND public.normalize_b2b_product_identity_text(product->>'product_variant') = 'sabores'
),
michi_clasico AS (
  SELECT product
  FROM products
  WHERE public.normalize_b2b_product_identity_text(product->>'product_name') = 'michi'
    AND public.normalize_b2b_product_identity_text(product->>'product_variant') = 'clasico'
),
marea_terraza AS (
  SELECT partner
  FROM spoilage_partners
  WHERE public.normalize_b2b_product_identity_text(partner->>'partner_name') = 'marea terraza'
),
quality AS (
  SELECT report->'data_quality' AS value
  FROM rpc_result
),
unmapped_cost_records AS (
  SELECT 'unmapped_products'::TEXT AS mapping_status, row_data
  FROM quality
  CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(value->'unmapped_products'->'rows') AS elements(row_data)

  UNION ALL

  SELECT 'ambiguous_products', row_data
  FROM quality
  CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(value->'ambiguous_products'->'rows') AS elements(row_data)

  UNION ALL

  SELECT 'rows_without_unit_cost', row_data
  FROM quality
  CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(value->'rows_without_unit_cost'->'rows') AS elements(row_data)
),
checks AS (
  SELECT
    (summary.value->>'comodato_units')::NUMERIC = 95 AS comodato_units_match,
    (summary.value->>'comodato_revenue')::NUMERIC = 3160 AS comodato_revenue_match,
    (summary.value->>'wholesale_units')::NUMERIC = 40 AS wholesale_units_match,
    (summary.value->>'wholesale_revenue')::NUMERIC = 900 AS wholesale_revenue_match,
    (summary.value->>'units_sold')::NUMERIC = 135 AS total_units_match,
    (summary.value->>'generated_revenue')::NUMERIC = 4060 AS total_revenue_match,
    (summary.value->>'spoilage_units')::NUMERIC = 23 AS spoilage_units_match,
    (summary.value->>'open_inventory_units')::NUMERIC = 38 AS open_inventory_units_match,
    (quality.value->'fifo_impossible_groups'->>'count')::INTEGER = 0 AS fifo_impossible_groups_match,
    (quality.value->'negative_inventory_groups'->>'count')::INTEGER = 0 AS negative_inventory_groups_match,
    (SELECT COUNT(*) = 1
       AND (MAX(product->>'units_sold'))::NUMERIC = 79
       AND (MAX(product->>'generated_revenue'))::NUMERIC = 2230
     FROM michi_sabores) AS michi_sabores_match,
    (SELECT COUNT(*) = 1
       AND (MAX(product->>'units_sold'))::NUMERIC = 45
       AND (MAX(product->>'generated_revenue'))::NUMERIC = 1150
     FROM michi_clasico) AS michi_clasico_match,
    (SELECT COUNT(*) = 1
       AND (MAX(partner->>'spoiled_units'))::NUMERIC = 9
       AND (MAX(partner->>'spoilage_rate'))::NUMERIC = 0.6
     FROM marea_terraza) AS marea_terraza_match
  FROM summary
  CROSS JOIN quality
)
SELECT JSONB_BUILD_OBJECT(
  'all_checks_passed',
    comodato_units_match
    AND comodato_revenue_match
    AND wholesale_units_match
    AND wholesale_revenue_match
    AND total_units_match
    AND total_revenue_match
    AND spoilage_units_match
    AND open_inventory_units_match
    AND fifo_impossible_groups_match
    AND negative_inventory_groups_match
    AND michi_sabores_match
    AND michi_clasico_match
    AND marea_terraza_match,
  'period', JSONB_BUILD_OBJECT(
    'start_at', '2026-08-01T00:00:00-06:00',
    'end_at_exclusive', '2026-09-01T00:00:00-06:00',
    'timezone', 'America/Mexico_City'
  ),
  'checks', TO_JSONB(checks),
  'actual_summary', (SELECT value FROM summary),
  'actual_michi_sabores', COALESCE((SELECT JSONB_AGG(product) FROM michi_sabores), '[]'::JSONB),
  'actual_michi_clasico', COALESCE((SELECT JSONB_AGG(product) FROM michi_clasico), '[]'::JSONB),
  'actual_marea_terraza', COALESCE((SELECT JSONB_AGG(partner) FROM marea_terraza), '[]'::JSONB),
  'cost_mapping_issues', JSONB_BUILD_OBJECT(
    'count', (SELECT COUNT(*) FROM unmapped_cost_records),
    'rows', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT('mapping_status', mapping_status) || row_data
        ORDER BY mapping_status, row_data->>'source_type', row_data->>'source_id'
      )
      FROM unmapped_cost_records
    ), '[]'::JSONB)
  )
) AS b2b_product_analytics_verification
FROM checks;
