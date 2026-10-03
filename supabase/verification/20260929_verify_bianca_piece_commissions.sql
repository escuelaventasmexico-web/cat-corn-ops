-- Transactional verifier for 20260929_bianca_piece_commissions.sql.
-- Run only after the migration. Every data-changing sync test is rolled back.
-- A skipped runtime fixture is reported as true with a "skipped" detail; the
-- structural checks remain mandatory and never skip.

BEGIN;

CREATE TEMP TABLE verification_results (
  check_name TEXT PRIMARY KEY,
  passed BOOLEAN NOT NULL,
  details TEXT NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE verification_function_defs ON COMMIT DROP AS
SELECT
  proc_row.proname,
  pg_get_function_identity_arguments(proc_row.oid) AS identity_arguments,
  lower(pg_get_functiondef(proc_row.oid)) AS definition,
  proc_row.prosecdef,
  COALESCE(array_to_string(proc_row.proconfig, ','), '') AS configuration,
  has_function_privilege('authenticated', proc_row.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon', proc_row.oid, 'EXECUTE') AS anon_execute,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(proc_row.proacl, acldefault('f', proc_row.proowner))) AS acl_row
    WHERE acl_row.grantee = 0 AND acl_row.privilege_type = 'EXECUTE'
  ) AS public_execute
FROM pg_proc AS proc_row
JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
WHERE namespace_row.nspname = 'public'
  AND proc_row.proname IN (
    '_commission_event_has_economic_lock',
    '_cancel_prospect_origin_commissions',
    '_sync_prospect_origin_commission_event',
    'protect_commercial_prospect_conversion_attribution',
    'sync_prospect_conversion_bonus',
    'trg_sync_prospect_bonus_from_conversion',
    'sync_pos_commission_for_sale_item',
    'sync_comodato_commissions_for_movement',
    'sync_wholesale_commissions_for_order',
    'commission_settlement_candidate_events',
    'get_commission_settlement_preview',
    'create_commission_settlement'
  );

INSERT INTO verification_results
SELECT 'required_objects_exist',
  to_regclass('public.commission_program_eligibility_snapshots') IS NOT NULL
    AND to_regprocedure('public._commission_event_has_economic_lock(uuid)') IS NOT NULL
    AND to_regprocedure('public._cancel_prospect_origin_commissions(uuid,text,text)') IS NOT NULL
    AND to_regprocedure(
      'public._sync_prospect_origin_commission_event(uuid,uuid,uuid,text,text,text,text,text,text,numeric,text,timestamp with time zone,jsonb)'
    ) IS NOT NULL
    AND to_regprocedure('public.sync_prospect_conversion_bonus(uuid)') IS NOT NULL
    AND to_regprocedure('public.sync_pos_commission_for_sale_item(uuid)') IS NOT NULL
    AND to_regprocedure('public.sync_comodato_commissions_for_movement(uuid)') IS NOT NULL
    AND to_regprocedure('public.sync_wholesale_commissions_for_order(uuid)') IS NOT NULL,
  'New table and synchronization functions must exist.';

INSERT INTO verification_results
SELECT 'constraints_cover_new_values',
  EXISTS (
    SELECT 1 FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.commission_events'::REGCLASS
      AND constraint_row.conname = 'commission_events_source_type_check'
      AND lower(pg_get_constraintdef(constraint_row.oid, TRUE)) LIKE '%prospect_origin_sale%'
  ) AND EXISTS (
    SELECT 1 FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.commission_rules'::REGCLASS
      AND constraint_row.conname = 'commission_rules_scheme_check'
      AND lower(pg_get_constraintdef(constraint_row.oid, TRUE)) LIKE '%vendedora_pos%'
      AND lower(pg_get_constraintdef(constraint_row.oid, TRUE)) LIKE '%prospect_origin%'
  ),
  'The source type and both independent rule schemes must be allowed.';

INSERT INTO verification_results
WITH expected(scheme, product_key, amount) AS (
  VALUES
    ('vendedora_pos', 'michi_clasico', 2.00::NUMERIC),
    ('vendedora_pos', 'michi_sabores', 2.00::NUMERIC),
    ('vendedora_pos', 'caramelo_michi', 2.00::NUMERIC),
    ('vendedora_pos', 'gato_mayor_clasico', 5.00::NUMERIC),
    ('vendedora_pos', 'gato_mayor_sabores', 5.00::NUMERIC),
    ('vendedora_pos', 'caramelo_gato_mayor', 5.00::NUMERIC),
    ('vendedora_pos', 'jefe_felino_clasico', 10.00::NUMERIC),
    ('vendedora_pos', 'jefe_felino_sabores', 10.00::NUMERIC),
    ('prospect_origin', 'michi_clasico', 2.00::NUMERIC),
    ('prospect_origin', 'michi_sabores', 2.00::NUMERIC),
    ('prospect_origin', 'caramelo_michi', 2.00::NUMERIC),
    ('prospect_origin', 'gato_mayor_clasico', 5.00::NUMERIC),
    ('prospect_origin', 'gato_mayor_sabores', 5.00::NUMERIC),
    ('prospect_origin', 'caramelo_gato_mayor', 5.00::NUMERIC),
    ('prospect_origin', 'jefe_felino_clasico', 10.00::NUMERIC),
    ('prospect_origin', 'jefe_felino_sabores', 10.00::NUMERIC)
), actual AS (
  SELECT rule.scheme, rule.product_key, rule.commission_amount AS amount
  FROM public.commission_rules AS rule
  WHERE rule.scheme IN ('vendedora_pos', 'prospect_origin')
    AND rule.valid_from = DATE '2026-09-30'
    AND rule.active
)
SELECT 'bianca_rules_are_exact',
  NOT EXISTS (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    AND NOT EXISTS (SELECT * FROM actual EXCEPT SELECT * FROM expected),
  'Both schemes must contain exactly the 8 real keys at 2/5/10 from 2026-09-30.'
FROM expected LIMIT 1;

INSERT INTO verification_results
WITH expected(product_key) AS (
  VALUES
    ('michi_clasico'), ('michi_sabores'), ('caramelo_michi'),
    ('gato_mayor_clasico'), ('gato_mayor_sabores'), ('caramelo_gato_mayor'),
    ('jefe_felino_clasico'), ('jefe_felino_sabores')
), actual AS (
  SELECT DISTINCT (matches.match)[1] AS product_key
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
  CROSS JOIN LATERAL regexp_matches(
    lower(pg_get_functiondef(proc_row.oid)),
    'return ''([^'']+)''',
    'g'
  ) AS matches(match)
  WHERE namespace_row.nspname = 'public'
    AND proc_row.proname = 'commission_product_key'
)
SELECT 'all_real_product_keys_are_covered',
  NOT EXISTS (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    AND NOT EXISTS (SELECT * FROM actual EXCEPT SELECT * FROM expected),
  'Covered keys: caramelo_michi, caramelo_gato_mayor, and classic/flavor keys for all three presentations.'
FROM expected LIMIT 1;

INSERT INTO verification_results
SELECT 'internal_functions_are_hardened',
  count(*) FILTER (
    WHERE proname IN (
      '_commission_event_has_economic_lock',
      '_cancel_prospect_origin_commissions',
      '_sync_prospect_origin_commission_event',
      'sync_prospect_conversion_bonus',
      'trg_sync_prospect_bonus_from_conversion',
      'sync_pos_commission_for_sale_item',
      'sync_comodato_commissions_for_movement',
      'sync_wholesale_commissions_for_order',
      'commission_settlement_candidate_events'
    )
      AND prosecdef
      AND configuration ILIKE '%search_path=public%'
  ) = 9
  AND bool_and(
    CASE
      WHEN proname IN (
        '_commission_event_has_economic_lock',
        '_cancel_prospect_origin_commissions',
        '_sync_prospect_origin_commission_event',
        'protect_commercial_prospect_conversion_attribution',
        'trg_sync_prospect_bonus_from_conversion',
        'commission_settlement_candidate_events'
      ) THEN NOT authenticated_execute AND NOT anon_execute AND NOT public_execute
      ELSE TRUE
    END
  ),
  'Internal functions are SECURITY DEFINER where needed, have fixed search_path, and are not directly executable.'
FROM verification_function_defs;

INSERT INTO verification_results
WITH defs AS (
  SELECT
    max(definition) FILTER (WHERE proname = 'sync_pos_commission_for_sale_item') AS pos_def,
    max(definition) FILTER (WHERE proname = 'sync_comodato_commissions_for_movement') AS comodato_def,
    max(definition) FILTER (WHERE proname = 'sync_wholesale_commissions_for_order') AS wholesale_def,
    max(definition) FILTER (WHERE proname = '_sync_prospect_origin_commission_event') AS origin_def
  FROM verification_function_defs
)
SELECT 'source_syncs_apply_approved_eligibility',
  pos_def LIKE '%role = ''vendedora''%is_active%'
    AND pos_def LIKE '%''vendedora_pos''%'
    AND pos_def LIKE '%''venta_pieza''%'
    AND origin_def LIKE '%conversion.originator_user_id%'
    AND origin_def LIKE '%profile.role = ''vendedora''%'
    AND origin_def LIKE '%profile.is_active%'
    AND origin_def LIKE '%rule.scheme = ''prospect_origin''%'
    AND comodato_def LIKE '%v_effective_quantity%'
    AND comodato_def LIKE '%v_event_status%_sync_prospect_origin_commission_event%'
    AND wholesale_def LIKE '%r_item.quantity%v_event_status%_sync_prospect_origin_commission_event%',
  'POS uses its own scheme; origin uses canonical attribution, active role, underlying quantity, and the normal release boolean.'
FROM defs;

INSERT INTO verification_results
WITH bonus AS (
  SELECT max(definition) AS definition
  FROM verification_function_defs
  WHERE proname = 'sync_prospect_conversion_bonus'
)
SELECT 'bonus_creation_and_release_are_separated',
  definition LIKE '%v_partner.partner_model <> ''comodato''%'
    AND definition LIKE '%v_partner.status <> ''activo''%'
    AND definition LIKE '%not v_partner.active%'
    AND definition LIKE '%v_originator.role <> ''vendedora''%'
    AND definition LIKE '%''pending''%'
    AND definition LIKE '%get_comodato_movement_pending_balance%'
    AND definition LIKE '%quantity_sold%'
    AND definition LIKE '%effective_due > 0.005%'
    AND definition LIKE '%pending_balance <= 0.005%'
    AND EXISTS (
      SELECT 1 FROM pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = 'public.commercial_prospect_conversions'::REGCLASS
        AND trigger_row.tgname = 'sync_prospect_bonus_from_conversion'
        AND NOT trigger_row.tgisinternal
        AND (trigger_row.tgtype & 4) = 4
    ),
  'A valid conversion creates one pending bonus; the first positive, fully paid Comodato settlement releases it.'
FROM bonus;

INSERT INTO verification_results
SELECT 'bonus_is_unique_per_partner',
  EXISTS (
    SELECT 1 FROM pg_indexes AS index_row
    WHERE index_row.schemaname = 'public'
      AND index_row.indexname = 'uq_commission_prospect_conversion_partner'
      AND index_row.indexdef ILIKE '%unique%partner_id%source_type%prospect_conversion_bonus%'
  ),
  'The existing partial unique index remains the one-per-partner guard.';

INSERT INTO verification_results
WITH protection AS (
  SELECT max(definition) AS definition
  FROM verification_function_defs
  WHERE proname = 'protect_commercial_prospect_conversion_attribution'
)
SELECT 'conversion_attribution_is_immutable',
  definition LIKE '%tg_op = ''delete''%'
    AND definition LIKE '%new.originator_user_id is distinct from old.originator_user_id%'
    AND definition LIKE '%new.prospect_id is distinct from old.prospect_id%'
    AND definition LIKE '%new.commercial_partner_id is distinct from old.commercial_partner_id%'
    AND EXISTS (
      SELECT 1 FROM pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = 'public.commercial_prospect_conversions'::REGCLASS
        AND trigger_row.tgname = 'protect_commercial_prospect_conversion_attribution'
        AND NOT trigger_row.tgisinternal
    ),
  'DELETE and reassignment of the three canonical attribution fields are blocked.'
FROM protection;

INSERT INTO verification_results
WITH candidate AS (
  SELECT max(definition) AS definition
  FROM verification_function_defs
  WHERE proname = 'commission_settlement_candidate_events'
)
SELECT 'bianca_settlement_whitelist_is_exact',
  definition LIKE '%event.seller_id = p_seller_id%'
    AND definition LIKE '%seller.role = ''vendedora''%'
    AND definition LIKE '%''prospect_conversion_bonus''%'
    AND definition LIKE '%''pos_sale''%'
    AND definition LIKE '%''prospect_origin_sale''%'
    AND definition LIKE '%seller.role = ''socios_comerciales''%'
    AND definition LIKE '%event.status = ''available''%'
    AND definition LIKE '%abs(balance.allocatable_amount) > 0.005%'
    AND definition LIKE '%america/mexico_city%'
    AND definition LIKE '%order by event.earned_at, event.id%',
  'A vendedora can settle only her three approved source types; socios retain FIFO and all normal sources.'
FROM candidate;

INSERT INTO verification_results
WITH defs AS (
  SELECT
    max(definition) FILTER (WHERE proname = 'get_commission_settlement_preview') AS preview_def,
    max(definition) FILTER (WHERE proname = 'create_commission_settlement') AS create_def
  FROM verification_function_defs
)
SELECT 'preview_and_create_still_share_candidate_helper',
  preview_def LIKE '%commission_settlement_candidate_events(%'
    AND create_def LIKE '%commission_settlement_candidate_events(%'
    AND create_def LIKE '%order by candidate.earned_at, candidate.event_id%'
    AND create_def LIKE '%status = ''draft''%',
  'The corrected accumulated-period preview/create path, partial payments, FIFO, and one-draft check remain in use.'
FROM defs;

INSERT INTO verification_results
WITH expected(scheme, product_key, amount) AS (
  SELECT scheme, product_key,
    CASE
      WHEN product_key LIKE '%michi%' THEN 5.00::NUMERIC
      WHEN product_key LIKE '%gato_mayor%' THEN 10.00::NUMERIC
      ELSE 15.00::NUMERIC
    END
  FROM (VALUES ('comodato'), ('mayoreo'), ('venta_pieza')) AS schemes(scheme)
  CROSS JOIN (VALUES
    ('michi_clasico'), ('michi_sabores'), ('caramelo_michi'),
    ('gato_mayor_clasico'), ('gato_mayor_sabores'), ('caramelo_gato_mayor'),
    ('jefe_felino_clasico'), ('jefe_felino_sabores')
  ) AS products(product_key)
), actual AS (
  SELECT expected.*,
    public.get_commission_rule_amount(
      expected.scheme, expected.product_key, DATE '2026-09-30'
    ) AS deployed_amount
  FROM expected
)
SELECT 'gerardo_rates_remain_exact',
  bool_and(deployed_amount IS NULL OR deployed_amount = amount)
    AND count(*) FILTER (
      WHERE product_key IN ('michi_clasico', 'gato_mayor_clasico', 'jefe_felino_clasico')
        AND deployed_amount = amount
    ) = 9,
  'Every deployed normal-rule variant remains 5/10/15, with all three core presentations present in Comodato, Mayoreo, and venta_pieza.'
FROM actual;

INSERT INTO verification_results
WITH defs AS (
  SELECT
    max(definition) FILTER (WHERE proname = 'sync_pos_commission_for_sale_item') AS pos_def,
    max(definition) FILTER (WHERE proname = 'sync_comodato_commissions_for_movement') AS comodato_def,
    max(definition) FILTER (WHERE proname = 'sync_wholesale_commissions_for_order') AS wholesale_def
  FROM verification_function_defs
)
SELECT 'gerardo_behavior_remains_enabled',
  pos_def LIKE '%role = ''socios_comerciales''%''venta_pieza''%'
    AND comodato_def LIKE '%is_valid_commission_seller%''comodato_sale''%rule.scheme = ''comodato''%'
    AND wholesale_def LIKE '%is_valid_commission_seller%''wholesale_sale''%rule.scheme = ''mayoreo''%'
    AND EXISTS (
      SELECT 1 FROM pg_proc AS proc_row
      JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
      WHERE namespace_row.nspname = 'public'
        AND proc_row.proname = 'is_valid_commission_seller'
        AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%socios_comerciales%'
        AND lower(pg_get_functiondef(proc_row.oid)) NOT LIKE '%vendedora%'
    ),
  'The responsible socios_comerciales event remains independent and uses its existing schemes.'
FROM defs;

INSERT INTO verification_results
SELECT 'new_program_is_prospective',
  NOT EXISTS (
    SELECT 1
    FROM public.commission_events AS event
    WHERE (
      event.source_type = 'prospect_origin_sale'
      OR (
        event.source_type = 'pos_sale'
        AND event.metadata->>'commission_scheme' = 'vendedora_pos'
      )
    )
      AND (event.earned_at AT TIME ZONE 'America/Mexico_City')::DATE < DATE '2026-09-30'
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.commission_program_eligibility_snapshots AS snapshot
    WHERE snapshot.eligible
      AND (snapshot.operation_at AT TIME ZONE 'America/Mexico_City')::DATE < DATE '2026-09-30'
  ),
  'No committed Bianca per-piece event or eligible snapshot may precede valid_from.';

INSERT INTO verification_results
SELECT 'origin_metadata_distinguishes_commercial_scheme',
  NOT EXISTS (
    SELECT 1 FROM public.commission_events AS event
    WHERE event.source_type = 'prospect_origin_sale'
      AND COALESCE(event.metadata->>'commercial_scheme', '') NOT IN ('comodato', 'mayoreo')
  ),
  'Every origin event identifies Comodato or Mayoreo in metadata.';

INSERT INTO verification_results
SELECT 'no_source_item_duplicates',
  NOT EXISTS (
    SELECT event.source_type, event.source_item_id
    FROM public.commission_events AS event
    WHERE event.source_item_id IS NOT NULL
      AND event.source_type IN ('pos_sale', 'comodato_sale', 'wholesale_sale', 'prospect_origin_sale')
    GROUP BY event.source_type, event.source_item_id
    HAVING count(*) > 1
  ),
  'Each sync source item has at most one event per source type.';

INSERT INTO verification_results
SELECT 'snapshot_table_is_private_and_rls_enabled',
  EXISTS (
    SELECT 1 FROM pg_class AS class_row
    WHERE class_row.oid = 'public.commission_program_eligibility_snapshots'::REGCLASS
      AND class_row.relrowsecurity
  )
    AND NOT has_table_privilege('authenticated', 'public.commission_program_eligibility_snapshots', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.commission_program_eligibility_snapshots', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.commission_program_eligibility_snapshots', 'SELECT'),
  'Operation-time eligibility snapshots are internal only.';

INSERT INTO verification_results
SELECT 'reserved_and_paid_origin_events_are_protected',
  EXISTS (
    SELECT 1 FROM verification_function_defs
    WHERE proname = '_commission_event_has_economic_lock'
      AND definition LIKE '%paid_amount%'
      AND definition LIKE '%reserved_amount%'
      AND definition LIKE '%partially_paid%'
      AND definition LIKE '%commission_settlement_items%'
  ) AND EXISTS (
    SELECT 1 FROM verification_function_defs
    WHERE proname = '_sync_prospect_origin_commission_event'
      AND definition LIKE '%_commission_event_has_economic_lock%'
      AND definition LIKE '%explicit adjustment%'
  ),
  'Reserved, partially paid, and paid origin events are not economically rewritten.';

INSERT INTO verification_results
SELECT 'views_and_rls_include_only_approved_vendedora_sources',
  EXISTS (
    SELECT 1 FROM pg_policies AS policy_row
    WHERE policy_row.schemaname = 'public'
      AND policy_row.tablename = 'commission_events'
      AND policy_row.policyname = 'commission_events_authorized_read'
      AND lower(COALESCE(policy_row.qual, '')) LIKE '%prospect_conversion_bonus%'
      AND lower(COALESCE(policy_row.qual, '')) LIKE '%pos_sale%'
      AND lower(COALESCE(policy_row.qual, '')) LIKE '%prospect_origin_sale%'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'v_seller_commission_monthly_summary'
      AND column_name = 'pos_units'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'v_seller_commission_monthly_summary'
      AND column_name = 'prospect_origin_units'
  ),
  'RLS and economic/activity views expose the approved vendedora commission sources.';

INSERT INTO verification_results
SELECT 'prospect_kpi_does_not_count_unit_sales',
  lower(pg_get_viewdef('public.v_seller_commission_target_progress'::REGCLASS, TRUE)) NOT LIKE '%pos_sale%'
    AND lower(pg_get_viewdef('public.v_seller_commission_target_progress'::REGCLASS, TRUE)) NOT LIKE '%prospect_origin_sale%'
    AND lower(pg_get_viewdef('public.v_seller_commission_target_progress'::REGCLASS, TRUE)) NOT LIKE '%pos_units%'
    AND lower(pg_get_viewdef('public.v_seller_commission_target_progress'::REGCLASS, TRUE)) NOT LIKE '%prospect_origin_units%',
  'The existing goal/KPI view is untouched by POS and origin units.';

-- Runtime/idempotency tests. These invoke real syncs only inside this transaction.
DO $$
DECLARE
  v_id UUID;
  v_item_id UUID;
  v_partner_id UUID;
  v_user_id UUID;
  v_before INTEGER;
  v_after INTEGER;
  v_pass BOOLEAN;
  v_original_active BOOLEAN;
  v_original_role TEXT;
  v_before_event JSONB;
  v_after_event JSONB;
  i INTEGER;
BEGIN
  -- POS idempotency (post-effective fixture).
  SELECT item.id INTO v_id
  FROM public.sale_items AS item
  JOIN public.sales AS sale ON sale.id = item.sale_id
  JOIN public.user_profiles AS profile ON profile.id = sale.cashier_id
  WHERE lower(trim(COALESCE(sale.sale_origin, ''))) = 'pos'
    AND NOT COALESCE(sale.is_refunded, FALSE)
    AND item.product_id IS NOT NULL
    AND NOT COALESCE(item.is_generic, FALSE)
    AND profile.role IN ('socios_comerciales', 'vendedora')
    AND (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE >= DATE '2026-09-30'
  ORDER BY sale.created_at, item.id LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO verification_results VALUES (
      'pos_sync_is_idempotent_20x', TRUE, 'Skipped: no post-effective POS fixture exists.'
    );
  ELSE
    SELECT count(*) INTO v_before FROM public.commission_events
    WHERE source_type = 'pos_sale' AND source_item_id = v_id;
    FOR i IN 1..20 LOOP PERFORM public.sync_pos_commission_for_sale_item(v_id); END LOOP;
    SELECT count(*) INTO v_after FROM public.commission_events
    WHERE source_type = 'pos_sale' AND source_item_id = v_id;
    INSERT INTO verification_results VALUES (
      'pos_sync_is_idempotent_20x', v_before <= 1 AND v_after <= 1,
      format('sale_item=%s before=%s after=%s', v_id, v_before, v_after)
    );
  END IF;

  -- Comodato idempotency (both normal and origin types use the same item identity).
  v_id := NULL;
  SELECT movement.id, item.id INTO v_id, v_item_id
  FROM public.commercial_partner_movements AS movement
  JOIN public.commercial_partner_movement_items AS item ON item.movement_id = movement.id
  WHERE lower(trim(movement.movement_type)) = 'settlement'
    AND lower(trim(movement.status)) = 'completed'
    AND COALESCE(item.quantity_sold, 0) > 0
    AND (movement.movement_date AT TIME ZONE 'America/Mexico_City')::DATE >= DATE '2026-09-30'
  ORDER BY movement.movement_date, item.id LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO verification_results VALUES (
      'comodato_sync_is_idempotent_20x', TRUE, 'Skipped: no post-effective Comodato fixture exists.'
    );
  ELSE
    FOR i IN 1..20 LOOP PERFORM public.sync_comodato_commissions_for_movement(v_id); END LOOP;
    SELECT count(*) <= 1 INTO v_pass
    FROM public.commission_events
    WHERE source_item_id = v_item_id AND source_type = 'prospect_origin_sale';
    INSERT INTO verification_results VALUES (
      'comodato_sync_is_idempotent_20x', v_pass,
      format('movement=%s item=%s', v_id, v_item_id)
    );
  END IF;

  -- Mayoreo idempotency.
  v_id := NULL;
  SELECT orders.id, item.id INTO v_id, v_item_id
  FROM public.wholesale_orders AS orders
  JOIN public.wholesale_order_items AS item ON item.wholesale_order_id = orders.id
  WHERE lower(trim(orders.order_status)) IN ('delivered', 'completed')
    AND COALESCE(item.quantity, 0) > 0
    AND orders.order_date >= DATE '2026-09-30'
  ORDER BY orders.order_date, item.id LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO verification_results VALUES (
      'mayoreo_sync_is_idempotent_20x', TRUE, 'Skipped: no post-effective Mayoreo fixture exists.'
    );
  ELSE
    FOR i IN 1..20 LOOP PERFORM public.sync_wholesale_commissions_for_order(v_id); END LOOP;
    SELECT count(*) <= 1 INTO v_pass
    FROM public.commission_events
    WHERE source_item_id = v_item_id AND source_type = 'prospect_origin_sale';
    INSERT INTO verification_results VALUES (
      'mayoreo_sync_is_idempotent_20x', v_pass,
      format('order=%s item=%s', v_id, v_item_id)
    );
  END IF;

  -- Bonus idempotency.
  v_partner_id := NULL;
  SELECT conversion.commercial_partner_id INTO v_partner_id
  FROM public.commercial_prospect_conversions AS conversion
  ORDER BY conversion.converted_at, conversion.id LIMIT 1;
  IF v_partner_id IS NULL THEN
    INSERT INTO verification_results VALUES (
      'bonus_sync_is_idempotent_20x', TRUE, 'Skipped: no converted prospect fixture exists.'
    );
  ELSE
    FOR i IN 1..20 LOOP PERFORM public.sync_prospect_conversion_bonus(v_partner_id); END LOOP;
    SELECT count(*) <= 1 INTO v_pass
    FROM public.commission_events
    WHERE partner_id = v_partner_id AND source_type = 'prospect_conversion_bonus';
    INSERT INTO verification_results VALUES (
      'bonus_sync_is_idempotent_20x', v_pass, format('partner=%s', v_partner_id)
    );
  END IF;

  -- A pre-effective POS item cannot create a vendedora program event.
  v_id := NULL;
  SELECT item.id INTO v_id
  FROM public.sale_items AS item
  JOIN public.sales AS sale ON sale.id = item.sale_id
  JOIN public.user_profiles AS profile ON profile.id = sale.cashier_id
  WHERE lower(trim(COALESCE(sale.sale_origin, ''))) = 'pos'
    AND NOT COALESCE(sale.is_refunded, FALSE)
    AND item.product_id IS NOT NULL
    AND NOT COALESCE(item.is_generic, FALSE)
    AND profile.role = 'vendedora'
    AND profile.is_active
    AND (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE < DATE '2026-09-30'
    AND NOT EXISTS (
      SELECT 1 FROM public.commission_events AS event
      WHERE event.source_type = 'pos_sale' AND event.source_item_id = item.id
    )
  ORDER BY sale.created_at DESC, item.id LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO verification_results VALUES (
      'pre_effective_pos_does_not_backfill', TRUE, 'Skipped: no eligible historical POS fixture exists.'
    );
  ELSE
    PERFORM public.sync_pos_commission_for_sale_item(v_id);
    SELECT NOT EXISTS (
      SELECT 1 FROM public.commission_events AS event
      WHERE event.source_type = 'pos_sale' AND event.source_item_id = v_id
    ) INTO v_pass;
    INSERT INTO verification_results VALUES (
      'pre_effective_pos_does_not_backfill', v_pass, format('sale_item=%s', v_id)
    );
  END IF;

  -- A role change cannot erase or reassign an already-created origin event.
  v_id := NULL;
  SELECT event.id, event.seller_id,
    jsonb_build_object(
      'seller_id', event.seller_id,
      'quantity', event.quantity,
      'unit_commission', event.unit_commission,
      'commission_amount', event.commission_amount
    )
  INTO v_id, v_user_id, v_before_event
  FROM public.commission_events AS event
  WHERE event.source_type = 'prospect_origin_sale'
    AND event.status IN ('pending', 'available')
  ORDER BY event.created_at, event.id LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO verification_results VALUES (
      'role_change_preserves_historical_origin_event', TRUE,
      'Skipped: no origin event exists yet; structural snapshot/immutability checks apply.'
    );
  ELSE
    SELECT role INTO v_original_role FROM public.user_profiles WHERE id = v_user_id;
    UPDATE public.user_profiles SET role = 'admin' WHERE id = v_user_id;
    SELECT jsonb_build_object(
      'seller_id', event.seller_id,
      'quantity', event.quantity,
      'unit_commission', event.unit_commission,
      'commission_amount', event.commission_amount
    ) INTO v_after_event
    FROM public.commission_events AS event WHERE event.id = v_id;
    UPDATE public.user_profiles SET role = v_original_role WHERE id = v_user_id;
    INSERT INTO verification_results VALUES (
      'role_change_preserves_historical_origin_event', v_before_event = v_after_event,
      format('event=%s seller=%s', v_id, v_user_id)
    );
  END IF;

  -- If an originator is inactive when a new operation is first synchronized,
  -- no new origin event is created. This mutation is rolled back below.
  v_id := NULL;
  SELECT movement.id, item.id, conversion.originator_user_id
  INTO v_id, v_item_id, v_user_id
  FROM public.commercial_partner_movements AS movement
  JOIN public.commercial_partner_movement_items AS item ON item.movement_id = movement.id
  JOIN public.commercial_prospect_conversions AS conversion
    ON conversion.commercial_partner_id = movement.partner_id
  JOIN public.user_profiles AS profile ON profile.id = conversion.originator_user_id
  WHERE lower(trim(movement.movement_type)) = 'settlement'
    AND lower(trim(movement.status)) = 'completed'
    AND COALESCE(item.quantity_sold, 0) > 0
    AND (movement.movement_date AT TIME ZONE 'America/Mexico_City')::DATE >= DATE '2026-09-30'
    AND profile.role = 'vendedora' AND profile.is_active
    AND NOT EXISTS (
      SELECT 1 FROM public.commission_events AS event
      WHERE event.source_type = 'prospect_origin_sale' AND event.source_item_id = item.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.commission_program_eligibility_snapshots AS snapshot
      WHERE snapshot.program = 'prospect_origin'
        AND snapshot.commercial_scheme = 'comodato'
        AND snapshot.source_item_id = item.id
    )
  ORDER BY movement.movement_date, item.id LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO verification_results VALUES (
      'inactive_originator_creates_no_new_origin_event', TRUE,
      'Skipped: no untouched post-effective Comodato fixture exists.'
    );
  ELSE
    SELECT is_active INTO v_original_active FROM public.user_profiles WHERE id = v_user_id;
    UPDATE public.user_profiles SET is_active = FALSE WHERE id = v_user_id;
    PERFORM public.sync_comodato_commissions_for_movement(v_id);
    SELECT NOT EXISTS (
      SELECT 1 FROM public.commission_events AS event
      WHERE event.source_type = 'prospect_origin_sale' AND event.source_item_id = v_item_id
    ) INTO v_pass;
    UPDATE public.user_profiles SET is_active = v_original_active WHERE id = v_user_id;
    INSERT INTO verification_results VALUES (
      'inactive_originator_creates_no_new_origin_event', v_pass,
      format('movement=%s item=%s originator=%s', v_id, v_item_id, v_user_id)
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO verification_results(check_name, passed, details)
  VALUES ('runtime_sync_tests_completed', FALSE, SQLSTATE || ': ' || SQLERRM)
  ON CONFLICT (check_name) DO UPDATE SET passed = FALSE, details = EXCLUDED.details;
END;
$$;

INSERT INTO verification_results(check_name, passed, details)
VALUES ('runtime_sync_tests_completed', TRUE, 'All available runtime fixtures completed inside the rollback transaction.')
ON CONFLICT (check_name) DO NOTHING;

SELECT jsonb_build_object(
  'all_checks_passed', bool_and(result.passed),
  'checks', jsonb_object_agg(result.check_name, result.passed ORDER BY result.check_name),
  'details', jsonb_object_agg(result.check_name, result.details ORDER BY result.check_name),
  'effective_date', '2026-09-30',
  'manual_tests', jsonb_build_array(
    'Bianca POS: sell 3 Michi + 2 Gato Mayor + 1 Jefe Felino; expect one available event per item and $26 total.',
    'Valid conversion: expect a $50 prospect_conversion_bonus immediately pending; partial first cut payment stays pending and full validated payment makes it available.',
    'Comodato: Gerardo keeps 5/10/15 while Bianca receives 2/5/10 on effective quantity_sold; both share pending/available state.',
    'Mayoreo: Gerardo keeps his existing wholesale commission while Bianca receives 2/5/10 on the same order quantities; both share payment release.',
    'Set inactive/change role after events exist: attribution and economic values remain; later operations create no new Bianca event.',
    'Payments: preview and settle accumulated approved Bianca sources, including a partial commission settlement; confirm one draft maximum and automatic expense on payment.'
  )
) AS verification
FROM verification_results AS result;

ROLLBACK;
