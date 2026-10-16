BEGIN;

SET TRANSACTION READ ONLY;

WITH
parameters AS MATERIALIZED (
  SELECT
    '2026-10-01'::DATE AS month_start,
    '2026-11-01'::DATE AS month_end_exclusive,
    '2026-10-15'::DATE AS payment_date,
    'America/Mexico_City'::TEXT AS business_timezone,
    700::NUMERIC AS reported_payment_amount
),
gerardo_candidates AS MATERIALIZED (
  SELECT
    profile.id,
    profile.full_name,
    profile.commercial_alias,
    profile.role,
    profile.is_active,
    CASE
      WHEN upper(btrim(COALESCE(profile.commercial_alias, ''))) = 'GERARDO' THEN 0
      WHEN lower(COALESCE(profile.full_name, '')) = 'gerardo ventas' THEN 1
      ELSE 2
    END AS match_priority
  FROM public.user_profiles AS profile
  WHERE profile.role = 'socios_comerciales'
    AND (
      upper(btrim(COALESCE(profile.commercial_alias, ''))) = 'GERARDO'
      OR lower(COALESCE(profile.full_name, '')) = 'gerardo ventas'
      OR lower(COALESCE(profile.full_name, '')) LIKE '%gerardo%'
    )
),
gerardo AS MATERIALIZED (
  SELECT candidate.*
  FROM gerardo_candidates AS candidate
  ORDER BY candidate.match_priority, candidate.id
  LIMIT 1
),
target_relations(relation_name) AS (
  VALUES
    ('commission_events'),
    ('commission_settlements'),
    ('commission_settlement_items'),
    ('expenses'),
    ('v_commission_events_effective'),
    ('v_commission_event_payment_balances'),
    ('v_commissions_available_for_payment'),
    ('v_seller_commission_monthly_summary'),
    ('v_seller_commission_movements'),
    ('v_commission_settlement_history'),
    ('v_commission_settlement_detail')
),
relation_catalog AS MATERIALIZED (
  SELECT
    target.relation_name,
    class_row.oid,
    namespace_row.nspname AS schema_name,
    CASE class_row.relkind
      WHEN 'r' THEN 'table'
      WHEN 'p' THEN 'partitioned_table'
      WHEN 'v' THEN 'view'
      WHEN 'm' THEN 'materialized_view'
      ELSE class_row.relkind::TEXT
    END AS relation_kind,
    class_row.relrowsecurity AS rls_enabled,
    class_row.relforcerowsecurity AS force_rls,
    COALESCE(class_row.reloptions, ARRAY[]::TEXT[]) AS options,
    CASE
      WHEN class_row.relkind IN ('v', 'm') THEN pg_get_viewdef(class_row.oid, TRUE)
      ELSE NULL
    END AS definition
  FROM target_relations AS target
  LEFT JOIN pg_class AS class_row
    ON class_row.relname = target.relation_name
  LEFT JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = class_row.relnamespace
   AND namespace_row.nspname = 'public'
  WHERE class_row.oid IS NULL OR namespace_row.nspname = 'public'
),
relation_columns AS MATERIALIZED (
  SELECT
    columns.table_name,
    columns.ordinal_position,
    columns.column_name,
    columns.data_type,
    columns.udt_name,
    columns.is_nullable,
    columns.column_default
  FROM information_schema.columns AS columns
  JOIN target_relations AS target ON target.relation_name = columns.table_name
  WHERE columns.table_schema = 'public'
),
relation_constraints AS MATERIALIZED (
  SELECT
    class_row.relname AS table_name,
    constraint_row.conname AS constraint_name,
    constraint_row.contype AS constraint_type,
    pg_get_constraintdef(constraint_row.oid, TRUE) AS definition
  FROM pg_constraint AS constraint_row
  JOIN pg_class AS class_row ON class_row.oid = constraint_row.conrelid
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = class_row.relnamespace
  JOIN target_relations AS target ON target.relation_name = class_row.relname
  WHERE namespace_row.nspname = 'public'
),
relation_indexes AS MATERIALIZED (
  SELECT
    index_row.tablename AS table_name,
    index_row.indexname AS index_name,
    index_row.indexdef AS definition
  FROM pg_indexes AS index_row
  JOIN target_relations AS target ON target.relation_name = index_row.tablename
  WHERE index_row.schemaname = 'public'
),
relation_policies AS MATERIALIZED (
  SELECT
    policy_row.tablename AS table_name,
    policy_row.policyname AS policy_name,
    policy_row.permissive,
    policy_row.roles,
    policy_row.cmd,
    policy_row.qual,
    policy_row.with_check
  FROM pg_policies AS policy_row
  JOIN target_relations AS target ON target.relation_name = policy_row.tablename
  WHERE policy_row.schemaname = 'public'
),
related_functions AS MATERIALIZED (
  SELECT
    proc_row.oid,
    proc_row.proname AS function_name,
    pg_get_function_identity_arguments(proc_row.oid) AS identity_arguments,
    pg_get_function_result(proc_row.oid) AS result_type,
    proc_row.prosecdef AS security_definer,
    proc_row.provolatile AS volatility,
    COALESCE(proc_row.proconfig, ARRAY[]::TEXT[]) AS configuration,
    pg_get_functiondef(proc_row.oid) AS definition
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.prokind = 'f'
    AND (
      proc_row.proname IN (
        'commission_settlement_candidate_events',
        'get_commission_settlement_preview',
        'create_commission_settlement',
        'pay_commission_settlement',
        'cancel_commission_settlement_draft',
        'refresh_commission_settlement_total',
        'create_expense_for_paid_commission_settlement',
        'protect_commission_settlement_expense',
        'protect_paid_commission_settlement',
        'protect_paid_commission_settlement_items'
      )
      OR lower(pg_get_functiondef(proc_row.oid)) LIKE '%commission_settlement%'
    )
),
related_triggers AS MATERIALIZED (
  SELECT
    class_row.relname AS table_name,
    trigger_row.tgname AS trigger_name,
    CASE trigger_row.tgenabled
      WHEN 'O' THEN 'enabled'
      WHEN 'D' THEN 'disabled'
      WHEN 'R' THEN 'replica'
      WHEN 'A' THEN 'always'
      ELSE trigger_row.tgenabled::TEXT
    END AS enabled,
    pg_get_triggerdef(trigger_row.oid, TRUE) AS definition,
    trigger_function.proname AS trigger_function,
    pg_get_functiondef(trigger_function.oid) AS trigger_function_definition
  FROM pg_trigger AS trigger_row
  JOIN pg_class AS class_row ON class_row.oid = trigger_row.tgrelid
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = class_row.relnamespace
  JOIN pg_proc AS trigger_function ON trigger_function.oid = trigger_row.tgfoid
  WHERE namespace_row.nspname = 'public'
    AND NOT trigger_row.tgisinternal
    AND class_row.relname IN (
      'commission_events',
      'commission_settlements',
      'commission_settlement_items',
      'expenses'
    )
),
other_compensation_relations AS MATERIALIZED (
  SELECT
    namespace_row.nspname AS schema_name,
    class_row.relname AS relation_name,
    CASE class_row.relkind
      WHEN 'r' THEN 'table'
      WHEN 'p' THEN 'partitioned_table'
      WHEN 'v' THEN 'view'
      WHEN 'm' THEN 'materialized_view'
      ELSE class_row.relkind::TEXT
    END AS relation_kind,
    CASE
      WHEN class_row.relkind IN ('v', 'm') THEN pg_get_viewdef(class_row.oid, TRUE)
      ELSE NULL
    END AS definition
  FROM pg_class AS class_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = class_row.relnamespace
  WHERE namespace_row.nspname = 'public'
    AND class_row.relkind IN ('r', 'p', 'v', 'm')
    AND (
      class_row.relname ILIKE '%salary%'
      OR class_row.relname ILIKE '%payroll%'
      OR class_row.relname ILIKE '%nomina%'
      OR class_row.relname ILIKE '%sueldo%'
      OR class_row.relname ILIKE '%advance%'
      OR class_row.relname ILIKE '%anticipo%'
      OR class_row.relname ILIKE '%extra_day%'
    )
),
gerardo_events AS MATERIALIZED (
  SELECT
    event.id AS commission_event_id,
    event.seller_id,
    event.partner_id,
    event.source_type,
    event.source_id,
    event.source_item_id,
    event.product_key,
    event.product_name,
    event.product_variant,
    event.product_size,
    event.quantity,
    event.unit_commission,
    event.commission_amount,
    event.release_condition,
    event.status AS event_status,
    event.earned_at,
    (event.earned_at AT TIME ZONE 'America/Mexico_City')::DATE AS earned_local_date,
    event.available_at,
    NULLIF(to_jsonb(event)->>'paid_at', '')::TIMESTAMPTZ AS event_paid_at,
    event.cancelled_at,
    event.metadata,
    balance.payment_status,
    COALESCE(balance.paid_amount, 0)::NUMERIC AS paid_amount,
    COALESCE(balance.reserved_amount, 0)::NUMERIC AS reserved_amount,
    COALESCE(balance.remaining_amount, event.commission_amount)::NUMERIC AS remaining_amount,
    COALESCE(balance.allocatable_amount, 0)::NUMERIC AS allocatable_amount
  FROM public.commission_events AS event
  JOIN gerardo ON gerardo.id = event.seller_id
  LEFT JOIN public.v_commission_event_payment_balances AS balance
    ON balance.commission_event_id = event.id
),
october_events AS MATERIALIZED (
  SELECT event.*
  FROM gerardo_events AS event
  CROSS JOIN parameters AS parameter
  WHERE event.earned_local_date >= parameter.month_start
    AND event.earned_local_date < parameter.month_end_exclusive
),
october_event_totals AS MATERIALIZED (
  SELECT
    COALESCE(sum(event.commission_amount) FILTER (
      WHERE event.event_status <> 'cancelled'
    ), 0)::NUMERIC AS generated_total,
    COALESCE(sum(event.commission_amount) FILTER (
      WHERE event.event_status = 'pending'
    ), 0)::NUMERIC AS pending_total,
    COALESCE(sum(event.remaining_amount) FILTER (
      WHERE event.event_status = 'available'
    ), 0)::NUMERIC AS available_total,
    COALESCE(sum(event.allocatable_amount) FILTER (
      WHERE event.event_status = 'available'
    ), 0)::NUMERIC AS allocatable_total,
    COALESCE(sum(event.reserved_amount) FILTER (
      WHERE event.event_status = 'available'
    ), 0)::NUMERIC AS reserved_total,
    COALESCE(sum(event.paid_amount) FILTER (
      WHERE event.event_status <> 'cancelled'
    ), 0)::NUMERIC AS paid_total,
    count(*) FILTER (WHERE event.event_status <> 'cancelled')::INTEGER AS event_count
  FROM october_events AS event
),
deployed_monthly_summary AS MATERIALIZED (
  SELECT summary.*
  FROM public.v_seller_commission_monthly_summary AS summary
  JOIN gerardo ON gerardo.id = summary.seller_id
  CROSS JOIN parameters AS parameter
  WHERE summary.month_start = parameter.month_start
),
accumulated_event_totals AS MATERIALIZED (
  SELECT
    COALESCE(sum(event.commission_amount) FILTER (
      WHERE event.event_status <> 'cancelled'
    ), 0)::NUMERIC AS generated_historical,
    COALESCE(sum(event.paid_amount) FILTER (
      WHERE event.event_status <> 'cancelled'
    ), 0)::NUMERIC AS paid_historical,
    COALESCE(sum(event.allocatable_amount) FILTER (
      WHERE event.event_status = 'available'
    ), 0)::NUMERIC AS allocatable_historical,
    COALESCE(sum(event.reserved_amount) FILTER (
      WHERE event.event_status = 'available'
    ), 0)::NUMERIC AS reserved_historical,
    COALESCE(sum(event.commission_amount) FILTER (
      WHERE event.event_status = 'pending'
    ), 0)::NUMERIC AS pending_historical
  FROM gerardo_events AS event
),
deployed_accumulated_available AS MATERIALIZED (
  SELECT available.*
  FROM public.v_commissions_available_for_payment AS available
  JOIN gerardo ON gerardo.id = available.seller_id
),
gerardo_settlements AS MATERIALIZED (
  SELECT
    settlement.id AS settlement_id,
    settlement.folio,
    settlement.seller_id,
    settlement.period_start,
    settlement.period_end,
    settlement.total_amount,
    settlement.status,
    settlement.payment_method,
    settlement.payment_reference,
    to_jsonb(settlement)->>'payment_proof_path' AS payment_proof_path,
    to_jsonb(settlement)->>'payment_proof_file_name' AS payment_proof_file_name,
    to_jsonb(settlement)->>'payment_proof_mime_type' AS payment_proof_mime_type,
    settlement.created_by,
    settlement.created_at,
    settlement.paid_by,
    settlement.paid_at,
    NULLIF(to_jsonb(settlement)->>'cancelled_at', '')::TIMESTAMPTZ AS cancelled_at,
    to_jsonb(settlement)->>'cancellation_reason' AS cancellation_reason,
    to_jsonb(settlement)->>'notes' AS notes,
    count(item.id)::INTEGER AS item_count,
    COALESCE(sum(item.amount), 0)::NUMERIC AS item_total
  FROM public.commission_settlements AS settlement
  JOIN gerardo ON gerardo.id = settlement.seller_id
  LEFT JOIN public.commission_settlement_items AS item
    ON item.settlement_id = settlement.id
  GROUP BY settlement.id
),
gerardo_settlement_items AS MATERIALIZED (
  SELECT
    item.id AS settlement_item_id,
    item.settlement_id,
    settlement.folio,
    settlement.status AS settlement_status,
    settlement.created_at AS settlement_created_at,
    settlement.paid_at AS settlement_paid_at,
    settlement.payment_method,
    item.commission_event_id,
    item.amount AS settlement_item_amount,
    event.source_type,
    event.source_id,
    event.source_item_id,
    event.commission_amount,
    event.event_status,
    event.payment_status,
    event.earned_at,
    event.earned_local_date,
    event.paid_amount AS event_paid_amount,
    event.reserved_amount AS event_reserved_amount,
    event.remaining_amount AS event_remaining_amount,
    event.allocatable_amount AS event_allocatable_amount
  FROM public.commission_settlement_items AS item
  JOIN gerardo_settlements AS settlement ON settlement.settlement_id = item.settlement_id
  LEFT JOIN gerardo_events AS event ON event.commission_event_id = item.commission_event_id
),
settlements_paid_on_target_date AS MATERIALIZED (
  SELECT settlement.*
  FROM gerardo_settlements AS settlement
  CROSS JOIN parameters AS parameter
  WHERE settlement.paid_at IS NOT NULL
    AND (settlement.paid_at AT TIME ZONE parameter.business_timezone)::DATE
      = parameter.payment_date
),
settlements_created_on_target_date AS MATERIALIZED (
  SELECT settlement.*
  FROM gerardo_settlements AS settlement
  CROSS JOIN parameters AS parameter
  WHERE (settlement.created_at AT TIME ZONE parameter.business_timezone)::DATE
    = parameter.payment_date
),
october_cashflow AS MATERIALIZED (
  SELECT
    COALESCE(sum(settlement.total_amount), 0)::NUMERIC AS paid_during_october,
    count(*)::INTEGER AS paid_settlement_count
  FROM gerardo_settlements AS settlement
  CROSS JOIN parameters AS parameter
  WHERE settlement.status = 'paid'
    AND settlement.paid_at IS NOT NULL
    AND (settlement.paid_at AT TIME ZONE parameter.business_timezone)::DATE
      >= parameter.month_start
    AND (settlement.paid_at AT TIME ZONE parameter.business_timezone)::DATE
      < parameter.month_end_exclusive
),
target_day_settlement_totals AS MATERIALIZED (
  SELECT
    COALESCE(sum(settlement.total_amount), 0)::NUMERIC AS paid_settlement_total,
    count(*)::INTEGER AS paid_settlement_count,
    COALESCE(bool_or(
      settlement.total_amount = (SELECT reported_payment_amount FROM parameters)
    ), FALSE)
      AS has_single_exact_700_settlement,
    COALESCE(sum(settlement.total_amount), 0)
      = (SELECT reported_payment_amount FROM parameters)
      AS paid_settlements_sum_to_700
  FROM settlements_paid_on_target_date AS settlement
),
gerardo_expenses AS MATERIALIZED (
  SELECT
    expense.id AS expense_id,
    expense.expense_date,
    expense.amount_mxn,
    expense.type,
    expense.category,
    expense.vendor,
    expense.payment_method,
    expense.notes,
    expense.created_by,
    expense.commission_settlement_id,
    settlement.folio AS settlement_folio,
    settlement.status AS settlement_status,
    settlement.total_amount AS settlement_total,
    settlement.paid_at AS settlement_paid_at,
    CASE
      WHEN expense.commission_settlement_id IS NOT NULL THEN 'commission_settlement'
      WHEN lower(COALESCE(expense.category, '')) LIKE '%comision%' THEN 'unlinked_commission_expense'
      WHEN lower(COALESCE(expense.category, '')) LIKE '%sueldo%'
        OR lower(COALESCE(expense.notes, '')) LIKE '%sueldo%'
        OR lower(COALESCE(expense.notes, '')) LIKE '%nomina%'
        THEN 'salary_or_payroll'
      WHEN lower(COALESCE(expense.notes, '')) LIKE '%dia extra%'
        OR lower(COALESCE(expense.notes, '')) LIKE '%día extra%'
        THEN 'extra_day'
      WHEN lower(COALESCE(expense.notes, '')) LIKE '%anticipo%' THEN 'advance'
      ELSE 'other_or_unclassified'
    END AS inferred_concept
  FROM public.expenses AS expense
  LEFT JOIN gerardo_settlements AS settlement
    ON settlement.settlement_id = expense.commission_settlement_id
  WHERE settlement.settlement_id IS NOT NULL
    OR lower(COALESCE(expense.vendor, '')) LIKE '%gerardo%'
    OR (
      lower(COALESCE(expense.category, '')) LIKE '%comision%'
      AND lower(COALESCE(expense.notes, '')) LIKE '%gerardo%'
    )
),
expenses_on_target_date AS MATERIALIZED (
  SELECT expense.*
  FROM gerardo_expenses AS expense
  CROSS JOIN parameters AS parameter
  WHERE expense.expense_date = parameter.payment_date
),
all_finance_expenses_on_target_date AS MATERIALIZED (
  SELECT
    expense.id AS expense_id,
    expense.expense_date,
    expense.amount_mxn,
    expense.type,
    expense.category,
    expense.vendor,
    expense.payment_method,
    expense.notes,
    expense.commission_settlement_id
  FROM public.expenses AS expense
  CROSS JOIN parameters AS parameter
  WHERE expense.expense_date = parameter.payment_date
),
target_day_expense_totals AS MATERIALIZED (
  SELECT
    COALESCE(sum(expense.amount_mxn), 0)::NUMERIC AS expense_total,
    COALESCE(sum(expense.amount_mxn) FILTER (
      WHERE expense.commission_settlement_id IS NOT NULL
    ), 0)::NUMERIC AS linked_commission_expense_total,
    COALESCE(sum(expense.amount_mxn) FILTER (
      WHERE expense.commission_settlement_id IS NULL
    ), 0)::NUMERIC AS unlinked_expense_total,
    count(*)::INTEGER AS expense_count,
    COALESCE(bool_or(
      expense.amount_mxn = (SELECT reported_payment_amount FROM parameters)
    ), FALSE)
      AS has_single_exact_700_expense,
    COALESCE(sum(expense.amount_mxn), 0)
      = (SELECT reported_payment_amount FROM parameters)
      AS all_gerardo_expenses_sum_to_700
  FROM expenses_on_target_date AS expense
),
settlement_reconciliation AS MATERIALIZED (
  SELECT
    settlement.settlement_id,
    settlement.folio,
    settlement.status,
    settlement.total_amount,
    settlement.item_total,
    settlement.item_count,
    settlement.paid_at,
    count(expense.expense_id)::INTEGER AS linked_expense_count,
    COALESCE(sum(expense.amount_mxn), 0)::NUMERIC AS linked_expense_total,
    abs(settlement.total_amount - settlement.item_total) <= 0.005
      AS items_match_settlement_total,
    CASE
      WHEN settlement.status = 'paid' THEN count(expense.expense_id) = 1
      ELSE count(expense.expense_id) = 0
    END AS expense_count_is_consistent,
    CASE
      WHEN settlement.status = 'paid' THEN
        abs(settlement.total_amount - COALESCE(sum(expense.amount_mxn), 0)) <= 0.005
      ELSE TRUE
    END AS expense_amount_is_consistent
  FROM gerardo_settlements AS settlement
  LEFT JOIN gerardo_expenses AS expense
    ON expense.commission_settlement_id = settlement.settlement_id
  GROUP BY
    settlement.settlement_id,
    settlement.folio,
    settlement.status,
    settlement.total_amount,
    settlement.item_total,
    settlement.item_count,
    settlement.paid_at
),
item_allocations_by_event AS MATERIALIZED (
  SELECT
    item.commission_event_id,
    count(*)::INTEGER AS allocation_row_count,
    count(*) FILTER (WHERE item.settlement_status = 'draft')::INTEGER AS draft_row_count,
    count(*) FILTER (WHERE item.settlement_status = 'paid')::INTEGER AS paid_row_count,
    COALESCE(sum(item.settlement_item_amount) FILTER (
      WHERE item.settlement_status = 'draft'
    ), 0)::NUMERIC AS draft_reserved_amount,
    COALESCE(sum(item.settlement_item_amount) FILTER (
      WHERE item.settlement_status = 'paid'
    ), 0)::NUMERIC AS paid_item_amount,
    COALESCE(sum(item.settlement_item_amount) FILTER (
      WHERE item.settlement_status NOT IN ('draft', 'paid', 'cancelled')
    ), 0)::NUMERIC AS unknown_status_item_amount,
    min(item.commission_amount)::NUMERIC AS commission_amount,
    min(item.event_paid_amount)::NUMERIC AS balance_paid_amount,
    min(item.event_reserved_amount)::NUMERIC AS balance_reserved_amount,
    min(item.event_remaining_amount)::NUMERIC AS balance_remaining_amount,
    min(item.event_allocatable_amount)::NUMERIC AS balance_allocatable_amount
  FROM gerardo_settlement_items AS item
  GROUP BY item.commission_event_id
),
duplicate_items AS MATERIALIZED (
  SELECT
    item.settlement_id,
    item.commission_event_id,
    count(*)::INTEGER AS duplicate_rows,
    sum(item.settlement_item_amount)::NUMERIC AS duplicated_amount
  FROM gerardo_settlement_items AS item
  GROUP BY item.settlement_id, item.commission_event_id
  HAVING count(*) > 1
),
overallocated_events AS MATERIALIZED (
  SELECT allocation.*
  FROM item_allocations_by_event AS allocation
  WHERE abs(allocation.paid_item_amount) > abs(allocation.commission_amount) + 0.005
    OR abs(allocation.paid_item_amount + allocation.draft_reserved_amount)
      > abs(allocation.commission_amount) + 0.005
),
balance_mismatches AS MATERIALIZED (
  SELECT allocation.*
  FROM item_allocations_by_event AS allocation
  WHERE abs(allocation.paid_item_amount - allocation.balance_paid_amount) > 0.005
    OR abs(allocation.draft_reserved_amount - allocation.balance_reserved_amount) > 0.005
    OR abs(
      allocation.commission_amount
      - allocation.balance_paid_amount
      - allocation.balance_remaining_amount
    ) > 0.005
    OR abs(
      allocation.balance_remaining_amount
      - allocation.balance_reserved_amount
      - allocation.balance_allocatable_amount
    ) > 0.005
),
negative_or_invalid_balances AS MATERIALIZED (
  SELECT event.*
  FROM gerardo_events AS event
  WHERE event.commission_amount >= 0
    AND (
      event.paid_amount < -0.005
      OR event.reserved_amount < -0.005
      OR event.remaining_amount < -0.005
      OR event.allocatable_amount < -0.005
    )
),
orphan_items AS MATERIALIZED (
  SELECT item.*
  FROM gerardo_settlement_items AS item
  WHERE item.commission_event_id IS NULL
     OR item.source_type IS NULL
),
monthly_card_reconciliation AS MATERIALIZED (
  SELECT
    calculated.generated_total AS calculated_generated_total,
    calculated.pending_total AS calculated_pending_total,
    calculated.available_total AS calculated_available_total,
    calculated.allocatable_total AS calculated_allocatable_total,
    calculated.reserved_total AS calculated_reserved_total,
    calculated.paid_total AS calculated_paid_total,
    summary.generated_total AS deployed_generated_total,
    summary.pending_total AS deployed_pending_total,
    summary.available_total AS deployed_available_total,
    summary.paid_total AS deployed_paid_total,
    COALESCE(
      abs(calculated.generated_total - summary.generated_total) <= 0.005,
      FALSE
    ) AS generated_matches,
    COALESCE(
      abs(calculated.pending_total - summary.pending_total) <= 0.005,
      FALSE
    ) AS pending_matches,
    COALESCE(
      abs(calculated.available_total - summary.available_total) <= 0.005,
      FALSE
    ) AS available_matches,
    COALESCE(
      abs(calculated.paid_total - summary.paid_total) <= 0.005,
      FALSE
    ) AS paid_matches,
    abs(
      calculated.generated_total
      - calculated.pending_total
      - calculated.available_total
      - calculated.paid_total
    ) <= 0.005 AS generated_equation_matches
  FROM october_event_totals AS calculated
  LEFT JOIN deployed_monthly_summary AS summary ON TRUE
),
diagnostic_findings AS MATERIALIZED (
  SELECT jsonb_build_object(
    'gerardo_identity_is_unique', (SELECT count(*) FROM gerardo_candidates) = 1,
    'gerardo_identity_was_resolved', EXISTS (SELECT 1 FROM gerardo),
    'monthly_summary_row_exists', EXISTS (SELECT 1 FROM deployed_monthly_summary),
    'monthly_cards_match_independent_event_calculation', COALESCE((
      SELECT reconciliation.generated_matches
        AND reconciliation.pending_matches
        AND reconciliation.available_matches
        AND reconciliation.paid_matches
      FROM monthly_card_reconciliation AS reconciliation
    ), FALSE),
    'monthly_generated_equation_matches', COALESCE((
      SELECT reconciliation.generated_equation_matches
      FROM monthly_card_reconciliation AS reconciliation
    ), FALSE),
    'reported_700_found_as_single_paid_settlement', COALESCE((
      SELECT totals.has_single_exact_700_settlement
      FROM target_day_settlement_totals AS totals
    ), FALSE),
    'paid_settlements_on_october_15_sum_to_700', COALESCE((
      SELECT totals.paid_settlements_sum_to_700
      FROM target_day_settlement_totals AS totals
    ), FALSE),
    'reported_700_found_as_single_expense', COALESCE((
      SELECT totals.has_single_exact_700_expense
      FROM target_day_expense_totals AS totals
    ), FALSE),
    'gerardo_expenses_on_october_15_sum_to_700', COALESCE((
      SELECT totals.all_gerardo_expenses_sum_to_700
      FROM target_day_expense_totals AS totals
    ), FALSE),
    'no_duplicate_settlement_items', NOT EXISTS (SELECT 1 FROM duplicate_items),
    'no_overallocated_commission_events', NOT EXISTS (SELECT 1 FROM overallocated_events),
    'payment_balance_view_matches_items', NOT EXISTS (SELECT 1 FROM balance_mismatches),
    'no_negative_positive_event_balances', NOT EXISTS (SELECT 1 FROM negative_or_invalid_balances),
    'no_orphan_settlement_items', NOT EXISTS (SELECT 1 FROM orphan_items),
    'all_settlement_totals_match_items', COALESCE((
      SELECT bool_and(reconciliation.items_match_settlement_total)
      FROM settlement_reconciliation AS reconciliation
    ), TRUE),
    'all_paid_settlements_have_exactly_one_expense', COALESCE((
      SELECT bool_and(reconciliation.expense_count_is_consistent)
      FROM settlement_reconciliation AS reconciliation
    ), TRUE),
    'all_paid_settlement_expenses_match_amount', COALESCE((
      SELECT bool_and(reconciliation.expense_amount_is_consistent)
      FROM settlement_reconciliation AS reconciliation
    ), TRUE)
  ) AS checks
)
SELECT jsonb_build_object(
  'diagnostic', jsonb_build_object(
    'generated_at', statement_timestamp(),
    'transaction_read_only', current_setting('transaction_read_only')::BOOLEAN,
    'parameters', (SELECT to_jsonb(parameter) FROM parameters AS parameter),
    'identity', jsonb_build_object(
      'selected', (SELECT to_jsonb(identity) - 'match_priority' FROM gerardo AS identity),
      'all_candidates', COALESCE((
        SELECT jsonb_agg(to_jsonb(candidate) ORDER BY candidate.match_priority, candidate.id)
        FROM gerardo_candidates AS candidate
      ), '[]'::JSONB)
    ),
    'frontend_card_contract', jsonb_build_object(
      'commission_available', 'v_seller_commission_monthly_summary.available_total, grouped by the event earned_at month in America/Mexico_City',
      'commissions_available_total', 'v_commissions_available_for_payment.available_amount, accumulated across all months',
      'pending_release', 'v_seller_commission_monthly_summary.pending_total for events earned in the selected month',
      'paid', 'v_seller_commission_monthly_summary.paid_total allocated to events earned in the selected month; it is not cash paid during the selected month',
      'generated_total', 'v_seller_commission_monthly_summary.generated_total for non-cancelled events earned in the selected month',
      'history', 'v_commission_settlement_history, unfiltered by selected month after filtering by seller',
      'extra_days', 'commission_events with source_type adjustment and metadata.adjustment_type extra_day'
    ),
    'schema_contract', jsonb_build_object(
      'relations', COALESCE((
        SELECT jsonb_agg(to_jsonb(relation) - 'oid' ORDER BY relation.relation_name)
        FROM relation_catalog AS relation
      ), '[]'::JSONB),
      'columns', COALESCE((
        SELECT jsonb_agg(to_jsonb(column_row) ORDER BY column_row.table_name, column_row.ordinal_position)
        FROM relation_columns AS column_row
      ), '[]'::JSONB),
      'constraints', COALESCE((
        SELECT jsonb_agg(to_jsonb(constraint_row) ORDER BY constraint_row.table_name, constraint_row.constraint_name)
        FROM relation_constraints AS constraint_row
      ), '[]'::JSONB),
      'indexes', COALESCE((
        SELECT jsonb_agg(to_jsonb(index_row) ORDER BY index_row.table_name, index_row.index_name)
        FROM relation_indexes AS index_row
      ), '[]'::JSONB),
      'policies', COALESCE((
        SELECT jsonb_agg(to_jsonb(policy_row) ORDER BY policy_row.table_name, policy_row.policy_name)
        FROM relation_policies AS policy_row
      ), '[]'::JSONB),
      'functions', COALESCE((
        SELECT jsonb_agg(to_jsonb(function_row) - 'oid' ORDER BY function_row.function_name, function_row.identity_arguments)
        FROM related_functions AS function_row
      ), '[]'::JSONB),
      'triggers', COALESCE((
        SELECT jsonb_agg(to_jsonb(trigger_row) ORDER BY trigger_row.table_name, trigger_row.trigger_name)
        FROM related_triggers AS trigger_row
      ), '[]'::JSONB),
      'other_compensation_relation_candidates', COALESCE((
        SELECT jsonb_agg(to_jsonb(relation) ORDER BY relation.relation_name)
        FROM other_compensation_relations AS relation
      ), '[]'::JSONB)
    ),
    'october_2026', jsonb_build_object(
      'deployed_monthly_summary', (SELECT to_jsonb(summary) FROM deployed_monthly_summary AS summary),
      'independent_event_totals', (SELECT to_jsonb(total) FROM october_event_totals AS total),
      'card_reconciliation', (SELECT to_jsonb(reconciliation) FROM monthly_card_reconciliation AS reconciliation),
      'cash_paid_during_october_by_settlement_paid_at', (SELECT to_jsonb(cashflow) FROM october_cashflow AS cashflow),
      'events', COALESCE((
        SELECT jsonb_agg(to_jsonb(event) ORDER BY event.earned_at, event.commission_event_id)
        FROM october_events AS event
      ), '[]'::JSONB)
    ),
    'historical_accumulated', jsonb_build_object(
      'independent_event_totals', (SELECT to_jsonb(total) FROM accumulated_event_totals AS total),
      'deployed_available_for_payment', (SELECT to_jsonb(available) FROM deployed_accumulated_available AS available),
      'all_events', COALESCE((
        SELECT jsonb_agg(to_jsonb(event) ORDER BY event.earned_at, event.commission_event_id)
        FROM gerardo_events AS event
      ), '[]'::JSONB)
    ),
    'october_15_reported_payment', jsonb_build_object(
      'paid_settlement_totals', (SELECT to_jsonb(total) FROM target_day_settlement_totals AS total),
      'settlements_paid_that_day', COALESCE((
        SELECT jsonb_agg(to_jsonb(settlement) ORDER BY settlement.paid_at, settlement.settlement_id)
        FROM settlements_paid_on_target_date AS settlement
      ), '[]'::JSONB),
      'settlements_created_that_day', COALESCE((
        SELECT jsonb_agg(to_jsonb(settlement) ORDER BY settlement.created_at, settlement.settlement_id)
        FROM settlements_created_on_target_date AS settlement
      ), '[]'::JSONB),
      'expense_totals', (SELECT to_jsonb(total) FROM target_day_expense_totals AS total),
      'expenses_that_day', COALESCE((
        SELECT jsonb_agg(to_jsonb(expense) ORDER BY expense.expense_id)
        FROM expenses_on_target_date AS expense
      ), '[]'::JSONB),
      'all_finance_expenses_that_day', COALESCE((
        SELECT jsonb_agg(to_jsonb(expense) ORDER BY expense.expense_id)
        FROM all_finance_expenses_on_target_date AS expense
      ), '[]'::JSONB),
      'interpretation_rule', 'Do not add settlement totals and their linked expenses: they are two records of the same commission cash outflow.'
    ),
    'settlements_and_items', jsonb_build_object(
      'settlements', COALESCE((
        SELECT jsonb_agg(to_jsonb(settlement) ORDER BY settlement.created_at, settlement.settlement_id)
        FROM gerardo_settlements AS settlement
      ), '[]'::JSONB),
      'items', COALESCE((
        SELECT jsonb_agg(to_jsonb(item) ORDER BY item.settlement_created_at, item.settlement_id, item.settlement_item_id)
        FROM gerardo_settlement_items AS item
      ), '[]'::JSONB),
      'reconciliation', COALESCE((
        SELECT jsonb_agg(to_jsonb(reconciliation) ORDER BY reconciliation.paid_at NULLS LAST, reconciliation.settlement_id)
        FROM settlement_reconciliation AS reconciliation
      ), '[]'::JSONB)
    ),
    'finance_reconciliation', jsonb_build_object(
      'expenses', COALESCE((
        SELECT jsonb_agg(to_jsonb(expense) ORDER BY expense.expense_date, expense.expense_id)
        FROM gerardo_expenses AS expense
      ), '[]'::JSONB),
      'missing_or_duplicate_or_mismatched_expenses', COALESCE((
        SELECT jsonb_agg(to_jsonb(reconciliation) ORDER BY reconciliation.settlement_id)
        FROM settlement_reconciliation AS reconciliation
        WHERE NOT reconciliation.expense_count_is_consistent
           OR NOT reconciliation.expense_amount_is_consistent
      ), '[]'::JSONB)
    ),
    'anomalies', jsonb_build_object(
      'duplicate_items_within_same_settlement', COALESCE((
        SELECT jsonb_agg(to_jsonb(duplicate) ORDER BY duplicate.settlement_id, duplicate.commission_event_id)
        FROM duplicate_items AS duplicate
      ), '[]'::JSONB),
      'overallocated_events', COALESCE((
        SELECT jsonb_agg(to_jsonb(allocation) ORDER BY allocation.commission_event_id)
        FROM overallocated_events AS allocation
      ), '[]'::JSONB),
      'payment_balance_mismatches', COALESCE((
        SELECT jsonb_agg(to_jsonb(mismatch) ORDER BY mismatch.commission_event_id)
        FROM balance_mismatches AS mismatch
      ), '[]'::JSONB),
      'negative_balances_on_positive_events', COALESCE((
        SELECT jsonb_agg(to_jsonb(balance) ORDER BY balance.commission_event_id)
        FROM negative_or_invalid_balances AS balance
      ), '[]'::JSONB),
      'orphan_items', COALESCE((
        SELECT jsonb_agg(to_jsonb(item) ORDER BY item.settlement_item_id)
        FROM orphan_items AS item
      ), '[]'::JSONB)
    ),
    'checks', (SELECT findings.checks FROM diagnostic_findings AS findings),
    'reading_guide', jsonb_build_array(
      'Compare october_2026.deployed_monthly_summary with independent_event_totals and card_reconciliation.',
      'Use october_15_reported_payment to determine whether 700 was a commission settlement, another expense, several records, or absent.',
      'Use historical_accumulated to explain available balances from earlier months.',
      'Use settlements_and_items and anomalies to exclude double payment and partial-allocation errors.',
      'Use finance_reconciliation to verify one protected expense per paid settlement with the same amount.'
    )
  )
) AS result;

ROLLBACK;
