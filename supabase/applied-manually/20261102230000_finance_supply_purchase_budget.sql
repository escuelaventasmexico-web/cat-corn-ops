-- CAT CORN: monthly supply-purchase budget.
-- APPLIED MANUALLY IN SUPABASE: do not execute this migration again.
-- It configures November 2026 at MXN 10,000 without changing any expense.

BEGIN;

DO $$
BEGIN
  IF TO_REGPROCEDURE('public.finance_has_available_funds_access()') IS NULL THEN
    RAISE EXCEPTION 'Missing finance_has_available_funds_access(); apply the reviewed Finanzas access contract first';
  END IF;

  IF TO_REGCLASS('public.expenses') IS NULL THEN
    RAISE EXCEPTION 'Missing public.expenses';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'expenses'
      AND column_name IN ('expense_date', 'amount_mxn', 'concept_code', 'destination_scope')
    GROUP BY table_schema, table_name
    HAVING COUNT(*) = 4
  ) THEN
    RAISE EXCEPTION 'expenses does not expose the reviewed classification contract';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.finance_month_supply_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_start DATE NOT NULL UNIQUE,
  limit_mxn NUMERIC(12,2) NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT finance_month_supply_budget_month_start_check
    CHECK (month_start = DATE_TRUNC('month', month_start)::DATE),
  CONSTRAINT finance_month_supply_budget_limit_check
    CHECK (limit_mxn >= 0)
);

COMMENT ON TABLE public.finance_month_supply_budgets IS
  'One editable global supply-purchase limit per month. This is separate from P&L, fixed obligations, and available funds.';
COMMENT ON COLUMN public.finance_month_supply_budgets.limit_mxn IS
  'Global limit for CORN, OIL, SEASONINGS, CARAMEL, and PACKAGING expenses registered in the month.';

CREATE OR REPLACE FUNCTION public.set_finance_supply_budget_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_supply_budget_updated_at
  ON public.finance_month_supply_budgets;
CREATE TRIGGER finance_supply_budget_updated_at
BEFORE UPDATE ON public.finance_month_supply_budgets
FOR EACH ROW
EXECUTE FUNCTION public.set_finance_supply_budget_updated_at();

ALTER TABLE public.finance_month_supply_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_supply_budget_select_authorized
  ON public.finance_month_supply_budgets;
CREATE POLICY finance_supply_budget_select_authorized
ON public.finance_month_supply_budgets
FOR SELECT TO authenticated
USING (public.finance_has_available_funds_access());

REVOKE ALL ON TABLE public.finance_month_supply_budgets FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finance_month_supply_budget(
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
  v_used NUMERIC(12,2) := 0;
  v_aurrera NUMERIC(12,2) := 0;
  v_chipitlan NUMERIC(12,2) := 0;
  v_shared NUMERIC(12,2) := 0;
  v_unassigned NUMERIC(12,2) := 0;
  v_matching_count INTEGER := 0;
  v_unassigned_count INTEGER := 0;
  v_potential_supply_count INTEGER := 0;
  v_potential_supply_amount NUMERIC(12,2) := 0;
  v_confirmed_non_supply_count INTEGER := 0;
  v_confirmed_non_supply_amount NUMERIC(12,2) := 0;
BEGIN
  IF public.finance_has_available_funds_access() IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized to read finance supply budgets' USING ERRCODE = '42501';
  END IF;

  IF p_month_start IS NULL OR p_month_start <> v_month_start THEN
    RAISE EXCEPTION 'p_month_start must be the first day of a month' USING ERRCODE = '22023';
  END IF;

  SELECT budget.limit_mxn
  INTO v_limit
  FROM public.finance_month_supply_budgets budget
  WHERE budget.month_start = v_month_start;

  SELECT
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
    ), 0),
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
        AND expense.destination_scope = 'AURRERA'
    ), 0),
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
        AND expense.destination_scope = 'CHIPITLAN'
    ), 0),
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
        AND expense.destination_scope = 'SHARED'
    ), 0),
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
        AND (
          expense.destination_scope IS NULL
          OR expense.destination_scope NOT IN ('AURRERA', 'CHIPITLAN', 'SHARED')
        )
    ), 0),
    COUNT(*) FILTER (
      WHERE expense.concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
    ),
    COUNT(*) FILTER (
      WHERE expense.concept_code IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
        AND (
          expense.destination_scope IS NULL
          OR expense.destination_scope NOT IN ('AURRERA', 'CHIPITLAN', 'SHARED')
        )
    ),
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.concept_code IS NULL
    ), 0),
    COUNT(*) FILTER (
      WHERE expense.concept_code IS NULL
    ),
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.concept_code IS NOT NULL
        AND expense.concept_code NOT IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
    ), 0),
    COUNT(*) FILTER (
      WHERE expense.concept_code IS NOT NULL
        AND expense.concept_code NOT IN ('CORN', 'OIL', 'SEASONINGS', 'CARAMEL', 'PACKAGING')
    )
  INTO
    v_used,
    v_aurrera,
    v_chipitlan,
    v_shared,
    v_unassigned,
    v_matching_count,
    v_unassigned_count,
    v_potential_supply_amount,
    v_potential_supply_count,
    v_confirmed_non_supply_amount,
    v_confirmed_non_supply_count
  FROM public.expenses expense
  WHERE expense.expense_date >= v_month_start
    AND expense.expense_date < (v_month_start + INTERVAL '1 month')::DATE
    AND (p_exclude_expense_id IS NULL OR expense.id <> p_exclude_expense_id);

  RETURN JSONB_BUILD_OBJECT(
    'month_start', v_month_start,
    'limit_mxn', v_limit,
    'warning_threshold_mxn', CASE WHEN v_limit IS NULL THEN NULL ELSE ROUND(v_limit * 0.80, 2) END,
    'used_mxn', v_used,
    'remaining_mxn', CASE WHEN v_limit IS NULL THEN NULL ELSE GREATEST(v_limit - v_used, 0) END,
    'exceeded_mxn', CASE WHEN v_limit IS NULL THEN 0 ELSE GREATEST(v_used - v_limit, 0) END,
    'usage_by_destination', JSONB_BUILD_OBJECT(
      'AURRERA', v_aurrera,
      'CHIPITLAN', v_chipitlan,
      'SHARED', v_shared,
      'UNASSIGNED', v_unassigned
    ),
    'matching_expense_count', v_matching_count,
    'unassigned_supply', JSONB_BUILD_OBJECT(
      'count', v_unassigned_count,
      'amount_mxn', v_unassigned
    ),
    'potential_supply_unclassified', JSONB_BUILD_OBJECT(
      'count', v_potential_supply_count,
      'amount_mxn', v_potential_supply_amount
    ),
    'confirmed_non_supply', JSONB_BUILD_OBJECT(
      'count', v_confirmed_non_supply_count,
      'amount_mxn', v_confirmed_non_supply_amount
    ),
    'is_total_definitive', v_potential_supply_count = 0,
    'is_destination_breakdown_complete', v_unassigned_count = 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_set_month_supply_budget(
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
    RAISE EXCEPTION 'Not authorized to edit finance supply budgets' USING ERRCODE = '42501';
  END IF;

  IF p_month_start IS NULL OR p_month_start <> v_month_start THEN
    RAISE EXCEPTION 'p_month_start must be the first day of a month' USING ERRCODE = '22023';
  END IF;

  IF p_limit_mxn IS NULL OR p_limit_mxn < 0 THEN
    RAISE EXCEPTION 'p_limit_mxn must be zero or greater' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.finance_month_supply_budgets (
    month_start,
    limit_mxn,
    created_by,
    updated_by
  ) VALUES (
    v_month_start,
    ROUND(p_limit_mxn, 2),
    auth.uid(),
    auth.uid()
  )
  ON CONFLICT (month_start) DO UPDATE
  SET limit_mxn = EXCLUDED.limit_mxn,
      updated_by = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.finance_month_supply_budget(DATE, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_month_supply_budget(DATE, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.finance_set_month_supply_budget(DATE, NUMERIC)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_set_month_supply_budget(DATE, NUMERIC)
  TO authenticated;

-- Configuration only. No expense row is inserted, updated, inferred, or reclassified.
INSERT INTO public.finance_month_supply_budgets (month_start, limit_mxn)
VALUES (DATE '2026-11-01', 10000.00)
ON CONFLICT (month_start) DO NOTHING;

COMMIT;
