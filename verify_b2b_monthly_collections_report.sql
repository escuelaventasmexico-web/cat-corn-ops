-- Read-only verification for 20260905_b2b_monthly_collections_report.sql.
-- Returns one JSONB document and does not alter database state.
WITH function_contract AS (
  SELECT p.oid, p.prosrc, p.provolatile, p.prosecdef, p.proconfig,
         pg_get_function_identity_arguments(p.oid) AS arguments
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_b2b_monthly_collections_report'
)
SELECT JSONB_BUILD_OBJECT(
  'function_exists_with_exact_signature', EXISTS (
    SELECT 1 FROM function_contract WHERE arguments = 'p_month_start date, p_month_end date'
  ),
  'read_only_stable', EXISTS (
    SELECT 1 FROM function_contract
    WHERE provolatile = 's'
      AND NOT prosecdef
      AND COALESCE(array_to_string(proconfig, ','), '') LIKE '%search_path=public%'
      AND prosrc !~* '\\m(insert|update|delete|merge|truncate|create|alter|drop)\\M'
  ),
  'uses_independent_comodato_and_mayoreo_branches', EXISTS (
    SELECT 1 FROM function_contract
    WHERE prosrc LIKE '%commercial_partner_movements%'
      AND prosrc LIKE '%commercial_partner_movement_items%'
      AND prosrc LIKE '%wholesale_orders%'
      AND prosrc LIKE '%wholesale_order_items%'
  ),
  'payments_use_operation_fks_and_are_preaggregated', EXISTS (
    SELECT 1 FROM function_contract
    WHERE prosrc LIKE '%payment.movement_id%'
      AND prosrc LIKE '%payment.wholesale_order_id%'
      AND prosrc LIKE '%comodato_payments AS%'
      AND prosrc LIKE '%wholesale_payments AS%'
      AND prosrc NOT LIKE '%payment.partner_id%'
  ),
  'excludes_unreleased_and_cancelled_sources', EXISTS (
    SELECT 1 FROM function_contract
    WHERE prosrc LIKE '%movement.status = ''completed''%'
      AND prosrc LIKE '%orders.order_status IN (''delivered'', ''completed'')%'
  ),
  'does_not_use_catalog_prices', NOT EXISTS (
    SELECT 1 FROM function_contract WHERE prosrc ~* '\\mproducts\\M'
  ),
  'protected_views_preserved', (
    SELECT COUNT(*) = 4
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
      AND c.relname IN (
        'v_b2b_collection_report', 'v_b2b_pending_balances',
        'v_pending_payment_verifications', 'v_wholesale_order_totals'
      )
  ),
  'product_analytics_preserved', EXISTS (
    SELECT 1 FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_b2b_product_analytics'
  )
) AS verification;
