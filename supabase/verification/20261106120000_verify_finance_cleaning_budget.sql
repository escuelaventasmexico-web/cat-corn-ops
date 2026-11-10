-- READ-ONLY verification for the independent monthly cleaning budget.
-- Run after the reviewed migration. This script performs no writes and calls
-- the same canonical calculation used by finance_month_cleaning_budget.

WITH structural AS (
  SELECT
    TO_REGCLASS('public.finance_month_cleaning_budgets') IS NOT NULL AS table_exists,
    TO_REGPROCEDURE('public.finance_calculate_cleaning_budget(numeric,jsonb)') IS NOT NULL
      AS calculation_function_exists,
    TO_REGPROCEDURE('public.finance_month_cleaning_budget(date,uuid)') IS NOT NULL
      AS read_rpc_exists,
    TO_REGPROCEDURE('public.finance_set_month_cleaning_budget(date,numeric)') IS NOT NULL
      AS write_rpc_exists,
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.expenses'::REGCLASS
        AND conname = 'expenses_concept_code_check'
        AND PG_GET_CONSTRAINTDEF(oid) LIKE '%CLEANING%'
    ) AS cleaning_concept_allowed,
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.finance_month_cleaning_budgets'::REGCLASS
        AND tgname = 'finance_cleaning_budget_updated_at'
        AND NOT tgisinternal AND tgenabled <> 'D'
    ) AS updated_at_trigger_enabled,
    NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.expenses'::REGCLASS
        AND tgname = 'enforce_cleaning_budget_limit_trigger'
        AND NOT tgisinternal AND tgenabled <> 'D'
    ) AS overage_remains_advisory,
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'finance_month_cleaning_budgets'
        AND policyname = 'finance_cleaning_budget_select_authorized'
        AND COALESCE(qual, '') LIKE '%finance_has_available_funds_access%'
    ) AS authorized_read_policy_exists,
    NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_month_cleaning_budgets', 'SELECT')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_month_cleaning_budgets', 'INSERT')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_month_cleaning_budgets', 'UPDATE')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_month_cleaning_budgets', 'DELETE')
      AS direct_budget_table_access_revoked,
    HAS_FUNCTION_PRIVILEGE('authenticated', 'public.finance_month_cleaning_budget(date,uuid)', 'EXECUTE')
      AS read_rpc_execute_granted,
    HAS_FUNCTION_PRIVILEGE('authenticated', 'public.finance_set_month_cleaning_budget(date,numeric)', 'EXECUTE')
      AS write_rpc_execute_granted,
    NOT HAS_FUNCTION_PRIVILEGE('authenticated', 'public.finance_calculate_cleaning_budget(numeric,jsonb)', 'EXECUTE')
      AS internal_calculation_not_exposed,
    NOT HAS_FUNCTION_PRIVILEGE('authenticated', 'public.set_finance_cleaning_budget_updated_at()', 'EXECUTE')
      AS trigger_function_not_exposed,
    NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
      AND NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE')
      AS commission_settlement_still_protected,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_cleaning_budget(date,uuid)'))
        LIKE '%finance_calculate_cleaning_budget%'
    ), FALSE) AS production_rpc_uses_canonical_calculation,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_cleaning_budget(date,uuid)'))
        LIKE '%finance_has_available_funds_access() IS NOT TRUE%'
    ), FALSE) AS read_rpc_denies_null_access,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_set_month_cleaning_budget(date,numeric)'))
        LIKE '%finance_has_available_funds_access() IS NOT TRUE%'
    ), FALSE) AS write_rpc_denies_null_access,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_cleaning_budget(date,uuid)'))
        NOT LIKE '%finance_credit_card_payments%'
    ), FALSE) AS card_payments_excluded
), november_budget AS (
  SELECT month_start, limit_mxn
  FROM public.finance_month_cleaning_budgets
  WHERE month_start = DATE '2026-11-01'
), november_cleaning AS (
  SELECT
    COALESCE(SUM(amount_mxn) FILTER (WHERE concept_code = 'CLEANING'), 0) AS used_mxn,
    COUNT(*) FILTER (WHERE concept_code = 'CLEANING') AS matching_count,
    COALESCE(SUM(amount_mxn) FILTER (WHERE concept_code IS NULL), 0) AS unclassified_mxn,
    COUNT(*) FILTER (WHERE concept_code IS NULL) AS unclassified_count
  FROM public.expenses
  WHERE expense_date >= DATE '2026-11-01'
    AND expense_date < DATE '2026-12-01'
), threshold_case AS (
  SELECT public.finance_calculate_cleaning_budget(
    350.00,
    '[
      {"amount_mxn": 140, "concept_code": "CLEANING", "payment_instrument": "CASH", "description": "servitoallas"},
      {"amount_mxn": 140, "concept_code": "CLEANING", "payment_instrument": "CREDIT_CARD", "description": "productos para control de plagas"},
      {"amount_mxn": 90, "concept_code": "SERVICES", "payment_instrument": "TRANSFER"},
      {"amount_mxn": 40, "concept_code": null, "payment_instrument": "CASH"}
    ]'::JSONB
  ) AS result
), overage_case AS (
  SELECT public.finance_calculate_cleaning_budget(
    350.00,
    '[{"amount_mxn": 351, "concept_code": "CLEANING", "payment_instrument": "CASH"}]'::JSONB
  ) AS result
), checks AS (
  SELECT
    structural.*,
    threshold_case.result AS threshold_result,
    overage_case.result AS overage_result,
    (threshold_case.result->>'used_mxn')::NUMERIC = 280.00
      AS actual_cleaning_total_correct,
    (threshold_case.result->>'warning_threshold_mxn')::NUMERIC = 280.00
      AS actual_eighty_percent_threshold_correct,
    (threshold_case.result->>'remaining_mxn')::NUMERIC = 70.00
      AS actual_available_amount_correct,
    (threshold_case.result->>'matching_expense_count')::INTEGER = 2
      AS actual_only_cleaning_counted,
    (threshold_case.result#>>'{unclassified_expenses,count}')::INTEGER = 1
      AS actual_unclassified_not_inferred,
    (threshold_case.result#>>'{unclassified_expenses,amount_mxn}')::NUMERIC = 40.00
      AS actual_unclassified_amount_reported,
    (threshold_case.result->>'used_mxn')::NUMERIC = 280.00
      AS actual_credit_purchase_counted_once,
    (overage_case.result->>'used_mxn')::NUMERIC = 351.00
      AND (overage_case.result->>'exceeded_mxn')::NUMERIC = 1.00
      AS actual_overage_reported_without_reclassification
  FROM structural CROSS JOIN threshold_case CROSS JOIN overage_case
)
SELECT
  checks.*,
  (checks.table_exists
    AND checks.calculation_function_exists
    AND checks.read_rpc_exists
    AND checks.write_rpc_exists
    AND checks.cleaning_concept_allowed
    AND checks.updated_at_trigger_enabled
    AND checks.overage_remains_advisory
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
  (checks.actual_cleaning_total_correct
    AND checks.actual_eighty_percent_threshold_correct
    AND checks.actual_available_amount_correct
    AND checks.actual_only_cleaning_counted
    AND checks.actual_unclassified_not_inferred
    AND checks.actual_unclassified_amount_reported
    AND checks.actual_credit_purchase_counted_once
    AND checks.actual_overage_reported_without_reclassification
  ) AS functional_calculation_checks_passed,
  (checks.table_exists
    AND checks.calculation_function_exists
    AND checks.read_rpc_exists
    AND checks.write_rpc_exists
    AND checks.cleaning_concept_allowed
    AND checks.updated_at_trigger_enabled
    AND checks.overage_remains_advisory
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
    AND november_budget.limit_mxn = 350.00
    AND checks.actual_cleaning_total_correct
    AND checks.actual_eighty_percent_threshold_correct
    AND checks.actual_available_amount_correct
    AND checks.actual_only_cleaning_counted
    AND checks.actual_unclassified_not_inferred
    AND checks.actual_unclassified_amount_reported
    AND checks.actual_credit_purchase_counted_once
    AND checks.actual_overage_reported_without_reclassification
  ) AS all_checks_passed,
  november_budget.month_start,
  november_budget.limit_mxn,
  november_budget.limit_mxn = 350.00 AS november_limit_is_350,
  november_cleaning.used_mxn,
  november_cleaning.matching_count,
  GREATEST(COALESCE(november_budget.limit_mxn, 0) - november_cleaning.used_mxn, 0)
    AS remaining_mxn,
  GREATEST(november_cleaning.used_mxn - COALESCE(november_budget.limit_mxn, 0), 0)
    AS exceeded_mxn,
  november_cleaning.unclassified_count,
  november_cleaning.unclassified_mxn,
  november_cleaning.unclassified_count = 0 AS actual_month_total_is_definitive
FROM checks
LEFT JOIN november_budget ON TRUE
CROSS JOIN november_cleaning;
