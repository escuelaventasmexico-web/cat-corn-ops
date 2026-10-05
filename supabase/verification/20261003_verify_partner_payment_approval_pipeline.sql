-- Read-only verification for 20261003_fix_partner_payment_approval_pipeline.sql.
-- Run before manually approving COBRO-202610-00095 and COBRO-202610-00096.

BEGIN;
SET TRANSACTION READ ONLY;

WITH expected_rpc AS (
  SELECT
    'p_request_id uuid, p_partner_id uuid, p_movement_id uuid, p_payment_date timestamp with time zone, p_amount numeric, p_payment_method text, p_payment_reference text, p_notes text, p_proof_path text, p_proof_file_name text, p_proof_mime_type text, p_proof_size_bytes bigint'::TEXT
      AS identity_arguments
), admin_rpc_rows AS MATERIALIZED (
  SELECT
    proc_row.oid,
    proc_row.prosecdef,
    proc_row.proconfig,
    pg_get_function_identity_arguments(proc_row.oid) AS identity_arguments,
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
    AND proc_row.proname = 'admin_create_approved_comodato_payment'
), admin_rpc_facts AS (
  SELECT
    COUNT(*) = 1 AS exactly_one_rpc,
    COALESCE(BOOL_AND(
      rpc.identity_arguments = expected.identity_arguments
    ), FALSE) AS exact_signature,
    COALESCE(BOOL_AND(
      rpc.prosecdef
      AND COALESCE(rpc.proconfig, ARRAY[]::TEXT[])
        @> ARRAY['search_path=public, pg_temp']
    ), FALSE) AS security_definer_with_safe_search_path,
    COALESCE(BOOL_AND(
      rpc.public_execute_revoked
      AND rpc.anon_execute_revoked
      AND rpc.authenticated_can_execute
    ), FALSE) AS execute_is_restricted,
    COALESCE(BOOL_AND(
      POSITION('auth.uid()' IN rpc.definition) > 0
      AND POSITION('role is distinct from ''admin''' IN rpc.definition) > 0
      AND POSITION('is_active' IN rpc.definition) > 0
      AND POSITION('only active administrators' IN rpc.definition) > 0
    ), FALSE) AS validates_active_admin,
    COALESCE(BOOL_AND(
      POSITION('for update' IN rpc.definition) > 0
      AND POSITION('pg_advisory_xact_lock' IN rpc.definition) > 0
      AND POSITION('get_comodato_movement_pending_balance' IN rpc.definition) > 0
      AND POSITION('completed settlement' IN rpc.definition) > 0
      AND POSITION('p_amount <= 0' IN rpc.definition) > 0
      AND POSITION('exceeds current effective balance' IN rpc.definition) > 0
    ), FALSE) AS locks_and_uses_effective_balance,
    COALESCE(BOOL_AND(
      (
        SELECT COUNT(*)
        FROM regexp_matches(
          rpc.definition,
          'insert[[:space:]]+into[[:space:]]+public\.commercial_partner_payments',
          'g'
        )
      ) = 1
    ), FALSE) AS inserts_exactly_one_payment_statement,
    COALESCE(BOOL_AND(
      POSITION('insert into public.partner_payment_verification_requests' IN rpc.definition) > 0
      AND POSITION('''approved''' IN rpc.definition) > 0
      AND POSITION('submitted_by' IN rpc.definition) > 0
      AND POSITION('reviewed_by' IN rpc.definition) > 0
      AND POSITION('submitted_at' IN rpc.definition) > 0
      AND POSITION('reviewed_at' IN rpc.definition) > 0
      AND POSITION('approved_payment_id' IN rpc.definition) > 0
    ), FALSE) AS writes_approved_audit_and_payment_link,
    COALESCE(BOOL_AND(
      POSITION('where request.id = p_request_id' IN rpc.definition) > 0
      AND POSITION('request_id is required as the idempotency key' IN rpc.definition) > 0
      AND POSITION('v_existing_request.status is distinct from ''approved''' IN rpc.definition) > 0
      AND POSITION('return query' IN rpc.definition) > 0
    ), FALSE) AS request_uuid_is_idempotency_key,
    COALESCE(BOOL_AND(
      POSITION('draft' IN rpc.definition) > 0
      AND POSITION('pending_review' IN rpc.definition) > 0
      AND POSITION('active payment verification request' IN rpc.definition) > 0
    ), FALSE) AS blocks_incompatible_active_requests,
    COALESCE(BOOL_AND(
      POSITION('sync_comodato_commissions_for_movement' IN rpc.definition) = 0
    ), FALSE) AS relies_on_trigger_without_manual_sync,
    COALESCE(BOOL_AND(
      POSITION('6cf98121-6628-4e96-b45c-85b328f44b0c' IN rpc.definition) = 0
      AND POSITION('45b3ad8c-4e26-4e75-bb22-3c581cb46ef4' IN rpc.definition) = 0
    ), FALSE) AS does_not_target_existing_requests
  FROM admin_rpc_rows AS rpc
  CROSS JOIN expected_rpc AS expected
), trigger_rows AS MATERIALIZED (
  SELECT
    trigger_row.tgname,
    LOWER(pg_get_triggerdef(trigger_row.oid, TRUE)) AS definition,
    LOWER(pg_get_functiondef(trigger_function.oid)) AS function_definition
  FROM pg_trigger AS trigger_row
  JOIN pg_proc AS trigger_function
    ON trigger_function.oid = trigger_row.tgfoid
  WHERE trigger_row.tgrelid = 'public.commercial_partner_payments'::REGCLASS
    AND NOT trigger_row.tgisinternal
), trigger_facts AS (
  SELECT
    COUNT(*) FILTER (WHERE tgname = 'trg_sync_comodato_payment') = 1
      AS canonical_trigger_exists_once,
    COUNT(*) FILTER (
      WHERE function_definition LIKE '%sync_comodato_commissions_for_movement%'
    ) = 1 AS exactly_one_commission_sync_trigger,
    COALESCE(BOOL_AND(
      definition LIKE '%after%'
      AND definition LIKE '%insert%'
      AND definition LIKE '%update%'
      AND definition LIKE '%delete%'
      AND function_definition LIKE '%sync_comodato_commissions_for_movement%'
    ) FILTER (WHERE tgname = 'trg_sync_comodato_payment'), FALSE)
      AS canonical_trigger_has_expected_contract
  FROM trigger_rows
), approval_rpc AS (
  SELECT LOWER(pg_get_functiondef(proc_row.oid)) AS definition
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.proname = 'approve_partner_payment_verification_request'
  ORDER BY pg_get_function_identity_arguments(proc_row.oid)
  LIMIT 1
), approval_facts AS (
  SELECT COALESCE(BOOL_AND(
    POSITION('status = ''approved''' IN definition) > 0
    AND POSITION('approved_payment_id is not null' IN definition) > 0
    AND POSITION('return query' IN definition) > 0
    AND POSITION('status = ''approved''' IN definition)
      < POSITION('insert into public.commercial_partner_payments' IN definition)
  ), FALSE) AS existing_approval_remains_idempotent
  FROM approval_rpc
), pending_view_facts AS (
  SELECT
    COUNT(*) = 1 AS pending_view_exists_once,
    COALESCE(BOOL_AND(
      LOWER(view_row.definition) LIKE '%partner_payment_verification_requests%'
      AND LOWER(view_row.definition) LIKE '%pending_review%'
    ), FALSE) AS pending_view_uses_canonical_pending_requests
  FROM pg_views AS view_row
  WHERE view_row.schemaname = 'public'
    AND view_row.viewname = 'v_pending_payment_verifications'
), frontend_pending_rpc_rows AS MATERIALIZED (
  SELECT
    proc_row.oid,
    proc_row.pronargs,
    proc_row.proretset,
    proc_row.prorettype,
    proc_row.prosecdef,
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
), frontend_pending_rpc_facts AS (
  SELECT
    COUNT(*) = 1 AS exactly_one_rpc,
    COALESCE(BOOL_AND(
      rpc.pronargs = 0
      AND rpc.proretset
      AND rpc.prorettype = 'public.v_pending_payment_verifications'::REGTYPE
      AND rpc.prosecdef
      AND COALESCE(rpc.proconfig, ARRAY[]::TEXT[])
        @> ARRAY['search_path=public, pg_temp']
    ), FALSE) AS exact_safe_contract,
    COALESCE(BOOL_AND(
      POSITION('auth.uid()' IN rpc.definition) > 0
      AND POSITION('from public.user_profiles' IN rpc.definition) > 0
      AND POSITION('profile.role = ''admin''' IN rpc.definition) > 0
      AND POSITION('profile.is_active = true' IN rpc.definition) > 0
      AND POSITION('from public.v_pending_payment_verifications' IN rpc.definition) > 0
      AND POSITION('order by pending.submitted_at desc' IN rpc.definition) > 0
    ), FALSE) AS validates_admin_and_reads_view,
    COALESCE(BOOL_AND(
      rpc.public_execute_revoked
      AND rpc.anon_execute_revoked
      AND rpc.authenticated_can_execute
    ), FALSE) AS execute_contract_is_exact
  FROM frontend_pending_rpc_rows AS rpc
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
    ) AS matching_completed_payments,
    EXISTS (
      SELECT 1
      FROM public.v_pending_payment_verifications AS pending
      WHERE pending.request_id = expected.request_id
    ) AS present_in_pending_view_source
  FROM expected_requests AS expected
  LEFT JOIN public.partner_payment_verification_requests AS request
    ON request.id = expected.request_id
   AND request.folio = expected.folio
   AND request.partner_id = expected.partner_id
   AND request.movement_id = expected.movement_id
   AND request.amount = expected.amount
), known_request_facts AS (
  SELECT
    COUNT(*) FILTER (WHERE status IS NOT NULL) = 2 AS both_known_requests_found,
    COALESCE(BOOL_AND(
      status = 'pending_review'
      AND approved_payment_id IS NULL
      AND matching_completed_payments = 0
      AND present_in_pending_view_source
    ), FALSE) AS both_remain_pending_without_duplicate_payment,
    COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
      'request_id', request_id,
      'folio', folio,
      'status', status,
      'approved_payment_id', approved_payment_id,
      'matching_completed_payments', matching_completed_payments,
      'present_in_pending_view_source', present_in_pending_view_source
    ) ORDER BY folio), '[]'::JSONB) AS evidence
  FROM expected_request_state
), legacy_facts AS (
  SELECT
    to_regclass('public.commercial_partner_payment_verification_requests') IS NULL
      AS legacy_relation_absent,
    NOT EXISTS (
      SELECT 1
      FROM pg_proc AS proc_row
      JOIN pg_namespace AS namespace_row
        ON namespace_row.oid = proc_row.pronamespace
      WHERE namespace_row.nspname = 'public'
        AND LOWER(pg_get_functiondef(proc_row.oid))
          LIKE '%commercial_partner_payment_verification_requests%'
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_views AS view_row
      WHERE view_row.schemaname = 'public'
        AND LOWER(view_row.definition)
          LIKE '%commercial_partner_payment_verification_requests%'
    ) AS legacy_relation_unused_by_database_code
), checks AS (
  SELECT JSONB_BUILD_OBJECT(
    'rpc_exists_once_with_exact_signature', rpc.exactly_one_rpc AND rpc.exact_signature,
    'rpc_is_security_definer_with_safe_search_path', rpc.security_definer_with_safe_search_path,
    'rpc_execute_is_restricted', rpc.execute_is_restricted,
    'rpc_validates_active_admin', rpc.validates_active_admin,
    'rpc_locks_and_uses_effective_balance', rpc.locks_and_uses_effective_balance,
    'rpc_inserts_exactly_one_payment_statement', rpc.inserts_exactly_one_payment_statement,
    'rpc_writes_approved_audit_and_payment_link', rpc.writes_approved_audit_and_payment_link,
    'rpc_is_idempotent_by_request_uuid', rpc.request_uuid_is_idempotency_key,
    'rpc_blocks_incompatible_active_requests', rpc.blocks_incompatible_active_requests,
    'rpc_relies_on_existing_trigger', rpc.relies_on_trigger_without_manual_sync,
    'rpc_does_not_target_existing_requests', rpc.does_not_target_existing_requests,
    'canonical_trigger_exists_once', trigger_fact.canonical_trigger_exists_once,
    'exactly_one_commission_sync_trigger', trigger_fact.exactly_one_commission_sync_trigger,
    'canonical_trigger_has_expected_contract', trigger_fact.canonical_trigger_has_expected_contract,
    'existing_approval_remains_idempotent', approval.existing_approval_remains_idempotent,
    'pending_view_exists_once', pending.pending_view_exists_once,
    'pending_view_uses_canonical_pending_requests', pending.pending_view_uses_canonical_pending_requests,
    'frontend_pending_rpc_exists_once', frontend_pending.exactly_one_rpc,
    'frontend_pending_rpc_has_exact_safe_contract', frontend_pending.exact_safe_contract,
    'frontend_pending_rpc_validates_admin_and_reads_view',
      frontend_pending.validates_admin_and_reads_view,
    'frontend_pending_rpc_execute_is_public_false_anon_false_authenticated_true',
      frontend_pending.execute_contract_is_exact,
    'both_known_requests_found', known.both_known_requests_found,
    'both_known_requests_remain_pending_without_duplicate_payment',
      known.both_remain_pending_without_duplicate_payment,
    'legacy_relation_absent', legacy.legacy_relation_absent,
    'legacy_relation_unused_by_database_code', legacy.legacy_relation_unused_by_database_code
  ) AS value,
  known.evidence AS known_request_evidence
  FROM admin_rpc_facts AS rpc
  CROSS JOIN trigger_facts AS trigger_fact
  CROSS JOIN approval_facts AS approval
  CROSS JOIN pending_view_facts AS pending
  CROSS JOIN frontend_pending_rpc_facts AS frontend_pending
  CROSS JOIN known_request_facts AS known
  CROSS JOIN legacy_facts AS legacy
)
SELECT JSONB_BUILD_OBJECT(
  'verification', '20261003_partner_payment_approval_pipeline',
  'read_only', TRUE,
  'all_checks_passed', NOT EXISTS (
    SELECT 1
    FROM JSONB_EACH(checks.value) AS check_row
    WHERE check_row.value <> 'true'::JSONB
  ),
  'checks', checks.value,
  'known_request_evidence', checks.known_request_evidence
) AS result
FROM checks;

ROLLBACK;
