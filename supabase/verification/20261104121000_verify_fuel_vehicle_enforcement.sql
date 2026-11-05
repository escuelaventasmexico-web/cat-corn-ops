-- READ-ONLY verification for the separately activated vehicle-enforcement step.
-- Historical/transition FUEL rows with NULL vehicle are reported but do not make
-- structural_checks_passed fail. This script performs no writes.

WITH checks AS (
  SELECT
    TO_REGPROCEDURE('public.enforce_expense_fuel_vehicle()') IS NOT NULL
      AS enforcement_function_exists,
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.expenses'::REGCLASS
        AND tgname = 'enforce_expense_fuel_vehicle_trigger'
        AND NOT tgisinternal AND tgenabled <> 'D'
    ) AS enforcement_trigger_enabled,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.enforce_expense_fuel_vehicle()'))
        LIKE '%TG_OP = ''INSERT''%'
    ), FALSE) AS new_insert_enforcement_present,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.enforce_expense_fuel_vehicle()'))
        LIKE '%OLD.fuel_vehicle_code IS NOT NULL%'
    ), FALSE) AS historical_null_edit_compatibility_present,
    COALESCE((
      SELECT PG_GET_FUNCTIONDEF(TO_REGPROCEDURE('public.enforce_expense_fuel_vehicle()'))
        LIKE '%NEW.fuel_vehicle_code := NULL%'
    ), FALSE) AS nonfuel_vehicle_is_cleared,
    NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
      AND NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE')
      AS commission_settlement_still_protected
), pending AS (
  SELECT
    COUNT(*) AS unassigned_fuel_count,
    COALESCE(SUM(amount_mxn), 0) AS unassigned_fuel_amount_mxn
  FROM public.expenses
  WHERE concept_code = 'FUEL' AND fuel_vehicle_code IS NULL
), invalid AS (
  SELECT COUNT(*) AS invalid_nonfuel_vehicle_count
  FROM public.expenses
  WHERE fuel_vehicle_code IS NOT NULL AND concept_code IS DISTINCT FROM 'FUEL'
)
SELECT
  checks.*,
  (checks.enforcement_function_exists
    AND checks.enforcement_trigger_enabled
    AND checks.new_insert_enforcement_present
    AND checks.historical_null_edit_compatibility_present
    AND checks.nonfuel_vehicle_is_cleared
    AND checks.commission_settlement_still_protected
    AND invalid.invalid_nonfuel_vehicle_count = 0
  ) AS structural_checks_passed,
  pending.unassigned_fuel_count,
  pending.unassigned_fuel_amount_mxn,
  pending.unassigned_fuel_count = 0 AS all_fuel_rows_classified,
  invalid.invalid_nonfuel_vehicle_count
FROM checks CROSS JOIN pending CROSS JOIN invalid;
