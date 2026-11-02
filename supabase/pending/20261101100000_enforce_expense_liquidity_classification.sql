-- ACTIVATION STEP — DO NOT APPLY BEFORE THE NEW EXPENSE FORM IS DEPLOYED.
-- This changes no historical row. It only rejects future manual inserts that
-- omit the stage-1 liquidity contract. Automatic commission expenses remain
-- classified from their reviewed CASH/TRANSFER settlement payment method.

BEGIN;

DO $preflight$
DECLARE
  v_definition TEXT;
BEGIN
  IF TO_REGPROCEDURE('public.finance_month_available_funds(date)') IS NULL
     OR TO_REGPROCEDURE('public.enforce_expense_liquidity_classification()') IS NULL THEN
    RAISE EXCEPTION 'Install and verify available-funds stage 1 first.';
  END IF;

  SELECT PG_GET_FUNCTIONDEF(procedure_row.oid)
  INTO v_definition
  FROM pg_proc procedure_row
  WHERE procedure_row.oid = TO_REGPROCEDURE('public.enforce_expense_liquidity_classification()');

  IF v_definition LIKE '%TG_OP = ''INSERT''%' THEN
    RAISE EXCEPTION 'Manual liquidity enforcement is already enabled; do not run twice.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.expenses'::REGCLASS
      AND trigger_row.tgname = 'enforce_expense_liquidity_classification_trigger'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'The stage-1 liquidity trigger is missing or disabled.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.enforce_expense_liquidity_classification()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.commission_settlement_id IS NOT NULL THEN
    IF upper(NEW.payment_method::TEXT) = 'CASH' THEN
      NEW.liquidity_treatment := 'IMMEDIATE';
      NEW.payment_instrument := 'CASH';
      NEW.credit_card_id := NULL;
    ELSIF upper(NEW.payment_method::TEXT) = 'TRANSFER' THEN
      NEW.liquidity_treatment := 'IMMEDIATE';
      NEW.payment_instrument := 'TRANSFER';
      NEW.credit_card_id := NULL;
    ELSE
      NEW.liquidity_treatment := 'PENDING';
      NEW.payment_instrument := NULL;
      NEW.credit_card_id := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.liquidity_treatment IS NULL
     AND NEW.payment_instrument IS NULL
     AND NEW.credit_card_id IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'New manual expenses require payment instrument and liquidity treatment.';
    END IF;
    RETURN NEW; -- historical pending rows remain intact
  END IF;

  IF NEW.liquidity_treatment = 'IMMEDIATE' THEN
    IF NEW.payment_instrument IS NULL OR NEW.payment_instrument = 'CREDIT_CARD'
       OR NEW.credit_card_id IS NOT NULL THEN
      RAISE EXCEPTION 'An immediate expense requires a non-credit payment instrument and no credit card.';
    END IF;
  ELSIF NEW.liquidity_treatment = 'CREDIT' THEN
    IF NEW.payment_instrument IS DISTINCT FROM 'CREDIT_CARD' OR NEW.credit_card_id IS NULL THEN
      RAISE EXCEPTION 'A credit purchase requires CREDIT_CARD and its card identifier.';
    END IF;
  ELSIF NEW.liquidity_treatment = 'PENDING' THEN
    IF NEW.payment_instrument IS NOT NULL OR NEW.credit_card_id IS NOT NULL THEN
      RAISE EXCEPTION 'A pending liquidity classification cannot claim a payment instrument.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Select whether the expense was paid immediately or bought on credit.';
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
