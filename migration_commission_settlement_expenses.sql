-- Migration: automatic finance expense for paid commission settlements
-- IMPORTANT: create/review this migration here; execute it separately in Supabase.

BEGIN;

-- A nullable unique relationship keeps manual expenses unchanged while enforcing
-- at most one automatic expense for each commission settlement.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS commission_settlement_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expenses_commission_settlement_id_fkey'
      AND conrelid = 'public.expenses'::regclass
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_commission_settlement_id_fkey
      FOREIGN KEY (commission_settlement_id)
      REFERENCES public.commission_settlements(id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expenses_commission_settlement_id_key'
      AND conrelid = 'public.expenses'::regclass
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_commission_settlement_id_key
      UNIQUE (commission_settlement_id);
  END IF;
END;
$$;

COMMENT ON COLUMN public.expenses.commission_settlement_id IS
  'Commission settlement that generated this protected automatic expense.';

-- The trigger runs in the same transaction that confirms the settlement payment.
-- Any missing/unsupported accounting datum raises an exception and rolls back both.
CREATE OR REPLACE FUNCTION public.create_expense_for_paid_commission_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_vendor TEXT;
  v_expense_payment_method public.payment_method;
BEGIN
  IF NEW.status::TEXT IS DISTINCT FROM 'paid'
     OR OLD.status::TEXT = 'paid' THEN
    RETURN NEW;
  END IF;

  IF NEW.paid_at IS NULL THEN
    RAISE EXCEPTION
      'Cannot create commission expense: paid_at is missing for settlement %',
      NEW.id;
  END IF;

  IF NEW.total_amount IS NULL OR NEW.total_amount <= 0 THEN
    RAISE EXCEPTION
      'Cannot create commission expense: total_amount must be greater than zero for settlement %',
      NEW.id;
  END IF;

  IF NEW.folio IS NULL OR BTRIM(NEW.folio) = '' THEN
    RAISE EXCEPTION
      'Cannot create commission expense: folio is missing for settlement %',
      NEW.id;
  END IF;

  IF NEW.period_start IS NULL OR NEW.period_end IS NULL THEN
    RAISE EXCEPTION
      'Cannot create commission expense: commission period is missing for settlement %',
      NEW.id;
  END IF;

  SELECT NULLIF(BTRIM(up.full_name), '')
  INTO v_vendor
  FROM public.user_profiles AS up
  WHERE up.id = NEW.seller_id;

  IF v_vendor IS NULL THEN
    RAISE EXCEPTION
      'Cannot create commission expense: seller name is missing for settlement %',
      NEW.id;
  END IF;

  CASE LOWER(NEW.payment_method::TEXT)
    WHEN 'cash' THEN
      v_expense_payment_method := 'CASH'::public.payment_method;
    WHEN 'transfer' THEN
      v_expense_payment_method := 'TRANSFER'::public.payment_method;
    ELSE
      RAISE EXCEPTION
        'Cannot create commission expense: unsupported payment method % for settlement %',
        NEW.payment_method,
        NEW.id;
  END CASE;

  INSERT INTO public.expenses (
    expense_date,
    amount_mxn,
    type,
    category,
    vendor,
    has_invoice,
    payment_method,
    notes,
    fixed_cost_id,
    created_by,
    commission_settlement_id
  )
  VALUES (
    (NEW.paid_at AT TIME ZONE 'America/Mexico_City')::DATE,
    NEW.total_amount,
    'OTHER'::public.expense_type,
    'Comisiones',
    v_vendor,
    FALSE,
    v_expense_payment_method,
    FORMAT(
      'Liquidación de comisiones %s. Periodo %s–%s.',
      NEW.folio,
      NEW.period_start,
      NEW.period_end
    ),
    NULL,
    NEW.paid_by,
    NEW.id
  )
  ON CONFLICT ON CONSTRAINT expenses_commission_settlement_id_key
  DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commission_settlement_paid_expense_trigger
  ON public.commission_settlements;

CREATE TRIGGER commission_settlement_paid_expense_trigger
AFTER UPDATE OF status ON public.commission_settlements
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.create_expense_for_paid_commission_settlement();

-- Linked automatic expenses are accounting records owned by their settlement.
-- Existing manual expenses (NULL relationship) retain their current behavior.
CREATE OR REPLACE FUNCTION public.protect_commission_settlement_expense()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  IF OLD.commission_settlement_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Automatic commission expense % cannot be updated or deleted manually',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_commission_settlement_expense_trigger
  ON public.expenses;

CREATE TRIGGER protect_commission_settlement_expense_trigger
BEFORE UPDATE OR DELETE ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.protect_commission_settlement_expense();

-- Validate indispensable data before attempting the idempotent backfill. Only
-- paid, positive settlements with a real payment timestamp are candidates.
DO $$
DECLARE
  v_invalid_settlement_id UUID;
  v_invalid_reason TEXT;
BEGIN
  SELECT
    cs.id,
    CASE
      WHEN cs.payment_method IS NULL
        OR LOWER(cs.payment_method::TEXT) NOT IN ('cash', 'transfer')
        THEN 'unsupported payment method'
      WHEN up.id IS NULL OR NULLIF(BTRIM(up.full_name), '') IS NULL
        THEN 'missing seller name'
      WHEN cs.folio IS NULL OR BTRIM(cs.folio) = ''
        THEN 'missing folio'
      WHEN cs.period_start IS NULL OR cs.period_end IS NULL
        THEN 'missing commission period'
    END
  INTO v_invalid_settlement_id, v_invalid_reason
  FROM public.commission_settlements AS cs
  LEFT JOIN public.user_profiles AS up
    ON up.id = cs.seller_id
  WHERE cs.status::TEXT = 'paid'
    AND cs.paid_at IS NOT NULL
    AND cs.total_amount > 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.expenses AS e
      WHERE e.commission_settlement_id = cs.id
    )
    AND (
      cs.payment_method IS NULL
      OR LOWER(cs.payment_method::TEXT) NOT IN ('cash', 'transfer')
      OR up.id IS NULL
      OR NULLIF(BTRIM(up.full_name), '') IS NULL
      OR cs.folio IS NULL
      OR BTRIM(cs.folio) = ''
      OR cs.period_start IS NULL
      OR cs.period_end IS NULL
    )
  ORDER BY cs.paid_at, cs.id
  LIMIT 1;

  IF v_invalid_settlement_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot backfill commission expense: % for settlement %',
      v_invalid_reason,
      v_invalid_settlement_id;
  END IF;
END;
$$;

INSERT INTO public.expenses (
  expense_date,
  amount_mxn,
  type,
  category,
  vendor,
  has_invoice,
  payment_method,
  notes,
  fixed_cost_id,
  created_by,
  commission_settlement_id
)
SELECT
  (cs.paid_at AT TIME ZONE 'America/Mexico_City')::DATE,
  cs.total_amount,
  'OTHER'::public.expense_type,
  'Comisiones',
  BTRIM(up.full_name),
  FALSE,
  CASE LOWER(cs.payment_method::TEXT)
    WHEN 'cash' THEN 'CASH'::public.payment_method
    WHEN 'transfer' THEN 'TRANSFER'::public.payment_method
  END,
  FORMAT(
    'Liquidación de comisiones %s. Periodo %s–%s.',
    cs.folio,
    cs.period_start,
    cs.period_end
  ),
  NULL,
  cs.paid_by,
  cs.id
FROM public.commission_settlements AS cs
JOIN public.user_profiles AS up
  ON up.id = cs.seller_id
WHERE cs.status::TEXT = 'paid'
  AND cs.paid_at IS NOT NULL
  AND cs.total_amount > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.expenses AS existing_expense
    WHERE existing_expense.commission_settlement_id = cs.id
  )
ON CONFLICT ON CONSTRAINT expenses_commission_settlement_id_key
DO NOTHING;

COMMIT;
