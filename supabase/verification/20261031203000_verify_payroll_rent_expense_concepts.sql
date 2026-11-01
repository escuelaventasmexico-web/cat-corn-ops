-- READ ONLY. Run after the reviewed concept-catalog extension.

WITH concept_constraint AS (
  SELECT COUNT(*) = 1
    AND COALESCE(BOOL_AND(PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) LIKE '%PAYROLL%'), FALSE)
    AND COALESCE(BOOL_AND(PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE) LIKE '%RENT%'), FALSE)
      AS passed
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_concept_code_check'
    AND constraint_row.contype = 'c'
), october_catalog AS (
  SELECT COUNT(*) AS obligation_count
  FROM public.fixed_costs AS cost
  WHERE cost.effective_from <= DATE '2026-10-31'
    AND (cost.effective_to IS NULL OR cost.effective_to >= DATE '2026-10-31')
), november_catalog AS (
  SELECT COUNT(*) AS obligation_count
  FROM public.fixed_costs AS cost
  WHERE cost.effective_from <= DATE '2026-11-01'
    AND (cost.effective_to IS NULL OR cost.effective_to >= DATE '2026-11-01')
), manual_enforcement AS (
  SELECT COALESCE(
    BOOL_OR(PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%TG_OP = ''INSERT''%'),
    FALSE
  ) AS enabled
  FROM pg_proc AS procedure_row
  WHERE procedure_row.oid = TO_REGPROCEDURE('public.enforce_expense_concept_destination()')
), pending_classification AS (
  SELECT COUNT(*) AS expense_count,
    COALESCE(SUM(expense.amount_mxn), 0) AS amount_mxn
  FROM public.expenses AS expense
  WHERE expense.classification_status IS NULL
     OR expense.destination_scope = 'UNKNOWN'
), october_fixed_snapshot AS (
  SELECT COUNT(*) AS expense_count,
    COALESCE(SUM(expense.amount_mxn), 0) AS amount_mxn,
    COUNT(*) FILTER (WHERE expense.fixed_cost_id IS NOT NULL) AS linked_count,
    COUNT(*) FILTER (WHERE expense.amount_mxn = 1250) AS amount_1250_count
  FROM public.expenses AS expense
  WHERE expense.type::TEXT = 'FIXED'
    AND expense.expense_date BETWEEN DATE '2026-10-01' AND DATE '2026-10-31'
)
SELECT
  concept_constraint.passed
    AND october_catalog.obligation_count = 4
    AND november_catalog.obligation_count = 10
    AND NOT manual_enforcement.enabled AS structural_checks_passed,
  concept_constraint.passed AS payroll_and_rent_allowed,
  october_catalog.obligation_count AS october_effective_obligation_count,
  november_catalog.obligation_count AS november_effective_obligation_count,
  manual_enforcement.enabled AS manual_enforcement_enabled,
  pending_classification.expense_count AS pending_classification_count,
  pending_classification.amount_mxn AS pending_classification_amount_mxn,
  october_fixed_snapshot.expense_count AS october_fixed_expense_count,
  october_fixed_snapshot.amount_mxn AS october_fixed_expense_amount_mxn,
  october_fixed_snapshot.linked_count AS october_linked_fixed_expense_count,
  october_fixed_snapshot.amount_1250_count AS october_fixed_amount_1250_count
FROM concept_constraint
CROSS JOIN october_catalog
CROSS JOIN november_catalog
CROSS JOIN manual_enforcement
CROSS JOIN pending_classification
CROSS JOIN october_fixed_snapshot;
