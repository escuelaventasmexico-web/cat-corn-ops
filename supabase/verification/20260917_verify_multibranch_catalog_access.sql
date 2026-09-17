-- Read-only verifier for Phase 1A: branch catalog and user access grants.
-- Returns exactly one JSONB document.

WITH expected_branches(id, code, name, sort_order) AS (
  VALUES
    ('a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID, 'chipitlan_01'::TEXT, 'Chipitlán 01'::TEXT, 1),
    ('e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID, 'aurrera_la_luna_02'::TEXT, 'Aurrera La Luna 02'::TEXT, 2)
),
objects AS (
  SELECT
    to_regclass('public.branches') IS NOT NULL AS branches_exists,
    to_regclass('public.user_branch_access') IS NOT NULL AS user_branch_access_exists,
    to_regprocedure('public.user_has_branch_access(uuid)') IS NOT NULL AS function_exists
),
branches_contract AS (
  SELECT
    COUNT(*) FILTER (WHERE column_name = 'id' AND data_type = 'uuid' AND is_nullable = 'NO') = 1 AS id_column,
    COUNT(*) FILTER (WHERE column_name = 'code' AND data_type = 'text' AND is_nullable = 'NO') = 1 AS code_column,
    COUNT(*) FILTER (WHERE column_name = 'name' AND data_type = 'text' AND is_nullable = 'NO') = 1 AS name_column,
    COUNT(*) FILTER (WHERE column_name = 'active' AND data_type = 'boolean' AND is_nullable = 'NO') = 1 AS active_column,
    COUNT(*) FILTER (WHERE column_name = 'sort_order' AND data_type = 'integer' AND is_nullable = 'NO') = 1 AS sort_order_column,
    COUNT(*) FILTER (WHERE column_name = 'created_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'NO') = 1 AS created_at_column,
    COUNT(*) FILTER (WHERE column_name = 'updated_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'NO') = 1 AS updated_at_column
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'branches'
),
access_contract AS (
  SELECT
    COUNT(*) FILTER (WHERE column_name = 'user_id' AND data_type = 'uuid' AND is_nullable = 'NO') = 1 AS user_id_column,
    COUNT(*) FILTER (WHERE column_name = 'branch_id' AND data_type = 'uuid' AND is_nullable = 'NO') = 1 AS branch_id_column,
    COUNT(*) FILTER (WHERE column_name = 'active' AND data_type = 'boolean' AND is_nullable = 'NO') = 1 AS active_column,
    COUNT(*) FILTER (WHERE column_name = 'created_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'NO') = 1 AS created_at_column,
    COUNT(*) FILTER (WHERE column_name = 'created_by' AND data_type = 'uuid') = 1 AS created_by_column,
    EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint
      WHERE constraint.conrelid = 'public.user_branch_access'::REGCLASS
        AND constraint.contype = 'p'
        AND pg_get_constraintdef(constraint.oid, true) LIKE 'PRIMARY KEY (user_id, branch_id)%'
    ) AS composite_primary_key,
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint
      WHERE constraint.conrelid = 'public.user_branch_access'::REGCLASS
        AND constraint.contype = 'f'
        AND pg_get_constraintdef(constraint.oid, true) LIKE '%FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE%'
    ) AS user_foreign_key,
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint
      WHERE constraint.conrelid = 'public.user_branch_access'::REGCLASS
        AND constraint.contype = 'f'
        AND pg_get_constraintdef(constraint.oid, true) LIKE '%FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE%'
    ) AS branch_foreign_key,
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint
      WHERE constraint.conrelid = 'public.user_branch_access'::REGCLASS
        AND constraint.contype = 'f'
        AND pg_get_constraintdef(constraint.oid, true) LIKE '%FOREIGN KEY (created_by) REFERENCES user_profiles(id) ON DELETE SET NULL%'
    ) AS created_by_foreign_key
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'user_branch_access'
),
expected_branch_facts AS (
  SELECT
    COUNT(branch.id) = 2 AS two_expected_branches,
    BOOL_AND(branch.id = expected.id AND branch.name = expected.name AND branch.sort_order = expected.sort_order AND branch.active) AS expected_branch_values_match
  FROM expected_branches AS expected
  LEFT JOIN public.branches AS branch ON branch.code = expected.code
),
branch_uniqueness AS (
  SELECT NOT EXISTS (
    SELECT 1 FROM public.branches GROUP BY code HAVING COUNT(*) > 1
  ) AS no_duplicate_codes
),
access_facts AS (
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM public.user_profiles AS profile
      CROSS JOIN expected_branches AS expected
      LEFT JOIN public.user_branch_access AS access
        ON access.user_id = profile.id
       AND access.branch_id = expected.id
       AND access.active
      WHERE COALESCE(profile.is_active, false)
        AND access.user_id IS NULL
    ) AS every_active_user_has_both_active_accesses,
    NOT EXISTS (
      SELECT 1
      FROM public.user_branch_access AS access
      LEFT JOIN public.user_profiles AS profile ON profile.id = access.user_id
      LEFT JOIN public.branches AS branch ON branch.id = access.branch_id
      WHERE profile.id IS NULL OR branch.id IS NULL
    ) AS no_orphan_accesses
),
security_facts AS (
  SELECT
    COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.branches'::REGCLASS), false) AS branches_rls_enabled,
    COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_branch_access'::REGCLASS), false) AS access_rls_enabled,
    (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'branches' AND policyname IN (
      'branches_select_active_with_access', 'branches_admin_insert', 'branches_admin_update'
    )) = 3 AS branches_policies_present,
    (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_branch_access' AND policyname IN (
      'user_branch_access_select_own_or_admin', 'user_branch_access_admin_insert', 'user_branch_access_admin_update'
    )) = 3 AS access_policies_present,
    (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
      'branches_active_sort_order_idx', 'user_branch_access_active_user_idx', 'user_branch_access_active_branch_idx'
    )) = 3 AS required_indexes_present
),
function_facts AS (
  SELECT
    pg_get_function_identity_arguments(proc.oid) = 'p_branch_id uuid' AS has_expected_signature,
    proc.provolatile = 's' AS is_stable,
    proc.prosecdef AS is_security_definer,
    COALESCE(proc.proconfig, ARRAY[]::TEXT[]) @> ARRAY['search_path=public, pg_temp'] AS has_safe_search_path,
    NOT has_function_privilege('public', proc.oid, 'EXECUTE') AS no_public_execute,
    has_function_privilege('authenticated', proc.oid, 'EXECUTE') AS authenticated_execute
  FROM pg_proc AS proc
  WHERE proc.oid = 'public.user_has_branch_access(uuid)'::REGPROCEDURE
)
SELECT jsonb_build_object(
  'branches_exists', objects.branches_exists,
  'user_branch_access_exists', objects.user_branch_access_exists,
  'user_has_branch_access_exists', objects.function_exists,
  'branches_contract', jsonb_build_object(
    'id', branches_contract.id_column,
    'code', branches_contract.code_column,
    'name', branches_contract.name_column,
    'active', branches_contract.active_column,
    'sort_order', branches_contract.sort_order_column,
    'created_at', branches_contract.created_at_column,
    'updated_at', branches_contract.updated_at_column
  ),
  'user_branch_access_contract', jsonb_build_object(
    'user_id', access_contract.user_id_column,
    'branch_id', access_contract.branch_id_column,
    'active', access_contract.active_column,
    'created_at', access_contract.created_at_column,
    'created_by', access_contract.created_by_column,
    'composite_primary_key', access_contract.composite_primary_key,
    'user_foreign_key', access_contract.user_foreign_key,
    'branch_foreign_key', access_contract.branch_foreign_key,
    'created_by_foreign_key', access_contract.created_by_foreign_key
  ),
  'two_expected_branches', expected_branch_facts.two_expected_branches,
  'expected_branch_values_match', expected_branch_facts.expected_branch_values_match,
  'no_duplicate_codes', branch_uniqueness.no_duplicate_codes,
  'every_active_user_has_both_active_accesses', access_facts.every_active_user_has_both_active_accesses,
  'no_orphan_accesses', access_facts.no_orphan_accesses,
  'branches_rls_enabled', security_facts.branches_rls_enabled,
  'user_branch_access_rls_enabled', security_facts.access_rls_enabled,
  'branches_policies_present', security_facts.branches_policies_present,
  'user_branch_access_policies_present', security_facts.access_policies_present,
  'required_indexes_present', security_facts.required_indexes_present,
  'function_has_expected_signature', function_facts.has_expected_signature,
  'function_is_stable', function_facts.is_stable,
  'function_is_security_definer', function_facts.is_security_definer,
  'function_has_safe_search_path', function_facts.has_safe_search_path,
  'function_has_no_public_execute', function_facts.no_public_execute,
  'function_authenticated_execute', function_facts.authenticated_execute,
  'all_checks_passed',
    objects.branches_exists
    AND objects.user_branch_access_exists
    AND objects.function_exists
    AND branches_contract.id_column
    AND branches_contract.code_column
    AND branches_contract.name_column
    AND branches_contract.active_column
    AND branches_contract.sort_order_column
    AND branches_contract.created_at_column
    AND branches_contract.updated_at_column
    AND access_contract.user_id_column
    AND access_contract.branch_id_column
    AND access_contract.active_column
    AND access_contract.created_at_column
    AND access_contract.created_by_column
    AND access_contract.composite_primary_key
    AND access_contract.user_foreign_key
    AND access_contract.branch_foreign_key
    AND access_contract.created_by_foreign_key
    AND expected_branch_facts.two_expected_branches
    AND expected_branch_facts.expected_branch_values_match
    AND branch_uniqueness.no_duplicate_codes
    AND access_facts.every_active_user_has_both_active_accesses
    AND access_facts.no_orphan_accesses
    AND security_facts.branches_rls_enabled
    AND security_facts.access_rls_enabled
    AND security_facts.branches_policies_present
    AND security_facts.access_policies_present
    AND security_facts.required_indexes_present
    AND function_facts.has_expected_signature
    AND function_facts.is_stable
    AND function_facts.is_security_definer
    AND function_facts.has_safe_search_path
    AND function_facts.no_public_execute
    AND function_facts.authenticated_execute
) AS verification
FROM objects
CROSS JOIN branches_contract
CROSS JOIN access_contract
CROSS JOIN expected_branch_facts
CROSS JOIN branch_uniqueness
CROSS JOIN access_facts
CROSS JOIN security_facts
CROSS JOIN function_facts;
