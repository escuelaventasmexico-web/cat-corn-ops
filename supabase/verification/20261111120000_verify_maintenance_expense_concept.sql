-- READ ONLY. Run after 20261111120000_add_maintenance_expense_concept.sql.
-- Reports historical OTHER rows without reclassifying them.

WITH concept_constraint AS (
  SELECT
    COUNT(*) = 1
    AND COALESCE(BOOL_AND(
      PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) LIKE ALL (ARRAY[
        '%CORN%', '%OIL%', '%SEASONINGS%', '%CARAMEL%', '%PACKAGING%',
        '%STATIONERY%', '%CLEANING%', '%FUEL%', '%SERVICES%',
        '%MAINTENANCE%', '%PAYROLL%', '%RENT%', '%COMMISSIONS%', '%OTHER%'
      ])
    ), FALSE) AS passed
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_concept_code_check'
    AND constraint_row.contype = 'c'
), manual_enforcement AS (
  SELECT
    TO_REGPROCEDURE('public.enforce_expense_concept_destination()') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
        AND trigger_row.tgname = 'enforce_expense_concept_destination_trigger'
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgenabled <> 'D'
    ) AS passed
), commission_protection AS (
  SELECT
    NOT HAS_COLUMN_PRIVILEGE(
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
  SELECT
    COUNT(procedure_row.oid) = 4
    AND COALESCE(BOOL_AND(
      STRPOS(PG_GET_FUNCTIONDEF(procedure_row.oid), 'MAINTENANCE') = 0
    ), FALSE) AS maintenance_isolated
  FROM (VALUES
    ('public.finance_month_supply_budget(date,uuid)'),
    ('public.finance_month_fuel_budget(date,uuid)'),
    ('public.finance_month_stationery_budget(date,uuid)'),
    ('public.finance_month_cleaning_budget(date,uuid)')
  ) AS expected(signature)
  LEFT JOIN pg_proc AS procedure_row
    ON procedure_row.oid = TO_REGPROCEDURE(expected.signature)
), historical_other AS (
  SELECT
    COUNT(*) AS expense_count,
    COALESCE(SUM(expense.amount_mxn), 0) AS amount_mxn
  FROM public.expenses AS expense
  WHERE expense.concept_code = 'OTHER'
), maintenance_rows AS (
  SELECT
    COUNT(*) AS expense_count,
    COALESCE(SUM(expense.amount_mxn), 0) AS amount_mxn
  FROM public.expenses AS expense
  WHERE expense.concept_code = 'MAINTENANCE'
), pending_classification AS (
  SELECT
    COUNT(*) AS expense_count,
    COALESCE(SUM(expense.amount_mxn), 0) AS amount_mxn
  FROM public.expenses AS expense
  WHERE expense.concept_code IS NULL
     OR expense.destination_scope IS NULL
     OR expense.destination_scope = 'UNKNOWN'
     OR expense.classification_status IS NULL
)
SELECT
  concept_constraint.passed
    AND manual_enforcement.passed
    AND commission_protection.passed
    AND special_budget_functions.maintenance_isolated
    AS all_checks_passed,
  concept_constraint.passed AS maintenance_concept_allowed,
  manual_enforcement.passed AS manual_classification_enforcement_preserved,
  commission_protection.passed AS commission_link_write_still_protected,
  special_budget_functions.maintenance_isolated
    AS maintenance_isolated_from_special_budgets,
  historical_other.expense_count AS historical_other_expense_count,
  historical_other.amount_mxn AS historical_other_expense_amount_mxn,
  maintenance_rows.expense_count AS maintenance_expense_count,
  maintenance_rows.amount_mxn AS maintenance_expense_amount_mxn,
  pending_classification.expense_count AS pending_classification_count,
  pending_classification.amount_mxn AS pending_classification_amount_mxn
FROM concept_constraint
CROSS JOIN manual_enforcement
CROSS JOIN commission_protection
CROSS JOIN special_budget_functions
CROSS JOIN historical_other
CROSS JOIN maintenance_rows
CROSS JOIN pending_classification;
