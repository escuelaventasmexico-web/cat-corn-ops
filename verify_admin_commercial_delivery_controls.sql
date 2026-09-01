-- Read-only verification for administrator delivery controls.
-- Run after 20260904_admin_commercial_delivery_controls.sql.
-- Returns exactly one JSONB object and never creates or changes data.

WITH expected_rpcs(name, arguments) AS (
  VALUES
    ('admin_force_release_commercial_delivery'::TEXT, 'p_source_type text, p_source_id uuid, p_reason text'),
    ('admin_cancel_commercial_delivery', 'p_source_type text, p_source_id uuid, p_reason text')
), admin_rpc_contract AS (
  SELECT expected.name, expected.arguments, procedure.oid,
    pg_get_function_identity_arguments(procedure.oid) AS actual_arguments,
    pg_get_functiondef(procedure.oid) AS definition,
    procedure.oid IS NOT NULL
      AND pg_get_function_identity_arguments(procedure.oid) = expected.arguments
      AND procedure.prosecdef
      AND COALESCE(array_to_string(procedure.proconfig, ','), '') ILIKE '%search_path=public, pg_temp%'
      AND has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      AND NOT has_function_privilege('public', procedure.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', procedure.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      AND pg_get_functiondef(procedure.oid) ILIKE '%_commercial_delivery_actor(v_partner, true)%'
      AND pg_get_functiondef(procedure.oid) ILIKE '%char_length(v_reason) < 10%'
      AND pg_get_functiondef(procedure.oid) NOT ILIKE '%delete from%'
      AND pg_get_functiondef(procedure.oid) NOT ILIKE '%delete %'
      AS matches
  FROM expected_rpcs AS expected
  LEFT JOIN pg_namespace AS namespace ON namespace.nspname = 'public'
  LEFT JOIN pg_proc AS procedure
    ON procedure.pronamespace = namespace.oid AND procedure.proname = expected.name
), force_release_contract AS (
  SELECT COUNT(*) = 1 AND COALESCE(BOOL_AND(
    definition ILIKE '%status = ''released''%'
    AND definition ILIKE '%released_at = v_now%'
    AND definition ILIKE '%released_by = v_actor%'
    AND definition ILIKE '%status = ''completed''%'
    AND definition ILIKE '%order_status = ''delivered''%'
    AND definition ILIKE '%payment_due_at = v_now + make_interval%'
    AND definition ILIKE '%print_count <= 0%'
    AND definition ILIKE '%admin_delivery_force_released%'
    AND definition ILIKE '%previously_scanned_units%'
    AND definition ILIKE '%bypassed_units%'
  ), false) AS valid
  FROM admin_rpc_contract
  WHERE name = 'admin_force_release_commercial_delivery'
), cancellation_contract AS (
  SELECT COUNT(*) = 1 AND COALESCE(BOOL_AND(
    definition ILIKE '%status = ''cancelled''%'
    AND definition ILIKE '%order_status = ''cancelled''%'
    AND definition ILIKE '%status = ''voided''%'
    AND definition ILIKE '%voided_at = v_now%'
    AND definition ILIKE '%voided_by = v_actor%'
    AND definition ILIKE '%void_reason = v_reason%'
    AND definition ILIKE '%commercial_partner_payments%'
    AND definition ILIKE '%wholesale_payments%'
    AND definition ILIKE '%admin_delivery_cancelled%'
  ), false) AS valid
  FROM admin_rpc_contract
  WHERE name = 'admin_cancel_commercial_delivery'
), audit_contract AS (
  SELECT COUNT(*) = 1 AND COALESCE(BOOL_AND(
    procedure.prosecdef
    AND COALESCE(array_to_string(procedure.proconfig, ','), '') ILIKE '%search_path=public, pg_temp%'
    AND NOT has_function_privilege('public', procedure.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', procedure.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  ), false) AS private
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = '_commercial_delivery_audit'
    AND pg_get_function_identity_arguments(procedure.oid) = 'p_event text, p_partner uuid, p_movement uuid, p_order uuid, p_unit uuid, p_reason text, p_metadata jsonb'
), audit_event_contract AS (
  SELECT COALESCE(BOOL_OR(
    constraint.conrelid = 'public.commercial_delivery_audit_events'::REGCLASS
    AND pg_get_constraintdef(constraint.oid, true) ILIKE '%admin_delivery_force_released%'
    AND pg_get_constraintdef(constraint.oid, true) ILIKE '%admin_delivery_cancelled%'
  ), false) AS events_supported
  FROM pg_constraint AS constraint
  WHERE constraint.conrelid = 'public.commercial_delivery_audit_events'::REGCLASS
), void_reason_column AS (
  SELECT COUNT(*) = 1 AND COALESCE(BOOL_AND(
    attribute.attname = 'void_reason'
    AND format_type(attribute.atttypid, attribute.atttypmod) = 'text'
  ), false) AS exists
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.commercial_delivery_units'::REGCLASS
    AND attribute.attname = 'void_reason'
    AND attribute.attnum > 0 AND NOT attribute.attisdropped
), unit_guard_contract AS (
  SELECT COUNT(*) = 1 AND COALESCE(BOOL_AND(
    pg_get_functiondef(procedure.oid) ILIKE '%old.status = ''scanned'' and new.status = ''released''%'
    AND pg_get_functiondef(procedure.oid) ILIKE '%_commercial_delivery_units_ready_for_release%'
    AND pg_get_functiondef(procedure.oid) ILIKE '%old.status in (''generated'', ''printed'', ''scanned'') and new.status = ''released''%'
    AND pg_get_functiondef(procedure.oid) ILIKE '%v_admin%'
    AND pg_get_functiondef(procedure.oid) ILIKE '%new.void_reason%'
  ), false) AS valid
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = '_commercial_delivery_unit_guard'
    AND pg_get_function_identity_arguments(procedure.oid) = ''
), source_cancel_guard_contract AS (
  SELECT COUNT(*) = 2 AND COALESCE(BOOL_AND(
    (procedure.proname = '_commercial_delivery_comodato_source_guard'
      AND pg_get_functiondef(procedure.oid) ILIKE '%commercial_partner_payments%'
      AND pg_get_functiondef(procedure.oid) ILIKE '%quantity_sold%')
    OR (procedure.proname = '_commercial_delivery_wholesale_source_guard'
      AND pg_get_functiondef(procedure.oid) ILIKE '%wholesale_payments%')
  ), false) AS valid
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname IN ('_commercial_delivery_comodato_source_guard', '_commercial_delivery_wholesale_source_guard')
    AND pg_get_function_identity_arguments(procedure.oid) = ''
), direct_unit_writes_denied AS (
  SELECT c.relrowsecurity AS rls_enabled,
    EXISTS (
      SELECT 1 FROM pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = 'commercial_delivery_units'
        AND policy.cmd = 'ALL'
        AND policy.roles @> ARRAY['authenticated']::NAME[]
        AND COALESCE(policy.qual, '') ILIKE '%false%'
        AND COALESCE(policy.with_check, '') ILIKE '%false%'
    ) AS denied
  FROM pg_class AS c
  WHERE c.oid = 'public.commercial_delivery_units'::REGCLASS
), released_delivery_violations AS (
  SELECT unit.source_type, COALESCE(unit.movement_id, unit.wholesale_order_id) AS source_id,
    jsonb_agg(jsonb_build_object('id', unit.id, 'status', unit.status, 'scan_code', unit.scan_code)) AS invalid_units
  FROM public.commercial_delivery_units AS unit
  LEFT JOIN public.commercial_partner_movements AS movement
    ON unit.source_type = 'comodato' AND movement.id = unit.movement_id
  LEFT JOIN public.wholesale_orders AS orders
    ON unit.source_type = 'mayoreo' AND orders.id = unit.wholesale_order_id
  WHERE (movement.status = 'completed' OR orders.order_status IN ('delivered', 'completed'))
    AND (
      unit.status IN ('generated', 'printed', 'scanned', 'voided')
      OR (unit.status = 'replaced' AND (
        unit.replaced_by_unit_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.commercial_delivery_units AS successor
          WHERE successor.id = unit.replaced_by_unit_id AND successor.status = 'released'
        )
      ))
    )
  GROUP BY unit.source_type, COALESCE(unit.movement_id, unit.wholesale_order_id)
), b2b_analytics AS (
  SELECT pg_get_functiondef(procedure.oid) AS definition
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public' AND procedure.proname = 'get_b2b_product_analytics'
)
SELECT jsonb_build_object(
  'all_checks_passed',
    (SELECT COUNT(*) = 2 AND BOOL_AND(matches) FROM admin_rpc_contract)
    AND (SELECT valid FROM force_release_contract)
    AND (SELECT valid FROM cancellation_contract)
    AND (SELECT private FROM audit_contract)
    AND (SELECT events_supported FROM audit_event_contract)
    AND (SELECT exists FROM void_reason_column)
    AND (SELECT valid FROM unit_guard_contract)
    AND (SELECT valid FROM source_cancel_guard_contract)
    AND (SELECT rls_enabled AND denied FROM direct_unit_writes_denied)
    AND (SELECT COUNT(*) = 0 FROM released_delivery_violations)
    AND (SELECT COUNT(*) = 1 AND definition NOT ILIKE '%commercial_delivery_units%' AND definition NOT ILIKE '%admin_force_release_commercial_delivery%' AND definition NOT ILIKE '%admin_cancel_commercial_delivery%' FROM b2b_analytics),
  'admin_rpcs', COALESCE((SELECT jsonb_agg(to_jsonb(contract) - 'definition' ORDER BY name) FROM admin_rpc_contract AS contract), '[]'::JSONB),
  'force_release_contract', COALESCE((SELECT to_jsonb(contract) FROM force_release_contract AS contract), 'null'::JSONB),
  'cancellation_contract', COALESCE((SELECT to_jsonb(contract) FROM cancellation_contract AS contract), 'null'::JSONB),
  'audit_private', COALESCE((SELECT private FROM audit_contract), false),
  'audit_events_supported', (SELECT events_supported FROM audit_event_contract),
  'void_reason_column_present', (SELECT exists FROM void_reason_column),
  'unit_guard_contract', COALESCE((SELECT to_jsonb(contract) FROM unit_guard_contract AS contract), 'null'::JSONB),
  'source_cancel_guard_contract', COALESCE((SELECT to_jsonb(contract) FROM source_cancel_guard_contract AS contract), 'null'::JSONB),
  'direct_unit_writes_denied', COALESCE((SELECT to_jsonb(contract) FROM direct_unit_writes_denied AS contract), 'null'::JSONB),
  'released_delivery_violations', COALESCE((SELECT jsonb_agg(to_jsonb(violation) ORDER BY source_type, source_id) FROM released_delivery_violations AS violation), '[]'::JSONB),
  'get_b2b_product_analytics_unchanged', COALESCE((SELECT definition NOT ILIKE '%commercial_delivery_units%' AND definition NOT ILIKE '%admin_force_release_commercial_delivery%' AND definition NOT ILIKE '%admin_cancel_commercial_delivery%' FROM b2b_analytics), false)
) AS admin_commercial_delivery_controls_verification;
