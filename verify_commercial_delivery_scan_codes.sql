-- Read-only verification for short commercial-delivery scan codes.
-- Run after 20260903_commercial_delivery_scan_codes.sql.
-- Returns exactly one JSONB object and never creates or changes data.

WITH scan_code_column AS (
  SELECT
    attribute.attname,
    format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
    attribute.attnotnull AS not_null
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.commercial_delivery_units'::REGCLASS
    AND attribute.attname = 'scan_code'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
), scan_code_constraints AS (
  SELECT
    BOOL_OR(item.contype = 'u' AND pg_get_constraintdef(item.oid, true) ILIKE '%(scan_code)%') AS unique_supported,
    BOOL_OR(item.contype = 'c' AND pg_get_constraintdef(item.oid, true) LIKE '%^[0-9]{16}$%') AS format_supported
  FROM pg_constraint AS item
  WHERE item.conrelid = 'public.commercial_delivery_units'::REGCLASS
), scan_code_data AS (
  SELECT
    COUNT(*)::BIGINT AS total_units,
    COUNT(*) FILTER (WHERE scan_code IS NULL)::BIGINT AS missing_scan_codes,
    COUNT(*) FILTER (WHERE scan_code IS NOT NULL AND scan_code !~ '^[0-9]{16}$')::BIGINT AS invalid_scan_codes,
    COUNT(*) - COUNT(DISTINCT scan_code)::BIGINT AS duplicate_scan_codes
  FROM public.commercial_delivery_units
), expected_rpcs(name, arguments) AS (
  VALUES
    ('create_comodato_delivery_with_units'::TEXT, 'p_partner_id uuid, p_movement_date date, p_next_visit_date date, p_next_visit_reason text, p_notes text, p_items jsonb'),
    ('create_wholesale_order_with_units', 'p_partner_id uuid, p_order_date date, p_notes text, p_items jsonb, p_payment_terms_hours integer'),
    ('scan_commercial_delivery_unit_for_release', 'p_barcode_value text, p_partner_id uuid'),
    ('register_partner_spoilage_by_barcode', 'p_barcode_value text, p_partner_id uuid, p_reason text'),
    ('register_partner_return_by_barcode', 'p_barcode_value text, p_partner_id uuid, p_reason text')
), rpc_definitions AS (
  SELECT
    expected.name,
    expected.arguments,
    procedure.oid,
    pg_get_function_identity_arguments(procedure.oid) AS actual_arguments,
    pg_get_functiondef(procedure.oid) AS definition
  FROM expected_rpcs AS expected
  LEFT JOIN pg_namespace AS namespace ON namespace.nspname = 'public'
  LEFT JOIN pg_proc AS procedure
    ON procedure.pronamespace = namespace.oid
   AND procedure.proname = expected.name
), rpc_contract AS (
  SELECT
    name,
    actual_arguments,
    oid IS NOT NULL AND actual_arguments = arguments AS signature_matches,
    CASE
      WHEN name IN ('create_comodato_delivery_with_units', 'create_wholesale_order_with_units') THEN
        definition ILIKE '%_commercial_delivery_insert_unit%'
        AND definition ILIKE '%scan_code%'
      ELSE
        definition ILIKE '%scan_code%'
        AND definition ILIKE '%barcode_value%'
    END AS scan_code_and_legacy_barcode_supported
  FROM rpc_definitions
), identity_guard AS (
  SELECT
    procedure.oid IS NOT NULL AS exists,
    pg_get_functiondef(procedure.oid) ILIKE '%scan_code is immutable%'
      AND pg_get_functiondef(procedure.oid) ILIKE '%new.scan_code is distinct from old.scan_code%'
      AS scan_code_immutable
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = '_commercial_delivery_unit_guard'
    AND pg_get_function_identity_arguments(procedure.oid) = ''
), b2b_analytics AS (
  SELECT pg_get_functiondef(procedure.oid) AS definition
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'get_b2b_product_analytics'
), label_table_rls AS (
  SELECT relrowsecurity AS enabled
  FROM pg_class
  WHERE oid = 'public.commercial_delivery_units'::REGCLASS
)
SELECT jsonb_build_object(
  'all_checks_passed',
    (SELECT COUNT(*) = 1 AND BOOL_AND(attname = 'scan_code' AND data_type = 'text' AND not_null) FROM scan_code_column)
    AND (SELECT COALESCE(unique_supported, false) AND COALESCE(format_supported, false) FROM scan_code_constraints)
    AND (SELECT missing_scan_codes = 0 AND invalid_scan_codes = 0 AND duplicate_scan_codes = 0 FROM scan_code_data)
    AND (SELECT COUNT(*) = 5 AND BOOL_AND(signature_matches AND scan_code_and_legacy_barcode_supported) FROM rpc_contract)
    AND (SELECT COUNT(*) = 1 AND BOOL_AND(exists AND scan_code_immutable) FROM identity_guard)
    AND (SELECT COUNT(*) = 1 AND definition NOT ILIKE '%commercial_delivery_units%' AND definition NOT ILIKE '%scan_code%' FROM b2b_analytics)
    AND (SELECT COUNT(*) = 1 AND enabled FROM label_table_rls),
  'scan_code_column', COALESCE((SELECT to_jsonb(value) FROM scan_code_column AS value), 'null'::JSONB),
  'scan_code_constraints', COALESCE((SELECT to_jsonb(value) FROM scan_code_constraints AS value), 'null'::JSONB),
  'scan_code_data', (SELECT to_jsonb(value) FROM scan_code_data AS value),
  'rpcs', COALESCE((SELECT jsonb_agg(to_jsonb(value) ORDER BY name) FROM rpc_contract AS value), '[]'::JSONB),
  'identity_guard', COALESCE((SELECT to_jsonb(value) FROM identity_guard AS value), 'null'::JSONB),
  'b2b_analytics_unchanged_by_scan_codes', COALESCE((SELECT definition NOT ILIKE '%commercial_delivery_units%' AND definition NOT ILIKE '%scan_code%' FROM b2b_analytics), false),
  'commercial_delivery_units_rls_enabled', COALESCE((SELECT enabled FROM label_table_rls), false)
) AS commercial_delivery_scan_code_verification;
