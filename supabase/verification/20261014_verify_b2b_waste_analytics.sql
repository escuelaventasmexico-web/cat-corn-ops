BEGIN;
SET TRANSACTION READ ONLY;

WITH rpc AS MATERIALIZED (
  SELECT proc.oid, proc.prosecdef, proc.provolatile, proc.proconfig,
    LOWER(pg_get_functiondef(proc.oid)) AS definition,
    NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) AS acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ) AS public_execute_revoked,
    NOT has_function_privilege('anon', proc.oid, 'EXECUTE') AS anon_execute_revoked,
    has_function_privilege('authenticated', proc.oid, 'EXECUTE') AS authenticated_can_execute
  FROM pg_proc AS proc
  JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'get_b2b_waste_analytics_admin'
    AND pg_get_function_identity_arguments(proc.oid) = 'p_period_start date, p_period_end_exclusive date'
),
waste_view_contract AS MATERIALIZED (
  SELECT class.reloptions, LOWER(pg_get_viewdef(class.oid, TRUE)) AS definition,
    NOT has_table_privilege('anon', class.oid, 'SELECT') AS anon_select_revoked,
    NOT has_table_privilege('authenticated', class.oid, 'SELECT') AS authenticated_select_revoked
  FROM pg_class AS class
  JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
  WHERE namespace.nspname = 'public'
    AND class.relname = 'v_b2b_waste_events_normalized'
    AND class.relkind = 'v'
),
delivery_view_contract AS MATERIALIZED (
  SELECT class.reloptions, LOWER(pg_get_viewdef(class.oid, TRUE)) AS definition,
    NOT has_table_privilege('anon', class.oid, 'SELECT') AS anon_select_revoked,
    NOT has_table_privilege('authenticated', class.oid, 'SELECT') AS authenticated_select_revoked
  FROM pg_class AS class
  JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
  WHERE namespace.nspname = 'public'
    AND class.relname = 'v_b2b_delivery_product_keys_normalized'
    AND class.relkind = 'v'
),
month_bounds AS (
  SELECT
    DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::DATE AS start_date,
    (DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City') + INTERVAL '1 month')::DATE AS end_date_exclusive
),
current_events AS MATERIALIZED (
  SELECT event.*
  FROM public.v_b2b_waste_events_normalized AS event
  CROSS JOIN month_bounds AS bounds
  WHERE event.event_date >= bounds.start_date AND event.event_date < bounds.end_date_exclusive
),
movement_item_counts AS MATERIALIZED (
  SELECT item.movement_id,
    COUNT(*) FILTER (WHERE COALESCE(item.quantity_spoiled, 0) > 0) AS spoilage_item_count,
    COUNT(*) FILTER (WHERE COALESCE(item.quantity_withdrawn, 0) > 0) AS withdrawal_item_count,
    (ARRAY_AGG(item.id ORDER BY item.id) FILTER (WHERE COALESCE(item.quantity_spoiled, 0) > 0))[1] AS spoilage_item_id,
    (ARRAY_AGG(item.id ORDER BY item.id) FILTER (WHERE COALESCE(item.quantity_withdrawn, 0) > 0))[1] AS withdrawal_item_id
  FROM public.commercial_partner_movement_items AS item
  GROUP BY item.movement_id
),
tagged_units AS MATERIALIZED (
  SELECT unit.id AS delivery_unit_id, 'spoilage'::TEXT AS link_type,
    unit.spoilage_movement_id AS movement_id, movement.status AS movement_status,
    movement.movement_date::DATE AS canonical_event_date,
    (unit.spoiled_at AT TIME ZONE 'America/Mexico_City')::DATE AS physical_event_date,
    counts.spoilage_item_count AS matching_item_count, item.id AS movement_item_id,
    item.quantity_spoiled::NUMERIC AS registered_quantity,
    unit.partner_id IS DISTINCT FROM item.partner_id
      OR unit.product_id IS DISTINCT FROM item.product_id
      OR public.normalize_b2b_product_identity_text(unit.product_name) IS DISTINCT FROM public.normalize_b2b_product_identity_text(item.product_name)
      OR public.normalize_b2b_product_identity_text(unit.product_variant) IS DISTINCT FROM public.normalize_b2b_product_identity_text(item.product_variant)
      OR public.normalize_b2b_product_identity_text(unit.product_size) IS DISTINCT FROM public.normalize_b2b_product_identity_text(item.product_size) AS identity_mismatch
  FROM public.commercial_delivery_units AS unit
  JOIN public.commercial_partner_movements AS movement ON movement.id = unit.spoilage_movement_id
  LEFT JOIN movement_item_counts AS counts ON counts.movement_id = movement.id
  LEFT JOIN public.commercial_partner_movement_items AS item ON item.id = counts.spoilage_item_id
  WHERE unit.status = 'spoiled' AND unit.spoilage_movement_id IS NOT NULL AND unit.spoiled_at IS NOT NULL

  UNION ALL

  SELECT unit.id, 'withdrawal'::TEXT, unit.return_movement_id, movement.status,
    movement.movement_date::DATE,
    (unit.returned_good_at AT TIME ZONE 'America/Mexico_City')::DATE,
    counts.withdrawal_item_count, item.id, item.quantity_withdrawn::NUMERIC,
    unit.partner_id IS DISTINCT FROM item.partner_id
      OR unit.product_id IS DISTINCT FROM item.product_id
      OR public.normalize_b2b_product_identity_text(unit.product_name) IS DISTINCT FROM public.normalize_b2b_product_identity_text(item.product_name)
      OR public.normalize_b2b_product_identity_text(unit.product_variant) IS DISTINCT FROM public.normalize_b2b_product_identity_text(item.product_variant)
      OR public.normalize_b2b_product_identity_text(unit.product_size) IS DISTINCT FROM public.normalize_b2b_product_identity_text(item.product_size)
  FROM public.commercial_delivery_units AS unit
  JOIN public.commercial_partner_movements AS movement ON movement.id = unit.return_movement_id
  LEFT JOIN movement_item_counts AS counts ON counts.movement_id = movement.id
  LEFT JOIN public.commercial_partner_movement_items AS item ON item.id = counts.withdrawal_item_id
  WHERE unit.status = 'returned_good' AND unit.return_movement_id IS NOT NULL AND unit.returned_good_at IS NOT NULL
),
tagged_unit_totals AS (
  SELECT link_type, movement_id, MAX(movement_item_id) AS movement_item_id,
    MAX(registered_quantity) AS registered_quantity, COUNT(*)::NUMERIC AS tagged_quantity
  FROM tagged_units
  WHERE matching_item_count = 1
  GROUP BY link_type, movement_id
),
quantity_overages AS (
  SELECT * FROM tagged_unit_totals WHERE tagged_quantity > COALESCE(registered_quantity, 0)
),
item_count_mismatches AS (
  SELECT delivery_unit_id, link_type, movement_id, matching_item_count
  FROM tagged_units WHERE COALESCE(matching_item_count, 0) <> 1
),
identity_mismatches AS (
  SELECT delivery_unit_id, link_type, movement_id, movement_item_id
  FROM tagged_units WHERE matching_item_count = 1 AND identity_mismatch
),
date_mismatches AS (
  SELECT delivery_unit_id, link_type, movement_id, canonical_event_date, physical_event_date
  FROM tagged_units WHERE physical_event_date IS DISTINCT FROM canonical_event_date
),
noncompleted_source_links AS (
  SELECT delivery_unit_id, link_type, movement_id, movement_status
  FROM tagged_units WHERE movement_status <> 'completed'
),
noncompleted_events_exposed AS (
  SELECT event.event_identity, event.movement_id, movement.status
  FROM public.v_b2b_waste_events_normalized AS event
  JOIN public.commercial_partner_movements AS movement ON movement.id = event.movement_id
  WHERE movement.status <> 'completed'
),
ambiguous_waste_mappings AS (
  SELECT event_identity, deduplication_evidence
  FROM public.v_b2b_waste_events_normalized WHERE deduplication_evidence LIKE 'ambiguous:%'
),
ambiguous_delivery_mappings AS (
  SELECT movement_item_id, product_name, product_variant, product_size
  FROM public.v_b2b_delivery_product_keys_normalized WHERE mapping_status = 'ambiguous'
),
source_counts AS (
  SELECT waste_source, SUM(quantity) AS quantity FROM current_events GROUP BY waste_source
),
global_totals AS (
  SELECT COALESCE(SUM(quantity), 0) AS quantity,
    SUM(production_cost_total) AS production_cost_total,
    SUM(public_value_total) AS public_value_total,
    COALESCE(SUM(quantity) FILTER (WHERE NOT production_cost_complete), 0) AS missing_cost_quantity,
    COALESCE(SUM(quantity) FILTER (WHERE NOT public_value_complete), 0) AS missing_public_price_quantity
  FROM current_events
),
partner_total AS (
  SELECT COALESCE(SUM(quantity), 0) AS quantity
  FROM (SELECT partner_id, SUM(quantity) AS quantity FROM current_events GROUP BY partner_id) AS partner
),
product_total AS (
  SELECT COALESCE(SUM(quantity), 0) AS quantity
  FROM (SELECT product_key, SUM(quantity) AS quantity FROM current_events GROUP BY product_key) AS product
),
duplicate_candidates AS (
  SELECT event_identity, COUNT(*) AS occurrences
  FROM public.v_b2b_waste_events_normalized GROUP BY event_identity HAVING COUNT(*) > 1
),
checks AS (
  SELECT
    (SELECT COUNT(*) FROM rpc) = 1 AS rpc_exists_once,
    COALESCE((SELECT prosecdef AND provolatile = 's' FROM rpc), FALSE) AS rpc_is_stable_security_definer,
    COALESCE((SELECT proconfig @> ARRAY['search_path=public, pg_temp'] FROM rpc), FALSE) AS safe_search_path,
    COALESCE((SELECT POSITION('auth.uid()' IN definition) > 0 AND POSITION('profile.role = ''admin''' IN definition) > 0 AND POSITION('profile.is_active' IN definition) > 0 FROM rpc), FALSE) AS validates_active_admin,
    COALESCE((SELECT public_execute_revoked AND anon_execute_revoked AND authenticated_can_execute FROM rpc), FALSE) AS execute_permissions_are_restricted,
    (SELECT COUNT(*) FROM waste_view_contract) = 1 AS normalized_waste_view_exists_once,
    COALESCE((SELECT reloptions @> ARRAY['security_invoker=true'] AND anon_select_revoked AND authenticated_select_revoked FROM waste_view_contract), FALSE) AS waste_view_is_private_security_invoker,
    (SELECT COUNT(*) FROM delivery_view_contract) = 1 AS normalized_delivery_view_exists_once,
    COALESCE((SELECT reloptions @> ARRAY['security_invoker=true'] AND anon_select_revoked AND authenticated_select_revoked FROM delivery_view_contract), FALSE) AS delivery_view_is_private_security_invoker,
    COALESCE((SELECT POSITION('tagged spoilage units exceed movement item quantity_spoiled' IN definition) > 0 AND POSITION('tagged withdrawal units exceed movement item quantity_withdrawn' IN definition) > 0 FROM waste_view_contract), FALSE) AS quantity_overages_are_explicit,
    COALESCE((SELECT POSITION('unit identity does not match movement item product, variant, and size' IN definition) > 0 FROM waste_view_contract), FALSE) AS tagged_identity_is_validated,
    COALESCE((SELECT POSITION('movement.movement_date::date as event_date' IN definition) > 0 AND POSITION('spoiled_at at time zone' IN definition) = 0 AND POSITION('returned_good_at at time zone' IN definition) = 0 FROM waste_view_contract), FALSE) AS movement_date_is_canonical,
    COALESCE((SELECT POSITION('movement.status = ''completed''' IN definition) > 0 FROM waste_view_contract), FALSE) AS waste_excludes_noncompleted_movements,
    COALESCE((SELECT POSITION('movement.status = ''completed''' IN definition) > 0 AND POSITION('movement.movement_type = ''delivery''' IN definition) > 0 FROM delivery_view_contract), FALSE) AS denominator_excludes_noncompleted_movements,
    COALESCE((SELECT POSITION('v_b2b_delivery_product_keys_normalized' IN definition) > 0 AND POSITION('delivery.product_key' IN definition) > 0 FROM rpc), FALSE) AS denominator_uses_normalized_product_keys,
    COALESCE((SELECT POSITION('mapping_status = ''ambiguous''' IN definition) > 0 AND POSITION('b2b delivery reconciliation failed' IN definition) > 0 FROM rpc), FALSE) AS ambiguous_delivery_mappings_raise_errors,
    COALESCE((SELECT POSITION('source_item.suggested_retail_price' IN definition) > 0 AND POSITION('product.price' IN definition) > 0 AND POSITION('price_to_catcorn' IN definition) = 0 FROM waste_view_contract), FALSE) AS public_price_uses_pvp_not_partner_price,
    NOT EXISTS (SELECT 1 FROM current_events WHERE public_unit_price IS NULL AND public_value_complete) AS missing_public_price_is_not_silently_zero,
    NOT EXISTS (SELECT 1 FROM quantity_overages) AS no_tagged_quantity_overages,
    NOT EXISTS (SELECT 1 FROM item_count_mismatches) AS every_tagged_unit_has_one_deduplication_item,
    NOT EXISTS (SELECT 1 FROM identity_mismatches) AS every_tagged_unit_matches_item_identity,
    NOT EXISTS (SELECT 1 FROM noncompleted_events_exposed) AS no_pending_or_cancelled_events_are_exposed,
    NOT EXISTS (SELECT 1 FROM ambiguous_waste_mappings) AS no_ambiguous_waste_mappings,
    NOT EXISTS (SELECT 1 FROM ambiguous_delivery_mappings) AS no_ambiguous_delivery_mappings,
    (SELECT quantity FROM global_totals) = (SELECT quantity FROM partner_total) AS partner_sum_matches_global,
    (SELECT quantity FROM global_totals) = (SELECT quantity FROM product_total) AS product_sum_matches_global,
    NOT EXISTS (SELECT 1 FROM duplicate_candidates) AS event_identity_is_unique,
    COALESCE((SELECT definition NOT LIKE '%insert into%' AND definition NOT LIKE '%update %' AND definition NOT LIKE '%delete from%' FROM rpc), FALSE) AS rpc_contains_no_historical_dml
)
SELECT JSONB_BUILD_OBJECT(
  'all_checks_passed', rpc_exists_once AND rpc_is_stable_security_definer AND safe_search_path
    AND validates_active_admin AND execute_permissions_are_restricted
    AND normalized_waste_view_exists_once AND waste_view_is_private_security_invoker
    AND normalized_delivery_view_exists_once AND delivery_view_is_private_security_invoker
    AND quantity_overages_are_explicit AND tagged_identity_is_validated AND movement_date_is_canonical
    AND waste_excludes_noncompleted_movements AND denominator_excludes_noncompleted_movements
    AND denominator_uses_normalized_product_keys AND ambiguous_delivery_mappings_raise_errors
    AND public_price_uses_pvp_not_partner_price AND missing_public_price_is_not_silently_zero
    AND no_tagged_quantity_overages AND every_tagged_unit_has_one_deduplication_item
    AND every_tagged_unit_matches_item_identity AND no_pending_or_cancelled_events_are_exposed
    AND no_ambiguous_waste_mappings AND no_ambiguous_delivery_mappings
    AND partner_sum_matches_global AND product_sum_matches_global
    AND event_identity_is_unique AND rpc_contains_no_historical_dml,
  'checks', TO_JSONB(checks),
  'current_month_reconciliation', JSONB_BUILD_OBJECT(
    'start_date', (SELECT start_date FROM month_bounds),
    'end_date_exclusive', (SELECT end_date_exclusive FROM month_bounds),
    'total_quantity', (SELECT quantity FROM global_totals),
    'partner_sum', (SELECT quantity FROM partner_total),
    'product_sum', (SELECT quantity FROM product_total)
  ),
  'counts_by_source', COALESCE((SELECT JSONB_OBJECT_AGG(waste_source, quantity) FROM source_counts), '{}'::JSONB),
  'production_cost_total', (SELECT production_cost_total FROM global_totals),
  'public_value_total', (SELECT public_value_total FROM global_totals),
  'missing_cost_quantity', (SELECT missing_cost_quantity FROM global_totals),
  'missing_public_price_quantity', (SELECT missing_public_price_quantity FROM global_totals),
  'quantity_overages', COALESCE((SELECT JSONB_AGG(TO_JSONB(row)) FROM quantity_overages AS row), '[]'::JSONB),
  'item_count_mismatches', COALESCE((SELECT JSONB_AGG(TO_JSONB(row)) FROM item_count_mismatches AS row), '[]'::JSONB),
  'identity_mismatches', COALESCE((SELECT JSONB_AGG(TO_JSONB(row)) FROM identity_mismatches AS row), '[]'::JSONB),
  'physical_vs_canonical_date_mismatches', COALESCE((SELECT JSONB_AGG(TO_JSONB(row)) FROM date_mismatches AS row), '[]'::JSONB),
  'noncompleted_source_links_excluded', COALESCE((SELECT JSONB_AGG(TO_JSONB(row)) FROM noncompleted_source_links AS row), '[]'::JSONB),
  'ambiguous_waste_mappings', COALESCE((SELECT JSONB_AGG(TO_JSONB(row)) FROM ambiguous_waste_mappings AS row), '[]'::JSONB),
  'ambiguous_delivery_mappings', COALESCE((SELECT JSONB_AGG(TO_JSONB(row)) FROM ambiguous_delivery_mappings AS row), '[]'::JSONB),
  'duplicate_candidates', COALESCE((SELECT JSONB_AGG(TO_JSONB(row)) FROM duplicate_candidates AS row), '[]'::JSONB)
) AS verification
FROM checks;

ROLLBACK;
