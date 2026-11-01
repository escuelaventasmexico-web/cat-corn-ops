-- REVIEWED LOCALLY ONLY. Apply manually before publishing the matching UI.
-- Expands the prospective concept catalog without changing any expense row.

BEGIN;

DO $preflight$
DECLARE
  v_constraint_definition TEXT;
BEGIN
  IF TO_REGCLASS('public.expenses') IS NULL
     OR TO_REGCLASS('public.fixed_costs') IS NULL THEN
    RAISE EXCEPTION 'Required finance tables are missing.';
  END IF;

  SELECT PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE)
  INTO v_constraint_definition
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_concept_code_check'
    AND constraint_row.contype = 'c';

  IF v_constraint_definition IS NULL
     OR v_constraint_definition NOT LIKE '%COMMISSIONS%'
     OR v_constraint_definition LIKE '%PAYROLL%'
     OR v_constraint_definition LIKE '%RENT%' THEN
    RAISE EXCEPTION 'The phase 1 concept constraint differs from the reviewed baseline.';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM public.fixed_costs AS cost
    WHERE cost.effective_from <= DATE '2026-10-31'
      AND (cost.effective_to IS NULL OR cost.effective_to >= DATE '2026-10-31')
  ) <> 4 THEN
    RAISE EXCEPTION 'The reviewed October catalog must expose exactly four historical obligations.';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM public.fixed_costs AS cost
    WHERE cost.effective_from <= DATE '2026-11-01'
      AND (cost.effective_to IS NULL OR cost.effective_to >= DATE '2026-11-01')
  ) <> 10 THEN
    RAISE EXCEPTION 'The reviewed November catalog must expose exactly ten new obligations.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid = TO_REGPROCEDURE('public.enforce_expense_concept_destination()')
      AND PG_GET_FUNCTIONDEF(procedure_row.oid) LIKE '%TG_OP = ''INSERT''%'
  ) THEN
    RAISE EXCEPTION 'Phase 2 manual enforcement is already enabled; review publication state first.';
  END IF;
END;
$preflight$;

ALTER TABLE public.expenses
  DROP CONSTRAINT expenses_concept_code_check;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_concept_code_check CHECK (
    concept_code IS NULL OR concept_code IN (
      'CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING', 'FUEL', 'SERVICES',
      'PAYROLL', 'RENT', 'COMMISSIONS', 'OTHER'
    )
  );

COMMENT ON COLUMN public.expenses.concept_code IS
  'Stable prospective concept, including PAYROLL and RENT. NULL means pending human classification.';

COMMIT;
