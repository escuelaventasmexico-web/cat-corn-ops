-- READ-ONLY verification for the monthly supply-purchase budget.
-- Run after the reviewed migration. This script performs no writes.

WITH structural AS (
  SELECT
    TO_REGCLASS('public.finance_month_supply_budgets') IS NOT NULL AS table_exists,
    TO_REGPROCEDURE('public.finance_month_supply_budget(date,uuid)') IS NOT NULL AS read_rpc_exists,
    TO_REGPROCEDURE('public.finance_set_month_supply_budget(date,numeric)') IS NOT NULL AS write_rpc_exists,
    EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'finance_month_supply_budgets'
        AND policyname = 'finance_supply_budget_select_authorized'
        AND COALESCE(qual, '') LIKE '%finance_has_available_funds_access%'
    ) AS authorized_read_policy_exists,
    NOT has_table_privilege('authenticated', 'public.finance_month_supply_budgets', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.finance_month_supply_budgets', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.finance_month_supply_budgets', 'DELETE')
      AS direct_authenticated_writes_revoked,
    NOT has_table_privilege('authenticated', 'public.finance_month_supply_budgets', 'SELECT')
      AS direct_authenticated_reads_revoked,
    has_function_privilege('authenticated', 'public.finance_month_supply_budget(date,uuid)', 'EXECUTE')
      AS read_rpc_execute_granted,
    has_function_privilege('authenticated', 'public.finance_set_month_supply_budget(date,numeric)', 'EXECUTE')
      AS write_rpc_execute_granted,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_supply_budget(date,uuid)'))
        LIKE '%finance_has_available_funds_access()%'
    ), false) AS read_rpc_requires_finance_access,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_month_supply_budget(date,uuid)'))
        LIKE '%finance_has_available_funds_access() IS NOT TRUE%'
    ), false) AS read_rpc_denies_null_access,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_set_month_supply_budget(date,numeric)'))
        LIKE '%finance_has_available_funds_access()%'
    ), false) AS write_rpc_requires_finance_access,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.finance_set_month_supply_budget(date,numeric)'))
        LIKE '%finance_has_available_funds_access() IS NOT TRUE%'
    ), false) AS write_rpc_denies_null_access
), november_budget AS (
  SELECT budget.month_start, budget.limit_mxn
  FROM public.finance_month_supply_budgets budget
  WHERE budget.month_start = DATE '2026-11-01'
), november_expenses AS (
  SELECT
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
    ), 0) AS used_mxn,
    COALESCE(SUM(expense.amount_mxn) FILTER (WHERE expense.concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING') AND expense.destination_scope = 'AURRERA'), 0) AS aurrera_mxn,
    COALESCE(SUM(expense.amount_mxn) FILTER (WHERE expense.concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING') AND expense.destination_scope = 'CHIPITLAN'), 0) AS chipitlan_mxn,
    COALESCE(SUM(expense.amount_mxn) FILTER (WHERE expense.concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING') AND expense.destination_scope = 'SHARED'), 0) AS shared_mxn,
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
        AND (expense.destination_scope IS NULL OR expense.destination_scope NOT IN ('AURRERA', 'CHIPITLAN', 'SHARED'))
    ), 0) AS unassigned_mxn,
    COUNT(*) FILTER (
      WHERE expense.concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
        AND (expense.destination_scope IS NULL OR expense.destination_scope NOT IN ('AURRERA', 'CHIPITLAN', 'SHARED'))
    ) AS unassigned_supply_count,
    COUNT(*) FILTER (WHERE expense.concept_code IS NULL) AS potential_supply_count,
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.concept_code IS NULL
    ), 0) AS potential_supply_mxn,
    COUNT(*) FILTER (
      WHERE expense.concept_code IS NOT NULL
        AND expense.concept_code NOT IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
    ) AS confirmed_non_supply_count,
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.concept_code IS NOT NULL
        AND expense.concept_code NOT IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
    ), 0) AS confirmed_non_supply_mxn
  FROM public.expenses expense
  WHERE expense.expense_date >= DATE '2026-11-01'
    AND expense.expense_date < DATE '2026-12-01'
), simulated_expenses (amount_mxn, concept_code, destination_scope) AS (
  VALUES
    (100.00::NUMERIC, 'CORN'::TEXT, 'UNKNOWN'::TEXT),
    (75.00::NUMERIC, 'COMMISSIONS'::TEXT, 'UNKNOWN'::TEXT),
    (50.00::NUMERIC, NULL::TEXT, NULL::TEXT)
), simulated_classified AS (
  SELECT
    simulated_expenses.*,
    CASE
      WHEN concept_code IS NULL THEN 'POTENTIAL_SUPPLY'
      WHEN concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING') THEN 'SUPPLY'
      ELSE 'CONFIRMED_NON_SUPPLY'
    END AS budget_class
  FROM simulated_expenses
), rule_cases AS (
  SELECT
    COALESCE(SUM(amount_mxn) FILTER (
      WHERE concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
    ), 0) AS supply_global_mxn,
    COALESCE(SUM(amount_mxn) FILTER (
      WHERE concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
        AND (destination_scope IS NULL OR destination_scope NOT IN ('AURRERA', 'CHIPITLAN', 'SHARED'))
    ), 0) AS unassigned_supply_mxn,
    COUNT(*) FILTER (WHERE budget_class = 'POTENTIAL_SUPPLY') AS potential_supply_count,
    COUNT(*) FILTER (WHERE budget_class = 'CONFIRMED_NON_SUPPLY') AS confirmed_non_supply_count,
    COUNT(*) FILTER (
      WHERE concept_code = 'COMMISSIONS'
        AND destination_scope = 'UNKNOWN'
        AND budget_class = 'POTENTIAL_SUPPLY'
    ) AS commission_unknown_reported_as_potential
  FROM simulated_classified
)
SELECT
  structural.*,
  (structural.table_exists
    AND structural.read_rpc_exists
    AND structural.write_rpc_exists
    AND structural.authorized_read_policy_exists
    AND structural.direct_authenticated_writes_revoked
    AND structural.direct_authenticated_reads_revoked
    AND structural.read_rpc_execute_granted
    AND structural.write_rpc_execute_granted
    AND structural.read_rpc_requires_finance_access
    AND structural.read_rpc_denies_null_access
    AND structural.write_rpc_requires_finance_access
    AND structural.write_rpc_denies_null_access
  ) AS structural_checks_passed,
  (rule_cases.supply_global_mxn = 100.00
    AND rule_cases.unassigned_supply_mxn = 100.00
    AND rule_cases.potential_supply_count = 1
    AND rule_cases.confirmed_non_supply_count = 1
    AND rule_cases.commission_unknown_reported_as_potential = 0
  ) AS calculation_rule_checks_passed,
  (structural.table_exists
    AND structural.read_rpc_exists
    AND structural.write_rpc_exists
    AND structural.authorized_read_policy_exists
    AND structural.direct_authenticated_writes_revoked
    AND structural.direct_authenticated_reads_revoked
    AND structural.read_rpc_execute_granted
    AND structural.write_rpc_execute_granted
    AND structural.read_rpc_requires_finance_access
    AND structural.read_rpc_denies_null_access
    AND structural.write_rpc_requires_finance_access
    AND structural.write_rpc_denies_null_access
    AND rule_cases.supply_global_mxn = 100.00
    AND rule_cases.unassigned_supply_mxn = 100.00
    AND rule_cases.potential_supply_count = 1
    AND rule_cases.confirmed_non_supply_count = 1
    AND rule_cases.commission_unknown_reported_as_potential = 0
    AND november_budget.limit_mxn = 10000.00
    AND november_expenses.aurrera_mxn
      + november_expenses.chipitlan_mxn
      + november_expenses.shared_mxn
      + november_expenses.unassigned_mxn
      = november_expenses.used_mxn
  ) AS all_checks_passed,
  november_budget.month_start,
  november_budget.limit_mxn,
  november_budget.limit_mxn = 10000.00 AS november_limit_is_10000,
  november_expenses.used_mxn,
  november_expenses.aurrera_mxn,
  november_expenses.chipitlan_mxn,
  november_expenses.shared_mxn,
  november_expenses.unassigned_mxn,
  november_expenses.aurrera_mxn
    + november_expenses.chipitlan_mxn
    + november_expenses.shared_mxn
    + november_expenses.unassigned_mxn
    = november_expenses.used_mxn AS destination_breakdown_sums_to_global,
  GREATEST(COALESCE(november_budget.limit_mxn, 0) - november_expenses.used_mxn, 0) AS remaining_mxn,
  GREATEST(november_expenses.used_mxn - COALESCE(november_budget.limit_mxn, 0), 0) AS exceeded_mxn,
  november_expenses.unassigned_supply_count,
  november_expenses.potential_supply_count,
  november_expenses.potential_supply_mxn,
  november_expenses.confirmed_non_supply_count,
  november_expenses.confirmed_non_supply_mxn,
  november_expenses.potential_supply_count = 0 AS global_usage_is_definitive,
  rule_cases.commission_unknown_reported_as_potential = 0 AS commission_unknown_does_not_raise_supply_alert
FROM structural
LEFT JOIN november_budget ON true
CROSS JOIN november_expenses
CROSS JOIN rule_cases;
