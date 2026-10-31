-- READ ONLY. Run before reviewing/applying the prospective classification migration.

SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('expenses', 'fixed_costs')
ORDER BY table_name, ordinal_position;

SELECT
  constraint_row.conname AS constraint_name,
  constraint_row.contype AS constraint_type,
  PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) AS definition
FROM pg_constraint AS constraint_row
WHERE constraint_row.conrelid IN ('public.expenses'::REGCLASS, 'public.fixed_costs'::REGCLASS)
ORDER BY constraint_row.conrelid::REGCLASS::TEXT, constraint_row.conname;

SELECT
  trigger_row.tgname AS trigger_name,
  trigger_row.tgenabled AS enabled,
  PG_GET_TRIGGERDEF(trigger_row.oid, TRUE) AS definition
FROM pg_trigger AS trigger_row
WHERE trigger_row.tgrelid IN ('public.expenses'::REGCLASS, 'public.commission_settlements'::REGCLASS)
  AND NOT trigger_row.tgisinternal
ORDER BY trigger_row.tgrelid::REGCLASS::TEXT, trigger_row.tgname;

SELECT
  policy.schemaname,
  policy.tablename,
  policy.policyname,
  policy.roles,
  policy.cmd,
  policy.qual,
  policy.with_check
FROM pg_policies AS policy
WHERE policy.schemaname = 'public'
  AND policy.tablename IN ('expenses', 'fixed_costs')
ORDER BY policy.tablename, policy.policyname;

SELECT
  procedure_row.oid::REGPROCEDURE::TEXT AS signature,
  MD5(PG_GET_FUNCTIONDEF(procedure_row.oid)) AS definition_md5,
  PG_GET_FUNCTIONDEF(procedure_row.oid) AS definition
FROM pg_proc AS procedure_row
JOIN pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
WHERE namespace_row.nspname = 'public'
  AND procedure_row.proname IN (
    'finance_month_summary',
    'finance_daily_series',
    'finance_daily_breakdown',
    'finance_calendar_with_yoy',
    'create_expense_for_paid_commission_settlement',
    'protect_commission_settlement_expense',
    'enforce_fixed_expense_classification'
  )
ORDER BY signature;

SELECT
  COUNT(*) AS expense_count,
  COALESCE(SUM(amount_mxn), 0) AS expense_total_mxn,
  MD5(
    COALESCE(
      STRING_AGG(
        CONCAT_WS('|', id, expense_date, amount_mxn, type, category, vendor,
          payment_method, fixed_cost_id, commission_settlement_id),
        E'\n' ORDER BY id
      ),
      ''
    )
  ) AS reviewed_core_data_md5
FROM public.expenses;

SELECT
  COUNT(*) AS october_expense_count,
  COALESCE(SUM(amount_mxn), 0) AS october_expense_amount_mxn,
  MD5(
    COALESCE(
      STRING_AGG(
        CONCAT_WS('|', id, expense_date, amount_mxn, type, category, vendor,
          payment_method, fixed_cost_id, commission_settlement_id),
        E'\n' ORDER BY id
      ),
      ''
    )
  ) AS october_core_data_md5
FROM public.expenses
WHERE expense_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-31';

-- Inventory for human review only. It is not a mapping proposal.
SELECT
  type::TEXT AS expense_type,
  category AS legacy_category,
  COUNT(*) AS record_count,
  COALESCE(SUM(amount_mxn), 0) AS total_mxn
FROM public.expenses
GROUP BY type::TEXT, category
ORDER BY type::TEXT, category NULLS FIRST;

SELECT
  id,
  expense_date,
  amount_mxn,
  type::TEXT AS expense_type,
  category AS legacy_category,
  vendor,
  notes,
  fixed_cost_id,
  commission_settlement_id
FROM public.expenses
WHERE type::TEXT = 'OTHER'
  AND commission_settlement_id IS NULL
ORDER BY expense_date, id;

SELECT
  id,
  obligation_code,
  name,
  scope,
  effective_from,
  effective_to,
  configuration_status
FROM public.fixed_costs
ORDER BY effective_from, obligation_code;

-- Commission destination preview. A non-POS event, missing sale or unknown
-- branch makes the whole settlement UNKNOWN; it is never converted to SHARED.
WITH event_destinations AS (
  SELECT settlement.id AS settlement_id, settlement.folio,
    settlement.status::TEXT AS settlement_status, settlement.created_at,
    event.source_type,
    CASE branch.code
      WHEN 'aurrera_la_luna_02' THEN 'AURRERA'
      WHEN 'chipitlan_01' THEN 'CHIPITLAN'
      ELSE NULL
    END AS resolved_destination
  FROM public.commission_settlements AS settlement
  JOIN public.commission_settlement_items AS item ON item.settlement_id = settlement.id
  JOIN public.commission_events AS event ON event.id = item.commission_event_id
  LEFT JOIN public.sales AS sale
    ON event.source_type = 'pos_sale' AND sale.id = event.source_id
  LEFT JOIN public.branches AS branch ON branch.id = sale.branch_id
), settlement_resolution AS (
  SELECT settlement_id, folio, settlement_status, MIN(created_at) AS created_at,
    COUNT(*) AS settlement_item_count,
    COUNT(DISTINCT source_type) AS source_type_count,
    ARRAY_AGG(DISTINCT source_type ORDER BY source_type) AS source_types,
    COUNT(*) FILTER (WHERE resolved_destination IS NULL) AS unresolved_event_count,
    COUNT(DISTINCT resolved_destination) AS resolved_destination_count,
    MIN(resolved_destination) AS single_destination
  FROM event_destinations
  GROUP BY settlement_id, folio, settlement_status
)
SELECT settlement_id, folio, settlement_status, settlement_item_count,
  source_type_count, source_types, unresolved_event_count,
  CASE
    WHEN settlement_item_count = 0 OR unresolved_event_count > 0 THEN 'UNKNOWN'
    WHEN resolved_destination_count = 1 THEN single_destination
    ELSE 'MIXED'
  END AS proposed_destination
FROM settlement_resolution
ORDER BY created_at, settlement_id;
