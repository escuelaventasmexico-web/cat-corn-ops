-- Read-only verifier for 20260926_comodato_payment_effective_balances.sql.
-- It returns exactly one JSONB document.

WITH expected AS (
  SELECT
    'Abarrotes guacamayas'::TEXT AS partner_name,
    330.00::NUMERIC AS historical_pending_before_adjustments,
    120.00::NUMERIC AS completed_adjustments,
    210.00::NUMERIC AS effective_pending
), function_rows AS (
  SELECT
    proc_row.oid,
    proc_row.proname,
    proc_row.prosecdef,
    proc_row.provolatile,
    proc_row.proconfig,
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
  WHERE namespace.nspname = 'public'
    AND proc_row.proname IN (
      'get_partner_comodato_payment_options',
      'create_partner_payment_verification_request',
      'approve_partner_payment_verification_request'
    )
), function_facts AS (
  SELECT
    COUNT(*) FILTER (
      WHERE proname = 'get_partner_comodato_payment_options'
    ) = 1 AS options_single_overload,
    BOOL_AND(identity_arguments = 'p_partner_id uuid') FILTER (
      WHERE proname = 'get_partner_comodato_payment_options'
    ) AS options_exact_signature,
    BOOL_AND(prosecdef AND provolatile = 's') FILTER (
      WHERE proname = 'get_partner_comodato_payment_options'
    ) AS options_secure_stable,
    BOOL_AND(
      COALESCE(proconfig, ARRAY[]::TEXT[])
        @> ARRAY['search_path=public, pg_temp']
    ) FILTER (
      WHERE proname = 'get_partner_comodato_payment_options'
    ) AS options_safe_search_path,
    BOOL_AND(
      public_execute_revoked
      AND NOT has_function_privilege('anon', oid, 'EXECUTE')
      AND has_function_privilege('authenticated', oid, 'EXECUTE')
    ) FILTER (
      WHERE proname = 'get_partner_comodato_payment_options'
    ) AS options_restricted_execute,
    BOOL_AND(
      POSITION('auth.uid()' IN definition) > 0
      AND POSITION('get_comodato_movement_pending_balance' IN definition) > 0
      AND POSITION('get_partner_comodato_pending_balance' IN definition) > 0
      AND POSITION('draft' IN definition) > 0
      AND POSITION('pending_review' IN definition) > 0
      AND definition !~ '\m(insert|update|delete|merge)\M'
    ) FILTER (
      WHERE proname = 'get_partner_comodato_payment_options'
    ) AS options_contract_is_safe,
    COUNT(*) FILTER (
      WHERE proname = 'create_partner_payment_verification_request'
    ) = 1 AS create_single_overload,
    BOOL_AND(
      identity_arguments =
        'p_scheme text, p_partner_id uuid, p_payment_date timestamp with time zone, p_amount numeric, p_payment_method text, p_movement_id uuid, p_wholesale_order_id uuid, p_payment_reference text, p_notes text'
    ) FILTER (
      WHERE proname = 'create_partner_payment_verification_request'
    ) AS create_exact_signature,
    BOOL_AND(
      prosecdef
      AND COALESCE(proconfig, ARRAY[]::TEXT[])
        @> ARRAY['search_path=public, pg_temp']
      AND public_execute_revoked
      AND NOT has_function_privilege('anon', oid, 'EXECUTE')
      AND has_function_privilege('authenticated', oid, 'EXECUTE')
    ) FILTER (
      WHERE proname = 'create_partner_payment_verification_request'
    ) AS create_security_contract,
    BOOL_AND(
      POSITION('get_comodato_movement_pending_balance' IN definition) > 0
      AND POSITION('for update' IN definition) > 0
      AND POSITION('draft' IN definition) > 0
      AND POSITION('pending_review' IN definition) > 0
    ) FILTER (
      WHERE proname = 'create_partner_payment_verification_request'
    ) AS create_revalidates_and_blocks_duplicates,
    BOOL_AND(
      POSITION('get_comodato_movement_pending_balance' IN definition) > 0
    ) FILTER (
      WHERE proname = 'approve_partner_payment_verification_request'
    ) AS approval_revalidates_effective_balance
  FROM function_rows
), target_partner AS (
  SELECT partner.id
  FROM public.commercial_partners AS partner
  CROSS JOIN expected
  WHERE LOWER(BTRIM(partner.business_name)) = LOWER(expected.partner_name)
), settlement_amounts AS (
  SELECT
    movement.id AS movement_id,
    movement.movement_date,
    COALESCE(SUM(item.amount_due), 0)::NUMERIC AS original_due
  FROM public.commercial_partner_movements AS movement
  JOIN public.commercial_partner_movement_items AS item
    ON item.movement_id = movement.id
  WHERE movement.partner_id IN (SELECT id FROM target_partner)
    AND LOWER(BTRIM(movement.movement_type)) = 'settlement'
    AND LOWER(BTRIM(movement.status)) = 'completed'
    AND COALESCE(item.quantity_sold, 0) > 0
  GROUP BY movement.id, movement.movement_date
), adjustment_links AS (
  SELECT
    original.movement_id AS settlement_id,
    adjustment.id AS adjustment_item_id,
    adjustment.adjusts_movement_item_id AS original_item_id,
    adjustment_movement.id AS adjustment_movement_id,
    adjustment_movement.movement_date AS adjustment_date,
    adjustment.amount_adjusted::NUMERIC AS amount_adjusted
  FROM public.commercial_partner_movement_items AS adjustment
  JOIN public.commercial_partner_movements AS adjustment_movement
    ON adjustment_movement.id = adjustment.movement_id
  JOIN public.commercial_partner_movement_items AS original
    ON original.id = adjustment.adjusts_movement_item_id
  JOIN settlement_amounts AS settlement
    ON settlement.movement_id = original.movement_id
  WHERE LOWER(BTRIM(adjustment_movement.movement_type)) = 'adjustment'
    AND LOWER(BTRIM(adjustment_movement.status)) = 'completed'
    AND adjustment.amount_adjusted > 0
), adjustments_by_settlement AS (
  SELECT
    link.settlement_id,
    SUM(link.amount_adjusted)::NUMERIC AS amount_adjusted
  FROM adjustment_links AS link
  GROUP BY link.settlement_id
), approved_payments AS (
  SELECT
    payment.movement_id,
    SUM(payment.amount)::NUMERIC AS amount_paid
  FROM public.commercial_partner_payments AS payment
  WHERE payment.partner_id IN (SELECT id FROM target_partner)
    AND LOWER(BTRIM(payment.status)) IN ('completed', 'paid')
  GROUP BY payment.movement_id
), active_requests AS (
  SELECT DISTINCT request.movement_id
  FROM public.partner_payment_verification_requests AS request
  WHERE request.partner_id IN (SELECT id FROM target_partner)
    AND request.scheme = 'comodato'
    AND LOWER(BTRIM(request.status)) IN ('draft', 'pending_review')
), settlement_balances AS (
  SELECT
    settlement.movement_id,
    settlement.movement_date,
    settlement.original_due,
    COALESCE(adjustment.amount_adjusted, 0)::NUMERIC AS amount_adjusted,
    COALESCE(payment.amount_paid, 0)::NUMERIC AS amount_paid,
    public.get_comodato_movement_pending_balance(
      settlement.movement_id
    )::NUMERIC AS effective_pending,
    request.movement_id IS NOT NULL AS has_active_request
  FROM settlement_amounts AS settlement
  LEFT JOIN adjustments_by_settlement AS adjustment
    ON adjustment.settlement_id = settlement.movement_id
  LEFT JOIN approved_payments AS payment
    ON payment.movement_id = settlement.movement_id
  LEFT JOIN active_requests AS request
    ON request.movement_id = settlement.movement_id
), target_facts AS (
  SELECT
    EXISTS (SELECT 1 FROM target_partner) AS partner_exists,
    COALESCE(SUM(original_due - amount_paid), 0)::NUMERIC
      AS historical_pending_before_adjustments,
    COALESCE(SUM(amount_adjusted), 0)::NUMERIC AS completed_adjustments,
    COALESCE(SUM(effective_pending), 0)::NUMERIC
      AS settlements_effective_pending,
    COALESCE((
      SELECT public.get_partner_comodato_pending_balance(id)
      FROM target_partner
      LIMIT 1
    ), 0)::NUMERIC AS partner_effective_pending,
    COALESCE(SUM(effective_pending) FILTER (
      WHERE effective_pending > 0.005
    ), 0)::NUMERIC AS positive_options_total
  FROM settlement_balances
), target_json AS (
  SELECT JSONB_BUILD_OBJECT(
    'adjustment_links', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'settlement_id', link.settlement_id,
          'original_item_id', link.original_item_id,
          'adjustment_movement_id', link.adjustment_movement_id,
          'adjustment_item_id', link.adjustment_item_id,
          'adjustment_date', link.adjustment_date,
          'amount_adjusted', link.amount_adjusted
        ) ORDER BY link.adjustment_date, link.adjustment_item_id
      )
      FROM adjustment_links AS link
    ), '[]'::JSONB),
    'settlement_balances', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'movement_id', balance.movement_id,
          'movement_date', balance.movement_date,
          'original_due', balance.original_due,
          'amount_adjusted', balance.amount_adjusted,
          'amount_paid', balance.amount_paid,
          'effective_pending', balance.effective_pending,
          'selectable', balance.effective_pending > 0.005
            AND NOT balance.has_active_request,
          'has_active_request', balance.has_active_request
        ) ORDER BY balance.movement_date DESC, balance.movement_id
      )
      FROM settlement_balances AS balance
    ), '[]'::JSONB)
  ) AS value
)
SELECT JSONB_BUILD_OBJECT(
  'options_rpc_exists', to_regprocedure(
    'public.get_partner_comodato_payment_options(uuid)'
  ) IS NOT NULL,
  'options_single_overload',
    COALESCE(function_facts.options_single_overload, FALSE),
  'options_exact_signature',
    COALESCE(function_facts.options_exact_signature, FALSE),
  'options_security_definer_and_stable',
    COALESCE(function_facts.options_secure_stable, FALSE),
  'options_safe_search_path',
    COALESCE(function_facts.options_safe_search_path, FALSE),
  'options_execute_restricted',
    COALESCE(function_facts.options_restricted_execute, FALSE),
  'options_contract_is_safe',
    COALESCE(function_facts.options_contract_is_safe, FALSE),
  'create_rpc_revalidates_and_blocks_duplicates',
    COALESCE(
      function_facts.create_revalidates_and_blocks_duplicates,
      FALSE
    ),
  'create_rpc_single_overload',
    COALESCE(function_facts.create_single_overload, FALSE),
  'create_rpc_exact_signature',
    COALESCE(function_facts.create_exact_signature, FALSE),
  'create_rpc_security_contract',
    COALESCE(function_facts.create_security_contract, FALSE),
  'approval_rpc_revalidates_effective_balance',
    COALESCE(
      function_facts.approval_revalidates_effective_balance,
      FALSE
    ),
  'abarrotes_partner_exists', target_facts.partner_exists,
  'abarrotes_historical_pending_before_adjustments',
    target_facts.historical_pending_before_adjustments,
  'abarrotes_completed_adjustments', target_facts.completed_adjustments,
  'abarrotes_settlements_effective_pending',
    target_facts.settlements_effective_pending,
  'abarrotes_partner_effective_pending',
    target_facts.partner_effective_pending,
  'abarrotes_positive_options_total', target_facts.positive_options_total,
  'abarrotes_adjustment_and_settlement_detail', target_json.value,
  'all_checks_passed',
    to_regprocedure(
      'public.get_partner_comodato_payment_options(uuid)'
    ) IS NOT NULL
    AND COALESCE(function_facts.options_single_overload, FALSE)
    AND COALESCE(function_facts.options_exact_signature, FALSE)
    AND COALESCE(function_facts.options_secure_stable, FALSE)
    AND COALESCE(function_facts.options_safe_search_path, FALSE)
    AND COALESCE(function_facts.options_restricted_execute, FALSE)
    AND COALESCE(function_facts.options_contract_is_safe, FALSE)
    AND COALESCE(function_facts.create_single_overload, FALSE)
    AND COALESCE(function_facts.create_exact_signature, FALSE)
    AND COALESCE(function_facts.create_security_contract, FALSE)
    AND COALESCE(
      function_facts.create_revalidates_and_blocks_duplicates,
      FALSE
    )
    AND COALESCE(
      function_facts.approval_revalidates_effective_balance,
      FALSE
    )
    AND target_facts.partner_exists
    AND target_facts.historical_pending_before_adjustments
      = expected.historical_pending_before_adjustments
    AND target_facts.completed_adjustments = expected.completed_adjustments
    AND target_facts.settlements_effective_pending
      = expected.effective_pending
    AND target_facts.partner_effective_pending = expected.effective_pending
    AND target_facts.positive_options_total = expected.effective_pending
) AS verification
FROM expected
CROSS JOIN function_facts
CROSS JOIN target_facts
CROSS JOIN target_json;
