-- Read-only verification for 20260906_historical_unlabelled_spoilage.sql.
WITH functions AS (
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
    p.prosecdef, p.proconfig, p.prosrc
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('get_partner_historical_unlabelled_stock', 'register_partner_spoilage_historical_exception')
)
SELECT JSONB_BUILD_OBJECT(
  'historical_stock_reader_exists', EXISTS (SELECT 1 FROM functions WHERE proname = 'get_partner_historical_unlabelled_stock' AND arguments = 'p_partner_id uuid'),
  'historical_spoilage_writer_exists', EXISTS (SELECT 1 FROM functions WHERE proname = 'register_partner_spoilage_historical_exception' AND arguments = 'p_partner_id uuid, p_identity jsonb, p_quantity integer, p_reason text, p_movement_date date'),
  'functions_are_guarded_definers', (SELECT COUNT(*) = 2 FROM functions WHERE prosecdef AND COALESCE(array_to_string(proconfig, ','), '') LIKE '%search_path=public, pg_temp%'),
  'uses_admin_exception_permission', EXISTS (SELECT 1 FROM functions WHERE proname = 'register_partner_spoilage_historical_exception' AND prosrc LIKE '%_commercial_delivery_actor(p_partner_id, true)%'),
  'locks_concurrent_identity_changes', EXISTS (SELECT 1 FROM functions WHERE proname = 'register_partner_spoilage_historical_exception' AND prosrc LIKE '%pg_advisory_xact_lock%'),
  'excludes_labelled_source_items', EXISTS (SELECT 1 FROM functions WHERE proname = 'get_partner_historical_unlabelled_stock' AND prosrc LIKE '%commercial_delivery_units%source_item_id%'),
  'uses_server_calculated_historical_balance', EXISTS (SELECT 1 FROM functions WHERE proname = 'register_partner_spoilage_historical_exception' AND prosrc LIKE '%get_partner_historical_unlabelled_stock(p_partner_id)%'),
  'does_not_invent_catalog_identity', EXISTS (SELECT 1 FROM functions WHERE proname = 'register_partner_spoilage_historical_exception' AND prosrc LIKE '%p_partner_id, NULL, v_name, v_variant, v_size%')
    AND NOT EXISTS (SELECT 1 FROM functions WHERE proname = 'register_partner_spoilage_historical_exception' AND prosrc LIKE '%products%'),
  'preserves_barcode_spoilage_function', EXISTS (
    SELECT 1 FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'register_partner_spoilage_by_barcode'
  )
) AS verification;
