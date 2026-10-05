-- Read-only diagnostic for the partner-payment approval and commission pipeline.
-- It discovers both known request-table names and returns exactly one JSONB row.

BEGIN;
SET TRANSACTION READ ONLY;

WITH request_relation_names(relation_name) AS (
  VALUES
    ('partner_payment_verification_requests'),
    ('commercial_partner_payment_verification_requests')
), inspected_relation_names(relation_name) AS (
  SELECT relation_name FROM request_relation_names
  UNION ALL VALUES
    ('commercial_partners'),
    ('commercial_partner_movements'),
    ('commercial_partner_movement_items'),
    ('commercial_partner_payments'),
    ('commission_events'),
    ('commission_settlement_items'),
    ('commission_settlements'),
    ('v_pending_payment_verifications'),
    ('v_partner_payment_verification_history'),
    ('v_commercial_partner_operational_summary'),
    ('v_commercial_partner_balances'),
    ('v_commission_events_effective'),
    ('v_seller_commission_movements')
), relation_catalog AS (
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
    END AS authenticated_can_delete
  FROM inspected_relation_names AS expected
  LEFT JOIN pg_class AS relation
    ON relation.relnamespace = 'public'::REGNAMESPACE
   AND relation.relname = expected.relation_name
), relation_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
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
    'options', COALESCE(to_jsonb(reloptions), '[]'::JSONB),
    'authenticated_privileges', jsonb_build_object(
      'select', authenticated_can_select,
      'insert', authenticated_can_insert,
      'update', authenticated_can_update,
      'delete', authenticated_can_delete
    )
  ) ORDER BY relation_name), '[]'::JSONB) AS value
  FROM relation_catalog
), request_columns AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'relation', column_row.table_name,
    'ordinal_position', column_row.ordinal_position,
    'column', column_row.column_name,
    'data_type', column_row.data_type,
    'udt_name', column_row.udt_name,
    'nullable', column_row.is_nullable = 'YES',
    'default', column_row.column_default
  ) ORDER BY column_row.table_name, column_row.ordinal_position), '[]'::JSONB) AS value
  FROM information_schema.columns AS column_row
  WHERE column_row.table_schema = 'public'
    AND column_row.table_name IN (SELECT relation_name FROM request_relation_names)
), request_constraints AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
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
    'referenced_relation', referenced.relname
  ) ORDER BY relation.relname, constraint_row.conname), '[]'::JSONB) AS value
  FROM pg_constraint AS constraint_row
  JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
  LEFT JOIN pg_class AS referenced ON referenced.oid = constraint_row.confrelid
  WHERE relation.relnamespace = 'public'::REGNAMESPACE
    AND relation.relname IN (SELECT relation_name FROM request_relation_names)
), request_indexes AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'relation', relation.relname,
    'name', index_relation.relname,
    'unique', index_row.indisunique,
    'primary', index_row.indisprimary,
    'valid', index_row.indisvalid,
    'definition', pg_get_indexdef(index_row.indexrelid)
  ) ORDER BY relation.relname, index_relation.relname), '[]'::JSONB) AS value
  FROM pg_index AS index_row
  JOIN pg_class AS relation ON relation.oid = index_row.indrelid
  JOIN pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
  WHERE relation.relnamespace = 'public'::REGNAMESPACE
    AND relation.relname IN (SELECT relation_name FROM request_relation_names)
), request_policies AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'relation', policy_row.tablename,
    'name', policy_row.policyname,
    'command', policy_row.cmd,
    'permissive', policy_row.permissive,
    'roles', to_jsonb(policy_row.roles),
    'using', policy_row.qual,
    'with_check', policy_row.with_check
  ) ORDER BY policy_row.tablename, policy_row.policyname), '[]'::JSONB) AS value
  FROM pg_policies AS policy_row
  WHERE policy_row.schemaname = 'public'
    AND policy_row.tablename IN (SELECT relation_name FROM request_relation_names)
), request_relation_privileges AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'relation', grant_row.table_name,
    'grantee', grant_row.grantee,
    'privilege', grant_row.privilege_type,
    'grantable', grant_row.is_grantable = 'YES'
  ) ORDER BY grant_row.table_name, grant_row.grantee, grant_row.privilege_type), '[]'::JSONB) AS value
  FROM information_schema.role_table_grants AS grant_row
  WHERE grant_row.table_schema = 'public'
    AND grant_row.table_name IN (
      SELECT relation_name FROM request_relation_names
      UNION ALL VALUES
        ('v_pending_payment_verifications'),
        ('v_partner_payment_verification_history')
    )
), relevant_functions AS MATERIALIZED (
  SELECT
    proc_row.oid,
    proc_row.proname,
    pg_get_function_identity_arguments(proc_row.oid) AS signature,
    pg_get_function_result(proc_row.oid) AS result_type,
    language_row.lanname AS language,
    proc_row.provolatile,
    proc_row.prosecdef,
    proc_row.proconfig,
    has_function_privilege('authenticated', proc_row.oid, 'EXECUTE')
      AS authenticated_can_execute,
    has_function_privilege('anon', proc_row.oid, 'EXECUTE')
      AS anon_can_execute,
    EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(proc_row.proacl, acldefault('f', proc_row.proowner))) AS acl_row
      WHERE acl_row.grantee = 0
        AND acl_row.privilege_type = 'EXECUTE'
    ) AS public_can_execute,
    pg_get_functiondef(proc_row.oid) AS definition
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
  JOIN pg_language AS language_row ON language_row.oid = proc_row.prolang
  WHERE namespace_row.nspname = 'public'
    AND proc_row.prokind = 'f'
    AND (
      proc_row.proname IN (
        'create_partner_payment_verification_request',
        'submit_partner_payment_verification_request',
        'approve_partner_payment_verification_request',
        'reject_partner_payment_verification_request',
        'cancel_partner_payment_verification_request',
        'get_partner_comodato_payment_options',
        'get_comodato_movement_pending_balance',
        'get_partner_comodato_pending_balance',
        'sync_comodato_commissions_for_movement'
      )
      OR proc_row.proname ~* '(partner.*payment.*verification|payment.*commission|sync.*commission)'
    )
), function_inventory AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', proname,
    'signature', signature,
    'returns', result_type,
    'language', language,
    'volatility', provolatile,
    'security_definer', prosecdef,
    'configuration', COALESCE(to_jsonb(proconfig), '[]'::JSONB),
    'authenticated_can_execute', authenticated_can_execute,
    'anon_can_execute', anon_can_execute,
    'public_can_execute', public_can_execute,
    'definition', definition
  ) ORDER BY proname, signature), '[]'::JSONB) AS value
  FROM relevant_functions
), relevant_triggers AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'relation', relation.relname,
    'name', trigger_row.tgname,
    'enabled', trigger_row.tgenabled,
    'definition', pg_get_triggerdef(trigger_row.oid, TRUE),
    'function', proc_row.proname,
    'function_signature', pg_get_function_identity_arguments(proc_row.oid),
    'function_definition', pg_get_functiondef(proc_row.oid)
  ) ORDER BY relation.relname, trigger_row.tgname), '[]'::JSONB) AS value
  FROM pg_trigger AS trigger_row
  JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
  JOIN pg_proc AS proc_row ON proc_row.oid = trigger_row.tgfoid
  WHERE NOT trigger_row.tgisinternal
    AND relation.relnamespace = 'public'::REGNAMESPACE
    AND (
      relation.relname IN (
        'commercial_partner_payments',
        'commercial_partner_movements',
        'commercial_partner_movement_items',
        'commission_events',
        'commercial_prospect_conversions'
      )
      OR lower(pg_get_functiondef(proc_row.oid)) LIKE '%commission%'
      OR lower(pg_get_functiondef(proc_row.oid)) LIKE '%commercial_partner_payments%'
    )
), relevant_views AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
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
    AND view_row.viewname IN (
      'v_pending_payment_verifications',
      'v_partner_payment_verification_history',
      'v_commercial_partner_operational_summary',
      'v_commercial_partner_balances',
      'v_commission_events_effective',
      'v_seller_commission_movements'
    )
), target_partners AS MATERIALIZED (
  SELECT
    partner.id,
    partner.business_name,
    to_jsonb(partner)->>'folio' AS folio,
    to_jsonb(partner)->>'partner_model' AS partner_model,
    to_jsonb(partner)->>'status' AS status,
    NULLIF(to_jsonb(partner)->>'assigned_to', '')::UUID AS assigned_to,
    CASE
      WHEN lower(btrim(partner.business_name)) = lower('Piter') THEN 'piter'
      WHEN lower(btrim(partner.business_name)) = lower('La tiendita') THEN 'la_tiendita'
      WHEN lower(partner.business_name) LIKE '%tiendita%'
        AND lower(COALESCE(to_jsonb(partner)->>'responsible_name', '')) LIKE '%nancy%'
        THEN 'la_tiendita_contact_match'
      ELSE 'name_fragment_match'
    END AS match_reason
  FROM public.commercial_partners AS partner
  WHERE lower(btrim(partner.business_name)) IN (
      lower('La tiendita'), lower('Piter')
    )
    OR (
      lower(partner.business_name) LIKE '%tiendita%'
      AND lower(COALESCE(to_jsonb(partner)->>'responsible_name', '')) LIKE '%nancy%'
    )
), target_partner_json AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'partner_id', id,
    'business_name', business_name,
    'folio', folio,
    'partner_model', partner_model,
    'status', status,
    'assigned_to', assigned_to,
    'match_reason', match_reason
  ) ORDER BY business_name, id), '[]'::JSONB) AS value
  FROM target_partners
), settlement_base AS MATERIALIZED (
  SELECT
    movement.id AS movement_id,
    movement.partner_id,
    movement.movement_date,
    movement.status,
    movement.created_at,
    COALESCE((
      SELECT SUM(COALESCE(item.amount_due, 0))
      FROM public.commercial_partner_movement_items AS item
      WHERE item.movement_id = movement.id
        AND COALESCE(item.quantity_sold, 0) > 0
    ), 0)::NUMERIC AS original_due,
    COALESCE((
      SELECT SUM(COALESCE(
        NULLIF(to_jsonb(adjustment)->>'amount_adjusted', '')::NUMERIC,
        0
      ))
      FROM public.commercial_partner_movement_items AS adjustment
      JOIN public.commercial_partner_movements AS adjustment_movement
        ON adjustment_movement.id = adjustment.movement_id
      JOIN public.commercial_partner_movement_items AS original
        ON original.id = NULLIF(
          to_jsonb(adjustment)->>'adjusts_movement_item_id', ''
        )::UUID
      WHERE original.movement_id = movement.id
        AND lower(btrim(adjustment_movement.movement_type::TEXT)) = 'adjustment'
        AND lower(btrim(adjustment_movement.status::TEXT)) = 'completed'
    ), 0)::NUMERIC AS adjusted_amount,
    COALESCE((
      SELECT SUM(COALESCE(payment.amount, 0))
      FROM public.commercial_partner_payments AS payment
      WHERE payment.movement_id = movement.id
        AND lower(btrim(payment.status::TEXT)) IN ('completed', 'paid')
    ), 0)::NUMERIC AS approved_paid_amount
  FROM public.commercial_partner_movements AS movement
  WHERE movement.partner_id IN (SELECT id FROM target_partners)
    AND lower(btrim(movement.movement_type::TEXT)) = 'settlement'
), settlement_evidence AS MATERIALIZED (
  SELECT
    settlement.*,
    GREATEST(
      settlement.original_due
        - settlement.adjusted_amount
        - settlement.approved_paid_amount,
      0
    )::NUMERIC AS independently_computed_effective_balance,
    EXISTS (
      SELECT 1
      FROM public.commission_events AS event
      WHERE NULLIF(to_jsonb(event)->>'source_id', '')::UUID = settlement.movement_id
         OR NULLIF(to_jsonb(event)->>'source_item_id', '')::UUID IN (
           SELECT item.id
           FROM public.commercial_partner_movement_items AS item
           WHERE item.movement_id = settlement.movement_id
         )
    ) AS commissions_already_synchronized
  FROM settlement_base AS settlement
), settlement_json AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'partner_id', settlement.partner_id,
    'movement_id', settlement.movement_id,
    'movement_date', settlement.movement_date,
    'movement_status', settlement.status,
    'created_at', settlement.created_at,
    'original_due', settlement.original_due,
    'adjusted_amount', settlement.adjusted_amount,
    'approved_paid_amount', settlement.approved_paid_amount,
    'effective_balance', settlement.independently_computed_effective_balance,
    'commissions_already_synchronized', settlement.commissions_already_synchronized
  ) ORDER BY settlement.movement_date, settlement.movement_id), '[]'::JSONB) AS value
  FROM settlement_evidence AS settlement
), partner_balance_json AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'partner_id', partner.id,
    'business_name', partner.business_name,
    'total_original_due', COALESCE(balance.total_original_due, 0),
    'total_adjusted', COALESCE(balance.total_adjusted, 0),
    'total_approved_paid', COALESCE(balance.total_approved_paid, 0),
    'effective_pending_balance', COALESCE(balance.effective_pending_balance, 0)
  ) ORDER BY partner.business_name, partner.id), '[]'::JSONB) AS value
  FROM target_partners AS partner
  LEFT JOIN LATERAL (
    SELECT
      SUM(settlement.original_due)::NUMERIC AS total_original_due,
      SUM(settlement.adjusted_amount)::NUMERIC AS total_adjusted,
      SUM(settlement.approved_paid_amount)::NUMERIC AS total_approved_paid,
      SUM(settlement.independently_computed_effective_balance)::NUMERIC
        AS effective_pending_balance
    FROM settlement_evidence AS settlement
    WHERE settlement.partner_id = partner.id
  ) AS balance ON TRUE
), operational_summary_document AS (
  SELECT CASE
    WHEN to_regclass('public.v_commercial_partner_operational_summary') IS NULL
      THEN NULL::XML
    ELSE query_to_xml(
      'SELECT jsonb_build_object('
      || '''partner_id'', summary.partner_id, '
      || '''total_due'', summary.total_due, '
      || '''total_paid'', summary.total_paid, '
      || '''pending_balance'', summary.pending_balance'
      || ')::text AS payload '
      || 'FROM public.v_commercial_partner_operational_summary AS summary '
      || 'JOIN public.commercial_partners AS partner ON partner.id = summary.partner_id '
      || 'WHERE lower(btrim(partner.business_name)) IN (lower(''La tiendita''), lower(''Piter'')) '
      || 'OR (lower(partner.business_name) LIKE ''%tiendita%'' '
      || 'AND lower(COALESCE(to_jsonb(partner)->>''responsible_name'', '''')) LIKE ''%nancy%'') '
      || 'ORDER BY summary.partner_id',
      TRUE,
      FALSE,
      ''
    )
  END AS document
), operational_summary_json AS (
  SELECT COALESCE(jsonb_agg(xml_row.payload::JSONB ORDER BY
    xml_row.payload::JSONB->>'partner_id'), '[]'::JSONB) AS value
  FROM operational_summary_document AS summary_document
  CROSS JOIN LATERAL XMLTABLE(
    '/table/row'
    PASSING summary_document.document
    COLUMNS payload TEXT PATH 'payload'
  ) AS xml_row
  WHERE summary_document.document IS NOT NULL
), target_payment_rows AS MATERIALIZED (
  SELECT
    payment.id AS payment_id,
    payment.partner_id,
    payment.movement_id,
    payment.amount,
    payment.status,
    payment.payment_date,
    NULLIF(to_jsonb(payment)->>'received_by', '')::UUID AS received_by,
    NULLIF(to_jsonb(payment)->>'created_at', '')::TIMESTAMPTZ AS created_at,
    to_jsonb(payment)->>'payment_method' AS payment_method
  FROM public.commercial_partner_payments AS payment
  WHERE payment.partner_id IN (SELECT id FROM target_partners)
), target_payment_json AS (
  SELECT COALESCE(jsonb_agg(to_jsonb(payment) ORDER BY
    payment.payment_date, payment.payment_id), '[]'::JSONB) AS value
  FROM target_payment_rows AS payment
), request_documents AS (
  SELECT
    request_relation.relation_name AS source_table,
    CASE
      WHEN to_regclass(format('public.%I', request_relation.relation_name)) IS NULL
        THEN NULL::XML
      ELSE query_to_xml(format(
        'SELECT jsonb_build_object('
        || '''request_id'', to_jsonb(request)->>''id'', '
        || '''folio'', to_jsonb(request)->>''folio'', '
        || '''status'', to_jsonb(request)->>''status'', '
        || '''scheme'', to_jsonb(request)->>''scheme'', '
        || '''amount'', to_jsonb(request)->>''amount'', '
        || '''movement_id'', to_jsonb(request)->>''movement_id'', '
        || '''partner_id'', to_jsonb(request)->>''partner_id'', '
        || '''created_by'', COALESCE(to_jsonb(request)->>''created_by'', to_jsonb(request)->>''submitted_by''), '
        || '''submitted_by'', to_jsonb(request)->>''submitted_by'', '
        || '''reviewed_by'', to_jsonb(request)->>''reviewed_by'', '
        || '''approved_payment_id'', to_jsonb(request)->>''approved_payment_id'', '
        || '''created_at'', to_jsonb(request)->>''created_at'', '
        || '''submitted_at'', to_jsonb(request)->>''submitted_at'', '
        || '''reviewed_at'', to_jsonb(request)->>''reviewed_at'''
        || ')::text AS payload '
        || 'FROM public.%I AS request '
        || 'WHERE (NULLIF(to_jsonb(request)->>''partner_id'', '''')::uuid IN ('
        || 'SELECT partner.id FROM public.commercial_partners AS partner '
        || 'WHERE lower(btrim(partner.business_name)) IN (lower(''La tiendita''), lower(''Piter'')) '
        || 'OR (lower(partner.business_name) LIKE ''%%tiendita%%'' '
        || 'AND lower(COALESCE(to_jsonb(partner)->>''responsible_name'', '''')) LIKE ''%%nancy%%''))) '
        || 'OR NULLIF(to_jsonb(request)->>''amount'', '''')::numeric IN (240.00, 150.00)) '
        || 'ORDER BY NULLIF(to_jsonb(request)->>''created_at'', '''')::timestamptz NULLS LAST, '
        || 'to_jsonb(request)->>''id''',
        request_relation.relation_name
      ), TRUE, FALSE, '')
    END AS document
  FROM request_relation_names AS request_relation
), request_rows AS MATERIALIZED (
  SELECT
    request_document.source_table,
    xml_row.payload::JSONB AS payload
  FROM request_documents AS request_document
  CROSS JOIN LATERAL XMLTABLE(
    '/table/row'
    PASSING request_document.document
    COLUMNS payload TEXT PATH 'payload'
  ) AS xml_row
  WHERE request_document.document IS NOT NULL
), request_state_documents AS (
  SELECT
    request_relation.relation_name AS source_table,
    CASE
      WHEN to_regclass(format('public.%I', request_relation.relation_name)) IS NULL
        THEN NULL::XML
      ELSE query_to_xml(format(
        'SELECT jsonb_build_object('
        || '''status'', lower(btrim(COALESCE(to_jsonb(request)->>''status'', ''''))), '
        || '''row_count'', count(*)'
        || ')::text AS payload '
        || 'FROM public.%I AS request '
        || 'GROUP BY lower(btrim(COALESCE(to_jsonb(request)->>''status'', ''''))) '
        || 'ORDER BY lower(btrim(COALESCE(to_jsonb(request)->>''status'', '''')))',
        request_relation.relation_name
      ), TRUE, FALSE, '')
    END AS document
  FROM request_relation_names AS request_relation
), request_state_rows AS MATERIALIZED (
  SELECT
    request_document.source_table,
    xml_row.payload::JSONB AS payload
  FROM request_state_documents AS request_document
  CROSS JOIN LATERAL XMLTABLE(
    '/table/row'
    PASSING request_document.document
    COLUMNS payload TEXT PATH 'payload'
  ) AS xml_row
  WHERE request_document.document IS NOT NULL
), typed_requests AS MATERIALIZED (
  SELECT
    request.source_table,
    request.payload,
    NULLIF(request.payload->>'request_id', '')::UUID AS request_id,
    NULLIF(request.payload->>'partner_id', '')::UUID AS partner_id,
    NULLIF(request.payload->>'movement_id', '')::UUID AS movement_id,
    NULLIF(request.payload->>'approved_payment_id', '')::UUID AS approved_payment_id,
    NULLIF(request.payload->>'created_by', '')::UUID AS created_by,
    NULLIF(request.payload->>'reviewed_by', '')::UUID AS reviewed_by,
    NULLIF(request.payload->>'amount', '')::NUMERIC AS amount,
    lower(btrim(COALESCE(request.payload->>'status', ''))) AS status,
    lower(btrim(COALESCE(request.payload->>'scheme', ''))) AS scheme,
    NULLIF(request.payload->>'created_at', '')::TIMESTAMPTZ AS created_at,
    NULLIF(request.payload->>'reviewed_at', '')::TIMESTAMPTZ AS reviewed_at
  FROM request_rows AS request
), request_evidence AS MATERIALIZED (
  SELECT
    request.*,
    EXISTS (
      SELECT 1
      FROM target_payment_rows AS payment
      WHERE payment.payment_id = request.approved_payment_id
    ) AS approved_payment_link_exists,
    (
      SELECT count(*)
      FROM target_payment_rows AS payment
      WHERE payment.partner_id = request.partner_id
        AND payment.movement_id IS NOT DISTINCT FROM request.movement_id
        AND payment.amount = request.amount
        AND lower(btrim(payment.status::TEXT)) IN ('completed', 'paid')
    ) AS matching_payment_count
  FROM typed_requests AS request
), request_evidence_json AS (
  SELECT COALESCE(jsonb_agg(
    request.payload || jsonb_build_object(
      'source_table', request.source_table,
      'approved_payment_link_exists', request.approved_payment_link_exists,
      'matching_payment_count', request.matching_payment_count,
      'has_related_payment', request.approved_payment_link_exists
        OR request.matching_payment_count > 0,
      'duplicate_payment_risk_if_approved_now',
        request.status IN ('draft', 'pending_review')
        AND request.matching_payment_count > 0
    ) ORDER BY request.created_at NULLS LAST, request.request_id
  ), '[]'::JSONB) AS value
  FROM request_evidence AS request
), request_status_json AS (
  SELECT jsonb_build_object(
    'all_states', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source_table', grouped.source_table,
        'status', grouped.status,
        'row_count', grouped.row_count
      ) ORDER BY grouped.source_table, grouped.status)
      FROM (
        SELECT
          source_table,
          payload->>'status' AS status,
          NULLIF(payload->>'row_count', '')::BIGINT AS row_count
        FROM request_state_rows
      ) AS grouped
    ), '[]'::JSONB),
    'states_treated_as_pending_by_frontend', jsonb_build_array('pending_review'),
    'pending_review_rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source_table', source_table,
        'request_id', request_id,
        'partner_id', partner_id,
        'movement_id', movement_id,
        'amount', amount,
        'status', status,
        'scheme', scheme,
        'created_by', created_by,
        'created_at', created_at
      ) ORDER BY created_at NULLS LAST, request_id)
      FROM typed_requests
      WHERE status = 'pending_review'
    ), '[]'::JSONB)
  ) AS value
), duplicate_request_json AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'partner_id', duplicate.partner_id,
    'movement_id', duplicate.movement_id,
    'amount', duplicate.amount,
    'request_count', duplicate.request_count,
    'request_ids', duplicate.request_ids,
    'source_tables', duplicate.source_tables,
    'statuses', duplicate.statuses
  ) ORDER BY duplicate.partner_id, duplicate.movement_id, duplicate.amount), '[]'::JSONB) AS value
  FROM (
    SELECT
      partner_id,
      movement_id,
      amount,
      count(*) AS request_count,
      jsonb_agg(request_id ORDER BY created_at NULLS LAST, request_id) AS request_ids,
      jsonb_agg(source_table ORDER BY source_table) AS source_tables,
      jsonb_agg(status ORDER BY status) AS statuses
    FROM typed_requests
    GROUP BY partner_id, movement_id, amount
    HAVING count(*) > 1
  ) AS duplicate
), duplicate_payment_json AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'partner_id', duplicate.partner_id,
    'movement_id', duplicate.movement_id,
    'amount', duplicate.amount,
    'payment_count', duplicate.payment_count,
    'payment_ids', duplicate.payment_ids,
    'warning', 'Potential duplicate only; repeated equal partial payments can be legitimate and require request-link review.'
  ) ORDER BY duplicate.partner_id, duplicate.movement_id, duplicate.amount), '[]'::JSONB) AS value
  FROM (
    SELECT
      partner_id,
      movement_id,
      amount,
      count(*) AS payment_count,
      jsonb_agg(payment_id ORDER BY payment_date, payment_id) AS payment_ids
    FROM target_payment_rows
    WHERE lower(btrim(status::TEXT)) IN ('completed', 'paid')
    GROUP BY partner_id, movement_id, amount
    HAVING count(*) > 1
  ) AS duplicate
), case_amount_evidence AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'case', case_row.case_name,
    'partner_id', case_row.partner_id,
    'expected_amount', case_row.expected_amount,
    'request_count', (
      SELECT count(*)
      FROM typed_requests AS request
      WHERE request.partner_id = case_row.partner_id
        AND request.amount = case_row.expected_amount
    ),
    'requests', COALESCE((
      SELECT jsonb_agg(request.payload || jsonb_build_object(
        'source_table', request.source_table
      ) ORDER BY request.created_at NULLS LAST, request.request_id)
      FROM typed_requests AS request
      WHERE request.partner_id = case_row.partner_id
        AND request.amount = case_row.expected_amount
    ), '[]'::JSONB),
    'approved_payment_count', (
      SELECT count(*)
      FROM target_payment_rows AS payment
      WHERE payment.partner_id = case_row.partner_id
        AND payment.amount = case_row.expected_amount
        AND lower(btrim(payment.status::TEXT)) IN ('completed', 'paid')
    ),
    'payments', COALESCE((
      SELECT jsonb_agg(to_jsonb(payment) ORDER BY payment.payment_date, payment.payment_id)
      FROM target_payment_rows AS payment
      WHERE payment.partner_id = case_row.partner_id
        AND payment.amount = case_row.expected_amount
    ), '[]'::JSONB)
  ) ORDER BY case_row.case_name, case_row.partner_id), '[]'::JSONB) AS value
  FROM (
    SELECT
      partner.id AS partner_id,
      CASE WHEN partner.match_reason = 'piter' THEN 'piter_150'
        ELSE 'la_tiendita_240'
      END AS case_name,
      CASE WHEN partner.match_reason = 'piter' THEN 150.00::NUMERIC
        ELSE 240.00::NUMERIC
      END AS expected_amount
    FROM target_partners AS partner
  ) AS case_row
), target_commission_events AS MATERIALIZED (
  SELECT event.*
  FROM public.commission_events AS event
  WHERE NULLIF(to_jsonb(event)->>'partner_id', '')::UUID IN (
      SELECT id FROM target_partners
    )
    OR NULLIF(to_jsonb(event)->>'source_id', '')::UUID IN (
      SELECT movement_id FROM settlement_evidence
    )
    OR NULLIF(to_jsonb(event)->>'source_item_id', '')::UUID IN (
      SELECT item.id
      FROM public.commercial_partner_movement_items AS item
      WHERE item.movement_id IN (SELECT movement_id FROM settlement_evidence)
    )
), commission_event_json AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'commission_event_id', event.id,
    'seller_id', to_jsonb(event)->>'seller_id',
    'partner_id', to_jsonb(event)->>'partner_id',
    'source_type', to_jsonb(event)->>'source_type',
    'source_id', to_jsonb(event)->>'source_id',
    'source_item_id', to_jsonb(event)->>'source_item_id',
    'status', to_jsonb(event)->>'status',
    'quantity', to_jsonb(event)->>'quantity',
    'unit_commission', to_jsonb(event)->>'unit_commission',
    'commission_amount', to_jsonb(event)->>'commission_amount',
    'earned_at', to_jsonb(event)->>'earned_at',
    'available_at', to_jsonb(event)->>'available_at',
    'related_commission_settlement_items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'settlement_item_id', item.id,
        'settlement_id', item.settlement_id,
        'amount', to_jsonb(item)->>'amount',
        'settlement_folio', to_jsonb(settlement)->>'folio',
        'settlement_status', to_jsonb(settlement)->>'status'
      ) ORDER BY item.id)
      FROM public.commission_settlement_items AS item
      JOIN public.commission_settlements AS settlement
        ON settlement.id = item.settlement_id
      WHERE item.commission_event_id = event.id
    ), '[]'::JSONB)
  ) ORDER BY event.id), '[]'::JSONB) AS value
  FROM target_commission_events AS event
), admin_access_assessment AS (
  SELECT jsonb_build_object(
    'request_relations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'relation', relation.relation_name,
        'exists', relation.oid IS NOT NULL,
        'rls_enabled', COALESCE(relation.relrowsecurity, FALSE),
        'authenticated_has_select_grant', relation.authenticated_can_select,
        'admin_select_policy_found', EXISTS (
          SELECT 1
          FROM pg_policies AS policy_row
          WHERE policy_row.schemaname = 'public'
            AND policy_row.tablename = relation.relation_name
            AND policy_row.cmd IN ('SELECT', 'ALL')
            AND (
              lower(COALESCE(policy_row.qual, '')) LIKE '%role%admin%'
              OR lower(COALESCE(policy_row.qual, '')) LIKE '%current_user_is_active_admin%'
            )
        ),
        'admin_read_structurally_allowed', relation.oid IS NOT NULL
          AND relation.authenticated_can_select
          AND (
            NOT COALESCE(relation.relrowsecurity, FALSE)
            OR EXISTS (
              SELECT 1
              FROM pg_policies AS policy_row
              WHERE policy_row.schemaname = 'public'
                AND policy_row.tablename = relation.relation_name
                AND policy_row.cmd IN ('SELECT', 'ALL')
                AND (
                  lower(COALESCE(policy_row.qual, '')) LIKE '%role%admin%'
                  OR lower(COALESCE(policy_row.qual, '')) LIKE '%current_user_is_active_admin%'
                )
            )
          )
      ) ORDER BY relation.relation_name)
      FROM relation_catalog AS relation
      WHERE relation.relation_name IN (SELECT relation_name FROM request_relation_names)
    ), '[]'::JSONB),
    'pending_view', jsonb_build_object(
      'exists', to_regclass('public.v_pending_payment_verifications') IS NOT NULL,
      'security_invoker', COALESCE((
        SELECT COALESCE(relation.reloptions, ARRAY[]::TEXT[])
          @> ARRAY['security_invoker=true']
        FROM pg_class AS relation
        WHERE relation.oid = to_regclass('public.v_pending_payment_verifications')
      ), FALSE),
      'authenticated_has_select_grant', COALESCE((
        SELECT has_table_privilege('authenticated', relation.oid, 'SELECT')
        FROM pg_class AS relation
        WHERE relation.oid = to_regclass('public.v_pending_payment_verifications')
      ), FALSE)
    ),
    'approval_rpc', COALESCE((
      SELECT jsonb_build_object(
        'exists', TRUE,
        'signature', function_row.signature,
        'security_definer', function_row.prosecdef,
        'authenticated_can_execute', function_row.authenticated_can_execute,
        'anon_can_execute', function_row.anon_can_execute,
        'public_can_execute', function_row.public_can_execute,
        'checks_admin_role', lower(function_row.definition) LIKE '%role%admin%',
        'admin_approval_structurally_allowed', function_row.prosecdef
          AND function_row.authenticated_can_execute
          AND lower(function_row.definition) LIKE '%role%admin%'
      )
      FROM relevant_functions AS function_row
      WHERE function_row.proname = 'approve_partner_payment_verification_request'
      ORDER BY function_row.signature
      LIMIT 1
    ), jsonb_build_object('exists', FALSE))
  ) AS value
), pipeline_assessment AS (
  SELECT jsonb_build_object(
    'create_rpc_writes_relation_names', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'signature', function_row.signature,
        'writes_partner_payment_verification_requests',
          lower(function_row.definition) LIKE '%insert into public.partner_payment_verification_requests%',
        'writes_commercial_partner_payment_verification_requests',
          lower(function_row.definition) LIKE '%insert into public.commercial_partner_payment_verification_requests%',
        'created_status_is_draft',
          lower(function_row.definition) LIKE '%''draft''%'
      ))
      FROM relevant_functions AS function_row
      WHERE function_row.proname = 'create_partner_payment_verification_request'
    ), '[]'::JSONB),
    'submit_rpc_sets_pending_review', COALESCE((
      SELECT bool_or(lower(function_row.definition) LIKE '%pending_review%')
      FROM relevant_functions AS function_row
      WHERE function_row.proname = 'submit_partner_payment_verification_request'
    ), FALSE),
    'approval_rpc_inserts_comodato_payment', COALESCE((
      SELECT bool_or(lower(function_row.definition)
        LIKE '%insert into public.commercial_partner_payments%')
      FROM relevant_functions AS function_row
      WHERE function_row.proname = 'approve_partner_payment_verification_request'
    ), FALSE),
    'approval_rpc_calls_comodato_commission_sync', COALESCE((
      SELECT bool_or(lower(function_row.definition)
        LIKE '%sync_comodato_commissions_for_movement%')
      FROM relevant_functions AS function_row
      WHERE function_row.proname = 'approve_partner_payment_verification_request'
    ), FALSE),
    'payment_trigger_calls_comodato_commission_sync', EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
      JOIN pg_proc AS proc_row ON proc_row.oid = trigger_row.tgfoid
      WHERE relation.oid = to_regclass('public.commercial_partner_payments')
        AND NOT trigger_row.tgisinternal
        AND lower(pg_get_functiondef(proc_row.oid))
          LIKE '%sync_comodato_commissions_for_movement%'
    ),
    'commission_sync_has_automatic_payment_path',
      COALESCE((
        SELECT bool_or(lower(function_row.definition)
          LIKE '%sync_comodato_commissions_for_movement%')
        FROM relevant_functions AS function_row
        WHERE function_row.proname = 'approve_partner_payment_verification_request'
      ), FALSE)
      OR EXISTS (
        SELECT 1
        FROM pg_trigger AS trigger_row
        JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
        JOIN pg_proc AS proc_row ON proc_row.oid = trigger_row.tgfoid
        WHERE relation.oid = to_regclass('public.commercial_partner_payments')
          AND NOT trigger_row.tgisinternal
          AND lower(pg_get_functiondef(proc_row.oid))
            LIKE '%sync_comodato_commissions_for_movement%'
      ),
    'canonical_relation_is_not_inferred_from_name', TRUE
  ) AS value
)
SELECT jsonb_build_object(
  'diagnostic_version', '20261003_partner_payment_approval_pipeline',
  'read_only', TRUE,
  'request_relation_discovery', jsonb_build_object(
    'relations', (SELECT value FROM relation_inventory),
    'columns', (SELECT value FROM request_columns),
    'constraints', (SELECT value FROM request_constraints),
    'indexes', (SELECT value FROM request_indexes),
    'rls_policies', (SELECT value FROM request_policies),
    'grants', (SELECT value FROM request_relation_privileges),
    'canonical_relation_is_not_inferred_from_name', TRUE
  ),
  'rpc_and_function_definitions', (SELECT value FROM function_inventory),
  'commission_and_payment_triggers', (SELECT value FROM relevant_triggers),
  'relevant_view_definitions', (SELECT value FROM relevant_views),
  'admin_read_and_approval_assessment', (SELECT value FROM admin_access_assessment),
  'pipeline_assessment', (SELECT value FROM pipeline_assessment),
  'pending_review_state_evidence', (SELECT value FROM request_status_json),
  'target_partners', (SELECT value FROM target_partner_json),
  'target_partner_balances', (SELECT value FROM partner_balance_json),
  'target_operational_summary', (SELECT value FROM operational_summary_json),
  'target_settlements', (SELECT value FROM settlement_json),
  'target_payments', (SELECT value FROM target_payment_json),
  'target_requests_from_every_existing_request_relation',
    (SELECT value FROM request_evidence_json),
  'case_amount_evidence', (SELECT value FROM case_amount_evidence),
  'commission_events_linked_to_target_settlements',
    (SELECT value FROM commission_event_json),
  'duplicate_request_candidates', (SELECT value FROM duplicate_request_json),
  'duplicate_payment_candidates', (SELECT value FROM duplicate_payment_json),
  'safety_notes', jsonb_build_array(
    'No request is approved, rejected, cancelled, inserted or updated by this diagnostic.',
    'No payment or commission event is inserted or synchronized by this diagnostic.',
    'A matching payment without approved_payment_id is evidence for review, not permission to approve or create another payment.',
    'Potential duplicate equal-amount payments can be legitimate partial payments; inspect request links and timestamps before correction.'
  )
) AS diagnostic;

ROLLBACK;
