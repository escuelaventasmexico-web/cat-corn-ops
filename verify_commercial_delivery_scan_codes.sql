-- Read-only verification for 16-digit commercial-delivery scan codes.
-- Run after 20260903_commercial_delivery_scan_codes.sql.
-- Returns exactly one JSONB object and never creates or changes data.

WITH scan_code_column AS (
  SELECT COUNT(*) = 1 AND BOOL_AND(
    attribute.attname = 'scan_code'
    AND format_type(attribute.atttypid, attribute.atttypmod) = 'text'
    AND attribute.attnotnull
  ) AS valid
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.commercial_delivery_units'::REGCLASS
    AND attribute.attname = 'scan_code'
    AND attribute.attnum > 0 AND NOT attribute.attisdropped
), scan_code_constraints AS (
  SELECT
    COALESCE(BOOL_OR(constraint.conname = 'commercial_delivery_units_scan_code_key'
      AND constraint.contype = 'u'), false) AS unique_supported,
    COALESCE(BOOL_OR(constraint.conname = 'commercial_delivery_units_scan_code_format_check'
      AND constraint.contype = 'c'
      AND pg_get_constraintdef(constraint.oid, true) ILIKE '%scan_code%^[0-9]{16}%'), false) AS format_supported
  FROM pg_constraint AS constraint
  WHERE constraint.conrelid = 'public.commercial_delivery_units'::REGCLASS
), scan_code_data AS (
  SELECT
    (SELECT COUNT(*)::BIGINT FROM public.commercial_delivery_units) AS total_units,
    (SELECT COUNT(*)::BIGINT FROM public.commercial_delivery_units WHERE scan_code IS NULL) AS missing_scan_codes,
    (SELECT COUNT(*)::BIGINT FROM public.commercial_delivery_units WHERE scan_code IS NOT NULL AND scan_code !~ '^[0-9]{16}$') AS invalid_scan_codes,
    (SELECT COUNT(*)::BIGINT FROM (
      SELECT scan_code
      FROM public.commercial_delivery_units
      WHERE scan_code IS NOT NULL
      GROUP BY scan_code
      HAVING COUNT(*) > 1
    ) AS duplicate_codes) AS duplicate_scan_codes
), known_test_unit AS (
  SELECT
    '2e6a0b12-160e-4c0d-9690-1c24ddc4e0e7'::UUID AS id,
    EXISTS(SELECT 1 FROM public.commercial_delivery_units WHERE id = '2e6a0b12-160e-4c0d-9690-1c24ddc4e0e7'::UUID) AS exists,
    (SELECT scan_code FROM public.commercial_delivery_units WHERE id = '2e6a0b12-160e-4c0d-9690-1c24ddc4e0e7'::UUID) AS scan_code,
    COALESCE((SELECT scan_code ~ '^[0-9]{16}$' FROM public.commercial_delivery_units WHERE id = '2e6a0b12-160e-4c0d-9690-1c24ddc4e0e7'::UUID), false) AS scan_code_valid
), generator_contract AS (
  SELECT COUNT(*) = 1 AS exists_exactly_once,
    COALESCE(BOOL_AND(procedure.prorettype = 'text'::REGTYPE), false) AS returns_text,
    COALESCE(BOOL_AND(procedure.prosecdef), false) AS security_definer,
    COALESCE(BOOL_AND(COALESCE(array_to_string(procedure.proconfig, ','), '') ILIKE '%search_path=public, pg_temp%'), false) AS pinned_search_path,
    COALESCE(BOOL_AND(NOT has_function_privilege('public', procedure.oid, 'EXECUTE')), false) AS public_execute_revoked,
    COALESCE(BOOL_AND(NOT has_function_privilege('anon', procedure.oid, 'EXECUTE')), false) AS anon_execute_revoked,
    COALESCE(BOOL_AND(NOT has_function_privilege('authenticated', procedure.oid, 'EXECUTE')), false) AS authenticated_execute_revoked,
    COALESCE(BOOL_AND(NOT has_function_privilege('service_role', procedure.oid, 'EXECUTE')), false) AS service_role_execute_revoked
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = '_commercial_delivery_generate_scan_code'
    AND pg_get_function_identity_arguments(procedure.oid) = ''
), assignment_contract AS (
  SELECT COUNT(*) = 1 AS exists_exactly_once,
    COALESCE(BOOL_AND(procedure.prosecdef), false) AS security_definer,
    COALESCE(BOOL_AND(COALESCE(array_to_string(procedure.proconfig, ','), '') ILIKE '%search_path=public, pg_temp%'), false) AS pinned_search_path,
    COALESCE(BOOL_AND(pg_get_functiondef(procedure.oid) ILIKE '%new.scan_code := public._commercial_delivery_generate_scan_code()%'), false) AS assigns_generated_code,
    COALESCE(BOOL_AND(NOT has_function_privilege('public', procedure.oid, 'EXECUTE')), false) AS public_execute_revoked,
    COALESCE(BOOL_AND(NOT has_function_privilege('anon', procedure.oid, 'EXECUTE')), false) AS anon_execute_revoked,
    COALESCE(BOOL_AND(NOT has_function_privilege('authenticated', procedure.oid, 'EXECUTE')), false) AS authenticated_execute_revoked,
    COALESCE(BOOL_AND(NOT has_function_privilege('service_role', procedure.oid, 'EXECUTE')), false) AS service_role_execute_revoked
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = '_commercial_delivery_assign_scan_code'
    AND pg_get_function_identity_arguments(procedure.oid) = ''
), generation_trigger_contract AS (
  SELECT COUNT(*) = 1 AND COALESCE(BOOL_AND(
    trigger.tgrelid = 'public.commercial_delivery_units'::REGCLASS
    AND (trigger.tgtype & 2) <> 0 AND (trigger.tgtype & 4) <> 0
    AND (trigger.tgtype & 8) = 0 AND (trigger.tgtype & 16) = 0
    AND trigger.tgenabled = 'O'
    AND procedure.proname = '_commercial_delivery_assign_scan_code'
    AND namespace.nspname = 'public'
  ), false) AS installed
  FROM pg_trigger AS trigger
  LEFT JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
  LEFT JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE NOT trigger.tgisinternal
    AND trigger.tgname = '00_commercial_delivery_scan_code_before_insert'
), insert_helper_contract AS (
  SELECT COUNT(*) = 1 AS exists_exactly_once,
    COALESCE(BOOL_AND(
      pg_get_function_identity_arguments(procedure.oid) = 'p_source_type text, p_partner_id uuid, p_movement_id uuid, p_wholesale_order_id uuid, p_source_item_id uuid, p_product_id uuid, p_product_lot_id uuid, p_product_code text, p_product_name text, p_product_variant text, p_product_size text, p_unit_price numeric, p_unit_cost numeric, p_generated_by uuid, p_replaces_unit_id uuid'
      AND pg_get_functiondef(procedure.oid) ILIKE '%insert into public.commercial_delivery_units%'
      AND pg_get_function_identity_arguments(procedure.oid) NOT ILIKE '%scan_code%'
      AND NOT has_function_privilege('public', procedure.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', procedure.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    ), false) AS valid
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = '_commercial_delivery_insert_unit'
), expected_creation_rpcs(name, arguments) AS (
  VALUES
    ('create_comodato_delivery_with_units'::TEXT, 'p_partner_id uuid, p_movement_date date, p_next_visit_date date, p_next_visit_reason text, p_notes text, p_items jsonb'),
    ('create_wholesale_order_with_units', 'p_partner_id uuid, p_order_date date, p_notes text, p_items jsonb, p_payment_terms_hours integer')
), creation_rpc_contract AS (
  SELECT expected.name,
    procedure.oid IS NOT NULL AND pg_get_function_identity_arguments(procedure.oid) = expected.arguments AS signature_matches,
    pg_get_functiondef(procedure.oid) ILIKE '%public._commercial_delivery_insert_unit%' AS calls_insert_helper,
    pg_get_functiondef(procedure.oid) NOT ILIKE '%insert into%commercial_delivery_units%' AS avoids_direct_unit_insert,
    pg_get_function_identity_arguments(procedure.oid) NOT ILIKE '%scan_code%' AS has_no_scan_code_argument
  FROM expected_creation_rpcs AS expected
  LEFT JOIN pg_namespace AS namespace ON namespace.nspname = 'public'
  LEFT JOIN pg_proc AS procedure ON procedure.pronamespace = namespace.oid AND procedure.proname = expected.name
), expected_operational_rpcs(name, arguments) AS (
  VALUES
    ('scan_commercial_delivery_unit_for_release'::TEXT, 'p_barcode_value text, p_partner_id uuid'),
    ('register_partner_spoilage_by_barcode', 'p_barcode_value text, p_partner_id uuid, p_reason text'),
    ('register_partner_return_by_barcode', 'p_barcode_value text, p_partner_id uuid, p_reason text')
), operational_rpc_contract AS (
  SELECT expected.name,
    procedure.oid IS NOT NULL AND pg_get_function_identity_arguments(procedure.oid) = expected.arguments AS signature_matches,
    pg_get_functiondef(procedure.oid) ILIKE '%^[0-9]{16}$%' AS validates_16_digits,
    pg_get_functiondef(procedure.oid) ILIKE '%scan_code = btrim(p_barcode_value)%' AS resolves_by_scan_code,
    pg_get_functiondef(procedure.oid) NOT ILIKE '%barcode_value = btrim(p_barcode_value)%'
      AND pg_get_functiondef(procedure.oid) NOT ILIKE '%or barcode_value%' AS does_not_resolve_by_barcode_value
  FROM expected_operational_rpcs AS expected
  LEFT JOIN pg_namespace AS namespace ON namespace.nspname = 'public'
  LEFT JOIN pg_proc AS procedure ON procedure.pronamespace = namespace.oid AND procedure.proname = expected.name
), identity_guard AS (
  SELECT COUNT(*) = 1 AND COALESCE(BOOL_AND(
    pg_get_functiondef(procedure.oid) ILIKE '%scan_code is immutable%'
    AND pg_get_functiondef(procedure.oid) ILIKE '%new.scan_code is distinct from old.scan_code%'
  ), false) AS scan_code_immutable
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = '_commercial_delivery_unit_guard'
    AND pg_get_function_identity_arguments(procedure.oid) = ''
), b2b_analytics AS (
  SELECT pg_get_functiondef(procedure.oid) AS definition
  FROM pg_proc AS procedure JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public' AND procedure.proname = 'get_b2b_product_analytics'
), label_table_rls AS (
  SELECT relrowsecurity AS enabled FROM pg_class WHERE oid = 'public.commercial_delivery_units'::REGCLASS
)
SELECT jsonb_build_object(
  'all_checks_passed',
    (SELECT valid FROM scan_code_column)
    AND (SELECT unique_supported AND format_supported FROM scan_code_constraints)
    AND (SELECT missing_scan_codes = 0 AND invalid_scan_codes = 0 AND duplicate_scan_codes = 0 FROM scan_code_data)
    AND (SELECT NOT exists OR scan_code_valid FROM known_test_unit)
    AND (SELECT exists_exactly_once AND returns_text AND security_definer AND pinned_search_path AND public_execute_revoked AND anon_execute_revoked AND authenticated_execute_revoked AND service_role_execute_revoked FROM generator_contract)
    AND (SELECT exists_exactly_once AND security_definer AND pinned_search_path AND assigns_generated_code AND public_execute_revoked AND anon_execute_revoked AND authenticated_execute_revoked AND service_role_execute_revoked FROM assignment_contract)
    AND (SELECT installed FROM generation_trigger_contract)
    AND (SELECT valid FROM insert_helper_contract)
    AND (SELECT COUNT(*) = 2 AND BOOL_AND(signature_matches AND calls_insert_helper AND avoids_direct_unit_insert AND has_no_scan_code_argument) FROM creation_rpc_contract)
    AND (SELECT COUNT(*) = 3 AND BOOL_AND(signature_matches AND validates_16_digits AND resolves_by_scan_code AND does_not_resolve_by_barcode_value) FROM operational_rpc_contract)
    AND (SELECT scan_code_immutable FROM identity_guard)
    AND (SELECT COUNT(*) = 1 AND definition NOT ILIKE '%commercial_delivery_units%' AND definition NOT ILIKE '%scan_code%' FROM b2b_analytics)
    AND (SELECT COUNT(*) = 1 AND enabled FROM label_table_rls),
  'scan_code_data', (SELECT to_jsonb(value) FROM scan_code_data AS value),
  'known_test_unit', (SELECT to_jsonb(value) FROM known_test_unit AS value),
  'generator', (SELECT to_jsonb(value) FROM generator_contract AS value),
  'assignment', (SELECT to_jsonb(value) FROM assignment_contract AS value),
  'generation_trigger', (SELECT to_jsonb(value) FROM generation_trigger_contract AS value),
  'insert_helper', (SELECT to_jsonb(value) FROM insert_helper_contract AS value),
  'creation_rpcs', (SELECT jsonb_agg(to_jsonb(value) ORDER BY name) FROM creation_rpc_contract AS value),
  'operational_rpcs', (SELECT jsonb_agg(to_jsonb(value) ORDER BY name) FROM operational_rpc_contract AS value),
  'identity_guard', (SELECT to_jsonb(value) FROM identity_guard AS value),
  'b2b_analytics_unchanged_by_scan_codes', COALESCE((SELECT definition NOT ILIKE '%commercial_delivery_units%' AND definition NOT ILIKE '%scan_code%' FROM b2b_analytics), false),
  'commercial_delivery_units_rls_enabled', COALESCE((SELECT enabled FROM label_table_rls), false)
) AS commercial_delivery_scan_code_verification;
