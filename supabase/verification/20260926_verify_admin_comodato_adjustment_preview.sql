-- Read-only verifier for 20260926_admin_comodato_adjustment_preview.sql.
-- It returns exactly one JSONB document.

WITH expected AS (
  SELECT
    'Abarrotes guacamayas'::TEXT AS partner_name,
    510.00::NUMERIC AS total_generated,
    210.00::NUMERIC AS total_paid,
    300.00::NUMERIC AS pending_balance,
    60.00::NUMERIC AS protected_due,
    5.00::NUMERIC AS protected_commission_each,
    10.00::NUMERIC AS protected_paid_commission,
    240.00::NUMERIC AS partial_due,
    150.00::NUMERIC AS partial_paid,
    3::INTEGER AS partial_max_quantity,
    90.00::NUMERIC AS partial_max_amount,
    15.00::NUMERIC AS partial_commission_reduction,
    10::INTEGER AS eligible_quantity,
    300.00::NUMERIC AS eligible_amount,
    50.00::NUMERIC AS eligible_commission_reduction
), function_rows AS (
  SELECT
    proc_row.oid,
    proc_row.prosecdef,
    proc_row.provolatile,
    proc_row.proconfig,
    language.lanname AS language_name,
    pg_get_function_result(proc_row.oid) AS result_type,
    pg_get_function_identity_arguments(proc_row.oid) AS identity_arguments,
    LOWER(pg_get_functiondef(proc_row.oid)) AS definition,
    NOT EXISTS (
      SELECT 1
      FROM aclexplode(
        COALESCE(proc_row.proacl, acldefault('f', proc_row.proowner))
      ) AS acl_row
      WHERE acl_row.grantee = 0
        AND acl_row.privilege_type = 'EXECUTE'
    ) AS public_execute_revoked
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace
    ON namespace.oid = proc_row.pronamespace
  JOIN pg_language AS language
    ON language.oid = proc_row.prolang
  WHERE namespace.nspname = 'public'
    AND proc_row.proname = 'get_admin_comodato_adjustment_preview'
), function_facts AS (
  SELECT
    COUNT(*) = 1 AS single_overload,
    BOOL_AND(identity_arguments = 'p_partner_id uuid') AS exact_signature,
    BOOL_AND(language_name = 'plpgsql') AS plpgsql,
    BOOL_AND(result_type = 'jsonb') AS returns_jsonb,
    BOOL_AND(prosecdef) AS security_definer,
    BOOL_AND(provolatile = 's') AS stable,
    BOOL_AND(
      COALESCE(proconfig, ARRAY[]::TEXT[])
        @> ARRAY['search_path=public, pg_temp']
    ) AS safe_search_path,
    BOOL_AND(
      public_execute_revoked
      AND NOT has_function_privilege('anon', oid, 'EXECUTE')
      AND has_function_privilege('authenticated', oid, 'EXECUTE')
    ) AS restricted_execute,
    BOOL_AND(POSITION('auth.uid()' IN definition) > 0) AS uses_auth_uid,
    BOOL_AND(
      POSITION('profile.role = ''admin''' IN definition) > 0
      AND POSITION('profile.is_active' IN definition) > 0
    ) AS validates_active_admin,
    BOOL_AND(
      POSITION('v_commission_event_payment_balances' IN definition) > 0
    ) AS uses_private_commission_balance_view,
    BOOL_AND(
      definition !~ '\m(insert|update|delete|merge)\M'
    ) AS contains_no_data_writes
  FROM function_rows
), view_privilege_facts AS (
  SELECT
    NOT has_table_privilege(
      'authenticated',
      'public.v_commission_event_payment_balances',
      'SELECT'
    )
    AND NOT has_table_privilege(
      'anon',
      'public.v_commission_event_payment_balances',
      'SELECT'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_class AS relation
      CROSS JOIN LATERAL aclexplode(
        COALESCE(relation.relacl, acldefault('r', relation.relowner))
      ) AS acl_row
      WHERE relation.oid =
        'public.v_commission_event_payment_balances'::REGCLASS
        AND acl_row.grantee = 0
        AND acl_row.privilege_type = 'SELECT'
    ) AS direct_select_remains_revoked
), target_partner AS (
  SELECT partner.id
  FROM public.commercial_partners AS partner
  CROSS JOIN expected
  WHERE LOWER(BTRIM(partner.business_name)) = LOWER(expected.partner_name)
), settlement_items AS (
  SELECT
    movement.id AS settlement_id,
    item.id AS movement_item_id,
    COALESCE(item.quantity_sold, 0)::NUMERIC AS quantity_sold,
    COALESCE(item.amount_due, 0)::NUMERIC AS amount_due
  FROM public.commercial_partner_movements AS movement
  JOIN public.commercial_partner_movement_items AS item
    ON item.movement_id = movement.id
  WHERE movement.partner_id IN (SELECT id FROM target_partner)
    AND LOWER(BTRIM(movement.movement_type)) = 'settlement'
    AND LOWER(BTRIM(movement.status)) = 'completed'
    AND COALESCE(item.quantity_sold, 0) > 0
), prior_adjustments AS (
  SELECT
    adjustment.adjusts_movement_item_id AS movement_item_id,
    COALESCE(SUM(adjustment.quantity_adjusted), 0)::NUMERIC
      AS quantity_already_adjusted,
    COALESCE(SUM(adjustment.amount_adjusted), 0)::NUMERIC
      AS amount_already_adjusted
  FROM public.commercial_partner_movement_items AS adjustment
  JOIN public.commercial_partner_movements AS movement
    ON movement.id = adjustment.movement_id
  WHERE movement.partner_id IN (SELECT id FROM target_partner)
    AND LOWER(BTRIM(movement.movement_type)) = 'adjustment'
    AND LOWER(BTRIM(movement.status)) = 'completed'
    AND adjustment.adjusts_movement_item_id IS NOT NULL
  GROUP BY adjustment.adjusts_movement_item_id
), approved_payments AS (
  SELECT
    payment.movement_id AS settlement_id,
    COALESCE(SUM(payment.amount), 0)::NUMERIC AS amount
  FROM public.commercial_partner_payments AS payment
  WHERE payment.partner_id IN (SELECT id FROM target_partner)
    AND LOWER(BTRIM(payment.status)) IN ('completed', 'paid')
  GROUP BY payment.movement_id
), active_requests AS (
  SELECT DISTINCT request.movement_id AS settlement_id
  FROM public.partner_payment_verification_requests AS request
  WHERE request.partner_id IN (SELECT id FROM target_partner)
    AND request.scheme = 'comodato'
    AND LOWER(BTRIM(COALESCE(request.status, '')))
      IN ('draft', 'pending_review')
), commission_state AS (
  SELECT
    event.id AS commission_event_id,
    event.source_id AS settlement_id,
    event.source_item_id AS movement_item_id,
    COALESCE(event.unit_commission, 0)::NUMERIC AS unit_commission,
    COALESCE(balance.paid_amount, 0)::NUMERIC AS paid_amount,
    COALESCE(balance.reserved_amount, 0)::NUMERIC AS reserved_amount,
    balance.payment_status,
    EXISTS (
      SELECT 1
      FROM public.commission_settlement_items AS settlement_item
      JOIN public.commission_settlements AS settlement
        ON settlement.id = settlement_item.settlement_id
      WHERE settlement_item.commission_event_id = event.id
        AND settlement.status IS DISTINCT FROM 'cancelled'
    ) AS in_non_cancelled_settlement
  FROM public.commission_events AS event
  LEFT JOIN public.v_commission_event_payment_balances AS balance
    ON balance.commission_event_id = event.id
  WHERE event.source_type = 'comodato_sale'
    AND event.partner_id IN (SELECT id FROM target_partner)
), item_base AS (
  SELECT
    item.*,
    COALESCE(adjustment.quantity_already_adjusted, 0)::NUMERIC
      AS quantity_already_adjusted,
    COALESCE(adjustment.amount_already_adjusted, 0)::NUMERIC
      AS amount_already_adjusted,
    COALESCE(payment.amount, 0)::NUMERIC AS approved_payment_amount,
    commission.commission_event_id,
    commission.unit_commission,
    commission.paid_amount,
    commission.reserved_amount,
    commission.payment_status,
    COALESCE(commission.in_non_cancelled_settlement, FALSE)
      AS in_non_cancelled_settlement,
    request.settlement_id IS NOT NULL AS has_active_request
  FROM settlement_items AS item
  LEFT JOIN prior_adjustments AS adjustment
    ON adjustment.movement_item_id = item.movement_item_id
  LEFT JOIN approved_payments AS payment
    ON payment.settlement_id = item.settlement_id
  LEFT JOIN active_requests AS request
    ON request.settlement_id = item.settlement_id
  LEFT JOIN commission_state AS commission
    ON commission.settlement_id = item.settlement_id
   AND commission.movement_item_id = item.movement_item_id
), movement_totals AS (
  SELECT
    base.settlement_id,
    SUM(base.amount_due - base.amount_already_adjusted)::NUMERIC
      AS effective_amount,
    MAX(base.approved_payment_amount)::NUMERIC AS approved_payment_amount
  FROM item_base AS base
  GROUP BY base.settlement_id
), eligibility AS (
  SELECT
    base.*,
    GREATEST(base.quantity_sold - base.quantity_already_adjusted, 0)::NUMERIC
      AS remaining_quantity,
    GREATEST(base.amount_due - base.amount_already_adjusted, 0)::NUMERIC
      AS remaining_amount,
    GREATEST(total.effective_amount - total.approved_payment_amount, 0)::NUMERIC
      AS movement_adjustable_amount,
    (
      ABS(COALESCE(base.paid_amount, 0)) > 0.005
      OR ABS(COALESCE(base.reserved_amount, 0)) > 0.005
      OR LOWER(COALESCE(base.payment_status, ''))
        IN ('paid', 'partially_paid')
      OR base.in_non_cancelled_settlement
    ) AS protected_commission
  FROM item_base AS base
  JOIN movement_totals AS total
    ON total.settlement_id = base.settlement_id
), preview_rows AS (
  SELECT
    eligibility.*,
    CASE
      WHEN eligibility.protected_commission
        OR eligibility.has_active_request
        OR eligibility.remaining_quantity <= 0
        OR eligibility.movement_adjustable_amount <= 0.005
      THEN 0
      ELSE cap.max_quantity
    END::INTEGER AS max_adjustable_quantity,
    CASE
      WHEN eligibility.protected_commission
        OR eligibility.has_active_request
        OR eligibility.remaining_quantity <= 0
        OR eligibility.movement_adjustable_amount <= 0.005
      THEN 0::NUMERIC
      WHEN cap.max_quantity = eligibility.remaining_quantity
        THEN eligibility.remaining_amount
      ELSE ROUND(
        eligibility.amount_due * cap.max_quantity / eligibility.quantity_sold,
        2
      )
    END::NUMERIC AS max_adjustable_amount,
    CASE
      WHEN eligibility.protected_commission
        OR eligibility.has_active_request
        OR eligibility.remaining_quantity <= 0
        OR eligibility.movement_adjustable_amount <= 0.005
      THEN 0::NUMERIC
      ELSE (cap.max_quantity * COALESCE(eligibility.unit_commission, 0))::NUMERIC
    END AS estimated_commission_reduction
  FROM eligibility
  CROSS JOIN LATERAL (
    SELECT COALESCE(MAX(candidate.quantity), 0)::INTEGER AS max_quantity
    FROM generate_series(
      0,
      GREATEST(FLOOR(eligibility.remaining_quantity), 0)::INTEGER
    ) AS candidate(quantity)
    WHERE CASE
      WHEN candidate.quantity = eligibility.remaining_quantity
        THEN eligibility.remaining_amount
      ELSE ROUND(
        eligibility.amount_due * candidate.quantity / eligibility.quantity_sold,
        2
      )
    END <= eligibility.movement_adjustable_amount + 0.005
  ) AS cap
), target_facts AS (
  SELECT
    EXISTS (SELECT 1 FROM target_partner) AS partner_exists,
    (SELECT COUNT(DISTINCT settlement_id) FROM settlement_items) = 4
      AS four_settlements,
    COALESCE((SELECT SUM(amount_due) FROM settlement_items), 0)::NUMERIC
      AS total_generated,
    COALESCE((SELECT SUM(amount) FROM approved_payments), 0)::NUMERIC
      AS total_paid,
    COALESCE((
      SELECT public.get_partner_comodato_pending_balance(id)
      FROM target_partner
      LIMIT 1
    ), 0)::NUMERIC AS pending_balance,
    EXISTS (
      SELECT 1
      FROM movement_totals AS total
      CROSS JOIN expected
      WHERE total.effective_amount = expected.protected_due
        AND total.approved_payment_amount = expected.protected_due
        AND (
          SELECT COALESCE(SUM(state.paid_amount), 0)
          FROM commission_state AS state
          WHERE state.settlement_id = total.settlement_id
        ) = expected.protected_paid_commission
        AND (
          SELECT COUNT(*)
          FROM commission_state AS state
          WHERE state.settlement_id = total.settlement_id
            AND state.paid_amount = expected.protected_commission_each
            AND LOWER(COALESCE(state.payment_status, '')) = 'paid'
        ) = 2
        AND NOT EXISTS (
          SELECT 1
          FROM preview_rows AS preview
          WHERE preview.settlement_id = total.settlement_id
            AND preview.max_adjustable_quantity > 0
        )
    ) AS protected_settlement_is_blocked,
    EXISTS (
      SELECT 1
      FROM movement_totals AS total
      CROSS JOIN expected
      WHERE total.effective_amount = expected.partial_due
        AND total.approved_payment_amount = expected.partial_paid
        AND (
          SELECT COALESCE(SUM(preview.max_adjustable_quantity), 0)
          FROM preview_rows AS preview
          WHERE preview.settlement_id = total.settlement_id
        ) = expected.partial_max_quantity
        AND (
          SELECT COALESCE(SUM(preview.max_adjustable_amount), 0)
          FROM preview_rows AS preview
          WHERE preview.settlement_id = total.settlement_id
        ) = expected.partial_max_amount
        AND (
          SELECT COALESCE(SUM(preview.estimated_commission_reduction), 0)
          FROM preview_rows AS preview
          WHERE preview.settlement_id = total.settlement_id
        ) = expected.partial_commission_reduction
    ) AS partial_settlement_matches,
    EXISTS (
      SELECT 1
      FROM movement_totals AS total
      WHERE total.effective_amount = 180
        AND total.approved_payment_amount = 0
        AND EXISTS (
          SELECT 1 FROM preview_rows AS preview
          WHERE preview.settlement_id = total.settlement_id
            AND preview.max_adjustable_amount > 0
        )
    ) AS settlement_180_is_eligible,
    EXISTS (
      SELECT 1
      FROM movement_totals AS total
      WHERE total.effective_amount = 30
        AND total.approved_payment_amount = 0
        AND EXISTS (
          SELECT 1 FROM preview_rows AS preview
          WHERE preview.settlement_id = total.settlement_id
            AND preview.max_adjustable_amount > 0
        )
    ) AS settlement_30_is_eligible,
    COALESCE((SELECT SUM(max_adjustable_quantity) FROM preview_rows), 0)::INTEGER
      AS total_eligible_quantity,
    COALESCE((SELECT SUM(max_adjustable_amount) FROM preview_rows), 0)::NUMERIC
      AS total_eligible_amount,
    COALESCE((
      SELECT SUM(estimated_commission_reduction) FROM preview_rows
    ), 0)::NUMERIC AS total_eligible_commission_reduction
)
SELECT JSONB_BUILD_OBJECT(
  'preview_rpc_exists', to_regprocedure(
    'public.get_admin_comodato_adjustment_preview(uuid)'
  ) IS NOT NULL,
  'single_overload', COALESCE(function_facts.single_overload, FALSE),
  'exact_signature', COALESCE(function_facts.exact_signature, FALSE),
  'language_is_plpgsql', COALESCE(function_facts.plpgsql, FALSE),
  'returns_jsonb', COALESCE(function_facts.returns_jsonb, FALSE),
  'security_definer', COALESCE(function_facts.security_definer, FALSE),
  'stable', COALESCE(function_facts.stable, FALSE),
  'safe_search_path', COALESCE(function_facts.safe_search_path, FALSE),
  'restricted_execute', COALESCE(function_facts.restricted_execute, FALSE),
  'uses_auth_uid', COALESCE(function_facts.uses_auth_uid, FALSE),
  'validates_active_admin',
    COALESCE(function_facts.validates_active_admin, FALSE),
  'uses_private_commission_balance_view',
    COALESCE(function_facts.uses_private_commission_balance_view, FALSE),
  'contains_no_data_writes',
    COALESCE(function_facts.contains_no_data_writes, FALSE),
  'authenticated_has_no_direct_private_view_select',
    view_privilege_facts.direct_select_remains_revoked,
  'abarrotes_partner_exists', target_facts.partner_exists,
  'abarrotes_has_four_settlements', target_facts.four_settlements,
  'abarrotes_total_generated_is_510',
    target_facts.total_generated = expected.total_generated,
  'abarrotes_total_paid_is_210',
    target_facts.total_paid = expected.total_paid,
  'abarrotes_pending_balance_is_300',
    target_facts.pending_balance = expected.pending_balance,
  'abarrotes_paid_60_and_two_paid_commissions_5_are_blocked',
    target_facts.protected_settlement_is_blocked,
  'abarrotes_240_paid_150_allows_3_units_90_and_15_commission',
    target_facts.partial_settlement_matches,
  'abarrotes_180_is_eligible', target_facts.settlement_180_is_eligible,
  'abarrotes_30_is_eligible', target_facts.settlement_30_is_eligible,
  'abarrotes_total_eligible_is_10_units',
    target_facts.total_eligible_quantity = expected.eligible_quantity,
  'abarrotes_total_eligible_amount_is_300',
    target_facts.total_eligible_amount = expected.eligible_amount,
  'abarrotes_total_commission_reduction_is_50',
    target_facts.total_eligible_commission_reduction
      = expected.eligible_commission_reduction,
  'all_checks_passed',
    to_regprocedure(
      'public.get_admin_comodato_adjustment_preview(uuid)'
    ) IS NOT NULL
    AND COALESCE(function_facts.single_overload, FALSE)
    AND COALESCE(function_facts.exact_signature, FALSE)
    AND COALESCE(function_facts.plpgsql, FALSE)
    AND COALESCE(function_facts.returns_jsonb, FALSE)
    AND COALESCE(function_facts.security_definer, FALSE)
    AND COALESCE(function_facts.stable, FALSE)
    AND COALESCE(function_facts.safe_search_path, FALSE)
    AND COALESCE(function_facts.restricted_execute, FALSE)
    AND COALESCE(function_facts.uses_auth_uid, FALSE)
    AND COALESCE(function_facts.validates_active_admin, FALSE)
    AND COALESCE(
      function_facts.uses_private_commission_balance_view,
      FALSE
    )
    AND COALESCE(function_facts.contains_no_data_writes, FALSE)
    AND view_privilege_facts.direct_select_remains_revoked
    AND target_facts.partner_exists
    AND target_facts.four_settlements
    AND target_facts.total_generated = expected.total_generated
    AND target_facts.total_paid = expected.total_paid
    AND target_facts.pending_balance = expected.pending_balance
    AND target_facts.protected_settlement_is_blocked
    AND target_facts.partial_settlement_matches
    AND target_facts.settlement_180_is_eligible
    AND target_facts.settlement_30_is_eligible
    AND target_facts.total_eligible_quantity = expected.eligible_quantity
    AND target_facts.total_eligible_amount = expected.eligible_amount
    AND target_facts.total_eligible_commission_reduction
      = expected.eligible_commission_reduction
) AS verification
FROM expected
CROSS JOIN function_facts
CROSS JOIN view_privilege_facts
CROSS JOIN target_facts;
