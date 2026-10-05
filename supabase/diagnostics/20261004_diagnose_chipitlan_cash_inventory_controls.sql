-- Read-only diagnostic for future Chipitlan cash-session inventory controls.
-- It does not create counts, open or close sessions, create sales, or mutate data.

BEGIN;
SET TRANSACTION READ ONLY;

WITH target_relations(relation_name) AS (
  VALUES
    ('branches'),
    ('user_branch_access'),
    ('user_profiles'),
    ('cash_register_sessions'),
    ('cash_withdrawals'),
    ('sales'),
    ('sale_items'),
    ('sale_item_combo_components'),
    ('products'),
    ('raw_materials'),
    ('branch_cash_control_settings'),
    ('cash_inventory_counts'),
    ('cash_session_close_summaries'),
    ('admin_operational_alerts'),
    ('v_open_cash_register_status'),
    ('v_cash_register_sessions_summary'),
    ('v_cash_register_session_sales'),
    ('v_cash_register_session_withdrawals'),
    ('v_sales_history')
), relation_rows AS MATERIALIZED (
  SELECT
    expected.relation_name,
    relation.oid,
    relation.relkind,
    relation.relrowsecurity,
    relation.relforcerowsecurity,
    relation.reloptions,
    pg_get_userbyid(relation.relowner) AS owner,
    CASE WHEN relation.oid IS NULL THEN FALSE
      ELSE has_table_privilege('authenticated', relation.oid, 'SELECT')
    END AS authenticated_can_select,
    CASE WHEN relation.oid IS NULL THEN FALSE
      ELSE has_table_privilege('authenticated', relation.oid, 'INSERT')
    END AS authenticated_can_insert,
    CASE WHEN relation.oid IS NULL THEN FALSE
      ELSE has_table_privilege('authenticated', relation.oid, 'UPDATE')
    END AS authenticated_can_update,
    CASE WHEN relation.oid IS NULL THEN FALSE
      ELSE has_table_privilege('authenticated', relation.oid, 'DELETE')
    END AS authenticated_can_delete,
    CASE WHEN relation.oid IS NULL THEN FALSE
      ELSE has_table_privilege('anon', relation.oid, 'SELECT')
    END AS anon_can_select
  FROM target_relations AS expected
  LEFT JOIN pg_class AS relation
    ON relation.relnamespace = 'public'::REGNAMESPACE
   AND relation.relname = expected.relation_name
), relation_inventory AS (
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'relation', relation_name,
    'exists', oid IS NOT NULL,
    'kind', CASE relkind
      WHEN 'r' THEN 'table'
      WHEN 'p' THEN 'partitioned_table'
      WHEN 'v' THEN 'view'
      WHEN 'm' THEN 'materialized_view'
      ELSE relkind::TEXT
    END,
    'owner', owner,
    'rls_enabled', COALESCE(relrowsecurity, FALSE),
    'rls_forced', COALESCE(relforcerowsecurity, FALSE),
    'options', COALESCE(TO_JSONB(reloptions), '[]'::JSONB),
    'authenticated_privileges', JSONB_BUILD_OBJECT(
      'select', authenticated_can_select,
      'insert', authenticated_can_insert,
      'update', authenticated_can_update,
      'delete', authenticated_can_delete
    ),
    'anon_can_select', anon_can_select
  ) ORDER BY relation_name), '[]'::JSONB) AS value
  FROM relation_rows
), column_inventory AS (
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'relation', column_row.table_name,
    'position', column_row.ordinal_position,
    'column', column_row.column_name,
    'data_type', column_row.data_type,
    'udt_name', column_row.udt_name,
    'nullable', column_row.is_nullable = 'YES',
    'default', column_row.column_default,
    'numeric_precision', column_row.numeric_precision,
    'numeric_scale', column_row.numeric_scale
  ) ORDER BY column_row.table_name, column_row.ordinal_position), '[]'::JSONB) AS value
  FROM information_schema.columns AS column_row
  WHERE column_row.table_schema = 'public'
    AND column_row.table_name IN (SELECT relation_name FROM target_relations)
), constraint_inventory AS (
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'relation', relation.relname,
    'name', constraint_row.conname,
    'type', CASE constraint_row.contype
      WHEN 'p' THEN 'primary_key'
      WHEN 'u' THEN 'unique'
      WHEN 'f' THEN 'foreign_key'
      WHEN 'c' THEN 'check'
      WHEN 'x' THEN 'exclusion'
      ELSE constraint_row.contype::TEXT
    END,
    'validated', constraint_row.convalidated,
    'definition', pg_get_constraintdef(constraint_row.oid, TRUE),
    'referenced_relation', referenced.relname
  ) ORDER BY relation.relname, constraint_row.conname), '[]'::JSONB) AS value
  FROM pg_constraint AS constraint_row
  JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
  LEFT JOIN pg_class AS referenced ON referenced.oid = constraint_row.confrelid
  WHERE relation.relnamespace = 'public'::REGNAMESPACE
    AND relation.relname IN (SELECT relation_name FROM target_relations)
), index_inventory AS (
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'relation', index_row.tablename,
    'name', index_row.indexname,
    'definition', index_row.indexdef
  ) ORDER BY index_row.tablename, index_row.indexname), '[]'::JSONB) AS value
  FROM pg_indexes AS index_row
  WHERE index_row.schemaname = 'public'
    AND index_row.tablename IN (SELECT relation_name FROM target_relations)
), policy_inventory AS (
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'relation', policy_row.tablename,
    'name', policy_row.policyname,
    'command', policy_row.cmd,
    'permissive', policy_row.permissive,
    'roles', TO_JSONB(policy_row.roles),
    'using', policy_row.qual,
    'with_check', policy_row.with_check
  ) ORDER BY policy_row.tablename, policy_row.policyname), '[]'::JSONB) AS value
  FROM pg_policies AS policy_row
  WHERE policy_row.schemaname = 'public'
    AND policy_row.tablename IN (SELECT relation_name FROM target_relations)
), relation_grants AS (
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'relation', grant_row.table_name,
    'grantee', grant_row.grantee,
    'privilege', grant_row.privilege_type,
    'grantable', grant_row.is_grantable = 'YES'
  ) ORDER BY grant_row.table_name, grant_row.grantee, grant_row.privilege_type), '[]'::JSONB) AS value
  FROM information_schema.role_table_grants AS grant_row
  WHERE grant_row.table_schema = 'public'
    AND grant_row.table_name IN (SELECT relation_name FROM target_relations)
), relevant_functions AS MATERIALIZED (
  SELECT
    function_row.oid,
    function_row.proname,
    pg_get_function_identity_arguments(function_row.oid) AS signature,
    pg_get_function_result(function_row.oid) AS result_type,
    language_row.lanname AS language,
    function_row.provolatile,
    function_row.prosecdef,
    function_row.proconfig,
    has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
      AS authenticated_can_execute,
    has_function_privilege('anon', function_row.oid, 'EXECUTE')
      AS anon_can_execute,
    EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(
        function_row.proacl,
        acldefault('f', function_row.proowner)
      )) AS acl_row
      WHERE acl_row.grantee = 0
        AND acl_row.privilege_type = 'EXECUTE'
    ) AS public_can_execute,
    pg_get_functiondef(function_row.oid) AS definition
  FROM pg_proc AS function_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = function_row.pronamespace
  JOIN pg_language AS language_row
    ON language_row.oid = function_row.prolang
  WHERE namespace_row.nspname = 'public'
    AND function_row.prokind = 'f'
    AND (
      function_row.proname IN (
        'open_cash_register_session',
        'get_open_cash_register_session',
        'register_cash_withdrawal',
        'close_cash_register_session',
        'open_cash_register_session_for_branch',
        'get_open_cash_register_session_for_branch',
        'register_cash_withdrawal_for_branch',
        'close_cash_register_session_for_branch',
        'assign_sale_to_branch_cash_session',
        'enforce_cash_register_session_branch',
        'user_has_branch_access',
        'current_user_is_active_admin',
        'handle_new_sale'
      )
      OR function_row.proname ~* '(cash.*register|register.*cash|cash.*withdraw|sale.*cash.*session|cash.*inventory|operational.*alert)'
    )
), function_inventory AS (
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'name', proname,
    'signature', signature,
    'returns', result_type,
    'language', language,
    'volatility', provolatile,
    'security_definer', prosecdef,
    'configuration', COALESCE(TO_JSONB(proconfig), '[]'::JSONB),
    'authenticated_can_execute', authenticated_can_execute,
    'anon_can_execute', anon_can_execute,
    'public_can_execute', public_can_execute,
    'definition', definition
  ) ORDER BY proname, signature), '[]'::JSONB) AS value
  FROM relevant_functions
), relevant_trigger_rows AS MATERIALIZED (
  SELECT
    relation.relname AS relation_name,
    trigger_row.tgname,
    trigger_row.tgenabled,
    pg_get_triggerdef(trigger_row.oid, TRUE) AS trigger_definition,
    function_row.proname AS function_name,
    pg_get_function_identity_arguments(function_row.oid) AS function_signature,
    pg_get_functiondef(function_row.oid) AS function_definition
  FROM pg_trigger AS trigger_row
  JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
  JOIN pg_proc AS function_row ON function_row.oid = trigger_row.tgfoid
  WHERE NOT trigger_row.tgisinternal
    AND relation.relnamespace = 'public'::REGNAMESPACE
    AND relation.relname IN (
      'cash_register_sessions',
      'cash_withdrawals',
      'sales',
      'sale_items',
      'sale_item_combo_components',
      'raw_materials'
    )
), trigger_inventory AS (
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'relation', relation_name,
    'name', tgname,
    'enabled', tgenabled,
    'definition', trigger_definition,
    'function', function_name,
    'function_signature', function_signature,
    'function_definition', function_definition
  ) ORDER BY relation_name, tgname), '[]'::JSONB) AS value
  FROM relevant_trigger_rows
), relevant_views AS (
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'name', view_row.viewname,
    'security_invoker', COALESCE(relation.reloptions, ARRAY[]::TEXT[])
      @> ARRAY['security_invoker=true'],
    'authenticated_can_select', has_table_privilege(
      'authenticated', relation.oid, 'SELECT'
    ),
    'definition', view_row.definition
  ) ORDER BY view_row.viewname), '[]'::JSONB) AS value
  FROM pg_views AS view_row
  JOIN pg_class AS relation
    ON relation.relnamespace = 'public'::REGNAMESPACE
   AND relation.relname = view_row.viewname
  WHERE view_row.schemaname = 'public'
    AND (
      view_row.viewname IN (
        'v_open_cash_register_status',
        'v_cash_register_sessions_summary',
        'v_cash_register_session_sales',
        'v_cash_register_session_withdrawals',
        'v_sales_history'
      )
      OR view_row.viewname ~* '(cash.*inventory|operational.*alert)'
    )
), branch_identity AS (
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'id', branch.id,
    'code', branch.code,
    'name', branch.name,
    'active', branch.active,
    'sort_order', branch.sort_order
  ) ORDER BY branch.sort_order, branch.code), '[]'::JSONB) AS value
  FROM public.branches AS branch
  WHERE lower(branch.code) IN ('chipitlan_01', 'aurrera_la_luna_02')
     OR lower(branch.name) LIKE '%chipitl%'
     OR lower(branch.name) LIKE '%aurrera%'
), branch_access_summary AS (
  SELECT COALESCE(JSONB_AGG(TO_JSONB(summary_row)
    ORDER BY summary_row.branch_code, summary_row.role), '[]'::JSONB) AS value
  FROM (
    SELECT
      branch.code AS branch_code,
      profile.role::TEXT AS role,
      COUNT(*) AS access_row_count,
      COUNT(*) FILTER (
        WHERE access.active AND COALESCE(profile.is_active, FALSE)
      ) AS active_access_count
    FROM public.user_branch_access AS access
    JOIN public.branches AS branch ON branch.id = access.branch_id
    JOIN public.user_profiles AS profile ON profile.id = access.user_id
    WHERE branch.code IN ('chipitlan_01', 'aurrera_la_luna_02')
    GROUP BY branch.code, profile.role
  ) AS summary_row
), raw_material_candidates AS MATERIALIZED (
  SELECT
    material.id,
    NULLIF(TO_JSONB(material)->>'material_code', '') AS material_code,
    material.name,
    material.unit,
    CASE
      WHEN lower(COALESCE(TO_JSONB(material)->>'material_code', '')) ~ '(maiz|maíz|corn)'
        OR lower(material.name) ~ '(maiz|maíz|palomero|corn)' THEN 'corn'
      WHEN lower(COALESCE(TO_JSONB(material)->>'material_code', '')) ~ '(aceite|oil)'
        OR lower(material.name) ~ '(aceite|oil)' THEN 'oil'
      ELSE 'name_fragment'
    END AS candidate_for
  FROM public.raw_materials AS material
  WHERE lower(COALESCE(TO_JSONB(material)->>'material_code', ''))
      ~ '(maiz|maíz|corn|aceite|oil)'
     OR lower(material.name) ~ '(maiz|maíz|palomero|corn|aceite|oil)'
), raw_material_candidate_inventory AS (
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'id', id,
    'material_code', material_code,
    'name', name,
    'unit', unit,
    'candidate_for', candidate_for
  ) ORDER BY candidate_for, name, id), '[]'::JSONB) AS value
  FROM raw_material_candidates
), branch_session_facts AS (
  SELECT JSONB_BUILD_OBJECT(
    'open_sessions_by_branch', COALESCE((
      SELECT JSONB_AGG(TO_JSONB(row_data) ORDER BY row_data.branch_code)
      FROM (
        SELECT
          branch.code AS branch_code,
          COUNT(*) FILTER (WHERE session.closed_at IS NULL) AS open_session_count,
          COUNT(*) AS total_session_count
        FROM public.branches AS branch
        LEFT JOIN public.cash_register_sessions AS session
          ON session.branch_id = branch.id
        WHERE branch.code IN ('chipitlan_01', 'aurrera_la_luna_02')
        GROUP BY branch.code
      ) AS row_data
    ), '[]'::JSONB),
    'duplicate_open_session_branches', COALESCE((
      SELECT JSONB_AGG(TO_JSONB(row_data) ORDER BY row_data.branch_id)
      FROM (
        SELECT session.branch_id, COUNT(*) AS open_session_count
        FROM public.cash_register_sessions AS session
        WHERE session.closed_at IS NULL
        GROUP BY session.branch_id
        HAVING COUNT(*) > 1
      ) AS row_data
    ), '[]'::JSONB),
    'one_open_session_index_exists', EXISTS (
      SELECT 1
      FROM pg_indexes AS index_row
      WHERE index_row.schemaname = 'public'
        AND index_row.tablename = 'cash_register_sessions'
        AND index_row.indexdef ILIKE 'CREATE UNIQUE INDEX%'
        AND index_row.indexdef ILIKE '%(branch_id)%'
        AND index_row.indexdef ILIKE '%closed_at IS NULL%'
    )
  ) AS value
), sale_guard_facts AS (
  SELECT JSONB_BUILD_OBJECT(
    'cash_session_id_nullable', EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'sales'
        AND column_row.column_name = 'cash_session_id'
        AND column_row.is_nullable = 'YES'
    ),
    'branch_id_nullable', EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'sales'
        AND column_row.column_name = 'branch_id'
        AND column_row.is_nullable = 'YES'
    ),
    'pos_insert_guard_exists', EXISTS (
      SELECT 1
      FROM relevant_trigger_rows AS trigger_row
      WHERE trigger_row.relation_name = 'sales'
        AND lower(trigger_row.function_definition) LIKE '%cash_session_id%'
        AND lower(trigger_row.function_definition) LIKE '%cash_register_sessions%'
        AND lower(trigger_row.function_definition) LIKE '%an open cash-register session is required%'
    ),
    'non_pos_early_return_exists', EXISTS (
      SELECT 1
      FROM relevant_trigger_rows AS trigger_row
      WHERE trigger_row.relation_name = 'sales'
        AND lower(trigger_row.function_definition)
          LIKE '%coalesce(new.sale_origin, ''pos'') <> ''pos''%'
        AND lower(trigger_row.function_definition) LIKE '%return new%'
    ),
    'inventory_count_guard_exists', EXISTS (
      SELECT 1
      FROM relevant_trigger_rows AS trigger_row
      WHERE trigger_row.relation_name = 'sales'
        AND lower(trigger_row.function_definition) LIKE '%cash_inventory_counts%'
        AND lower(trigger_row.function_definition) LIKE '%opening%'
    ),
    'authenticated_atomic_sale_rpc_exists', EXISTS (
      SELECT 1
      FROM pg_proc AS function_row
      WHERE function_row.pronamespace = 'public'::REGNAMESPACE
        AND has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
        AND lower(pg_get_functiondef(function_row.oid)) LIKE '%insert into public.sales%'
        AND lower(pg_get_functiondef(function_row.oid)) LIKE '%insert into public.sale_items%'
    )
  ) AS value
), sale_data_facts AS (
  SELECT JSONB_BUILD_OBJECT(
    'chipitlan_sales_without_cash_session', COUNT(*) FILTER (
      WHERE branch.code = 'chipitlan_01'
        AND sale.cash_session_id IS NULL
    ),
    'aurrera_sales_without_cash_session', COUNT(*) FILTER (
      WHERE branch.code = 'aurrera_la_luna_02'
        AND sale.cash_session_id IS NULL
    ),
    'chipitlan_without_session_by_origin', COALESCE((
      SELECT JSONB_AGG(TO_JSONB(origin_row) ORDER BY origin_row.sale_origin)
      FROM (
        SELECT
          COALESCE(NULLIF(BTRIM(sale_inner.sale_origin), ''), 'legacy_or_pos')
            AS sale_origin,
          COUNT(*) AS sale_count
        FROM public.sales AS sale_inner
        JOIN public.branches AS branch_inner
          ON branch_inner.id = sale_inner.branch_id
        WHERE branch_inner.code = 'chipitlan_01'
          AND sale_inner.cash_session_id IS NULL
        GROUP BY COALESCE(NULLIF(BTRIM(sale_inner.sale_origin), ''), 'legacy_or_pos')
      ) AS origin_row
    ), '[]'::JSONB),
    'sales_with_cross_branch_session', COUNT(*) FILTER (
      WHERE sale.cash_session_id IS NOT NULL
        AND session.branch_id IS DISTINCT FROM sale.branch_id
    )
  ) AS value
  FROM public.sales AS sale
  LEFT JOIN public.branches AS branch ON branch.id = sale.branch_id
  LEFT JOIN public.cash_register_sessions AS session
    ON session.id = sale.cash_session_id
), count_contract_facts AS (
  SELECT JSONB_BUILD_OBJECT(
    'branch_cash_control_settings_exists',
      to_regclass('public.branch_cash_control_settings') IS NOT NULL,
    'cash_inventory_counts_exists',
      to_regclass('public.cash_inventory_counts') IS NOT NULL,
    'cash_session_close_summaries_exists',
      to_regclass('public.cash_session_close_summaries') IS NOT NULL,
    'admin_operational_alerts_exists',
      to_regclass('public.admin_operational_alerts') IS NOT NULL,
    'open_rpc_mentions_inventory_counts', COALESCE(BOOL_OR(
      proname = 'open_cash_register_session_for_branch'
      AND lower(definition) LIKE '%cash_inventory_counts%'
    ), FALSE),
    'close_rpc_mentions_inventory_counts', COALESCE(BOOL_OR(
      proname = 'close_cash_register_session_for_branch'
      AND lower(definition) LIKE '%cash_inventory_counts%'
    ), FALSE),
    'close_rpc_persists_audit_summary', COALESCE(BOOL_OR(
      proname = 'close_cash_register_session_for_branch'
      AND lower(definition) LIKE '%cash_session_close_summaries%'
    ), FALSE),
    'close_rpc_persists_admin_alert', COALESCE(BOOL_OR(
      proname = 'close_cash_register_session_for_branch'
      AND lower(definition) LIKE '%admin_operational_alerts%'
    ), FALSE)
  ) AS value
  FROM relevant_functions
), cost_schema_facts AS (
  SELECT JSONB_BUILD_OBJECT(
    'sale_items_has_historical_unit_cost', EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'sale_items'
        AND column_row.column_name IN (
          'unit_cost', 'unit_cost_snapshot', 'cost_snapshot', 'historical_unit_cost'
        )
    ),
    'products_has_current_unit_cost', EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'products'
        AND column_row.column_name = 'unit_cost'
    ),
    'sale_items_has_effective_price', EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'sale_items'
        AND column_row.column_name IN ('price', 'unit_price')
    ),
    'sale_items_has_discount_amount', EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'sale_items'
        AND column_row.column_name = 'discount_amount'
    ),
    'sale_items_has_discount_reason', EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'sale_items'
        AND column_row.column_name = 'discount_reason'
    ),
    'sales_has_promotion_code', EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'sales'
        AND column_row.column_name = 'promotion_code'
    ),
    'combo_component_snapshot_exists',
      to_regclass('public.sale_item_combo_components') IS NOT NULL,
    'combo_snapshot_has_historical_unit_cost', EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'sale_item_combo_components'
        AND column_row.column_name IN ('unit_cost', 'unit_cost_snapshot', 'cost_snapshot')
    )
  ) AS value
), cost_data_facts AS (
  SELECT JSONB_BUILD_OBJECT(
    'sale_item_count', COUNT(*),
    'generic_or_unlinked_item_count', COUNT(*) FILTER (
      WHERE item.product_id IS NULL
         OR COALESCE(NULLIF(TO_JSONB(item)->>'is_generic', '')::BOOLEAN, FALSE)
    ),
    'catalog_linked_items_without_current_unit_cost', COUNT(*) FILTER (
      WHERE item.product_id IS NOT NULL
        AND NULLIF(TO_JSONB(product)->>'unit_cost', '') IS NULL
    ),
    'distinct_sold_products_without_current_unit_cost', COUNT(DISTINCT item.product_id) FILTER (
      WHERE item.product_id IS NOT NULL
        AND NULLIF(TO_JSONB(product)->>'unit_cost', '') IS NULL
    ),
    'catalog_linked_items_with_current_unit_cost', COUNT(*) FILTER (
      WHERE item.product_id IS NOT NULL
        AND NULLIF(TO_JSONB(product)->>'unit_cost', '') IS NOT NULL
    ),
    'catalog_products_without_current_unit_cost', (
      SELECT COUNT(*)
      FROM public.products AS catalog_product
      WHERE NULLIF(TO_JSONB(catalog_product)->>'unit_cost', '') IS NULL
    ),
    'cost_interpretation',
      'products.unit_cost is a current catalog value; without a sale_items cost snapshot it is not authoritative historical COGS'
  ) AS value
  FROM public.sale_items AS item
  LEFT JOIN public.products AS product ON product.id = item.product_id
), notification_infrastructure AS (
  SELECT JSONB_BUILD_OBJECT(
    'matching_relations', COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'name', relation.relname,
        'kind', relation.relkind,
        'rls_enabled', relation.relrowsecurity
      ) ORDER BY relation.relname)
      FROM pg_class AS relation
      WHERE relation.relnamespace = 'public'::REGNAMESPACE
        AND relation.relkind IN ('r', 'p', 'v', 'm')
        AND relation.relname ~* '(notification|alert|activity|message)'
    ), '[]'::JSONB),
    'matching_functions', COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'name', function_row.proname,
        'signature', pg_get_function_identity_arguments(function_row.oid),
        'definition', pg_get_functiondef(function_row.oid)
      ) ORDER BY function_row.proname, pg_get_function_identity_arguments(function_row.oid))
      FROM pg_proc AS function_row
      WHERE function_row.pronamespace = 'public'::REGNAMESPACE
        AND function_row.proname ~* '(notification|alert|activity|message)'
    ), '[]'::JSONB),
    'realtime_publication_relations', COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'publication', publication_row.pubname,
        'schema', publication_row.schemaname,
        'relation', publication_row.tablename
      ) ORDER BY publication_row.pubname, publication_row.schemaname,
        publication_row.tablename)
      FROM pg_publication_tables AS publication_row
      WHERE publication_row.schemaname = 'public'
        AND publication_row.pubname ~* 'realtime'
    ), '[]'::JSONB)
  ) AS value
), compatibility AS (
  SELECT JSONB_BUILD_OBJECT(
    'proposed_names_available', JSONB_BUILD_OBJECT(
      'branch_cash_control_settings',
        to_regclass('public.branch_cash_control_settings') IS NULL,
      'cash_inventory_counts',
        to_regclass('public.cash_inventory_counts') IS NULL,
      'cash_session_close_summaries',
        to_regclass('public.cash_session_close_summaries') IS NULL,
      'admin_operational_alerts',
        to_regclass('public.admin_operational_alerts') IS NULL
    ),
    'minimum_relationships', JSONB_BUILD_ARRAY(
      'branch_cash_control_settings.branch_id -> branches.id',
      'cash_inventory_counts.cash_session_id -> cash_register_sessions.id',
      'cash_inventory_counts.branch_id -> branches.id',
      'cash_inventory_counts.raw_material_id -> raw_materials.id',
      'cash_inventory_counts.counted_by -> user_profiles.id',
      'cash_session_close_summaries.cash_session_id -> cash_register_sessions.id',
      'admin_operational_alerts.cash_session_id -> cash_register_sessions.id'
    ),
    'required_uniqueness', JSONB_BUILD_ARRAY(
      'one active settings row per branch',
      'one count per session, phase and controlled material',
      'one close summary per cash session',
      'one close alert per cash session and alert type'
    ),
    'recommended_server_entry_points', JSONB_BUILD_ARRAY(
      'new Chipitlan-aware atomic open RPC accepting corn kilograms and oil liters',
      'new Chipitlan-aware atomic close RPC accepting both closing counts',
      'sales BEFORE trigger guard requiring an open counted session only for configured branches',
      'admin-only security-invoker history view or validated SECURITY DEFINER read RPC'
    )
  ) AS value
), conclusions AS (
  SELECT JSONB_BUILD_OBJECT(
    'current_bypass_causes', JSONB_BUILD_ARRAY(
      'The opening RPC inserts only the cash session and has no inventory-count parameters or count row.',
      'The closing RPC updates only cash totals and has no inventory count, close-summary, or persistent-alert write.',
      'The sales trigger protects sale_origin pos, but returns early for non-pos origins such as delivery and order.',
      'No server guard can require an opening inventory count while cash_inventory_counts does not exist.',
      'The frontend writes sales and sale_items in separate requests, so that pair is not one database transaction.'
    ),
    'minimum_migrations', JSONB_BUILD_ARRAY(
      'Create settings, append-only counts, immutable close summaries, and persistent admin alerts.',
      'Add new atomic open and close RPCs without changing Aurrera behavior.',
      'Add a configured-branch sales guard that validates branch, open session, and opening count.',
      'Add admin-only history/read contracts and indexes, constraints, RLS, and grants.',
      'Add a read-only structural verifier plus explicit Chipitlan and Aurrera behavior checks.'
    ),
    'unresolved_decisions', JSONB_BUILD_ARRAY(
      'Whether Chipitlan delivery sales must require and join the physical cash session.',
      'Whether order checkout rows are in scope despite their current deliberate exclusion from cash sessions.',
      'Whether closing differences are opening minus closing only, or should incorporate purchases, waste, and transfers.',
      'Whether historical cost reporting may use current products.unit_cost or requires a new immutable sale-item cost snapshot.',
      'Which exact raw_materials rows are authoritative if the candidate query returns zero or multiple corn/oil rows.',
      'What event makes an administrator alert viewed: per-admin acknowledgement or one global viewed timestamp.'
    )
  ) AS value
)
SELECT JSONB_BUILD_OBJECT(
  'diagnostic', '20261004_chipitlan_cash_inventory_controls',
  'read_only', TRUE,
  'database_contract', JSONB_BUILD_OBJECT(
    'relations', relations.value,
    'columns', columns.value,
    'constraints', constraints.value,
    'indexes', indexes.value,
    'policies', policies.value,
    'grants', grants.value,
    'functions', functions.value,
    'triggers', triggers.value,
    'views', views.value
  ),
  'branches', JSONB_BUILD_OBJECT(
    'identities', branches.value,
    'access_summary_without_user_identity', access_summary.value
  ),
  'raw_material_candidates', materials.value,
  'current_cash_session_state', sessions.value,
  'current_sales_guards', sale_guards.value,
  'current_sales_without_session', sale_data.value,
  'current_inventory_count_contract', count_contract.value,
  'cost_source', JSONB_BUILD_OBJECT(
    'schema', cost_schema.value,
    'data_quality', cost_data.value,
    'authoritative_sales_amount', 'sales.total',
    'line_amount_source', 'sale_items quantity and effective price',
    'discount_sources', JSONB_BUILD_ARRAY(
      'sale_items.discount_amount',
      'sale_items.discount_reason',
      'sales.loyalty_discount_amount',
      'sales.promotion_code'
    ),
    'combo_source', 'sale_item_combo_components snapshots component identity and observed sale-time price, not unit cost'
  ),
  'persistent_alert_infrastructure', notification.value,
  'proposed_design_compatibility', compatibility.value,
  'assessment', conclusions.value
) AS result
FROM relation_inventory AS relations
CROSS JOIN column_inventory AS columns
CROSS JOIN constraint_inventory AS constraints
CROSS JOIN index_inventory AS indexes
CROSS JOIN policy_inventory AS policies
CROSS JOIN relation_grants AS grants
CROSS JOIN function_inventory AS functions
CROSS JOIN trigger_inventory AS triggers
CROSS JOIN relevant_views AS views
CROSS JOIN branch_identity AS branches
CROSS JOIN branch_access_summary AS access_summary
CROSS JOIN raw_material_candidate_inventory AS materials
CROSS JOIN branch_session_facts AS sessions
CROSS JOIN sale_guard_facts AS sale_guards
CROSS JOIN sale_data_facts AS sale_data
CROSS JOIN count_contract_facts AS count_contract
CROSS JOIN cost_schema_facts AS cost_schema
CROSS JOIN cost_data_facts AS cost_data
CROSS JOIN notification_infrastructure AS notification
CROSS JOIN compatibility
CROSS JOIN conclusions;

ROLLBACK;
