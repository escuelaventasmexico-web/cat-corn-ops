-- Read-only verifier for global Comodato spoilage by scanned label.
-- Run after 20260919_global_partner_spoilage_by_barcode.sql.
-- Returns exactly one JSONB document.

WITH objects AS (
  SELECT
    to_regprocedure('public.resolve_commercial_delivery_unit_by_barcode(text)') IS NOT NULL AS resolver_exists,
    to_regprocedure('public.register_global_partner_spoilage_by_barcode(text,text)') IS NOT NULL AS registrar_exists,
    to_regprocedure('public.register_partner_spoilage_by_barcode(text,uuid,text)') IS NOT NULL AS legacy_partner_registrar_preserved,
    to_regprocedure('public.register_partner_spoilage_historical_exception(uuid,jsonb,integer,text,date)') IS NOT NULL AS historical_exception_preserved,
    to_regprocedure('public._commercial_delivery_audit(text,uuid,uuid,uuid,uuid,text,jsonb)') IS NOT NULL AS audit_helper_exists
),
function_facts AS (
  SELECT
    COUNT(*) FILTER (WHERE proc.proname = 'resolve_commercial_delivery_unit_by_barcode') = 1 AS resolver_has_no_overload,
    COUNT(*) FILTER (WHERE proc.proname = 'register_global_partner_spoilage_by_barcode') = 1 AS registrar_has_no_overload,
    BOOL_AND(pg_get_function_identity_arguments(proc.oid) = 'p_barcode text')
      FILTER (WHERE proc.proname = 'resolve_commercial_delivery_unit_by_barcode') AS resolver_signature,
    BOOL_AND(pg_get_function_identity_arguments(proc.oid) = 'p_barcode text, p_reason text')
      FILTER (WHERE proc.proname = 'register_global_partner_spoilage_by_barcode') AS registrar_signature,
    BOOL_AND(proc.prosecdef AND COALESCE(proc.proconfig, ARRAY[]::TEXT[]) @> ARRAY['search_path=public, pg_temp'])
      FILTER (WHERE proc.proname IN ('resolve_commercial_delivery_unit_by_barcode', 'register_global_partner_spoilage_by_barcode')) AS secure_definer_and_path,
    BOOL_AND(NOT has_function_privilege('public', proc.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', proc.oid, 'EXECUTE'))
      FILTER (WHERE proc.proname IN ('resolve_commercial_delivery_unit_by_barcode', 'register_global_partner_spoilage_by_barcode')) AS restricted_execute,
    BOOL_AND(
      POSITION('scan_code' IN LOWER(pg_get_functiondef(proc.oid))) > 0
      AND POSITION('_commercial_delivery_actor(v_unit.partner_id)' IN LOWER(pg_get_functiondef(proc.oid))) > 0
      AND POSITION('p_partner_id' IN LOWER(pg_get_functiondef(proc.oid))) = 0
    ) FILTER (WHERE proc.proname IN ('resolve_commercial_delivery_unit_by_barcode', 'register_global_partner_spoilage_by_barcode')) AS derives_partner_from_scanned_unit,
    BOOL_AND(
      POSITION('for update' IN LOWER(pg_get_functiondef(proc.oid))) > 0
      AND POSITION('v_unit.status <> ''released''' IN LOWER(pg_get_functiondef(proc.oid))) > 0
      AND POSITION('v_unit.source_type = ''mayoreo''' IN LOWER(pg_get_functiondef(proc.oid))) > 0
      AND POSITION('v_unit.spoilage_movement_id is not null' IN LOWER(pg_get_functiondef(proc.oid))) > 0
      AND POSITION('status = ''spoiled''' IN LOWER(pg_get_functiondef(proc.oid))) > 0
      AND POSITION('_commercial_delivery_audit' IN LOWER(pg_get_functiondef(proc.oid))) > 0
    ) FILTER (WHERE proc.proname = 'register_global_partner_spoilage_by_barcode') AS registrar_has_concurrency_state_and_audit_guards,
    BOOL_AND(
      POSITION('partner_name' IN LOWER(pg_get_functiondef(proc.oid))) > 0
      AND POSITION('partner_folio' IN LOWER(pg_get_functiondef(proc.oid))) > 0
      AND POSITION('product_variant' IN LOWER(pg_get_functiondef(proc.oid))) > 0
      AND POSITION('released_at' IN LOWER(pg_get_functiondef(proc.oid))) > 0
      AND POSITION('generated_at' IN LOWER(pg_get_functiondef(proc.oid))) > 0
    ) FILTER (WHERE proc.proname = 'resolve_commercial_delivery_unit_by_barcode') AS resolver_returns_label_snapshot,
    BOOL_AND(
      POSITION('historical_unlabelled_spoilage' IN LOWER(pg_get_functiondef(proc.oid))) > 0
    ) FILTER (WHERE proc.proname = 'register_partner_spoilage_historical_exception') AS historical_exception_contract_preserved
  FROM pg_proc AS proc
  JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname IN (
      'resolve_commercial_delivery_unit_by_barcode',
      'register_global_partner_spoilage_by_barcode',
      'register_partner_spoilage_historical_exception'
    )
),
table_facts AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint
      WHERE constraint.conrelid = 'public.commercial_delivery_units'::REGCLASS
        AND constraint.conname = 'commercial_delivery_units_scan_code_key'
        AND constraint.contype = 'u'
    ) AS scan_code_is_unique,
    EXISTS (
      SELECT 1 FROM pg_trigger AS trigger
      WHERE trigger.tgrelid = 'public.commercial_delivery_units'::REGCLASS
        AND trigger.tgname = 'commercial_delivery_unit_guard'
        AND NOT trigger.tgisinternal
    ) AS delivery_unit_guard_exists,
    EXISTS (
      SELECT 1 FROM pg_proc AS proc
      WHERE proc.oid = 'public._commercial_delivery_unit_guard()'::REGPROCEDURE
        AND POSITION('old.status = ''released'' and new.status = ''spoiled''' IN LOWER(pg_get_functiondef(proc.oid))) > 0
        AND POSITION('new.spoilage_movement_id is not null' IN LOWER(pg_get_functiondef(proc.oid))) > 0
    ) AS released_to_spoiled_transition_guarded,
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint
      WHERE constraint.conrelid = 'public.commercial_delivery_audit_events'::REGCLASS
        AND constraint.conname = 'commercial_delivery_audit_events_event_type_check'
        AND pg_get_constraintdef(constraint.oid, true) ILIKE '%spoiled%'
    ) AS spoiled_audit_event_allowed
),
data_facts AS (
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM public.commercial_delivery_units AS unit
      WHERE unit.status = 'spoiled'
        AND unit.spoilage_movement_id IS NULL
    ) AS every_spoiled_unit_has_one_movement,
    NOT EXISTS (
      SELECT 1
      FROM public.commercial_delivery_audit_events AS audit
      WHERE audit.event_type = 'spoiled'
        AND audit.delivery_unit_id IS NOT NULL
      GROUP BY audit.delivery_unit_id
      HAVING COUNT(*) > 1
    ) AS no_delivery_unit_has_multiple_spoilage_audits
)
SELECT jsonb_build_object(
  'resolver_exists', objects.resolver_exists,
  'registrar_exists', objects.registrar_exists,
  'legacy_partner_registrar_preserved', objects.legacy_partner_registrar_preserved,
  'historical_exception_preserved', objects.historical_exception_preserved,
  'audit_helper_exists', objects.audit_helper_exists,
  'resolver_has_no_overload', COALESCE(function_facts.resolver_has_no_overload, false),
  'registrar_has_no_overload', COALESCE(function_facts.registrar_has_no_overload, false),
  'resolver_signature', COALESCE(function_facts.resolver_signature, false),
  'registrar_signature', COALESCE(function_facts.registrar_signature, false),
  'secure_definer_and_path', COALESCE(function_facts.secure_definer_and_path, false),
  'restricted_execute', COALESCE(function_facts.restricted_execute, false),
  'derives_partner_from_scanned_unit', COALESCE(function_facts.derives_partner_from_scanned_unit, false),
  'registrar_has_concurrency_state_and_audit_guards', COALESCE(function_facts.registrar_has_concurrency_state_and_audit_guards, false),
  'resolver_returns_label_snapshot', COALESCE(function_facts.resolver_returns_label_snapshot, false),
  'historical_exception_contract_preserved', COALESCE(function_facts.historical_exception_contract_preserved, false),
  'scan_code_is_unique', table_facts.scan_code_is_unique,
  'delivery_unit_guard_exists', table_facts.delivery_unit_guard_exists,
  'released_to_spoiled_transition_guarded', table_facts.released_to_spoiled_transition_guarded,
  'spoiled_audit_event_allowed', table_facts.spoiled_audit_event_allowed,
  'every_spoiled_unit_has_one_movement', data_facts.every_spoiled_unit_has_one_movement,
  'no_delivery_unit_has_multiple_spoilage_audits', data_facts.no_delivery_unit_has_multiple_spoilage_audits,
  'all_checks_passed',
    objects.resolver_exists
    AND objects.registrar_exists
    AND objects.legacy_partner_registrar_preserved
    AND objects.historical_exception_preserved
    AND objects.audit_helper_exists
    AND COALESCE(function_facts.resolver_has_no_overload, false)
    AND COALESCE(function_facts.registrar_has_no_overload, false)
    AND COALESCE(function_facts.resolver_signature, false)
    AND COALESCE(function_facts.registrar_signature, false)
    AND COALESCE(function_facts.secure_definer_and_path, false)
    AND COALESCE(function_facts.restricted_execute, false)
    AND COALESCE(function_facts.derives_partner_from_scanned_unit, false)
    AND COALESCE(function_facts.registrar_has_concurrency_state_and_audit_guards, false)
    AND COALESCE(function_facts.resolver_returns_label_snapshot, false)
    AND COALESCE(function_facts.historical_exception_contract_preserved, false)
    AND table_facts.scan_code_is_unique
    AND table_facts.delivery_unit_guard_exists
    AND table_facts.released_to_spoiled_transition_guarded
    AND table_facts.spoiled_audit_event_allowed
    AND data_facts.every_spoiled_unit_has_one_movement
    AND data_facts.no_delivery_unit_has_multiple_spoilage_audits
) AS verification
FROM objects
CROSS JOIN function_facts
CROSS JOIN table_facts
CROSS JOIN data_facts;
