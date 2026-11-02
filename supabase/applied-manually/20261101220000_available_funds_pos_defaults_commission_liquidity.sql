-- REVIEW ONLY — DO NOT EXECUTE AUTOMATICALLY.
-- Stage 1 follow-up: one POS opening-day decision with per-sale exceptions,
-- automatic commission liquidity, and an audited correction for the existing
-- Gerardo $100 cash commission expense already marked AFTER_OPENING.

BEGIN;

DO $preflight$
DECLARE
  v_candidate_count INTEGER;
  v_opening_id UUID;
  v_pos_before_count INTEGER;
BEGIN
  IF TO_REGCLASS('public.finance_month_opening_balances') IS NULL
     OR TO_REGCLASS('public.finance_opening_day_movement_decisions') IS NULL
     OR TO_REGCLASS('public.expenses') IS NULL
     OR TO_REGCLASS('public.commission_settlements') IS NULL
     OR TO_REGPROCEDURE('public.finance_month_available_funds(date)') IS NULL
     OR TO_REGPROCEDURE('public.finance_is_after_opening(uuid,date,date,text,uuid)') IS NULL
     OR TO_REGPROCEDURE('public.enforce_expense_concept_destination()') IS NULL
     OR TO_REGPROCEDURE('public.enforce_expense_liquidity_classification()') IS NULL THEN
    RAISE EXCEPTION 'The reviewed stage-1 liquidity and commission contracts are required.';
  END IF;

  IF TO_REGCLASS('public.finance_opening_day_source_defaults') IS NOT NULL
     OR TO_REGCLASS('public.finance_expense_liquidity_adjustments') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'expenses'
         AND column_name = 'commission_origin_scope'
     ) THEN
    RAISE EXCEPTION 'This follow-up appears installed already; inspect the live schema before continuing.';
  END IF;

  SELECT opening.id INTO v_opening_id
  FROM public.finance_month_opening_balances opening
  WHERE opening.month_start = DATE '2026-11-01'
    AND opening.amount_mxn = 10010
    AND opening.cutoff_business_date = DATE '2026-11-01';
  IF v_opening_id IS NULL THEN
    RAISE EXCEPTION 'The reviewed November opening balance ($10,010 on 2026-11-01) was not found.';
  END IF;

  SELECT COUNT(*) INTO v_pos_before_count
  FROM public.finance_opening_day_movement_decisions decision
  WHERE decision.opening_balance_id = v_opening_id
    AND decision.source_type = 'POS_SALE'
    AND decision.position = 'BEFORE_OPENING';
  IF v_pos_before_count > 0 THEN
    RAISE EXCEPTION 'At least one November opening-day POS sale is explicitly BEFORE_OPENING; review before setting the joint AFTER rule.';
  END IF;

  SELECT COUNT(*) INTO v_candidate_count
  FROM public.expenses expense
  JOIN public.commission_settlements settlement
    ON settlement.id = expense.commission_settlement_id
  JOIN public.finance_opening_day_movement_decisions decision
    ON decision.opening_balance_id = v_opening_id
    AND decision.source_type = 'EXPENSE'
    AND decision.source_id = expense.id
    AND decision.position = 'AFTER_OPENING'
  WHERE expense.expense_date = DATE '2026-11-01'
    AND expense.amount_mxn = 100
    AND upper(expense.payment_method::TEXT) = 'CASH'
    AND expense.concept_code = 'COMMISSIONS'
    AND expense.commission_settlement_id IS NOT NULL
    AND COALESCE(expense.liquidity_treatment, 'PENDING') = 'PENDING';
  IF v_candidate_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one reviewed $100 cash commission expense marked AFTER_OPENING; found %.', v_candidate_count;
  END IF;
END;
$preflight$;

CREATE TABLE public.finance_opening_day_source_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opening_balance_id UUID NOT NULL
    REFERENCES public.finance_month_opening_balances(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('POS_SALE')),
  position TEXT NOT NULL CHECK (position IN ('BEFORE_OPENING', 'AFTER_OPENING')),
  notes TEXT,
  decided_by UUID NOT NULL DEFAULT auth.uid()
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (opening_balance_id, source_type)
);

CREATE TABLE public.finance_expense_liquidity_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE RESTRICT,
  liquidity_treatment TEXT NOT NULL CHECK (liquidity_treatment IN ('IMMEDIATE', 'PENDING')),
  payment_instrument TEXT CHECK (payment_instrument IN ('CASH', 'TRANSFER')),
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  idempotency_key UUID NOT NULL UNIQUE,
  created_by UUID DEFAULT auth.uid() REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_by_role TEXT NOT NULL DEFAULT current_user,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT finance_expense_liquidity_adjustment_consistency CHECK (
    (liquidity_treatment = 'IMMEDIATE' AND payment_instrument IS NOT NULL)
    OR (liquidity_treatment = 'PENDING' AND payment_instrument IS NULL)
  )
);
CREATE INDEX finance_expense_liquidity_adjustments_latest_idx
  ON public.finance_expense_liquidity_adjustments (expense_id, created_at DESC, id DESC);

ALTER TABLE public.expenses
  ADD COLUMN commission_origin_scope TEXT;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_commission_origin_scope_check CHECK (
    commission_origin_scope IS NULL
    OR commission_origin_scope IN ('AURRERA', 'CHIPITLAN', 'MIXED', 'UNKNOWN')
  );

ALTER TABLE public.expenses
  DROP CONSTRAINT expenses_classification_consistency_check;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_classification_consistency_check CHECK ((
    (classification_status IS NULL AND concept_code IS NULL
      AND destination_scope IS NULL AND commission_origin_scope IS NULL)
    OR
    (classification_status = 'CLASSIFIED' AND concept_code IS NOT NULL
      AND destination_scope IN ('AURRERA', 'CHIPITLAN', 'SHARED')
      AND commission_origin_scope IS NULL)
    OR
    (classification_status = 'SYSTEM'
      AND commission_settlement_id IS NOT NULL
      AND concept_code = 'COMMISSIONS'
      AND (
        (destination_scope = 'SHARED'
          AND commission_origin_scope IN ('AURRERA', 'CHIPITLAN', 'MIXED', 'UNKNOWN'))
        OR
        (commission_origin_scope IS NULL
          AND destination_scope IN ('AURRERA', 'CHIPITLAN', 'MIXED', 'UNKNOWN'))
      ))
  ) IS TRUE);

CREATE OR REPLACE FUNCTION public.enforce_expense_concept_destination()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO ''
AS $$
DECLARE
  v_fixed_scope TEXT;
  v_commission_event_count INTEGER;
  v_unresolved_event_count INTEGER;
  v_resolved_destination_count INTEGER;
  v_single_destination TEXT;
BEGIN
  IF NEW.commission_settlement_id IS NOT NULL THEN
    SELECT COUNT(*), COUNT(*) FILTER (WHERE resolved.destination_scope IS NULL),
      COUNT(DISTINCT resolved.destination_scope), MIN(resolved.destination_scope)
    INTO v_commission_event_count, v_unresolved_event_count,
      v_resolved_destination_count, v_single_destination
    FROM (
      SELECT CASE branch.code
        WHEN 'aurrera_la_luna_02' THEN 'AURRERA'
        WHEN 'chipitlan_01' THEN 'CHIPITLAN'
        ELSE NULL
      END AS destination_scope
      FROM public.commission_settlement_items AS item
      JOIN public.commission_events AS event ON event.id = item.commission_event_id
      LEFT JOIN public.sales AS sale
        ON event.source_type = 'pos_sale' AND sale.id = event.source_id
      LEFT JOIN public.branches AS branch ON branch.id = sale.branch_id
      WHERE item.settlement_id = NEW.commission_settlement_id
    ) AS resolved;

    NEW.concept_code := 'COMMISSIONS';
    NEW.destination_scope := 'SHARED';
    NEW.commission_origin_scope := CASE
      WHEN v_commission_event_count = 0 OR v_unresolved_event_count > 0 THEN 'UNKNOWN'
      WHEN v_resolved_destination_count = 1 THEN v_single_destination
      ELSE 'MIXED'
    END;
    NEW.classification_status := 'SYSTEM';
    RETURN NEW;
  END IF;

  NEW.commission_origin_scope := NULL;
  IF NEW.classification_status IS NULL AND NEW.concept_code IS NULL
     AND NEW.destination_scope IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'New manual expenses require concept and destination.';
    END IF;
    IF NEW.type IS DISTINCT FROM OLD.type
       OR NEW.expense_date IS DISTINCT FROM OLD.expense_date
       OR NEW.fixed_cost_id IS DISTINCT FROM OLD.fixed_cost_id THEN
      RAISE EXCEPTION 'Classify this legacy expense before changing type, date or fixed-cost obligation.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.classification_status IS DISTINCT FROM 'CLASSIFIED' OR NEW.concept_code IS NULL THEN
    RAISE EXCEPTION 'Manual expenses require a complete concept and destination classification.';
  END IF;

  IF NEW.fixed_cost_id IS NOT NULL THEN
    SELECT cost.scope INTO v_fixed_scope
    FROM public.fixed_costs AS cost
    WHERE cost.id = NEW.fixed_cost_id AND cost.effective_from <= NEW.expense_date
      AND (cost.effective_to IS NULL OR cost.effective_to >= NEW.expense_date);
    IF v_fixed_scope IS NULL OR v_fixed_scope NOT IN ('AURRERA', 'CHIPITLAN', 'SHARED') THEN
      RAISE EXCEPTION 'The selected fixed-cost obligation has no valid destination for this expense date.';
    END IF;
    NEW.destination_scope := v_fixed_scope;
  ELSIF NEW.destination_scope IS NULL
     OR NEW.destination_scope NOT IN ('AURRERA', 'CHIPITLAN', 'SHARED') THEN
    RAISE EXCEPTION 'Manual expenses require AURRERA, CHIPITLAN or SHARED as destination.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER enforce_expense_concept_destination_trigger ON public.expenses;
CREATE TRIGGER enforce_expense_concept_destination_trigger
BEFORE INSERT OR UPDATE OF
  type, expense_date, fixed_cost_id, commission_settlement_id,
  concept_code, destination_scope, classification_status, commission_origin_scope
ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.enforce_expense_concept_destination();

CREATE OR REPLACE FUNCTION public.finance_is_after_opening(
  p_opening_balance_id UUID,
  p_cutoff_business_date DATE,
  p_movement_business_date DATE,
  p_source_type TEXT,
  p_source_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT CASE
    WHEN p_movement_business_date > p_cutoff_business_date THEN true
    WHEN p_movement_business_date < p_cutoff_business_date THEN false
    ELSE COALESCE(
      (SELECT decision.position = 'AFTER_OPENING'
       FROM public.finance_opening_day_movement_decisions decision
       WHERE decision.opening_balance_id = p_opening_balance_id
         AND decision.source_type = p_source_type
         AND decision.source_id = p_source_id),
      (SELECT source_default.position = 'AFTER_OPENING'
       FROM public.finance_opening_day_source_defaults source_default
       WHERE source_default.opening_balance_id = p_opening_balance_id
         AND source_default.source_type = p_source_type)
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.finance_is_after_opening(UUID, DATE, DATE, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finance_clear_opening_movement_decision(
  p_opening_balance_id UUID,
  p_source_type TEXT,
  p_source_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  IF NOT public.finance_has_available_funds_access() THEN
    RAISE EXCEPTION 'Authorized Finanzas access is required.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.finance_opening_day_movement_decisions decision
  WHERE decision.opening_balance_id = p_opening_balance_id
    AND decision.source_type = p_source_type
    AND decision.source_id = p_source_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.finance_clear_opening_movement_decision(UUID, TEXT, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_clear_opening_movement_decision(UUID, TEXT, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_set_commission_liquidity_adjustment(
  p_expense_id UUID,
  p_liquidity_treatment TEXT,
  p_payment_instrument TEXT,
  p_reason TEXT,
  p_idempotency_key UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_expense public.expenses%ROWTYPE;
  v_adjustment public.finance_expense_liquidity_adjustments%ROWTYPE;
BEGIN
  IF NOT public.finance_has_available_funds_access() THEN
    RAISE EXCEPTION 'Authorized Finanzas access is required.' USING ERRCODE = '42501';
  END IF;
  SELECT expense.* INTO v_expense
  FROM public.expenses expense WHERE expense.id = p_expense_id FOR UPDATE;
  IF NOT FOUND OR v_expense.commission_settlement_id IS NULL
     OR v_expense.concept_code IS DISTINCT FROM 'COMMISSIONS' THEN
    RAISE EXCEPTION 'Only an automatic commission expense can receive this adjustment.';
  END IF;
  IF p_liquidity_treatment NOT IN ('IMMEDIATE', 'PENDING')
     OR (p_liquidity_treatment = 'IMMEDIATE' AND p_payment_instrument NOT IN ('CASH', 'TRANSFER'))
     OR (p_liquidity_treatment = 'PENDING' AND p_payment_instrument IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid commission liquidity adjustment.';
  END IF;
  IF p_liquidity_treatment = 'IMMEDIATE'
     AND upper(v_expense.payment_method::TEXT) IN ('CASH', 'TRANSFER')
     AND upper(v_expense.payment_method::TEXT) IS DISTINCT FROM p_payment_instrument THEN
    RAISE EXCEPTION 'The adjustment instrument conflicts with the settlement payment method.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'An audit reason is required.';
  END IF;

  INSERT INTO public.finance_expense_liquidity_adjustments (
    expense_id, liquidity_treatment, payment_instrument, reason, idempotency_key
  ) VALUES (
    p_expense_id, p_liquidity_treatment, p_payment_instrument,
    btrim(p_reason), p_idempotency_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT adjustment.* INTO v_adjustment
  FROM public.finance_expense_liquidity_adjustments adjustment
  WHERE adjustment.idempotency_key = p_idempotency_key;
  IF v_adjustment.expense_id IS DISTINCT FROM p_expense_id
     OR v_adjustment.liquidity_treatment IS DISTINCT FROM p_liquidity_treatment
     OR v_adjustment.payment_instrument IS DISTINCT FROM p_payment_instrument
     OR v_adjustment.reason IS DISTINCT FROM btrim(p_reason) THEN
    RAISE EXCEPTION 'The idempotency token was already used with different adjustment data.';
  END IF;
  RETURN to_jsonb(v_adjustment);
END;
$$;
REVOKE ALL ON FUNCTION public.finance_set_commission_liquidity_adjustment(UUID, TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_set_commission_liquidity_adjustment(UUID, TEXT, TEXT, TEXT, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_protect_liquidity_adjustment_history()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  RAISE EXCEPTION 'Commission liquidity adjustments are append-only; create a new audited adjustment.';
END;
$$;
CREATE TRIGGER finance_protect_liquidity_adjustment_history_trigger
BEFORE UPDATE OR DELETE ON public.finance_expense_liquidity_adjustments
FOR EACH ROW EXECUTE FUNCTION public.finance_protect_liquidity_adjustment_history();

ALTER TABLE public.finance_opening_day_source_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_expense_liquidity_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_source_defaults_select_admin
ON public.finance_opening_day_source_defaults FOR SELECT TO authenticated
USING (public.finance_has_available_funds_access());
CREATE POLICY finance_source_defaults_insert_admin
ON public.finance_opening_day_source_defaults FOR INSERT TO authenticated
WITH CHECK (public.finance_has_available_funds_access());
CREATE POLICY finance_source_defaults_update_admin
ON public.finance_opening_day_source_defaults FOR UPDATE TO authenticated
USING (public.finance_has_available_funds_access())
WITH CHECK (public.finance_has_available_funds_access());
CREATE POLICY finance_liquidity_adjustments_select_admin
ON public.finance_expense_liquidity_adjustments FOR SELECT TO authenticated
USING (public.finance_has_available_funds_access());

REVOKE ALL ON TABLE public.finance_opening_day_source_defaults FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.finance_opening_day_source_defaults TO authenticated;
REVOKE ALL ON TABLE public.finance_expense_liquidity_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.finance_expense_liquidity_adjustments TO authenticated;

CREATE TRIGGER finance_opening_source_defaults_updated_at
BEFORE UPDATE ON public.finance_opening_day_source_defaults
FOR EACH ROW EXECUTE FUNCTION public.set_available_funds_updated_at();

CREATE OR REPLACE FUNCTION public.set_finance_opening_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF NEW.cutoff_business_date IS DISTINCT FROM OLD.cutoff_business_date
     AND (
       EXISTS (
         SELECT 1 FROM public.finance_opening_day_movement_decisions decision
         WHERE decision.opening_balance_id = OLD.id)
       OR EXISTS (
         SELECT 1 FROM public.finance_opening_day_source_defaults source_default
         WHERE source_default.opening_balance_id = OLD.id)
     ) THEN
    RAISE EXCEPTION 'Remove or review same-day decisions and source defaults before changing the cutoff date.';
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), OLD.updated_by);
  RETURN NEW;
END;
$$;

-- The user already confirmed the November opening-day POS sales as later than
-- the $10,010 opening balance. Existing per-sale decisions remain available as
-- audited exceptions and take precedence over this joint default.
INSERT INTO public.finance_opening_day_source_defaults (
  opening_balance_id, source_type, position, notes, decided_by
)
SELECT opening.id, 'POS_SALE', 'AFTER_OPENING',
  'Confirmación conjunta: ventas POS identificadas posteriores a los $10,010.',
  opening.updated_by
FROM public.finance_month_opening_balances opening
WHERE opening.month_start = DATE '2026-11-01'
ON CONFLICT (opening_balance_id, source_type) DO NOTHING;

-- Do not edit the protected expense. Append one deterministic, auditable
-- liquidity adjustment for the unique $100 commission already confirmed as
-- cash and AFTER_OPENING.
INSERT INTO public.finance_expense_liquidity_adjustments (
  expense_id, liquidity_treatment, payment_instrument, reason, idempotency_key,
  created_by
)
SELECT expense.id, 'IMMEDIATE', 'CASH',
  'Confirmado por la usuaria: comisión Gerardo $100 pagada en efectivo y posterior al saldo inicial.',
  '20261101-2200-4000-8000-000000000100'::UUID,
  decision.decided_by
FROM public.expenses expense
JOIN public.finance_month_opening_balances opening
  ON opening.month_start = DATE '2026-11-01'
JOIN public.finance_opening_day_movement_decisions decision
  ON decision.opening_balance_id = opening.id
  AND decision.source_type = 'EXPENSE'
  AND decision.source_id = expense.id
  AND decision.position = 'AFTER_OPENING'
WHERE expense.expense_date = DATE '2026-11-01'
  AND expense.amount_mxn = 100
  AND upper(expense.payment_method::TEXT) = 'CASH'
  AND expense.concept_code = 'COMMISSIONS'
  AND expense.commission_settlement_id IS NOT NULL
  AND COALESCE(expense.liquidity_treatment, 'PENDING') = 'PENDING';

CREATE OR REPLACE FUNCTION public.finance_month_available_funds(p_month_start DATE)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
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
  v_pos_default TEXT;
  v_opening_day_pos_count INTEGER := 0;
  v_opening_day_pos_amount NUMERIC := 0;
  v_opening_day_pos_exception_count INTEGER := 0;
  v_opening_day_pos_sales JSONB := '[]'::JSONB;
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
      'opening_day_pos', jsonb_build_object(
        'default_position', NULL, 'count', 0, 'amount_mxn', 0,
        'exception_count', 0, 'sales', '[]'::JSONB),
      'ambiguous_movements', '[]'::JSONB,
      'limitations', '{}'::JSONB
    );
  END IF;

  SELECT source_default.position INTO v_pos_default
  FROM public.finance_opening_day_source_defaults source_default
  WHERE source_default.opening_balance_id = v_opening_id
    AND source_default.source_type = 'POS_SALE';

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

  SELECT COUNT(*), COALESCE(SUM(sale.total), 0)
  INTO v_refund_count, v_refund_amount
  FROM public.sales sale
  WHERE COALESCE(sale.is_refunded, false)
    AND (
      (sale.refunded_at IS NOT NULL
        AND (sale.refunded_at AT TIME ZONE 'America/Mexico_City')::DATE < v_month_end
        AND public.finance_is_after_opening(
          v_opening_id, v_cutoff_date,
          (sale.refunded_at AT TIME ZONE 'America/Mexico_City')::DATE,
          'POS_REFUND', sale.id) IS TRUE)
      OR
      (sale.refunded_at IS NULL AND EXISTS (
        SELECT 1 FROM public.finance_opening_day_movement_decisions decision
        WHERE decision.opening_balance_id = v_opening_id
          AND decision.source_type = 'POS_REFUND'
          AND decision.source_id = sale.id
          AND decision.position = 'AFTER_OPENING'))
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
      END, payment.id) IS TRUE;

  WITH expense_liquidity AS (
    SELECT expense.*,
      COALESCE(adjustment.liquidity_treatment, expense.liquidity_treatment) AS effective_treatment,
      COALESCE(adjustment.payment_instrument, expense.payment_instrument) AS effective_instrument
    FROM public.expenses expense
    LEFT JOIN LATERAL (
      SELECT entry.liquidity_treatment, entry.payment_instrument
      FROM public.finance_expense_liquidity_adjustments entry
      WHERE entry.expense_id = expense.id
      ORDER BY entry.created_at DESC, entry.id DESC
      LIMIT 1
    ) adjustment ON true
  )
  SELECT
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.effective_treatment = 'IMMEDIATE'), 0),
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.effective_treatment = 'CREDIT'), 0),
    COUNT(*) FILTER (
      WHERE expense.effective_treatment IS NULL OR expense.effective_treatment = 'PENDING'),
    COALESCE(SUM(expense.amount_mxn) FILTER (
      WHERE expense.effective_treatment IS NULL OR expense.effective_treatment = 'PENDING'), 0)
  INTO v_expenses, v_credit_purchases, v_pending_count, v_pending_amount
  FROM expense_liquidity expense
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
      'CREDIT_CARD_PAYMENT', payment.id) IS TRUE;

  WITH cutoff_movements AS (
    SELECT CASE lower(COALESCE(sale.sale_origin, 'pos'))
        WHEN 'order' THEN 'ORDER_SALE'
        WHEN 'delivery' THEN 'DELIVERY_SALE'
        ELSE 'POS_SALE'
      END AS source_type,
      sale.id AS source_id,
      (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE AS business_date,
      sale.total::NUMERIC AS amount_mxn,
      CASE lower(COALESCE(sale.sale_origin, 'pos'))
        WHEN 'pos' THEN 'INFLOW' ELSE 'LIMITATION' END AS direction,
      concat('Venta ', COALESCE(sale.sale_origin, 'pos'), ' · ', sale.payment_method::TEXT) AS label
    FROM public.sales sale
    WHERE (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE = v_cutoff_date

    UNION ALL
    SELECT CASE payment.source_type
        WHEN 'comodato' THEN 'B2B_COMODATO'
        WHEN 'mayoreo' THEN 'B2B_MAYOREO'
        ELSE 'B2B_VENTA_PIEZA' END,
      payment.id, payment.business_date, payment.amount, 'INFLOW',
      concat('Cobranza B2B · ', payment.source_type)
    FROM public.v_b2b_confirmed_payments payment
    WHERE payment.business_date = v_cutoff_date

    UNION ALL
    SELECT 'EXPENSE', expense.id, expense.expense_date, expense.amount_mxn,
      CASE COALESCE(adjustment.liquidity_treatment, expense.liquidity_treatment)
        WHEN 'IMMEDIATE' THEN 'OUTFLOW'
        WHEN 'CREDIT' THEN 'LIABILITY'
        ELSE 'LIMITATION' END,
      concat('Gasto · ', COALESCE(expense.vendor, expense.concept_code, expense.category, 'sin descripción'))
    FROM public.expenses expense
    LEFT JOIN LATERAL (
      SELECT entry.liquidity_treatment
      FROM public.finance_expense_liquidity_adjustments entry
      WHERE entry.expense_id = expense.id
      ORDER BY entry.created_at DESC, entry.id DESC LIMIT 1
    ) adjustment ON true
    WHERE expense.expense_date = v_cutoff_date

    UNION ALL
    SELECT 'CREDIT_CARD_PAYMENT', payment.id, payment.payment_date, payment.amount_mxn,
      'OUTFLOW', concat('Pago de tarjeta · ', card.name)
    FROM public.finance_credit_card_payments payment
    JOIN public.finance_credit_cards card ON card.id = payment.credit_card_id
    WHERE payment.status = 'POSTED' AND payment.payment_date = v_cutoff_date

    UNION ALL
    SELECT 'POS_REFUND', sale.id,
      COALESCE((sale.refunded_at AT TIME ZONE 'America/Mexico_City')::DATE, v_cutoff_date),
      sale.total, 'LIMITATION',
      CASE WHEN sale.refunded_at IS NULL
        THEN 'Devolución POS sin fecha efectiva' ELSE 'Devolución POS' END
    FROM public.sales sale
    WHERE COALESCE(sale.is_refunded, false)
      AND (sale.refunded_at IS NULL
        OR (sale.refunded_at AT TIME ZONE 'America/Mexico_City')::DATE = v_cutoff_date)
  ), unresolved AS (
    SELECT movement.*
    FROM cutoff_movements movement
    LEFT JOIN public.finance_opening_day_movement_decisions decision
      ON decision.opening_balance_id = v_opening_id
      AND decision.source_type = movement.source_type
      AND decision.source_id = movement.source_id
    LEFT JOIN public.finance_opening_day_source_defaults source_default
      ON source_default.opening_balance_id = v_opening_id
      AND source_default.source_type = movement.source_type
    WHERE decision.id IS NULL AND source_default.id IS NULL
  )
  SELECT COUNT(*), COALESCE(SUM(amount_mxn), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'source_type', source_type, 'source_id', source_id,
      'business_date', business_date, 'amount_mxn', amount_mxn,
      'direction', direction, 'label', label
    ) ORDER BY source_type, source_id), '[]'::JSONB)
  INTO v_ambiguous_count, v_ambiguous_amount, v_ambiguous_movements
  FROM unresolved;

  SELECT COUNT(*), COALESCE(SUM(sale.total), 0),
    COUNT(*) FILTER (
      WHERE decision.position IS NOT NULL
        AND v_pos_default IS NOT NULL
        AND decision.position IS DISTINCT FROM v_pos_default),
    COALESCE(jsonb_agg(jsonb_build_object(
      'source_id', sale.id,
      'business_date', (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE,
      'amount_mxn', sale.total,
      'payment_method', sale.payment_method::TEXT,
      'individual_position', decision.position,
      'effective_position', COALESCE(decision.position, v_pos_default)
    ) ORDER BY sale.created_at, sale.id), '[]'::JSONB)
  INTO v_opening_day_pos_count, v_opening_day_pos_amount,
    v_opening_day_pos_exception_count, v_opening_day_pos_sales
  FROM public.sales sale
  LEFT JOIN public.finance_opening_day_movement_decisions decision
    ON decision.opening_balance_id = v_opening_id
    AND decision.source_type = 'POS_SALE'
    AND decision.source_id = sale.id
  WHERE (sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE = v_cutoff_date
    AND lower(COALESCE(sale.sale_origin, 'pos')) = 'pos';

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
    'opening_day_pos', jsonb_build_object(
      'default_position', v_pos_default,
      'count', v_opening_day_pos_count,
      'amount_mxn', round(v_opening_day_pos_amount, 2),
      'exception_count', v_opening_day_pos_exception_count,
      'sales', v_opening_day_pos_sales),
    'ambiguous_movements', v_ambiguous_movements,
    'limitations', jsonb_build_object(
      'ambiguous_cutoff_movements', jsonb_build_object(
        'count', v_ambiguous_count, 'amount_mxn', round(v_ambiguous_amount, 2)),
      'pending_expenses', jsonb_build_object(
        'count', v_pending_count, 'amount_mxn', round(v_pending_amount, 2)),
      'refunded_pos_sales', jsonb_build_object(
        'count', v_refund_count, 'amount_mxn', round(v_refund_amount, 2)),
      'order_sales', jsonb_build_object(
        'count', v_order_count, 'amount_mxn', round(v_order_amount, 2)),
      'delivery_sales', jsonb_build_object(
        'count', v_delivery_count, 'amount_mxn', round(v_delivery_amount, 2)),
      'unsupported_pos_payments', jsonb_build_object(
        'count', v_unsupported_count, 'amount_mxn', round(v_unsupported_amount, 2))
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.finance_month_available_funds(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_month_available_funds(DATE) TO authenticated;

COMMENT ON TABLE public.finance_opening_day_source_defaults IS
  'One opening-day decision per movement source; individual decisions remain audited overrides.';
COMMENT ON TABLE public.finance_expense_liquidity_adjustments IS
  'Append-only audited liquidity corrections for protected automatic commission expenses; never duplicates or edits the expense.';
COMMENT ON COLUMN public.expenses.commission_origin_scope IS
  'Operational branch origin for automatic commissions. Budget destination remains SHARED.';
COMMENT ON FUNCTION public.finance_month_available_funds(DATE) IS
  'Stage-1 liquidity with joint POS cutoff decisions and audited commission adjustments; sales, P&L and fixed-cost metrics remain unchanged.';

DO $postflight$
DECLARE
  v_adjustment_count INTEGER;
  v_adjustment_amount NUMERIC;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(expense.amount_mxn), 0)
  INTO v_adjustment_count, v_adjustment_amount
  FROM public.finance_expense_liquidity_adjustments adjustment
  JOIN public.expenses expense ON expense.id = adjustment.expense_id
  WHERE adjustment.idempotency_key = '20261101-2200-4000-8000-000000000100'::UUID
    AND adjustment.liquidity_treatment = 'IMMEDIATE'
    AND adjustment.payment_instrument = 'CASH';
  IF v_adjustment_count <> 1 OR v_adjustment_amount <> 100 THEN
    RAISE EXCEPTION 'The reviewed $100 commission liquidity adjustment was not recorded exactly once.';
  END IF;
  IF HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_expense_liquidity_adjustments', 'INSERT')
     OR HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_expense_liquidity_adjustments', 'UPDATE')
     OR HAS_TABLE_PRIVILEGE('authenticated', 'public.finance_expense_liquidity_adjustments', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated clients unexpectedly have direct write access to liquidity adjustments.';
  END IF;
  IF HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_origin_scope', 'INSERT')
     OR HAS_COLUMN_PRIVILEGE('authenticated', 'public.expenses', 'commission_origin_scope', 'UPDATE') THEN
    RAISE EXCEPTION 'Authenticated clients unexpectedly can forge commission origin.';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;
