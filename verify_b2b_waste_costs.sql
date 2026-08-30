-- Read-only verification for B2B estimated spoilage costs.
-- Run only after 20260829_b2b_waste_costs_and_product_mapping.sql.
-- Returns exactly one row containing one JSONB object.

WITH expected_settings(setting_key, expected_value) AS (
  VALUES
    ('cost_per_gram_salada'::TEXT, 0.02627178::NUMERIC),
    ('cost_per_gram_sabores', 0.03319876),
    ('cost_per_gram_caramelo', 0.04723870)
),
actual_settings AS (
  SELECT
    expected.setting_key,
    expected.expected_value,
    settings.value_numeric::NUMERIC AS actual_value,
    settings.value_numeric::NUMERIC IS NOT DISTINCT FROM expected.expected_value AS matches
  FROM expected_settings AS expected
  LEFT JOIN public.app_settings AS settings
    ON settings.key = expected.setting_key
),
expected_products(sku_code, expected_unit_cost) AS (
  VALUES
    ('SLMCH90'::TEXT, 2.9345::NUMERIC),
    ('SLGM180', 5.3989),
    ('SLJF240', 7.1052),
    ('SBMCH90', 3.5579),
    ('SBGM180', 6.6458),
    ('SBJF240', 8.7677),
    ('CAGM180', 10.1030),
    ('CAMCH90', 5.8515)
),
actual_products AS (
  SELECT
    expected.sku_code,
    expected.expected_unit_cost,
    product.id AS product_id,
    product.unit_cost::NUMERIC AS actual_unit_cost,
    product.bag_sku,
    product.packaging_material_code,
    product.unit_cost::NUMERIC IS NOT DISTINCT FROM expected.expected_unit_cost AS matches
  FROM expected_products AS expected
  LEFT JOIN public.products AS product
    ON product.sku_code = expected.sku_code
),
packaging AS (
  SELECT JSONB_BUILD_OBJECT(
    'raw_material', COALESCE((
      SELECT TO_JSONB(material)
      FROM public.raw_materials AS material
      WHERE material.material_code = 'STU-20x30'
      LIMIT 1
    ), 'null'::JSONB),
    'matching_raw_material_rows', (
      SELECT COUNT(*)
      FROM public.raw_materials
      WHERE material_code = 'STU-20x30'
    ),
    'cagm180_bag_sku', (
      SELECT bag_sku FROM public.products WHERE sku_code = 'CAGM180' LIMIT 1
    ),
    'cagm180_packaging_material_code', (
      SELECT packaging_material_code FROM public.products WHERE sku_code = 'CAGM180' LIMIT 1
    ),
    'stu_17x25_rows_untouched_by_target', (
      SELECT COUNT(*) FROM public.raw_materials WHERE material_code = 'STU-17x25'
    )
  ) AS value
),
expected_mapping(source_product_code, target_sku) AS (
  VALUES
    ('MICHI_CLASICO_90'::TEXT, 'SLMCH90'::TEXT),
    ('MICHI_SABORES_90', 'SBMCH90'),
    ('GATO_MAYOR_CLASICO_180', 'SLGM180'),
    ('GATO_MAYOR_SABORES_180', 'SBGM180'),
    ('JEFE_FELINO_CLASICO_240', 'SLJF240'),
    ('JEFE_FELINO_SABORES_240', 'SBJF240'),
    ('CARAMELO_GATO_MAYOR_180', 'CAGM180'),
    ('CARAMELO_MICHI_90', 'CAMCH90')
),
actual_mappings AS (
  SELECT
    mapping.source_catalog,
    expected.source_product_code,
    expected.target_sku,
    mapping.id AS mapping_id,
    mapping.product_id,
    product.sku_code AS actual_sku,
    product.unit_cost,
    mapping.active,
    mapping.valid_from,
    mapping.valid_to,
    product.sku_code IS NOT DISTINCT FROM expected.target_sku AS matches
  FROM expected_mapping AS expected
  CROSS JOIN (VALUES ('comodato'::TEXT), ('mayoreo'::TEXT)) AS catalog(source_catalog)
  LEFT JOIN public.b2b_product_mappings AS mapping
    ON mapping.source_catalog = catalog.source_catalog
   AND mapping.source_product_code = expected.source_product_code
   AND mapping.active
   AND mapping.valid_to IS NULL
  LEFT JOIN public.products AS product
    ON product.id = mapping.product_id
),
active_catalog_without_product_id AS (
  SELECT
    catalog.id,
    catalog.product_code,
    catalog.product_name,
    catalog.product_variant,
    catalog.product_size
  FROM public.wholesale_price_catalog AS catalog
  WHERE catalog.active
    AND NULLIF(TO_JSONB(catalog)->>'product_id', '') IS NULL
),
mapped_without_unit_cost AS (
  SELECT
    mapping.id AS mapping_id,
    mapping.source_catalog,
    mapping.source_product_code,
    mapping.product_id,
    product.sku_code
  FROM public.b2b_product_mappings AS mapping
  JOIN public.products AS product ON product.id = mapping.product_id
  WHERE mapping.active
    AND mapping.valid_to IS NULL
    AND product.unit_cost IS NULL
),
rpc_result AS (
  SELECT public.get_b2b_product_analytics(
    TIMESTAMPTZ '2026-08-01 00:00:00-06',
    TIMESTAMPTZ '2026-09-01 00:00:00-06'
  ) AS report
),
rpc_checks AS (
  SELECT
    report,
    (report->'summary'->>'units_sold')::NUMERIC = 135 AS units_sold_preserved,
    (report->'summary'->>'generated_revenue')::NUMERIC = 4060 AS revenue_preserved,
    (report->'summary'->>'spoilage_units')::NUMERIC = 23 AS spoilage_units_preserved,
    (report->'summary'->>'open_inventory_units')::NUMERIC = 38 AS open_inventory_preserved,
    (report->'data_quality'->'fifo_impossible_groups'->>'count')::INTEGER = 0
      AS fifo_is_consistent,
    (report->'data_quality'->'negative_inventory_groups'->>'count')::INTEGER = 0
      AS inventory_is_nonnegative,
    (report->'summary'->>'estimated_waste_cost')::NUMERIC AS estimated_waste_cost,
    (report->'summary'->>'estimated_waste_cost')::NUMERIC = 80.9792
      AS estimated_waste_cost_matches
  FROM rpc_result
),
camch_product AS (
  SELECT
    product.id,
    product.sku_code,
    product.unit_cost,
    TO_JSONB(product)->>'is_active' AS is_active,
    TO_JSONB(product)->>'active' AS active,
    TO_JSONB(product) AS row_data
  FROM public.products AS product
  WHERE product.sku_code = 'CAMCH90'
),
camch_comodato_history AS (
  SELECT movement.id AS movement_id, item.id AS item_id, movement.movement_type,
    movement.status, movement.movement_date, TO_JSONB(item) AS item
  FROM public.commercial_partner_movements AS movement
  JOIN public.commercial_partner_movement_items AS item
    ON item.movement_id = movement.id
  WHERE NULLIF(TO_JSONB(item)->>'product_id', '') IN (SELECT id::TEXT FROM camch_product)
     OR UPPER(COALESCE(TO_JSONB(item)->>'product_code', ''))
        IN ('CAMCH90', 'CARAMELO_MICHI_90')
     OR (
       public.normalize_b2b_product_identity_text(item.product_name) = 'caramelo michi'
       AND public.normalize_b2b_product_identity_text(item.product_variant) = 'caramelo'
       AND public.normalize_b2b_product_identity_text(item.product_size) = '90 gr'
     )
),
camch_wholesale_history AS (
  SELECT orders.id AS order_id, item.id AS item_id, orders.order_status,
    orders.order_date, orders.delivery_date, TO_JSONB(item) AS item
  FROM public.wholesale_orders AS orders
  JOIN public.wholesale_order_items AS item
    ON item.wholesale_order_id = orders.id
  WHERE NULLIF(TO_JSONB(item)->>'product_id', '') IN (SELECT id::TEXT FROM camch_product)
     OR UPPER(COALESCE(item.product_code, '')) IN ('CAMCH90', 'CARAMELO_MICHI_90')
     OR (
       public.normalize_b2b_product_identity_text(item.product_name) = 'michi'
       AND public.normalize_b2b_product_identity_text(item.product_variant) = 'caramelo'
     )
),
camch_finished_inventory AS (
  SELECT
    lot.id,
    lot.product_id,
    lot.units_produced,
    lot.units_remaining,
    lot.lot_number,
    lot.created_at
  FROM public.product_lots AS lot
  WHERE lot.product_id IN (SELECT id FROM camch_product)
),
camch_b2b_spoilage AS (
  SELECT *
  FROM camch_comodato_history
  WHERE COALESCE((item->>'quantity_spoiled')::NUMERIC, 0) > 0
),
camch_pending_orders AS (
  SELECT *
  FROM camch_wholesale_history
  WHERE order_status::TEXT NOT IN ('delivered', 'completed', 'cancelled')
),
camch_pos_usage AS (
  SELECT
    sale.id AS sale_id,
    item.id AS sale_item_id,
    sale.created_at,
    item.quantity,
    COALESCE(
      NULLIF(TO_JSONB(item)->>'subtotal', '')::NUMERIC,
      NULLIF(TO_JSONB(item)->>'price', '')::NUMERIC * item.quantity
    ) AS subtotal
  FROM public.sale_items AS item
  JOIN public.sales AS sale ON sale.id = item.sale_id
  WHERE item.product_id IN (SELECT id FROM camch_product)
),
camch_general_waste AS (
  SELECT TO_JSONB(event) AS row_data
  FROM public.waste_events AS event
  WHERE TO_JSONB(event)::TEXT ILIKE '%CAMCH90%'
     OR (
       TO_JSONB(event)::TEXT ILIKE '%MICHI%'
       AND TO_JSONB(event)::TEXT ILIKE '%CARAMELO%'
     )
),
camch_diagnostic AS (
  SELECT JSONB_BUILD_OBJECT(
    'catalog_product', COALESCE((SELECT row_data FROM camch_product LIMIT 1), 'null'::JSONB),
    'unit_cost', (SELECT unit_cost FROM camch_product LIMIT 1),
    'unit_cost_matches_expected', COALESCE(
      (SELECT unit_cost = 5.8515 FROM camch_product LIMIT 1),
      false
    ),
    'b2b_historical_rows',
      (SELECT COUNT(*) FROM camch_comodato_history) + (SELECT COUNT(*) FROM camch_wholesale_history),
    'comodato_history', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM camch_comodato_history AS x), '[]'::JSONB),
    'wholesale_history', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM camch_wholesale_history AS x), '[]'::JSONB),
    'finished_inventory_units_remaining', COALESCE((SELECT SUM(units_remaining) FROM camch_finished_inventory), 0),
    'finished_inventory_lots', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM camch_finished_inventory AS x), '[]'::JSONB),
    'b2b_spoilage_rows', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM camch_b2b_spoilage AS x), '[]'::JSONB),
    'general_waste_rows_with_camch_identity', COALESCE((SELECT JSONB_AGG(row_data) FROM camch_general_waste), '[]'::JSONB),
    'pending_wholesale_orders', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM camch_pending_orders AS x), '[]'::JSONB),
    'pos_sale_items', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM camch_pos_usage AS x), '[]'::JSONB)
  ) AS value
)
SELECT JSONB_BUILD_OBJECT(
  'all_checks_passed',
    (SELECT BOOL_AND(matches) AND COUNT(*) = 3 FROM actual_settings)
    AND (SELECT BOOL_AND(matches) AND COUNT(product_id) = 8 FROM actual_products)
    AND (SELECT
      (value->>'matching_raw_material_rows')::INTEGER = 1
      AND value->>'cagm180_bag_sku' = 'STU-20x30'
      AND value->>'cagm180_packaging_material_code' = 'STU-20x30'
      AND value->'raw_material'->>'name' = 'Bolsa stand-up 20 x 30'
      AND value->'raw_material'->>'unit' = 'pza'
      AND (value->'raw_material'->>'current_stock')::NUMERIC = 70
      FROM packaging)
    AND (SELECT BOOL_AND(matches) AND COUNT(mapping_id) = 16 FROM actual_mappings)
    AND (SELECT COUNT(*) = 0 FROM mapped_without_unit_cost)
    AND (SELECT
      units_sold_preserved
      AND revenue_preserved
      AND spoilage_units_preserved
      AND open_inventory_preserved
      AND fifo_is_consistent
      AND inventory_is_nonnegative
      AND estimated_waste_cost IS NOT NULL
      AND estimated_waste_cost_matches
      FROM rpc_checks),
  'app_settings', COALESCE((SELECT JSONB_AGG(TO_JSONB(x) ORDER BY setting_key) FROM actual_settings AS x), '[]'::JSONB),
  'product_unit_costs', COALESCE((SELECT JSONB_AGG(TO_JSONB(x) ORDER BY sku_code) FROM actual_products AS x), '[]'::JSONB),
  'packaging', (SELECT value FROM packaging),
  'b2b_mappings', COALESCE((SELECT JSONB_AGG(TO_JSONB(x) ORDER BY source_catalog, source_product_code) FROM actual_mappings AS x), '[]'::JSONB),
  'active_wholesale_catalog_without_product_id', JSONB_BUILD_OBJECT(
    'count', (SELECT COUNT(*) FROM active_catalog_without_product_id),
    'rows', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM active_catalog_without_product_id AS x), '[]'::JSONB)
  ),
  'mapped_products_without_unit_cost', JSONB_BUILD_OBJECT(
    'count', (SELECT COUNT(*) FROM mapped_without_unit_cost),
    'rows', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM mapped_without_unit_cost AS x), '[]'::JSONB)
  ),
  'b2b_report', JSONB_BUILD_OBJECT(
    'estimated_waste_cost', (SELECT estimated_waste_cost FROM rpc_checks),
    'preservation_checks', (SELECT TO_JSONB(x) - 'report' - 'estimated_waste_cost' FROM rpc_checks AS x),
    'summary', (SELECT report->'summary' FROM rpc_checks),
    'fifo_quality', (SELECT report->'data_quality' FROM rpc_checks)
  ),
  'CAMCH90', (SELECT value FROM camch_diagnostic)
) AS b2b_waste_cost_verification;
