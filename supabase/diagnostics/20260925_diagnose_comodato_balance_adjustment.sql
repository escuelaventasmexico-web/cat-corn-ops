-- Read-only diagnostic for a future audited Comodato balance adjustment.
-- It returns one JSONB document and uses catalog discovery plus read-only
-- dynamic SELECTs so absent optional objects are reported instead of failing.

WITH expected_relations(object_name) AS (
  VALUES
    ('commercial_partners'),
    ('commercial_partner_movements'),
    ('commercial_partner_movement_items'),
    ('commercial_partner_payments'),
    ('partner_payment_verification_requests'),
    ('commercial_partner_payment_verification_requests'),
    ('commercial_delivery_units'),
    ('commission_events'),
    ('commission_settlement_items'),
    ('commission_settlements'),
    ('v_commercial_partner_operational_summary'),
    ('v_commercial_partner_current_stock'),
    ('v_commission_events_effective'),
    ('v_commission_event_payment_balances'),
    ('v_commissions_available_for_payment'),
    ('v_commission_settlement_detail'),
    ('v_commission_settlement_history'),
    ('v_pending_payment_verifications')
),
relations AS (
  SELECT
    expected.object_name,
    class.oid,
    class.relkind,
    class.relrowsecurity,
    class.relforcerowsecurity,
    pg_get_userbyid(class.relowner) AS owner,
    class.relacl
  FROM expected_relations AS expected
  LEFT JOIN pg_class AS class
    ON class.relname = expected.object_name
   AND class.relnamespace = 'public'::regnamespace
),
relation_json AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'name', object_name,
        'exists', oid IS NOT NULL,
        'kind', CASE relkind
          WHEN 'r' THEN 'table'
          WHEN 'p' THEN 'partitioned_table'
          WHEN 'v' THEN 'view'
          WHEN 'm' THEN 'materialized_view'
          WHEN 'f' THEN 'foreign_table'
          ELSE relkind::text
        END,
        'rls_enabled', COALESCE(relrowsecurity, false),
        'rls_forced', COALESCE(relforcerowsecurity, false),
        'owner', owner
      )
      ORDER BY object_name
    ),
    '[]'::jsonb
  ) AS value
  FROM relations
),
column_json AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'relation', relation.relname,
        'column', attribute.attname,
        'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
        'nullable', NOT attribute.attnotnull,
        'default', pg_get_expr(default_value.adbin, default_value.adrelid),
        'identity', NULLIF(attribute.attidentity, ''),
        'generated', NULLIF(attribute.attgenerated, '')
      )
      ORDER BY relation.relname, attribute.attnum
    ),
    '[]'::jsonb
  ) AS value
  FROM relations AS expected
  JOIN pg_class AS relation ON relation.oid = expected.oid
  JOIN pg_attribute AS attribute
    ON attribute.attrelid = relation.oid
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  LEFT JOIN pg_attrdef AS default_value
    ON default_value.adrelid = attribute.attrelid
   AND default_value.adnum = attribute.attnum
),
constraint_json AS (
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
          ELSE constraint_row.contype::text
        END,
        'definition', pg_get_constraintdef(constraint_row.oid, true),
        'referenced_relation', referenced.relname
      )
      ORDER BY relation.relname, constraint_row.conname
    ),
    '[]'::jsonb
  ) AS value
  FROM pg_constraint AS constraint_row
  JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
  LEFT JOIN pg_class AS referenced ON referenced.oid = constraint_row.confrelid
  WHERE relation.relnamespace = 'public'::regnamespace
    AND (
      relation.relname IN (SELECT object_name FROM expected_relations)
      OR referenced.relname IN (SELECT object_name FROM expected_relations)
    )
),
index_json AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'relation', relation.relname,
        'name', index_class.relname,
        'unique', index_data.indisunique,
        'primary', index_data.indisprimary,
        'valid', index_data.indisvalid,
        'definition', pg_get_indexdef(index_data.indexrelid)
      )
      ORDER BY relation.relname, index_class.relname
    ),
    '[]'::jsonb
  ) AS value
  FROM pg_index AS index_data
  JOIN pg_class AS relation ON relation.oid = index_data.indrelid
  JOIN pg_class AS index_class ON index_class.oid = index_data.indexrelid
  WHERE relation.relnamespace = 'public'::regnamespace
    AND relation.relname IN (SELECT object_name FROM expected_relations)
),
trigger_json AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'relation', relation.relname,
        'name', trigger_row.tgname,
        'enabled', trigger_row.tgenabled,
        'definition', pg_get_triggerdef(trigger_row.oid, true),
        'function', proc_row.proname,
        'function_signature', pg_get_function_identity_arguments(proc_row.oid),
        'function_definition', pg_get_functiondef(proc_row.oid)
      )
      ORDER BY relation.relname, trigger_row.tgname
    ),
    '[]'::jsonb
  ) AS value
  FROM pg_trigger AS trigger_row
  JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
  JOIN pg_proc AS proc_row ON proc_row.oid = trigger_row.tgfoid
  WHERE NOT trigger_row.tgisinternal
    AND proc_row.prokind = 'f'
    AND relation.relnamespace = 'public'::regnamespace
    AND relation.relname IN (SELECT object_name FROM expected_relations)
),
candidate_procs AS MATERIALIZED (
  SELECT
    proc_row.oid,
    proc_row.proname,
    proc_row.prolang,
    proc_row.provolatile,
    proc_row.prosecdef,
    proc_row.proconfig,
    proc_row.proacl,
    proc_row.proowner
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace ON namespace.oid = proc_row.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc_row.prokind IN ('f', 'p')
),
relevant_functions AS (
  SELECT
    proc_row.oid,
    proc_row.proname,
    pg_get_function_identity_arguments(proc_row.oid) AS identity_arguments,
    pg_get_function_result(proc_row.oid) AS result_type,
    language.lanname AS language,
    proc_row.provolatile,
    proc_row.prosecdef,
    proc_row.proconfig,
    pg_get_functiondef(proc_row.oid) AS definition,
    NOT EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(proc_row.proacl, acldefault('f', proc_row.proowner))) AS acl_row
      WHERE acl_row.grantee = 0
        AND acl_row.privilege_type = 'EXECUTE'
    ) AS public_execute_revoked
  FROM candidate_procs AS proc_row
  JOIN pg_language AS language ON language.oid = proc_row.prolang
  WHERE (
      proc_row.proname IN (
        'get_comodato_movement_pending_balance',
        'get_partner_comodato_pending_balance',
        'approve_partner_payment_verification_request'
      )
      OR proc_row.proname ~* '(comodato|commission|settlement|liquidat|payment_verification|partner_payment)'
      OR lower(pg_get_functiondef(proc_row.oid)) LIKE '%commercial_partner_movements%'
      OR lower(pg_get_functiondef(proc_row.oid)) LIKE '%commercial_partner_payments%'
      OR lower(pg_get_functiondef(proc_row.oid)) LIKE '%commission_events%'
      OR lower(pg_get_functiondef(proc_row.oid)) LIKE '%commission_settlement%'
    )
),
function_json AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'name', proname,
        'signature', identity_arguments,
        'returns', result_type,
        'language', language,
        'volatility', provolatile,
        'security_definer', prosecdef,
        'configuration', COALESCE(to_jsonb(proconfig), '[]'::jsonb),
        'public_execute_revoked', public_execute_revoked,
        'definition', definition
      )
      ORDER BY proname, identity_arguments
    ),
    '[]'::jsonb
  ) AS value
  FROM relevant_functions
),
view_json AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'name', view_definition.viewname,
        'definition', view_definition.definition
      )
      ORDER BY view_definition.viewname
    ),
    '[]'::jsonb
  ) AS value
  FROM pg_views AS view_definition
  WHERE view_definition.schemaname = 'public'
    AND (
      view_definition.viewname IN (SELECT object_name FROM expected_relations)
      OR lower(view_definition.definition) LIKE '%commercial_partner_movements%'
      OR lower(view_definition.definition) LIKE '%commercial_partner_payments%'
      OR lower(view_definition.definition) LIKE '%commission_events%'
      OR lower(view_definition.definition) LIKE '%commission_settlement%'
    )
),
policy_json AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'relation', policy_row.tablename,
        'name', policy_row.policyname,
        'command', policy_row.cmd,
        'roles', COALESCE(to_jsonb(policy_row.roles), '[]'::jsonb),
        'using', policy_row.qual,
        'with_check', policy_row.with_check
      )
      ORDER BY policy_row.tablename, policy_row.policyname
    ),
    '[]'::jsonb
  ) AS value
  FROM pg_policies AS policy_row
  WHERE policy_row.schemaname = 'public'
    AND policy_row.tablename IN (SELECT object_name FROM expected_relations)
),
privilege_json AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'relation', relation.relname,
        'grantee', COALESCE(grantee.rolname, 'PUBLIC'),
        'privilege', acl_row.privilege_type,
        'grantable', acl_row.is_grantable
      )
      ORDER BY relation.relname, COALESCE(grantee.rolname, 'PUBLIC'), acl_row.privilege_type
    ),
    '[]'::jsonb
  ) AS value
  FROM relations AS expected
  JOIN pg_class AS relation ON relation.oid = expected.oid
  CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) AS acl_row
  LEFT JOIN pg_roles AS grantee ON grantee.oid = acl_row.grantee
),
column_contracts AS (
  SELECT required.contract, bool_and(column_info.column_name IS NOT NULL) AS all_present
  FROM (VALUES
    ('status_movements', 'commercial_partner_movements', 'movement_type'),
    ('status_movements', 'commercial_partner_movements', 'status'),
    ('status_units', 'commercial_delivery_units', 'source_type'),
    ('status_units', 'commercial_delivery_units', 'status'),
    ('status_payments', 'commercial_partner_payments', 'status'),
    ('status_requests', 'partner_payment_verification_requests', 'scheme'),
    ('status_requests', 'partner_payment_verification_requests', 'status'),
    ('status_legacy_requests', 'commercial_partner_payment_verification_requests', 'scheme'),
    ('status_legacy_requests', 'commercial_partner_payment_verification_requests', 'status'),
    ('status_commissions', 'commission_events', 'source_type'),
    ('status_commissions', 'commission_events', 'status'),
    ('status_commissions', 'commission_events', 'release_condition'),
    ('status_commission_settlements', 'commission_settlements', 'status'),
    ('commission_payment_balances', 'v_commission_event_payment_balances', 'commission_event_id'),
    ('commission_payment_balances', 'v_commission_event_payment_balances', 'payment_status'),
    ('commission_payment_balances', 'v_commission_event_payment_balances', 'paid_amount'),
    ('commission_payment_balances', 'v_commission_event_payment_balances', 'reserved_amount'),
    ('commission_payment_balances', 'v_commission_event_payment_balances', 'remaining_amount'),
    ('commission_payment_balances', 'v_commission_event_payment_balances', 'allocatable_amount'),
    ('commission_payment_balances', 'commission_events', 'id'),
    ('target_partner', 'commercial_partners', 'id'),
    ('target_partner', 'commercial_partners', 'business_name'),
    ('target_balance', 'commercial_partners', 'id'),
    ('target_balance', 'commercial_partners', 'business_name'),
    ('target_balance', 'commercial_partner_movements', 'id'),
    ('target_balance', 'commercial_partner_movements', 'partner_id'),
    ('target_balance', 'commercial_partner_movements', 'movement_type'),
    ('target_balance', 'commercial_partner_movements', 'status'),
    ('target_balance', 'commercial_partner_movement_items', 'movement_id'),
    ('target_balance', 'commercial_partner_movement_items', 'quantity_sold'),
    ('target_balance', 'commercial_partner_movement_items', 'amount_due'),
    ('target_balance', 'commercial_partner_payments', 'partner_id'),
    ('target_balance', 'commercial_partner_payments', 'amount'),
    ('target_balance', 'commercial_partner_payments', 'status'),
    ('target_summary', 'commercial_partners', 'id'),
    ('target_summary', 'commercial_partners', 'business_name'),
    ('target_summary', 'v_commercial_partner_operational_summary', 'partner_id'),
    ('target_summary', 'v_commercial_partner_operational_summary', 'total_due'),
    ('target_summary', 'v_commercial_partner_operational_summary', 'total_paid'),
    ('target_summary', 'v_commercial_partner_operational_summary', 'pending_balance'),
    ('target_settlements', 'commercial_partners', 'id'),
    ('target_settlements', 'commercial_partners', 'business_name'),
    ('target_settlements', 'commercial_partner_movements', 'id'),
    ('target_settlements', 'commercial_partner_movements', 'partner_id'),
    ('target_settlements', 'commercial_partner_movements', 'movement_type'),
    ('target_settlements', 'commercial_partner_movements', 'movement_date'),
    ('target_settlements', 'commercial_partner_movement_items', 'movement_id'),
    ('target_settlements', 'commercial_partner_movement_items', 'quantity_sold'),
    ('target_settlements', 'commercial_partner_movement_items', 'amount_due'),
    ('target_settlements', 'commercial_partner_payments', 'movement_id'),
    ('target_settlements', 'commercial_partner_payments', 'amount'),
    ('target_settlements', 'commercial_partner_payments', 'status'),
    ('target_liquidated_items', 'commercial_partners', 'id'),
    ('target_liquidated_items', 'commercial_partners', 'business_name'),
    ('target_liquidated_items', 'commercial_partner_movements', 'id'),
    ('target_liquidated_items', 'commercial_partner_movements', 'partner_id'),
    ('target_liquidated_items', 'commercial_partner_movements', 'movement_type'),
    ('target_liquidated_items', 'commercial_partner_movement_items', 'id'),
    ('target_liquidated_items', 'commercial_partner_movement_items', 'movement_id'),
    ('target_possession', 'commercial_partners', 'id'),
    ('target_possession', 'commercial_partners', 'business_name'),
    ('target_possession', 'commercial_partner_movements', 'id'),
    ('target_possession', 'commercial_partner_movements', 'partner_id'),
    ('target_possession', 'commercial_partner_movements', 'status'),
    ('target_possession', 'commercial_partner_movement_items', 'movement_id'),
    ('target_units', 'commercial_partners', 'id'),
    ('target_units', 'commercial_partners', 'business_name'),
    ('target_units', 'commercial_delivery_units', 'id'),
    ('target_payments', 'commercial_partners', 'id'),
    ('target_payments', 'commercial_partners', 'business_name'),
    ('target_payments', 'commercial_partner_payments', 'id'),
    ('target_requests', 'commercial_partners', 'id'),
    ('target_requests', 'commercial_partners', 'business_name'),
    ('target_requests', 'partner_payment_verification_requests', 'id'),
    ('target_legacy_requests', 'commercial_partners', 'id'),
    ('target_legacy_requests', 'commercial_partners', 'business_name'),
    ('target_legacy_requests', 'commercial_partner_payment_verification_requests', 'id'),
    ('target_commissions', 'commercial_partners', 'id'),
    ('target_commissions', 'commercial_partners', 'business_name'),
    ('target_commissions', 'commercial_partner_movements', 'id'),
    ('target_commissions', 'commercial_partner_movements', 'partner_id'),
    ('target_commissions', 'commission_events', 'id'),
    ('target_commissions', 'v_commission_event_payment_balances', 'commission_event_id'),
    ('target_commissions', 'v_commission_event_payment_balances', 'payment_status'),
    ('target_commissions', 'v_commission_event_payment_balances', 'paid_amount'),
    ('target_commissions', 'v_commission_event_payment_balances', 'reserved_amount'),
    ('target_commissions', 'v_commission_event_payment_balances', 'remaining_amount'),
    ('target_commissions', 'v_commission_event_payment_balances', 'allocatable_amount'),
    ('target_commission_settlements', 'commercial_partners', 'id'),
    ('target_commission_settlements', 'commercial_partners', 'business_name'),
    ('target_commission_settlements', 'commercial_partner_movements', 'id'),
    ('target_commission_settlements', 'commercial_partner_movements', 'partner_id'),
    ('target_commission_settlements', 'commission_events', 'id'),
    ('target_commission_settlements', 'commission_settlement_items', 'id'),
    ('target_commission_settlements', 'commission_settlement_items', 'commission_event_id'),
    ('target_commission_settlements', 'commission_settlement_items', 'settlement_id'),
    ('target_commission_settlements', 'commission_settlements', 'id'),
    ('target_commission_settlements', 'commission_settlements', 'status')
  ) AS required(contract, table_name, column_name)
  LEFT JOIN information_schema.columns AS column_info
    ON column_info.table_schema = 'public'
   AND column_info.table_name = required.table_name
   AND column_info.column_name = required.column_name
  GROUP BY required.contract
),
commission_payment_balance_contract AS (
  SELECT jsonb_build_object(
    'relation_exists', to_regclass('public.v_commission_event_payment_balances') IS NOT NULL,
    'required_columns_present', COALESCE((
      SELECT all_present
      FROM column_contracts
      WHERE contract = 'commission_payment_balances'
    ), FALSE),
    'required_columns', jsonb_build_array(
      'commission_event_id', 'payment_status', 'paid_amount', 'reserved_amount',
      'remaining_amount', 'allocatable_amount'
    ),
    'safe_for_commission_cancellation',
      to_regclass('public.v_commission_event_payment_balances') IS NOT NULL
      AND COALESCE((
        SELECT all_present
        FROM column_contracts
        WHERE contract = 'commission_payment_balances'
      ), FALSE),
    'unsafe_reason', CASE
      WHEN to_regclass('public.v_commission_event_payment_balances') IS NULL
        THEN 'The commission payment balance view is absent; payment, reservation, and allocation state cannot be established safely.'
      WHEN NOT COALESCE((
        SELECT all_present
        FROM column_contracts
        WHERE contract = 'commission_payment_balances'
      ), FALSE)
        THEN 'The commission payment balance view or commission event relation lacks a required column; cancellation is unsafe until the deployed contract is reviewed.'
      ELSE NULL
    END
  ) AS value
),
status_xml AS (
  SELECT jsonb_build_object(
    'movements', CASE WHEN to_regclass('public.commercial_partner_movements') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'status_movements'), false)
      THEN query_to_xml(
        'SELECT movement_type::text AS movement_type, status::text AS status, count(*) AS row_count '
        || 'FROM public.commercial_partner_movements GROUP BY movement_type::text, status::text '
        || 'ORDER BY movement_type::text, status::text', false, true, ''
      )::text END,
    'delivery_units', CASE WHEN to_regclass('public.commercial_delivery_units') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'status_units'), false)
      THEN query_to_xml(
        'SELECT source_type::text AS source_type, status::text AS status, count(*) AS row_count '
        || 'FROM public.commercial_delivery_units GROUP BY source_type::text, status::text '
        || 'ORDER BY source_type::text, status::text', false, true, ''
      )::text END,
    'partner_payments', CASE WHEN to_regclass('public.commercial_partner_payments') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'status_payments'), false)
      THEN query_to_xml(
        'SELECT status::text AS status, count(*) AS row_count '
        || 'FROM public.commercial_partner_payments GROUP BY status::text ORDER BY status::text', false, true, ''
      )::text END,
    'payment_verification_requests', CASE WHEN to_regclass('public.partner_payment_verification_requests') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'status_requests'), false)
      THEN query_to_xml(
        'SELECT scheme::text AS scheme, status::text AS status, count(*) AS row_count '
        || 'FROM public.partner_payment_verification_requests GROUP BY scheme::text, status::text '
        || 'ORDER BY scheme::text, status::text', false, true, ''
      )::text END,
    'legacy_payment_verification_requests', CASE WHEN to_regclass('public.commercial_partner_payment_verification_requests') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'status_legacy_requests'), false)
      THEN query_to_xml(
        'SELECT scheme::text AS scheme, status::text AS status, count(*) AS row_count '
        || 'FROM public.commercial_partner_payment_verification_requests GROUP BY scheme::text, status::text '
        || 'ORDER BY scheme::text, status::text', false, true, ''
      )::text END,
    'commission_events', CASE WHEN to_regclass('public.commission_events') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'status_commissions'), false)
      THEN query_to_xml(
        'SELECT source_type::text AS source_type, status::text AS physical_status, '
        || 'release_condition::text AS release_condition, count(*) AS row_count '
        || 'FROM public.commission_events '
        || 'GROUP BY source_type::text, status::text, release_condition::text '
        || 'ORDER BY source_type::text, status::text, release_condition::text', false, true, ''
      )::text END,
    'commission_payment_balance_evidence', jsonb_build_object(
      'available', to_regclass('public.v_commission_event_payment_balances') IS NOT NULL
        AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'commission_payment_balances'), false),
      'null_xml_is_not_evidence_of_no_reservations_or_payments', TRUE,
      'evidence_xml', CASE WHEN to_regclass('public.v_commission_event_payment_balances') IS NOT NULL
        AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'commission_payment_balances'), false)
        THEN query_to_xml(
          'SELECT event.id AS commission_event_id, to_jsonb(event)->>''status'' AS physical_status, '
          || 'balance.payment_status::text AS payment_status, balance.paid_amount, balance.reserved_amount, '
          || 'balance.remaining_amount, balance.allocatable_amount '
          || 'FROM public.commission_events AS event '
          || 'JOIN public.v_commission_event_payment_balances AS balance '
          || 'ON balance.commission_event_id = event.id '
          || 'WHERE lower(COALESCE(balance.payment_status::text, '''')) IN (''partially_paid'', ''paid'') '
          || 'OR COALESCE(balance.reserved_amount, 0) <> 0 '
          || 'OR COALESCE(balance.paid_amount, 0) <> 0 '
          || 'ORDER BY event.id', false, true, ''
        )::text
        ELSE NULL
      END,
      'unsafe_reason', CASE WHEN to_regclass('public.v_commission_event_payment_balances') IS NULL
          OR NOT COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'commission_payment_balances'), false)
        THEN 'The payment-balance view or required columns are unavailable; no conclusion about paid, partially paid, or reserved commissions is safe.'
        ELSE NULL
      END
    ),
    'commission_settlements', CASE WHEN to_regclass('public.commission_settlements') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'status_commission_settlements'), false)
      THEN query_to_xml(
        'SELECT status::text AS status, count(*) AS row_count '
        || 'FROM public.commission_settlements GROUP BY status::text ORDER BY status::text', false, true, ''
      )::text END
  ) AS value
),
target_partner_xml AS (
  SELECT CASE
    WHEN to_regclass('public.commercial_partners') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_partner'), false)
    THEN query_to_xml(
      'SELECT id AS partner_id, to_jsonb(partner)->>''folio'' AS folio, '
      || 'to_jsonb(partner)->>''partner_model'' AS partner_model, '
      || 'to_jsonb(partner)->>''status'' AS status '
      || 'FROM public.commercial_partners AS partner '
      || 'WHERE lower(btrim(business_name)) = lower(''Abarrotes guacamayas'') '
      || 'ORDER BY id', false, true, ''
    )::text
    ELSE NULL
  END AS value
),
target_operational_summary_xml AS (
  SELECT CASE
    WHEN to_regclass('public.commercial_partners') IS NOT NULL
      AND to_regclass('public.v_commercial_partner_operational_summary') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_summary'), false)
    THEN query_to_xml(
      'WITH target AS (SELECT id FROM public.commercial_partners '
      || 'WHERE lower(btrim(business_name)) = lower(''Abarrotes guacamayas'')) '
      || 'SELECT summary.partner_id, summary.total_due, summary.total_paid, summary.pending_balance '
      || 'FROM public.v_commercial_partner_operational_summary AS summary '
      || 'WHERE summary.partner_id IN (SELECT id FROM target) ORDER BY summary.partner_id', false, true, ''
    )::text
    ELSE NULL
  END AS value
),
target_balance_reconstruction_xml AS (
  SELECT CASE
    WHEN to_regclass('public.commercial_partners') IS NOT NULL
      AND to_regclass('public.commercial_partner_movements') IS NOT NULL
      AND to_regclass('public.commercial_partner_movement_items') IS NOT NULL
      AND to_regclass('public.commercial_partner_payments') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_balance'), false)
    THEN query_to_xml(
      'WITH target AS (SELECT id FROM public.commercial_partners '
      || 'WHERE lower(btrim(business_name)) = lower(''Abarrotes guacamayas'')), '
      || 'generated AS (SELECT movement.partner_id, COALESCE(SUM(item.amount_due), 0) AS total_generated '
      || 'FROM public.commercial_partner_movements AS movement '
      || 'JOIN public.commercial_partner_movement_items AS item ON item.movement_id = movement.id '
      || 'WHERE movement.partner_id IN (SELECT id FROM target) '
      || 'AND lower(btrim(movement.movement_type::text)) = ''settlement'' '
      || 'AND lower(btrim(movement.status::text)) = ''completed'' '
      || 'AND COALESCE(item.quantity_sold, 0) > 0 GROUP BY movement.partner_id), '
      || 'paid AS (SELECT payment.partner_id, COALESCE(SUM(payment.amount), 0) AS total_cobrado '
      || 'FROM public.commercial_partner_payments AS payment '
      || 'WHERE payment.partner_id IN (SELECT id FROM target) '
      || 'AND lower(btrim(payment.status::text)) IN (''completed'', ''paid'') GROUP BY payment.partner_id) '
      || 'SELECT target.id AS partner_id, COALESCE(generated.total_generated, 0) AS total_generado, '
      || 'COALESCE(paid.total_cobrado, 0) AS total_cobrado, '
      || 'COALESCE(generated.total_generated, 0) - COALESCE(paid.total_cobrado, 0) AS saldo_pendiente '
      || 'FROM target LEFT JOIN generated ON generated.partner_id = target.id '
      || 'LEFT JOIN paid ON paid.partner_id = target.id ORDER BY target.id', false, true, ''
    )::text
    ELSE NULL
  END AS value
),
target_total_reconciliation_xml AS (
  SELECT CASE
    WHEN to_regclass('public.commercial_partners') IS NOT NULL
      AND to_regclass('public.v_commercial_partner_operational_summary') IS NOT NULL
      AND to_regclass('public.commercial_partner_movements') IS NOT NULL
      AND to_regclass('public.commercial_partner_movement_items') IS NOT NULL
      AND to_regclass('public.commercial_partner_payments') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_summary'), false)
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_balance'), false)
    THEN query_to_xml(
      'WITH target AS (SELECT id FROM public.commercial_partners '
      || 'WHERE lower(btrim(business_name)) = lower(''Abarrotes guacamayas'')), '
      || 'generated AS (SELECT movement.partner_id, COALESCE(SUM(item.amount_due), 0) AS total_generated '
      || 'FROM public.commercial_partner_movements AS movement '
      || 'JOIN public.commercial_partner_movement_items AS item ON item.movement_id = movement.id '
      || 'WHERE movement.partner_id IN (SELECT id FROM target) '
      || 'AND lower(btrim(movement.movement_type::text)) = ''settlement'' '
      || 'AND lower(btrim(movement.status::text)) = ''completed'' '
      || 'AND COALESCE(item.quantity_sold, 0) > 0 GROUP BY movement.partner_id), '
      || 'paid AS (SELECT payment.partner_id, COALESCE(SUM(payment.amount), 0) AS total_paid '
      || 'FROM public.commercial_partner_payments AS payment '
      || 'WHERE payment.partner_id IN (SELECT id FROM target) '
      || 'AND lower(btrim(payment.status::text)) IN (''completed'', ''paid'') GROUP BY payment.partner_id) '
      || 'SELECT target.id AS partner_id, summary.total_due AS summary_total_due, '
      || 'summary.total_paid AS summary_total_paid, summary.pending_balance AS summary_pending_balance, '
      || 'COALESCE(generated.total_generated, 0) AS reconstructed_total_generated, '
      || 'COALESCE(paid.total_paid, 0) AS reconstructed_total_paid, '
      || 'COALESCE(generated.total_generated, 0) - COALESCE(paid.total_paid, 0) AS reconstructed_pending_balance, '
      || '(abs(COALESCE(summary.total_due, 0) - COALESCE(generated.total_generated, 0)) < 0.005 '
      || 'AND abs(COALESCE(summary.total_paid, 0) - COALESCE(paid.total_paid, 0)) < 0.005 '
      || 'AND abs(COALESCE(summary.pending_balance, 0) - '
      || '(COALESCE(generated.total_generated, 0) - COALESCE(paid.total_paid, 0))) < 0.005) AS values_agree '
      || 'FROM target JOIN public.v_commercial_partner_operational_summary AS summary ON summary.partner_id = target.id '
      || 'LEFT JOIN generated ON generated.partner_id = target.id '
      || 'LEFT JOIN paid ON paid.partner_id = target.id ORDER BY target.id', false, true, ''
    )::text
    ELSE NULL
  END AS value
),
target_settlements_xml AS (
  SELECT CASE
    WHEN to_regclass('public.commercial_partners') IS NOT NULL
      AND to_regclass('public.commercial_partner_movements') IS NOT NULL
      AND to_regclass('public.commercial_partner_movement_items') IS NOT NULL
      AND to_regclass('public.commercial_partner_payments') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_settlements'), false)
    THEN query_to_xml(
      'WITH target AS (SELECT id FROM public.commercial_partners '
      || 'WHERE lower(btrim(business_name)) = lower(''Abarrotes guacamayas'')), '
      || 'due AS (SELECT item.movement_id, COALESCE(SUM(item.quantity_sold), 0) AS pieces_liquidated, '
      || 'COALESCE(SUM(item.amount_due), 0) AS total_generated '
      || 'FROM public.commercial_partner_movement_items AS item GROUP BY item.movement_id), '
      || 'paid AS (SELECT payment.movement_id, COALESCE(SUM(payment.amount), 0) AS total_paid '
      || 'FROM public.commercial_partner_payments AS payment '
      || 'WHERE lower(btrim(payment.status::text)) IN (''completed'', ''paid'') GROUP BY payment.movement_id) '
      || 'SELECT movement.id AS settlement_id, to_jsonb(movement)->>''folio'' AS folio, '
      || 'to_jsonb(movement)->>''movement_date'' AS movement_date, to_jsonb(movement)->>''status'' AS status, '
      || 'COALESCE(due.pieces_liquidated, 0) AS pieces_liquidated, '
      || 'COALESCE(due.total_generated, 0) AS total_generated, COALESCE(paid.total_paid, 0) AS total_paid, '
      || 'COALESCE(due.total_generated, 0) - COALESCE(paid.total_paid, 0) AS pending_balance '
      || 'FROM public.commercial_partner_movements AS movement '
      || 'LEFT JOIN due ON due.movement_id = movement.id LEFT JOIN paid ON paid.movement_id = movement.id '
      || 'WHERE movement.partner_id IN (SELECT id FROM target) '
      || 'AND lower(btrim(movement.movement_type::text)) = ''settlement'' '
      || 'ORDER BY movement.movement_date DESC NULLS LAST, movement.id', false, true, ''
    )::text
    ELSE NULL
  END AS value
),
target_liquidated_items_xml AS (
  SELECT CASE
    WHEN to_regclass('public.commercial_partners') IS NOT NULL
      AND to_regclass('public.commercial_partner_movements') IS NOT NULL
      AND to_regclass('public.commercial_partner_movement_items') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_liquidated_items'), false)
    THEN query_to_xml(
      'WITH target AS (SELECT id FROM public.commercial_partners '
      || 'WHERE lower(btrim(business_name)) = lower(''Abarrotes guacamayas'')) '
      || 'SELECT item.id AS movement_item_id, item.movement_id AS settlement_id, '
      || 'to_jsonb(item)->>''product_id'' AS product_id, to_jsonb(item)->>''product_name'' AS product_name, '
      || 'to_jsonb(item)->>''product_variant'' AS product_variant, to_jsonb(item)->>''product_size'' AS product_size, '
      || 'to_jsonb(item)->>''quantity_sold'' AS quantity_sold, to_jsonb(item)->>''amount_due'' AS amount_due '
      || 'FROM public.commercial_partner_movement_items AS item '
      || 'JOIN public.commercial_partner_movements AS movement ON movement.id = item.movement_id '
      || 'WHERE movement.partner_id IN (SELECT id FROM target) '
      || 'AND lower(btrim(movement.movement_type::text)) = ''settlement'' '
      || 'AND COALESCE((to_jsonb(item)->>''quantity_sold'')::numeric, 0) > 0 '
      || 'ORDER BY item.movement_id, item.id', false, true, ''
    )::text
    ELSE NULL
  END AS value
),
target_possession_xml AS (
  SELECT CASE
    WHEN to_regclass('public.commercial_partners') IS NOT NULL
      AND to_regclass('public.commercial_partner_movements') IS NOT NULL
      AND to_regclass('public.commercial_partner_movement_items') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_possession'), false)
    THEN query_to_xml(
      'WITH target AS (SELECT id FROM public.commercial_partners '
      || 'WHERE lower(btrim(business_name)) = lower(''Abarrotes guacamayas'')) '
      || 'SELECT COALESCE(to_jsonb(item)->>''product_id'', ''legacy:'' || '
      || 'COALESCE(to_jsonb(item)->>''product_name'', '''') || '':'' || '
      || 'COALESCE(to_jsonb(item)->>''product_variant'', '''') || '':'' || '
      || 'COALESCE(to_jsonb(item)->>''product_size'', '''')) AS product_identity, '
      || 'MAX(to_jsonb(item)->>''product_name'') AS product_name, '
      || 'MAX(to_jsonb(item)->>''product_variant'') AS product_variant, '
      || 'MAX(to_jsonb(item)->>''product_size'') AS product_size, '
      || 'SUM(COALESCE((to_jsonb(item)->>''quantity_delivered'')::numeric, 0)) AS delivered, '
      || 'SUM(COALESCE((to_jsonb(item)->>''quantity_sold'')::numeric, 0)) AS liquidated, '
      || 'SUM(COALESCE((to_jsonb(item)->>''quantity_withdrawn'')::numeric, 0)) AS withdrawn, '
      || 'SUM(COALESCE((to_jsonb(item)->>''quantity_spoiled'')::numeric, 0)) AS spoiled, '
      || 'SUM(COALESCE((to_jsonb(item)->>''quantity_delivered'')::numeric, 0) '
      || '- COALESCE((to_jsonb(item)->>''quantity_sold'')::numeric, 0) '
      || '- COALESCE((to_jsonb(item)->>''quantity_withdrawn'')::numeric, 0) '
      || '- COALESCE((to_jsonb(item)->>''quantity_spoiled'')::numeric, 0)) AS in_possession '
      || 'FROM public.commercial_partner_movement_items AS item '
      || 'JOIN public.commercial_partner_movements AS movement ON movement.id = item.movement_id '
      || 'WHERE movement.partner_id IN (SELECT id FROM target) '
      || 'AND lower(btrim(movement.status::text)) = ''completed'' '
      || 'GROUP BY COALESCE(to_jsonb(item)->>''product_id'', ''legacy:'' || '
      || 'COALESCE(to_jsonb(item)->>''product_name'', '''') || '':'' || '
      || 'COALESCE(to_jsonb(item)->>''product_variant'', '''') || '':'' || '
      || 'COALESCE(to_jsonb(item)->>''product_size'', '''')) '
      || 'HAVING SUM(COALESCE((to_jsonb(item)->>''quantity_delivered'')::numeric, 0) '
      || '- COALESCE((to_jsonb(item)->>''quantity_sold'')::numeric, 0) '
      || '- COALESCE((to_jsonb(item)->>''quantity_withdrawn'')::numeric, 0) '
      || '- COALESCE((to_jsonb(item)->>''quantity_spoiled'')::numeric, 0)) <> 0 '
      || 'ORDER BY product_identity', false, true, ''
    )::text
    ELSE NULL
  END AS value
),
target_units_xml AS (
  SELECT CASE WHEN to_regclass('public.commercial_partners') IS NOT NULL
      AND to_regclass('public.commercial_delivery_units') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_units'), false)
    THEN query_to_xml(
      'WITH target AS (SELECT id FROM public.commercial_partners '
      || 'WHERE lower(btrim(business_name)) = lower(''Abarrotes guacamayas'')) '
      || 'SELECT unit.id AS delivery_unit_id, to_jsonb(unit)->>''movement_id'' AS delivery_movement_id, '
      || 'to_jsonb(unit)->>''source_item_id'' AS delivery_item_id, to_jsonb(unit)->>''status'' AS status, '
      || 'to_jsonb(unit)->>''product_id'' AS product_id, to_jsonb(unit)->>''product_name'' AS product_name, '
      || 'to_jsonb(unit)->>''generated_at'' AS generated_at, to_jsonb(unit)->>''released_at'' AS released_at, '
      || 'to_jsonb(unit)->>''spoilage_movement_id'' AS spoilage_movement_id, '
      || 'to_jsonb(unit)->>''return_movement_id'' AS return_movement_id '
      || 'FROM public.commercial_delivery_units AS unit '
      || 'WHERE (to_jsonb(unit)->>''partner_id'') IN (SELECT id::text FROM target) '
      || 'AND COALESCE(to_jsonb(unit)->>''source_type'', ''comodato'') = ''comodato'' '
      || 'ORDER BY unit.id', false, true, ''
    )::text ELSE NULL END AS value
),
target_payments_xml AS (
  SELECT CASE WHEN to_regclass('public.commercial_partners') IS NOT NULL
      AND to_regclass('public.commercial_partner_payments') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_payments'), false)
    THEN query_to_xml(
      'WITH target AS (SELECT id FROM public.commercial_partners '
      || 'WHERE lower(btrim(business_name)) = lower(''Abarrotes guacamayas'')) '
      || 'SELECT payment.id AS payment_id, to_jsonb(payment)->>''movement_id'' AS settlement_id, '
      || 'to_jsonb(payment)->>''payment_date'' AS payment_date, to_jsonb(payment)->>''amount'' AS amount, '
      || 'to_jsonb(payment)->>''payment_method'' AS payment_method, to_jsonb(payment)->>''status'' AS status '
      || 'FROM public.commercial_partner_payments AS payment '
      || 'WHERE (to_jsonb(payment)->>''partner_id'') IN (SELECT id::text FROM target) '
      || 'ORDER BY payment.id', false, true, ''
    )::text ELSE NULL END AS value
),
target_requests_xml AS (
  SELECT CASE WHEN to_regclass('public.commercial_partners') IS NOT NULL
      AND to_regclass('public.partner_payment_verification_requests') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_requests'), false)
    THEN query_to_xml(
      'WITH target AS (SELECT id FROM public.commercial_partners '
      || 'WHERE lower(btrim(business_name)) = lower(''Abarrotes guacamayas'')) '
      || 'SELECT request.id AS request_id, to_jsonb(request)->>''folio'' AS folio, '
      || 'to_jsonb(request)->>''movement_id'' AS settlement_id, to_jsonb(request)->>''scheme'' AS scheme, '
      || 'to_jsonb(request)->>''status'' AS status, to_jsonb(request)->>''amount'' AS amount, '
      || 'to_jsonb(request)->>''approved_payment_id'' AS approved_payment_id '
      || 'FROM public.partner_payment_verification_requests AS request '
      || 'WHERE (to_jsonb(request)->>''partner_id'') IN (SELECT id::text FROM target) '
      || 'ORDER BY request.id', false, true, ''
    )::text ELSE NULL END AS value
),
target_legacy_requests_xml AS (
  SELECT CASE WHEN to_regclass('public.commercial_partners') IS NOT NULL
      AND to_regclass('public.commercial_partner_payment_verification_requests') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_legacy_requests'), false)
    THEN query_to_xml(
      'WITH target AS (SELECT id FROM public.commercial_partners '
      || 'WHERE lower(btrim(business_name)) = lower(''Abarrotes guacamayas'')) '
      || 'SELECT request.id AS request_id, to_jsonb(request)->>''folio'' AS folio, '
      || 'to_jsonb(request)->>''movement_id'' AS settlement_id, to_jsonb(request)->>''scheme'' AS scheme, '
      || 'to_jsonb(request)->>''status'' AS status, to_jsonb(request)->>''amount'' AS amount, '
      || 'to_jsonb(request)->>''approved_payment_id'' AS approved_payment_id '
      || 'FROM public.commercial_partner_payment_verification_requests AS request '
      || 'WHERE (to_jsonb(request)->>''partner_id'') IN (SELECT id::text FROM target) '
      || 'ORDER BY request.id', false, true, ''
    )::text ELSE NULL END AS value
),
payment_request_relation_json AS (
  SELECT jsonb_build_object(
    'partner_payment_verification_requests_exists',
      to_regclass('public.partner_payment_verification_requests') IS NOT NULL,
    'commercial_partner_payment_verification_requests_exists',
      to_regclass('public.commercial_partner_payment_verification_requests') IS NOT NULL,
    'both_relations_exist_and_require_contract_review',
      to_regclass('public.partner_payment_verification_requests') IS NOT NULL
      AND to_regclass('public.commercial_partner_payment_verification_requests') IS NOT NULL,
    'runtime_safe_relation_is_not_inferred_from_name', TRUE,
    'target_records_are_queryable_in_both_relations_when_present', TRUE
  ) AS value
),
target_commissions_xml AS (
  SELECT CASE WHEN to_regclass('public.commercial_partners') IS NOT NULL
      AND to_regclass('public.commercial_partner_movements') IS NOT NULL
      AND to_regclass('public.commission_events') IS NOT NULL
      AND to_regclass('public.v_commission_event_payment_balances') IS NOT NULL
      AND to_regclass('public.commission_settlement_items') IS NOT NULL
      AND to_regclass('public.commission_settlements') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_commissions'), false)
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_commission_settlements'), false)
    THEN query_to_xml(
      'WITH target AS (SELECT id FROM public.commercial_partners '
      || 'WHERE lower(btrim(business_name)) = lower(''Abarrotes guacamayas'')), '
      || 'target_movements AS (SELECT id FROM public.commercial_partner_movements '
      || 'WHERE partner_id IN (SELECT id FROM target)) '
      || 'SELECT event.id AS commission_event_id, to_jsonb(event)->>''source_type'' AS source_type, '
      || 'to_jsonb(event)->>''source_id'' AS source_id, to_jsonb(event)->>''source_item_id'' AS source_item_id, '
      || 'to_jsonb(event)->>''quantity'' AS quantity, to_jsonb(event)->>''unit_commission'' AS unit_commission, '
      || 'to_jsonb(event)->>''commission_amount'' AS commission_amount, '
      || 'to_jsonb(event)->>''status'' AS physical_status, '
      || 'balance.payment_status::text AS payment_status, balance.paid_amount, balance.reserved_amount, '
      || 'balance.remaining_amount, balance.allocatable_amount, '
      || 'COALESCE((SELECT json_agg(json_build_object('
      || '''settlement_id'', to_jsonb(settlement)->>''id'', '
      || '''folio'', to_jsonb(settlement)->>''folio'', '
      || '''status'', to_jsonb(settlement)->>''status'', '
      || '''amount'', to_jsonb(item)->>''amount'') '
      || 'ORDER BY to_jsonb(item)->>''id'')::text '
      || 'FROM public.commission_settlement_items AS item '
      || 'JOIN public.commission_settlements AS settlement '
      || 'ON (to_jsonb(settlement)->>''id'') = (to_jsonb(item)->>''settlement_id'') '
      || 'WHERE (to_jsonb(item)->>''commission_event_id'') = event.id::text), ''[]'') '
      || 'AS related_commission_settlements, ''available'' AS settlement_link_evidence '
      || 'FROM public.commission_events AS event '
      || 'JOIN public.v_commission_event_payment_balances AS balance '
      || 'ON balance.commission_event_id = event.id '
      || 'WHERE (to_jsonb(event)->>''partner_id'') IN (SELECT id::text FROM target) '
      || 'OR (to_jsonb(event)->>''source_id'') IN (SELECT id::text FROM target_movements) '
      || 'ORDER BY event.id', false, true, ''
    )::text
    WHEN to_regclass('public.commercial_partners') IS NOT NULL
      AND to_regclass('public.commercial_partner_movements') IS NOT NULL
      AND to_regclass('public.commission_events') IS NOT NULL
      AND to_regclass('public.v_commission_event_payment_balances') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_commissions'), false)
    THEN query_to_xml(
      'WITH target AS (SELECT id FROM public.commercial_partners '
      || 'WHERE lower(btrim(business_name)) = lower(''Abarrotes guacamayas'')), '
      || 'target_movements AS (SELECT id FROM public.commercial_partner_movements '
      || 'WHERE partner_id IN (SELECT id FROM target)) '
      || 'SELECT event.id AS commission_event_id, to_jsonb(event)->>''source_type'' AS source_type, '
      || 'to_jsonb(event)->>''source_id'' AS source_id, to_jsonb(event)->>''source_item_id'' AS source_item_id, '
      || 'to_jsonb(event)->>''quantity'' AS quantity, to_jsonb(event)->>''unit_commission'' AS unit_commission, '
      || 'to_jsonb(event)->>''commission_amount'' AS commission_amount, '
      || 'to_jsonb(event)->>''status'' AS physical_status, balance.payment_status::text AS payment_status, '
      || 'balance.paid_amount, balance.reserved_amount, balance.remaining_amount, balance.allocatable_amount, '
      || 'NULL::text AS related_commission_settlements, '
      || '''unavailable: commission settlement tables are absent'' AS settlement_link_evidence '
      || 'FROM public.commission_events AS event '
      || 'JOIN public.v_commission_event_payment_balances AS balance '
      || 'ON balance.commission_event_id = event.id '
      || 'WHERE (to_jsonb(event)->>''partner_id'') IN (SELECT id::text FROM target) '
      || 'OR (to_jsonb(event)->>''source_id'') IN (SELECT id::text FROM target_movements) '
      || 'ORDER BY event.id', false, true, ''
    )::text
    ELSE NULL
  END AS value
),
target_commission_settlements_xml AS (
  SELECT CASE WHEN to_regclass('public.commercial_partners') IS NOT NULL
      AND to_regclass('public.commercial_partner_movements') IS NOT NULL
      AND to_regclass('public.commission_events') IS NOT NULL
      AND to_regclass('public.commission_settlement_items') IS NOT NULL
      AND to_regclass('public.commission_settlements') IS NOT NULL
      AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_commission_settlements'), false)
    THEN query_to_xml(
      'WITH target AS (SELECT id FROM public.commercial_partners '
      || 'WHERE lower(btrim(business_name)) = lower(''Abarrotes guacamayas'')), '
      || 'target_movements AS (SELECT id FROM public.commercial_partner_movements '
      || 'WHERE partner_id IN (SELECT id FROM target)), '
      || 'target_events AS (SELECT event.id FROM public.commission_events AS event '
      || 'WHERE (to_jsonb(event)->>''partner_id'') IN (SELECT id::text FROM target) '
      || 'OR (to_jsonb(event)->>''source_id'') IN (SELECT id::text FROM target_movements)) '
      || 'SELECT item.id AS settlement_item_id, to_jsonb(item)->>''commission_event_id'' AS commission_event_id, '
      || 'to_jsonb(item)->>''settlement_id'' AS settlement_id, to_jsonb(item)->>''amount'' AS amount, '
      || 'to_jsonb(settlement)->>''folio'' AS settlement_folio, to_jsonb(settlement)->>''status'' AS settlement_status, '
      || 'to_jsonb(settlement)->>''total_amount'' AS settlement_total_amount '
      || 'FROM public.commission_settlement_items AS item '
      || 'JOIN public.commission_settlements AS settlement '
      || 'ON (to_jsonb(settlement)->>''id'') = (to_jsonb(item)->>''settlement_id'') '
      || 'WHERE (to_jsonb(item)->>''commission_event_id'') IN (SELECT id::text FROM target_events) '
      || 'ORDER BY item.id', false, true, ''
    )::text ELSE NULL END AS value
),
relationship_json AS (
  SELECT jsonb_build_object(
    'foreign_keys', (SELECT value FROM constraint_json),
    'catalog_evidence', jsonb_build_array(
      jsonb_build_object(
        'relationship', 'movement_item_to_movement',
        'observed_columns', ARRAY['commercial_partner_movement_items.movement_id', 'commercial_partner_movements.id'],
        'purpose', 'A settlement is represented by a movement whose movement_type is settlement; quantity_sold and amount_due are stored on its items.'
      ),
      jsonb_build_object(
        'relationship', 'payment_to_settlement',
        'observed_columns', ARRAY['commercial_partner_payments.movement_id', 'partner_payment_verification_requests.movement_id', 'partner_payment_verification_requests.approved_payment_id'],
        'purpose', 'Approved Comodato payments are linked to the settlement movement; the runtime catalog must confirm the foreign keys and deployed approval implementation.'
      ),
      jsonb_build_object(
        'relationship', 'physical_delivery_unit_to_delivery_item',
        'observed_columns', ARRAY['commercial_delivery_units.movement_id', 'commercial_delivery_units.source_item_id'],
        'purpose', 'Physical labels point to a delivery movement item. No verified unit-to-settlement allocation is asserted, so a future correction is aggregate-only unless runtime evidence proves a per-unit link.'
      ),
      jsonb_build_object(
        'relationship', 'commission_event_to_source',
        'observed_columns', ARRAY['commission_events.source_id', 'commission_events.source_item_id'],
        'purpose', 'The target data section exposes whether deployed Comodato commission events point to a settlement movement, a settlement item, or another source; payment and reservation state is read only from v_commission_event_payment_balances.'
      )
    )
  ) AS value
),
risk_json AS (
  SELECT jsonb_build_array(
    jsonb_build_object(
      'risk', 'The local UI creates a non-delivery settlement with separate client inserts for the movement and its items.',
      'impact', 'A future administrative reversal must use one server-side transaction and row locks; it cannot reuse that client sequence.'
    ),
    jsonb_build_object(
      'risk', 'The versioned repository does not contain the deployed definitions for the Comodato commission creation and commission-settlement RPCs.',
      'impact', 'The runtime function definitions and target-event source links returned here must be reviewed before defining any cancellation rule.'
    ),
    jsonb_build_object(
      'risk', 'Commercial delivery units are tied to delivery source items, while a settlement records aggregate product quantities.',
      'impact', 'Without a verified unit-level allocation table or event link, a correction can restore aggregate possession but cannot safely name individual labels as liquidated.'
    ),
    jsonb_build_object(
      'risk', 'Local legacy components still reference commercial_partner_payment_verification_requests, while the current versioned contract uses partner_payment_verification_requests.',
      'impact', 'The catalog output must decide which relation is deployed; a correction must only use the current verified contract.'
    ),
    jsonb_build_object(
      'risk', 'Commission cancellation safety depends on public.v_commission_event_payment_balances and its deployed columns.',
      'impact', 'The future RPC must block if the diagnostic reports missing payment-balance evidence, or if any target row has paid/reserved amounts, a paid or partially_paid payment status, or a non-cancelled related commission settlement.'
    )
  ) AS value
)
SELECT jsonb_build_object(
  'relations', (SELECT value FROM relation_json),
  'columns', (SELECT value FROM column_json),
  'constraints_and_foreign_keys', (SELECT value FROM constraint_json),
  'indexes', (SELECT value FROM index_json),
  'triggers', (SELECT value FROM trigger_json),
  'functions_and_rpcs', (SELECT value FROM function_json),
  'views', (SELECT value FROM view_json),
  'rls_policies', (SELECT value FROM policy_json),
  'relation_privileges', (SELECT value FROM privilege_json),
  'commission_payment_balance_contract', (SELECT value FROM commission_payment_balance_contract),
  'payment_verification_relation_discovery', (SELECT value FROM payment_request_relation_json),
  'states_found_xml', (SELECT value FROM status_xml),
  'proven_relationships', (SELECT value FROM relationship_json),
  'abarrotes_guacamayas', jsonb_build_object(
    'partner_xml', (SELECT value FROM target_partner_xml),
    'operational_summary_values_xml', (SELECT value FROM target_operational_summary_xml),
    'independent_balance_reconstruction_xml', (SELECT value FROM target_balance_reconstruction_xml),
    'summary_and_reconstruction_comparison_xml', (SELECT value FROM target_total_reconciliation_xml),
    'reconstruction_contract', jsonb_build_object(
      'valid_settlement_rule', 'movement_type = settlement and movement status = completed',
      'approved_payment_rule', 'payment status is completed or paid',
      'pending_or_rejected_requests_count_as_paid', FALSE,
      'null_xml_is_not_a_zero_balance', TRUE
    ),
    'settlements_xml', (SELECT value FROM target_settlements_xml),
    'liquidated_items_xml', (SELECT value FROM target_liquidated_items_xml),
    'current_possession_derived_from_movements_xml', (SELECT value FROM target_possession_xml),
    'delivery_units_xml', (SELECT value FROM target_units_xml),
    'payments_xml', (SELECT value FROM target_payments_xml),
    'partner_payment_verification_requests_xml', (SELECT value FROM target_requests_xml),
    'commercial_partner_payment_verification_requests_xml', (SELECT value FROM target_legacy_requests_xml),
    'commission_events_with_payment_balance_evidence', jsonb_build_object(
      'available', to_regclass('public.v_commission_event_payment_balances') IS NOT NULL
        AND COALESCE((SELECT all_present FROM column_contracts WHERE contract = 'target_commissions'), false),
      'unsafe_for_cancellation_when_unavailable', TRUE,
      'events_xml', (SELECT value FROM target_commissions_xml)
    ),
    'commission_settlement_items_xml', (SELECT value FROM target_commission_settlements_xml)
  ),
  'risks_and_ambiguities_before_implementation', (SELECT value FROM risk_json)
) AS diagnostic;
