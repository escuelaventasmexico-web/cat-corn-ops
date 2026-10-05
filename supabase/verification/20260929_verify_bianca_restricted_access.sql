-- Read-only verifier for the original restricted-access rollout.
-- Session-dependent behavior is listed separately and is not simulated here.

WITH expected AS (
  SELECT
    'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID AS user_id,
    'angelicagut@catcorn.com.mx'::TEXT AS email,
    'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID AS chipitlan_id,
    'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID AS aurrera_id
),
identity_facts AS (
  SELECT
    count(auth_user.id) = 1 AS auth_identity_matches,
    count(*) FILTER (
      WHERE profile.id = expected.user_id
        AND profile.full_name = 'Angelica Gutierrez'
        AND profile.role = 'vendedora'
        AND profile.is_active
        AND profile.commercial_alias = 'ANGELICA'
    ) = 1 AS profile_matches
  FROM expected
  LEFT JOIN auth.users AS auth_user
    ON auth_user.id = expected.user_id
   AND lower(auth_user.email) = expected.email
  LEFT JOIN public.user_profiles AS profile
    ON profile.id = auth_user.id
),
role_facts AS (
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.user_profiles'::REGCLASS
      AND constraint_row.conname = 'user_profiles_role_check'
      AND constraint_row.contype = 'c'
      AND regexp_replace(pg_get_constraintdef(constraint_row.oid, true), '\s+', '', 'g') =
        'CHECK(role=ANY(ARRAY[''admin''::text,''socios_comerciales''::text,''vendedora''::text]))'
  ) AS role_constraint_is_exact
),
branch_facts AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM public.branches AS branch
      WHERE branch.id = expected.chipitlan_id
        AND branch.code = 'chipitlan_01'
        AND branch.active
    ) AS chipitlan_is_active,
    EXISTS (
      SELECT 1
      FROM public.branches AS branch
      WHERE branch.id = expected.aurrera_id
        AND branch.code = 'aurrera_la_luna_02'
        AND branch.active
    ) AS aurrera_is_known,
    EXISTS (
      SELECT 1
      FROM public.user_branch_access AS access
      WHERE access.user_id = expected.user_id
        AND access.branch_id = expected.chipitlan_id
        AND access.active
    ) AS chipitlan_access_is_active,
    NOT EXISTS (
      SELECT 1
      FROM public.user_branch_access AS access
      WHERE access.user_id = expected.user_id
        AND access.branch_id <> expected.chipitlan_id
        AND access.active
    ) AS no_other_active_branch_access,
    NOT EXISTS (
      SELECT 1
      FROM public.user_branch_access AS access
      WHERE access.user_id = expected.user_id
        AND access.branch_id = expected.aurrera_id
        AND access.active
    ) AS aurrera_access_is_inactive
  FROM expected
),
rls_facts AS (
  SELECT
    bool_and(class_row.relrowsecurity) FILTER (
      WHERE class_row.relname IN (
        'sales', 'sale_items', 'products', 'raw_materials',
        'sku_print_events', 'sku_print_event_items',
        'cash_register_sessions', 'cash_withdrawals'
      )
    ) AS required_rls_enabled,
    EXISTS (
      SELECT 1
      FROM pg_policies AS policy_row
      WHERE policy_row.schemaname = 'public'
        AND policy_row.tablename = 'sales'
        AND policy_row.cmd = 'SELECT'
        AND lower(COALESCE(policy_row.qual, '')) LIKE '%user_has_branch_access%branch_id%'
    ) AS sales_select_is_branch_scoped,
    EXISTS (
      SELECT 1
      FROM pg_policies AS policy_row
      WHERE policy_row.schemaname = 'public'
        AND policy_row.tablename = 'sales'
        AND policy_row.cmd = 'INSERT'
        AND lower(COALESCE(policy_row.with_check, '')) LIKE '%user_has_branch_access%branch_id%'
    ) AS sales_insert_is_branch_scoped,
    NOT EXISTS (
      SELECT 1
      FROM pg_policies AS policy_row
      WHERE policy_row.schemaname = 'public'
        AND policy_row.tablename = 'sales'
        AND policy_row.cmd IN ('SELECT', 'INSERT', 'UPDATE', 'ALL')
        AND lower(COALESCE(policy_row.qual, '') || ' ' || COALESCE(policy_row.with_check, ''))
          NOT LIKE '%user_has_branch_access%branch_id%'
    ) AS sales_has_no_branch_bypass_policy,
    EXISTS (
      SELECT 1
      FROM pg_policies AS cash_session_policy
      WHERE cash_session_policy.schemaname = 'public'
        AND cash_session_policy.tablename = 'cash_register_sessions'
        AND cash_session_policy.cmd = 'SELECT'
        AND lower(COALESCE(cash_session_policy.qual, '')) LIKE '%user_has_branch_access%branch_id%'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_policies AS withdrawal_policy
      WHERE withdrawal_policy.schemaname = 'public'
        AND withdrawal_policy.tablename = 'cash_withdrawals'
        AND withdrawal_policy.cmd = 'SELECT'
        AND lower(COALESCE(withdrawal_policy.qual, '')) LIKE '%user_has_branch_access%session.branch_id%'
    ) AS cash_base_select_policies_are_branch_scoped,
    count(*) FILTER (
      WHERE policy_row.tablename = 'sale_items'
        AND policy_row.cmd IN ('SELECT', 'INSERT')
        AND lower(COALESCE(policy_row.qual, '') || ' ' || COALESCE(policy_row.with_check, ''))
          LIKE '%user_has_branch_access%parent_sale.branch_id%'
    ) = 2 AS sale_items_read_and_insert_are_branch_scoped,
    NOT EXISTS (
      SELECT 1
      FROM pg_policies AS open_policy
      WHERE open_policy.schemaname = 'public'
        AND open_policy.tablename = 'sale_items'
        AND (
          open_policy.cmd = 'ALL'
          OR regexp_replace(lower(COALESCE(open_policy.qual, '')), '[()[:space:]]', '', 'g') = 'true'
          OR regexp_replace(lower(COALESCE(open_policy.with_check, '')), '[()[:space:]]', '', 'g') = 'true'
        )
    ) AS sale_items_has_no_open_policy,
    EXISTS (
      SELECT 1
      FROM pg_policies AS delete_policy
      WHERE delete_policy.schemaname = 'public'
        AND delete_policy.tablename = 'sale_items'
        AND delete_policy.cmd = 'DELETE'
        AND lower(COALESCE(delete_policy.qual, '')) LIKE '%role%admin%'
        AND lower(COALESCE(delete_policy.qual, '')) NOT LIKE '%vendedora%'
    ) AS sale_items_delete_is_admin_only,
    NOT EXISTS (
      SELECT 1
      FROM pg_policies AS write_policy
      WHERE write_policy.schemaname = 'public'
        AND write_policy.tablename IN ('products', 'raw_materials')
        AND write_policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
        AND (
          lower(COALESCE(write_policy.qual, '') || ' ' || COALESCE(write_policy.with_check, '')) LIKE '%vendedora%'
          OR regexp_replace(lower(COALESCE(write_policy.qual, '')), '[()[:space:]]', '', 'g') = 'true'
          OR regexp_replace(lower(COALESCE(write_policy.with_check, '')), '[()[:space:]]', '', 'g') = 'true'
        )
    ) AS catalog_writes_are_not_open_to_vendedora,
    NOT EXISTS (
      SELECT 1
      FROM pg_policies AS write_policy
      WHERE write_policy.schemaname = 'public'
        AND write_policy.tablename IN ('sku_print_events', 'sku_print_event_items')
        AND write_policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    )
    AND NOT has_table_privilege('authenticated', 'public.sku_print_events', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.sku_print_events', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.sku_print_events', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'public.sku_print_event_items', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.sku_print_event_items', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.sku_print_event_items', 'DELETE')
      AS print_event_direct_writes_are_blocked
  FROM pg_class AS class_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = class_row.relnamespace
  LEFT JOIN pg_policies AS policy_row
    ON policy_row.schemaname = namespace_row.nspname
   AND policy_row.tablename = class_row.relname
  WHERE namespace_row.nspname = 'public'
    AND class_row.relname IN (
      'sales', 'sale_items', 'products', 'raw_materials',
      'sku_print_events', 'sku_print_event_items',
      'cash_register_sessions', 'cash_withdrawals'
    )
),
function_rows AS (
  SELECT
    proc_row.oid,
    proc_row.proname,
    pg_get_function_identity_arguments(proc_row.oid) AS identity_arguments,
    proc_row.prosecdef,
    proc_row.proconfig,
    lower(pg_get_functiondef(proc_row.oid)) AS definition,
    NOT EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(proc_row.proacl, acldefault('f', proc_row.proowner))) AS acl_row
      WHERE acl_row.grantee = 0
        AND acl_row.privilege_type = 'EXECUTE'
    ) AS public_execute_revoked,
    NOT has_function_privilege('anon', proc_row.oid, 'EXECUTE') AS anon_execute_revoked,
    has_function_privilege('authenticated', proc_row.oid, 'EXECUTE') AS authenticated_can_execute
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.proname IN (
      'print_sku_labels',
      'open_cash_register_session_for_branch',
      'get_open_cash_register_session_for_branch',
      'register_cash_withdrawal_for_branch',
      'close_cash_register_session_for_branch',
      'sync_pos_commission_for_sale_item'
    )
),
function_facts AS (
  SELECT
    count(*) FILTER (
      WHERE proname = 'print_sku_labels'
        AND identity_arguments = 'p_product_id uuid, p_units integer'
    ) = 1 AS print_signature_is_exact,
    bool_and(
      prosecdef
      AND COALESCE(proconfig, ARRAY[]::TEXT[]) @> ARRAY['search_path=public, pg_temp']
      AND public_execute_revoked
      AND anon_execute_revoked
      AND authenticated_can_execute
      AND definition LIKE '%v_actor uuid := auth.uid()%'
      AND definition LIKE '%role not in (''admin'', ''socios_comerciales'', ''vendedora'')%'
      AND definition LIKE '%gummy_production_runs%'
      AND definition LIKE '%product_recipe_items%'
      AND definition LIKE '%for update of material%'
      AND definition LIKE '%insert into public.sku_print_events%'
      AND definition LIKE '%update public.raw_materials%'
    ) FILTER (WHERE proname = 'print_sku_labels') AS print_function_is_protected_and_preserved,
    count(*) FILTER (
      WHERE proname IN (
        'open_cash_register_session_for_branch',
        'get_open_cash_register_session_for_branch',
        'register_cash_withdrawal_for_branch',
        'close_cash_register_session_for_branch'
      )
    ) = 4 AS cash_rpc_count_is_exact,
    bool_and(
      prosecdef
      AND COALESCE(proconfig, ARRAY[]::TEXT[]) @> ARRAY['search_path=public, pg_temp']
      AND public_execute_revoked
      AND anon_execute_revoked
      AND authenticated_can_execute
      AND definition LIKE '%user_has_branch_access%'
    ) FILTER (
      WHERE proname IN (
        'open_cash_register_session_for_branch',
        'get_open_cash_register_session_for_branch',
        'register_cash_withdrawal_for_branch',
        'close_cash_register_session_for_branch'
      )
    ) AS cash_rpcs_are_restricted_and_branch_scoped,
    bool_and(
      definition LIKE '%<> ''socios_comerciales''%'
      AND definition NOT LIKE '%role%vendedora%commission%'
    ) FILTER (WHERE proname = 'sync_pos_commission_for_sale_item')
      AS pos_commission_remains_socios_only
  FROM function_rows
),
view_facts AS (
  SELECT
    count(*) = 3 AS cash_view_count_is_exact,
    bool_and(COALESCE(class_row.reloptions, ARRAY[]::TEXT[]) @> ARRAY['security_invoker=true'])
      AS cash_views_are_security_invoker,
    bool_and(EXISTS (
      SELECT 1
      FROM pg_attribute AS attribute_row
      WHERE attribute_row.attrelid = class_row.oid
        AND attribute_row.attname = 'branch_id'
        AND attribute_row.attnum > 0
        AND NOT attribute_row.attisdropped
    )) AS cash_views_expose_branch_id,
    bool_and(
      CASE WHEN class_row.relname = 'v_open_cash_register_status'
        THEN lower(pg_get_viewdef(class_row.oid, true)) NOT LIKE '%limit 1%'
        ELSE TRUE
      END
    ) AS open_cash_view_has_no_global_limit
  FROM pg_class AS class_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = class_row.relnamespace
  WHERE namespace_row.nspname = 'public'
    AND class_row.relname IN (
      'v_cash_register_sessions_summary',
      'v_open_cash_register_status',
      'v_cash_register_session_sales'
    )
),
checks AS (
  SELECT
    identity_facts.*,
    role_facts.*,
    branch_facts.*,
    rls_facts.*,
    function_facts.*,
    view_facts.*
  FROM identity_facts
  CROSS JOIN role_facts
  CROSS JOIN branch_facts
  CROSS JOIN rls_facts
  CROSS JOIN function_facts
  CROSS JOIN view_facts
)
SELECT to_jsonb(checks)
  || jsonb_build_object(
    'post_apply_scope_evidence', jsonb_build_object(
      'migration_contains_no_historical_sales_cash_stock_or_print_event_dml',
        'Verified by local static review; PostgreSQL catalogs do not retain statement-level migration source.',
      'other_profiles_or_access_rows_unchanged',
        'Verified by target-scoped migration statements; this cannot be reconstructed from post-apply state without a pre-apply snapshot.'
    ),
    'manual_session_tests_required', jsonb_build_array(
      'As Angelica, confirm only Chipitlán is returned and Aurrera in localStorage is ignored.',
      'As Angelica, confirm Dashboard, POS and Imprimir Etiquetas work and every other direct URL is denied.',
      'As Angelica, open, use, withdraw from and close only the Chipitlán cash register.',
      'As Angelica, print a conventional label and a valid GOMIX90 label, then confirm direct event-table writes fail.',
      'As admin, confirm the global dashboard and existing operational modules are unchanged.',
      'As Gerardo, confirm POS label access and socios_comerciales POS commission behavior remain unchanged.'
    ),
    'all_checks_passed',
      auth_identity_matches
      AND profile_matches
      AND role_constraint_is_exact
      AND chipitlan_is_active
      AND aurrera_is_known
      AND chipitlan_access_is_active
      AND no_other_active_branch_access
      AND aurrera_access_is_inactive
      AND required_rls_enabled
      AND sales_select_is_branch_scoped
      AND sales_insert_is_branch_scoped
      AND sales_has_no_branch_bypass_policy
      AND cash_base_select_policies_are_branch_scoped
      AND sale_items_read_and_insert_are_branch_scoped
      AND sale_items_has_no_open_policy
      AND sale_items_delete_is_admin_only
      AND catalog_writes_are_not_open_to_vendedora
      AND print_event_direct_writes_are_blocked
      AND print_signature_is_exact
      AND print_function_is_protected_and_preserved
      AND cash_rpc_count_is_exact
      AND cash_rpcs_are_restricted_and_branch_scoped
      AND pos_commission_remains_socios_only
      AND cash_view_count_is_exact
      AND cash_views_are_security_invoker
      AND cash_views_expose_branch_id
      AND open_cash_view_has_no_global_limit
  ) AS verification
FROM checks;
