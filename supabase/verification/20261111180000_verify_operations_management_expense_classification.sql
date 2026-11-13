-- STRICTLY READ ONLY.
-- Run after 20261111180000_add_operations_management_expense_classification.sql.
-- Reports existing rows without updating or inferring any classification.

WITH concept_constraint AS (
  SELECT COUNT(*) = 1
    AND COALESCE(BOOL_AND(
      PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) LIKE '%OPERATIONS_MANAGEMENT%'
    ), FALSE) AS passed
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_concept_code_check'
    AND constraint_row.contype = 'c'
), destination_constraint AS (
  SELECT COUNT(*) = 1
    AND COALESCE(BOOL_AND(
      PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) LIKE '%ENRIQUE%'
    ), FALSE) AS passed
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_destination_scope_check'
    AND constraint_row.contype = 'c'
), consistency_constraint AS (
  SELECT COUNT(*) = 1
    AND COALESCE(BOOL_AND(
      PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) LIKE '%ENRIQUE%'
      AND PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) LIKE '%commission_origin_scope%'
    ), FALSE) AS passed
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_classification_consistency_check'
    AND constraint_row.contype = 'c'
), manual_enforcement AS (
  SELECT TO_REGPROCEDURE('public.enforce_expense_concept_destination()') IS NOT NULL
    AND STRPOS(PG_GET_FUNCTIONDEF(
      TO_REGPROCEDURE('public.enforce_expense_concept_destination()')),
      '''AURRERA'', ''CHIPITLAN'', ''SHARED'', ''ENRIQUE''') > 0
    AND STRPOS(PG_GET_FUNCTIONDEF(
      TO_REGPROCEDURE('public.enforce_expense_concept_destination()')),
      'NEW.destination_scope := ''SHARED''') > 0
    AND STRPOS(PG_GET_FUNCTIONDEF(
      TO_REGPROCEDURE('public.enforce_expense_concept_destination()')),
      'NEW.commission_origin_scope := CASE') > 0
    AND EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
        AND trigger_row.tgname = 'enforce_expense_concept_destination_trigger'
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgenabled <> 'D'
    ) AS passed
), fixed_cost_scope AS (
  SELECT COUNT(*) = 1
    AND COALESCE(BOOL_AND(
      PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) NOT LIKE '%ENRIQUE%'
    ), FALSE) AS passed
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.fixed_costs'::REGCLASS
    AND constraint_row.conname = 'fixed_costs_scope_check'
    AND constraint_row.contype = 'c'
), commission_protection AS (
  SELECT NOT HAS_COLUMN_PRIVILEGE(
      'authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
    AND NOT HAS_COLUMN_PRIVILEGE(
      'authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE')
    AND EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
        AND trigger_row.tgname = 'protect_commission_settlement_expense_trigger'
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgenabled <> 'D'
    ) AS passed
), special_budget_functions AS (
  SELECT COUNT(procedure_row.oid) = 4
    AND COALESCE(BOOL_AND(
      STRPOS(PG_GET_FUNCTIONDEF(procedure_row.oid), 'OPERATIONS_MANAGEMENT') = 0
    ), FALSE) AS operations_management_isolated
  FROM (VALUES
    ('public.finance_month_supply_budget(date,uuid)'),
    ('public.finance_month_fuel_budget(date,uuid)'),
    ('public.finance_month_stationery_budget(date,uuid)'),
    ('public.finance_month_cleaning_budget(date,uuid)')
  ) AS expected(signature)
  LEFT JOIN pg_proc AS procedure_row
    ON procedure_row.oid = TO_REGPROCEDURE(expected.signature)
), historical_other AS (
  SELECT COUNT(*) AS expense_count,
    COALESCE(SUM(expense.amount_mxn), 0) AS amount_mxn
  FROM public.expenses AS expense
  WHERE expense.concept_code = 'OTHER'
), operations_management_rows AS (
  SELECT COUNT(*) AS expense_count,
    COALESCE(SUM(expense.amount_mxn), 0) AS amount_mxn
  FROM public.expenses AS expense
  WHERE expense.concept_code = 'OPERATIONS_MANAGEMENT'
), enrique_rows AS (
  SELECT COUNT(*) AS expense_count,
    COALESCE(SUM(expense.amount_mxn), 0) AS amount_mxn
  FROM public.expenses AS expense
  WHERE expense.destination_scope = 'ENRIQUE'
), pending_classification AS (
  SELECT COUNT(*) AS expense_count,
    COALESCE(SUM(expense.amount_mxn), 0) AS amount_mxn
  FROM public.expenses AS expense
  WHERE expense.concept_code IS NULL
     OR expense.destination_scope IS NULL
     OR expense.destination_scope = 'UNKNOWN'
     OR expense.classification_status IS NULL
)
SELECT concept_constraint.passed
    AND destination_constraint.passed
    AND consistency_constraint.passed
    AND manual_enforcement.passed
    AND fixed_cost_scope.passed
    AND commission_protection.passed
    AND special_budget_functions.operations_management_isolated
    AS all_checks_passed,
  concept_constraint.passed AS operations_management_concept_allowed,
  destination_constraint.passed AS enrique_destination_allowed,
  consistency_constraint.passed AS classification_consistency_preserved,
  manual_enforcement.passed AS manual_enforcement_supports_enrique,
  fixed_cost_scope.passed AS fixed_cost_destinations_unchanged,
  commission_protection.passed AS commission_link_write_still_protected,
  special_budget_functions.operations_management_isolated
    AS operations_management_isolated_from_special_budgets,
  historical_other.expense_count AS historical_other_expense_count,
  historical_other.amount_mxn AS historical_other_expense_amount_mxn,
  operations_management_rows.expense_count AS operations_management_expense_count,
  operations_management_rows.amount_mxn AS operations_management_expense_amount_mxn,
  enrique_rows.expense_count AS enrique_destination_expense_count,
  enrique_rows.amount_mxn AS enrique_destination_expense_amount_mxn,
  pending_classification.expense_count AS pending_classification_count,
  pending_classification.amount_mxn AS pending_classification_amount_mxn
FROM concept_constraint
CROSS JOIN destination_constraint
CROSS JOIN consistency_constraint
CROSS JOIN manual_enforcement
CROSS JOIN fixed_cost_scope
CROSS JOIN commission_protection
CROSS JOIN special_budget_functions
CROSS JOIN historical_other
CROSS JOIN operations_management_rows
CROSS JOIN enrique_rows
CROSS JOIN pending_classification;
