-- Read-only verification for 20261003_fix_pending_payment_admin_permissions.sql.
-- Run before manually reviewing COBRO-202610-00095 and COBRO-202610-00096.

BEGIN;
SET TRANSACTION READ ONLY;

WITH admin_rpc_rows AS MATERIALIZED (
  SELECT
    proc_row.oid,
    proc_row.pronargs,
    proc_row.proretset,
    proc_row.prorettype,
    proc_row.prosecdef,
    proc_row.provolatile,
    proc_row.proconfig,
    LOWER(pg_get_functiondef(proc_row.oid)) AS definition,
    NOT EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(proc_row.proacl, acldefault('f', proc_row.proowner))) AS acl_row
      WHERE acl_row.grantee = 0
        AND acl_row.privilege_type = 'EXECUTE'
    ) AS public_execute_revoked,
    NOT has_function_privilege('anon', proc_row.oid, 'EXECUTE') AS anon_execute_revoked,
    has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
      AS authenticated_can_execute
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.proname = 'get_pending_payment_verifications_admin'
), admin_rpc_facts AS (
  SELECT
    COUNT(*) = 1 AS exactly_one_rpc,
    COALESCE(BOOL_AND(
      rpc.pronargs = 0
      AND rpc.proretset
      AND rpc.prorettype = 'public.v_pending_payment_verifications'::REGTYPE
    ), FALSE) AS exact_signature_and_return_contract,
    COALESCE(BOOL_AND(
      rpc.prosecdef
      AND rpc.provolatile = 's'
      AND COALESCE(rpc.proconfig, ARRAY[]::TEXT[])
        @> ARRAY['search_path=public, pg_temp']
    ), FALSE) AS security_definer_with_safe_search_path,
    COALESCE(BOOL_AND(
      POSITION('auth.uid()' IN rpc.definition) > 0
      AND POSITION('from public.user_profiles' IN rpc.definition) > 0
      AND POSITION('profile.id = v_actor' IN rpc.definition) > 0
      AND POSITION('profile.role = ''admin''' IN rpc.definition) > 0
      AND POSITION('profile.is_active = true' IN rpc.definition) > 0
      AND POSITION('if not found' IN rpc.definition) > 0
    ), FALSE) AS validates_active_admin,
    COALESCE(BOOL_AND(
      POSITION('from public.v_pending_payment_verifications' IN rpc.definition) > 0
      AND POSITION('order by pending.submitted_at desc' IN rpc.definition) > 0
    ), FALSE) AS reads_view_in_expected_order,
    COALESCE(BOOL_AND(
      rpc.public_execute_revoked
      AND rpc.anon_execute_revoked
      AND rpc.authenticated_can_execute
    ), FALSE) AS execute_contract_is_exact
  FROM admin_rpc_rows AS rpc
), restricted_function_rows AS MATERIALIZED (
  SELECT
    proc_row.oid,
    proc_row.proname,
    proc_row.prosecdef,
    NOT EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(proc_row.proacl, acldefault('f', proc_row.proowner))) AS acl_row
      WHERE acl_row.grantee = 0
        AND acl_row.privilege_type = 'EXECUTE'
    ) AS public_execute_revoked,
    NOT has_function_privilege('anon', proc_row.oid, 'EXECUTE') AS anon_execute_revoked,
    NOT has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
      AS authenticated_execute_revoked
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.proname IN (
      '_restricted_get_comodato_movement_pending_balance',
      '_restricted_get_partner_comodato_pending_balance',
      '_restricted_get_wholesale_order_pending_balance'
    )
), restricted_function_facts AS (
  SELECT
    COUNT(*) = 3
      AND COUNT(DISTINCT proname) = 3 AS all_three_functions_exist_once,
    COALESCE(BOOL_AND(prosecdef), FALSE) AS all_remain_security_definer,
    COALESCE(BOOL_AND(
      public_execute_revoked
      AND anon_execute_revoked
      AND authenticated_execute_revoked
    ), FALSE) AS all_execute_privileges_remain_revoked,
    COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
      'function', proname,
      'security_definer', prosecdef,
      'public_execute_revoked', public_execute_revoked,
      'anon_execute_revoked', anon_execute_revoked,
      'authenticated_execute_revoked', authenticated_execute_revoked
    ) ORDER BY proname), '[]'::JSONB) AS evidence
  FROM restricted_function_rows
), pending_view_facts AS (
  SELECT
    COUNT(*) = 1 AS exists_once,
    COALESCE(BOOL_AND(
      COALESCE(class_row.reloptions, ARRAY[]::TEXT[])
        @> ARRAY['security_invoker=true']
    ), FALSE) AS remains_security_invoker
  FROM pg_class AS class_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = class_row.relnamespace
  WHERE namespace_row.nspname = 'public'
    AND class_row.relname = 'v_pending_payment_verifications'
    AND class_row.relkind = 'v'
), commission_trigger_facts AS (
  SELECT
    COUNT(*) FILTER (
      WHERE trigger_row.tgname = 'trg_sync_comodato_payment'
    ) = 1 AS canonical_trigger_exists_once,
    COUNT(*) FILTER (
      WHERE LOWER(pg_get_functiondef(trigger_function.oid))
        LIKE '%sync_comodato_commissions_for_movement%'
    ) = 1 AS commission_sync_still_has_one_trigger,
    COUNT(*) FILTER (
      WHERE LOWER(pg_get_functiondef(trigger_function.oid))
        LIKE '%get_pending_payment_verifications_admin%'
    ) = 0 AS admin_read_rpc_is_not_used_by_a_trigger
  FROM pg_trigger AS trigger_row
  JOIN pg_proc AS trigger_function
    ON trigger_function.oid = trigger_row.tgfoid
  WHERE trigger_row.tgrelid = 'public.commercial_partner_payments'::REGCLASS
    AND NOT trigger_row.tgisinternal
), expected_requests(request_id, folio, partner_id, movement_id, amount) AS (
  VALUES
    (
      '6cf98121-6628-4e96-b45c-85b328f44b0c'::UUID,
      'COBRO-202610-00095'::TEXT,
      'c22b0aa5-f68b-4080-b1ec-84d69007426c'::UUID,
      'c228d94e-d9fa-433e-89ad-5e5347754c5a'::UUID,
      240.00::NUMERIC
    ),
    (
      '45b3ad8c-4e26-4e75-bb22-3c581cb46ef4'::UUID,
      'COBRO-202610-00096'::TEXT,
      '7bb10276-6a2d-47a4-9098-4f727006d752'::UUID,
      '0bebbbe0-8248-4839-9ae1-277527549ab3'::UUID,
      150.00::NUMERIC
    )
), expected_request_state AS MATERIALIZED (
  SELECT
    expected.request_id,
    expected.folio,
    request.status,
    request.approved_payment_id,
    (
      SELECT COUNT(*)
      FROM public.commercial_partner_payments AS payment
      WHERE payment.partner_id = expected.partner_id
        AND payment.movement_id = expected.movement_id
        AND payment.amount = expected.amount
        AND LOWER(BTRIM(payment.status)) IN ('completed', 'paid')
    ) AS matching_completed_payments
  FROM expected_requests AS expected
  LEFT JOIN public.partner_payment_verification_requests AS request
    ON request.id = expected.request_id
   AND request.folio = expected.folio
   AND request.partner_id = expected.partner_id
   AND request.movement_id = expected.movement_id
   AND request.amount = expected.amount
), known_request_facts AS (
  SELECT
    COUNT(*) FILTER (WHERE status IS NOT NULL) = 2 AS both_requests_exist,
    COALESCE(BOOL_AND(
      status = 'pending_review'
      AND approved_payment_id IS NULL
    ), FALSE) AS both_remain_unapproved,
    COALESCE(BOOL_AND(matching_completed_payments = 0), FALSE)
      AS neither_has_a_completed_duplicate,
    COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
      'request_id', request_id,
      'folio', folio,
      'status', status,
      'approved_payment_id', approved_payment_id,
      'matching_completed_payments', matching_completed_payments
    ) ORDER BY folio), '[]'::JSONB) AS evidence
  FROM expected_request_state
), checks AS (
  SELECT JSONB_BUILD_OBJECT(
    'admin_rpc_exists_once', rpc.exactly_one_rpc,
    'admin_rpc_has_exact_no_arg_setof_view_contract', rpc.exact_signature_and_return_contract,
    'admin_rpc_is_stable_security_definer_with_safe_search_path',
      rpc.security_definer_with_safe_search_path,
    'admin_rpc_validates_authenticated_active_admin', rpc.validates_active_admin,
    'admin_rpc_reads_pending_view_in_descending_order', rpc.reads_view_in_expected_order,
    'admin_rpc_execute_is_public_false_anon_false_authenticated_true',
      rpc.execute_contract_is_exact,
    'all_restricted_balance_functions_exist_once', restricted.all_three_functions_exist_once,
    'all_restricted_balance_functions_remain_security_definer',
      restricted.all_remain_security_definer,
    'restricted_balance_functions_remain_unexecutable_by_public_anon_authenticated',
      restricted.all_execute_privileges_remain_revoked,
    'pending_view_exists_once', pending.exists_once,
    'pending_view_remains_security_invoker', pending.remains_security_invoker,
    'canonical_commission_trigger_exists_once', trigger_fact.canonical_trigger_exists_once,
    'commission_sync_still_has_exactly_one_trigger',
      trigger_fact.commission_sync_still_has_one_trigger,
    'admin_read_rpc_is_not_used_by_a_trigger',
      trigger_fact.admin_read_rpc_is_not_used_by_a_trigger,
    'both_known_requests_exist', known.both_requests_exist,
    'both_known_requests_remain_pending_and_unapproved', known.both_remain_unapproved,
    'neither_known_request_has_a_completed_duplicate',
      known.neither_has_a_completed_duplicate
  ) AS value,
  restricted.evidence AS restricted_function_evidence,
  known.evidence AS known_request_evidence
  FROM admin_rpc_facts AS rpc
  CROSS JOIN restricted_function_facts AS restricted
  CROSS JOIN pending_view_facts AS pending
  CROSS JOIN commission_trigger_facts AS trigger_fact
  CROSS JOIN known_request_facts AS known
)
SELECT JSONB_BUILD_OBJECT(
  'verification', '20261003_pending_payment_admin_permissions',
  'read_only', TRUE,
  'all_checks_passed', NOT EXISTS (
    SELECT 1
    FROM JSONB_EACH(checks.value) AS check_row
    WHERE check_row.value <> 'true'::JSONB
  ),
  'checks', checks.value,
  'restricted_function_evidence', checks.restricted_function_evidence,
  'known_request_evidence', checks.known_request_evidence
) AS result
FROM checks;

ROLLBACK;
