-- Read-only diagnostic for the deployed contracts required by official combos.
-- It performs no DDL or DML and does not lock application rows.

WITH required_relations(relation_name) AS (
  VALUES
    ('branches'::TEXT),
    ('user_branch_access'::TEXT),
    ('user_profiles'::TEXT),
    ('products'::TEXT),
    ('sales'::TEXT),
    ('sale_items'::TEXT),
    ('cash_register_sessions'::TEXT),
    ('product_lots'::TEXT),
    ('gummy_production_runs'::TEXT),
    ('sku_print_events'::TEXT),
    ('refunds_log'::TEXT),
    ('commission_events'::TEXT),
    ('commission_program_eligibility_snapshots'::TEXT)
),
relation_inventory AS (
  SELECT
    required.relation_name,
    class_row.oid IS NOT NULL AS relation_exists,
    CASE class_row.relkind
      WHEN 'r' THEN 'table'
      WHEN 'p' THEN 'partitioned_table'
      WHEN 'v' THEN 'view'
      WHEN 'm' THEN 'materialized_view'
      WHEN 'f' THEN 'foreign_table'
      ELSE class_row.relkind::TEXT
    END AS relation_kind,
    COALESCE(class_row.relrowsecurity, FALSE) AS rls_enabled,
    COALESCE(class_row.relforcerowsecurity, FALSE) AS rls_forced
  FROM required_relations AS required
  LEFT JOIN pg_namespace AS namespace_row
    ON namespace_row.nspname = 'public'
  LEFT JOIN pg_class AS class_row
    ON class_row.relnamespace = namespace_row.oid
   AND class_row.relname = required.relation_name
),
column_inventory AS (
  SELECT
    column_row.table_name,
    column_row.ordinal_position,
    column_row.column_name,
    column_row.data_type,
    column_row.udt_schema,
    column_row.udt_name,
    column_row.is_nullable,
    column_row.column_default
  FROM information_schema.columns AS column_row
  JOIN required_relations AS required
    ON required.relation_name = column_row.table_name
  WHERE column_row.table_schema = 'public'
),
constraint_inventory AS (
  SELECT
    class_row.relname AS relation_name,
    constraint_row.conname AS constraint_name,
    constraint_row.contype AS constraint_type,
    constraint_row.convalidated AS validated,
    pg_get_constraintdef(constraint_row.oid, TRUE) AS definition
  FROM pg_constraint AS constraint_row
  JOIN pg_class AS class_row
    ON class_row.oid = constraint_row.conrelid
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = class_row.relnamespace
  JOIN required_relations AS required
    ON required.relation_name = class_row.relname
  WHERE namespace_row.nspname = 'public'
),
index_inventory AS (
  SELECT
    index_row.tablename AS relation_name,
    index_row.indexname AS index_name,
    index_row.indexdef AS definition
  FROM pg_indexes AS index_row
  JOIN required_relations AS required
    ON required.relation_name = index_row.tablename
  WHERE index_row.schemaname = 'public'
),
policy_inventory AS (
  SELECT
    policy_row.tablename AS relation_name,
    policy_row.policyname AS policy_name,
    policy_row.permissive,
    policy_row.roles,
    policy_row.cmd,
    policy_row.qual,
    policy_row.with_check
  FROM pg_policies AS policy_row
  JOIN required_relations AS required
    ON required.relation_name = policy_row.tablename
  WHERE policy_row.schemaname = 'public'
),
grant_inventory AS (
  SELECT
    grant_row.table_name AS relation_name,
    grant_row.grantee,
    grant_row.privilege_type,
    grant_row.is_grantable
  FROM information_schema.role_table_grants AS grant_row
  JOIN required_relations AS required
    ON required.relation_name = grant_row.table_name
  WHERE grant_row.table_schema = 'public'
    AND grant_row.grantee IN ('anon', 'authenticated', 'PUBLIC')
),
callable_proc AS MATERIALIZED (
  SELECT proc_row.*
  FROM pg_proc AS proc_row
  WHERE proc_row.prokind IN ('f', 'p')
),
function_inventory AS (
  SELECT
    proc_row.oid,
    proc_row.proname AS function_name,
    pg_get_function_identity_arguments(proc_row.oid) AS identity_arguments,
    pg_get_function_result(proc_row.oid) AS result_type,
    language_row.lanname AS language,
    proc_row.prosecdef AS security_definer,
    proc_row.proconfig AS configuration,
    pg_get_functiondef(proc_row.oid) AS definition,
    has_function_privilege('anon', proc_row.oid, 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', proc_row.oid, 'EXECUTE') AS authenticated_can_execute
  FROM callable_proc AS proc_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = proc_row.pronamespace
  JOIN pg_language AS language_row
    ON language_row.oid = proc_row.prolang
  WHERE namespace_row.nspname = 'public'
    AND (
      proc_row.proname IN (
        'user_has_branch_access',
        'assign_sale_to_branch_cash_session',
        'create_sale',
        'refund_sale',
        'sync_pos_commission_for_sale_item',
        'trg_sync_pos_commission_after_item',
        'sync_pos_commissions_for_refund',
        'trg_sync_pos_commission_on_refund',
        'record_gummy_production',
        'pack_lot'
      )
      OR (
        lower(pg_get_functiondef(proc_row.oid)) LIKE '%sale_items%'
        AND (
          lower(pg_get_functiondef(proc_row.oid)) LIKE '%product_lots%'
          OR lower(pg_get_functiondef(proc_row.oid)) LIKE '%units_remaining%'
          OR lower(pg_get_functiondef(proc_row.oid)) LIKE '%gummy_production_runs%'
          OR lower(pg_get_functiondef(proc_row.oid)) LIKE '%sku_print_events%'
          OR lower(pg_get_functiondef(proc_row.oid)) LIKE '%inventory_movements%'
        )
      )
      OR (
        lower(pg_get_functiondef(proc_row.oid)) LIKE '%is_refunded%'
        AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%public.sales%'
      )
    )
),
trigger_inventory AS (
  SELECT
    table_class.relname AS relation_name,
    trigger_row.tgname AS trigger_name,
    trigger_row.tgenabled AS enabled_mode,
    proc_row.proname AS function_name,
    pg_get_triggerdef(trigger_row.oid, TRUE) AS trigger_definition,
    pg_get_functiondef(proc_row.oid) AS function_definition
  FROM pg_trigger AS trigger_row
  JOIN pg_class AS table_class
    ON table_class.oid = trigger_row.tgrelid
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = table_class.relnamespace
  JOIN callable_proc AS proc_row
    ON proc_row.oid = trigger_row.tgfoid
  WHERE namespace_row.nspname = 'public'
    AND table_class.relname IN (
      'sales',
      'sale_items',
      'product_lots',
      'gummy_production_runs',
      'sku_print_events'
    )
    AND NOT trigger_row.tgisinternal
),
payment_type AS (
  SELECT
    column_row.data_type,
    column_row.udt_schema,
    column_row.udt_name,
    type_row.typtype AS pg_type_kind,
    COALESCE(
      (
        SELECT jsonb_agg(enum_row.enumlabel ORDER BY enum_row.enumsortorder)
        FROM pg_enum AS enum_row
        WHERE enum_row.enumtypid = type_row.oid
      ),
      '[]'::JSONB
    ) AS enum_labels
  FROM information_schema.columns AS column_row
  LEFT JOIN pg_namespace AS type_namespace
    ON type_namespace.nspname = column_row.udt_schema
  LEFT JOIN pg_type AS type_row
    ON type_row.typnamespace = type_namespace.oid
   AND type_row.typname = column_row.udt_name
  WHERE column_row.table_schema = 'public'
    AND column_row.table_name = 'sales'
    AND column_row.column_name = 'payment_method'
),
base_products AS (
  SELECT to_jsonb(product) AS product
  FROM public.products AS product
  WHERE upper(coalesce(product.sku_code, '')) IN (
    'SLGM180',
    'SLJF240',
    'SBGM180',
    'SBJF240',
    'CAGM180',
    'GOMIX90'
  )
  ORDER BY upper(product.sku_code), product.id
),
beverage_collision_candidates AS (
  SELECT to_jsonb(product) AS product
  FROM public.products AS product
  WHERE upper(coalesce(product.sku_code, '')) IN (
      'AGUA-FRAMBUESA-NEGRA',
      'AGUA-MANGO-NARANJA',
      'AGUA-FRESA-KIWI'
    )
    OR product.barcode_value IN (
      '7500000000206',
      '7500000000213',
      '7500000000220'
    )
    OR lower(
      translate(
        coalesce(product.name, '') || ' ' || coalesce(product.flavor, ''),
        'áéíóúüñÁÉÍÓÚÜÑ',
        'aeiouunAEIOUUN'
      )
    ) ~ '(agua gaseosa|frambuesa negra|mango naranja|fresa kiwi)'
  ORDER BY product.id
),
branch_rows AS (
  SELECT to_jsonb(branch) AS branch
  FROM public.branches AS branch
  ORDER BY branch.id
),
branch_access_rows AS (
  SELECT to_jsonb(access_row) AS access_row
  FROM public.user_branch_access AS access_row
  ORDER BY access_row.user_id, access_row.branch_id
),
inventory_summary AS (
  SELECT jsonb_build_object(
    'sale_inventory_function_count',
      count(*) FILTER (
        WHERE lower(function_row.definition) LIKE '%sale_items%'
          AND (
            lower(function_row.definition) LIKE '%product_lots%'
            OR lower(function_row.definition) LIKE '%units_remaining%'
            OR lower(function_row.definition) LIKE '%gummy_production_runs%'
            OR lower(function_row.definition) LIKE '%sku_print_events%'
            OR lower(function_row.definition) LIKE '%inventory_movements%'
          )
      ),
    'captured_function_count', count(*)
  ) AS summary
  FROM function_inventory AS function_row
)
SELECT jsonb_pretty(
  jsonb_build_object(
    'diagnostic', 'official_product_combo_deployed_contracts',
    'generated_at', now(),
    'database', current_database(),
    'server_version', current_setting('server_version'),
    'current_user', current_user,
    'relations', COALESCE(
      (SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name)
       FROM relation_inventory AS row_data),
      '[]'::JSONB
    ),
    'columns', COALESCE(
      (SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.table_name, row_data.ordinal_position)
       FROM column_inventory AS row_data),
      '[]'::JSONB
    ),
    'constraints', COALESCE(
      (SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name, row_data.constraint_name)
       FROM constraint_inventory AS row_data),
      '[]'::JSONB
    ),
    'indexes', COALESCE(
      (SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name, row_data.index_name)
       FROM index_inventory AS row_data),
      '[]'::JSONB
    ),
    'policies', COALESCE(
      (SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name, row_data.policy_name)
       FROM policy_inventory AS row_data),
      '[]'::JSONB
    ),
    'grants', COALESCE(
      (SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name, row_data.grantee, row_data.privilege_type)
       FROM grant_inventory AS row_data),
      '[]'::JSONB
    ),
    'sales_payment_method', COALESCE(
      (SELECT to_jsonb(row_data) FROM payment_type AS row_data),
      jsonb_build_object('missing', TRUE)
    ),
    'functions', COALESCE(
      (SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.function_name, row_data.identity_arguments)
       FROM function_inventory AS row_data),
      '[]'::JSONB
    ),
    'triggers', COALESCE(
      (SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.relation_name, row_data.trigger_name)
       FROM trigger_inventory AS row_data),
      '[]'::JSONB
    ),
    'inventory_summary', (SELECT summary FROM inventory_summary),
    'base_products', COALESCE(
      (SELECT jsonb_agg(row_data.product) FROM base_products AS row_data),
      '[]'::JSONB
    ),
    'beverage_collision_candidates', COALESCE(
      (SELECT jsonb_agg(row_data.product) FROM beverage_collision_candidates AS row_data),
      '[]'::JSONB
    ),
    'branches', COALESCE(
      (SELECT jsonb_agg(row_data.branch) FROM branch_rows AS row_data),
      '[]'::JSONB
    ),
    'user_branch_access', COALESCE(
      (SELECT jsonb_agg(row_data.access_row) FROM branch_access_rows AS row_data),
      '[]'::JSONB
    )
  )
) AS deployed_contract_diagnostic;
