-- ACTIVATION STEP — DO NOT APPLY BEFORE THE VEHICLE-AWARE EXPENSE FORM IS
-- PUBLISHED AND VERIFIED. Keep this file outside supabase/migrations.
-- This changes no historical row. It rejects only new FUEL expenses without a
-- vehicle and invalid attempts to clear or introduce an unassigned vehicle.

BEGIN;

DO $preflight$
BEGIN
  IF TO_REGPROCEDURE('public.finance_month_fuel_budget(date,uuid)') IS NULL
     OR TO_REGPROCEDURE('public.finance_calculate_fuel_budget(numeric,numeric,numeric,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Apply and verify the compatible fuel-budget base first.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'expenses'
      AND column_name = 'fuel_vehicle_code'
  ) THEN
    RAISE EXCEPTION 'expenses.fuel_vehicle_code is missing.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
      AND trigger_row.tgname = 'enforce_expense_fuel_vehicle_trigger'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'Fuel vehicle enforcement is already enabled; do not run twice.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.enforce_expense_fuel_vehicle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.concept_code IS DISTINCT FROM 'FUEL' THEN
    NEW.fuel_vehicle_code := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.fuel_vehicle_code IS NULL
       OR NEW.fuel_vehicle_code NOT IN ('UTILITY', 'MANAGERIAL') THEN
      RAISE EXCEPTION 'New FUEL expenses require fuel_vehicle_code UTILITY or MANAGERIAL.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.fuel_vehicle_code IS NULL
        AND (
          OLD.concept_code IS DISTINCT FROM 'FUEL'
          OR OLD.fuel_vehicle_code IS NOT NULL
        ) THEN
    RAISE EXCEPTION 'A new FUEL classification requires a vehicle and an existing vehicle assignment cannot be cleared.'
      USING ERRCODE = '23514';
  END IF;

  -- Existing FUEL rows that were already NULL remain editable without inventing
  -- a vehicle. They continue to count once in the global unassigned bucket.
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_expense_fuel_vehicle_trigger
BEFORE INSERT OR UPDATE OF concept_code, fuel_vehicle_code
ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.enforce_expense_fuel_vehicle();

COMMENT ON FUNCTION public.enforce_expense_fuel_vehicle() IS
  'Activation-stage enforcement for new FUEL expenses. Historical FUEL rows already lacking a vehicle remain editable and unassigned.';

NOTIFY pgrst, 'reload schema';
COMMIT;
