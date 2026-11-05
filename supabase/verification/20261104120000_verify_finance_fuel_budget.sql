-- READ-ONLY verification for the compatible fuel-budget base stage.
-- Run after the base migration and before publishing the new form.
-- This script performs no writes and calls the same canonical calculation
-- function used by finance_month_fuel_budget.

WITH structural AS (
  SELECT
    TO_REGCLASS('public.finance_month_fuel_budgets') IS NOT NULL AS table_exists,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'expenses'
        AND column_name = 'fuel_vehicle_code'
    ) AS vehicle_column_exists,
    TO_REGPROCEDURE('public.finance_calculate_fuel_budget(numeric,numeric,numeric,jsonb)') IS NOT NULL
      AS calculation_function_exists,
    TO_REGPROCEDURE('public.finance_month_fuel_budget(date,uuid)') IS NOT NULL AS read_rpc_exists,
    TO_REGPROCEDURE('public.finance_set_month_fuel_budget(date,numeric,numeric,numeric)') IS NOT NULL AS write_rpc_exists,
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.expenses'::REGCLASS
        AND conname = 'expenses_fuel_vehicle_code_check'
        AND PG_GET_CONSTRAINTDEF(oid) LIKE '%fuel_vehicle_code IS NULL%'
    ) AS compatibility_constraint_allows_null,
    NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.expenses'::REGCLASS
        AND tgname = 'enforce_expense_fuel_vehicle_trigger'
        AND NOT tgisinternal AND tgenabled <> 'D'
    ) AS mandatory_vehicle_trigger_still_pending,
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'finance_month_fuel_budgets'
        AND policyname = 'finance_fuel_budget_select_authorized'
        AND COALESCE(qual, '') LIKE '%finance_has_available_funds_access%'
    ) AS authorized_read_policy_exists,
    NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_month_fuel_budgets', 'SELECT')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_month_fuel_budgets', 'INSERT')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_month_fuel_budgets', 'UPDATE')
      AND NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_month_fuel_budgets', 'DELETE')
      AS direct_budget_table_access_revoked,
    HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'fuel_vehicle_code', 'INSERT')
      AND HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'fuel_vehicle_code', 'UPDATE')
      AS manual_vehicle_write_granted,
    NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
      AND NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE')
      AS commission_settlement_still_protected,
    HAS_FUNCTION_PRIVILEGE('authenticated', 'public.finance_month_fuel_budget(date,uuid)', 'EXECUTE')
      AS read_rpc_execute_granted,
    HAS_FUNCTION_PRIVILEGE('authenticated', 'public.finance_set_month_fuel_budget(date,numeric,numeric,numeric)', 'EXECUTE')
      AS write_rpc_execute_granted,
    NOT HAS_FUNCTION_PRIVILEGE('authenticated', 'public.finance_calculate_fuel_budget(numeric,numeric,numeric,jsonb)', 'EXECUTE')
      AS internal_calculation_not_exposed,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_fuel_budget(date,uuid)'))
        LIKE '%finance_calculate_fuel_budget%'
    ), FALSE) AS production_rpc_uses_canonical_calculation,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_fuel_budget(date,uuid)'))
        LIKE '%finance_has_available_funds_access() IS NOT TRUE%'
    ), FALSE) AS read_rpc_denies_null_access,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_set_month_fuel_budget(date,numeric,numeric,numeric)'))
        LIKE '%finance_has_available_funds_access() IS NOT TRUE%'
    ), FALSE) AS write_rpc_denies_null_access
), november_budget AS (
  SELECT * FROM public.finance_month_fuel_budgets
  WHERE month_start = DATE '2026-11-01'
), november_fuel AS (
  SELECT
    COALESCE(SUM(amount_mxn), 0) AS used_mxn,
    COALESCE(SUM(amount_mxn) FILTER (WHERE fuel_vehicle_code = 'UTILITY'), 0) AS utility_mxn,
    COALESCE(SUM(amount_mxn) FILTER (WHERE fuel_vehicle_code = 'MANAGERIAL'), 0) AS managerial_mxn,
    COALESCE(SUM(amount_mxn) FILTER (
      WHERE fuel_vehicle_code IS NULL
         OR fuel_vehicle_code NOT IN ('UTILITY', 'MANAGERIAL')
    ), 0) AS unassigned_mxn,
    COUNT(*) FILTER (
      WHERE fuel_vehicle_code IS NULL
         OR fuel_vehicle_code NOT IN ('UTILITY', 'MANAGERIAL')
    ) AS unassigned_count
  FROM public.expenses
  WHERE expense_date >= DATE '2026-11-01'
    AND expense_date < DATE '2026-12-01'
    AND concept_code = 'FUEL'
), functional_case AS (
  SELECT public.finance_calculate_fuel_budget(
    1000.00,
    600.00,
    400.00,
    '[
      {"amount_mxn": 100, "concept_code": "FUEL", "fuel_vehicle_code": "UTILITY", "payment_instrument": "CASH"},
      {"amount_mxn": 200, "concept_code": "FUEL", "fuel_vehicle_code": "MANAGERIAL", "payment_instrument": "CREDIT_CARD"},
      {"amount_mxn": 50, "concept_code": "FUEL", "fuel_vehicle_code": null, "payment_instrument": null},
      {"amount_mxn": 70, "concept_code": "OTHER", "fuel_vehicle_code": null, "payment_instrument": "CASH", "description": "caseta"},
      {"amount_mxn": 80, "concept_code": "OTHER", "fuel_vehicle_code": null, "payment_instrument": "CREDIT_CARD", "description": "llantas"}
    ]'::JSONB
  ) AS result
), checks AS (
  SELECT
    structural.*,
    functional_case.result,
    (functional_case.result->>'used_mxn')::NUMERIC = 350.00 AS actual_global_counts_each_fuel_once,
    (functional_case.result#>>'{usage_by_vehicle,UTILITY}')::NUMERIC = 100.00 AS actual_utility_calculation_correct,
    (functional_case.result#>>'{usage_by_vehicle,MANAGERIAL}')::NUMERIC = 200.00 AS actual_managerial_credit_purchase_counted_once,
    (functional_case.result#>>'{usage_by_vehicle,UNASSIGNED}')::NUMERIC = 50.00 AS actual_unassigned_counted_once,
    (functional_case.result#>>'{unassigned_vehicle,count}')::INTEGER = 1 AS actual_unassigned_flagged,
    (functional_case.result->>'matching_expense_count')::INTEGER = 3 AS actual_nonfuel_tolls_and_tires_excluded
  FROM structural CROSS JOIN functional_case
)
SELECT
  checks.*,
  (checks.table_exists
    AND checks.vehicle_column_exists
    AND checks.calculation_function_exists
    AND checks.read_rpc_exists
    AND checks.write_rpc_exists
    AND checks.compatibility_constraint_allows_null
    AND checks.mandatory_vehicle_trigger_still_pending
    AND checks.authorized_read_policy_exists
    AND checks.direct_budget_table_access_revoked
    AND checks.manual_vehicle_write_granted
    AND checks.commission_settlement_still_protected
    AND checks.read_rpc_execute_granted
    AND checks.write_rpc_execute_granted
    AND checks.internal_calculation_not_exposed
    AND checks.production_rpc_uses_canonical_calculation
    AND checks.read_rpc_denies_null_access
    AND checks.write_rpc_denies_null_access
  ) AS structural_checks_passed,
  (checks.actual_global_counts_each_fuel_once
    AND checks.actual_utility_calculation_correct
    AND checks.actual_managerial_credit_purchase_counted_once
    AND checks.actual_unassigned_counted_once
    AND checks.actual_unassigned_flagged
    AND checks.actual_nonfuel_tolls_and_tires_excluded
  ) AS functional_calculation_checks_passed,
  (checks.table_exists
    AND checks.vehicle_column_exists
    AND checks.calculation_function_exists
    AND checks.read_rpc_exists
    AND checks.write_rpc_exists
    AND checks.compatibility_constraint_allows_null
    AND checks.mandatory_vehicle_trigger_still_pending
    AND checks.authorized_read_policy_exists
    AND checks.direct_budget_table_access_revoked
    AND checks.manual_vehicle_write_granted
    AND checks.commission_settlement_still_protected
    AND checks.read_rpc_execute_granted
    AND checks.write_rpc_execute_granted
    AND checks.internal_calculation_not_exposed
    AND checks.production_rpc_uses_canonical_calculation
    AND checks.read_rpc_denies_null_access
    AND checks.write_rpc_denies_null_access
    AND november_budget.global_limit_mxn = 1000.00
    AND november_budget.utility_limit_mxn = 600.00
    AND november_budget.managerial_limit_mxn = 400.00
    AND november_fuel.utility_mxn + november_fuel.managerial_mxn
      + november_fuel.unassigned_mxn = november_fuel.used_mxn
    AND checks.actual_global_counts_each_fuel_once
    AND checks.actual_utility_calculation_correct
    AND checks.actual_managerial_credit_purchase_counted_once
    AND checks.actual_unassigned_counted_once
    AND checks.actual_nonfuel_tolls_and_tires_excluded
  ) AS all_checks_passed,
  november_budget.month_start,
  november_budget.global_limit_mxn,
  november_budget.utility_limit_mxn,
  november_budget.managerial_limit_mxn,
  november_fuel.used_mxn,
  november_fuel.utility_mxn,
  november_fuel.managerial_mxn,
  november_fuel.unassigned_mxn,
  november_fuel.unassigned_count,
  november_fuel.utility_mxn + november_fuel.managerial_mxn
    + november_fuel.unassigned_mxn = november_fuel.used_mxn
    AS vehicle_breakdown_sums_to_global,
  november_fuel.unassigned_count = 0 AS vehicle_breakdown_complete
FROM checks
LEFT JOIN november_budget ON TRUE
CROSS JOIN november_fuel;
