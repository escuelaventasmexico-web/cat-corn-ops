-- APPLIED MANUALLY IN SUPABASE — DO NOT EXECUTE AGAIN.
-- Archived outside supabase/migrations so automated migration discovery cannot
-- attempt to replay SQL Editor work that is absent from migration history.
-- Stage 1: monthly opening balance and company-wide available funds.
-- This migration is prospective. It does not update historical expenses and it
-- does not change finance_month_summary, P&L or fixed-cost obligation functions.

BEGIN;

DO $preflight$
BEGIN
  IF TO_REGCLASS('public.sales') IS NULL
     OR TO_REGCLASS('public.expenses') IS NULL
     OR TO_REGCLASS('public.v_b2b_confirmed_payments') IS NULL
     OR TO_REGCLASS('public.user_profiles') IS NULL THEN
    RAISE EXCEPTION 'The reviewed sales, expenses, B2B and user profile contracts are required.';
  END IF;

  IF TO_REGPROCEDURE('public.finance_month_summary(date)') IS NULL THEN
    RAISE EXCEPTION 'finance_month_summary(date) must exist and remains unchanged by this migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales'
      AND column_name = 'refunded_at'
  ) THEN
    RAISE EXCEPTION 'sales.refunded_at is required to recognize refund events after the opening balance.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'expenses'
      AND column_name IN ('liquidity_treatment', 'payment_instrument', 'credit_card_id')
  ) THEN
    RAISE EXCEPTION 'Available-funds expense columns already exist; inspect migration history before continuing.';
  END IF;
END;
$preflight$;

CREATE TABLE public.finance_month_opening_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_start DATE NOT NULL UNIQUE,
  amount_mxn NUMERIC(14,2) NOT NULL,
  cutoff_business_date DATE NOT NULL,
  notes TEXT,
  created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL DEFAULT auth.uid() REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT finance_opening_month_first_day_check
    CHECK (month_start = date_trunc('month', month_start)::DATE),
  CONSTRAINT finance_opening_cutoff_in_month_check
    CHECK (
      cutoff_business_date >= month_start
      AND cutoff_business_date < (month_start + INTERVAL '1 month')::DATE
    )
);

CREATE TABLE public.finance_credit_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT finance_credit_cards_name_not_blank CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX finance_credit_cards_name_unique
  ON public.finance_credit_cards (lower(btrim(name)));

CREATE TABLE public.finance_credit_card_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_card_id UUID NOT NULL REFERENCES public.finance_credit_cards(id) ON DELETE RESTRICT,
  amount_mxn NUMERIC(14,2) NOT NULL CHECK (amount_mxn > 0),
  payment_date DATE NOT NULL,
  payment_kind TEXT NOT NULL CHECK (payment_kind IN ('TOTAL', 'PARTIAL')),
  source_instrument TEXT NOT NULL CHECK (
    source_instrument IN ('CASH', 'TRANSFER', 'DEBIT_CARD', 'MERCADO_PAGO', 'OTHER')
  ),
  reference TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
  idempotency_key UUID NOT NULL UNIQUE,
  created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at TIMESTAMPTZ,
  reversed_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  reversal_reason TEXT,
  CONSTRAINT finance_card_payment_reversal_check CHECK (
    (status = 'POSTED' AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
    OR
    (status = 'REVERSED' AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
      AND reversal_reason IS NOT NULL AND btrim(reversal_reason) <> '')
  )
);

CREATE INDEX finance_credit_card_payments_date_idx
  ON public.finance_credit_card_payments (payment_date)
  WHERE status = 'POSTED';

CREATE TABLE public.finance_opening_day_movement_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opening_balance_id UUID NOT NULL
    REFERENCES public.finance_month_opening_balances(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'POS_SALE', 'ORDER_SALE', 'DELIVERY_SALE', 'POS_REFUND',
    'B2B_COMODATO', 'B2B_MAYOREO', 'B2B_VENTA_PIEZA',
    'EXPENSE', 'CREDIT_CARD_PAYMENT'
  )),
  source_id UUID NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('BEFORE_OPENING', 'AFTER_OPENING')),
  notes TEXT,
  decided_by UUID NOT NULL DEFAULT auth.uid()
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (opening_balance_id, source_type, source_id)
);

CREATE INDEX finance_opening_decisions_source_idx
  ON public.finance_opening_day_movement_decisions (opening_balance_id, source_type, source_id);

ALTER TABLE public.expenses
  ADD COLUMN liquidity_treatment TEXT,
  ADD COLUMN payment_instrument TEXT,
  ADD COLUMN credit_card_id UUID REFERENCES public.finance_credit_cards(id) ON DELETE RESTRICT;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_liquidity_treatment_check CHECK (
    liquidity_treatment IS NULL OR liquidity_treatment IN ('IMMEDIATE', 'CREDIT', 'PENDING')
  ),
  ADD CONSTRAINT expenses_payment_instrument_check CHECK (
    payment_instrument IS NULL OR payment_instrument IN (
      'CASH', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD', 'MERCADO_PAGO', 'OTHER'
    )
  ),
  ADD CONSTRAINT expenses_liquidity_consistency_check CHECK ((
    (liquidity_treatment IS NULL AND payment_instrument IS NULL AND credit_card_id IS NULL)
    OR
    (liquidity_treatment = 'PENDING' AND payment_instrument IS NULL AND credit_card_id IS NULL)
    OR
    (liquidity_treatment = 'IMMEDIATE'
      AND payment_instrument IN ('CASH', 'TRANSFER', 'DEBIT_CARD', 'MERCADO_PAGO', 'OTHER')
      AND credit_card_id IS NULL)
    OR
    (liquidity_treatment = 'CREDIT'
      AND payment_instrument = 'CREDIT_CARD'
      AND credit_card_id IS NOT NULL)
  ) IS TRUE);

CREATE INDEX expenses_liquidity_date_idx
  ON public.expenses (expense_date, liquidity_treatment)
  WHERE liquidity_treatment IS NOT NULL;

-- Phase 2 removed table-level INSERT/UPDATE and granted only reviewed manual
-- columns. Grant the three new columns explicitly without restoring access to
-- the protected commission_settlement_id column.
GRANT INSERT (liquidity_treatment, payment_instrument, credit_card_id),
      UPDATE (liquidity_treatment, payment_instrument, credit_card_id)
ON TABLE public.expenses TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_expense_liquidity_classification()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  -- The automatic commission writer is preserved. Its reviewed payment method
  -- is exact for CASH/TRANSFER; anything else remains explicitly pending.
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

  -- Compatibility window: old clients may omit these three columns while the
  -- migration is installed before the frontend. Such rows are visible as a
  -- blocking limitation; the new form never submits this state.
  IF NEW.liquidity_treatment IS NULL
     AND NEW.payment_instrument IS NULL
     AND NEW.credit_card_id IS NULL THEN
    RETURN NEW;
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

CREATE TRIGGER enforce_expense_liquidity_classification_trigger
BEFORE INSERT OR UPDATE OF
  payment_method, commission_settlement_id, liquidity_treatment, payment_instrument, credit_card_id
ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.enforce_expense_liquidity_classification();

CREATE OR REPLACE FUNCTION public.set_finance_opening_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF NEW.cutoff_business_date IS DISTINCT FROM OLD.cutoff_business_date
     AND EXISTS (
       SELECT 1 FROM public.finance_opening_day_movement_decisions decision
       WHERE decision.opening_balance_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'Remove or review same-day movement decisions before changing the cutoff date.';
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), OLD.updated_by);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_available_funds_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER finance_opening_balance_updated_at
BEFORE UPDATE ON public.finance_month_opening_balances
FOR EACH ROW EXECUTE FUNCTION public.set_finance_opening_updated_at();
CREATE TRIGGER finance_credit_cards_updated_at
BEFORE UPDATE ON public.finance_credit_cards
FOR EACH ROW EXECUTE FUNCTION public.set_available_funds_updated_at();
CREATE TRIGGER finance_opening_decisions_updated_at
BEFORE UPDATE ON public.finance_opening_day_movement_decisions
FOR EACH ROW EXECUTE FUNCTION public.set_available_funds_updated_at();

ALTER TABLE public.finance_month_opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_credit_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_credit_card_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_opening_day_movement_decisions ENABLE ROW LEVEL SECURITY;

-- The application grants the Finanzas module only to active admin profiles.
-- The secondary password unlock is intentionally in-memory and therefore is
-- not treated as a database authorization credential.
CREATE OR REPLACE FUNCTION public.finance_has_available_funds_access()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.role = 'admin'
      AND profile.is_active
  );
$$;

REVOKE ALL ON FUNCTION public.finance_has_available_funds_access()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_has_available_funds_access()
  TO authenticated;

CREATE POLICY finance_opening_select_authorized
ON public.finance_month_opening_balances FOR SELECT TO authenticated
USING (public.finance_has_available_funds_access());
CREATE POLICY finance_cards_select_authorized
ON public.finance_credit_cards FOR SELECT TO authenticated
USING (public.finance_has_available_funds_access());
CREATE POLICY finance_card_payments_select_authorized
ON public.finance_credit_card_payments FOR SELECT TO authenticated
USING (public.finance_has_available_funds_access());
CREATE POLICY finance_opening_decisions_select_authorized
ON public.finance_opening_day_movement_decisions FOR SELECT TO authenticated
USING (public.finance_has_available_funds_access());

CREATE POLICY finance_opening_insert_admin
ON public.finance_month_opening_balances FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 WHERE public.finance_has_available_funds_access()
));
CREATE POLICY finance_opening_update_admin
ON public.finance_month_opening_balances FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 WHERE public.finance_has_available_funds_access()
))
WITH CHECK (EXISTS (
  SELECT 1 WHERE public.finance_has_available_funds_access()
));
CREATE POLICY finance_cards_insert_admin
ON public.finance_credit_cards FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 WHERE public.finance_has_available_funds_access()
));
CREATE POLICY finance_cards_update_admin
ON public.finance_credit_cards FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 WHERE public.finance_has_available_funds_access()
))
WITH CHECK (EXISTS (
  SELECT 1 WHERE public.finance_has_available_funds_access()
));
CREATE POLICY finance_opening_decisions_insert_admin
ON public.finance_opening_day_movement_decisions FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 WHERE public.finance_has_available_funds_access()
));
CREATE POLICY finance_opening_decisions_update_admin
ON public.finance_opening_day_movement_decisions FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 WHERE public.finance_has_available_funds_access()
))
WITH CHECK (EXISTS (
  SELECT 1 WHERE public.finance_has_available_funds_access()
));

REVOKE ALL ON TABLE public.finance_month_opening_balances FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.finance_credit_cards FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.finance_credit_card_payments FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.finance_opening_day_movement_decisions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.finance_month_opening_balances TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.finance_credit_cards TO authenticated;
GRANT SELECT ON TABLE public.finance_credit_card_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.finance_opening_day_movement_decisions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.finance_credit_card_payments FROM authenticated;

DO $card_payment_privilege_postflight$
BEGIN
  IF NOT HAS_TABLE_PRIVILEGE(
       'authenticated', 'public.finance_credit_card_payments', 'SELECT')
     OR HAS_TABLE_PRIVILEGE(
       'authenticated', 'public.finance_credit_card_payments', 'INSERT')
     OR HAS_TABLE_PRIVILEGE(
       'authenticated', 'public.finance_credit_card_payments', 'UPDATE')
     OR HAS_TABLE_PRIVILEGE(
       'authenticated', 'public.finance_credit_card_payments', 'DELETE') THEN
    RAISE EXCEPTION 'Credit-card payments must be client-readable through RLS and writable only by reviewed RPCs.';
  END IF;
END;
$card_payment_privilege_postflight$;

CREATE OR REPLACE FUNCTION public.enforce_credit_card_payment_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.credit_card_id IS DISTINCT FROM OLD.credit_card_id
     OR NEW.amount_mxn IS DISTINCT FROM OLD.amount_mxn
     OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
     OR NEW.payment_kind IS DISTINCT FROM OLD.payment_kind
     OR NEW.source_instrument IS DISTINCT FROM OLD.source_instrument
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Posted card-payment facts are immutable; reverse and register a corrected payment.';
  END IF;

  IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED'
     AND NEW.reversed_at IS NOT NULL
     AND NEW.reversed_by IS NOT NULL
     AND NULLIF(btrim(NEW.reversal_reason), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'The only allowed card-payment change is a controlled POSTED to REVERSED transition.';
END;
$$;

CREATE TRIGGER enforce_credit_card_payment_history_trigger
BEFORE UPDATE ON public.finance_credit_card_payments
FOR EACH ROW EXECUTE FUNCTION public.enforce_credit_card_payment_history();

DO $expense_privilege_postflight$
BEGIN
  IF NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'liquidity_treatment', 'INSERT')
     OR NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'liquidity_treatment', 'UPDATE')
     OR NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'payment_instrument', 'INSERT')
     OR NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'payment_instrument', 'UPDATE')
     OR NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'credit_card_id', 'INSERT')
     OR NOT HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'credit_card_id', 'UPDATE') THEN
    RAISE EXCEPTION 'Authenticated clients lack one or more new liquidity-column privileges.';
  END IF;
  IF HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_settlement_id', 'INSERT')
     OR HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_settlement_id', 'UPDATE') THEN
    RAISE EXCEPTION 'Protected commission_settlement_id privileges were restored unexpectedly.';
  END IF;
END;
$expense_privilege_postflight$;

CREATE OR REPLACE FUNCTION public.finance_is_after_opening(
  p_opening_balance_id UUID,
  p_cutoff_business_date DATE,
  p_movement_business_date DATE,
  p_source_type TEXT,
  p_source_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN p_movement_business_date > p_cutoff_business_date THEN true
    WHEN p_movement_business_date < p_cutoff_business_date THEN false
    ELSE (
      SELECT decision.position = 'AFTER_OPENING'
      FROM public.finance_opening_day_movement_decisions decision
      WHERE decision.opening_balance_id = p_opening_balance_id
        AND decision.source_type = p_source_type
        AND decision.source_id = p_source_id
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.finance_is_after_opening(UUID, DATE, DATE, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finance_register_credit_card_payment(
  p_credit_card_id UUID,
  p_new_card_name TEXT,
  p_amount_mxn NUMERIC,
  p_payment_date DATE,
  p_payment_kind TEXT,
  p_source_instrument TEXT,
  p_reference TEXT,
  p_notes TEXT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_card_id UUID;
  v_payment_id UUID;
  v_existing public.finance_credit_card_payments%ROWTYPE;
  v_existing_card_name TEXT;
BEGIN
  IF NOT public.finance_has_available_funds_access() THEN
    RAISE EXCEPTION 'Authorized Finanzas access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_amount_mxn IS NULL OR p_amount_mxn <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;
  IF p_credit_card_id IS NOT NULL AND NULLIF(btrim(p_new_card_name), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Select an existing card or provide a new card name, not both.';
  END IF;

  -- Serialize retries for this token so a repeated request cannot create an
  -- orphan card before discovering that its payment already exists.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_idempotency_key::TEXT, 0)
  );

  SELECT payment.*
  INTO v_existing
  FROM public.finance_credit_card_payments payment
  WHERE payment.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    SELECT card.name INTO v_existing_card_name
    FROM public.finance_credit_cards card
    WHERE card.id = v_existing.credit_card_id;

    IF v_existing.amount_mxn IS DISTINCT FROM p_amount_mxn
       OR v_existing.payment_date IS DISTINCT FROM p_payment_date
       OR v_existing.payment_kind IS DISTINCT FROM p_payment_kind
       OR v_existing.source_instrument IS DISTINCT FROM p_source_instrument
       OR v_existing.reference IS DISTINCT FROM NULLIF(btrim(p_reference), '')
       OR v_existing.notes IS DISTINCT FROM NULLIF(btrim(p_notes), '')
       OR (p_credit_card_id IS NOT NULL AND v_existing.credit_card_id IS DISTINCT FROM p_credit_card_id)
       OR (NULLIF(btrim(p_new_card_name), '') IS NOT NULL
         AND lower(btrim(v_existing_card_name)) IS DISTINCT FROM lower(btrim(p_new_card_name))) THEN
      RAISE EXCEPTION 'The idempotency token was already used with different payment data.';
    END IF;
    RETURN jsonb_build_object(
      'credit_card_id', v_existing.credit_card_id,
      'payment_id', v_existing.id
    );
  END IF;

  IF p_credit_card_id IS NOT NULL THEN
    SELECT card.id INTO v_card_id
    FROM public.finance_credit_cards card
    WHERE card.id = p_credit_card_id AND card.active;
    IF v_card_id IS NULL THEN RAISE EXCEPTION 'The selected credit card is unavailable.'; END IF;
  ELSE
    IF NULLIF(btrim(p_new_card_name), '') IS NULL THEN
      RAISE EXCEPTION 'A credit card or new card name is required.';
    END IF;
    SELECT card.id INTO v_card_id
    FROM public.finance_credit_cards card
    WHERE lower(btrim(card.name)) = lower(btrim(p_new_card_name));
    IF v_card_id IS NULL THEN
      INSERT INTO public.finance_credit_cards (name)
      VALUES (btrim(p_new_card_name))
      RETURNING id INTO v_card_id;
    END IF;
  END IF;

  INSERT INTO public.finance_credit_card_payments (
    credit_card_id, amount_mxn, payment_date, payment_kind,
    source_instrument, reference, notes, idempotency_key
  ) VALUES (
    v_card_id, p_amount_mxn, p_payment_date, p_payment_kind,
    p_source_instrument, NULLIF(btrim(p_reference), ''),
    NULLIF(btrim(p_notes), ''), p_idempotency_key
  )
  RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object('credit_card_id', v_card_id, 'payment_id', v_payment_id);
END;
$$;

REVOKE ALL ON FUNCTION public.finance_register_credit_card_payment(
  UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_register_credit_card_payment(
  UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_reverse_credit_card_payment(
  p_payment_id UUID,
  p_reversal_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_payment public.finance_credit_card_payments%ROWTYPE;
BEGIN
  IF NOT public.finance_has_available_funds_access() THEN
    RAISE EXCEPTION 'Authorized Finanzas access is required.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_reversal_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reversal reason is required.';
  END IF;

  SELECT payment.* INTO v_payment
  FROM public.finance_credit_card_payments payment
  WHERE payment.id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit-card payment not found.';
  END IF;
  IF v_payment.status = 'REVERSED' THEN
    RETURN jsonb_build_object(
      'payment_id', v_payment.id,
      'status', v_payment.status,
      'reversed_at', v_payment.reversed_at,
      'already_reversed', true
    );
  END IF;

  UPDATE public.finance_credit_card_payments payment
  SET status = 'REVERSED',
      reversed_at = clock_timestamp(),
      reversed_by = auth.uid(),
      reversal_reason = btrim(p_reversal_reason)
  WHERE payment.id = v_payment.id
  RETURNING payment.* INTO v_payment;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'status', v_payment.status,
    'reversed_at', v_payment.reversed_at,
    'already_reversed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finance_reverse_credit_card_payment(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_reverse_credit_card_payment(UUID, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_month_available_funds(p_month_start DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_month_end DATE;
  v_opening_id UUID;
  v_cutoff_date DATE;
  v_opening_amount NUMERIC := 0;
  v_opening_notes TEXT;
  v_pos NUMERIC := 0;
  v_b2b NUMERIC := 0;
  v_expenses NUMERIC := 0;
  v_card_payments NUMERIC := 0;
  v_credit_purchases NUMERIC := 0;
  v_pending_count INTEGER := 0;
  v_pending_amount NUMERIC := 0;
  v_refund_count INTEGER := 0;
  v_refund_amount NUMERIC := 0;
  v_order_count INTEGER := 0;
  v_order_amount NUMERIC := 0;
  v_delivery_count INTEGER := 0;
  v_delivery_amount NUMERIC := 0;
  v_unsupported_count INTEGER := 0;
  v_unsupported_amount NUMERIC := 0;
  v_ambiguous_count INTEGER := 0;
  v_ambiguous_amount NUMERIC := 0;
  v_ambiguous_movements JSONB := '[]'::JSONB;
  v_known NUMERIC;
  v_exact BOOLEAN;
BEGIN
  IF NOT public.finance_has_available_funds_access() THEN
    RAISE EXCEPTION 'Authorized Finanzas access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_month_start IS NULL OR p_month_start <> date_trunc('month', p_month_start)::DATE THEN
    RAISE EXCEPTION 'p_month_start must be the first day of a month.';
  END IF;

  v_month_end := (p_month_start + INTERVAL '1 month')::DATE;
  SELECT opening.id, opening.amount_mxn, opening.cutoff_business_date, opening.notes
  INTO v_opening_id, v_opening_amount, v_cutoff_date, v_opening_notes
  FROM public.finance_month_opening_balances opening
  WHERE opening.month_start = p_month_start;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'month_start', p_month_start, 'status', 'MISSING_OPENING', 'is_exact', false,
      'opening_balance', NULL, 'known_available_mxn', NULL, 'available_mxn', NULL,
      'inflows', jsonb_build_object('pos_collections_mxn', 0, 'b2b_collections_mxn', 0),
      'outflows', jsonb_build_object('immediate_expenses_mxn', 0, 'credit_card_payments_mxn', 0),
      'informational', jsonb_build_object('credit_purchases_mxn', 0),
      'ambiguous_movements', '[]'::JSONB,
      'limitations', '{}'::JSONB
    );
  END IF;
  SELECT
    COALESCE(SUM(CASE upper(sale.payment_method::TEXT)
      WHEN 'CASH' THEN sale.total
      WHEN 'CARD' THEN COALESCE(NULLIF(sale.card_amount, 0), sale.total)
      WHEN 'TRANSFER' THEN COALESCE(NULLIF(sale.transfer_amount, 0), sale.total)
      WHEN 'MIXED' THEN COALESCE(sale.cash_amount, 0) + COALESCE(sale.card_amount, 0) + COALESCE(sale.transfer_amount, 0)
      ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE upper(sale.payment_method::TEXT) NOT IN ('CASH','CARD','TRANSFER','MIXED')),
    COALESCE(SUM(sale.total) FILTER (WHERE upper(sale.payment_method::TEXT) NOT IN ('CASH','CARD','TRANSFER','MIXED')), 0)
  INTO v_pos, v_unsupported_count, v_unsupported_amount
  FROM public.sales sale
  WHERE (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE < v_month_end
    AND public.finance_is_after_opening(
      v_opening_id, v_cutoff_date,
      (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE,
      'POS_SALE', sale.id
    ) IS TRUE
    AND lower(COALESCE(sale.sale_origin, 'pos')) = 'pos';

  SELECT COUNT(*), COALESCE(SUM(sale.total), 0)
  INTO v_order_count, v_order_amount
  FROM public.sales sale
  WHERE (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE < v_month_end
    AND public.finance_is_after_opening(
      v_opening_id, v_cutoff_date,
      (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE,
      'ORDER_SALE', sale.id
    ) IS TRUE
    AND lower(COALESCE(sale.sale_origin, 'pos')) = 'order';

  SELECT COUNT(*), COALESCE(SUM(sale.total), 0)
  INTO v_delivery_count, v_delivery_amount
  FROM public.sales sale
  WHERE (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE < v_month_end
    AND public.finance_is_after_opening(
      v_opening_id, v_cutoff_date,
      (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE,
      'DELIVERY_SALE', sale.id
    ) IS TRUE
    AND lower(COALESCE(sale.sale_origin, 'pos')) = 'delivery';

  -- Refunds are events in their own right. A November refund of an October
  -- sale is still detected from refunded_at. Missing refund timestamps require
  -- an explicit opening-day decision before the balance can be exact.
  SELECT COUNT(*), COALESCE(SUM(sale.total), 0)
  INTO v_refund_count, v_refund_amount
  FROM public.sales sale
  WHERE COALESCE(sale.is_refunded, false)
    AND (
      (
        sale.refunded_at IS NOT NULL
        AND (sale.refunded_at AT TIME ZONE 'America/Mexico_City')::DATE < v_month_end
        AND public.finance_is_after_opening(
          v_opening_id, v_cutoff_date,
          (sale.refunded_at AT TIME ZONE 'America/Mexico_City')::DATE,
          'POS_REFUND', sale.id
        ) IS TRUE
      )
      OR (
        sale.refunded_at IS NULL
        AND EXISTS (
          SELECT 1 FROM public.finance_opening_day_movement_decisions decision
          WHERE decision.opening_balance_id = v_opening_id
            AND decision.source_type = 'POS_REFUND'
            AND decision.source_id = sale.id
            AND decision.position = 'AFTER_OPENING'
        )
      )
    );

  SELECT COALESCE(SUM(payment.amount), 0)
  INTO v_b2b
  FROM public.v_b2b_confirmed_payments payment
  WHERE payment.business_date < v_month_end
    AND public.finance_is_after_opening(
      v_opening_id, v_cutoff_date, payment.business_date,
      CASE payment.source_type
        WHEN 'comodato' THEN 'B2B_COMODATO'
        WHEN 'mayoreo' THEN 'B2B_MAYOREO'
        ELSE 'B2B_VENTA_PIEZA'
      END,
      payment.id
    ) IS TRUE;

  SELECT
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.liquidity_treatment = 'IMMEDIATE'), 0),
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.liquidity_treatment = 'CREDIT'), 0),
    COUNT(*) FILTER (
      WHERE expense.liquidity_treatment IS NULL OR expense.liquidity_treatment = 'PENDING'),
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.liquidity_treatment IS NULL OR expense.liquidity_treatment = 'PENDING'), 0)
  INTO v_expenses, v_credit_purchases, v_pending_count, v_pending_amount
  FROM public.expenses expense
  WHERE expense.expense_date < v_month_end
    AND public.finance_is_after_opening(
      v_opening_id, v_cutoff_date, expense.expense_date, 'EXPENSE', expense.id
    ) IS TRUE;

  SELECT COALESCE(SUM(payment.amount_mxn), 0)
  INTO v_card_payments
  FROM public.finance_credit_card_payments payment
  WHERE payment.status = 'POSTED'
    AND payment.payment_date < v_month_end
    AND public.finance_is_after_opening(
      v_opening_id, v_cutoff_date, payment.payment_date,
      'CREDIT_CARD_PAYMENT', payment.id
    ) IS TRUE;

  WITH cutoff_movements AS (
    SELECT
      CASE lower(COALESCE(sale.sale_origin, 'pos'))
        WHEN 'order' THEN 'ORDER_SALE'
        WHEN 'delivery' THEN 'DELIVERY_SALE'
        ELSE 'POS_SALE'
      END AS source_type,
      sale.id AS source_id,
      (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE AS business_date,
      sale.total::NUMERIC AS amount_mxn,
      CASE lower(COALESCE(sale.sale_origin, 'pos'))
        WHEN 'pos' THEN 'INFLOW' ELSE 'LIMITATION'
      END AS direction,
      concat('Venta ', COALESCE(sale.sale_origin, 'pos'), ' · ', sale.payment_method::TEXT) AS label
    FROM public.sales sale
    WHERE (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE = v_cutoff_date

    UNION ALL
    SELECT
      CASE payment.source_type
        WHEN 'comodato' THEN 'B2B_COMODATO'
        WHEN 'mayoreo' THEN 'B2B_MAYOREO'
        ELSE 'B2B_VENTA_PIEZA'
      END,
      payment.id,
      payment.business_date,
      payment.amount,
      'INFLOW',
      concat('Cobranza B2B · ', payment.source_type)
    FROM public.v_b2b_confirmed_payments payment
    WHERE payment.business_date = v_cutoff_date

    UNION ALL
    SELECT
      'EXPENSE', expense.id, expense.expense_date, expense.amount_mxn,
      CASE expense.liquidity_treatment
        WHEN 'IMMEDIATE' THEN 'OUTFLOW'
        WHEN 'CREDIT' THEN 'LIABILITY'
        ELSE 'LIMITATION'
      END,
      concat('Gasto · ', COALESCE(expense.vendor, expense.concept_code, expense.category, 'sin descripción'))
    FROM public.expenses expense
    WHERE expense.expense_date = v_cutoff_date

    UNION ALL
    SELECT
      'CREDIT_CARD_PAYMENT', payment.id, payment.payment_date, payment.amount_mxn,
      'OUTFLOW', concat('Pago de tarjeta · ', card.name)
    FROM public.finance_credit_card_payments payment
    JOIN public.finance_credit_cards card ON card.id = payment.credit_card_id
    WHERE payment.status = 'POSTED' AND payment.payment_date = v_cutoff_date

    UNION ALL
    SELECT
      'POS_REFUND', sale.id,
      COALESCE((sale.refunded_at AT TIME ZONE 'America/Mexico_City')::DATE, v_cutoff_date),
      sale.total, 'LIMITATION',
      CASE WHEN sale.refunded_at IS NULL
        THEN 'Devolución POS sin fecha efectiva'
        ELSE 'Devolución POS'
      END
    FROM public.sales sale
    WHERE COALESCE(sale.is_refunded, false)
      AND (
        sale.refunded_at IS NULL
        OR (sale.refunded_at AT TIME ZONE 'America/Mexico_City')::DATE = v_cutoff_date
      )
  ), unresolved AS (
    SELECT movement.*
    FROM cutoff_movements movement
    LEFT JOIN public.finance_opening_day_movement_decisions decision
      ON decision.opening_balance_id = v_opening_id
      AND decision.source_type = movement.source_type
      AND decision.source_id = movement.source_id
    WHERE decision.id IS NULL
  )
  SELECT
    COUNT(*),
    COALESCE(SUM(amount_mxn), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'source_type', source_type,
      'source_id', source_id,
      'business_date', business_date,
      'amount_mxn', amount_mxn,
      'direction', direction,
      'label', label
    ) ORDER BY source_type, source_id), '[]'::JSONB)
  INTO v_ambiguous_count, v_ambiguous_amount, v_ambiguous_movements
  FROM unresolved;

  v_known := round((v_opening_amount + v_pos + v_b2b - v_expenses - v_card_payments)::NUMERIC, 2);
  v_exact := v_pending_count = 0 AND v_refund_count = 0 AND v_order_count = 0
    AND v_delivery_count = 0 AND v_unsupported_count = 0 AND v_ambiguous_count = 0;

  RETURN jsonb_build_object(
    'month_start', p_month_start,
    'status', CASE WHEN v_exact THEN 'EXACT' ELSE 'INCOMPLETE' END,
    'is_exact', v_exact,
    'opening_balance', jsonb_build_object(
      'id', v_opening_id, 'amount_mxn', v_opening_amount,
      'cutoff_business_date', v_cutoff_date, 'notes', v_opening_notes),
    'inflows', jsonb_build_object(
      'pos_collections_mxn', round(v_pos, 2), 'b2b_collections_mxn', round(v_b2b, 2)),
    'outflows', jsonb_build_object(
      'immediate_expenses_mxn', round(v_expenses, 2),
      'credit_card_payments_mxn', round(v_card_payments, 2)),
    'informational', jsonb_build_object('credit_purchases_mxn', round(v_credit_purchases, 2)),
    'known_available_mxn', v_known,
    'available_mxn', CASE WHEN v_exact THEN v_known ELSE NULL END,
    'ambiguous_movements', v_ambiguous_movements,
    'limitations', jsonb_build_object(
      'ambiguous_cutoff_movements', jsonb_build_object(
        'count', v_ambiguous_count, 'amount_mxn', round(v_ambiguous_amount, 2)),
      'pending_expenses', jsonb_build_object('count', v_pending_count, 'amount_mxn', round(v_pending_amount, 2)),
      'refunded_pos_sales', jsonb_build_object('count', v_refund_count, 'amount_mxn', round(v_refund_amount, 2)),
      'order_sales', jsonb_build_object('count', v_order_count, 'amount_mxn', round(v_order_amount, 2)),
      'delivery_sales', jsonb_build_object('count', v_delivery_count, 'amount_mxn', round(v_delivery_amount, 2)),
      'unsupported_pos_payments', jsonb_build_object('count', v_unsupported_count, 'amount_mxn', round(v_unsupported_amount, 2))
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finance_month_available_funds(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_month_available_funds(DATE) TO authenticated;

COMMENT ON TABLE public.finance_month_opening_balances IS
  'User-entered company liquidity on cutoff_business_date. Same-day movements require explicit BEFORE/AFTER decisions.';
COMMENT ON TABLE public.finance_opening_day_movement_decisions IS
  'Explicit reconciliation of same-day movements against the opening balance; capture timestamps are never used as a proxy.';
COMMENT ON TABLE public.finance_credit_card_payments IS
  'Immutable actual total/partial credit-card cash outflows. Corrections use an audited reversal; these rows do not enter expenses or P&L.';
COMMENT ON COLUMN public.expenses.liquidity_treatment IS
  'IMMEDIATE reduces available funds; CREDIT creates an obligation without immediate outflow; NULL/PENDING blocks an exact balance.';
COMMENT ON FUNCTION public.finance_month_available_funds(DATE) IS
  'Stage-1 liquidity only. Does not replace sales, P&L or fixed-cost obligation metrics.';

NOTIFY pgrst, 'reload schema';

COMMIT;
