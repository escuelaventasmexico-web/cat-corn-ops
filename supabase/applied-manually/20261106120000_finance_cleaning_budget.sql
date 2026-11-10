-- CAT CORN: independent monthly cleaning budget.
-- REVIEWED LOCALLY ONLY. Apply manually before publishing the matching UI.
-- This migration adds CLEANING to the prospective catalog, configures
-- November 2026 at MXN 350, and does not update or infer historical expenses.

BEGIN;

DO $preflight$
DECLARE
  v_concept_constraint TEXT;
BEGIN
  IF TO_REGPROCEDURE('public.finance_has_available_funds_access()') IS NULL THEN
    RAISE EXCEPTION 'Missing finance_has_available_funds_access(); apply the reviewed Finanzas access contract first';
  END IF;
  IF TO_REGCLASS('public.expenses') IS NULL THEN
    RAISE EXCEPTION 'Missing public.expenses';
  END IF;
  IF TO_REGCLASS('public.finance_month_cleaning_budgets') IS NOT NULL
     OR TO_REGPROCEDURE('public.finance_month_cleaning_budget(date,uuid)') IS NOT NULL
     OR TO_REGPROCEDURE('public.finance_set_month_cleaning_budget(date,numeric)') IS NOT NULL THEN
    RAISE EXCEPTION 'The cleaning-budget migration appears to be installed already; do not execute it twice';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'expenses'
      AND column_name IN (
        'id', 'expense_date', 'amount_mxn', 'concept_code',
        'classification_status', 'commission_settlement_id', 'payment_instrument'
      )
    GROUP BY table_schema, table_name
    HAVING COUNT(*) = 7
  ) THEN
    RAISE EXCEPTION 'expenses does not expose the reviewed classification and liquidity contract';
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
     OR v_concept_constraint NOT LIKE '%FUEL%'
     OR v_concept_constraint NOT LIKE '%SERVICES%'
     OR v_concept_constraint NOT LIKE '%PAYROLL%'
     OR v_concept_constraint NOT LIKE '%RENT%'
     OR v_concept_constraint NOT LIKE '%COMMISSIONS%'
     OR v_concept_constraint NOT LIKE '%OTHER%'
     OR v_concept_constraint LIKE '%CLEANING%' THEN
    RAISE EXCEPTION 'The deployed expense concept catalog differs from the reviewed pre-cleaning baseline';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
      AND trigger_row.tgname = 'enforce_expense_concept_destination_trigger'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'The reviewed expense-classification trigger is missing or disabled';
  END IF;

  IF HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
     OR HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE') THEN
    RAISE EXCEPTION 'commission_settlement_id is not protected as expected';
  END IF;
END;
$preflight$;

ALTER TABLE public.expenses
  DROP CONSTRAINT expenses_concept_code_check;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_concept_code_check CHECK (
    concept_code IS NULL OR concept_code IN (
      'CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING', 'STATIONERY',
      'CLEANING', 'FUEL', 'SERVICES', 'PAYROLL', 'RENT', 'COMMISSIONS', 'OTHER'
    )
  );

COMMENT ON COLUMN public.expenses.concept_code IS
  'Stable prospective expense concept, including CLEANING. NULL means pending human classification; no historical concept is inferred.';

CREATE TABLE public.finance_month_cleaning_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_start DATE NOT NULL UNIQUE,
  limit_mxn NUMERIC(12,2) NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT finance_month_cleaning_budget_month_start_check
    CHECK (month_start = DATE_TRUNC('month', month_start)::DATE),
  CONSTRAINT finance_month_cleaning_budget_limit_check
    CHECK (limit_mxn >= 0)
);

COMMENT ON TABLE public.finance_month_cleaning_budgets IS
  'Independent monthly cleaning limits. No limit is copied automatically to another month.';
COMMENT ON COLUMN public.finance_month_cleaning_budgets.limit_mxn IS
  'Limit for expenses explicitly classified with concept_code CLEANING in the month.';

CREATE OR REPLACE FUNCTION public.set_finance_cleaning_budget_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER finance_cleaning_budget_updated_at
BEFORE UPDATE ON public.finance_month_cleaning_budgets
FOR EACH ROW
EXECUTE FUNCTION public.set_finance_cleaning_budget_updated_at();

ALTER TABLE public.finance_month_cleaning_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY finance_cleaning_budget_select_authorized
ON public.finance_month_cleaning_budgets
FOR SELECT TO authenticated
USING (public.finance_has_available_funds_access());

REVOKE ALL ON TABLE public.finance_month_cleaning_budgets
  FROM PUBLIC, anon, authenticated;

-- Canonical calculation shared by the production RPC and read-only verifier.
-- A credit purchase is an expense and consumes budget at registration. Card
-- payments are stored elsewhere and are deliberately absent from this input.
CREATE OR REPLACE FUNCTION public.finance_calculate_cleaning_budget(
  p_limit_mxn NUMERIC,
  p_expenses JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $$
DECLARE
  v_expense JSONB;
  v_amount NUMERIC(12,2);
  v_used NUMERIC(12,2) := 0;
  v_matching_count INTEGER := 0;
  v_unclassified_count INTEGER := 0;
  v_unclassified_amount NUMERIC(12,2) := 0;
BEGIN
  IF p_expenses IS NOT NULL AND JSONB_TYPEOF(p_expenses) <> 'array' THEN
    RAISE EXCEPTION 'p_expenses must be a JSON array' USING ERRCODE = '22023';
  END IF;

  FOR v_expense IN
    SELECT value
    FROM JSONB_ARRAY_ELEMENTS(COALESCE(p_expenses, '[]'::JSONB)) AS rows(value)
  LOOP
    v_amount := COALESCE(NULLIF(v_expense->>'amount_mxn', '')::NUMERIC, 0);
    IF v_expense->>'concept_code' = 'CLEANING' THEN
      v_used := v_used + v_amount;
      v_matching_count := v_matching_count + 1;
    ELSIF v_expense->>'concept_code' IS NULL THEN
      v_unclassified_amount := v_unclassified_amount + v_amount;
      v_unclassified_count := v_unclassified_count + 1;
    END IF;
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'limit_mxn', p_limit_mxn,
    'warning_threshold_mxn', CASE WHEN p_limit_mxn IS NULL THEN NULL ELSE ROUND(p_limit_mxn * 0.80, 2) END,
    'used_mxn', v_used,
    'remaining_mxn', CASE WHEN p_limit_mxn IS NULL THEN NULL ELSE GREATEST(p_limit_mxn - v_used, 0) END,
    'exceeded_mxn', CASE WHEN p_limit_mxn IS NULL THEN 0 ELSE GREATEST(v_used - p_limit_mxn, 0) END,
    'matching_expense_count', v_matching_count,
    'unclassified_expenses', JSONB_BUILD_OBJECT(
      'count', v_unclassified_count,
      'amount_mxn', v_unclassified_amount
    ),
    'is_total_definitive', v_unclassified_count = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finance_calculate_cleaning_budget(NUMERIC, JSONB)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finance_month_cleaning_budget(
  p_month_start DATE,
  p_exclude_expense_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_month_start DATE := DATE_TRUNC('month', p_month_start)::DATE;
  v_limit NUMERIC(12,2);
  v_expenses JSONB := '[]'::JSONB;
BEGIN
  IF public.finance_has_available_funds_access() IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized to read finance cleaning budgets' USING ERRCODE = '42501';
  END IF;
  IF p_month_start IS NULL OR p_month_start <> v_month_start THEN
    RAISE EXCEPTION 'p_month_start must be the first day of a month' USING ERRCODE = '22023';
  END IF;

  SELECT budget.limit_mxn
  INTO v_limit
  FROM public.finance_month_cleaning_budgets AS budget
  WHERE budget.month_start = v_month_start;

  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'amount_mxn', expense.amount_mxn,
    'concept_code', expense.concept_code,
    'payment_instrument', expense.payment_instrument
  )), '[]'::JSONB)
  INTO v_expenses
  FROM public.expenses AS expense
  WHERE expense.expense_date >= v_month_start
    AND expense.expense_date < (v_month_start + INTERVAL '1 month')::DATE
    AND (p_exclude_expense_id IS NULL OR expense.id <> p_exclude_expense_id);

  RETURN public.finance_calculate_cleaning_budget(v_limit, v_expenses)
    || JSONB_BUILD_OBJECT('month_start', v_month_start);
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_set_month_cleaning_budget(
  p_month_start DATE,
  p_limit_mxn NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_month_start DATE := DATE_TRUNC('month', p_month_start)::DATE;
BEGIN
  IF public.finance_has_available_funds_access() IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized to edit finance cleaning budgets' USING ERRCODE = '42501';
  END IF;
  IF p_month_start IS NULL OR p_month_start <> v_month_start THEN
    RAISE EXCEPTION 'p_month_start must be the first day of a month' USING ERRCODE = '22023';
  END IF;
  IF p_limit_mxn IS NULL OR p_limit_mxn < 0 THEN
    RAISE EXCEPTION 'p_limit_mxn must be zero or greater' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.finance_month_cleaning_budgets (
    month_start, limit_mxn, created_by, updated_by
  ) VALUES (
    v_month_start, ROUND(p_limit_mxn, 2), auth.uid(), auth.uid()
  )
  ON CONFLICT (month_start) DO UPDATE
  SET limit_mxn = EXCLUDED.limit_mxn,
      updated_by = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.set_finance_cleaning_budget_updated_at()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_month_cleaning_budget(DATE, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_month_cleaning_budget(DATE, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.finance_set_month_cleaning_budget(DATE, NUMERIC)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_set_month_cleaning_budget(DATE, NUMERIC)
  TO authenticated;

-- Configuration only. An existing reviewed limit is never overwritten.
-- No expense row is inserted, updated, inferred, or reclassified.
INSERT INTO public.finance_month_cleaning_budgets (month_start, limit_mxn)
VALUES (DATE '2026-11-01', 350.00)
ON CONFLICT (month_start) DO NOTHING;

DO $postflight$
DECLARE
  v_constraint_definition TEXT;
BEGIN
  SELECT PG_GET_CONSTRAINTDEF(constraint_row.oid, TRUE)
  INTO v_constraint_definition
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.expenses'::REGCLASS
    AND constraint_row.conname = 'expenses_concept_code_check';

  IF v_constraint_definition NOT LIKE '%CLEANING%'
     OR NOT HAS_FUNCTION_PRIVILEGE(
       'authenticated', 'public.finance_month_cleaning_budget(date,uuid)', 'EXECUTE')
     OR NOT HAS_FUNCTION_PRIVILEGE(
       'authenticated', 'public.finance_set_month_cleaning_budget(date,numeric)', 'EXECUTE')
     OR HAS_TABLE_PRIVILEGE(
       'authenticated', 'public.finance_month_cleaning_budgets', 'SELECT')
     OR HAS_TABLE_PRIVILEGE(
       'authenticated', 'public.finance_month_cleaning_budgets', 'INSERT')
     OR HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
     OR HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE') THEN
    RAISE EXCEPTION 'Cleaning-budget postflight failed';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;
