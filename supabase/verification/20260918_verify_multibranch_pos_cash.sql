-- Phase 1B read-only diagnostics and verifier.
--
-- PRE-APPLY: execute this query manually BEFORE applying the Phase 1B
-- migration. It captures deployed unversioned legacy cash RPCs and every
-- active sales trigger that may assign a cash session. Do not replace a legacy
-- public RPC until the returned definitions have been reviewed and versioned.
--
-- SELECT CASE WHEN trigger.oid IS NULL THEN 'function' ELSE 'trigger' END AS object_type,
--        COALESCE(trigger.tgname, function.proname) AS object_name,
--        pg_get_function_identity_arguments(function.oid) AS arguments,
--        pg_get_function_result(function.oid) AS returns,
--        pg_get_functiondef(function.oid) AS definition
-- FROM pg_proc AS function
-- JOIN pg_namespace AS namespace ON namespace.oid = function.pronamespace
-- LEFT JOIN pg_trigger AS trigger ON trigger.tgfoid = function.oid
--   AND trigger.tgrelid = 'public.sales'::REGCLASS AND NOT trigger.tgisinternal
-- WHERE namespace.nspname = 'public' AND (
--   function.proname IN ('open_cash_register_session', 'get_open_cash_register_session',
--     'register_cash_withdrawal', 'close_cash_register_session')
--   OR (trigger.oid IS NOT NULL
--     AND LOWER(pg_get_functiondef(function.oid)) LIKE '%cash_session_id%'
--     AND LOWER(pg_get_functiondef(function.oid)) LIKE '%cash_register_sessions%')
-- ) ORDER BY object_type, object_name, arguments;
--
-- POST-APPLY: the query below returns exactly one JSONB document.

WITH constants AS (
  SELECT 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID AS chipitlan_branch_id
),
column_facts AS (
  SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'cash_register_sessions' AND column_name = 'branch_id'
      AND data_type = 'uuid' AND is_nullable = 'NO') AS cash_sessions_branch_column,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'sales' AND column_name = 'branch_id'
      AND data_type = 'uuid' AND is_nullable = 'NO') AS sales_branch_column,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'cash_register_sessions' AND column_name = 'branch_id'
      AND column_default LIKE '%a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101%') AS cash_sessions_chipitlan_default,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'sales' AND column_name = 'branch_id'
      AND column_default LIKE '%a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101%') AS sales_chipitlan_default,
    EXISTS (SELECT 1 FROM pg_constraint AS constraint
      WHERE constraint.conrelid = 'public.cash_register_sessions'::REGCLASS
        AND constraint.conname = 'cash_register_sessions_branch_id_fkey'
        AND constraint.contype = 'f'
        AND pg_get_constraintdef(constraint.oid, true) = 'FOREIGN KEY (branch_id) REFERENCES branches(id)') AS cash_sessions_branch_fk,
    EXISTS (SELECT 1 FROM pg_constraint AS constraint
      WHERE constraint.conrelid = 'public.sales'::REGCLASS
        AND constraint.conname = 'sales_branch_id_fkey'
        AND constraint.contype = 'f'
        AND pg_get_constraintdef(constraint.oid, true) = 'FOREIGN KEY (branch_id) REFERENCES branches(id)') AS sales_branch_fk
),
data_facts AS (
  SELECT
    NOT EXISTS (SELECT 1 FROM public.sales WHERE branch_id IS NULL) AS no_sales_without_branch,
    NOT EXISTS (SELECT 1 FROM public.cash_register_sessions WHERE branch_id IS NULL) AS no_sessions_without_branch,
    NOT EXISTS (SELECT 1 FROM public.sales AS sale JOIN public.cash_register_sessions AS session
      ON session.id = sale.cash_session_id WHERE sale.branch_id IS DISTINCT FROM session.branch_id) AS no_cross_branch_sale_session,
    NOT EXISTS (SELECT 1 FROM public.cash_register_sessions GROUP BY branch_id
      HAVING COUNT(*) FILTER (WHERE closed_at IS NULL) > 1) AS one_open_session_per_branch,
    NOT EXISTS (SELECT 1 FROM public.sales WHERE branch_id <> constants.chipitlan_branch_id)
      AND NOT EXISTS (SELECT 1 FROM public.cash_register_sessions WHERE branch_id <> constants.chipitlan_branch_id)
      AS historical_rows_backfilled_to_chipitlan
  FROM constants
),
index_facts AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
      AND indexname = 'cash_register_sessions_one_open_per_branch_idx'
      AND indexdef ILIKE '%WHERE (closed_at IS NULL)%') AS one_open_session_index,
    EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
      AND indexname = 'cash_register_sessions_branch_opened_at_idx') AS cash_session_branch_index,
    EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
      AND indexname = 'sales_branch_created_at_idx') AS sales_branch_index,
    EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
      AND indexname = 'sales_branch_cash_session_idx') AS sales_branch_session_index
),
trigger_facts AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_trigger AS trigger JOIN pg_proc AS function ON function.oid = trigger.tgfoid
      WHERE trigger.tgrelid = 'public.sales'::REGCLASS AND trigger.tgname = 'assign_sale_to_branch_cash_session'
        AND NOT trigger.tgisinternal
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%where session.branch_id = new.branch_id%'
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%new.cash_session_id is null%'
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%an open cash-register session is required%') AS branch_assignment_trigger,
    NOT EXISTS (SELECT 1 FROM pg_trigger AS trigger JOIN pg_proc AS function ON function.oid = trigger.tgfoid
      WHERE trigger.tgrelid = 'public.sales'::REGCLASS AND NOT trigger.tgisinternal
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%cash_session_id%'
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%cash_register_sessions%'
        AND LOWER(pg_get_functiondef(function.oid)) NOT LIKE '%branch_id%') AS no_active_global_cash_assignment,
    NOT EXISTS (SELECT 1 FROM pg_proc AS function
      WHERE function.pronamespace = 'public'::REGNAMESPACE
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%cash_register_sessions%'
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%closed_at is null%'
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%order by%'
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%limit 1%'
        AND LOWER(pg_get_functiondef(function.oid)) NOT LIKE '%branch_id%'
        AND (has_function_privilege('authenticated', function.oid, 'EXECUTE') OR EXISTS (
          SELECT 1 FROM pg_trigger AS trigger WHERE trigger.tgfoid = function.oid AND NOT trigger.tgisinternal
        ))
    ) AS no_active_global_cash_lookup,
    EXISTS (SELECT 1 FROM pg_proc AS function
      WHERE function.oid = 'public.assign_sale_to_branch_cash_session()'::REGPROCEDURE
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%the branch of a sale cannot be changed%'
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%the cash-register session of a sale cannot be changed%'
        AND POSITION('cash-register session % is closed' IN LOWER(pg_get_functiondef(function.oid)))
          > POSITION('if tg_op = ''update''' IN LOWER(pg_get_functiondef(function.oid)))
    ) AS historical_sale_updates_do_not_require_open_session,
    EXISTS (SELECT 1 FROM pg_proc AS function
      WHERE function.oid = 'public.assign_sale_to_branch_cash_session()'::REGPROCEDURE
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%new.cashier_id := auth.uid()%'
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%cash-register session must belong to the same branch%'
    ) AS direct_pos_insert_server_protected
),
function_facts AS (
  SELECT
    (SELECT COUNT(*) FROM pg_proc AS function WHERE function.pronamespace = 'public'::REGNAMESPACE
      AND function.proname = 'open_cash_register_session_for_branch') = 1 AS open_rpc_unambiguous,
    (SELECT COUNT(*) FROM pg_proc AS function WHERE function.pronamespace = 'public'::REGNAMESPACE
      AND function.proname = 'get_open_cash_register_session_for_branch') = 1 AS get_rpc_unambiguous,
    (SELECT COUNT(*) FROM pg_proc AS function WHERE function.pronamespace = 'public'::REGNAMESPACE
      AND function.proname = 'register_cash_withdrawal_for_branch') = 1 AS withdrawal_rpc_unambiguous,
    (SELECT COUNT(*) FROM pg_proc AS function WHERE function.pronamespace = 'public'::REGNAMESPACE
      AND function.proname = 'close_cash_register_session_for_branch') = 1 AS close_rpc_unambiguous,
    NOT EXISTS (SELECT 1 FROM pg_proc AS function WHERE function.pronamespace = 'public'::REGNAMESPACE
      AND function.proname IN ('open_cash_register_session_for_branch', 'get_open_cash_register_session_for_branch',
        'register_cash_withdrawal_for_branch', 'close_cash_register_session_for_branch')
      AND (NOT function.prosecdef OR function.proconfig IS NULL
        OR NOT (function.proconfig @> ARRAY['search_path=public, pg_temp'])
        OR has_function_privilege('public', function.oid, 'EXECUTE')
        OR NOT has_function_privilege('authenticated', function.oid, 'EXECUTE'))) AS branch_rpcs_secure,
    EXISTS (SELECT 1 FROM pg_proc AS function
      WHERE function.oid = 'public.open_cash_register_session_for_branch(uuid,numeric,uuid,text)'::REGPROCEDURE
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%v_actor uuid := auth.uid()%'
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%p_opened_by is not null%')
    AND EXISTS (SELECT 1 FROM pg_proc AS function
      WHERE function.oid = 'public.register_cash_withdrawal_for_branch(uuid,uuid,numeric,text,text,uuid,text)'::REGPROCEDURE
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%v_actor uuid := auth.uid()%'
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%p_created_by is not null%')
    AND EXISTS (SELECT 1 FROM pg_proc AS function
      WHERE function.oid = 'public.close_cash_register_session_for_branch(uuid,uuid,numeric,uuid,text)'::REGPROCEDURE
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%v_actor uuid := auth.uid()%'
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%p_closed_by is not null%'
        AND LOWER(pg_get_functiondef(function.oid)) LIKE '%closed_by = v_actor%') AS new_rpcs_derive_actor_from_auth,
    EXISTS (SELECT 1 FROM pg_proc AS function WHERE function.oid = 'public.open_cash_register_session(numeric,uuid,text)'::REGPROCEDURE
      AND pg_get_functiondef(function.oid) LIKE '%a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101%')
    AND EXISTS (SELECT 1 FROM pg_proc AS function WHERE function.oid = 'public.get_open_cash_register_session()'::REGPROCEDURE
      AND pg_get_functiondef(function.oid) LIKE '%a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101%')
    AND EXISTS (SELECT 1 FROM pg_proc AS function WHERE function.oid = 'public.register_cash_withdrawal(uuid,numeric,text,text,uuid,text)'::REGPROCEDURE
      AND pg_get_functiondef(function.oid) LIKE '%a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101%')
    AND EXISTS (SELECT 1 FROM pg_proc AS function WHERE function.oid = 'public.close_cash_register_session(uuid,numeric,uuid,text)'::REGPROCEDURE
      AND pg_get_functiondef(function.oid) LIKE '%a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101%') AS legacy_rpcs_explicitly_target_chipitlan
),
security_facts AS (
  SELECT
    COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cash_register_sessions'::REGCLASS), false) AS cash_sessions_rls,
    COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales'::REGCLASS), false) AS sales_rls,
    COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cash_withdrawals'::REGCLASS), false) AS withdrawals_rls,
    NOT has_table_privilege('authenticated', 'public.cash_register_sessions', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.sales', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.cash_withdrawals', 'DELETE')
      AS no_delete_table_privilege,
    (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cash_register_sessions'
      AND policyname IN ('cash_register_sessions_branch_select','cash_register_sessions_branch_insert','cash_register_sessions_branch_update')) = 3
      AND (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales'
        AND policyname IN ('sales_branch_select','sales_branch_insert','sales_branch_update')) = 3
      AND (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cash_withdrawals'
        AND policyname IN ('cash_withdrawals_branch_select','cash_withdrawals_branch_insert','cash_withdrawals_branch_update')) = 3 AS branch_policies_present,
    NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename IN ('cash_register_sessions','sales','cash_withdrawals') AND cmd IN ('DELETE','ALL')) AS no_delete_policy,
    NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename IN ('cash_register_sessions','sales','cash_withdrawals') AND cmd IN ('SELECT','INSERT','UPDATE','ALL')
      AND COALESCE(qual, '') !~* 'user_has_branch_access'
      AND COALESCE(with_check, '') !~* 'user_has_branch_access') AS no_branch_bypassing_policy
),
scope_facts AS (
  SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
    AND column_name = 'branch_id' AND table_name NOT IN ('branches','user_branch_access','cash_register_sessions','sales')) AS no_branch_scope_creep
)
SELECT jsonb_build_object(
  'cash_register_sessions_branch_column', column_facts.cash_sessions_branch_column,
  'sales_branch_column', column_facts.sales_branch_column,
  'cash_sessions_chipitlan_compatibility_default', column_facts.cash_sessions_chipitlan_default,
  'sales_chipitlan_compatibility_default', column_facts.sales_chipitlan_default,
  'cash_register_sessions_branch_foreign_key', column_facts.cash_sessions_branch_fk,
  'sales_branch_foreign_key', column_facts.sales_branch_fk,
  'no_sales_without_branch', data_facts.no_sales_without_branch,
  'no_cash_sessions_without_branch', data_facts.no_sessions_without_branch,
  'all_existing_rows_backfilled_to_chipitlan', data_facts.historical_rows_backfilled_to_chipitlan,
  'no_cross_branch_sale_session', data_facts.no_cross_branch_sale_session,
  'at_most_one_open_cash_session_per_branch', data_facts.one_open_session_per_branch,
  'one_open_session_index', index_facts.one_open_session_index,
  'cash_sessions_branch_date_index', index_facts.cash_session_branch_index,
  'sales_branch_date_index', index_facts.sales_branch_index,
  'sales_branch_session_index', index_facts.sales_branch_session_index,
  'branch_assignment_trigger', trigger_facts.branch_assignment_trigger,
  'no_active_global_cash_assignment', trigger_facts.no_active_global_cash_assignment,
  'no_active_global_cash_lookup', trigger_facts.no_active_global_cash_lookup,
  'historical_sale_updates_do_not_require_open_session', trigger_facts.historical_sale_updates_do_not_require_open_session,
  'direct_pos_insert_is_server_protected', trigger_facts.direct_pos_insert_server_protected,
  'branch_rpcs_unambiguous', function_facts.open_rpc_unambiguous AND function_facts.get_rpc_unambiguous AND function_facts.withdrawal_rpc_unambiguous AND function_facts.close_rpc_unambiguous,
  'branch_rpcs_secure', function_facts.branch_rpcs_secure,
  'new_rpcs_derive_actor_from_auth', function_facts.new_rpcs_derive_actor_from_auth,
  'legacy_rpcs_explicitly_target_chipitlan', function_facts.legacy_rpcs_explicitly_target_chipitlan,
  'cash_sessions_rls', security_facts.cash_sessions_rls,
  'sales_rls', security_facts.sales_rls,
  'withdrawals_rls', security_facts.withdrawals_rls,
  'branch_policies_present', security_facts.branch_policies_present,
  'no_delete_policy', security_facts.no_delete_policy,
  'no_delete_table_privilege', security_facts.no_delete_table_privilege,
  'no_branch_bypassing_policy', security_facts.no_branch_bypassing_policy,
  'no_branch_scope_creep', scope_facts.no_branch_scope_creep,
  'all_checks_passed',
    column_facts.cash_sessions_branch_column AND column_facts.sales_branch_column
    AND column_facts.cash_sessions_chipitlan_default AND column_facts.sales_chipitlan_default
    AND column_facts.cash_sessions_branch_fk AND column_facts.sales_branch_fk
    AND data_facts.no_sales_without_branch AND data_facts.no_sessions_without_branch
    AND data_facts.historical_rows_backfilled_to_chipitlan AND data_facts.no_cross_branch_sale_session
    AND data_facts.one_open_session_per_branch AND index_facts.one_open_session_index
    AND index_facts.cash_session_branch_index AND index_facts.sales_branch_index AND index_facts.sales_branch_session_index
    AND trigger_facts.branch_assignment_trigger AND trigger_facts.no_active_global_cash_assignment
    AND trigger_facts.no_active_global_cash_lookup
    AND trigger_facts.historical_sale_updates_do_not_require_open_session AND trigger_facts.direct_pos_insert_server_protected
    AND function_facts.open_rpc_unambiguous AND function_facts.get_rpc_unambiguous
    AND function_facts.withdrawal_rpc_unambiguous AND function_facts.close_rpc_unambiguous
    AND function_facts.branch_rpcs_secure AND function_facts.new_rpcs_derive_actor_from_auth
    AND function_facts.legacy_rpcs_explicitly_target_chipitlan
    AND security_facts.cash_sessions_rls AND security_facts.sales_rls AND security_facts.withdrawals_rls
    AND security_facts.branch_policies_present AND security_facts.no_delete_policy
    AND security_facts.no_delete_table_privilege AND security_facts.no_branch_bypassing_policy
    AND scope_facts.no_branch_scope_creep
) AS verification
FROM column_facts CROSS JOIN data_facts CROSS JOIN index_facts CROSS JOIN trigger_facts
CROSS JOIN function_facts CROSS JOIN security_facts CROSS JOIN scope_facts;
