BEGIN;

DO $$
DECLARE
  v_comodato_payment_trigger_count INTEGER;
  v_bonus_unique_index_count INTEGER;
BEGIN
  IF to_regclass('public.commercial_prospect_conversions') IS NULL
    OR to_regclass('public.commercial_prospects') IS NULL
    OR to_regclass('public.commercial_partners') IS NULL
    OR to_regclass('public.commercial_partner_movements') IS NULL
    OR to_regclass('public.commercial_partner_movement_items') IS NULL
    OR to_regclass('public.commercial_partner_payments') IS NULL
    OR to_regclass('public.commission_events') IS NULL
    OR to_regclass('public.commission_rules') IS NULL
    OR to_regclass('public.v_commission_event_payment_balances') IS NULL THEN
    RAISE EXCEPTION 'Required prospect, payment, or commission relations are missing';
  END IF;

  IF to_regprocedure('public.sync_comodato_commissions_for_movement(uuid)') IS NULL
    OR to_regprocedure('public.log_commission_sync_issue(text,uuid,uuid,text,uuid,uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Required commission synchronization functions are missing';
  END IF;

  SELECT count(*)::INTEGER
  INTO v_comodato_payment_trigger_count
  FROM pg_trigger AS trigger_row
  JOIN pg_proc AS trigger_function ON trigger_function.oid = trigger_row.tgfoid
  WHERE trigger_row.tgrelid = 'public.commercial_partner_payments'::REGCLASS
    AND NOT trigger_row.tgisinternal
    AND trigger_row.tgname = 'trg_sync_comodato_payment'
    AND lower(pg_get_functiondef(trigger_function.oid))
      LIKE '%sync_comodato_commissions_for_movement%';

  IF v_comodato_payment_trigger_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one canonical Comodato payment synchronization trigger';
  END IF;

  SELECT count(*)::INTEGER
  INTO v_bonus_unique_index_count
  FROM pg_indexes AS index_row
  WHERE index_row.schemaname = 'public'
    AND index_row.tablename = 'commission_events'
    AND index_row.indexdef ILIKE '%UNIQUE%'
    AND index_row.indexdef ILIKE '%partner_id%'
    AND index_row.indexdef ILIKE '%source_type%'
    AND index_row.indexdef ILIKE '%prospect_conversion_bonus%';

  IF v_bonus_unique_index_count = 0 THEN
    RAISE EXCEPTION 'The unique prospect-conversion bonus index is missing';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.prospect_conversion_bonus_eligibility (
  conversion_id UUID PRIMARY KEY
    REFERENCES public.commercial_prospect_conversions(id) ON DELETE RESTRICT,
  prospect_id UUID NOT NULL
    REFERENCES public.commercial_prospects(id) ON DELETE RESTRICT,
  partner_id UUID NOT NULL UNIQUE
    REFERENCES public.commercial_partners(id) ON DELETE RESTRICT,
  originator_user_id UUID NOT NULL
    REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  eligible BOOLEAN NOT NULL,
  rule_id UUID REFERENCES public.commission_rules(id) ON DELETE RESTRICT,
  bonus_amount NUMERIC(12,2),
  evaluated_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT prospect_conversion_bonus_eligibility_value_check CHECK (
    (eligible AND rule_id IS NOT NULL AND bonus_amount = 50.00)
    OR
    (NOT eligible AND rule_id IS NULL AND bonus_amount IS NULL)
  )
);

ALTER TABLE public.prospect_conversion_bonus_eligibility ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prospect_conversion_bonus_eligibility
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_prospect_conversion_bonus_eligibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Prospect conversion bonus eligibility is immutable';
END;
$$;

DROP TRIGGER IF EXISTS protect_prospect_conversion_bonus_eligibility
  ON public.prospect_conversion_bonus_eligibility;
CREATE TRIGGER protect_prospect_conversion_bonus_eligibility
BEFORE UPDATE OR DELETE ON public.prospect_conversion_bonus_eligibility
FOR EACH ROW EXECUTE FUNCTION public.protect_prospect_conversion_bonus_eligibility();

CREATE OR REPLACE FUNCTION public._capture_prospect_conversion_bonus_eligibility(
  p_conversion_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversion public.commercial_prospect_conversions%ROWTYPE;
  v_originator_role TEXT;
  v_originator_active BOOLEAN := FALSE;
  v_partner_model TEXT;
  v_partner_status TEXT;
  v_partner_active BOOLEAN := FALSE;
  v_rule public.commission_rules%ROWTYPE;
  v_eligible BOOLEAN := FALSE;
  v_reason TEXT;
BEGIN
  IF p_conversion_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('prospect-conversion-bonus-eligibility:' || p_conversion_id::TEXT, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.prospect_conversion_bonus_eligibility AS snapshot
    WHERE snapshot.conversion_id = p_conversion_id
  ) THEN
    RETURN;
  END IF;

  SELECT conversion.*
  INTO v_conversion
  FROM public.commercial_prospect_conversions AS conversion
  WHERE conversion.id = p_conversion_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT profile.role, profile.is_active
  INTO v_originator_role, v_originator_active
  FROM public.user_profiles AS profile
  WHERE profile.id = v_conversion.originator_user_id;

  SELECT lower(btrim(partner.partner_model::TEXT)), lower(btrim(partner.status::TEXT)), partner.active
  INTO v_partner_model, v_partner_status, v_partner_active
  FROM public.commercial_partners AS partner
  WHERE partner.id = v_conversion.commercial_partner_id;

  SELECT rule.*
  INTO v_rule
  FROM public.commission_rules AS rule
  WHERE rule.scheme = 'prospect_conversion'
    AND rule.product_key = 'first_paid_comodato_settlement'
    AND rule.active
    AND rule.commission_amount = 50.00
    AND rule.valid_from <= (v_conversion.converted_at AT TIME ZONE 'America/Mexico_City')::DATE
    AND (
      rule.valid_to IS NULL
      OR rule.valid_to >= (v_conversion.converted_at AT TIME ZONE 'America/Mexico_City')::DATE
    )
  ORDER BY rule.valid_from DESC, rule.created_at DESC, rule.id
  LIMIT 1;

  v_eligible := v_originator_role = 'vendedora'
    AND COALESCE(v_originator_active, FALSE)
    AND v_partner_model = 'comodato'
    AND v_partner_status = 'activo'
    AND COALESCE(v_partner_active, FALSE)
    AND v_rule.id IS NOT NULL;

  v_reason := CASE
    WHEN v_originator_role IS DISTINCT FROM 'vendedora' THEN 'originator_not_vendedora_at_conversion'
    WHEN NOT COALESCE(v_originator_active, FALSE) THEN 'originator_inactive_at_conversion'
    WHEN v_partner_model IS DISTINCT FROM 'comodato' THEN 'partner_not_comodato_at_conversion'
    WHEN v_partner_status IS DISTINCT FROM 'activo' OR NOT COALESCE(v_partner_active, FALSE)
      THEN 'partner_inactive_at_conversion'
    WHEN v_rule.id IS NULL THEN 'exact_fifty_peso_rule_missing_at_conversion'
    ELSE 'eligible_at_conversion'
  END;

  INSERT INTO public.prospect_conversion_bonus_eligibility (
    conversion_id,
    prospect_id,
    partner_id,
    originator_user_id,
    eligible,
    rule_id,
    bonus_amount,
    evaluated_at,
    reason,
    metadata
  ) VALUES (
    v_conversion.id,
    v_conversion.prospect_id,
    v_conversion.commercial_partner_id,
    v_conversion.originator_user_id,
    v_eligible,
    CASE WHEN v_eligible THEN v_rule.id ELSE NULL END,
    CASE WHEN v_eligible THEN 50.00 ELSE NULL END,
    v_conversion.converted_at,
    v_reason,
    jsonb_build_object(
      'captured_during_conversion', TRUE,
      'converted_at', v_conversion.converted_at
    )
  )
  ON CONFLICT (conversion_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public._capture_prospect_conversion_bonus_eligibility(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_prospect_conversion_bonus_eligibility()
  FROM PUBLIC, anon, authenticated;

INSERT INTO public.prospect_conversion_bonus_eligibility (
  conversion_id,
  prospect_id,
  partner_id,
  originator_user_id,
  eligible,
  rule_id,
  bonus_amount,
  evaluated_at,
  reason,
  metadata
)
SELECT
  conversion.id,
  conversion.prospect_id,
  conversion.commercial_partner_id,
  conversion.originator_user_id,
  existing_event.id IS NOT NULL
    AND existing_event.commission_amount = 50.00
    AND existing_event.rule_id IS NOT NULL,
  CASE
    WHEN existing_event.id IS NOT NULL
      AND existing_event.commission_amount = 50.00
      AND existing_event.rule_id IS NOT NULL
      THEN existing_event.rule_id
    ELSE NULL
  END,
  CASE
    WHEN existing_event.id IS NOT NULL
      AND existing_event.commission_amount = 50.00
      AND existing_event.rule_id IS NOT NULL
      THEN 50.00
    ELSE NULL
  END,
  conversion.converted_at,
  CASE
    WHEN existing_event.id IS NOT NULL
      AND existing_event.commission_amount = 50.00
      AND existing_event.rule_id IS NOT NULL
      THEN 'legacy_eligibility_preserved_from_existing_event'
    ELSE 'legacy_conversion_without_frozen_eligibility'
  END,
  jsonb_build_object(
    'captured_during_conversion', FALSE,
    'legacy_snapshot', TRUE,
    'existing_event_id', existing_event.id,
    'converted_at', conversion.converted_at
  )
FROM public.commercial_prospect_conversions AS conversion
LEFT JOIN public.commission_events AS existing_event
  ON existing_event.partner_id = conversion.commercial_partner_id
 AND existing_event.source_type = 'prospect_conversion_bonus'
ON CONFLICT (conversion_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trg_sync_prospect_bonus_from_conversion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._capture_prospect_conversion_bonus_eligibility(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_prospect_bonus_from_conversion
  ON public.commercial_prospect_conversions;
DROP TRIGGER IF EXISTS trg_sync_prospect_bonus_from_conversion
  ON public.commercial_prospect_conversions;
CREATE TRIGGER trg_sync_prospect_bonus_from_conversion
AFTER INSERT ON public.commercial_prospect_conversions
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_prospect_bonus_from_conversion();

REVOKE ALL ON FUNCTION public.trg_sync_prospect_bonus_from_conversion()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_prospect_conversion_bonus(p_partner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversion public.commercial_prospect_conversions%ROWTYPE;
  v_snapshot public.prospect_conversion_bonus_eligibility%ROWTYPE;
  v_movement RECORD;
  v_event public.commission_events%ROWTYPE;
  v_paid NUMERIC := 0;
  v_reserved NUMERIC := 0;
  v_has_economic_lock BOOLEAN := FALSE;
  v_inserted_event_id UUID;
BEGIN
  IF p_partner_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('prospect-bonus:' || p_partner_id::TEXT, 0));

  SELECT conversion.*
  INTO v_conversion
  FROM public.commercial_prospect_conversions AS conversion
  WHERE conversion.commercial_partner_id = p_partner_id;

  IF v_conversion.id IS NULL THEN
    RETURN;
  END IF;

  SELECT snapshot.*
  INTO v_snapshot
  FROM public.prospect_conversion_bonus_eligibility AS snapshot
  WHERE snapshot.conversion_id = v_conversion.id
    AND snapshot.partner_id = v_conversion.commercial_partner_id
    AND snapshot.originator_user_id = v_conversion.originator_user_id
  FOR UPDATE;

  IF v_snapshot.conversion_id IS NULL THEN
    RETURN;
  END IF;

  SELECT event.*
  INTO v_event
  FROM public.commission_events AS event
  WHERE event.partner_id = p_partner_id
    AND event.source_type = 'prospect_conversion_bonus'
  FOR UPDATE;

  IF v_event.id IS NOT NULL THEN
    SELECT
      COALESCE(balance.paid_amount, 0),
      COALESCE(balance.reserved_amount, 0)
    INTO v_paid, v_reserved
    FROM public.v_commission_event_payment_balances AS balance
    WHERE balance.commission_event_id = v_event.id;

    v_has_economic_lock := COALESCE(v_paid, 0) > 0.005
      OR COALESCE(v_reserved, 0) > 0.005
      OR v_event.status = 'paid';
  END IF;

  IF NOT v_snapshot.eligible THEN
    IF v_event.id IS NOT NULL AND v_has_economic_lock THEN
      PERFORM public.log_commission_sync_issue(
        'other', p_partner_id, v_event.seller_id,
        'prospect_conversion_bonus', v_event.source_id, v_conversion.id,
        'An economically locked prospect bonus has no frozen eligible conversion snapshot.',
        jsonb_build_object(
          'event_id', v_event.id,
          'snapshot_reason', v_snapshot.reason,
          'paid_amount', v_paid,
          'reserved_amount', v_reserved
        )
      );
    ELSIF v_event.id IS NOT NULL AND v_event.status <> 'cancelled' THEN
      UPDATE public.commission_events
      SET status = 'cancelled',
          available_at = NULL,
          cancelled_at = now(),
          cancellation_reason = 'Conversion eligibility was not frozen at conversion time',
          metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
            'bonus_timing_correction', TRUE,
            'eligibility_reason', v_snapshot.reason
          ),
          updated_at = now()
      WHERE id = v_event.id;
    END IF;
    RETURN;
  END IF;

  SELECT
    movement.id,
    movement.adjustment_folio,
    due.effective_due,
    GREATEST(due.effective_due - payments.total_paid, 0)::NUMERIC AS pending_balance,
    fully_paid.payment_moment AS fully_paid_at
  INTO v_movement
  FROM public.commercial_partner_movements AS movement
  CROSS JOIN LATERAL (
    SELECT
      COALESCE((
        SELECT sum(COALESCE(item.amount_due, 0))
        FROM public.commercial_partner_movement_items AS item
        WHERE item.movement_id = movement.id
          AND COALESCE(item.quantity_sold, 0) > 0
      ), 0)
      - COALESCE((
        SELECT sum(COALESCE(adjustment.amount_adjusted, 0))
        FROM public.commercial_partner_movement_items AS adjustment
        JOIN public.commercial_partner_movements AS adjustment_movement
          ON adjustment_movement.id = adjustment.movement_id
        JOIN public.commercial_partner_movement_items AS original
          ON original.id = adjustment.adjusts_movement_item_id
        WHERE original.movement_id = movement.id
          AND lower(btrim(adjustment_movement.movement_type)) = 'adjustment'
          AND lower(btrim(adjustment_movement.status)) = 'completed'
      ), 0) AS effective_due
  ) AS due
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(COALESCE(payment.amount, 0)), 0)::NUMERIC AS total_paid
    FROM public.commercial_partner_payments AS payment
    WHERE payment.movement_id = movement.id
      AND lower(btrim(payment.status)) IN ('completed', 'paid')
  ) AS payments
  LEFT JOIN LATERAL (
    SELECT payment_progress.payment_moment
    FROM (
      SELECT
        COALESCE(payment.payment_date, payment.created_at) AS payment_moment,
        sum(COALESCE(payment.amount, 0)) OVER (
          ORDER BY COALESCE(payment.payment_date, payment.created_at), payment.created_at, payment.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS running_paid
      FROM public.commercial_partner_payments AS payment
      WHERE payment.movement_id = movement.id
        AND lower(btrim(payment.status)) IN ('completed', 'paid')
    ) AS payment_progress
    WHERE payment_progress.running_paid + 0.005 >= due.effective_due
    ORDER BY payment_progress.payment_moment
    LIMIT 1
  ) AS fully_paid ON TRUE
  WHERE movement.partner_id = p_partner_id
    AND lower(btrim(movement.movement_type)) = 'settlement'
    AND lower(btrim(movement.status)) = 'completed'
    AND movement.movement_date >= v_conversion.converted_at
    AND due.effective_due > 0.005
    AND GREATEST(due.effective_due - payments.total_paid, 0) <= 0.005
    AND fully_paid.payment_moment IS NOT NULL
    AND fully_paid.payment_moment >= v_conversion.converted_at
  ORDER BY movement.movement_date, movement.created_at, movement.id
  LIMIT 1
  FOR UPDATE OF movement;

  IF v_movement.id IS NULL THEN
    IF v_event.id IS NOT NULL AND v_has_economic_lock THEN
      PERFORM public.log_commission_sync_issue(
        'other', p_partner_id, v_event.seller_id,
        'prospect_conversion_bonus', v_event.source_id, v_conversion.id,
        'An economically locked prospect bonus has no fully paid qualifying settlement.',
        jsonb_build_object(
          'event_id', v_event.id,
          'paid_amount', v_paid,
          'reserved_amount', v_reserved
        )
      );
    ELSIF v_event.id IS NOT NULL AND v_event.status <> 'cancelled' THEN
      UPDATE public.commission_events
      SET status = 'cancelled',
          available_at = NULL,
          cancelled_at = now(),
          cancellation_reason = 'Bonus deferred until the first fully paid qualifying settlement',
          metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
            'bonus_timing_correction', TRUE,
            'awaiting_first_fully_paid_settlement', TRUE
          ),
          updated_at = now()
      WHERE id = v_event.id;
    END IF;
    RETURN;
  END IF;

  IF v_event.id IS NOT NULL AND v_has_economic_lock THEN
    IF v_event.seller_id IS DISTINCT FROM v_snapshot.originator_user_id
      OR v_event.source_id IS DISTINCT FROM v_movement.id
      OR v_event.commission_amount IS DISTINCT FROM 50.00
      OR v_event.status NOT IN ('available', 'paid') THEN
      PERFORM public.log_commission_sync_issue(
        'other', p_partner_id, v_event.seller_id,
        'prospect_conversion_bonus', v_event.source_id, v_conversion.id,
        'A reserved or paid prospect bonus conflicts with the frozen eligible conversion.',
        jsonb_build_object(
          'event_id', v_event.id,
          'expected_seller_id', v_snapshot.originator_user_id,
          'expected_settlement_id', v_movement.id,
          'expected_amount', 50.00,
          'paid_amount', v_paid,
          'reserved_amount', v_reserved
        )
      );
    END IF;
    RETURN;
  END IF;

  IF v_event.id IS NOT NULL THEN
    UPDATE public.commission_events
    SET seller_id = v_snapshot.originator_user_id,
        source_id = v_movement.id,
        source_item_id = v_conversion.id,
        source_folio = COALESCE(
          v_movement.adjustment_folio,
          'COMODATO-' || left(v_movement.id::TEXT, 8)
        ),
        rule_id = v_snapshot.rule_id,
        product_key = 'first_paid_comodato_settlement',
        product_name = 'Bono por prospecto convertido y primer corte pagado',
        quantity = 1,
        unit_commission = 50.00,
        commission_amount = 50.00,
        release_condition = 'full_payment',
        status = 'available',
        earned_at = v_movement.fully_paid_at,
        available_at = v_movement.fully_paid_at,
        cancelled_at = NULL,
        cancellation_reason = NULL,
        metadata = jsonb_build_object(
          'prospect_id', v_conversion.prospect_id,
          'conversion_id', v_conversion.id,
          'converted_at', v_conversion.converted_at,
          'qualifying_settlement_id', v_movement.id,
          'effective_due', v_movement.effective_due,
          'fully_paid_at', v_movement.fully_paid_at,
          'eligibility_snapshot_reason', v_snapshot.reason
        ),
        updated_at = now()
    WHERE id = v_event.id;
    RETURN;
  END IF;

  INSERT INTO public.commission_events (
    seller_id,
    partner_id,
    source_type,
    source_id,
    source_item_id,
    source_folio,
    rule_id,
    product_key,
    product_name,
    quantity,
    unit_commission,
    commission_amount,
    release_condition,
    status,
    earned_at,
    available_at,
    metadata,
    created_by
  ) VALUES (
    v_snapshot.originator_user_id,
    p_partner_id,
    'prospect_conversion_bonus',
    v_movement.id,
    v_conversion.id,
    COALESCE(v_movement.adjustment_folio, 'COMODATO-' || left(v_movement.id::TEXT, 8)),
    v_snapshot.rule_id,
    'first_paid_comodato_settlement',
    'Bono por prospecto convertido y primer corte pagado',
    1,
    50.00,
    50.00,
    'full_payment',
    'available',
    v_movement.fully_paid_at,
    v_movement.fully_paid_at,
    jsonb_build_object(
      'prospect_id', v_conversion.prospect_id,
      'conversion_id', v_conversion.id,
      'converted_at', v_conversion.converted_at,
      'qualifying_settlement_id', v_movement.id,
      'effective_due', v_movement.effective_due,
      'fully_paid_at', v_movement.fully_paid_at,
      'eligibility_snapshot_reason', v_snapshot.reason
    ),
    v_conversion.converted_by
  )
  ON CONFLICT (partner_id, source_type)
    WHERE source_type = 'prospect_conversion_bonus'
  DO NOTHING
  RETURNING id INTO v_inserted_event_id;

  IF v_inserted_event_id IS NULL THEN
    PERFORM public.log_commission_sync_issue(
      'other', p_partner_id, v_snapshot.originator_user_id,
      'prospect_conversion_bonus', v_movement.id, v_conversion.id,
      'Concurrent prospect bonus creation was resolved by the unique partner index.',
      jsonb_build_object(
        'conversion_id', v_conversion.id,
        'qualifying_settlement_id', v_movement.id
      )
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_prospect_conversion_bonus(UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_sync_prospect_bonus_from_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_prospect_conversion_bonus(OLD.partner_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.partner_id IS NOT NULL
    AND OLD.partner_id IS DISTINCT FROM NEW.partner_id THEN
    PERFORM public.sync_prospect_conversion_bonus(OLD.partner_id);
  END IF;

  IF NEW.partner_id IS NOT NULL THEN
    PERFORM public.sync_prospect_conversion_bonus(NEW.partner_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_prospect_bonus_from_payment
  ON public.commercial_partner_payments;
DROP TRIGGER IF EXISTS trg_sync_prospect_conversion_bonus_payment
  ON public.commercial_partner_payments;
CREATE TRIGGER trg_sync_prospect_conversion_bonus_payment
AFTER INSERT OR UPDATE OR DELETE ON public.commercial_partner_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_prospect_bonus_from_payment();

REVOKE ALL ON FUNCTION public.trg_sync_prospect_bonus_from_payment()
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r_partner RECORD;
BEGIN
  FOR r_partner IN
    SELECT DISTINCT event.partner_id
    FROM public.commission_events AS event
    WHERE event.source_type = 'prospect_conversion_bonus'
      AND event.partner_id IS NOT NULL
  LOOP
    PERFORM public.sync_prospect_conversion_bonus(r_partner.partner_id);
  END LOOP;
END;
$$;

COMMIT;
