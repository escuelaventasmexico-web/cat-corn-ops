-- Read-only verification for individual commercial-delivery labels.
-- Run only after 20260830_commercial_delivery_unit_control.sql has been applied.
-- Returns exactly one JSONB object and never creates or changes data.

WITH expected_relations(name, kind) AS (
  VALUES
    ('commercial_delivery_units'::TEXT, 'r'::"char"),
    ('commercial_delivery_audit_events', 'r'::"char"),
    ('v_wholesale_order_totals', 'v'::"char"),
    ('v_commercial_partner_wholesale_summary', 'v'::"char"),
    ('v_commercial_partner_wholesale_top_products', 'v'::"char"),
    ('v_b2b_top_products', 'v'::"char"),
    ('v_b2b_partner_next_visit', 'v'::"char"),
    ('v_pending_payment_verifications', 'v'::"char")
), relations AS (
  SELECT e.name, e.kind AS expected_kind, c.oid, c.relkind
  FROM expected_relations e
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.name
), expected_columns(view_name, ordinal_position, column_name, expected_type) AS (
  VALUES
    ('v_wholesale_order_totals'::TEXT, 1, 'wholesale_order_id', 'uuid'),
    ('v_wholesale_order_totals', 2, 'partner_id', 'uuid'),
    ('v_wholesale_order_totals', 3, 'contract_id', 'uuid'),
    ('v_wholesale_order_totals', 4, 'order_folio', 'text'),
    ('v_wholesale_order_totals', 5, 'order_date', 'date'),
    ('v_wholesale_order_totals', 6, 'delivery_date', 'date'),
    ('v_wholesale_order_totals', 7, 'payment_due_at', 'timestamp with time zone'),
    ('v_wholesale_order_totals', 8, 'minimum_order_pieces', 'integer'),
    ('v_wholesale_order_totals', 9, 'order_status', 'text'),
    ('v_wholesale_order_totals', 10, 'total_pieces', 'bigint'),
    ('v_wholesale_order_totals', 11, 'total_amount', 'numeric'),
    ('v_wholesale_order_totals', 12, 'total_paid', 'numeric'),
    ('v_wholesale_order_totals', 13, 'pending_amount', 'numeric'),
    ('v_wholesale_order_totals', 14, 'computed_payment_status', 'text'),
    ('v_commercial_partner_wholesale_summary', 1, 'partner_id', 'uuid'),
    ('v_commercial_partner_wholesale_summary', 2, 'folio', 'text'),
    ('v_commercial_partner_wholesale_summary', 3, 'business_name', 'text'),
    ('v_commercial_partner_wholesale_summary', 4, 'responsible_name', 'text'),
    ('v_commercial_partner_wholesale_summary', 5, 'partner_model', 'text'),
    ('v_commercial_partner_wholesale_summary', 6, 'wholesale_status', 'text'),
    ('v_commercial_partner_wholesale_summary', 7, 'total_purchased', 'numeric'),
    ('v_commercial_partner_wholesale_summary', 8, 'total_paid', 'numeric'),
    ('v_commercial_partner_wholesale_summary', 9, 'pending_balance', 'numeric'),
    ('v_commercial_partner_wholesale_summary', 10, 'total_pieces', 'numeric'),
    ('v_commercial_partner_wholesale_summary', 11, 'purchase_count', 'bigint'),
    ('v_commercial_partner_wholesale_summary', 12, 'last_purchase_date', 'date'),
    ('v_commercial_partner_wholesale_top_products', 1, 'partner_id', 'uuid'),
    ('v_commercial_partner_wholesale_top_products', 2, 'product_name', 'text'),
    ('v_commercial_partner_wholesale_top_products', 3, 'product_variant', 'text'),
    ('v_commercial_partner_wholesale_top_products', 4, 'product_size', 'text'),
    ('v_commercial_partner_wholesale_top_products', 5, 'total_quantity', 'bigint'),
    ('v_commercial_partner_wholesale_top_products', 6, 'total_amount', 'numeric'),
    ('v_b2b_top_products', 1, 'product_name', 'text'),
    ('v_b2b_top_products', 2, 'product_variant', 'text'),
    ('v_b2b_top_products', 3, 'product_size', 'text'),
    ('v_b2b_top_products', 4, 'total_quantity', 'integer'),
    ('v_b2b_top_products', 5, 'total_amount', 'numeric'),
    ('v_b2b_top_products', 6, 'comodato_quantity', 'integer'),
    ('v_b2b_top_products', 7, 'wholesale_quantity', 'integer'),
    ('v_b2b_top_products', 8, 'comodato_amount', 'numeric'),
    ('v_b2b_top_products', 9, 'wholesale_amount', 'numeric'),
    ('v_b2b_top_products', 10, 'partners_count', 'integer'),
    ('v_b2b_top_products', 11, 'rank_by_quantity', 'integer'),
    ('v_b2b_partner_next_visit', 1, 'partner_id', 'uuid'),
    ('v_b2b_partner_next_visit', 2, 'next_visit_date', 'date'),
    ('v_b2b_partner_next_visit', 3, 'next_visit_reason', 'text'),
    ('v_b2b_partner_next_visit', 4, 'movement_date', 'timestamp with time zone'),
    ('v_b2b_partner_next_visit', 5, 'movement_type', 'text'),
    ('v_b2b_partner_next_visit', 6, 'movement_notes', 'text'),
    ('v_pending_payment_verifications', 1, 'request_id', NULL::TEXT),
    ('v_pending_payment_verifications', 2, 'folio', NULL),
    ('v_pending_payment_verifications', 3, 'scheme', NULL),
    ('v_pending_payment_verifications', 4, 'partner_id', NULL),
    ('v_pending_payment_verifications', 5, 'partner_folio', NULL),
    ('v_pending_payment_verifications', 6, 'business_name', NULL),
    ('v_pending_payment_verifications', 7, 'responsible_name', NULL),
    ('v_pending_payment_verifications', 8, 'amount', NULL),
    ('v_pending_payment_verifications', 9, 'payment_date', NULL),
    ('v_pending_payment_verifications', 10, 'payment_method', NULL),
    ('v_pending_payment_verifications', 11, 'payment_reference', NULL),
    ('v_pending_payment_verifications', 12, 'notes', NULL),
    ('v_pending_payment_verifications', 13, 'proof_path', NULL),
    ('v_pending_payment_verifications', 14, 'proof_file_name', NULL),
    ('v_pending_payment_verifications', 15, 'proof_mime_type', NULL),
    ('v_pending_payment_verifications', 16, 'proof_size_bytes', NULL),
    ('v_pending_payment_verifications', 17, 'submitted_by', NULL),
    ('v_pending_payment_verifications', 18, 'seller_name', NULL),
    ('v_pending_payment_verifications', 19, 'submitted_at', NULL),
    ('v_pending_payment_verifications', 20, 'movement_id', NULL),
    ('v_pending_payment_verifications', 21, 'wholesale_order_id', NULL),
    ('v_pending_payment_verifications', 22, 'source_folio', NULL),
    ('v_pending_payment_verifications', 23, 'source_total', NULL),
    ('v_pending_payment_verifications', 24, 'source_paid', NULL),
    ('v_pending_payment_verifications', 25, 'current_source_balance', NULL),
    ('v_pending_payment_verifications', 26, 'current_partner_balance', NULL),
    ('v_pending_payment_verifications', 27, 'minutes_since_submission', NULL),
    ('v_pending_payment_verifications', 28, 'piece_sale_id', NULL),
    ('v_pending_payment_verifications', 29, 'piece_units', NULL)
), view_columns AS (
  SELECT e.view_name, e.ordinal_position, e.column_name AS expected_name, e.expected_type,
    a.attname AS actual_name, format_type(a.atttypid, a.atttypmod) AS actual_type,
    a.atttypid IS NOT NULL AND a.attname=e.column_name
      AND (e.expected_type IS NULL OR format_type(a.atttypid,a.atttypmod)=e.expected_type) AS matches
  FROM expected_columns e
  LEFT JOIN pg_class c ON c.oid=to_regclass('public.' || e.view_name)
  LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=e.ordinal_position AND a.attnum>0 AND NOT a.attisdropped
), movement_item_product AS (
  SELECT a.attnotnull, format_type(a.atttypid,a.atttypmod) AS data_type,
    EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.commercial_partner_movement_items'::REGCLASS AND c.contype='f' AND c.confrelid='public.products'::REGCLASS AND a.attnum=ANY(c.conkey)) AS has_products_fk
  FROM pg_attribute a
  WHERE a.attrelid='public.commercial_partner_movement_items'::REGCLASS AND a.attname='product_id' AND a.attnum>0 AND NOT a.attisdropped
), wholesale_delivery_date AS (
  SELECT a.attnotnull, format_type(a.atttypid,a.atttypmod) AS data_type
  FROM pg_attribute a
  WHERE a.attrelid='public.wholesale_orders'::REGCLASS AND a.attname='delivery_date' AND a.attnum>0 AND NOT a.attisdropped
), due_date_trigger AS (
  SELECT p.oid AS function_oid, pg_get_functiondef(p.oid) AS function_definition,
    EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.wholesale_orders'::REGCLASS AND t.tgname='trg_set_wholesale_payment_due_at' AND t.tgfoid=p.oid AND NOT t.tgisinternal) AS trigger_exists
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='set_wholesale_payment_due_at' AND pg_get_function_identity_arguments(p.oid)=''
), expected_rpcs(name, arguments) AS (
  VALUES
    ('create_comodato_delivery_with_units'::TEXT, 'p_partner_id uuid, p_movement_date date, p_next_visit_date date, p_next_visit_reason text, p_notes text, p_items jsonb'),
    ('create_wholesale_order_with_units', 'p_partner_id uuid, p_order_date date, p_notes text, p_items jsonb, p_payment_terms_hours integer'),
    ('mark_commercial_delivery_units_printed', 'p_unit_ids uuid[], p_reprint_reason text'),
    ('scan_commercial_delivery_unit_for_release', 'p_barcode_value text, p_partner_id uuid'),
    ('register_partner_spoilage_by_barcode', 'p_barcode_value text, p_partner_id uuid, p_reason text'),
    ('register_partner_spoilage_exception', 'p_partner_id uuid, p_item jsonb, p_reason text'),
    ('register_partner_return_by_barcode', 'p_barcode_value text, p_partner_id uuid, p_reason text'),
    ('void_or_replace_commercial_delivery_unit', 'p_unit_id uuid, p_reason text, p_replace boolean')
), rpc_contract AS (
  SELECT e.name, e.arguments, p.oid, pg_get_function_identity_arguments(p.oid) AS actual_arguments
  FROM expected_rpcs e LEFT JOIN pg_namespace n ON n.nspname='public'
  LEFT JOIN pg_proc p ON p.pronamespace=n.oid AND p.proname=e.name
), audit_security AS (
  SELECT p.oid IS NOT NULL AS exists, p.prosecdef AS security_definer,
    COALESCE(array_to_string(p.proconfig,','),'') ILIKE '%search_path=public, pg_temp%' AS pinned_search_path,
    has_function_privilege('public',p.oid,'EXECUTE') AS public_execute,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role_execute
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='_commercial_delivery_audit'
    AND pg_get_function_identity_arguments(p.oid)='p_event text, p_partner uuid, p_movement uuid, p_order uuid, p_unit uuid, p_reason text, p_metadata jsonb'
), protected_tables AS (
  SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
    EXISTS(SELECT 1 FROM pg_policies policy WHERE policy.schemaname='public' AND policy.tablename=c.relname AND policy.cmd='ALL' AND policy.roles @> ARRAY['authenticated']::NAME[] AND COALESCE(policy.qual,'') ILIKE '%false%' AND COALESCE(policy.with_check,'') ILIKE '%false%') AS direct_write_denied
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('commercial_delivery_units','commercial_delivery_audit_events')
), status_constraints AS (
  SELECT c.conrelid::REGCLASS::TEXT AS table_name, pg_get_constraintdef(c.oid,true) AS definition
  FROM pg_constraint c
  WHERE c.conname IN ('commercial_partner_movements_status_check','wholesale_orders_order_status_check','commercial_delivery_units_status_check')
), pending_due_leaks AS (
  SELECT id, order_folio, order_status, payment_due_at FROM public.wholesale_orders
  WHERE order_status IN ('draft','pending_release') AND payment_due_at IS NOT NULL
), pending_balance_leaks AS (
  SELECT wholesale_order_id, order_status, total_paid, pending_amount, computed_payment_status
  FROM public.v_wholesale_order_totals
  WHERE order_status IN ('draft','pending_release') AND (total_paid<>0 OR pending_amount<>0 OR computed_payment_status<>'not_released')
), pending_payment_leaks AS (
  SELECT p.id, p.wholesale_order_id FROM public.wholesale_payments p
  JOIN public.wholesale_orders o ON o.id=p.wholesale_order_id WHERE o.order_status='pending_release'
), delivery_unit_invariants AS (
  SELECT u.source_type, COALESCE(u.movement_id,u.wholesale_order_id) AS source_id,
    COUNT(*) FILTER(WHERE u.status='released') AS released_units,
    COUNT(*) FILTER(WHERE u.status IN ('generated','printed','scanned')) AS pending_units,
    COUNT(*) FILTER(WHERE u.status='voided') AS voided_units,
    COUNT(*) FILTER(WHERE u.status='replaced' AND u.replaced_by_unit_id IS NULL) AS replaced_without_successor
  FROM public.commercial_delivery_units u GROUP BY u.source_type,COALESCE(u.movement_id,u.wholesale_order_id)
), released_source_mismatches AS (
  SELECT i.*, required.required_units
  FROM delivery_unit_invariants i
  LEFT JOIN public.commercial_partner_movements m ON i.source_type='comodato' AND m.id=i.source_id
  LEFT JOIN public.wholesale_orders o ON i.source_type='mayoreo' AND o.id=i.source_id
  LEFT JOIN LATERAL (
    SELECT CASE WHEN i.source_type='comodato' THEN
      COALESCE((SELECT SUM(x.quantity_delivered) FROM public.commercial_partner_movement_items x WHERE x.movement_id=i.source_id),0)::BIGINT
    ELSE COALESCE((SELECT SUM(x.quantity) FROM public.wholesale_order_items x WHERE x.wholesale_order_id=i.source_id),0)::BIGINT END AS required_units
  ) required ON TRUE
  WHERE (m.status='completed' OR o.order_status IN ('delivered','completed'))
    AND (i.released_units<>required.required_units OR i.pending_units<>0 OR i.voided_units<>0 OR i.replaced_without_successor<>0)
), active_void_or_replacement_leaks AS (
  SELECT u.id, u.barcode_value, u.status, u.source_type, COALESCE(u.movement_id,u.wholesale_order_id) AS source_id
  FROM public.commercial_delivery_units u
  LEFT JOIN public.commercial_partner_movements m ON u.source_type='comodato' AND m.id=u.movement_id
  LEFT JOIN public.wholesale_orders o ON u.source_type='mayoreo' AND o.id=u.wholesale_order_id
  WHERE (m.status='pending_release' OR o.order_status='pending_release')
    AND (u.status='voided' OR (u.status='replaced' AND u.replaced_by_unit_id IS NULL))
), view_definitions AS (
  SELECT c.relname, pg_get_viewdef(c.oid,true) AS definition
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('v_wholesale_order_totals','v_commercial_partner_wholesale_summary','v_commercial_partner_wholesale_top_products','v_b2b_top_products','v_b2b_partner_next_visit','v_pending_payment_verifications')
), b2b_analytics AS (
  SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_b2b_product_analytics'
), invalid_unit_snapshots AS (
  SELECT id, barcode_value FROM public.commercial_delivery_units
  WHERE product_id IS NULL OR NULLIF(BTRIM(product_code),'') IS NULL OR NULLIF(BTRIM(product_name),'') IS NULL
), return_unit_columns(expected_name, expected_type) AS (
  VALUES
    ('returned_good_at'::TEXT, 'timestamp with time zone'::TEXT),
    ('returned_good_by', 'uuid'),
    ('return_movement_id', 'uuid')
), return_unit_column_contract AS (
  SELECT expected.expected_name, expected.expected_type, attribute.attname AS actual_name,
    format_type(attribute.atttypid,attribute.atttypmod) AS actual_type,
    attribute.attname=expected.expected_name
      AND format_type(attribute.atttypid,attribute.atttypmod)=expected.expected_type AS matches
  FROM return_unit_columns expected
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid='public.commercial_delivery_units'::REGCLASS
   AND attribute.attname=expected.expected_name
   AND attribute.attnum>0 AND NOT attribute.attisdropped
), returned_good_audit_contract AS (
  SELECT EXISTS(
    SELECT 1 FROM pg_constraint constraint
    WHERE constraint.conrelid='public.commercial_delivery_audit_events'::REGCLASS
      AND pg_get_constraintdef(constraint.oid,true) ILIKE '%returned_good%'
  ) AS event_supported
), returned_good_violations AS (
  SELECT id, barcode_value, returned_good_at, returned_good_by, return_movement_id, spoiled_at, spoilage_movement_id
  FROM public.commercial_delivery_units
  WHERE status='returned_good'
    AND (returned_good_at IS NULL OR returned_good_by IS NULL OR return_movement_id IS NULL
      OR spoiled_at IS NOT NULL OR spoilage_movement_id IS NOT NULL)
), b2b_snapshot_at_verification AS (
  SELECT jsonb_build_object(
    'units_sold', report->'summary'->'units_sold',
    'generated_revenue', report->'summary'->'generated_revenue',
    'spoilage_units', report->'summary'->'spoilage_units',
    'open_inventory_units', report->'summary'->'open_inventory_units',
    'weighted_median_liquidation_days', report->'summary'->'weighted_median_liquidation_days',
    'weighted_average_liquidation_days', report->'summary'->'weighted_average_liquidation_days'
  ) AS value
  FROM (
    SELECT public.get_b2b_product_analytics(
      TIMESTAMPTZ '2026-08-01 00:00:00-06',
      TIMESTAMPTZ '2026-09-01 00:00:00-06'
    ) AS report
  ) AS analytics
)
SELECT jsonb_build_object(
  'all_checks_passed',
    (SELECT COUNT(*)=8 AND BOOL_AND(oid IS NOT NULL AND relkind=expected_kind) FROM relations)
    AND (SELECT COUNT(*)=78 AND BOOL_AND(matches) FROM view_columns)
    AND (SELECT COUNT(*)=1 AND NOT attnotnull AND data_type='uuid' AND has_products_fk FROM movement_item_product)
    AND (SELECT COUNT(*)=1 AND attnotnull AND data_type='date' FROM wholesale_delivery_date)
    AND (SELECT COUNT(*)=1 AND trigger_exists AND function_definition ILIKE '%pending_release%' AND function_definition ILIKE '%released_at%' FROM due_date_trigger)
    AND (SELECT COUNT(*)=8 AND BOOL_AND(oid IS NOT NULL AND actual_arguments=arguments) FROM rpc_contract)
    AND (SELECT COUNT(*)=1 AND exists AND security_definer AND pinned_search_path
      AND NOT public_execute AND NOT anon_execute AND NOT authenticated_execute AND NOT service_role_execute
      FROM audit_security)
    AND (SELECT COUNT(*)=2 AND BOOL_AND(rls_enabled AND direct_write_denied) FROM protected_tables)
    AND (SELECT COUNT(*)=3 AND BOOL_AND(
      (table_name='commercial_partner_movements'
        AND definition ILIKE '%pending_release%'
        AND definition ILIKE '%completed%'
        AND definition ILIKE '%cancelled%')
      OR (table_name='wholesale_orders'
        AND definition ILIKE '%draft%'
        AND definition ILIKE '%pending_release%'
        AND definition ILIKE '%delivered%'
        AND definition ILIKE '%cancelled%')
      OR (table_name='commercial_delivery_units'
        AND definition ILIKE '%generated%'
        AND definition ILIKE '%printed%'
        AND definition ILIKE '%scanned%'
        AND definition ILIKE '%released%'
        AND definition ILIKE '%spoiled%'
        AND definition ILIKE '%voided%'
        AND definition ILIKE '%replaced%')
    ) FROM status_constraints)
    AND (SELECT COUNT(*)=0 FROM pending_due_leaks)
    AND (SELECT COUNT(*)=0 FROM pending_balance_leaks)
    AND (SELECT COUNT(*)=0 FROM pending_payment_leaks)
    AND (SELECT COUNT(*)=0 FROM released_source_mismatches)
    AND (SELECT COUNT(*)=0 FROM active_void_or_replacement_leaks)
    AND (SELECT COUNT(*)=0 FROM invalid_unit_snapshots)
    AND (SELECT COUNT(*)=3 AND BOOL_AND(matches) FROM return_unit_column_contract)
    AND (SELECT event_supported FROM returned_good_audit_contract)
    AND (SELECT COUNT(*)=0 FROM returned_good_violations)
    AND (SELECT COUNT(*)=6 AND BOOL_AND(
      (relname='v_wholesale_order_totals'
        AND definition ILIKE '%wholesale_order_items%'
        AND definition ILIKE '%subtotal%'
        AND definition ILIKE '%not_released%'
        AND definition ILIKE '%cancelled%')
      OR (relname='v_commercial_partner_wholesale_summary'
        AND definition ILIKE '%commercial_partners%'
        AND definition ILIKE '%left join%'
        AND definition ILIKE '%delivered%'
        AND definition ILIKE '%completed%')
      OR (relname='v_commercial_partner_wholesale_top_products'
        AND definition ILIKE '%distinct on (wo.partner_id)%'
        AND definition ILIKE '%subtotal%'
        AND definition ILIKE '%delivered%'
        AND definition ILIKE '%completed%')
      OR (relname='v_b2b_top_products'
        AND definition ILIKE '%comodato_products%'
        AND definition ILIKE '%wholesale_products%'
        AND definition ILIKE '%liquidacion%'
        AND definition ILIKE '%liquidación%'
        AND definition ILIKE '%liquidation%'
        AND definition ILIKE '%quantity_sold%'
        AND definition NOT ILIKE '%quantity_withdrawn%'
        AND definition NOT ILIKE '%quantity_spoiled%'
        AND definition ILIKE '%delivered%'
        AND definition ILIKE '%completed%')
      OR (relname='v_b2b_partner_next_visit'
        AND definition ILIKE '%distinct on (m.partner_id)%'
        AND definition ILIKE '%completed%'
        AND definition NOT ILIKE '%at time zone%')
      OR (relname='v_pending_payment_verifications'
        AND definition ILIKE '%get_comodato_movement_pending_balance%'
        AND definition ILIKE '%get_wholesale_order_pending_balance%'
        AND definition ILIKE '%get_piece_sale_pending_balance%'
        AND definition ILIKE '%case%'
        AND definition ILIKE '%when%venta_pieza%'
        AND (
          LENGTH(LOWER(definition))
          - LENGTH(REPLACE(LOWER(definition), 'get_piece_sale_pending_balance', ''))
        ) / LENGTH('get_piece_sale_pending_balance') >= 2
        AND definition ILIKE '%commercial_partner_payments p%'
        AND definition ILIKE '%p.partner_id = r.partner_id%'
        AND definition ILIKE '%movement_type%settlement%'
        AND definition NOT ILIKE '%liquidacion%'
        AND definition NOT ILIKE '%liquidación%'
        AND definition NOT ILIKE '%liquidation%'
        AND definition ILIKE '%lower(trim(m.movement_type%'
        AND definition ILIKE '%lower(trim(m.status%completed%'
        AND definition ILIKE '%i.quantity_sold > 0%'
        AND definition ILIKE '%sum(greatest(coalesce(v.pending_amount%'
        AND definition ILIKE '%join%wholesale_orders%o%on%o.id = v.wholesale_order_id%'
        AND definition ILIKE '%floor(extract(epoch from (now() - r.submitted_at))%'
        AND definition ILIKE '%60::numeric%'
        AND definition NOT ILIKE '%sale.status%'
        AND definition NOT ILIKE '%sps.total_units%'
        AND definition NOT ILIKE '%approved_payment_id%'
        AND definition NOT ILIKE '%source_total - source_paid%'
        AND definition ILIKE '%seller_piece_sale_items%'
        AND definition ILIKE '%seller_piece_payments%')
    ) FROM view_definitions)
    AND (SELECT COUNT(*)=1 AND definition NOT ILIKE '%pending_release%' FROM b2b_analytics),
  'schema', jsonb_build_object(
    'relations',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',name,'exists',oid IS NOT NULL,'kind',relkind) ORDER BY name) FROM relations),'[]'::JSONB),
    'view_columns',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY view_name,ordinal_position) FROM view_columns x),'[]'::JSONB),
    'movement_item_product_id',COALESCE((SELECT to_jsonb(x) FROM movement_item_product x),'null'::JSONB),
    'wholesale_delivery_date',COALESCE((SELECT to_jsonb(x) FROM wholesale_delivery_date x),'null'::JSONB),
    'due_date_trigger',COALESCE((SELECT jsonb_build_object('exists',true,'trigger_exists',trigger_exists) FROM due_date_trigger),'null'::JSONB),
    'rpcs',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',name,'expected_arguments',arguments,'actual_arguments',actual_arguments,'exists',oid IS NOT NULL) ORDER BY name) FROM rpc_contract),'[]'::JSONB),
    'audit_security',COALESCE((SELECT to_jsonb(x) FROM audit_security x),'null'::JSONB),
    'protected_tables',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY table_name) FROM protected_tables x),'[]'::JSONB)
  ),
  'pending_release_leaks',jsonb_build_object(
    'payment_due_at',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM pending_due_leaks x),'[]'::JSONB),
    'wholesale_balances',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM pending_balance_leaks x),'[]'::JSONB),
    'wholesale_payments',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM pending_payment_leaks x),'[]'::JSONB)
  ),
  'released_source_mismatches',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM released_source_mismatches x),'[]'::JSONB),
  'active_void_or_replacement_leaks',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM active_void_or_replacement_leaks x),'[]'::JSONB),
  'invalid_unit_snapshots',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM invalid_unit_snapshots x),'[]'::JSONB),
  'returned_good',jsonb_build_object(
    'column_contract',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY expected_name) FROM return_unit_column_contract x),'[]'::JSONB),
    'audit_event_supported',(SELECT event_supported FROM returned_good_audit_contract),
    'invalid_units',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM returned_good_violations x),'[]'::JSONB)
  ),
  'status_constraints',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY table_name) FROM status_constraints x),'[]'::JSONB),
  'views',COALESCE((SELECT jsonb_object_agg(relname,definition) FROM view_definitions),'{}'::JSONB),
  'b2b_snapshot_at_verification',COALESCE((SELECT value FROM b2b_snapshot_at_verification),'null'::JSONB),
  'get_b2b_product_analytics_has_pending_release_reference',COALESCE((SELECT definition ILIKE '%pending_release%' FROM b2b_analytics),false)
) AS commercial_delivery_unit_control_verification;
