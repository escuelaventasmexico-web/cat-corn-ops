-- Read-only verifier for 20260929_fix_accumulated_commission_settlements.sql.
-- It returns one JSONB row and does not create, cancel, pay, or modify settlements.
-- Manual Gerardo test: preview/pay a range containing available August + September events.
-- Manual Bianca test: preview must contain only prospect_conversion_bonus events.
-- Manual draft test: continue or explicitly cancel the existing draft; never auto-cancel it.

WITH function_rows AS (
  SELECT
    proc_row.oid,
    proc_row.proname,
    pg_get_function_identity_arguments(proc_row.oid) AS identity_arguments,
    lower(pg_get_function_result(proc_row.oid)) AS result_type,
    proc_row.prosecdef,
    COALESCE(array_to_string(proc_row.proconfig, ','), '') AS configuration,
    lower(pg_get_functiondef(proc_row.oid)) AS definition,
    has_function_privilege('authenticated', proc_row.oid, 'EXECUTE') AS authenticated_execute,
    has_function_privilege('anon', proc_row.oid, 'EXECUTE') AS anon_execute,
    EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(proc_row.proacl, acldefault('f', proc_row.proowner))) AS acl_row
      WHERE acl_row.grantee = 0
        AND acl_row.privilege_type = 'EXECUTE'
    ) AS public_execute
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.proname IN (
      'commission_settlement_candidate_events',
      'get_commission_settlement_preview',
      'create_commission_settlement'
    )
), definitions AS (
  SELECT
    max(definition) FILTER (
      WHERE proname = 'commission_settlement_candidate_events'
    ) AS candidate_definition,
    max(definition) FILTER (
      WHERE proname = 'get_commission_settlement_preview'
    ) AS preview_definition,
    max(definition) FILTER (
      WHERE proname = 'create_commission_settlement'
    ) AS create_definition
  FROM function_rows
), function_checks AS (
  SELECT
    count(*) = 3 AS required_functions_exist,
    bool_and(prosecdef) AS functions_are_security_definer,
    bool_and(configuration ILIKE '%search_path=public%') AS search_paths_are_fixed,
    count(*) FILTER (
      WHERE proname = 'get_commission_settlement_preview'
        AND identity_arguments = 'p_seller_id uuid, p_period_start date, p_period_end date'
        AND authenticated_execute
        AND NOT anon_execute
        AND NOT public_execute
        AND definition LIKE '%is_commission_admin() = false%'
        AND result_type LIKE '%available_total numeric%'
        AND result_type LIKE '%event_count integer%'
        AND result_type LIKE '%first_available_date date%'
        AND result_type LIKE '%last_available_date date%'
        AND result_type LIKE '%existing_draft_id uuid%'
        AND result_type LIKE '%existing_draft_folio text%'
        AND result_type LIKE '%existing_draft_total numeric%'
    ) = 1 AS preview_is_admin_only_for_authenticated,
    count(*) FILTER (
      WHERE proname = 'commission_settlement_candidate_events'
        AND NOT authenticated_execute
        AND NOT anon_execute
        AND NOT public_execute
    ) = 1 AS candidate_helper_is_internal,
    count(*) FILTER (
      WHERE proname = 'create_commission_settlement'
        AND authenticated_execute
        AND NOT anon_execute
        AND NOT public_execute
        AND definition LIKE '%is_commission_admin() = false%'
    ) = 1 AS create_remains_admin_only
  FROM function_rows
), parity_checks AS (
  SELECT
    candidate_definition LIKE '%event.seller_id = p_seller_id%'
      AND candidate_definition LIKE '%event.status = ''available''%'
      AND candidate_definition LIKE '%abs(balance.allocatable_amount) > 0.005%'
      AND candidate_definition LIKE '%america/mexico_city%'
      AND candidate_definition LIKE '%between p_period_start and p_period_end%'
      AND candidate_definition LIKE '%balance.allocatable_amount%'
      AND candidate_definition LIKE '%order by event.earned_at, event.id%'
        AS candidate_filters_are_complete,
    preview_definition LIKE '%commission_settlement_candidate_events(%'
      AND create_definition LIKE '%commission_settlement_candidate_events(%'
        AS preview_and_create_share_candidate_helper,
    candidate_definition LIKE '%seller.role = ''vendedora''%'
      AND candidate_definition LIKE '%event.source_type = ''prospect_conversion_bonus''%'
        AS bianca_is_limited_to_prospect_bonus,
    regexp_replace(candidate_definition, '[[:space:]]+', ' ', 'g') LIKE
      '%seller.role = ''socios_comerciales'' or ( seller.role = ''vendedora'' and event.source_type = ''prospect_conversion_bonus''%'
        AS socios_keep_all_normal_commissions,
    create_definition LIKE '%order by candidate.earned_at, candidate.event_id%'
        AS creation_is_fifo,
    preview_definition LIKE '%existing_draft_id%'
      OR preview_definition LIKE '%draft.id%'
        AS preview_returns_existing_draft,
    preview_definition NOT LIKE '%date_trunc(''month''%'
      AND create_definition NOT LIKE '%date_trunc(''month''%'
      AND candidate_definition LIKE '%between p_period_start and p_period_end%'
        AS settlement_range_can_span_multiple_months
  FROM definitions
), draft_checks AS (
  SELECT
    count(*) FILTER (
      WHERE index_row.indexname = 'uq_commission_settlements_one_draft_per_seller'
        AND index_row.indexdef ILIKE '%unique%'
        AND index_row.indexdef ILIKE '%seller_id%'
        AND index_row.indexdef ILIKE '%status = ''draft''%'
    ) = 1 AS one_draft_per_seller_is_enforced
  FROM pg_indexes AS index_row
  WHERE index_row.schemaname = 'public'
), compatibility_checks AS (
  SELECT
    to_regprocedure('public.cancel_commission_settlement_draft(uuid,text)') IS NOT NULL
      AS draft_cancellation_rpc_still_exists,
    to_regprocedure('public.pay_commission_settlement(uuid,text,text,text,text,text,boolean,text)') IS NOT NULL
      AS payment_confirmation_rpc_still_exists,
    to_regprocedure('public.protect_partially_paid_commission_values()') IS NOT NULL
      AS partial_payment_protection_still_exists,
    EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      WHERE trigger_row.tgname = 'commission_settlement_paid_expense_trigger'
        AND NOT trigger_row.tgisinternal
    ) AS paid_settlement_expense_trigger_still_exists,
    EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.commission_settlement_items'::REGCLASS
        AND constraint_row.contype = 'f'
        AND pg_get_constraintdef(constraint_row.oid, true) ILIKE '%commission_events%'
    ) AS settlement_items_still_reference_events
), all_checks AS (
  SELECT
    to_jsonb(function_checks) ||
    to_jsonb(parity_checks) ||
    to_jsonb(draft_checks) ||
    to_jsonb(compatibility_checks) AS checks
  FROM function_checks, parity_checks, draft_checks, compatibility_checks
)
SELECT jsonb_build_object(
  'all_checks_passed', NOT EXISTS (
    SELECT 1
    FROM jsonb_each_text(all_checks.checks) AS check_row
    WHERE check_row.value IS DISTINCT FROM 'true'
  ),
  'checks', all_checks.checks,
  'historical_data_note', 'This verifier is read-only. The corrective migration only replaces functions and grants; it contains no historical payment or settlement-item DML.',
  'manual_tests', jsonb_build_array(
    'Gerardo: accumulated available commissions from August and September use one exact preview/range.',
    'Bianca: preview and settlement contain only prospect_conversion_bonus.',
    'Existing draft: show folio, total, created date; continue or cancel only by explicit administrator action.'
  )
) AS verification
FROM all_checks;
