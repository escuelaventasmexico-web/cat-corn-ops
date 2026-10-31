-- CAT CORN: read-only diagnosis for fixed-cost obligations and October 2026 payments.
-- This file contains SELECT statements only. It does not change schema or data.

-- 1. Deployed columns.
SELECT
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('fixed_costs', 'expenses')
ORDER BY table_name, ordinal_position;

-- 2. Constraints and foreign keys.
SELECT
  relation.relname AS table_name,
  constraint_row.conname AS constraint_name,
  pg_get_constraintdef(constraint_row.oid) AS definition
FROM pg_constraint AS constraint_row
JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation.relnamespace
WHERE namespace_row.nspname = 'public'
  AND relation.relname IN ('fixed_costs', 'expenses')
ORDER BY relation.relname, constraint_row.conname;

-- 3. Current RLS policies.
SELECT
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('fixed_costs', 'expenses')
ORDER BY tablename, policyname;

-- 4. Current catalog. Names are evidence for human review, never an automatic match key.
SELECT *
FROM public.fixed_costs
ORDER BY name, id;

-- 5. October fixed expenses. Do not update these rows from this diagnosis.
SELECT *
FROM public.expenses
WHERE expense_date >= DATE '2026-10-01'
  AND expense_date < DATE '2026-11-01'
  AND type::TEXT = 'FIXED'
ORDER BY expense_date, amount_mxn, id;

-- 6. Structural linkage totals. Only a non-null FK is treated as a confirmed link.
SELECT
  COUNT(*) AS fixed_expense_count,
  COALESCE(SUM(amount_mxn), 0) AS fixed_expense_total_mxn,
  COUNT(*) FILTER (WHERE fixed_cost_id IS NOT NULL) AS linked_count,
  COALESCE(SUM(amount_mxn) FILTER (WHERE fixed_cost_id IS NOT NULL), 0) AS linked_mxn,
  COUNT(*) FILTER (WHERE fixed_cost_id IS NULL) AS unlinked_count,
  COALESCE(SUM(amount_mxn) FILTER (WHERE fixed_cost_id IS NULL), 0) AS unlinked_mxn
FROM public.expenses
WHERE expense_date >= DATE '2026-10-01'
  AND expense_date < DATE '2026-11-01'
  AND type::TEXT = 'FIXED';

-- 7. Current summary outputs for October.
SELECT
  summary.result ->> 'fixed_plan_mxn' AS fixed_plan_mxn,
  summary.result ->> 'expenses_fixed_mxn' AS expenses_fixed_mxn,
  summary.result ->> 'fixed_covered_mxn' AS fixed_covered_mxn,
  summary.result ->> 'fixed_pending_mxn' AS fixed_pending_mxn
FROM (
  SELECT public.finance_month_summary(DATE '2026-10-01')::JSONB AS result
) AS summary;

-- 8. Exact deployed RPC definition for review before promoting any proposal.
SELECT
  function_row.oid::REGPROCEDURE::TEXT AS signature,
  MD5(PG_GET_FUNCTIONDEF(function_row.oid)) AS definition_md5,
  PG_GET_FUNCTIONDEF(function_row.oid) AS definition
FROM pg_proc AS function_row
JOIN pg_namespace AS namespace_row ON namespace_row.oid = function_row.pronamespace
WHERE namespace_row.nspname = 'public'
  AND function_row.oid = TO_REGPROCEDURE('public.finance_month_summary(date)');
