-- Read-only verifier for 20260920_b2b_monthly_analysis.sql.
-- Run after the migration. It returns exactly one JSONB document.

WITH function_contract AS (
  SELECT
    proc.oid,
    proc.provolatile,
    proc.prosecdef,
    proc.proconfig,
    proc.prosrc AS source,
    pg_get_function_identity_arguments(proc.oid) AS arguments,
    pg_get_functiondef(proc.oid) AS definition
  FROM pg_proc AS proc
  JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'get_b2b_monthly_analysis'
)
SELECT JSONB_BUILD_OBJECT(
  'function_exists_with_exact_signature', EXISTS (
    SELECT 1 FROM function_contract WHERE arguments = 'p_month_start date, p_month_end date'
  ),
  'single_function_overload', (SELECT COUNT(*) = 1 FROM function_contract),
  'read_only_stable_security_invoker', EXISTS (
    SELECT 1 FROM function_contract
    WHERE provolatile = 's'
      AND NOT prosecdef
      AND COALESCE(proconfig, ARRAY[]::TEXT[]) @> ARRAY['search_path=public']
      AND source !~* '\m(insert|update|delete|merge|truncate|create|alter|drop)\M'
  ),
  'restricted_execute', EXISTS (
    SELECT 1 FROM function_contract
    WHERE NOT has_function_privilege('public', oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', oid, 'EXECUTE')
      AND has_function_privilege('authenticated', oid, 'EXECUTE')
  ),
  'uses_real_operation_sources', EXISTS (
    SELECT 1 FROM function_contract
    WHERE definition LIKE '%commercial_partner_movements%'
      AND definition LIKE '%commercial_partner_movement_items%'
      AND definition LIKE '%wholesale_orders%'
      AND definition LIKE '%wholesale_order_items%'
      AND definition LIKE '%seller_piece_sales%'
      AND definition LIKE '%seller_piece_sale_items%'
  ),
  'uses_commercial_and_payment_dates', EXISTS (
    SELECT 1 FROM function_contract
    WHERE definition LIKE '%movement.movement_date%'
      AND definition LIKE '%orders.released_at%'
      AND definition LIKE '%orders.delivery_date%'
      AND definition LIKE '%orders.order_date%'
      AND definition LIKE '%sale.sale_date%'
      AND definition LIKE '%payment.payment_date AT TIME ZONE ''America/Mexico_City''%'
  ),
  'excludes_non_definitive_sources', EXISTS (
    SELECT 1 FROM function_contract
    WHERE definition LIKE '%movement.status = ''completed''%'
      AND definition LIKE '%orders.order_status IN (''delivered'', ''completed'')%'
      AND definition LIKE '%sale.status = ''confirmed''%'
      AND definition LIKE '%payment.status IN (''completed'', ''paid'')%'
      AND definition LIKE '%payment.status = ''completed''%'
  ),
  'includes_previous_calendar_month', EXISTS (
    SELECT 1 FROM function_contract WHERE definition LIKE '%p_month_start - INTERVAL ''1 month''%'
  ),
  'monthly_total_is_explicit_channel_sum', EXISTS (
    SELECT 1 FROM function_contract
    WHERE definition LIKE '%comodato_generated + wholesale_purchased + piece_generated%'
      AND definition LIKE '%comodato_paid + wholesale_paid + piece_paid%'
      AND definition LIKE '%comodato_units + wholesale_units + piece_units%'
  ),
  'all_checks_passed',
    EXISTS (SELECT 1 FROM function_contract WHERE arguments = 'p_month_start date, p_month_end date')
    AND (SELECT COUNT(*) = 1 FROM function_contract)
    AND EXISTS (
      SELECT 1 FROM function_contract
      WHERE provolatile = 's' AND NOT prosecdef
        AND COALESCE(proconfig, ARRAY[]::TEXT[]) @> ARRAY['search_path=public']
        AND source !~* '\m(insert|update|delete|merge|truncate|create|alter|drop)\M'
    )
    AND EXISTS (
      SELECT 1 FROM function_contract
      WHERE NOT has_function_privilege('public', oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', oid, 'EXECUTE')
        AND has_function_privilege('authenticated', oid, 'EXECUTE')
    )
    AND EXISTS (
      SELECT 1 FROM function_contract
      WHERE definition LIKE '%commercial_partner_movements%'
        AND definition LIKE '%commercial_partner_movement_items%'
        AND definition LIKE '%wholesale_orders%'
        AND definition LIKE '%wholesale_order_items%'
        AND definition LIKE '%seller_piece_sales%'
        AND definition LIKE '%seller_piece_sale_items%'
        AND definition LIKE '%movement.movement_date%'
        AND definition LIKE '%orders.released_at%'
        AND definition LIKE '%orders.delivery_date%'
        AND definition LIKE '%orders.order_date%'
        AND definition LIKE '%sale.sale_date%'
        AND definition LIKE '%payment.payment_date AT TIME ZONE ''America/Mexico_City''%'
        AND definition LIKE '%movement.status = ''completed''%'
        AND definition LIKE '%orders.order_status IN (''delivered'', ''completed'')%'
        AND definition LIKE '%sale.status = ''confirmed''%'
        AND definition LIKE '%p_month_start - INTERVAL ''1 month''%'
        AND definition LIKE '%comodato_generated + wholesale_purchased + piece_generated%'
    )
) AS verification;
