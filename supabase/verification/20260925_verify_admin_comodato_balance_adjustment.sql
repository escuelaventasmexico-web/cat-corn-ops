-- Read-only verifier for 20260925_admin_comodato_balance_adjustment.sql.
-- It returns exactly one JSONB document.

WITH expected AS (
  SELECT
    'Abarrotes guacamayas'::TEXT AS partner_name,
    510.00::NUMERIC AS baseline_due,
    210.00::NUMERIC AS baseline_paid,
    300.00::NUMERIC AS baseline_pending,
    60.00::NUMERIC AS protected_settlement_due,
    10.00::NUMERIC AS protected_commission_paid,
    240.00::NUMERIC AS partial_settlement_due,
    150.00::NUMERIC AS partial_settlement_paid,
    90.00::NUMERIC AS partial_adjustment_amount,
    15.00::NUMERIC AS partial_commission_reduction,
    25.00::NUMERIC AS partial_remaining_commission,
    50.00::NUMERIC AS eligible_commission_reduction
), objects AS (
  SELECT
    to_regclass('public.commercial_partner_movements') IS NOT NULL AS movements_table_exists,
    to_regclass('public.commercial_partner_movement_items') IS NOT NULL AS items_table_exists,
    to_regprocedure('public.admin_adjust_comodato_balance(uuid,jsonb,text,text,text)') IS NOT NULL AS adjustment_rpc_exists,
    to_regprocedure('public.sync_comodato_commissions_for_movement(uuid)') IS NOT NULL AS sync_rpc_exists,
    to_regprocedure('public.get_comodato_movement_pending_balance(uuid)') IS NOT NULL AS movement_balance_rpc_exists,
    to_regprocedure('public.get_partner_comodato_pending_balance(uuid)') IS NOT NULL AS partner_balance_rpc_exists
), column_facts AS (
  SELECT
    bool_and(information_column.column_name IS NOT NULL) FILTER (WHERE contract = 'movement_adjustment') AS movement_columns_exist,
    bool_and(information_column.column_name IS NOT NULL) FILTER (WHERE contract = 'item_adjustment') AS item_columns_exist
  FROM (VALUES
    ('movement_adjustment', 'commercial_partner_movements', 'adjustment_folio'),
    ('movement_adjustment', 'commercial_partner_movements', 'adjustment_reason'),
    ('item_adjustment', 'commercial_partner_movement_items', 'amount_adjusted'),
    ('item_adjustment', 'commercial_partner_movement_items', 'adjusts_movement_item_id'),
    ('item_adjustment', 'commercial_partner_movement_items', 'commission_amount_adjusted'),
    ('item_adjustment', 'commercial_partner_movement_items', 'adjusts_commission_event_id')
  ) AS required(contract, table_name, required_column)
  LEFT JOIN information_schema.columns AS information_column
    ON information_column.table_schema = 'public'
   AND information_column.table_name = required.table_name
   AND information_column.column_name = required.required_column
), constraint_facts AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.commercial_partner_movements'::REGCLASS
        AND constraint_row.contype = 'u'
        AND pg_get_constraintdef(constraint_row.oid) ILIKE '%adjustment_folio%'
    ) AS adjustment_folio_unique,
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.commercial_partner_movement_items'::REGCLASS
        AND constraint_row.contype = 'f'
        AND pg_get_constraintdef(constraint_row.oid) ILIKE '%adjusts_movement_item_id%'
    ) AS original_item_foreign_key,
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.commercial_partner_movement_items'::REGCLASS
        AND constraint_row.contype = 'f'
        AND pg_get_constraintdef(constraint_row.oid) ILIKE '%adjusts_commission_event_id%'
    ) AS commission_event_foreign_key,
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.commercial_partner_movement_items'::REGCLASS
        AND constraint_row.contype = 'c'
        AND pg_get_constraintdef(constraint_row.oid) ~* 'amount_adjusted.*>=.*0'
    ) AS adjustment_amount_nonnegative
), trigger_facts AS (
  SELECT
    count(*) FILTER (
      WHERE trigger_row.tgrelid = 'public.commercial_partner_movements'::REGCLASS
        AND trigger_row.tgname = 'trg_admin_comodato_adjustment_movement_guard'
    ) = 1 AS movement_guard_exists,
    count(*) FILTER (
      WHERE trigger_row.tgrelid = 'public.commercial_partner_movement_items'::REGCLASS
        AND trigger_row.tgname = 'trg_admin_comodato_adjustment_item_guard'
    ) = 1 AS item_guard_exists,
    bool_or(lower(pg_get_functiondef(proc_row.oid)) LIKE '%app.admin_comodato_adjustment_write%')
      AS guard_requires_rpc_local_setting,
    bool_or(
      lower(pg_get_functiondef(proc_row.oid)) LIKE '%old.movement_type%'
      AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%old.movement_id%'
      AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%new.movement_type%'
      AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%new.movement_id%'
    ) AS guard_protects_old_and_new_parent
  FROM pg_trigger AS trigger_row
  JOIN pg_proc AS proc_row ON proc_row.oid = trigger_row.tgfoid
  WHERE NOT trigger_row.tgisinternal
    AND trigger_row.tgname IN (
      'trg_admin_comodato_adjustment_movement_guard',
      'trg_admin_comodato_adjustment_item_guard'
    )
), function_rows AS (
  SELECT proc_row.oid, proc_row.proname, proc_row.prosecdef, proc_row.proconfig,
    pg_get_function_identity_arguments(proc_row.oid) AS identity_arguments,
    lower(pg_get_functiondef(proc_row.oid)) AS definition,
    NOT EXISTS (
      SELECT 1 FROM aclexplode(coalesce(proc_row.proacl, acldefault('f', proc_row.proowner))) AS acl_row
      WHERE acl_row.grantee = 0 AND acl_row.privilege_type = 'EXECUTE'
    ) AS public_execute_revoked
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace ON namespace.oid = proc_row.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc_row.proname IN (
      'admin_adjust_comodato_balance',
      'sync_comodato_commissions_for_movement',
      'get_comodato_movement_pending_balance',
      'get_partner_comodato_pending_balance',
      'approve_partner_payment_verification_request',
      'get_b2b_monthly_analysis',
      'get_b2b_monthly_collections_report'
    )
), function_facts AS (
  SELECT
    count(*) FILTER (WHERE proname = 'admin_adjust_comodato_balance') = 1 AS adjustment_single_overload,
    bool_and(identity_arguments = 'p_partner_id uuid, p_adjustments jsonb, p_reason text, p_admin_password text, p_notes text')
      FILTER (WHERE proname = 'admin_adjust_comodato_balance') AS adjustment_exact_signature,
    bool_and(prosecdef) FILTER (WHERE proname = 'admin_adjust_comodato_balance') AS adjustment_security_definer,
    bool_and(coalesce(proconfig, ARRAY[]::TEXT[]) @> ARRAY['search_path=public, pg_temp'])
      FILTER (WHERE proname = 'admin_adjust_comodato_balance') AS adjustment_safe_search_path,
    bool_and(public_execute_revoked
      AND NOT has_function_privilege('anon', oid, 'EXECUTE')
      AND has_function_privilege('authenticated', oid, 'EXECUTE'))
      FILTER (WHERE proname = 'admin_adjust_comodato_balance') AS adjustment_execute_restricted,
    bool_and(position('v_actor uuid := auth.uid()' IN definition) > 0
      AND position('role = ''admin''' IN definition) > 0
      AND position('verify_financial_access_password' IN definition) > 0)
      FILTER (WHERE proname = 'admin_adjust_comodato_balance') AS adjustment_admin_authenticated,
    bool_and(position('for update' IN definition) > 0
      AND position('set_config(''app.admin_comodato_adjustment_write''' IN definition) > 0)
      FILTER (WHERE proname = 'admin_adjust_comodato_balance') AS adjustment_locks_and_sets_write_guard,
    bool_and(position('quantity_adjusted' IN definition) > 0
      AND position('amount_adjusted' IN definition) > 0
      AND position('adjusts_movement_item_id' IN definition) > 0
      AND position('adjusts_commission_event_id' IN definition) > 0)
      FILTER (WHERE proname = 'admin_adjust_comodato_balance') AS adjustment_is_append_only,
    bool_and(position('partner_payment_verification_requests' IN definition) > 0
      AND position('in (''draft'', ''pending_review'')' IN definition) > 0)
      FILTER (WHERE proname = 'admin_adjust_comodato_balance') AS adjustment_blocks_active_payment_requests,
    bool_and(position('combined adjustment would reduce settlement' IN definition) > 0
      AND position('r_settlement' IN definition) > 0)
      FILTER (WHERE proname = 'admin_adjust_comodato_balance') AS adjustment_validates_combined_settlement_effect,
    bool_and(position('v_commission_event_payment_balances' IN definition) > 0
      AND position('paid_amount' IN definition) > 0
      AND position('reserved_amount' IN definition) > 0
      AND position('commission_settlements' IN definition) > 0)
      FILTER (WHERE proname = 'admin_adjust_comodato_balance') AS adjustment_blocks_commission_commitments,
    bool_and(position('commercial_delivery_units' IN definition) = 0
      AND position('barcode' IN definition) = 0)
      FILTER (WHERE proname = 'admin_adjust_comodato_balance') AS adjustment_does_not_change_physical_labels,
    bool_and(position('quantity_sold - r_item.quantity_adjusted_total' IN definition) > 0
      AND position('status = ''cancelled''' IN definition) > 0
      AND position('v_existing_event.status = ''cancelled''' IN definition) > 0)
      FILTER (WHERE proname = 'sync_comodato_commissions_for_movement') AS sync_uses_effective_quantity_and_preserves_cancellation,
    bool_and(position('get_comodato_movement_pending_balance' IN definition) > 0)
      FILTER (WHERE proname = 'approve_partner_payment_verification_request') AS payment_approval_uses_effective_balance,
    bool_and(position('amount_adjusted' IN definition) > 0)
      FILTER (WHERE proname IN ('get_comodato_movement_pending_balance', 'get_partner_comodato_pending_balance')) AS balance_functions_subtract_adjustments
    , bool_and(position('amount_adjusted' IN definition) > 0)
      FILTER (WHERE proname IN ('get_b2b_monthly_analysis', 'get_b2b_monthly_collections_report')) AS operational_reports_use_effective_comodato_amounts
  FROM function_rows
), view_facts AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_views AS view_row
      WHERE view_row.schemaname = 'public' AND view_row.viewname = 'v_commercial_partner_balances'
        AND lower(view_row.definition) LIKE '%amount_adjusted%'
        AND lower(view_row.definition) LIKE '%pending_balance%'
    ) AS balances_view_uses_adjustments,
    EXISTS (
      SELECT 1 FROM pg_views AS view_row
      WHERE view_row.schemaname = 'public' AND view_row.viewname = 'v_pending_payment_verifications'
        AND lower(view_row.definition) LIKE '%amount_adjusted%'
        AND lower(view_row.definition) LIKE '%get_partner_comodato_pending_balance%'
    ) AS payment_verifications_view_uses_adjustments
), target_partner AS (
  SELECT partner.id
  FROM public.commercial_partners AS partner
  CROSS JOIN expected
  WHERE lower(btrim(partner.business_name)) = lower(expected.partner_name)
), target_totals AS (
  SELECT
    COALESCE((SELECT SUM(item.amount_due)
      FROM public.commercial_partner_movement_items AS item
      JOIN public.commercial_partner_movements AS movement ON movement.id = item.movement_id
      WHERE movement.partner_id IN (SELECT id FROM target_partner)
        AND lower(trim(movement.movement_type)) = 'settlement'
        AND lower(trim(movement.status)) = 'completed'
        AND item.quantity_sold > 0), 0)::NUMERIC AS original_due,
    COALESCE((SELECT SUM(payment.amount) FROM public.commercial_partner_payments AS payment
      WHERE payment.partner_id IN (SELECT id FROM target_partner)
        AND lower(trim(payment.status)) IN ('completed', 'paid')), 0)::NUMERIC AS approved_paid,
    COALESCE((SELECT SUM(adjustment.amount_adjusted)
      FROM public.commercial_partner_movement_items AS adjustment
      JOIN public.commercial_partner_movements AS adjustment_movement
        ON adjustment_movement.id = adjustment.movement_id
      WHERE adjustment_movement.partner_id IN (SELECT id FROM target_partner)
        AND lower(trim(adjustment_movement.movement_type)) = 'adjustment'
        AND lower(trim(adjustment_movement.status)) = 'completed'), 0)::NUMERIC AS applied_adjustments,
    COALESCE((SELECT public.get_partner_comodato_pending_balance(id) FROM target_partner LIMIT 1), 0)::NUMERIC AS effective_pending
), abarrotes_facts AS (
  SELECT
    EXISTS (SELECT 1 FROM target_partner) AS partner_exists,
    (SELECT original_due = expected.baseline_due AND approved_paid = expected.baseline_paid
      AND effective_pending = expected.baseline_pending FROM target_totals CROSS JOIN expected) AS baseline_matches,
    (SELECT original_due = expected.baseline_due
      AND approved_paid = expected.baseline_paid
      AND effective_pending = GREATEST(original_due - applied_adjustments - approved_paid, 0)
      AND applied_adjustments BETWEEN 0 AND expected.baseline_pending
      FROM target_totals CROSS JOIN expected) AS financial_state_reconciles,
    EXISTS (
      SELECT 1
      FROM public.commercial_partner_movements AS movement
      WHERE movement.partner_id IN (SELECT id FROM target_partner)
        AND lower(trim(movement.movement_type)) = 'settlement'
        AND lower(trim(movement.status)) = 'completed'
        AND public.get_comodato_movement_pending_balance(movement.id) = 0
        AND (
          SELECT COALESCE(SUM(item.amount_due), 0) FROM public.commercial_partner_movement_items AS item
          WHERE item.movement_id = movement.id AND item.quantity_sold > 0
        ) = expected.protected_settlement_due
        AND (
          SELECT COALESCE(SUM(balance.paid_amount), 0)
          FROM public.commission_events AS event
          JOIN public.v_commission_event_payment_balances AS balance ON balance.commission_event_id = event.id
          WHERE event.source_type = 'comodato_sale' AND event.source_id = movement.id
        ) = expected.protected_commission_paid
    ) AS paid_settlement_and_commission_are_protected,
    EXISTS (
      SELECT 1
      FROM public.commercial_partner_movements AS movement
      WHERE movement.partner_id IN (SELECT id FROM target_partner)
        AND lower(trim(movement.movement_type)) = 'settlement'
        AND lower(trim(movement.status)) = 'completed'
        AND (
          SELECT COALESCE(SUM(item.amount_due), 0) FROM public.commercial_partner_movement_items AS item
          WHERE item.movement_id = movement.id AND item.quantity_sold > 0
        ) = expected.partial_settlement_due
        AND (
          SELECT COALESCE(SUM(payment.amount), 0) FROM public.commercial_partner_payments AS payment
          WHERE payment.movement_id = movement.id AND lower(trim(payment.status)) IN ('completed', 'paid')
        ) = expected.partial_settlement_paid
        AND EXISTS (
          SELECT 1 FROM public.commercial_partner_movement_items AS item
          JOIN public.commission_events AS event ON event.source_item_id = item.id AND event.source_type = 'comodato_sale'
          WHERE item.movement_id = movement.id AND item.quantity_sold >= 3
            AND round(item.amount_due * 3 / item.quantity_sold, 2) = expected.partial_adjustment_amount
            AND event.unit_commission * 3 = expected.partial_commission_reduction
            AND (
              SELECT COALESCE(SUM(other_event.commission_amount), 0)
              FROM public.commission_events AS other_event
              WHERE other_event.source_type = 'comodato_sale'
                AND other_event.source_id = movement.id
            ) - event.unit_commission * 3 = expected.partial_remaining_commission
        )
    ) AS partial_settlement_has_expected_safe_adjustment,
    (
      COALESCE((
        SELECT SUM(event.commission_amount)
      FROM public.commission_events AS event
      JOIN public.commercial_partner_movements AS movement ON movement.id = event.source_id
      JOIN public.v_commission_event_payment_balances AS balance ON balance.commission_event_id = event.id
      WHERE movement.partner_id IN (SELECT id FROM target_partner)
        AND event.source_type = 'comodato_sale'
        AND event.status IN ('pending', 'available')
        AND balance.paid_amount = 0
        AND balance.reserved_amount = 0
          AND NOT EXISTS (
            SELECT 1 FROM public.commercial_partner_payments AS payment
            WHERE payment.movement_id = movement.id
              AND lower(trim(payment.status)) IN ('completed', 'paid')
          )
      ), 0)
      + expected.partial_commission_reduction
    )::NUMERIC = expected.eligible_commission_reduction
      AS all_eligible_adjustments_reduce_50_not_75,
    NOT EXISTS (
      SELECT 1 FROM public.commercial_delivery_units AS unit_row
      JOIN public.commercial_partner_movements AS movement ON movement.id = unit_row.movement_id
      WHERE lower(trim(movement.movement_type)) = 'adjustment'
    ) AS adjustments_do_not_create_or_change_delivery_units
  FROM expected
)
SELECT jsonb_build_object(
  'movements_table_exists', objects.movements_table_exists,
  'items_table_exists', objects.items_table_exists,
  'adjustment_rpc_exists', objects.adjustment_rpc_exists,
  'sync_rpc_exists', objects.sync_rpc_exists,
  'movement_balance_rpc_exists', objects.movement_balance_rpc_exists,
  'partner_balance_rpc_exists', objects.partner_balance_rpc_exists,
  'movement_adjustment_columns_exist', COALESCE(column_facts.movement_columns_exist, FALSE),
  'item_adjustment_columns_exist', COALESCE(column_facts.item_columns_exist, FALSE),
  'adjustment_folio_unique', constraint_facts.adjustment_folio_unique,
  'original_item_foreign_key', constraint_facts.original_item_foreign_key,
  'commission_event_foreign_key', constraint_facts.commission_event_foreign_key,
  'adjustment_amount_nonnegative', constraint_facts.adjustment_amount_nonnegative,
  'movement_guard_exists', trigger_facts.movement_guard_exists,
  'item_guard_exists', trigger_facts.item_guard_exists,
  'guard_requires_rpc_local_setting', trigger_facts.guard_requires_rpc_local_setting,
  'guard_protects_old_and_new_parent', trigger_facts.guard_protects_old_and_new_parent,
  'adjustment_has_single_overload', COALESCE(function_facts.adjustment_single_overload, FALSE),
  'adjustment_has_exact_signature', COALESCE(function_facts.adjustment_exact_signature, FALSE),
  'adjustment_is_security_definer', COALESCE(function_facts.adjustment_security_definer, FALSE),
  'adjustment_has_safe_search_path', COALESCE(function_facts.adjustment_safe_search_path, FALSE),
  'adjustment_execute_restricted', COALESCE(function_facts.adjustment_execute_restricted, FALSE),
  'adjustment_is_admin_authenticated', COALESCE(function_facts.adjustment_admin_authenticated, FALSE),
  'adjustment_locks_and_sets_write_guard', COALESCE(function_facts.adjustment_locks_and_sets_write_guard, FALSE),
  'adjustment_is_append_only', COALESCE(function_facts.adjustment_is_append_only, FALSE),
  'adjustment_blocks_active_payment_requests', COALESCE(function_facts.adjustment_blocks_active_payment_requests, FALSE),
  'adjustment_validates_combined_settlement_effect', COALESCE(function_facts.adjustment_validates_combined_settlement_effect, FALSE),
  'adjustment_blocks_commission_commitments', COALESCE(function_facts.adjustment_blocks_commission_commitments, FALSE),
  'adjustment_does_not_change_physical_labels', COALESCE(function_facts.adjustment_does_not_change_physical_labels, FALSE),
  'sync_uses_effective_quantity_and_preserves_cancellation', COALESCE(function_facts.sync_uses_effective_quantity_and_preserves_cancellation, FALSE),
  'payment_approval_uses_effective_balance', COALESCE(function_facts.payment_approval_uses_effective_balance, FALSE),
  'balance_functions_subtract_adjustments', COALESCE(function_facts.balance_functions_subtract_adjustments, FALSE),
  'operational_reports_use_effective_comodato_amounts', COALESCE(function_facts.operational_reports_use_effective_comodato_amounts, FALSE),
  'balances_view_uses_adjustments', view_facts.balances_view_uses_adjustments,
  'payment_verifications_view_uses_adjustments', view_facts.payment_verifications_view_uses_adjustments,
  'abarrotes_partner_exists', abarrotes_facts.partner_exists,
  'abarrotes_baseline_is_510_210_300', abarrotes_facts.baseline_matches,
  'abarrotes_financial_state_reconciles', abarrotes_facts.financial_state_reconciles,
  'abarrotes_paid_60_and_paid_10_commission_protected', abarrotes_facts.paid_settlement_and_commission_are_protected,
  'abarrotes_partial_240_adjustment_is_90_reduces_15_leaves_25', abarrotes_facts.partial_settlement_has_expected_safe_adjustment,
  'abarrotes_all_eligible_adjustments_reduce_50_not_75', abarrotes_facts.all_eligible_adjustments_reduce_50_not_75,
  'adjustments_have_no_physical_delivery_units', abarrotes_facts.adjustments_do_not_create_or_change_delivery_units,
  'all_checks_passed',
    objects.movements_table_exists AND objects.items_table_exists
    AND objects.adjustment_rpc_exists AND objects.sync_rpc_exists
    AND objects.movement_balance_rpc_exists AND objects.partner_balance_rpc_exists
    AND COALESCE(column_facts.movement_columns_exist, FALSE)
    AND COALESCE(column_facts.item_columns_exist, FALSE)
    AND constraint_facts.adjustment_folio_unique AND constraint_facts.original_item_foreign_key
    AND constraint_facts.commission_event_foreign_key AND constraint_facts.adjustment_amount_nonnegative
    AND trigger_facts.movement_guard_exists AND trigger_facts.item_guard_exists
    AND trigger_facts.guard_requires_rpc_local_setting
    AND trigger_facts.guard_protects_old_and_new_parent
    AND COALESCE(function_facts.adjustment_single_overload, FALSE)
    AND COALESCE(function_facts.adjustment_exact_signature, FALSE)
    AND COALESCE(function_facts.adjustment_security_definer, FALSE)
    AND COALESCE(function_facts.adjustment_safe_search_path, FALSE)
    AND COALESCE(function_facts.adjustment_execute_restricted, FALSE)
    AND COALESCE(function_facts.adjustment_admin_authenticated, FALSE)
    AND COALESCE(function_facts.adjustment_locks_and_sets_write_guard, FALSE)
    AND COALESCE(function_facts.adjustment_is_append_only, FALSE)
    AND COALESCE(function_facts.adjustment_blocks_active_payment_requests, FALSE)
    AND COALESCE(function_facts.adjustment_validates_combined_settlement_effect, FALSE)
    AND COALESCE(function_facts.adjustment_blocks_commission_commitments, FALSE)
    AND COALESCE(function_facts.adjustment_does_not_change_physical_labels, FALSE)
    AND COALESCE(function_facts.sync_uses_effective_quantity_and_preserves_cancellation, FALSE)
    AND COALESCE(function_facts.payment_approval_uses_effective_balance, FALSE)
    AND COALESCE(function_facts.balance_functions_subtract_adjustments, FALSE)
    AND COALESCE(function_facts.operational_reports_use_effective_comodato_amounts, FALSE)
    AND view_facts.balances_view_uses_adjustments AND view_facts.payment_verifications_view_uses_adjustments
    AND abarrotes_facts.partner_exists AND abarrotes_facts.financial_state_reconciles
    AND abarrotes_facts.paid_settlement_and_commission_are_protected
    AND abarrotes_facts.partial_settlement_has_expected_safe_adjustment
    AND abarrotes_facts.all_eligible_adjustments_reduce_50_not_75
    AND abarrotes_facts.adjustments_do_not_create_or_change_delivery_units
) AS verification
FROM objects
CROSS JOIN column_facts
CROSS JOIN constraint_facts
CROSS JOIN trigger_facts
CROSS JOIN function_facts
CROSS JOIN view_facts
CROSS JOIN abarrotes_facts;
