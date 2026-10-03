BEGIN;
SET TRANSACTION READ ONLY;

WITH definitions AS (
  SELECT
    lower(pg_get_functiondef('public.current_user_is_active_admin()'::REGPROCEDURE)) AS admin_function,
    lower(pg_get_functiondef('public.user_has_branch_access(uuid)'::REGPROCEDURE)) AS access_function,
    lower(pg_get_viewdef('public.v_sales_history'::REGCLASS, TRUE)) AS history_view
), policy_checks AS (
  SELECT
    count(*) FILTER (WHERE tablename = 'sales' AND cmd = 'SELECT') AS sales_select_count,
    bool_and(
      CASE WHEN tablename = 'sales' AND cmd = 'SELECT' THEN
        roles @> ARRAY['authenticated'::NAME]
        AND lower(COALESCE(qual, '')) LIKE '%current_user_is_active_admin%'
        AND lower(COALESCE(qual, '')) LIKE '%branch_id is not null%'
        AND lower(COALESCE(qual, '')) LIKE '%user_has_branch_access%'
      ELSE TRUE END
    ) AS sales_select_scoped,
    count(*) FILTER (WHERE tablename = 'sale_items' AND cmd = 'SELECT') AS items_select_count,
    bool_and(
      CASE WHEN tablename = 'sale_items' AND cmd = 'SELECT' THEN
        roles @> ARRAY['authenticated'::NAME]
        AND lower(COALESCE(qual, '')) LIKE '%current_user_is_active_admin%'
        AND lower(COALESCE(qual, '')) LIKE '%branch_id is not null%'
        AND lower(COALESCE(qual, '')) LIKE '%user_has_branch_access%'
        AND lower(COALESCE(qual, '')) LIKE '%sale_id%'
      ELSE TRUE END
    ) AS items_select_scoped,
    NOT bool_or(
      cmd = 'SELECT'
      AND roles @> ARRAY['authenticated'::NAME]
      AND regexp_replace(lower(COALESCE(qual, '')), '[()[:space:]]', '', 'g') IN ('true', 'auth.role()=''authenticated''::text')
    ) AS no_authenticated_select_bypass
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('sales', 'sale_items')
), checks AS (
  SELECT
    to_regclass('public.v_sales_history') IS NOT NULL AS history_view_exists,
    admin_function LIKE '%profile.role = ''admin''%'
      AND admin_function LIKE '%profile.is_active%' AS active_admin_function,
    access_function LIKE '%profile.role = ''admin''%'
      AND access_function LIKE '%user_branch_access%'
      AND access_function LIKE '%access.active%'
      AND access_function LIKE '%branch.active%' AS admin_global_restricted_scoped,
    sales_select_count = 1 AND sales_select_scoped AS sales_policy_correct,
    items_select_count = 1 AND items_select_scoped AS sale_items_policy_correct,
    no_authenticated_select_bypass,
    history_view LIKE '%left join branches%'
      AND history_view NOT LIKE '%cash_session_id%'
      AND history_view NOT LIKE '%cash_register_sessions%'
      AND history_view NOT LIKE '% join sale_items%'
      AND history_view NOT LIKE '% join user_profiles%' AS history_query_preserves_optional_relations,
    EXISTS (
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'public'
        AND table_name = 'v_sales_history'
        AND is_updatable = 'NO'
    ) AS history_source_is_read_only,
    NOT EXISTS (
      SELECT 1 FROM information_schema.table_privileges
      WHERE table_schema = 'public'
        AND table_name = 'v_sales_history'
        AND grantee IN ('anon', 'authenticated')
        AND privilege_type <> 'SELECT'
    ) AS history_source_has_no_client_writes,
    NOT EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid IN ('public.sales'::REGCLASS, 'public.sale_items'::REGCLASS)
        AND NOT trigger_row.tgisinternal
        AND lower(trigger_row.tgname) LIKE '%sales_history%'
    ) AS no_history_mutation_trigger,
    (
      to_regclass('public.sale_item_combo_components') IS NULL
      OR EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'sale_item_combo_components'
          AND policyname = 'sale_item_combo_components_branch_select'
          AND cmd = 'SELECT'
          AND lower(COALESCE(qual, '')) LIKE '%current_user_is_active_admin%'
          AND lower(COALESCE(qual, '')) LIKE '%user_has_branch_access%'
      )
    ) AS combo_snapshot_access_preserved
  FROM definitions
  CROSS JOIN policy_checks
)
SELECT
  checks.*,
  (
    history_view_exists
    AND active_admin_function
    AND admin_global_restricted_scoped
    AND sales_policy_correct
    AND sale_items_policy_correct
    AND no_authenticated_select_bypass
    AND history_query_preserves_optional_relations
    AND history_source_is_read_only
    AND history_source_has_no_client_writes
    AND no_history_mutation_trigger
    AND combo_snapshot_access_preserved
  ) AS all_checks_passed,
  (SELECT count(*) FROM public.sales WHERE branch_id IS NULL) AS legacy_sales_count,
  (SELECT count(*) FROM public.sales WHERE cash_session_id IS NULL) AS sales_without_cash_session_count,
  (SELECT count(*) FROM public.sale_items) AS existing_sale_items_count
FROM checks;

ROLLBACK;
