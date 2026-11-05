-- READ-ONLY verification for the independent monthly stationery budget.
-- Run after the reviewed migration. This script performs no writes and calls
-- the same canonical calculation used by finance_month_stationery_budget.

WITH structural AS (
  SELECT
    TO_REGCLASS('public.finance_month_stationery_budgets') IS NOT NULL AS table_exists,
    TO_REGPROCEDURE('public.finance_calculate_stationery_budget(numeric,jsonb)') IS NOT NULL
      AS calculation_function_exists,
    TO_REGPROCEDURE('public.finance_month_stationery_budget(date,uuid)') IS NOT NULL
      AS read_rpc_exists,
    TO_REGPROCEDURE('public.finance_set_month_stationery_budget(date,numeric)') IS NOT NULL
      AS write_rpc_exists,
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.expenses'::REGCLASS
        AND conname = 'expenses_concept_code_check'
        AND PG_GET_CONSTRAINTDEF(oid) LIKE '%STATIONERY%'
    ) AS stationery_concept_allowed,
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.expenses'::REGCLASS
        AND tgname = 'enforce_stationery_budget_limit_trigger'
        AND NOT tgisinternal AND tgenabled <> 'D'
    ) AS limit_trigger_enabled,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.enforce_stationery_budget_limit()'))
        LIKE '%v_projected_used > v_limit%'
    ), FALSE) AS trigger_rejects_projected_overage,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.enforce_stationery_budget_limit()'))
        LIKE '%FOR UPDATE%'
    ), FALSE) AS trigger_serializes_same_month_captures,
    COALESCE((
      SELECT procedure_row.prosecdef
      FROM pg_proc AS procedure_row
      WHERE procedure_row.oid = TO_REGPROCEDURE('public.enforce_stationery_budget_limit()')
    ), FALSE) AS trigger_uses_protected_budget_access,
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'finance_month_stationery_budgets'
        AND policyname = 'finance_stationery_budget_select_authorized'
        AND COALESCE(qual, '') LIKE '%finance_has_available_funds_access%'
    ) AS authorized_read_policy_exists,
    NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_month_stationery_budgets', 'SELECT')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_month_stationery_budgets', 'INSERT')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_month_stationery_budgets', 'UPDATE')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_month_stationery_budgets', 'DELETE')
      AS direct_budget_table_access_revoked,
    HAS_FUNCTION_PRIVILEGE('authenticated', 'public.finance_month_stationery_budget(date,uuid)', 'EXECUTE')
      AS read_rpc_execute_granted,
    HAS_FUNCTION_PRIVILEGE('authenticated', 'public.finance_set_month_stationery_budget(date,numeric)', 'EXECUTE')
      AS write_rpc_execute_granted,
    NOT HAS_FUNCTION_PRIVILEGE('authenticated', 'public.finance_calculate_stationery_budget(numeric,jsonb)', 'EXECUTE')
      AS internal_calculation_not_exposed,
    NOT HAS_FUNCTION_PRIVILEGE('authenticated', 'public.enforce_stationery_budget_limit()', 'EXECUTE')
      AS trigger_function_not_exposed,
    NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
      AND NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE')
      AS commission_settlement_still_protected,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_stationery_budget(date,uuid)'))
        LIKE '%finance_calculate_stationery_budget%'
    ), FALSE) AS production_rpc_uses_canonical_calculation,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_stationery_budget(date,uuid)'))
        LIKE '%finance_has_available_funds_access() IS NOT TRUE%'
    ), FALSE) AS read_rpc_denies_null_access,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_set_month_stationery_budget(date,numeric)'))
        LIKE '%finance_has_available_funds_access() IS NOT TRUE%'
    ), FALSE) AS write_rpc_denies_null_access,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_stationery_budget(date,uuid)'))
        NOT LIKE '%finance_credit_card_payments%'
    ), FALSE) AS card_payments_excluded
), november_budget AS (
  SELECT month_start, limit_mxn
  FROM public.finance_month_stationery_budgets
  WHERE month_start = DATE '2026-11-01'
), november_stationery AS (
  SELECT
    COALESCE(SUM(amount_mxn) FILTER (WHERE concept_code = 'STATIONERY'), 0) AS used_mxn,
    COUNT(*) FILTER (WHERE concept_code = 'STATIONERY') AS matching_count,
    COALESCE(SUM(amount_mxn) FILTER (WHERE concept_code IS NULL), 0) AS unclassified_mxn,
    COUNT(*) FILTER (WHERE concept_code IS NULL) AS unclassified_count
  FROM public.expenses
  WHERE expense_date >= DATE '2026-11-01'
    AND expense_date < DATE '2026-12-01'
), functional_case AS (
  SELECT public.finance_calculate_stationery_budget(
    500.00,
    '[
      {"amount_mxn": 200, "concept_code": "STATIONERY", "payment_instrument": "CASH", "description": "hojas de sticker"},
      {"amount_mxn": 200, "concept_code": "STATIONERY", "payment_instrument": "CREDIT_CARD", "description": "tinta"},
      {"amount_mxn": 80, "concept_code": "PACKAGING", "payment_instrument": "CASH"},
      {"amount_mxn": 50, "concept_code": null, "payment_instrument": "TRANSFER"}
    ]'::JSONB
  ) AS result
), checks AS (
  SELECT
    structural.*,
    functional_case.result,
    (functional_case.result->>'used_mxn')::NUMERIC = 400.00
      AS actual_stationery_total_correct,
    (functional_case.result->>'warning_threshold_mxn')::NUMERIC = 400.00
      AS actual_eighty_percent_threshold_correct,
    (functional_case.result->>'remaining_mxn')::NUMERIC = 100.00
      AS actual_available_amount_correct,
    (functional_case.result->>'matching_expense_count')::INTEGER = 2
      AS actual_only_stationery_counted,
    (functional_case.result#>>'{unclassified_expenses,count}')::INTEGER = 1
      AS actual_unclassified_not_inferred,
    (functional_case.result#>>'{unclassified_expenses,amount_mxn}')::NUMERIC = 50.00
      AS actual_unclassified_amount_reported,
    (functional_case.result->>'used_mxn')::NUMERIC = 400.00
      AS actual_credit_purchase_counted_once
  FROM structural CROSS JOIN functional_case
)
SELECT
  checks.*,
  (checks.table_exists
    AND checks.calculation_function_exists
    AND checks.read_rpc_exists
    AND checks.write_rpc_exists
    AND checks.stationery_concept_allowed
    AND checks.limit_trigger_enabled
    AND checks.trigger_rejects_projected_overage
    AND checks.trigger_serializes_same_month_captures
    AND checks.trigger_uses_protected_budget_access
    AND checks.authorized_read_policy_exists
    AND checks.direct_budget_table_access_revoked
    AND checks.read_rpc_execute_granted
    AND checks.write_rpc_execute_granted
    AND checks.internal_calculation_not_exposed
    AND checks.trigger_function_not_exposed
    AND checks.commission_settlement_still_protected
    AND checks.production_rpc_uses_canonical_calculation
    AND checks.read_rpc_denies_null_access
    AND checks.write_rpc_denies_null_access
    AND checks.card_payments_excluded
  ) AS structural_checks_passed,
  (checks.actual_stationery_total_correct
    AND checks.actual_eighty_percent_threshold_correct
    AND checks.actual_available_amount_correct
    AND checks.actual_only_stationery_counted
    AND checks.actual_unclassified_not_inferred
    AND checks.actual_unclassified_amount_reported
    AND checks.actual_credit_purchase_counted_once
  ) AS functional_calculation_checks_passed,
  (checks.table_exists
    AND checks.calculation_function_exists
    AND checks.read_rpc_exists
    AND checks.write_rpc_exists
    AND checks.stationery_concept_allowed
    AND checks.limit_trigger_enabled
    AND checks.trigger_rejects_projected_overage
    AND checks.trigger_serializes_same_month_captures
    AND checks.trigger_uses_protected_budget_access
    AND checks.authorized_read_policy_exists
    AND checks.direct_budget_table_access_revoked
    AND checks.read_rpc_execute_granted
    AND checks.write_rpc_execute_granted
    AND checks.internal_calculation_not_exposed
    AND checks.trigger_function_not_exposed
    AND checks.commission_settlement_still_protected
    AND checks.production_rpc_uses_canonical_calculation
    AND checks.read_rpc_denies_null_access
    AND checks.write_rpc_denies_null_access
    AND checks.card_payments_excluded
    AND november_budget.limit_mxn = 500.00
    AND checks.actual_stationery_total_correct
    AND checks.actual_eighty_percent_threshold_correct
    AND checks.actual_available_amount_correct
    AND checks.actual_only_stationery_counted
    AND checks.actual_unclassified_not_inferred
    AND checks.actual_unclassified_amount_reported
    AND checks.actual_credit_purchase_counted_once
  ) AS all_checks_passed,
  november_budget.month_start,
  november_budget.limit_mxn,
  november_budget.limit_mxn = 500.00 AS november_limit_is_500,
  november_stationery.used_mxn,
  november_stationery.matching_count,
  GREATEST(COALESCE(november_budget.limit_mxn, 0) - november_stationery.used_mxn, 0)
    AS remaining_mxn,
  GREATEST(november_stationery.used_mxn - COALESCE(november_budget.limit_mxn, 0), 0)
    AS exceeded_mxn,
  november_stationery.unclassified_count,
  november_stationery.unclassified_mxn,
  november_stationery.unclassified_count = 0 AS actual_month_total_is_definitive
FROM checks
LEFT JOIN november_budget ON TRUE
CROSS JOIN november_stationery;
