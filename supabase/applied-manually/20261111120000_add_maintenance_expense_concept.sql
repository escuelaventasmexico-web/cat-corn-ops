-- CAT CORN: add the stable MAINTENANCE expense concept.
-- REVIEWED LOCALLY ONLY. Apply manually before publishing the matching UI.
-- This migration only expands the prospective catalog. It does not update,
-- infer or reclassify any historical expense.

BEGIN;

DO $preflight$
DECLARE
  v_concept_constraint TEXT;
BEGIN
  IF TO_REGCLASS('public.expenses') IS NULL THEN
    RAISE EXCEPTION 'Missing public.expenses';
  END IF;

  SELECT PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE)
  INTO v_concept_constraint
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_concept_code_check'
    AND constraint_row.contype = 'c';

  IF v_concept_constraint IS NULL
     OR v_concept_constraint NOT LIKE '%CORN%'
     OR v_concept_constraint NOT LIKE '%OIL%'
     OR v_concept_constraint NOT LIKE '%SEASONINGS%'
     OR v_concept_constraint NOT LIKE '%CARAMEL%'
     OR v_concept_constraint NOT LIKE '%PACKAGING%'
     OR v_concept_constraint NOT LIKE '%STATIONERY%'
     OR v_concept_constraint NOT LIKE '%CLEANING%'
     OR v_concept_constraint NOT LIKE '%FUEL%'
     OR v_concept_constraint NOT LIKE '%SERVICES%'
     OR v_concept_constraint NOT LIKE '%PAYROLL%'
     OR v_concept_constraint NOT LIKE '%RENT%'
     OR v_concept_constraint NOT LIKE '%COMMISSIONS%'
     OR v_concept_constraint NOT LIKE '%OTHER%'
     OR v_concept_constraint LIKE '%MAINTENANCE%' THEN
    RAISE EXCEPTION 'The deployed expense concept catalog differs from the reviewed pre-maintenance baseline or MAINTENANCE is already installed';
  END IF;

  IF TO_REGPROCEDURE('public.enforce_expense_concept_destination()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
         AND trigger_row.tgname = 'enforce_expense_concept_destination_trigger'
         AND NOT trigger_row.tgisinternal
         AND trigger_row.tgenabled <> 'D'
     ) THEN
    RAISE EXCEPTION 'The deployed manual-classification enforcement contract is missing';
  END IF;

  IF HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
     OR HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE')
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
         AND trigger_row.tgname = 'protect_commission_settlement_expense_trigger'
         AND NOT trigger_row.tgisinternal
         AND trigger_row.tgenabled <> 'D'
     ) THEN
    RAISE EXCEPTION 'The protected commission-expense contract differs from the reviewed baseline';
  END IF;
END;
$preflight$;

ALTER TABLE public.expenses
  DROP CONSTRAINT expenses_concept_code_check;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_concept_code_check CHECK (
    concept_code IS NULL OR concept_code IN (
      'CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING', 'STATIONERY',
      'CLEANING', 'FUEL', 'SERVICES', 'MAINTENANCE', 'PAYROLL', 'RENT',
      'COMMISSIONS', 'OTHER'
    )
  );

COMMENT ON COLUMN public.expenses.concept_code IS
  'Stable prospective expense concept, including MAINTENANCE. NULL means pending human classification; no historical concept is inferred.';

DO $postflight$
DECLARE
  v_concept_constraint TEXT;
BEGIN
  SELECT PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE)
  INTO v_concept_constraint
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_concept_code_check'
    AND constraint_row.contype = 'c';

  IF v_concept_constraint IS NULL
     OR v_concept_constraint NOT LIKE '%MAINTENANCE%' THEN
    RAISE EXCEPTION 'MAINTENANCE was not installed in the stable expense concept catalog';
  END IF;

  IF HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
     OR HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE') THEN
    RAISE EXCEPTION 'Authenticated clients gained write access to commission_settlement_id';
  END IF;
END;
$postflight$;

COMMIT;
