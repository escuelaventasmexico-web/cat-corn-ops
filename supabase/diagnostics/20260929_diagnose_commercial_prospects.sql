-- Read-only diagnostic for the future Commercial Prospects module.
--
-- This statement returns exactly one JSONB document. It only reads PostgreSQL
-- catalogs plus aggregate status counts; it does not return partner, prospect,
-- user, address, phone, email, payment-reference, or free-text note data.

WITH expected_relations(object_name) AS (
  VALUES
    ('user_profiles'),
    ('commercial_partners'),
    ('commercial_prospects'),
    ('commercial_prospect_interactions'),
    ('commercial_prospect_conversions'),
    ('commercial_prospect_bonuses'),
    ('commercial_partner_movements'),
    ('commercial_partner_movement_items'),
    ('commercial_partner_payments'),
    ('wholesale_contracts'),
    ('wholesale_orders'),
    ('wholesale_order_items'),
    ('wholesale_payments'),
    ('partner_payment_verification_requests'),
    ('commission_rules'),
    ('commission_events'),
    ('commission_settlements'),
    ('commission_settlement_items'),
    ('v_commercial_partner_operational_summary'),
    ('v_commercial_partner_current_stock'),
    ('v_commercial_partner_wholesale_summary'),
    ('v_wholesale_order_totals'),
    ('v_b2b_summary'),
    ('v_b2b_pipeline'),
    ('v_b2b_conversion_summary'),
    ('v_b2b_partner_next_visit'),
    ('v_b2b_visits'),
    ('v_seller_commission_monthly_summary'),
    ('v_seller_commission_movements'),
    ('v_commission_events_effective'),
    ('v_commission_event_payment_balances'),
    ('v_commissions_available_for_payment'),
    ('v_commission_settlement_detail'),
    ('v_commission_settlement_history')
),
discovered_relations AS MATERIALIZED (
  SELECT
    class_row.oid,
    namespace_row.nspname AS schema_name,
    class_row.relname AS object_name,
    class_row.relkind,
    class_row.relrowsecurity,
    class_row.relforcerowsecurity,
    class_row.reloptions,
    class_row.relowner,
    class_row.relacl
  FROM pg_class AS class_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = class_row.relnamespace
  WHERE namespace_row.nspname = 'public'
    AND class_row.relkind IN ('r', 'p', 'v', 'm')
    AND (
      class_row.relname IN (SELECT object_name FROM expected_relations)
      OR class_row.relname LIKE 'commercial_partner%'
      OR class_row.relname LIKE 'commercial_prospect%'
      OR class_row.relname LIKE 'wholesale_%'
      OR class_row.relname LIKE 'commission_%'
      OR class_row.relname LIKE 'v_b2b_%'
      OR class_row.relname LIKE 'v_%commission%'
    )
),
relation_inventory AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'name', expected.object_name,
        'exists', relation.oid IS NOT NULL,
        'kind', CASE relation.relkind
          WHEN 'r' THEN 'table'
          WHEN 'p' THEN 'partitioned_table'
          WHEN 'v' THEN 'view'
          WHEN 'm' THEN 'materialized_view'
          ELSE relation.relkind::TEXT
        END,
        'rls_enabled', COALESCE(relation.relrowsecurity, FALSE),
        'rls_forced', COALESCE(relation.relforcerowsecurity, FALSE),
        'security_options', COALESCE(to_jsonb(relation.reloptions), '[]'::JSONB),
        'owner', pg_get_userbyid(relation.relowner)
      )
      ORDER BY expected.object_name
    ),
    '[]'::JSONB
  ) AS value
  FROM expected_relations AS expected
  LEFT JOIN discovered_relations AS relation
    ON relation.object_name = expected.object_name
),
additional_relation_inventory AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'name', relation.object_name,
        'kind', CASE relation.relkind
          WHEN 'r' THEN 'table'
          WHEN 'p' THEN 'partitioned_table'
          WHEN 'v' THEN 'view'
          WHEN 'm' THEN 'materialized_view'
          ELSE relation.relkind::TEXT
        END,
        'rls_enabled', relation.relrowsecurity,
        'rls_forced', relation.relforcerowsecurity,
        'security_options', COALESCE(to_jsonb(relation.reloptions), '[]'::JSONB)
      )
      ORDER BY relation.object_name
    ),
    '[]'::JSONB
  ) AS value
  FROM discovered_relations AS relation
  WHERE relation.object_name NOT IN (SELECT object_name FROM expected_relations)
),
column_inventory AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'relation', relation.object_name,
        'position', attribute.attnum,
        'column', attribute.attname,
        'type', format_type(attribute.atttypid, attribute.atttypmod),
        'nullable', NOT attribute.attnotnull,
        'default', pg_get_expr(default_value.adbin, default_value.adrelid),
        'identity', NULLIF(attribute.attidentity, ''),
        'generated', NULLIF(attribute.attgenerated, '')
      )
      ORDER BY relation.object_name, attribute.attnum
    ),
    '[]'::JSONB
  ) AS value
  FROM discovered_relations AS relation
  JOIN pg_attribute AS attribute
    ON attribute.attrelid = relation.oid
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  LEFT JOIN pg_attrdef AS default_value
    ON default_value.adrelid = attribute.attrelid
   AND default_value.adnum = attribute.attnum
),
constraint_inventory AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
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
        'definition', pg_get_constraintdef(constraint_row.oid, TRUE),
        'referenced_relation', referenced.relname,
        'validated', constraint_row.convalidated,
        'deferrable', constraint_row.condeferrable,
        'initially_deferred', constraint_row.condeferred
      )
      ORDER BY relation.relname, constraint_row.conname
    ),
    '[]'::JSONB
  ) AS value
  FROM pg_constraint AS constraint_row
  JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
  LEFT JOIN pg_class AS referenced ON referenced.oid = constraint_row.confrelid
  WHERE relation.relnamespace = 'public'::regnamespace
    AND (
      relation.oid IN (SELECT oid FROM discovered_relations)
      OR referenced.oid IN (SELECT oid FROM discovered_relations)
    )
),
index_inventory AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'relation', relation.object_name,
        'name', index_class.relname,
        'unique', index_row.indisunique,
        'primary', index_row.indisprimary,
        'valid', index_row.indisvalid,
        'ready', index_row.indisready,
        'definition', pg_get_indexdef(index_row.indexrelid)
      )
      ORDER BY relation.object_name, index_class.relname
    ),
    '[]'::JSONB
  ) AS value
  FROM discovered_relations AS relation
  JOIN pg_index AS index_row ON index_row.indrelid = relation.oid
  JOIN pg_class AS index_class ON index_class.oid = index_row.indexrelid
),
view_inventory AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'name', relation.object_name,
        'security_options', COALESCE(to_jsonb(relation.reloptions), '[]'::JSONB),
        'definition', pg_get_viewdef(relation.oid, TRUE)
      )
      ORDER BY relation.object_name
    ),
    '[]'::JSONB
  ) AS value
  FROM discovered_relations AS relation
  WHERE relation.relkind IN ('v', 'm')
),
policy_inventory AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'relation', policy_row.tablename,
        'name', policy_row.policyname,
        'permissive', policy_row.permissive,
        'roles', COALESCE(to_jsonb(policy_row.roles), '[]'::JSONB),
        'command', policy_row.cmd,
        'using', policy_row.qual,
        'with_check', policy_row.with_check
      )
      ORDER BY policy_row.tablename, policy_row.policyname
    ),
    '[]'::JSONB
  ) AS value
  FROM pg_policies AS policy_row
  WHERE policy_row.schemaname = 'public'
    AND policy_row.tablename IN (
      SELECT object_name FROM discovered_relations
    )
),
trigger_inventory AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'relation', relation.object_name,
        'name', trigger_row.tgname,
        'enabled', trigger_row.tgenabled,
        'definition', pg_get_triggerdef(trigger_row.oid, TRUE),
        'function_name', function_row.proname,
        'function_signature', pg_get_function_identity_arguments(function_row.oid),
        'function_definition', pg_get_functiondef(function_row.oid)
      )
      ORDER BY relation.object_name, trigger_row.tgname
    ),
    '[]'::JSONB
  ) AS value
  FROM discovered_relations AS relation
  JOIN pg_trigger AS trigger_row
    ON trigger_row.tgrelid = relation.oid
   AND NOT trigger_row.tgisinternal
  JOIN pg_proc AS function_row ON function_row.oid = trigger_row.tgfoid
),
candidate_functions AS MATERIALIZED (
  SELECT
    proc_row.oid,
    proc_row.proname,
    proc_row.prokind,
    proc_row.provolatile,
    proc_row.prosecdef,
    proc_row.proleakproof,
    proc_row.proconfig,
    proc_row.proacl,
    proc_row.proowner,
    language_row.lanname AS language,
    pg_get_function_identity_arguments(proc_row.oid) AS identity_arguments,
    pg_get_function_result(proc_row.oid) AS result_type,
    pg_get_functiondef(proc_row.oid) AS definition
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
  JOIN pg_language AS language_row ON language_row.oid = proc_row.prolang
  WHERE namespace_row.nspname = 'public'
    AND proc_row.prokind IN ('f', 'p')
),
relevant_functions AS MATERIALIZED (
  SELECT function_row.*
  FROM candidate_functions AS function_row
  WHERE function_row.proname ~* '(commercial|partner|prospect|wholesale|comodato|commission|settlement|liquidat|payment_verification|conversion)'
     OR lower(function_row.definition) LIKE '%commercial_partners%'
     OR lower(function_row.definition) LIKE '%commercial_partner_movements%'
     OR lower(function_row.definition) LIKE '%wholesale_orders%'
     OR lower(function_row.definition) LIKE '%commission_events%'
),
function_inventory AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'name', function_row.proname,
        'signature', function_row.identity_arguments,
        'returns', function_row.result_type,
        'language', function_row.language,
        'kind', function_row.prokind,
        'volatility', function_row.provolatile,
        'security_definer', function_row.prosecdef,
        'leakproof', function_row.proleakproof,
        'configuration', COALESCE(to_jsonb(function_row.proconfig), '[]'::JSONB),
        'owner', pg_get_userbyid(function_row.proowner),
        'definition', function_row.definition
      )
      ORDER BY function_row.proname, function_row.identity_arguments
    ),
    '[]'::JSONB
  ) AS value
  FROM relevant_functions AS function_row
),
relation_privilege_inventory AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'relation', relation.object_name,
        'grantee', COALESCE(grantee.rolname, 'PUBLIC'),
        'privilege', acl_row.privilege_type,
        'grantable', acl_row.is_grantable
      )
      ORDER BY relation.object_name, COALESCE(grantee.rolname, 'PUBLIC'), acl_row.privilege_type
    ),
    '[]'::JSONB
  ) AS value
  FROM discovered_relations AS relation
  CROSS JOIN LATERAL aclexplode(
    COALESCE(relation.relacl, acldefault('r', relation.relowner))
  ) AS acl_row
  LEFT JOIN pg_roles AS grantee ON grantee.oid = acl_row.grantee
),
function_privilege_inventory AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'function', function_row.proname,
        'signature', function_row.identity_arguments,
        'grantee', COALESCE(grantee.rolname, 'PUBLIC'),
        'privilege', acl_row.privilege_type,
        'grantable', acl_row.is_grantable
      )
      ORDER BY function_row.proname, function_row.identity_arguments,
        COALESCE(grantee.rolname, 'PUBLIC'), acl_row.privilege_type
    ),
    '[]'::JSONB
  ) AS value
  FROM relevant_functions AS function_row
  CROSS JOIN LATERAL aclexplode(
    COALESCE(function_row.proacl, acldefault('f', function_row.proowner))
  ) AS acl_row
  LEFT JOIN pg_roles AS grantee ON grantee.oid = acl_row.grantee
),
enum_inventory AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'type', type_row.typname,
        'values', enum_values.values
      )
      ORDER BY type_row.typname
    ),
    '[]'::JSONB
  ) AS value
  FROM pg_type AS type_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = type_row.typnamespace
  CROSS JOIN LATERAL (
    SELECT jsonb_agg(enum_row.enumlabel ORDER BY enum_row.enumsortorder) AS values
    FROM pg_enum AS enum_row
    WHERE enum_row.enumtypid = type_row.oid
  ) AS enum_values
  WHERE namespace_row.nspname = 'public'
    AND type_row.typtype = 'e'
    AND EXISTS (
      SELECT 1
      FROM discovered_relations AS relation
      JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
      WHERE attribute.atttypid = type_row.oid
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    )
),
extension_inventory AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('name', extension_row.extname, 'version', extension_row.extversion)
      ORDER BY extension_row.extname
    ),
    '[]'::JSONB
  ) AS value
  FROM pg_extension AS extension_row
  WHERE extension_row.extname IN ('pg_trgm', 'unaccent', 'fuzzystrmatch', 'uuid-ossp', 'pgcrypto')
),
aggregate_state_evidence AS (
  SELECT jsonb_build_object(
    'contains_only_grouped_statuses_and_counts', TRUE,
    'commercial_partners', CASE
      WHEN to_regclass('public.commercial_partners') IS NOT NULL THEN query_to_xml(
        'SELECT to_jsonb(partner)->>''partner_model'' AS partner_model, '
        || 'to_jsonb(partner)->>''status'' AS status, '
        || 'to_jsonb(partner)->>''active'' AS active, count(*) AS row_count '
        || 'FROM public.commercial_partners AS partner '
        || 'GROUP BY 1, 2, 3 ORDER BY 1, 2, 3', FALSE, TRUE, ''
      )::TEXT
      ELSE NULL
    END,
    'commercial_partner_movements', CASE
      WHEN to_regclass('public.commercial_partner_movements') IS NOT NULL THEN query_to_xml(
        'SELECT to_jsonb(movement)->>''movement_type'' AS movement_type, '
        || 'to_jsonb(movement)->>''status'' AS status, count(*) AS row_count '
        || 'FROM public.commercial_partner_movements AS movement '
        || 'GROUP BY 1, 2 ORDER BY 1, 2', FALSE, TRUE, ''
      )::TEXT
      ELSE NULL
    END,
    'wholesale_orders', CASE
      WHEN to_regclass('public.wholesale_orders') IS NOT NULL THEN query_to_xml(
        'SELECT COALESCE(to_jsonb(order_row)->>''order_status'', to_jsonb(order_row)->>''status'') AS status, '
        || 'count(*) AS row_count FROM public.wholesale_orders AS order_row '
        || 'GROUP BY 1 ORDER BY 1', FALSE, TRUE, ''
      )::TEXT
      ELSE NULL
    END,
    'commercial_partner_payments', CASE
      WHEN to_regclass('public.commercial_partner_payments') IS NOT NULL THEN query_to_xml(
        'SELECT to_jsonb(payment)->>''status'' AS status, count(*) AS row_count '
        || 'FROM public.commercial_partner_payments AS payment GROUP BY 1 ORDER BY 1',
        FALSE, TRUE, ''
      )::TEXT
      ELSE NULL
    END,
    'wholesale_payments', CASE
      WHEN to_regclass('public.wholesale_payments') IS NOT NULL THEN query_to_xml(
        'SELECT to_jsonb(payment)->>''status'' AS status, count(*) AS row_count '
        || 'FROM public.wholesale_payments AS payment GROUP BY 1 ORDER BY 1',
        FALSE, TRUE, ''
      )::TEXT
      ELSE NULL
    END,
    'commission_events', CASE
      WHEN to_regclass('public.commission_events') IS NOT NULL THEN query_to_xml(
        'SELECT to_jsonb(event)->>''source_type'' AS source_type, '
        || 'to_jsonb(event)->>''release_condition'' AS release_condition, '
        || 'to_jsonb(event)->>''status'' AS status, count(*) AS row_count '
        || 'FROM public.commission_events AS event GROUP BY 1, 2, 3 ORDER BY 1, 2, 3',
        FALSE, TRUE, ''
      )::TEXT
      ELSE NULL
    END,
    'commission_settlements', CASE
      WHEN to_regclass('public.commission_settlements') IS NOT NULL THEN query_to_xml(
        'SELECT to_jsonb(settlement)->>''status'' AS status, count(*) AS row_count '
        || 'FROM public.commission_settlements AS settlement GROUP BY 1 ORDER BY 1',
        FALSE, TRUE, ''
      )::TEXT
      ELSE NULL
    END
  ) AS value
),
versioning_gaps AS (
  SELECT jsonb_build_object(
    'purpose', 'Objects whose deployed definitions must be compared with the repository before implementation',
    'objects', jsonb_build_array(
      'commercial_partners and its RLS policies',
      'commercial partner movement/payment base tables',
      'wholesale order/payment base tables',
      'commission_events, commission_rules, settlements and commission views',
      'payment-completion and prospect/partner-conversion functions and triggers'
    )
  ) AS value
)
SELECT jsonb_build_object(
  'diagnostic', 'commercial_prospects',
  'generated_at', statement_timestamp(),
  'read_only', TRUE,
  'privacy', jsonb_build_object(
    'row_level_personal_data_returned', FALSE,
    'aggregate_data', 'status/model/source combinations and counts only'
  ),
  'expected_relations', (SELECT value FROM relation_inventory),
  'additional_discovered_relations', (SELECT value FROM additional_relation_inventory),
  'columns', (SELECT value FROM column_inventory),
  'constraints', (SELECT value FROM constraint_inventory),
  'indexes', (SELECT value FROM index_inventory),
  'views', (SELECT value FROM view_inventory),
  'rls_policies', (SELECT value FROM policy_inventory),
  'triggers', (SELECT value FROM trigger_inventory),
  'functions', (SELECT value FROM function_inventory),
  'relation_privileges', (SELECT value FROM relation_privilege_inventory),
  'function_privileges', (SELECT value FROM function_privilege_inventory),
  'enums', (SELECT value FROM enum_inventory),
  'relevant_extensions', (SELECT value FROM extension_inventory),
  'aggregate_state_evidence', (SELECT value FROM aggregate_state_evidence),
  'versioning_gaps', (SELECT value FROM versioning_gaps)
) AS diagnostic;
