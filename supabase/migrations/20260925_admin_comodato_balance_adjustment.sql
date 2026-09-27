BEGIN;

-- Administrative Comodato corrections are append-only.  A completed adjustment
-- movement holds positive quantity_adjusted / amount_adjusted values which point
-- back to the original settlement item; the historical settlement is never
-- updated or deleted.

ALTER TABLE public.commercial_partner_movements
  ADD COLUMN IF NOT EXISTS adjustment_folio TEXT,
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT;

ALTER TABLE public.commercial_partner_movement_items
  ADD COLUMN IF NOT EXISTS amount_adjusted NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjusts_movement_item_id UUID,
  ADD COLUMN IF NOT EXISTS commission_amount_adjusted NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjusts_commission_event_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commercial_partner_movements_adjustment_folio_key'
      AND conrelid = 'public.commercial_partner_movements'::regclass
  ) THEN
    ALTER TABLE public.commercial_partner_movements
      ADD CONSTRAINT commercial_partner_movements_adjustment_folio_key
      UNIQUE (adjustment_folio);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commercial_partner_movement_items_amount_adjusted_nonnegative'
      AND conrelid = 'public.commercial_partner_movement_items'::regclass
  ) THEN
    ALTER TABLE public.commercial_partner_movement_items
      ADD CONSTRAINT commercial_partner_movement_items_amount_adjusted_nonnegative
      CHECK (amount_adjusted >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commercial_partner_movement_items_commission_adjusted_nonnegative'
      AND conrelid = 'public.commercial_partner_movement_items'::regclass
  ) THEN
    ALTER TABLE public.commercial_partner_movement_items
      ADD CONSTRAINT commercial_partner_movement_items_commission_adjusted_nonnegative
      CHECK (commission_amount_adjusted >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commercial_partner_movement_items_adjusts_movement_item_fkey'
      AND conrelid = 'public.commercial_partner_movement_items'::regclass
  ) THEN
    ALTER TABLE public.commercial_partner_movement_items
      ADD CONSTRAINT commercial_partner_movement_items_adjusts_movement_item_fkey
      FOREIGN KEY (adjusts_movement_item_id)
      REFERENCES public.commercial_partner_movement_items(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commercial_partner_movement_items_adjusts_commission_event_fkey'
      AND conrelid = 'public.commercial_partner_movement_items'::regclass
  ) THEN
    ALTER TABLE public.commercial_partner_movement_items
      ADD CONSTRAINT commercial_partner_movement_items_adjusts_commission_event_fkey
      FOREIGN KEY (adjusts_commission_event_id)
      REFERENCES public.commission_events(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS commercial_partner_movement_items_adjusts_item_idx
  ON public.commercial_partner_movement_items (adjusts_movement_item_id)
  WHERE adjusts_movement_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commercial_partner_movement_items_adjusts_commission_idx
  ON public.commercial_partner_movement_items (adjusts_commission_event_id)
  WHERE adjusts_commission_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commercial_partner_movements_adjustment_partner_idx
  ON public.commercial_partner_movements (partner_id, movement_date DESC)
  WHERE lower(trim(movement_type)) = 'adjustment';

CREATE OR REPLACE FUNCTION public._admin_comodato_adjustment_write_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_adjustment BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'commercial_partner_movements' THEN
    v_is_adjustment := lower(trim(COALESCE(NEW.movement_type, OLD.movement_type))) = 'adjustment';
  ELSE
    SELECT lower(trim(movement.movement_type)) = 'adjustment'
      INTO v_is_adjustment
    FROM public.commercial_partner_movements AS movement
    WHERE movement.id = COALESCE(NEW.movement_id, OLD.movement_id);
  END IF;

  IF COALESCE(v_is_adjustment, FALSE)
     AND current_setting('app.admin_comodato_adjustment_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Administrative Comodato adjustments can only be written by admin_adjust_comodato_balance';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_comodato_adjustment_movement_guard
  ON public.commercial_partner_movements;
CREATE TRIGGER trg_admin_comodato_adjustment_movement_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.commercial_partner_movements
FOR EACH ROW EXECUTE FUNCTION public._admin_comodato_adjustment_write_guard();

DROP TRIGGER IF EXISTS trg_admin_comodato_adjustment_item_guard
  ON public.commercial_partner_movement_items;
CREATE TRIGGER trg_admin_comodato_adjustment_item_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.commercial_partner_movement_items
FOR EACH ROW EXECUTE FUNCTION public._admin_comodato_adjustment_write_guard();

CREATE OR REPLACE FUNCTION public.get_comodato_movement_pending_balance(p_movement_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH original_due AS (
    SELECT COALESCE(SUM(COALESCE(item.amount_due, 0)), 0)::NUMERIC AS amount
    FROM public.commercial_partner_movement_items AS item
    JOIN public.commercial_partner_movements AS movement ON movement.id = item.movement_id
    WHERE item.movement_id = p_movement_id
      AND COALESCE(item.quantity_sold, 0) > 0
      AND lower(trim(movement.movement_type)) = 'settlement'
      AND lower(trim(movement.status)) = 'completed'
  ), adjustments AS (
    SELECT COALESCE(SUM(COALESCE(adjustment.amount_adjusted, 0)), 0)::NUMERIC AS amount
    FROM public.commercial_partner_movement_items AS adjustment
    JOIN public.commercial_partner_movements AS adjustment_movement
      ON adjustment_movement.id = adjustment.movement_id
    JOIN public.commercial_partner_movement_items AS original
      ON original.id = adjustment.adjusts_movement_item_id
    WHERE original.movement_id = p_movement_id
      AND lower(trim(adjustment_movement.movement_type)) = 'adjustment'
      AND lower(trim(adjustment_movement.status)) = 'completed'
  ), payments AS (
    SELECT COALESCE(SUM(COALESCE(payment.amount, 0)), 0)::NUMERIC AS amount
    FROM public.commercial_partner_payments AS payment
    WHERE payment.movement_id = p_movement_id
      AND lower(trim(payment.status)) IN ('completed', 'paid')
  )
  SELECT GREATEST(
    (SELECT amount FROM original_due) - (SELECT amount FROM adjustments) - (SELECT amount FROM payments),
    0
  )::NUMERIC;
$$;

CREATE OR REPLACE FUNCTION public.get_partner_comodato_pending_balance(p_partner_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH original_due AS (
    SELECT COALESCE(SUM(COALESCE(item.amount_due, 0)), 0)::NUMERIC AS amount
    FROM public.commercial_partner_movement_items AS item
    JOIN public.commercial_partner_movements AS movement ON movement.id = item.movement_id
    WHERE movement.partner_id = p_partner_id
      AND lower(trim(movement.movement_type)) = 'settlement'
      AND lower(trim(movement.status)) = 'completed'
      AND COALESCE(item.quantity_sold, 0) > 0
  ), adjustments AS (
    SELECT COALESCE(SUM(COALESCE(adjustment.amount_adjusted, 0)), 0)::NUMERIC AS amount
    FROM public.commercial_partner_movement_items AS adjustment
    JOIN public.commercial_partner_movements AS adjustment_movement
      ON adjustment_movement.id = adjustment.movement_id
    WHERE adjustment_movement.partner_id = p_partner_id
      AND lower(trim(adjustment_movement.movement_type)) = 'adjustment'
      AND lower(trim(adjustment_movement.status)) = 'completed'
  ), payments AS (
    SELECT COALESCE(SUM(COALESCE(payment.amount, 0)), 0)::NUMERIC AS amount
    FROM public.commercial_partner_payments AS payment
    WHERE payment.partner_id = p_partner_id
      AND lower(trim(payment.status)) IN ('completed', 'paid')
  )
  SELECT GREATEST(
    (SELECT amount FROM original_due) - (SELECT amount FROM adjustments) - (SELECT amount FROM payments),
    0
  )::NUMERIC;
$$;

CREATE OR REPLACE VIEW public.v_commercial_partner_balances AS
WITH original_due AS (
  SELECT movement.partner_id, COALESCE(SUM(item.amount_due), 0)::NUMERIC AS amount
  FROM public.commercial_partner_movements AS movement
  JOIN public.commercial_partner_movement_items AS item ON item.movement_id = movement.id
  WHERE lower(trim(movement.movement_type)) = 'settlement'
    AND lower(trim(movement.status)) = 'completed'
    AND COALESCE(item.quantity_sold, 0) > 0
  GROUP BY movement.partner_id
), adjustments AS (
  SELECT movement.partner_id, COALESCE(SUM(item.amount_adjusted), 0)::NUMERIC AS amount
  FROM public.commercial_partner_movements AS movement
  JOIN public.commercial_partner_movement_items AS item ON item.movement_id = movement.id
  WHERE lower(trim(movement.movement_type)) = 'adjustment'
    AND lower(trim(movement.status)) = 'completed'
  GROUP BY movement.partner_id
), payments AS (
  SELECT partner_id, COALESCE(SUM(amount), 0)::NUMERIC AS total_paid
  FROM public.commercial_partner_payments
  WHERE lower(trim(status)) IN ('completed', 'paid')
  GROUP BY partner_id
)
SELECT partner.id AS partner_id, partner.folio, partner.business_name,
  partner.responsible_name, partner.partner_model, partner.status,
  GREATEST(COALESCE(original_due.amount, 0) - COALESCE(adjustments.amount, 0), 0)::NUMERIC AS total_due,
  COALESCE(payments.total_paid, 0)::NUMERIC AS total_paid,
  GREATEST(COALESCE(original_due.amount, 0) - COALESCE(adjustments.amount, 0) - COALESCE(payments.total_paid, 0), 0)::NUMERIC AS pending_balance
FROM public.commercial_partners AS partner
LEFT JOIN original_due ON original_due.partner_id = partner.id
LEFT JOIN adjustments ON adjustments.partner_id = partner.id
LEFT JOIN payments ON payments.partner_id = partner.id;

CREATE OR REPLACE FUNCTION public.sync_comodato_commissions_for_movement(p_movement_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partner_id UUID;
  v_seller_id UUID;
  v_movement_type TEXT;
  v_movement_status TEXT;
  v_movement_date TIMESTAMPTZ;
  v_total_due NUMERIC := 0;
  v_total_paid NUMERIC := 0;
  v_event_status TEXT;
  v_event_date DATE;
  v_product_key TEXT;
  v_rule_id UUID;
  v_rule_amount NUMERIC;
  v_existing_event public.commission_events%ROWTYPE;
  v_has_event BOOLEAN;
  r_item RECORD;
BEGIN
  SELECT movement.partner_id, partner.assigned_to, lower(trim(movement.movement_type)),
         lower(trim(movement.status)), movement.movement_date
    INTO v_partner_id, v_seller_id, v_movement_type, v_movement_status, v_movement_date
  FROM public.commercial_partner_movements AS movement
  JOIN public.commercial_partners AS partner ON partner.id = movement.partner_id
  WHERE movement.id = p_movement_id;

  IF NOT FOUND THEN
    UPDATE public.commission_events
    SET status = 'cancelled', cancelled_at = now(),
        cancellation_reason = 'El movimiento de origen ya no existe', updated_at = now()
    WHERE source_type = 'comodato_sale' AND source_id = p_movement_id
      AND status IN ('pending', 'available');
    RETURN;
  END IF;
  IF v_movement_type <> 'settlement' OR v_movement_status <> 'completed' THEN
    UPDATE public.commission_events
    SET status = 'cancelled', cancelled_at = now(),
        cancellation_reason = 'La liquidación dejó de estar completada', updated_at = now()
    WHERE source_type = 'comodato_sale' AND source_id = p_movement_id
      AND status IN ('pending', 'available');
    RETURN;
  END IF;
  IF v_seller_id IS NULL OR NOT public.is_valid_commission_seller(v_seller_id) THEN
    PERFORM public.log_commission_sync_issue(
      'partner_without_seller', v_partner_id, v_seller_id, 'comodato_movement', p_movement_id,
      NULL, 'La liquidación no puede generar comisión porque el socio no tiene un vendedor activo asignado.',
      jsonb_build_object('movement_type', v_movement_type, 'movement_status', v_movement_status)
    );
    RETURN;
  END IF;

  v_event_date := (v_movement_date AT TIME ZONE 'America/Mexico_City')::DATE;
  SELECT COALESCE(SUM(GREATEST(COALESCE(item.amount_due, 0) - COALESCE(adjusted.amount, 0), 0)), 0)
    INTO v_total_due
  FROM public.commercial_partner_movement_items AS item
  LEFT JOIN LATERAL (
    SELECT SUM(COALESCE(adjustment.amount_adjusted, 0)) AS amount
    FROM public.commercial_partner_movement_items AS adjustment
    JOIN public.commercial_partner_movements AS adjustment_movement ON adjustment_movement.id = adjustment.movement_id
    WHERE adjustment.adjusts_movement_item_id = item.id
      AND lower(trim(adjustment_movement.movement_type)) = 'adjustment'
      AND lower(trim(adjustment_movement.status)) = 'completed'
  ) AS adjusted ON TRUE
  WHERE item.movement_id = p_movement_id AND COALESCE(item.quantity_sold, 0) > 0;
  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM public.commercial_partner_payments
  WHERE movement_id = p_movement_id AND lower(trim(status)) IN ('completed', 'paid');
  v_event_status := CASE WHEN v_total_due > 0 AND v_total_paid + 0.005 >= v_total_due
    THEN 'available' ELSE 'pending' END;

  FOR r_item IN
    SELECT item.*, COALESCE(adjusted.quantity, 0)::NUMERIC AS quantity_adjusted_total,
      COALESCE(adjusted.amount, 0)::NUMERIC AS amount_adjusted_total
    FROM public.commercial_partner_movement_items AS item
    LEFT JOIN LATERAL (
      SELECT SUM(COALESCE(adjustment.quantity_adjusted, 0)) AS quantity,
        SUM(COALESCE(adjustment.amount_adjusted, 0)) AS amount
      FROM public.commercial_partner_movement_items AS adjustment
      JOIN public.commercial_partner_movements AS adjustment_movement ON adjustment_movement.id = adjustment.movement_id
      WHERE adjustment.adjusts_movement_item_id = item.id
        AND lower(trim(adjustment_movement.movement_type)) = 'adjustment'
        AND lower(trim(adjustment_movement.status)) = 'completed'
    ) AS adjusted ON TRUE
    WHERE item.movement_id = p_movement_id AND COALESCE(item.quantity_sold, 0) > 0
  LOOP
    SELECT * INTO v_existing_event FROM public.commission_events
    WHERE source_type = 'comodato_sale' AND source_item_id = r_item.id FOR UPDATE;
    v_has_event := FOUND;

    IF r_item.quantity_adjusted_total > r_item.quantity_sold + 0.000001 THEN
      RAISE EXCEPTION 'Adjustment quantity exceeds the original settled quantity for item %', r_item.id;
    END IF;
    IF r_item.quantity_sold - r_item.quantity_adjusted_total <= 0.000001 THEN
      IF v_has_event AND v_existing_event.status IN ('pending', 'available') THEN
        UPDATE public.commission_events
        SET status = 'cancelled', cancelled_at = now(), updated_at = now(),
          cancellation_reason = 'Todas las piezas liquidadas fueron corregidas administrativamente',
          metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
            'original_quantity_sold', r_item.quantity_sold,
            'quantity_adjusted', r_item.quantity_adjusted_total,
            'effective_quantity_sold', 0,
            'original_amount_due', r_item.amount_due,
            'amount_adjusted', r_item.amount_adjusted_total,
            'effective_amount_due', 0
          )
        WHERE id = v_existing_event.id;
      END IF;
      CONTINUE;
    END IF;
    IF v_has_event AND v_existing_event.status = 'cancelled' THEN
      CONTINUE;
    END IF;
    IF v_has_event THEN
      v_rule_id := v_existing_event.rule_id;
      v_rule_amount := v_existing_event.unit_commission;
      v_product_key := v_existing_event.product_key;
    ELSE
      v_product_key := public.commission_product_key(r_item.product_name, r_item.product_variant);
      IF v_product_key IS NULL THEN
        PERFORM public.log_commission_sync_issue('product_without_rule', v_partner_id, v_seller_id,
          'comodato_movement', p_movement_id, r_item.id,
          'No se pudo identificar el producto para calcular su comisión.',
          jsonb_build_object('product_name', r_item.product_name, 'product_variant', r_item.product_variant));
        CONTINUE;
      END IF;
      SELECT rule.id, rule.commission_amount INTO v_rule_id, v_rule_amount
      FROM public.commission_rules AS rule
      WHERE rule.scheme = 'comodato' AND rule.product_key = v_product_key AND rule.active
        AND rule.valid_from <= v_event_date AND (rule.valid_to IS NULL OR rule.valid_to >= v_event_date)
      ORDER BY rule.valid_from DESC LIMIT 1;
      IF v_rule_id IS NULL THEN
        PERFORM public.log_commission_sync_issue('product_without_rule', v_partner_id, v_seller_id,
          'comodato_movement', p_movement_id, r_item.id,
          'No existe una regla de comisión vigente para este producto de comodato.',
          jsonb_build_object('product_key', v_product_key, 'event_date', v_event_date));
        CONTINUE;
      END IF;
    END IF;
    IF v_has_event THEN
      UPDATE public.commission_events
      SET quantity = r_item.quantity_sold - r_item.quantity_adjusted_total,
          commission_amount = (r_item.quantity_sold - r_item.quantity_adjusted_total) * v_rule_amount,
          status = v_event_status,
          available_at = CASE WHEN v_event_status = 'available' THEN COALESCE(available_at, now()) ELSE NULL END,
          metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
            'total_due', v_total_due, 'total_paid', v_total_paid,
            'original_quantity_sold', r_item.quantity_sold,
            'quantity_adjusted', r_item.quantity_adjusted_total,
            'effective_quantity_sold', r_item.quantity_sold - r_item.quantity_adjusted_total,
            'original_amount_due', r_item.amount_due,
            'amount_adjusted', r_item.amount_adjusted_total,
            'effective_amount_due', GREATEST(r_item.amount_due - r_item.amount_adjusted_total, 0)
          ), updated_at = now()
      WHERE id = v_existing_event.id
        AND NOT EXISTS (
          SELECT 1 FROM public.v_commission_event_payment_balances AS balance
          WHERE balance.commission_event_id = v_existing_event.id
            AND (abs(balance.paid_amount) > 0.005 OR abs(balance.reserved_amount) > 0.005
              OR balance.payment_status IN ('paid', 'partially_paid'))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.commission_settlement_items AS item
          JOIN public.commission_settlements AS settlement ON settlement.id = item.settlement_id
          WHERE item.commission_event_id = v_existing_event.id AND settlement.status <> 'cancelled'
        );
    ELSE
      INSERT INTO public.commission_events (
        seller_id, partner_id, source_type, source_id, source_item_id, source_folio, rule_id,
        product_key, product_name, product_variant, product_size, quantity, unit_commission,
        commission_amount, release_condition, status, earned_at, available_at, metadata
      ) VALUES (
        v_seller_id, v_partner_id, 'comodato_sale', p_movement_id, r_item.id,
        'COMODATO-' || left(p_movement_id::TEXT, 8), v_rule_id, v_product_key,
        r_item.product_name, r_item.product_variant, r_item.product_size,
        r_item.quantity_sold - r_item.quantity_adjusted_total, v_rule_amount,
        (r_item.quantity_sold - r_item.quantity_adjusted_total) * v_rule_amount,
        'full_payment', v_event_status, v_movement_date,
        CASE WHEN v_event_status = 'available' THEN now() ELSE NULL END,
        jsonb_build_object('total_due', v_total_due, 'total_paid', v_total_paid,
          'original_quantity_sold', r_item.quantity_sold,
          'quantity_adjusted', r_item.quantity_adjusted_total,
          'effective_quantity_sold', r_item.quantity_sold - r_item.quantity_adjusted_total,
          'original_amount_due', r_item.amount_due,
          'amount_adjusted', r_item.amount_adjusted_total,
          'effective_amount_due', GREATEST(r_item.amount_due - r_item.amount_adjusted_total, 0))
      ) ON CONFLICT (source_type, source_item_id)
        WHERE source_item_id IS NOT NULL AND source_type <> 'adjustment' DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

-- PostgreSQL requires the sole defaulted parameter last, so p_admin_password
-- precedes optional p_notes in the callable signature.
CREATE OR REPLACE FUNCTION public.admin_adjust_comodato_balance(
  p_partner_id UUID,
  p_adjustments JSONB,
  p_reason TEXT,
  p_admin_password TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_notes TEXT := NULLIF(BTRIM(p_notes), '');
  v_password_valid BOOLEAN := FALSE;
  v_adjustment_movement_id UUID;
  v_adjustment_folio TEXT;
  v_before_balance NUMERIC;
  v_after_balance NUMERIC;
  v_total_amount_adjusted NUMERIC := 0;
  v_total_commission_adjusted NUMERIC := 0;
  v_total_units_adjusted NUMERIC := 0;
  v_item RECORD;
  v_event public.commission_events%ROWTYPE;
  v_event_id UUID;
  v_existing_quantity NUMERIC;
  v_existing_amount NUMERIC;
  v_amount_adjusted NUMERIC;
  v_commission_adjusted NUMERIC;
  v_total_due_after NUMERIC;
  v_total_paid NUMERIC;
  v_adjustment_count INTEGER;
  r_input RECORD;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'An authenticated administrator is required'; END IF;
  IF p_partner_id IS NULL THEN RAISE EXCEPTION 'Partner is required'; END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'An adjustment reason of at least 10 characters is required';
  END IF;
  IF NULLIF(BTRIM(p_admin_password), '') IS NULL THEN RAISE EXCEPTION 'Administrator password is required'; END IF;
  IF jsonb_typeof(p_adjustments) IS DISTINCT FROM 'array' OR jsonb_array_length(p_adjustments) = 0 THEN
    RAISE EXCEPTION 'p_adjustments must be a non-empty JSON array';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_adjustments) AS element(value)
    WHERE jsonb_typeof(value) <> 'object'
      OR NOT (value ? 'settlement_item_id') OR NOT (value ? 'quantity')
      OR jsonb_typeof(value -> 'settlement_item_id') <> 'string'
      OR jsonb_typeof(value -> 'quantity') <> 'number'
      OR value ->> 'settlement_item_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR value ->> 'quantity' !~ '^[1-9][0-9]*$'
  ) THEN RAISE EXCEPTION 'Each adjustment requires a UUID settlement_item_id and a positive integer quantity'; END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT (value ->> 'settlement_item_id')::UUID AS item_id
      FROM jsonb_array_elements(p_adjustments) AS element(value)
    ) AS supplied GROUP BY item_id HAVING COUNT(*) > 1
  ) THEN RAISE EXCEPTION 'Each settlement item may appear only once in an adjustment'; END IF;

  PERFORM 1 FROM public.commercial_partners WHERE id = p_partner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commercial partner not found'; END IF;
  PERFORM public._commercial_delivery_actor(p_partner_id, TRUE);
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles WHERE id = v_actor AND role = 'admin' AND COALESCE(is_active, FALSE)
  ) THEN RAISE EXCEPTION 'Only an active administrator can adjust a Comodato balance'; END IF;
  SELECT COALESCE(result.success, FALSE) INTO v_password_valid
  FROM public.verify_financial_access_password(p_admin_password) AS result LIMIT 1;
  IF NOT v_password_valid THEN RAISE EXCEPTION 'Administrator password is invalid'; END IF;

  SELECT public.get_partner_comodato_pending_balance(p_partner_id) INTO v_before_balance;

  FOR r_input IN
    SELECT (value ->> 'settlement_item_id')::UUID AS settlement_item_id,
      (value ->> 'quantity')::NUMERIC AS quantity
    FROM jsonb_array_elements(p_adjustments) AS element(value)
    ORDER BY (value ->> 'settlement_item_id')::UUID
  LOOP
    SELECT item.*, movement.id AS settlement_id, movement.movement_date
      INTO v_item
    FROM public.commercial_partner_movement_items AS item
    JOIN public.commercial_partner_movements AS movement ON movement.id = item.movement_id
    WHERE item.id = r_input.settlement_item_id AND movement.partner_id = p_partner_id
      AND lower(trim(movement.movement_type)) = 'settlement'
      AND lower(trim(movement.status)) = 'completed'
      AND COALESCE(item.quantity_sold, 0) > 0
    FOR UPDATE OF item, movement;
    IF NOT FOUND THEN RAISE EXCEPTION 'Settlement item % is not an eligible completed Comodato settlement item', r_input.settlement_item_id; END IF;

    PERFORM 1 FROM public.commercial_partner_movement_items AS adjustment
    JOIN public.commercial_partner_movements AS adjustment_movement ON adjustment_movement.id = adjustment.movement_id
    WHERE adjustment.adjusts_movement_item_id = v_item.id
    FOR UPDATE OF adjustment, adjustment_movement;
    SELECT COALESCE(SUM(adjustment.quantity_adjusted), 0), COALESCE(SUM(adjustment.amount_adjusted), 0)
      INTO v_existing_quantity, v_existing_amount
    FROM public.commercial_partner_movement_items AS adjustment
    JOIN public.commercial_partner_movements AS adjustment_movement ON adjustment_movement.id = adjustment.movement_id
    WHERE adjustment.adjusts_movement_item_id = v_item.id
      AND lower(trim(adjustment_movement.movement_type)) = 'adjustment'
      AND lower(trim(adjustment_movement.status)) = 'completed';
    IF v_existing_quantity + r_input.quantity > v_item.quantity_sold THEN
      RAISE EXCEPTION 'Requested quantity exceeds the still-adjustable quantity for settlement item %', v_item.id;
    END IF;

    PERFORM 1 FROM public.partner_payment_verification_requests AS request
    WHERE request.scheme = 'comodato' AND request.movement_id = v_item.settlement_id FOR UPDATE;
    PERFORM 1 FROM public.commercial_partner_payments AS payment
    WHERE payment.movement_id = v_item.settlement_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM public.partner_payment_verification_requests AS request
      WHERE request.scheme = 'comodato' AND request.movement_id = v_item.settlement_id
        AND lower(trim(COALESCE(request.status, ''))) NOT IN ('rejected', 'cancelled')
    ) THEN RAISE EXCEPTION 'Settlement % has an active payment verification request', v_item.settlement_id; END IF;

    SELECT * INTO v_event FROM public.commission_events AS event
    WHERE event.source_type = 'comodato_sale' AND event.source_id = v_item.settlement_id
      AND event.source_item_id = v_item.id FOR UPDATE;
    v_event_id := CASE WHEN FOUND THEN v_event.id ELSE NULL END;
    IF v_event_id IS NOT NULL THEN
      PERFORM 1 FROM public.commission_settlement_items AS settlement_item
      WHERE settlement_item.commission_event_id = v_event_id FOR UPDATE;
      IF EXISTS (
        SELECT 1 FROM public.v_commission_event_payment_balances AS balance
        WHERE balance.commission_event_id = v_event_id
          AND (abs(balance.paid_amount) > 0.005 OR abs(balance.reserved_amount) > 0.005
            OR balance.payment_status IN ('paid', 'partially_paid'))
      ) OR EXISTS (
        SELECT 1 FROM public.commission_settlement_items AS settlement_item
        JOIN public.commission_settlements AS settlement ON settlement.id = settlement_item.settlement_id
        WHERE settlement_item.commission_event_id = v_event_id AND settlement.status <> 'cancelled'
      ) THEN RAISE EXCEPTION 'Settlement item % has a paid, reserved, or settled commission and cannot be adjusted', v_item.id; END IF;
    END IF;

    v_amount_adjusted := CASE
      WHEN v_existing_quantity + r_input.quantity = v_item.quantity_sold THEN v_item.amount_due - v_existing_amount
      ELSE ROUND(v_item.amount_due * r_input.quantity / v_item.quantity_sold, 2)
    END;
    IF v_amount_adjusted < 0 THEN RAISE EXCEPTION 'Adjustment amount would be negative for settlement item %', v_item.id; END IF;
    SELECT COALESCE(SUM(item.amount_due), 0) - COALESCE((
      SELECT SUM(adjustment.amount_adjusted)
      FROM public.commercial_partner_movement_items AS adjustment
      JOIN public.commercial_partner_movements AS adjustment_movement ON adjustment_movement.id = adjustment.movement_id
      JOIN public.commercial_partner_movement_items AS original ON original.id = adjustment.adjusts_movement_item_id
      WHERE original.movement_id = v_item.settlement_id
        AND lower(trim(adjustment_movement.movement_type)) = 'adjustment'
        AND lower(trim(adjustment_movement.status)) = 'completed'
    ), 0) INTO v_total_due_after
    FROM public.commercial_partner_movement_items AS item
    WHERE item.movement_id = v_item.settlement_id AND COALESCE(item.quantity_sold, 0) > 0;
    SELECT COALESCE(SUM(payment.amount), 0) INTO v_total_paid
    FROM public.commercial_partner_payments AS payment
    WHERE payment.movement_id = v_item.settlement_id
      AND lower(trim(payment.status)) IN ('completed', 'paid');
    v_total_due_after := v_total_due_after - v_amount_adjusted;
    IF v_total_due_after + 0.005 < v_total_paid THEN
      RAISE EXCEPTION 'The adjustment would reduce settlement % below its approved payments', v_item.settlement_id;
    END IF;
  END LOOP;

  PERFORM set_config('app.admin_comodato_adjustment_write', 'on', TRUE);
  v_adjustment_folio := 'ADJ-COM-' || to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYYMMDD') || '-'
    || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 10));
  INSERT INTO public.commercial_partner_movements (
    partner_id, movement_type, movement_date, status, notes, created_by, adjustment_folio, adjustment_reason
  ) VALUES (
    p_partner_id, 'adjustment', now(), 'completed', v_notes, v_actor, v_adjustment_folio, v_reason
  ) RETURNING id INTO v_adjustment_movement_id;

  FOR r_input IN
    SELECT (value ->> 'settlement_item_id')::UUID AS settlement_item_id,
      (value ->> 'quantity')::NUMERIC AS quantity
    FROM jsonb_array_elements(p_adjustments) AS element(value)
    ORDER BY (value ->> 'settlement_item_id')::UUID
  LOOP
    SELECT item.*, movement.id AS settlement_id INTO v_item
    FROM public.commercial_partner_movement_items AS item
    JOIN public.commercial_partner_movements AS movement ON movement.id = item.movement_id
    WHERE item.id = r_input.settlement_item_id FOR UPDATE OF item, movement;
    SELECT COALESCE(SUM(adjustment.quantity_adjusted), 0), COALESCE(SUM(adjustment.amount_adjusted), 0)
      INTO v_existing_quantity, v_existing_amount
    FROM public.commercial_partner_movement_items AS adjustment
    JOIN public.commercial_partner_movements AS adjustment_movement ON adjustment_movement.id = adjustment.movement_id
    WHERE adjustment.adjusts_movement_item_id = v_item.id
      AND lower(trim(adjustment_movement.movement_type)) = 'adjustment'
      AND lower(trim(adjustment_movement.status)) = 'completed';
    v_amount_adjusted := CASE
      WHEN v_existing_quantity + r_input.quantity = v_item.quantity_sold THEN v_item.amount_due - v_existing_amount
      ELSE ROUND(v_item.amount_due * r_input.quantity / v_item.quantity_sold, 2)
    END;
    SELECT * INTO v_event FROM public.commission_events
    WHERE source_type = 'comodato_sale' AND source_id = v_item.settlement_id AND source_item_id = v_item.id FOR UPDATE;
    v_event_id := CASE WHEN FOUND THEN v_event.id ELSE NULL END;
    v_commission_adjusted := COALESCE(v_event.unit_commission, 0) * r_input.quantity;
    INSERT INTO public.commercial_partner_movement_items (
      movement_id, partner_id, product_id, product_name, product_variant, product_size,
      quantity_delivered, quantity_sold, quantity_withdrawn, quantity_spoiled, quantity_adjusted,
      price_to_catcorn, suggested_retail_price, amount_due, amount_adjusted,
      commission_amount_adjusted, adjusts_movement_item_id, adjusts_commission_event_id, notes
    ) VALUES (
      v_adjustment_movement_id, p_partner_id, v_item.product_id, v_item.product_name,
      v_item.product_variant, v_item.product_size, 0, 0, 0, 0, r_input.quantity,
      v_item.price_to_catcorn, v_item.suggested_retail_price, 0, v_amount_adjusted,
      v_commission_adjusted, v_item.id, v_event_id, v_notes
    );
    v_total_units_adjusted := v_total_units_adjusted + r_input.quantity;
    v_total_amount_adjusted := v_total_amount_adjusted + v_amount_adjusted;
    v_total_commission_adjusted := v_total_commission_adjusted + v_commission_adjusted;
  END LOOP;

  FOR v_item IN
    SELECT DISTINCT item.movement_id AS settlement_id
    FROM public.commercial_partner_movement_items AS item
    JOIN jsonb_array_elements(p_adjustments) AS supplied(value)
      ON item.id = (supplied.value ->> 'settlement_item_id')::UUID
  LOOP
    PERFORM public.sync_comodato_commissions_for_movement(v_item.settlement_id);
  END LOOP;
  SELECT public.get_partner_comodato_pending_balance(p_partner_id) INTO v_after_balance;
  SELECT COUNT(*) INTO v_adjustment_count
  FROM public.commercial_partner_movement_items WHERE movement_id = v_adjustment_movement_id;
  RETURN jsonb_build_object(
    'adjustment_movement_id', v_adjustment_movement_id,
    'adjustment_folio', v_adjustment_folio,
    'partner_id', p_partner_id,
    'adjusted_lines', v_adjustment_count,
    'units_restored_to_possession', v_total_units_adjusted,
    'amount_adjusted', v_total_amount_adjusted,
    'commission_reduction', v_total_commission_adjusted,
    'pending_balance_before', v_before_balance,
    'pending_balance_after', v_after_balance,
    'created_by', v_actor,
    'created_at', now()
  );
END;
$$;

-- Preserve the deployed approval contract while asking the adjusted-balance
-- function for the only Comodato value that may be paid.
CREATE OR REPLACE FUNCTION public.approve_partner_payment_verification_request(
  p_request_id UUID,
  p_review_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  request_id UUID,
  folio TEXT,
  approved_payment_id UUID,
  amount NUMERIC,
  status TEXT,
  reviewed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_user_id UUID := auth.uid();
  v_user_role TEXT;
  v_request public.partner_payment_verification_requests%ROWTYPE;
  v_approved_payment_id UUID;
  v_current_balance NUMERIC;
  v_total_due NUMERIC;
  v_total_paid NUMERIC;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF v_current_user_id IS NULL THEN RAISE EXCEPTION 'User not authenticated'; END IF;
  SELECT role INTO v_user_role FROM public.user_profiles WHERE id = v_current_user_id;
  IF v_user_role <> 'admin' THEN RAISE EXCEPTION 'Only administrators can approve payment requests'; END IF;
  SELECT * INTO v_request FROM public.partner_payment_verification_requests
  WHERE id = p_request_id FOR UPDATE;
  IF v_request IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_request.status = 'approved' AND v_request.approved_payment_id IS NOT NULL THEN
    RETURN QUERY SELECT v_request.id, v_request.folio, v_request.approved_payment_id,
      v_request.amount, v_request.status, v_request.reviewed_at;
    RETURN;
  END IF;
  IF v_request.status <> 'pending_review' THEN RAISE EXCEPTION 'Request is not pending review. Current status: %', v_request.status; END IF;
  IF v_request.payment_method = 'transfer' AND v_request.proof_path IS NULL THEN
    RAISE EXCEPTION 'Transfer payment must have proof before approval';
  END IF;
  IF v_request.scheme = 'comodato' THEN
    PERFORM 1 FROM public.commercial_partner_movements AS movement
    WHERE movement.id = v_request.movement_id FOR UPDATE;
    SELECT public.get_comodato_movement_pending_balance(v_request.movement_id) INTO v_current_balance;
    IF v_current_balance IS NULL OR v_current_balance + 0.005 < v_request.amount THEN
      RAISE EXCEPTION 'Current balance insufficient for this payment. Available: %', v_current_balance;
    END IF;
    INSERT INTO public.commercial_partner_payments (
      partner_id, movement_id, payment_date, amount, payment_method, reference,
      notes, received_by, status, created_at, updated_at
    ) VALUES (
      v_request.partner_id, v_request.movement_id, v_now, v_request.amount,
      v_request.payment_method, v_request.payment_reference, v_request.notes,
      v_request.submitted_by, 'completed', v_now, v_now
    ) RETURNING id INTO v_approved_payment_id;
  ELSIF v_request.scheme = 'mayoreo' THEN
    SELECT pending_amount INTO v_current_balance FROM public.v_wholesale_order_totals
    WHERE wholesale_order_id = v_request.wholesale_order_id;
    IF v_current_balance IS NULL THEN
      SELECT COALESCE(total_amount, 0) INTO v_total_due
      FROM public.wholesale_orders WHERE id = v_request.wholesale_order_id;
      SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
      FROM public.wholesale_payments
      WHERE wholesale_order_id = v_request.wholesale_order_id AND status IN ('completed', 'paid');
      v_current_balance := v_total_due - v_total_paid;
    END IF;
    IF v_current_balance IS NULL OR v_current_balance + 0.005 < v_request.amount THEN
      RAISE EXCEPTION 'Current balance insufficient for this payment. Available: %', v_current_balance;
    END IF;
    INSERT INTO public.wholesale_payments (
      partner_id, wholesale_order_id, payment_date, amount, payment_method, reference,
      notes, received_by, status, created_at, updated_at
    ) VALUES (
      v_request.partner_id, v_request.wholesale_order_id, v_now, v_request.amount,
      v_request.payment_method, v_request.payment_reference, v_request.notes,
      v_request.submitted_by, 'completed', v_now, v_now
    ) RETURNING id INTO v_approved_payment_id;
  ELSIF v_request.scheme = 'venta_pieza' THEN
    SELECT public.get_piece_sale_pending_balance(v_request.piece_sale_id) INTO v_current_balance;
    IF v_current_balance IS NULL OR v_current_balance + 0.005 < v_request.amount THEN
      RAISE EXCEPTION 'Current balance insufficient for this payment. Available: %', v_current_balance;
    END IF;
    INSERT INTO public.seller_piece_payments (
      seller_id, sale_id, request_id, payment_date, amount, payment_method,
      reference, status, notes, created_at
    ) VALUES (
      v_request.submitted_by, v_request.piece_sale_id, v_request.id, v_now,
      v_request.amount, v_request.payment_method, v_request.payment_reference,
      'completed', v_request.notes, v_now
    ) RETURNING id INTO v_approved_payment_id;
  ELSE
    RAISE EXCEPTION 'Unsupported payment request scheme: %', v_request.scheme;
  END IF;
  UPDATE public.partner_payment_verification_requests
  SET status = 'approved', reviewed_by = v_current_user_id, reviewed_at = v_now,
      review_notes = p_review_notes, approved_payment_id = v_approved_payment_id,
      updated_at = v_now
  WHERE id = v_request.id;
  RETURN QUERY SELECT v_request.id, v_request.folio, v_approved_payment_id,
    v_request.amount, 'approved'::TEXT, v_now;
END;
$$;

CREATE OR REPLACE VIEW public.v_pending_payment_verifications WITH (security_invoker = true) AS
SELECT r.id AS request_id, r.folio, r.scheme, r.partner_id, cp.folio AS partner_folio,
  cp.business_name, cp.responsible_name, r.amount, r.payment_date, r.payment_method,
  r.payment_reference, r.notes, r.proof_path, r.proof_file_name, r.proof_mime_type,
  r.proof_size_bytes, r.submitted_by, up.full_name AS seller_name, r.submitted_at,
  r.movement_id, r.wholesale_order_id,
  CASE WHEN r.scheme = 'comodato' THEN 'COMODATO-' || left(r.movement_id::TEXT, 8)
    WHEN r.scheme = 'mayoreo' THEN wo.order_folio WHEN r.scheme = 'venta_pieza' THEN sale.folio END AS source_folio,
  CASE WHEN r.scheme = 'comodato' THEN COALESCE((
      SELECT SUM(item.amount_due) - COALESCE((
        SELECT SUM(adjustment.amount_adjusted)
        FROM public.commercial_partner_movement_items AS adjustment
        JOIN public.commercial_partner_movements AS adjustment_movement ON adjustment_movement.id = adjustment.movement_id
        JOIN public.commercial_partner_movement_items AS original ON original.id = adjustment.adjusts_movement_item_id
        WHERE original.movement_id = r.movement_id
          AND lower(trim(adjustment_movement.movement_type)) = 'adjustment'
          AND lower(trim(adjustment_movement.status)) = 'completed'
      ), 0)
      FROM public.commercial_partner_movement_items AS item
      WHERE item.movement_id = r.movement_id AND item.quantity_sold > 0), 0)::NUMERIC
    WHEN r.scheme = 'mayoreo' THEN COALESCE((SELECT total_amount FROM public.v_wholesale_order_totals WHERE wholesale_order_id = r.wholesale_order_id), 0)::NUMERIC
    WHEN r.scheme = 'venta_pieza' THEN COALESCE(sale.total_amount, 0)::NUMERIC ELSE 0::NUMERIC END AS source_total,
  CASE WHEN r.scheme = 'comodato' THEN COALESCE((SELECT SUM(amount) FROM public.commercial_partner_payments WHERE movement_id = r.movement_id AND status IN ('completed', 'paid')), 0)::NUMERIC
    WHEN r.scheme = 'mayoreo' THEN COALESCE((SELECT total_paid FROM public.v_wholesale_order_totals WHERE wholesale_order_id = r.wholesale_order_id), 0)::NUMERIC
    WHEN r.scheme = 'venta_pieza' THEN COALESCE((SELECT SUM(amount) FROM public.seller_piece_payments WHERE sale_id = r.piece_sale_id AND status = 'completed'), 0)::NUMERIC ELSE 0::NUMERIC END AS source_paid,
  CASE WHEN r.scheme = 'comodato' THEN public.get_comodato_movement_pending_balance(r.movement_id)
    WHEN r.scheme = 'mayoreo' THEN public.get_wholesale_order_pending_balance(r.wholesale_order_id)
    WHEN r.scheme = 'venta_pieza' THEN public.get_piece_sale_pending_balance(r.piece_sale_id) END::NUMERIC AS current_source_balance,
  CASE WHEN r.scheme = 'venta_pieza' THEN public.get_piece_sale_pending_balance(r.piece_sale_id)
    ELSE public.get_partner_comodato_pending_balance(r.partner_id) + COALESCE((
      SELECT SUM(GREATEST(COALESCE(total.pending_amount, 0), 0))
      FROM public.v_wholesale_order_totals AS total JOIN public.wholesale_orders AS order_row ON order_row.id = total.wholesale_order_id
      WHERE order_row.partner_id = r.partner_id), 0) END::NUMERIC AS current_partner_balance,
  floor(extract(epoch FROM now() - r.submitted_at) / 60)::INTEGER AS minutes_since_submission,
  r.piece_sale_id,
  CASE WHEN r.scheme = 'venta_pieza' THEN COALESCE((SELECT SUM(quantity)::INTEGER FROM public.seller_piece_sale_items WHERE sale_id = r.piece_sale_id), 0) END AS piece_units
FROM public.partner_payment_verification_requests AS r
LEFT JOIN public.commercial_partners AS cp ON cp.id = r.partner_id
LEFT JOIN public.user_profiles AS up ON up.id = r.submitted_by
LEFT JOIN public.commercial_partner_movements AS movement ON movement.id = r.movement_id
LEFT JOIN public.wholesale_orders AS wo ON wo.id = r.wholesale_order_id
LEFT JOIN public.seller_piece_sales AS sale ON sale.id = r.piece_sale_id
WHERE r.status = 'pending_review'
  AND (r.scheme <> 'comodato' OR lower(trim(COALESCE(movement.status, ''))) = 'completed')
  AND (r.scheme <> 'mayoreo' OR lower(trim(COALESCE(wo.order_status, ''))) IN ('delivered', 'completed'))
ORDER BY r.submitted_at DESC;

REVOKE ALL ON FUNCTION public.admin_adjust_comodato_balance(UUID, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_adjust_comodato_balance(UUID, JSONB, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_comodato_balance(UUID, JSONB, TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public._admin_comodato_adjustment_write_guard() FROM PUBLIC, anon, authenticated;

-- These reports keep their existing JSON contracts.  Only their Comodato
-- generated amount is made effective; quantities remain the historical
-- settlement quantities, which is intentional for the operational history.
DO $$
DECLARE
  v_definition TEXT;
  v_old_expression TEXT;
  v_new_expression TEXT;
BEGIN
  v_old_expression := 'COALESCE(SUM(item.amount_due) FILTER (WHERE COALESCE(item.quantity_sold, 0) > 0), 0)::NUMERIC AS amount,';
  v_new_expression := 'COALESCE(SUM(GREATEST(item.amount_due - COALESCE((SELECT SUM(adjustment.amount_adjusted) FROM public.commercial_partner_movement_items AS adjustment JOIN public.commercial_partner_movements AS adjustment_movement ON adjustment_movement.id = adjustment.movement_id WHERE adjustment.adjusts_movement_item_id = item.id AND lower(trim(adjustment_movement.movement_type)) = ''adjustment'' AND lower(trim(adjustment_movement.status)) = ''completed''), 0), 0)) FILTER (WHERE COALESCE(item.quantity_sold, 0) > 0), 0)::NUMERIC AS amount,';
  SELECT pg_get_functiondef('public.get_b2b_monthly_analysis(date,date)'::REGPROCEDURE) INTO v_definition;
  IF position('amount_adjusted' IN lower(v_definition)) = 0 THEN
    IF position(v_old_expression IN v_definition) = 0 THEN
      RAISE EXCEPTION 'The deployed get_b2b_monthly_analysis definition does not match its versioned Comodato amount contract';
    END IF;
    EXECUTE replace(v_definition, v_old_expression, v_new_expression);
  END IF;

  v_old_expression := 'COALESCE(SUM(item.amount_due), 0)::NUMERIC AS total_due,';
  v_new_expression := 'COALESCE(SUM(GREATEST(item.amount_due - COALESCE((SELECT SUM(adjustment.amount_adjusted) FROM public.commercial_partner_movement_items AS adjustment JOIN public.commercial_partner_movements AS adjustment_movement ON adjustment_movement.id = adjustment.movement_id WHERE adjustment.adjusts_movement_item_id = item.id AND lower(trim(adjustment_movement.movement_type)) = ''adjustment'' AND lower(trim(adjustment_movement.status)) = ''completed''), 0), 0)), 0)::NUMERIC AS total_due,';
  SELECT pg_get_functiondef('public.get_b2b_monthly_collections_report(date,date)'::REGPROCEDURE) INTO v_definition;
  IF position('amount_adjusted' IN lower(v_definition)) = 0 THEN
    IF position(v_old_expression IN v_definition) = 0 THEN
      RAISE EXCEPTION 'The deployed get_b2b_monthly_collections_report definition does not match its versioned Comodato total contract';
    END IF;
    EXECUTE replace(v_definition, v_old_expression, v_new_expression);
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
