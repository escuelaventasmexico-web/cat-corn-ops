-- CAT CORN: monthly fuel budget by vehicle — compatible base stage.
-- APPLIED MANUALLY IN SUPABASE: do not execute this migration again.
-- The compatible base was applied before publishing the vehicle-aware form.
-- During the transition, new FUEL expenses may keep fuel_vehicle_code NULL;
-- they are reported as "Sin vehículo asignado" and count once globally.
-- This migration does not update, infer, or reclassify any historical expense.

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
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'expenses'
      AND column_name IN (
        'id', 'expense_date', 'amount_mxn', 'concept_code',
        'classification_status', 'commission_settlement_id', 'payment_instrument'
      )
    GROUP BY table_schema, table_name
    HAVING COUNT(*) = 7
  ) THEN
    RAISE EXCEPTION 'expenses does not expose the reviewed classification and liquidity contract';
  END IF;
END;
$$;

ALTER TABLE public.expenses
  ADD COLUMN fuel_vehicle_code TEXT;

-- NULL remains valid in this compatibility stage. The later activation stage
-- enforces a vehicle only for new FUEL rows and preserves legacy NULL rows.
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_fuel_vehicle_code_check CHECK (
    fuel_vehicle_code IS NULL
    OR (
      concept_code = 'FUEL'
      AND fuel_vehicle_code IN ('UTILITY', 'MANAGERIAL')
    )
  );

COMMENT ON COLUMN public.expenses.fuel_vehicle_code IS
  'Stable vehicle identifier for FUEL expenses: UTILITY or MANAGERIAL. Transition and historical FUEL rows may remain NULL and are reported as unassigned.';

CREATE INDEX expenses_fuel_budget_month_idx
  ON public.expenses (expense_date, fuel_vehicle_code)
  WHERE concept_code = 'FUEL';

-- Preserve the column-level permission model used by manual capture. This does
-- not grant commission_settlement_id.
GRANT INSERT (fuel_vehicle_code), UPDATE (fuel_vehicle_code)
  ON TABLE public.expenses TO authenticated;

CREATE TABLE public.finance_month_fuel_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_start DATE NOT NULL UNIQUE,
  global_limit_mxn NUMERIC(12,2) NOT NULL,
  utility_limit_mxn NUMERIC(12,2) NOT NULL,
  managerial_limit_mxn NUMERIC(12,2) NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT finance_month_fuel_budget_month_start_check
    CHECK (month_start = DATE_TRUNC('month', month_start)::DATE),
  CONSTRAINT finance_month_fuel_budget_limits_nonnegative_check
    CHECK (
      global_limit_mxn >= 0
      AND utility_limit_mxn >= 0
      AND managerial_limit_mxn >= 0
    ),
  CONSTRAINT finance_month_fuel_budget_allocation_check
    CHECK (global_limit_mxn = utility_limit_mxn + managerial_limit_mxn)
);

COMMENT ON TABLE public.finance_month_fuel_budgets IS
  'Independent monthly fuel limits. No limit is copied automatically to another month.';

CREATE OR REPLACE FUNCTION public.set_finance_fuel_budget_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER finance_fuel_budget_updated_at
BEFORE UPDATE ON public.finance_month_fuel_budgets
FOR EACH ROW
EXECUTE FUNCTION public.set_finance_fuel_budget_updated_at();

ALTER TABLE public.finance_month_fuel_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY finance_fuel_budget_select_authorized
ON public.finance_month_fuel_budgets
FOR SELECT TO authenticated
USING (public.finance_has_available_funds_access());

REVOKE ALL ON TABLE public.finance_month_fuel_budgets
  FROM PUBLIC, anon, authenticated;

-- Canonical calculation used by the production RPC and by the read-only
-- verifier. Only concept_code=FUEL is counted. payment_instrument deliberately
-- does not filter rows: a credit purchase consumes budget when registered.
CREATE OR REPLACE FUNCTION public.finance_calculate_fuel_budget(
  p_global_limit_mxn NUMERIC,
  p_utility_limit_mxn NUMERIC,
  p_managerial_limit_mxn NUMERIC,
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
  v_vehicle TEXT;
  v_used NUMERIC(12,2) := 0;
  v_utility_used NUMERIC(12,2) := 0;
  v_managerial_used NUMERIC(12,2) := 0;
  v_unassigned_used NUMERIC(12,2) := 0;
  v_matching_count INTEGER := 0;
  v_unassigned_count INTEGER := 0;
BEGIN
  IF p_expenses IS NOT NULL AND JSONB_TYPEOF(p_expenses) <> 'array' THEN
    RAISE EXCEPTION 'p_expenses must be a JSON array' USING ERRCODE = '22023';
  END IF;

  FOR v_expense IN
    SELECT value
    FROM JSONB_ARRAY_ELEMENTS(COALESCE(p_expenses, '[]'::JSONB)) AS rows(value)
  LOOP
    IF v_expense->>'concept_code' IS DISTINCT FROM 'FUEL' THEN
      CONTINUE;
    END IF;

    v_amount := COALESCE(NULLIF(v_expense->>'amount_mxn', '')::NUMERIC, 0);
    v_vehicle := v_expense->>'fuel_vehicle_code';
    v_used := v_used + v_amount;
    v_matching_count := v_matching_count + 1;

    IF v_vehicle = 'UTILITY' THEN
      v_utility_used := v_utility_used + v_amount;
    ELSIF v_vehicle = 'MANAGERIAL' THEN
      v_managerial_used := v_managerial_used + v_amount;
    ELSE
      v_unassigned_used := v_unassigned_used + v_amount;
      v_unassigned_count := v_unassigned_count + 1;
    END IF;
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'global_limit_mxn', p_global_limit_mxn,
    'warning_threshold_mxn', CASE WHEN p_global_limit_mxn IS NULL THEN NULL ELSE ROUND(p_global_limit_mxn * 0.80, 2) END,
    'used_mxn', v_used,
    'remaining_mxn', CASE WHEN p_global_limit_mxn IS NULL THEN NULL ELSE GREATEST(p_global_limit_mxn - v_used, 0) END,
    'exceeded_mxn', CASE WHEN p_global_limit_mxn IS NULL THEN 0 ELSE GREATEST(v_used - p_global_limit_mxn, 0) END,
    'vehicle_limits_mxn', JSONB_BUILD_OBJECT(
      'UTILITY', p_utility_limit_mxn,
      'MANAGERIAL', p_managerial_limit_mxn
    ),
    'usage_by_vehicle', JSONB_BUILD_OBJECT(
      'UTILITY', v_utility_used,
      'MANAGERIAL', v_managerial_used,
      'UNASSIGNED', v_unassigned_used
    ),
    'vehicle_status', JSONB_BUILD_OBJECT(
      'UTILITY', JSONB_BUILD_OBJECT(
        'limit_mxn', p_utility_limit_mxn,
        'warning_threshold_mxn', CASE WHEN p_utility_limit_mxn IS NULL THEN NULL ELSE ROUND(p_utility_limit_mxn * 0.80, 2) END,
        'used_mxn', v_utility_used,
        'remaining_mxn', CASE WHEN p_utility_limit_mxn IS NULL THEN NULL ELSE GREATEST(p_utility_limit_mxn - v_utility_used, 0) END,
        'exceeded_mxn', CASE WHEN p_utility_limit_mxn IS NULL THEN 0 ELSE GREATEST(v_utility_used - p_utility_limit_mxn, 0) END
      ),
      'MANAGERIAL', JSONB_BUILD_OBJECT(
        'limit_mxn', p_managerial_limit_mxn,
        'warning_threshold_mxn', CASE WHEN p_managerial_limit_mxn IS NULL THEN NULL ELSE ROUND(p_managerial_limit_mxn * 0.80, 2) END,
        'used_mxn', v_managerial_used,
        'remaining_mxn', CASE WHEN p_managerial_limit_mxn IS NULL THEN NULL ELSE GREATEST(p_managerial_limit_mxn - v_managerial_used, 0) END,
        'exceeded_mxn', CASE WHEN p_managerial_limit_mxn IS NULL THEN 0 ELSE GREATEST(v_managerial_used - p_managerial_limit_mxn, 0) END
      )
    ),
    'matching_expense_count', v_matching_count,
    'unassigned_vehicle', JSONB_BUILD_OBJECT(
      'count', v_unassigned_count,
      'amount_mxn', v_unassigned_used
    ),
    'is_vehicle_breakdown_complete', v_unassigned_count = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finance_calculate_fuel_budget(NUMERIC, NUMERIC, NUMERIC, JSONB)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finance_month_fuel_budget(
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
  v_global_limit NUMERIC(12,2);
  v_utility_limit NUMERIC(12,2);
  v_managerial_limit NUMERIC(12,2);
  v_expenses JSONB := '[]'::JSONB;
BEGIN
  IF public.finance_has_available_funds_access() IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized to read finance fuel budgets' USING ERRCODE = '42501';
  END IF;

  IF p_month_start IS NULL OR p_month_start <> v_month_start THEN
    RAISE EXCEPTION 'p_month_start must be the first day of a month' USING ERRCODE = '22023';
  END IF;

  SELECT budget.global_limit_mxn, budget.utility_limit_mxn, budget.managerial_limit_mxn
  INTO v_global_limit, v_utility_limit, v_managerial_limit
  FROM public.finance_month_fuel_budgets budget
  WHERE budget.month_start = v_month_start;

  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'amount_mxn', expense.amount_mxn,
    'concept_code', expense.concept_code,
    'fuel_vehicle_code', expense.fuel_vehicle_code,
    'payment_instrument', expense.payment_instrument
  )), '[]'::JSONB)
  INTO v_expenses
  FROM public.expenses expense
  WHERE expense.expense_date >= v_month_start
    AND expense.expense_date < (v_month_start + INTERVAL '1 month')::DATE
    AND (p_exclude_expense_id IS NULL OR expense.id <> p_exclude_expense_id);

  RETURN public.finance_calculate_fuel_budget(
    v_global_limit, v_utility_limit, v_managerial_limit, v_expenses
  ) || JSONB_BUILD_OBJECT('month_start', v_month_start);
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_set_month_fuel_budget(
  p_month_start DATE,
  p_global_limit_mxn NUMERIC,
  p_utility_limit_mxn NUMERIC,
  p_managerial_limit_mxn NUMERIC
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
    RAISE EXCEPTION 'Not authorized to edit finance fuel budgets' USING ERRCODE = '42501';
  END IF;
  IF p_month_start IS NULL OR p_month_start <> v_month_start THEN
    RAISE EXCEPTION 'p_month_start must be the first day of a month' USING ERRCODE = '22023';
  END IF;
  IF p_global_limit_mxn IS NULL OR p_global_limit_mxn < 0
     OR p_utility_limit_mxn IS NULL OR p_utility_limit_mxn < 0
     OR p_managerial_limit_mxn IS NULL OR p_managerial_limit_mxn < 0 THEN
    RAISE EXCEPTION 'Fuel limits must be zero or greater' USING ERRCODE = '22023';
  END IF;
  IF ROUND(p_global_limit_mxn, 2)
     <> ROUND(p_utility_limit_mxn, 2) + ROUND(p_managerial_limit_mxn, 2) THEN
    RAISE EXCEPTION 'Global fuel limit must equal the two vehicle limits' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.finance_month_fuel_budgets (
    month_start, global_limit_mxn, utility_limit_mxn, managerial_limit_mxn,
    created_by, updated_by
  ) VALUES (
    v_month_start, ROUND(p_global_limit_mxn, 2), ROUND(p_utility_limit_mxn, 2),
    ROUND(p_managerial_limit_mxn, 2), auth.uid(), auth.uid()
  )
  ON CONFLICT (month_start) DO UPDATE
  SET global_limit_mxn = EXCLUDED.global_limit_mxn,
      utility_limit_mxn = EXCLUDED.utility_limit_mxn,
      managerial_limit_mxn = EXCLUDED.managerial_limit_mxn,
      updated_by = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.finance_month_fuel_budget(DATE, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_month_fuel_budget(DATE, UUID)
  TO authenticated;
REVOKE ALL ON FUNCTION public.finance_set_month_fuel_budget(DATE, NUMERIC, NUMERIC, NUMERIC)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_set_month_fuel_budget(DATE, NUMERIC, NUMERIC, NUMERIC)
  TO authenticated;

-- Configuration only. Existing limits are never overwritten by this seed.
-- No expense row is inserted, updated, inferred, or reclassified.
INSERT INTO public.finance_month_fuel_budgets (
  month_start, global_limit_mxn, utility_limit_mxn, managerial_limit_mxn
) VALUES (DATE '2026-11-01', 1000.00, 600.00, 400.00)
ON CONFLICT (month_start) DO NOTHING;

DO $postflight$
BEGIN
  IF NOT HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'fuel_vehicle_code', 'INSERT')
     OR NOT HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'fuel_vehicle_code', 'UPDATE') THEN
    RAISE EXCEPTION 'Authenticated manual expense capture cannot write fuel_vehicle_code.';
  END IF;
  IF HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
     OR HAS_COLUMN_PRIVILEGE(
       'authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE') THEN
    RAISE EXCEPTION 'Fuel budget migration must not expose commission_settlement_id.';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
