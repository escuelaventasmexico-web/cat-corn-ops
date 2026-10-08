BEGIN;

SET TRANSACTION READ ONLY;

WITH
expected_identity AS (
  SELECT
    'd20e700b-058f-4391-9989-33b2cf34896c'::UUID AS prospect_id,
    'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID AS originator_id,
    '682568c5-4339-4af5-85ef-71c8b2febd59'::UUID AS assigned_id
),
casa_ajusco_rows AS MATERIALIZED (
  SELECT
    prospect.id,
    prospect.business_name,
    prospect.status,
    prospect.originator_user_id,
    prospect.assigned_to,
    prospect.commercial_partner_id,
    prospect.converted_at,
    (
      SELECT count(*)
      FROM public.commercial_prospect_conversions AS conversion
      WHERE conversion.prospect_id = prospect.id
    ) AS conversion_count
  FROM public.commercial_prospects AS prospect
  WHERE translate(lower(btrim(prospect.business_name)), 'áéíóúüñ', 'aeiouun')
    = 'jardin de eventos casa ajusco'
),
casa_ajusco_partner_count AS MATERIALIZED (
  SELECT count(*) AS total
  FROM public.commercial_partners AS partner
  WHERE translate(lower(btrim(partner.business_name)), 'áéíóúüñ', 'aeiouun')
    = 'jardin de eventos casa ajusco'
),
casa_ajusco_facts AS (
  SELECT
    count(*) = 1 AS exactly_one_unconverted_prospect,
    COALESCE(bool_and(
      prospect.id = expected.prospect_id
      AND prospect.status = 'visita_programada'
      AND prospect.commercial_partner_id IS NULL
      AND prospect.converted_at IS NULL
      AND prospect.conversion_count = 0
    ), FALSE) AS identity_and_state_unchanged,
    COALESCE(bool_and(prospect.originator_user_id = expected.originator_id), FALSE)
      AS originator_is_angelica,
    COALESCE(bool_and(prospect.assigned_to = expected.assigned_id), FALSE)
      AS assigned_to_gerardo,
    (SELECT total = 0 FROM casa_ajusco_partner_count)
      AS no_partner_was_created
  FROM casa_ajusco_rows AS prospect
  CROSS JOIN expected_identity AS expected
),
prospect_view_facts AS (
  SELECT
    count(*) = 1 AS view_exists,
    COALESCE(bool_and(
      lower(view_row.definition) LIKE '%commercial_prospects%'
      AND lower(view_row.definition) LIKE '%originator_name%'
      AND lower(view_row.definition) LIKE '%assigned_to%'
      AND lower(view_row.definition) LIKE '%commercial_partner_id%'
    ), FALSE) AS frontend_source_contract_is_complete,
    COALESCE(bool_and(
      COALESCE(option_row.option_value, '') = 'true'
    ), FALSE) AS remains_security_invoker
  FROM pg_views AS view_row
  LEFT JOIN LATERAL (
    SELECT split_part(option_value, '=', 2) AS option_value
    FROM unnest(COALESCE(
      (
        SELECT class_row.reloptions
        FROM pg_class AS class_row
        JOIN pg_namespace AS namespace_row ON namespace_row.oid = class_row.relnamespace
        WHERE namespace_row.nspname = view_row.schemaname
          AND class_row.relname = view_row.viewname
      ),
      ARRAY[]::TEXT[]
    )) AS option_value
    WHERE option_value LIKE 'security_invoker=%'
  ) AS option_row ON TRUE
  WHERE view_row.schemaname = 'public'
    AND view_row.viewname = 'v_commercial_prospect_details'
),
prospect_policy_facts AS (
  SELECT COALESCE(bool_or(
    policy_row.cmd IN ('SELECT', 'ALL')
    AND (
      'authenticated' = ANY(policy_row.roles)
      OR 'public' = ANY(policy_row.roles)
    )
    AND (
      lower(COALESCE(policy_row.qual, '')) LIKE '%socios_comerciales%'
      OR (
        lower(COALESCE(policy_row.qual, '')) LIKE '%assigned_to%'
        AND lower(COALESCE(policy_row.qual, '')) LIKE '%auth.uid()%'
      )
    )
  ), FALSE) AS gerardo_read_contract_exists
  FROM pg_policies AS policy_row
  WHERE policy_row.schemaname = 'public'
    AND policy_row.tablename = 'commercial_prospects'
),
prospect_update_function_facts AS (
  SELECT COALESCE(bool_and(
    lower(pg_get_functiondef(proc_row.oid)) NOT LIKE '%insert into public.commercial_partners%'
  ), FALSE) AS assignment_does_not_create_partner
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.proname = 'update_commercial_prospect'
),
conversion_trigger_rows AS MATERIALIZED (
  SELECT
    trigger_row.tgname,
    lower(pg_get_triggerdef(trigger_row.oid, TRUE)) AS trigger_definition,
    lower(pg_get_functiondef(trigger_function.oid)) AS function_definition
  FROM pg_trigger AS trigger_row
  JOIN pg_proc AS trigger_function ON trigger_function.oid = trigger_row.tgfoid
  WHERE trigger_row.tgrelid = 'public.commercial_prospect_conversions'::REGCLASS
    AND NOT trigger_row.tgisinternal
    AND (trigger_row.tgtype & 4) = 4
),
conversion_trigger_facts AS (
  SELECT
    count(*) FILTER (
      WHERE tgname = 'trg_sync_prospect_bonus_from_conversion'
    ) = 1 AS eligibility_trigger_exists_once,
    COALESCE(bool_and(
      function_definition LIKE '%_capture_prospect_conversion_bonus_eligibility%'
      AND function_definition NOT LIKE '%sync_prospect_conversion_bonus(%'
      AND function_definition NOT LIKE '%_create_prospect_conversion_bonus_entitlement%'
      AND function_definition NOT LIKE '%insert into public.commission_events%'
    ) FILTER (
      WHERE tgname = 'trg_sync_prospect_bonus_from_conversion'
    ), FALSE) AS conversion_only_captures_eligibility,
    count(*) FILTER (
      WHERE function_definition LIKE '%insert into public.commission_events%'
        OR function_definition LIKE '%sync_prospect_conversion_bonus(%'
        OR function_definition LIKE '%_create_prospect_conversion_bonus_entitlement%'
    ) = 0 AS no_conversion_trigger_creates_bonus_event
  FROM conversion_trigger_rows
),
convert_rpc_facts AS (
  SELECT
    count(*) > 0 AS conversion_rpc_exists,
    COALESCE(bool_and(
      lower(pg_get_functiondef(proc_row.oid)) NOT LIKE '%insert into public.commission_events%'
      AND lower(pg_get_functiondef(proc_row.oid)) NOT LIKE '%sync_prospect_conversion_bonus(%'
      AND lower(pg_get_functiondef(proc_row.oid)) NOT LIKE '%_create_prospect_conversion_bonus_entitlement%'
    ), FALSE) AS conversion_rpc_does_not_create_bonus_event
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.proname = 'convert_commercial_prospect'
),
eligibility_table_facts AS (
  SELECT
    to_regclass('public.prospect_conversion_bonus_eligibility') IS NOT NULL
      AS eligibility_table_exists,
    EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      JOIN pg_proc AS trigger_function ON trigger_function.oid = trigger_row.tgfoid
      WHERE trigger_row.tgrelid = 'public.prospect_conversion_bonus_eligibility'::REGCLASS
        AND NOT trigger_row.tgisinternal
        AND (trigger_row.tgtype & 16) = 16
        AND (trigger_row.tgtype & 8) = 8
        AND lower(pg_get_functiondef(trigger_function.oid)) LIKE '%immutable%'
    ) AS eligibility_is_immutable,
    NOT has_table_privilege('authenticated', 'public.prospect_conversion_bonus_eligibility', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.prospect_conversion_bonus_eligibility', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.prospect_conversion_bonus_eligibility', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.prospect_conversion_bonus_eligibility', 'DELETE')
      AS authenticated_has_no_direct_access,
    NOT EXISTS (
      SELECT 1
      FROM public.prospect_conversion_bonus_eligibility AS snapshot
      WHERE snapshot.eligible
        AND (
          snapshot.rule_id IS NULL
          OR snapshot.bonus_amount IS DISTINCT FROM 50.00
        )
    ) AS every_eligible_snapshot_is_exactly_fifty
),
bonus_function_rows AS MATERIALIZED (
  SELECT lower(pg_get_functiondef(proc_row.oid)) AS definition
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.proname = 'sync_prospect_conversion_bonus'
    AND pg_get_function_identity_arguments(proc_row.oid) = 'p_partner_id uuid'
),
bonus_function_facts AS (
  SELECT
    count(*) = 1 AS function_exists_once,
    COALESCE(bool_and(
      definition LIKE '%pg_advisory_xact_lock%'
      AND definition LIKE '%prospect_conversion_bonus_eligibility%'
      AND definition LIKE '%not v_snapshot.eligible%'
      AND definition NOT LIKE '%from public.user_profiles%'
    ), FALSE) AS uses_frozen_eligibility,
    COALESCE(bool_and(
      definition LIKE '%movement.movement_type%'
      AND definition LIKE '%''settlement''%'
      AND definition LIKE '%movement.status%'
      AND definition LIKE '%''completed''%'
      AND definition LIKE '%movement.movement_date >= v_conversion.converted_at%'
      AND definition LIKE '%due.effective_due > 0.005%'
      AND definition LIKE '%pending_balance%'
      AND definition LIKE '%<= 0.005%'
      AND definition LIKE '%fully_paid_at%'
      AND definition LIKE '%order by movement.movement_date, movement.created_at, movement.id%'
      AND definition LIKE '%limit 1%'
    ), FALSE) AS selects_first_fully_paid_valid_settlement,
    COALESCE(bool_and(
      definition LIKE '%''prospect_conversion_bonus''%'
      AND definition LIKE '%50.00%'
      AND definition LIKE '%''available''%'
      AND definition LIKE '%earned_at = v_movement.fully_paid_at%'
      AND definition LIKE '%available_at = v_movement.fully_paid_at%'
      AND definition NOT LIKE '%''pending''%v_conversion.converted_at%'
    ), FALSE) AS inserts_only_available_fifty_peso_bonus_at_payment_time,
    COALESCE(bool_and(
      definition LIKE '%paid_amount%'
      AND definition LIKE '%reserved_amount%'
      AND definition LIKE '%v_has_economic_lock%'
      AND definition LIKE '%log_commission_sync_issue%'
      AND definition LIKE '%on conflict (partner_id, source_type)%'
    ), FALSE) AS protects_economic_locks_and_is_idempotent
  FROM bonus_function_rows
),
payment_trigger_rows AS MATERIALIZED (
  SELECT
    trigger_row.tgname,
    lower(pg_get_triggerdef(trigger_row.oid, TRUE)) AS trigger_definition,
    lower(pg_get_functiondef(trigger_function.oid)) AS function_definition
  FROM pg_trigger AS trigger_row
  JOIN pg_proc AS trigger_function ON trigger_function.oid = trigger_row.tgfoid
  WHERE trigger_row.tgrelid = 'public.commercial_partner_payments'::REGCLASS
    AND NOT trigger_row.tgisinternal
),
payment_trigger_facts AS (
  SELECT
    count(*) FILTER (
      WHERE tgname = 'trg_sync_comodato_payment'
        AND function_definition LIKE '%sync_comodato_commissions_for_movement%'
    ) = 1 AS canonical_comodato_sync_remains_once,
    count(*) FILTER (
      WHERE tgname = 'trg_sync_prospect_conversion_bonus_payment'
        AND function_definition LIKE '%sync_prospect_conversion_bonus%'
        AND trigger_definition LIKE '%insert%'
        AND trigger_definition LIKE '%update%'
        AND trigger_definition LIKE '%delete%'
    ) = 1 AS bonus_rechecks_on_payment_changes
  FROM payment_trigger_rows
),
bonus_unique_index_facts AS (
  SELECT count(*) > 0 AS one_bonus_per_partner_is_enforced
  FROM pg_indexes AS index_row
  WHERE index_row.schemaname = 'public'
    AND index_row.tablename = 'commission_events'
    AND index_row.indexdef ILIKE '%UNIQUE%'
    AND index_row.indexdef ILIKE '%partner_id%'
    AND index_row.indexdef ILIKE '%source_type%'
    AND index_row.indexdef ILIKE '%prospect_conversion_bonus%'
),
commission_index_facts AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_indexes AS index_row
      WHERE index_row.schemaname = 'public'
        AND index_row.tablename = 'commission_events'
        AND index_row.indexdef ILIKE '%UNIQUE%'
        AND index_row.indexdef ILIKE '%source_type%'
        AND index_row.indexdef ILIKE '%source_item_id%'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_indexes AS index_row
      WHERE index_row.schemaname = 'public'
        AND index_row.tablename = 'commission_events'
        AND index_row.indexdef ILIKE '%UNIQUE%'
        AND index_row.indexdef ILIKE '%source_item_id%'
        AND index_row.indexdef NOT ILIKE '%source_type%'
    ) AS dual_source_types_can_coexist
),
commission_function_facts AS (
  SELECT
    COALESCE(bool_or(
      proc_row.proname = 'sync_comodato_commissions_for_movement'
      AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%''comodato_sale''%'
      AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%_sync_prospect_origin_commission_event%'
    ), FALSE) AS comodato_and_origin_sync_remain_together,
    COALESCE(bool_or(
      proc_row.proname = 'commission_settlement_candidate_events'
      AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%prospect_conversion_bonus%'
      AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%prospect_origin_sale%'
      AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%pos_sale%'
      AND lower(pg_get_functiondef(proc_row.oid)) NOT LIKE '%''comodato_sale''%'
      AND lower(pg_get_functiondef(proc_row.oid)) NOT LIKE '%''wholesale_sale''%'
      AND lower(pg_get_functiondef(proc_row.oid)) NOT LIKE '%''piece_sale''%'
      AND lower(pg_get_functiondef(proc_row.oid)) NOT LIKE '%''conversion_bonus''%'
      AND lower(pg_get_functiondef(proc_row.oid)) NOT LIKE '%''adjustment''%'
    ), FALSE) AS settlement_whitelist_has_all_three_sources
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.proname IN (
      'sync_comodato_commissions_for_movement',
      'commission_settlement_candidate_events'
    )
),
commission_policy_facts AS (
  SELECT COALESCE(bool_or(
    policy_row.cmd IN ('SELECT', 'ALL')
    AND lower(COALESCE(policy_row.qual, '')) LIKE '%vendedora%'
    AND lower(COALESCE(policy_row.qual, '')) LIKE '%seller_id%'
    AND lower(COALESCE(policy_row.qual, '')) LIKE '%auth.uid()%'
    AND lower(COALESCE(policy_row.qual, '')) LIKE '%prospect_conversion_bonus%'
    AND lower(COALESCE(policy_row.qual, '')) LIKE '%prospect_origin_sale%'
    AND lower(COALESCE(policy_row.qual, '')) LIKE '%pos_sale%'
    AND lower(COALESCE(policy_row.qual, '')) NOT LIKE '%''comodato_sale''%'
    AND lower(COALESCE(policy_row.qual, '')) NOT LIKE '%''wholesale_sale''%'
    AND lower(COALESCE(policy_row.qual, '')) NOT LIKE '%''piece_sale''%'
    AND lower(COALESCE(policy_row.qual, '')) NOT LIKE '%''conversion_bonus''%'
    AND lower(COALESCE(policy_row.qual, '')) NOT LIKE '%''adjustment''%'
  ), FALSE) AS vendedora_read_whitelist_has_all_three_sources
  FROM pg_policies AS policy_row
  WHERE policy_row.schemaname = 'public'
    AND policy_row.tablename = 'commission_events'
),
rate_facts AS (
  SELECT
    COALESCE(bool_and(
      CASE
        WHEN rule.product_key LIKE '%jefe_felino%' THEN rule.commission_amount = 15
        WHEN rule.product_key LIKE '%gato_mayor%' THEN rule.commission_amount = 10
        WHEN rule.product_key LIKE '%michi%' THEN rule.commission_amount = 5
        ELSE FALSE
      END
    ) FILTER (WHERE rule.scheme = 'comodato'), FALSE)
    AND count(*) FILTER (
      WHERE rule.scheme = 'comodato'
        AND rule.product_key LIKE '%michi%'
        AND rule.product_key NOT LIKE '%gato_mayor%'
        AND rule.commission_amount = 5
    ) > 0
    AND count(*) FILTER (
      WHERE rule.scheme = 'comodato'
        AND rule.product_key LIKE '%gato_mayor%'
        AND rule.commission_amount = 10
    ) > 0
    AND count(*) FILTER (
      WHERE rule.scheme = 'comodato'
        AND rule.product_key LIKE '%jefe_felino%'
        AND rule.commission_amount = 15
    ) > 0 AS gerardo_rates_are_5_10_15,
    COALESCE(bool_and(
      CASE
        WHEN rule.product_key LIKE '%jefe_felino%' THEN rule.commission_amount = 10
        WHEN rule.product_key LIKE '%gato_mayor%' THEN rule.commission_amount = 5
        WHEN rule.product_key LIKE '%michi%' THEN rule.commission_amount = 2
        ELSE FALSE
      END
    ) FILTER (WHERE rule.scheme = 'prospect_origin'), FALSE)
    AND count(*) FILTER (
      WHERE rule.scheme = 'prospect_origin'
        AND rule.product_key LIKE '%michi%'
        AND rule.product_key NOT LIKE '%gato_mayor%'
        AND rule.commission_amount = 2
    ) > 0
    AND count(*) FILTER (
      WHERE rule.scheme = 'prospect_origin'
        AND rule.product_key LIKE '%gato_mayor%'
        AND rule.commission_amount = 5
    ) > 0
    AND count(*) FILTER (
      WHERE rule.scheme = 'prospect_origin'
        AND rule.product_key LIKE '%jefe_felino%'
        AND rule.commission_amount = 10
    ) > 0 AS angelica_rates_are_2_5_10,
    count(*) FILTER (
      WHERE rule.scheme = 'prospect_conversion'
        AND rule.product_key = 'first_paid_comodato_settlement'
        AND rule.commission_amount = 50
    ) = 1 AS conversion_bonus_is_exactly_fifty
  FROM public.commission_rules AS rule
  WHERE rule.active
),
overlapping_rule_facts AS (
  SELECT count(*) = 0 AS no_active_rules_overlap
  FROM public.commission_rules AS first_rule
  JOIN public.commission_rules AS second_rule
    ON second_rule.scheme = first_rule.scheme
   AND second_rule.product_key = first_rule.product_key
   AND second_rule.id > first_rule.id
   AND second_rule.active
   AND daterange(
     first_rule.valid_from,
     COALESCE(first_rule.valid_to, 'infinity'::DATE),
     '[]'
   ) && daterange(
     second_rule.valid_from,
     COALESCE(second_rule.valid_to, 'infinity'::DATE),
     '[]'
   )
  WHERE first_rule.active
    AND first_rule.scheme IN ('comodato', 'vendedora_pos', 'prospect_origin', 'prospect_conversion')
),
premature_bonus_events AS MATERIALIZED (
  SELECT
    event.id,
    event.partner_id,
    event.status,
    COALESCE(balance.paid_amount, 0) AS paid_amount,
    COALESCE(balance.reserved_amount, 0) AS reserved_amount,
    event.source_id
  FROM public.commission_events AS event
  LEFT JOIN public.v_commission_event_payment_balances AS balance
    ON balance.commission_event_id = event.id
  WHERE event.source_type = 'prospect_conversion_bonus'
    AND (
      event.status IN ('pending', 'available', 'paid')
      OR COALESCE(balance.paid_amount, 0) > 0.005
      OR COALESCE(balance.reserved_amount, 0) > 0.005
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.commercial_partner_movements AS movement
      JOIN public.commercial_prospect_conversions AS conversion
        ON conversion.commercial_partner_id = movement.partner_id
      CROSS JOIN LATERAL (
        SELECT
          COALESCE(sum(COALESCE(item.amount_due, 0)), 0)
          - COALESCE((
            SELECT sum(COALESCE(adjustment.amount_adjusted, 0))
            FROM public.commercial_partner_movement_items AS adjustment
            JOIN public.commercial_partner_movements AS adjustment_movement
              ON adjustment_movement.id = adjustment.movement_id
            JOIN public.commercial_partner_movement_items AS original
              ON original.id = adjustment.adjusts_movement_item_id
            WHERE original.movement_id = movement.id
              AND lower(btrim(adjustment_movement.movement_type)) = 'adjustment'
              AND lower(btrim(adjustment_movement.status)) = 'completed'
          ), 0) AS effective_due
        FROM public.commercial_partner_movement_items AS item
        WHERE item.movement_id = movement.id
          AND COALESCE(item.quantity_sold, 0) > 0
      ) AS due
      CROSS JOIN LATERAL (
        SELECT COALESCE(sum(COALESCE(payment.amount, 0)), 0) AS paid
        FROM public.commercial_partner_payments AS payment
        WHERE payment.movement_id = movement.id
          AND lower(btrim(payment.status)) IN ('completed', 'paid')
      ) AS payment_total
      WHERE movement.id = event.source_id
        AND movement.partner_id = event.partner_id
        AND lower(btrim(movement.movement_type)) = 'settlement'
        AND lower(btrim(movement.status)) = 'completed'
        AND movement.movement_date >= conversion.converted_at
        AND due.effective_due > 0.005
        AND GREATEST(due.effective_due - payment_total.paid, 0) <= 0.005
    )
),
historical_event_facts AS (
  SELECT
    count(*) = 0 AS no_premature_visible_bonus_remains,
    COALESCE(jsonb_agg(jsonb_build_object(
      'event_id', id,
      'partner_id', partner_id,
      'status', status,
      'paid_amount', paid_amount,
      'reserved_amount', reserved_amount,
      'source_id', source_id
    ) ORDER BY id), '[]'::JSONB) AS blockers
  FROM premature_bonus_events
),
checks AS (
  SELECT jsonb_build_object(
    'casa_ajusco_is_exactly_one_unconverted_prospect', casa.exactly_one_unconverted_prospect,
    'casa_ajusco_identity_and_state_are_unchanged', casa.identity_and_state_unchanged,
    'casa_ajusco_originator_is_angelica', casa.originator_is_angelica,
    'casa_ajusco_is_assigned_to_gerardo', casa.assigned_to_gerardo,
    'casa_ajusco_has_no_created_partner', casa.no_partner_was_created,
    'assigned_prospect_frontend_view_exists', prospect_view.view_exists,
    'assigned_prospect_frontend_view_contract_is_complete', prospect_view.frontend_source_contract_is_complete,
    'assigned_prospect_view_remains_security_invoker', prospect_view.remains_security_invoker,
    'gerardo_read_contract_exists', prospect_policy.gerardo_read_contract_exists,
    'assignment_path_does_not_create_partner', prospect_update.assignment_does_not_create_partner,
    'conversion_eligibility_trigger_exists_once', conversion_trigger.eligibility_trigger_exists_once,
    'conversion_trigger_only_captures_eligibility', conversion_trigger.conversion_only_captures_eligibility,
    'no_conversion_trigger_creates_bonus_event', conversion_trigger.no_conversion_trigger_creates_bonus_event,
    'conversion_rpc_exists', convert_rpc.conversion_rpc_exists,
    'conversion_rpc_does_not_create_bonus_event', convert_rpc.conversion_rpc_does_not_create_bonus_event,
    'eligibility_table_exists', eligibility.eligibility_table_exists,
    'eligibility_snapshot_is_immutable', eligibility.eligibility_is_immutable,
    'eligibility_snapshot_has_no_authenticated_direct_access', eligibility.authenticated_has_no_direct_access,
    'every_eligible_snapshot_is_exactly_fifty', eligibility.every_eligible_snapshot_is_exactly_fifty,
    'bonus_function_exists_once', bonus.function_exists_once,
    'bonus_uses_frozen_eligibility', bonus.uses_frozen_eligibility,
    'bonus_selects_first_fully_paid_valid_settlement', bonus.selects_first_fully_paid_valid_settlement,
    'bonus_is_available_for_fifty_at_payment_time', bonus.inserts_only_available_fifty_peso_bonus_at_payment_time,
    'bonus_protects_economic_locks_and_is_idempotent', bonus.protects_economic_locks_and_is_idempotent,
    'unique_bonus_per_partner_is_enforced', bonus_index.one_bonus_per_partner_is_enforced,
    'canonical_comodato_payment_sync_remains_once', payment_trigger.canonical_comodato_sync_remains_once,
    'bonus_rechecks_on_payment_changes', payment_trigger.bonus_rechecks_on_payment_changes,
    'comodato_and_origin_sync_remain_together', commission_function.comodato_and_origin_sync_remain_together,
    'dual_commission_source_types_can_coexist', commission_index.dual_source_types_can_coexist,
    'settlement_whitelist_has_exact_required_sources', commission_function.settlement_whitelist_has_all_three_sources,
    'vendedora_read_whitelist_has_exact_required_sources', commission_policy.vendedora_read_whitelist_has_all_three_sources,
    'gerardo_rates_are_5_10_15', rate.gerardo_rates_are_5_10_15,
    'angelica_rates_are_2_5_10', rate.angelica_rates_are_2_5_10,
    'conversion_bonus_is_exactly_fifty', rate.conversion_bonus_is_exactly_fifty,
    'no_active_rules_overlap', overlap.no_active_rules_overlap,
    'no_premature_visible_bonus_remains', historical.no_premature_visible_bonus_remains
  ) AS value,
  historical.blockers
  FROM casa_ajusco_facts AS casa
  CROSS JOIN prospect_view_facts AS prospect_view
  CROSS JOIN prospect_policy_facts AS prospect_policy
  CROSS JOIN prospect_update_function_facts AS prospect_update
  CROSS JOIN conversion_trigger_facts AS conversion_trigger
  CROSS JOIN convert_rpc_facts AS convert_rpc
  CROSS JOIN eligibility_table_facts AS eligibility
  CROSS JOIN bonus_function_facts AS bonus
  CROSS JOIN payment_trigger_facts AS payment_trigger
  CROSS JOIN bonus_unique_index_facts AS bonus_index
  CROSS JOIN commission_index_facts AS commission_index
  CROSS JOIN commission_function_facts AS commission_function
  CROSS JOIN commission_policy_facts AS commission_policy
  CROSS JOIN rate_facts AS rate
  CROSS JOIN overlapping_rule_facts AS overlap
  CROSS JOIN historical_event_facts AS historical
)
SELECT jsonb_build_object(
  'verification', '20261008_assigned_prospect_visibility_and_bonus_timing',
  'read_only', current_setting('transaction_read_only')::BOOLEAN,
  'all_checks_passed', NOT EXISTS (
    SELECT 1
    FROM jsonb_each(checks.value) AS check_row
    WHERE check_row.value <> 'true'::JSONB
  ),
  'checks', checks.value,
  'historical_bonus_blockers', checks.blockers,
  'frontend_contract', jsonb_build_object(
    'database_source', 'public.v_commercial_prospect_details',
    'required_filter', 'assigned_to = authenticated user; commercial_partner_id IS NULL; status not convertido or archivado',
    'record_discriminator', jsonb_build_array('commercial_partner', 'commercial_prospect'),
    'repository_validation_required', jsonb_build_array(
      'components/commercialPartners/mobile/SellerCommercialPartnersView.tsx',
      'components/commercialPartners/mobile/SellerMobilePartners.tsx',
      'pages/CommercialProspects.tsx'
    )
  ),
  'casa_ajusco_evidence', COALESCE((
    SELECT jsonb_agg(to_jsonb(casa_row) ORDER BY casa_row.id)
    FROM casa_ajusco_rows AS casa_row
  ), '[]'::JSONB)
) AS result
FROM checks;

ROLLBACK;
