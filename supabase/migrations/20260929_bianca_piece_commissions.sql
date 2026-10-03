BEGIN;

DO $$
BEGIN
  IF to_regclass('public.commission_events') IS NULL
     OR to_regclass('public.commission_rules') IS NULL
     OR to_regclass('public.commercial_prospect_conversions') IS NULL
     OR to_regprocedure('public.commission_settlement_candidate_events(uuid,date,date)') IS NULL
     OR to_regprocedure('public.get_commission_settlement_preview(uuid,date,date)') IS NULL
     OR to_regprocedure('public.create_commission_settlement(uuid,date,date,numeric)') IS NULL
     OR to_regprocedure('public.sync_pos_commission_for_sale_item(uuid)') IS NULL
     OR to_regprocedure('public.sync_comodato_commissions_for_movement(uuid)') IS NULL
     OR to_regprocedure('public.sync_wholesale_commissions_for_order(uuid)') IS NULL
     OR to_regprocedure('public.sync_prospect_conversion_bonus(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required deployed commission objects are missing';
  END IF;
END;
$$;

SELECT pg_advisory_xact_lock(hashtextextended('20260929_bianca_piece_commissions', 0));

ALTER TABLE public.commission_rules
  DROP CONSTRAINT commission_rules_scheme_check;
ALTER TABLE public.commission_rules
  ADD CONSTRAINT commission_rules_scheme_check CHECK (
    scheme IN (
      'comodato', 'mayoreo', 'conversion', 'venta_pieza',
      'prospect_conversion', 'vendedora_pos', 'prospect_origin'
    )
  );

ALTER TABLE public.commission_events
  DROP CONSTRAINT commission_events_source_type_check;
ALTER TABLE public.commission_events
  ADD CONSTRAINT commission_events_source_type_check CHECK (
    source_type IN (
      'comodato_sale', 'wholesale_sale', 'conversion_bonus', 'piece_sale',
      'adjustment', 'pos_sale', 'prospect_conversion_bonus', 'prospect_origin_sale'
    )
  );

-- The effective date is deliberately fixed. Source synchronizers select rules by
-- the business date, so replaying an older source cannot create historical debt.
INSERT INTO public.commission_rules (
  scheme, product_key, product_name, commission_type, commission_amount,
  currency, valid_from, active, notes
)
SELECT
  scheme,
  product_key,
  product_name,
  'per_unit',
  commission_amount,
  'MXN',
  DATE '2026-09-30',
  TRUE,
  'Prospective Bianca per-piece program. Effective 2026-09-30.'
FROM (
  VALUES
    ('vendedora_pos', 'michi_clasico', 'Michi clásico', 2.00::NUMERIC),
    ('vendedora_pos', 'michi_sabores', 'Michi sabores', 2.00::NUMERIC),
    ('vendedora_pos', 'caramelo_michi', 'Caramelo Michi', 2.00::NUMERIC),
    ('vendedora_pos', 'gato_mayor_clasico', 'Gato Mayor clásico', 5.00::NUMERIC),
    ('vendedora_pos', 'gato_mayor_sabores', 'Gato Mayor sabores', 5.00::NUMERIC),
    ('vendedora_pos', 'caramelo_gato_mayor', 'Caramelo Gato Mayor', 5.00::NUMERIC),
    ('vendedora_pos', 'jefe_felino_clasico', 'Jefe Felino clásico', 10.00::NUMERIC),
    ('vendedora_pos', 'jefe_felino_sabores', 'Jefe Felino sabores', 10.00::NUMERIC),
    ('prospect_origin', 'michi_clasico', 'Michi clásico', 2.00::NUMERIC),
    ('prospect_origin', 'michi_sabores', 'Michi sabores', 2.00::NUMERIC),
    ('prospect_origin', 'caramelo_michi', 'Caramelo Michi', 2.00::NUMERIC),
    ('prospect_origin', 'gato_mayor_clasico', 'Gato Mayor clásico', 5.00::NUMERIC),
    ('prospect_origin', 'gato_mayor_sabores', 'Gato Mayor sabores', 5.00::NUMERIC),
    ('prospect_origin', 'caramelo_gato_mayor', 'Caramelo Gato Mayor', 5.00::NUMERIC),
    ('prospect_origin', 'jefe_felino_clasico', 'Jefe Felino clásico', 10.00::NUMERIC),
    ('prospect_origin', 'jefe_felino_sabores', 'Jefe Felino sabores', 10.00::NUMERIC)
) AS rule_seed(scheme, product_key, product_name, commission_amount)
ON CONFLICT (scheme, product_key, valid_from) DO UPDATE
SET product_name = EXCLUDED.product_name,
    commission_type = EXCLUDED.commission_type,
    commission_amount = EXCLUDED.commission_amount,
    currency = EXCLUDED.currency,
    active = EXCLUDED.active,
    notes = EXCLUDED.notes,
    updated_at = now();

-- Persist the eligibility observed when a source operation first becomes
-- commissionable. This prevents later role/reactivation changes from creating
-- retroactive Bianca commissions.
CREATE TABLE public.commission_program_eligibility_snapshots (
  program TEXT NOT NULL CHECK (program IN ('vendedora_pos', 'prospect_origin')),
  commercial_scheme TEXT NOT NULL CHECK (commercial_scheme IN ('pos', 'comodato', 'mayoreo')),
  source_item_id UUID NOT NULL,
  source_id UUID NOT NULL,
  partner_id UUID,
  seller_id UUID,
  eligible BOOLEAN NOT NULL,
  rule_id UUID REFERENCES public.commission_rules(id) ON DELETE RESTRICT,
  unit_commission NUMERIC(12,2),
  operation_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (program, commercial_scheme, source_item_id),
  CHECK (
    (eligible AND seller_id IS NOT NULL AND rule_id IS NOT NULL AND unit_commission > 0)
    OR
    (NOT eligible)
  )
);

ALTER TABLE public.commission_program_eligibility_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commission_program_eligibility_snapshots FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_commercial_prospect_conversion_attribution()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Commercial prospect conversion attribution cannot be deleted';
  END IF;

  IF NEW.originator_user_id IS DISTINCT FROM OLD.originator_user_id
     OR NEW.prospect_id IS DISTINCT FROM OLD.prospect_id
     OR NEW.commercial_partner_id IS DISTINCT FROM OLD.commercial_partner_id THEN
    RAISE EXCEPTION 'Commercial prospect conversion attribution is immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_commercial_prospect_conversion_attribution
  ON public.commercial_prospect_conversions;
CREATE TRIGGER protect_commercial_prospect_conversion_attribution
BEFORE UPDATE OR DELETE ON public.commercial_prospect_conversions
FOR EACH ROW EXECUTE FUNCTION public.protect_commercial_prospect_conversion_attribution();

CREATE OR REPLACE FUNCTION public._commission_event_has_economic_lock(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.v_commission_event_payment_balances AS balance
    WHERE balance.commission_event_id = p_event_id
      AND (
        abs(balance.paid_amount) > 0.005
        OR abs(balance.reserved_amount) > 0.005
        OR balance.payment_status IN ('paid', 'partially_paid')
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.commission_settlement_items AS item
    JOIN public.commission_settlements AS settlement ON settlement.id = item.settlement_id
    WHERE item.commission_event_id = p_event_id
      AND settlement.status <> 'cancelled'
  );
$$;

CREATE OR REPLACE FUNCTION public._cancel_prospect_origin_commissions(
  p_source_id UUID,
  p_commercial_scheme TEXT,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.commission_events%ROWTYPE;
BEGIN
  FOR v_event IN
    SELECT event.*
    FROM public.commission_events AS event
    WHERE event.source_type = 'prospect_origin_sale'
      AND event.source_id = p_source_id
      AND event.metadata->>'commercial_scheme' = p_commercial_scheme
    FOR UPDATE
  LOOP
    IF public._commission_event_has_economic_lock(v_event.id) THEN
      PERFORM public.log_commission_sync_issue(
        'other', v_event.partner_id, v_event.seller_id,
        'prospect_origin_sale', v_event.source_id, v_event.source_item_id,
        'A reserved or paid prospect-origin commission could not be cancelled.',
        jsonb_build_object('event_id', v_event.id, 'reason', p_reason)
      );
    ELSIF v_event.status IN ('pending', 'available') THEN
      UPDATE public.commission_events
      SET status = 'cancelled',
          cancelled_at = now(),
          cancellation_reason = p_reason,
          available_at = NULL,
          updated_at = now()
      WHERE id = v_event.id;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._sync_prospect_origin_commission_event(
  p_partner_id UUID,
  p_source_id UUID,
  p_source_item_id UUID,
  p_source_folio TEXT,
  p_commercial_scheme TEXT,
  p_product_key TEXT,
  p_product_name TEXT,
  p_product_variant TEXT,
  p_product_size TEXT,
  p_quantity NUMERIC,
  p_event_status TEXT,
  p_earned_at TIMESTAMPTZ,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.commission_events%ROWTYPE;
  v_snapshot public.commission_program_eligibility_snapshots%ROWTYPE;
  v_conversion public.commercial_prospect_conversions%ROWTYPE;
  v_profile public.user_profiles%ROWTYPE;
  v_rule_id UUID;
  v_unit_commission NUMERIC;
  v_event_date DATE := (p_earned_at AT TIME ZONE 'America/Mexico_City')::DATE;
  v_locked BOOLEAN := FALSE;
BEGIN
  IF p_commercial_scheme NOT IN ('comodato', 'mayoreo')
     OR p_event_status NOT IN ('pending', 'available') THEN
    RAISE EXCEPTION 'Invalid prospect-origin commission context';
  END IF;

  SELECT event.* INTO v_event
  FROM public.commission_events AS event
  WHERE event.source_type = 'prospect_origin_sale'
    AND event.source_item_id = p_source_item_id
  FOR UPDATE;

  IF v_event.id IS NOT NULL THEN
    v_locked := public._commission_event_has_economic_lock(v_event.id);

    IF COALESCE(p_quantity, 0) <= 0.000001 THEN
      IF v_locked THEN
        PERFORM public.log_commission_sync_issue(
          'other', p_partner_id, v_event.seller_id,
          'prospect_origin_sale', p_source_id, p_source_item_id,
          'A reserved or paid prospect-origin commission no longer has effective units.',
          jsonb_build_object('event_id', v_event.id, 'commercial_scheme', p_commercial_scheme)
        );
      ELSIF v_event.status IN ('pending', 'available') THEN
        UPDATE public.commission_events
        SET status = 'cancelled', cancelled_at = now(), available_at = NULL,
            cancellation_reason = 'The underlying commercial item has no effective commissioned units',
            metadata = COALESCE(metadata, '{}'::JSONB) || COALESCE(p_metadata, '{}'::JSONB),
            updated_at = now()
        WHERE id = v_event.id;
      END IF;
      RETURN;
    END IF;

    IF p_product_key IS NULL THEN
      IF v_locked THEN
        PERFORM public.log_commission_sync_issue(
          'product_without_rule', p_partner_id, v_event.seller_id,
          'prospect_origin_sale', p_source_id, p_source_item_id,
          'A reserved or paid prospect-origin commission now has an unidentified product.',
          jsonb_build_object('event_id', v_event.id, 'commercial_scheme', p_commercial_scheme)
        );
      ELSIF v_event.status IN ('pending', 'available') THEN
        UPDATE public.commission_events
        SET status = 'cancelled', cancelled_at = now(), available_at = NULL,
            cancellation_reason = 'The underlying product is no longer commissionable',
            metadata = COALESCE(metadata, '{}'::JSONB) || COALESCE(p_metadata, '{}'::JSONB),
            updated_at = now()
        WHERE id = v_event.id;
      END IF;
      RETURN;
    END IF;

    IF v_locked THEN
      IF v_event.quantity IS DISTINCT FROM p_quantity
         OR v_event.commission_amount IS DISTINCT FROM round(p_quantity * v_event.unit_commission, 2) THEN
        PERFORM public.log_commission_sync_issue(
          'other', p_partner_id, v_event.seller_id,
          'prospect_origin_sale', p_source_id, p_source_item_id,
          'A reserved or paid prospect-origin commission requires an explicit adjustment.',
          jsonb_build_object(
            'event_id', v_event.id,
            'current_quantity', v_event.quantity,
            'expected_quantity', p_quantity,
            'commercial_scheme', p_commercial_scheme
          )
        );
      END IF;
      RETURN;
    END IF;

    UPDATE public.commission_events
    SET source_id = p_source_id,
        source_folio = p_source_folio,
        product_key = p_product_key,
        product_name = p_product_name,
        product_variant = p_product_variant,
        product_size = p_product_size,
        quantity = p_quantity,
        commission_amount = round(p_quantity * v_event.unit_commission, 2),
        status = p_event_status,
        available_at = CASE
          WHEN p_event_status = 'available' THEN COALESCE(available_at, now())
          ELSE NULL
        END,
        cancelled_at = NULL,
        cancellation_reason = NULL,
        metadata = COALESCE(metadata, '{}'::JSONB)
          || COALESCE(p_metadata, '{}'::JSONB)
          || jsonb_build_object('commercial_scheme', p_commercial_scheme),
        updated_at = now()
    WHERE id = v_event.id;
    RETURN;
  END IF;

  IF COALESCE(p_quantity, 0) <= 0.000001 OR p_product_key IS NULL THEN
    RETURN;
  END IF;

  SELECT snapshot.* INTO v_snapshot
  FROM public.commission_program_eligibility_snapshots AS snapshot
  WHERE snapshot.program = 'prospect_origin'
    AND snapshot.commercial_scheme = p_commercial_scheme
    AND snapshot.source_item_id = p_source_item_id
  FOR UPDATE;

  IF v_snapshot.source_item_id IS NULL THEN
    SELECT conversion.* INTO v_conversion
    FROM public.commercial_prospect_conversions AS conversion
    WHERE conversion.commercial_partner_id = p_partner_id;

    IF v_conversion.id IS NOT NULL THEN
      SELECT profile.* INTO v_profile
      FROM public.user_profiles AS profile
      WHERE profile.id = v_conversion.originator_user_id;
    END IF;

    SELECT rule.id, rule.commission_amount
    INTO v_rule_id, v_unit_commission
    FROM public.commission_rules AS rule
    WHERE rule.scheme = 'prospect_origin'
      AND rule.product_key = p_product_key
      AND rule.active
      AND rule.valid_from <= v_event_date
      AND (rule.valid_to IS NULL OR rule.valid_to >= v_event_date)
    ORDER BY rule.valid_from DESC, rule.created_at DESC
    LIMIT 1;

    INSERT INTO public.commission_program_eligibility_snapshots (
      program, commercial_scheme, source_item_id, source_id, partner_id, seller_id,
      eligible, rule_id, unit_commission, operation_at, reason, metadata
    )
    VALUES (
      'prospect_origin', p_commercial_scheme, p_source_item_id, p_source_id,
      p_partner_id, v_conversion.originator_user_id,
      v_conversion.id IS NOT NULL
        AND v_profile.id IS NOT NULL
        AND v_profile.role = 'vendedora'
        AND v_profile.is_active
        AND v_rule_id IS NOT NULL
        AND COALESCE(v_unit_commission, 0) > 0,
      v_rule_id, v_unit_commission, p_earned_at,
      CASE
        WHEN v_conversion.id IS NULL THEN 'no_prospect_conversion'
        WHEN v_profile.id IS NULL OR v_profile.role <> 'vendedora' OR NOT COALESCE(v_profile.is_active, FALSE)
          THEN 'originator_not_active_vendedora'
        WHEN v_rule_id IS NULL THEN 'no_effective_rule'
        ELSE 'eligible'
      END,
      jsonb_build_object('conversion_id', v_conversion.id, 'product_key', p_product_key)
    )
    ON CONFLICT (program, commercial_scheme, source_item_id) DO NOTHING;

    SELECT snapshot.* INTO v_snapshot
    FROM public.commission_program_eligibility_snapshots AS snapshot
    WHERE snapshot.program = 'prospect_origin'
      AND snapshot.commercial_scheme = p_commercial_scheme
      AND snapshot.source_item_id = p_source_item_id
    FOR UPDATE;
  END IF;

  IF NOT COALESCE(v_snapshot.eligible, FALSE) THEN
    RETURN;
  END IF;

  INSERT INTO public.commission_events (
    seller_id, partner_id, source_type, source_id, source_item_id, source_folio,
    rule_id, product_key, product_name, product_variant, product_size, quantity,
    unit_commission, commission_amount, release_condition, status, earned_at,
    available_at, metadata
  )
  VALUES (
    v_snapshot.seller_id, p_partner_id, 'prospect_origin_sale', p_source_id,
    p_source_item_id, p_source_folio, v_snapshot.rule_id, p_product_key,
    p_product_name, p_product_variant, p_product_size, p_quantity,
    v_snapshot.unit_commission, round(p_quantity * v_snapshot.unit_commission, 2),
    'full_payment', p_event_status, p_earned_at,
    CASE WHEN p_event_status = 'available' THEN now() ELSE NULL END,
    COALESCE(p_metadata, '{}'::JSONB) || jsonb_build_object(
      'commercial_scheme', p_commercial_scheme,
      'conversion_id', v_snapshot.metadata->>'conversion_id',
      'originator_user_id', v_snapshot.seller_id,
      'eligibility_snapshot_created_at', v_snapshot.created_at
    )
  )
  ON CONFLICT (source_type, source_item_id)
    WHERE source_item_id IS NOT NULL AND source_type <> 'adjustment'
  DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_prospect_conversion_bonus(p_partner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversion public.commercial_prospect_conversions%ROWTYPE;
  v_partner public.commercial_partners%ROWTYPE;
  v_originator public.user_profiles%ROWTYPE;
  v_rule public.commission_rules%ROWTYPE;
  v_movement RECORD;
  v_event public.commission_events%ROWTYPE;
  v_paid NUMERIC := 0;
  v_reserved NUMERIC := 0;
  v_status TEXT := 'pending';
BEGIN
  IF p_partner_id IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('prospect-bonus:' || p_partner_id::TEXT, 0));

  SELECT conversion.* INTO v_conversion
  FROM public.commercial_prospect_conversions AS conversion
  WHERE conversion.commercial_partner_id = p_partner_id;
  IF v_conversion.id IS NULL THEN RETURN; END IF;

  SELECT partner.* INTO v_partner
  FROM public.commercial_partners AS partner
  WHERE partner.id = p_partner_id;
  SELECT profile.* INTO v_originator
  FROM public.user_profiles AS profile
  WHERE profile.id = v_conversion.originator_user_id;

  SELECT event.* INTO v_event
  FROM public.commission_events AS event
  WHERE event.partner_id = p_partner_id
    AND event.source_type = 'prospect_conversion_bonus'
  FOR UPDATE;

  IF v_event.id IS NULL THEN
    IF v_partner.id IS NULL
       OR v_partner.partner_model <> 'comodato'
       OR v_partner.status <> 'activo'
       OR NOT v_partner.active
       OR v_originator.role <> 'vendedora'
       OR NOT v_originator.is_active THEN
      RETURN;
    END IF;

    SELECT rule.* INTO v_rule
    FROM public.commission_rules AS rule
    WHERE rule.scheme = 'prospect_conversion'
      AND rule.product_key = 'first_paid_comodato_settlement'
      AND rule.active
      AND rule.valid_from <= (v_conversion.converted_at AT TIME ZONE 'America/Mexico_City')::DATE
      AND (
        rule.valid_to IS NULL
        OR rule.valid_to >= (v_conversion.converted_at AT TIME ZONE 'America/Mexico_City')::DATE
      )
    ORDER BY rule.valid_from DESC, rule.created_at DESC
    LIMIT 1;
    IF v_rule.id IS NULL THEN RETURN; END IF;

    INSERT INTO public.commission_events (
      seller_id, partner_id, source_type, source_id, source_item_id, source_folio,
      rule_id, product_key, product_name, quantity, unit_commission, commission_amount,
      release_condition, status, earned_at, available_at, metadata, created_by
    )
    VALUES (
      v_conversion.originator_user_id, p_partner_id, 'prospect_conversion_bonus',
      NULL, v_conversion.id, 'PROSPECTO-' || left(v_conversion.id::TEXT, 8),
      v_rule.id, v_rule.product_key, v_rule.product_name, 1,
      v_rule.commission_amount, v_rule.commission_amount, 'full_payment', 'pending',
      v_conversion.converted_at, NULL,
      jsonb_build_object(
        'prospect_id', v_conversion.prospect_id,
        'conversion_id', v_conversion.id,
        'converted_at', v_conversion.converted_at,
        'entitlement_created_at', now()
      ),
      v_conversion.converted_by
    )
    ON CONFLICT (partner_id, source_type)
      WHERE source_type = 'prospect_conversion_bonus'
    DO NOTHING;

    SELECT event.* INTO v_event
    FROM public.commission_events AS event
    WHERE event.partner_id = p_partner_id
      AND event.source_type = 'prospect_conversion_bonus'
    FOR UPDATE;
  END IF;

  SELECT balance.paid_amount, balance.reserved_amount
  INTO v_paid, v_reserved
  FROM public.v_commission_event_payment_balances AS balance
  WHERE balance.commission_event_id = v_event.id;

  SELECT movement.id, movement.movement_date, movement.adjustment_folio,
         due.effective_due,
         public.get_comodato_movement_pending_balance(movement.id) AS pending_balance
  INTO v_movement
  FROM public.commercial_partner_movements AS movement
  CROSS JOIN LATERAL (
    SELECT COALESCE((
      SELECT sum(COALESCE(item.amount_due, 0))
      FROM public.commercial_partner_movement_items AS item
      WHERE item.movement_id = movement.id AND COALESCE(item.quantity_sold, 0) > 0
    ), 0) - COALESCE((
      SELECT sum(COALESCE(adjustment.amount_adjusted, 0))
      FROM public.commercial_partner_movement_items AS adjustment
      JOIN public.commercial_partner_movements AS adjustment_movement
        ON adjustment_movement.id = adjustment.movement_id
      JOIN public.commercial_partner_movement_items AS original
        ON original.id = adjustment.adjusts_movement_item_id
      WHERE original.movement_id = movement.id
        AND adjustment_movement.movement_type = 'adjustment'
        AND adjustment_movement.status = 'completed'
    ), 0) AS effective_due
  ) AS due
  WHERE movement.partner_id = p_partner_id
    AND movement.movement_type = 'settlement'
    AND movement.status = 'completed'
    AND movement.movement_date >= v_conversion.converted_at
    AND due.effective_due > 0.005
  ORDER BY movement.movement_date, movement.created_at, movement.id
  LIMIT 1
  FOR UPDATE OF movement;

  IF v_movement.id IS NULL THEN
    IF COALESCE(v_paid, 0) > 0.005 OR COALESCE(v_reserved, 0) > 0.005 OR v_event.status = 'paid' THEN
      PERFORM public.log_commission_sync_issue(
        'other', p_partner_id, v_event.seller_id, 'prospect_conversion_bonus',
        v_event.source_id, v_conversion.id,
        'The qualifying settlement disappeared after the bonus was reserved or paid.',
        jsonb_build_object('event_id', v_event.id, 'paid_amount', v_paid, 'reserved_amount', v_reserved)
      );
    ELSE
      UPDATE public.commission_events
      SET source_id = NULL,
          source_folio = 'PROSPECTO-' || left(v_conversion.id::TEXT, 8),
          status = 'pending', available_at = NULL,
          cancelled_at = NULL, cancellation_reason = NULL,
          metadata = COALESCE(metadata, '{}'::JSONB) - 'qualifying_settlement_id'
            - 'effective_due' || jsonb_build_object('awaiting_first_paid_settlement', TRUE),
          updated_at = now()
      WHERE id = v_event.id;
    END IF;
    RETURN;
  END IF;

  v_status := CASE WHEN v_movement.pending_balance <= 0.005 THEN 'available' ELSE 'pending' END;

  IF COALESCE(v_paid, 0) > 0.005 OR COALESCE(v_reserved, 0) > 0.005 OR v_event.status = 'paid' THEN
    IF v_event.source_id IS DISTINCT FROM v_movement.id THEN
      PERFORM public.log_commission_sync_issue(
        'other', p_partner_id, v_event.seller_id, 'prospect_conversion_bonus',
        v_event.source_id, v_conversion.id,
        'A reserved or paid prospect bonus requires review and was not rewritten.',
        jsonb_build_object('expected_settlement_id', v_movement.id)
      );
    END IF;
    RETURN;
  END IF;

  UPDATE public.commission_events
  SET source_id = v_movement.id,
      source_folio = COALESCE(v_movement.adjustment_folio, 'COMODATO-' || left(v_movement.id::TEXT, 8)),
      status = v_status,
      available_at = CASE WHEN v_status = 'available' THEN COALESCE(available_at, now()) ELSE NULL END,
      cancelled_at = NULL,
      cancellation_reason = NULL,
      metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
        'prospect_id', v_conversion.prospect_id,
        'conversion_id', v_conversion.id,
        'converted_at', v_conversion.converted_at,
        'qualifying_settlement_id', v_movement.id,
        'effective_due', v_movement.effective_due,
        'awaiting_first_paid_settlement', v_status <> 'available'
      ),
      updated_at = now()
  WHERE id = v_event.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_prospect_bonus_from_conversion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.sync_prospect_conversion_bonus(NEW.commercial_partner_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_prospect_bonus_from_conversion
  ON public.commercial_prospect_conversions;
CREATE TRIGGER sync_prospect_bonus_from_conversion
AFTER INSERT ON public.commercial_prospect_conversions
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_prospect_bonus_from_conversion();

CREATE OR REPLACE FUNCTION public.sync_pos_commission_for_sale_item(p_sale_item_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.sale_items%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_profile public.user_profiles%ROWTYPE;
  v_snapshot public.commission_program_eligibility_snapshots%ROWTYPE;
  v_product_name TEXT;
  v_product_key TEXT;
  v_rule_id UUID;
  v_unit_commission NUMERIC := 0;
  v_commission_amount NUMERIC := 0;
  v_business_date DATE;
  v_event_id UUID;
  v_scheme TEXT;
BEGIN
  SELECT item.* INTO v_item FROM public.sale_items AS item WHERE item.id = p_sale_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT sale.* INTO v_sale FROM public.sales AS sale WHERE sale.id = v_item.sale_id;
  IF NOT FOUND OR lower(trim(COALESCE(v_sale.sale_origin, ''))) <> 'pos'
     OR COALESCE(v_sale.is_refunded, FALSE)
     OR v_item.product_id IS NULL OR COALESCE(v_item.is_generic, FALSE) THEN
    RETURN NULL;
  END IF;

  SELECT event.id INTO v_event_id
  FROM public.commission_events AS event
  WHERE event.source_type = 'pos_sale' AND event.source_item_id = v_item.id
  LIMIT 1;
  IF v_event_id IS NOT NULL THEN RETURN v_event_id; END IF;

  SELECT profile.* INTO v_profile
  FROM public.user_profiles AS profile WHERE profile.id = v_sale.cashier_id;
  IF v_profile.id IS NULL THEN RETURN NULL; END IF;

  SELECT product.* INTO v_product
  FROM public.products AS product WHERE product.id = v_item.product_id;
  IF v_product.id IS NULL THEN
    RAISE WARNING
      'POS commission: product_id % no encontrado para sale_item %',
      v_item.product_id, p_sale_item_id;
    RETURN NULL;
  END IF;

  v_product_name := COALESCE(NULLIF(trim(COALESCE(v_product.product_name, '')), ''), v_product.name);
  v_product_key := public.commission_product_key(v_product_name, v_product.flavor);
  v_business_date := (v_sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE;

  -- Preserve the deployed socios_comerciales POS behavior exactly. The new
  -- active-user eligibility requirement applies only to the vendedora program.
  IF v_profile.role = 'socios_comerciales' THEN
    v_scheme := 'venta_pieza';
    v_rule_id := public.get_commission_rule_id(v_scheme, v_product_key, v_business_date);
    v_unit_commission := public.get_commission_rule_amount(v_scheme, v_product_key, v_business_date);
  ELSE
    SELECT snapshot.* INTO v_snapshot
    FROM public.commission_program_eligibility_snapshots AS snapshot
    WHERE snapshot.program = 'vendedora_pos'
      AND snapshot.commercial_scheme = 'pos'
      AND snapshot.source_item_id = v_item.id
    FOR UPDATE;

    IF v_snapshot.source_item_id IS NULL THEN
      v_rule_id := public.get_commission_rule_id('vendedora_pos', v_product_key, v_business_date);
      v_unit_commission := public.get_commission_rule_amount('vendedora_pos', v_product_key, v_business_date);
      INSERT INTO public.commission_program_eligibility_snapshots (
        program, commercial_scheme, source_item_id, source_id, seller_id, eligible,
        rule_id, unit_commission, operation_at, reason, metadata
      ) VALUES (
        'vendedora_pos', 'pos', v_item.id, v_sale.id, v_sale.cashier_id,
        v_profile.role = 'vendedora' AND v_profile.is_active
          AND v_rule_id IS NOT NULL AND COALESCE(v_unit_commission, 0) > 0,
        v_rule_id, v_unit_commission, v_sale.created_at,
        CASE
          WHEN v_profile.role <> 'vendedora' OR NOT v_profile.is_active THEN 'cashier_not_active_vendedora'
          WHEN v_rule_id IS NULL THEN 'no_effective_rule'
          ELSE 'eligible'
        END,
        jsonb_build_object('product_key', v_product_key, 'business_date', v_business_date)
      )
      ON CONFLICT (program, commercial_scheme, source_item_id) DO NOTHING;

      SELECT snapshot.* INTO v_snapshot
      FROM public.commission_program_eligibility_snapshots AS snapshot
      WHERE snapshot.program = 'vendedora_pos'
        AND snapshot.commercial_scheme = 'pos'
        AND snapshot.source_item_id = v_item.id;
    END IF;

    IF NOT COALESCE(v_snapshot.eligible, FALSE) THEN RETURN NULL; END IF;
    v_scheme := 'vendedora_pos';
    v_rule_id := v_snapshot.rule_id;
    v_unit_commission := v_snapshot.unit_commission;
  END IF;

  IF v_rule_id IS NULL OR COALESCE(v_unit_commission, 0) <= 0 THEN
    RAISE WARNING
      'POS commission: sin regla vigente para product_key %, fecha %, sale_item %',
      v_product_key, v_business_date, p_sale_item_id;
    RETURN NULL;
  END IF;
  v_commission_amount := COALESCE(v_item.quantity, 0)::NUMERIC * v_unit_commission;
  IF v_commission_amount <= 0 THEN RETURN NULL; END IF;

  INSERT INTO public.commission_events (
    seller_id, partner_id, source_type, source_id, source_item_id, rule_id,
    product_key, product_name, product_variant, product_size, quantity,
    unit_commission, commission_amount, release_condition, status, earned_at,
    available_at, metadata
  ) VALUES (
    v_sale.cashier_id, NULL, 'pos_sale', v_sale.id, v_item.id, v_rule_id,
    v_product_key, v_product_name, v_product.flavor, v_product.size, v_item.quantity,
    v_unit_commission, v_commission_amount, 'full_payment', 'available',
    v_sale.created_at, v_sale.created_at,
    jsonb_build_object(
      'channel', 'pos', 'cashier_id', v_sale.cashier_id, 'sale_id', v_sale.id,
      'sale_item_id', v_item.id, 'product_id', v_item.product_id,
      'commission_scheme', v_scheme, 'business_date', v_business_date
    )
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT event.id INTO v_event_id FROM public.commission_events AS event
    WHERE event.source_type = 'pos_sale' AND event.source_item_id = v_item.id LIMIT 1;
  END IF;
  RETURN v_event_id;
END;
$$;

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
  v_valid_seller BOOLEAN := FALSE;
  v_effective_quantity NUMERIC;
  r_item RECORD;
BEGIN
  SELECT movement.partner_id, partner.assigned_to, lower(trim(movement.movement_type)),
         lower(trim(movement.status)), movement.movement_date
  INTO v_partner_id, v_seller_id, v_movement_type, v_movement_status, v_movement_date
  FROM public.commercial_partner_movements AS movement
  JOIN public.commercial_partners AS partner ON partner.id = movement.partner_id
  WHERE movement.id = p_movement_id;

  IF NOT FOUND THEN
    UPDATE public.commission_events SET status = 'cancelled', cancelled_at = now(),
      cancellation_reason = 'El movimiento de origen ya no existe', updated_at = now()
    WHERE source_type = 'comodato_sale' AND source_id = p_movement_id
      AND status IN ('pending', 'available');
    PERFORM public._cancel_prospect_origin_commissions(
      p_movement_id, 'comodato', 'El movimiento de origen ya no existe');
    RETURN;
  END IF;

  IF v_movement_type <> 'settlement' OR v_movement_status <> 'completed' THEN
    UPDATE public.commission_events SET status = 'cancelled', cancelled_at = now(),
      cancellation_reason = 'La liquidación dejó de estar completada', updated_at = now()
    WHERE source_type = 'comodato_sale' AND source_id = p_movement_id
      AND status IN ('pending', 'available');
    PERFORM public._cancel_prospect_origin_commissions(
      p_movement_id, 'comodato', 'La liquidación dejó de estar completada');
    RETURN;
  END IF;

  v_valid_seller := v_seller_id IS NOT NULL AND public.is_valid_commission_seller(v_seller_id);
  IF NOT v_valid_seller THEN
    PERFORM public.log_commission_sync_issue(
      'partner_without_seller', v_partner_id, v_seller_id, 'comodato_movement',
      p_movement_id, NULL,
      'La liquidación no puede generar la comisión operativa porque el socio no tiene un vendedor activo asignado.',
      jsonb_build_object('movement_type', v_movement_type, 'movement_status', v_movement_status));
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
    IF r_item.quantity_adjusted_total > r_item.quantity_sold + 0.000001 THEN
      RAISE EXCEPTION 'Adjustment quantity exceeds the original settled quantity for item %', r_item.id;
    END IF;
    v_effective_quantity := r_item.quantity_sold - r_item.quantity_adjusted_total;
    v_product_key := public.commission_product_key(r_item.product_name, r_item.product_variant);

    IF v_valid_seller THEN
      SELECT * INTO v_existing_event FROM public.commission_events
      WHERE source_type = 'comodato_sale' AND source_item_id = r_item.id FOR UPDATE;
      v_has_event := FOUND;

      IF v_effective_quantity <= 0.000001 THEN
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
      ELSIF NOT (v_has_event AND v_existing_event.status = 'cancelled') THEN
        IF v_has_event THEN
          v_rule_id := v_existing_event.rule_id;
          v_rule_amount := v_existing_event.unit_commission;
        ELSE
          v_rule_id := NULL;
          v_rule_amount := NULL;
          IF v_product_key IS NULL THEN
            PERFORM public.log_commission_sync_issue(
              'product_without_rule', v_partner_id, v_seller_id,
              'comodato_movement', p_movement_id, r_item.id,
              'No se pudo identificar el producto para calcular su comisión.',
              jsonb_build_object(
                'product_name', r_item.product_name,
                'product_variant', r_item.product_variant
              )
            );
          ELSE
            SELECT rule.id, rule.commission_amount INTO v_rule_id, v_rule_amount
            FROM public.commission_rules AS rule
            WHERE rule.scheme = 'comodato' AND rule.product_key = v_product_key AND rule.active
              AND rule.valid_from <= v_event_date
              AND (rule.valid_to IS NULL OR rule.valid_to >= v_event_date)
            ORDER BY rule.valid_from DESC LIMIT 1;

            IF v_rule_id IS NULL THEN
              PERFORM public.log_commission_sync_issue(
                'product_without_rule', v_partner_id, v_seller_id,
                'comodato_movement', p_movement_id, r_item.id,
                'No existe una regla de comisión vigente para este producto de comodato.',
                jsonb_build_object('product_key', v_product_key, 'event_date', v_event_date)
              );
            END IF;
          END IF;
        END IF;

        IF v_rule_id IS NOT NULL THEN
          IF v_has_event THEN
            UPDATE public.commission_events
            SET quantity = v_effective_quantity,
                commission_amount = v_effective_quantity * v_rule_amount,
                status = v_event_status,
                available_at = CASE WHEN v_event_status = 'available' THEN COALESCE(available_at, now()) ELSE NULL END,
                metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
                  'total_due', v_total_due, 'total_paid', v_total_paid,
                  'original_quantity_sold', r_item.quantity_sold,
                  'quantity_adjusted', r_item.quantity_adjusted_total,
                  'effective_quantity_sold', v_effective_quantity,
                  'original_amount_due', r_item.amount_due,
                  'amount_adjusted', r_item.amount_adjusted_total,
                  'effective_amount_due', GREATEST(r_item.amount_due - r_item.amount_adjusted_total, 0)),
                updated_at = now()
            WHERE id = v_existing_event.id
              AND NOT public._commission_event_has_economic_lock(v_existing_event.id);
          ELSE
            INSERT INTO public.commission_events (
              seller_id, partner_id, source_type, source_id, source_item_id, source_folio,
              rule_id, product_key, product_name, product_variant, product_size, quantity,
              unit_commission, commission_amount, release_condition, status, earned_at,
              available_at, metadata
            ) VALUES (
              v_seller_id, v_partner_id, 'comodato_sale', p_movement_id, r_item.id,
              'COMODATO-' || left(p_movement_id::TEXT, 8), v_rule_id, v_product_key,
              r_item.product_name, r_item.product_variant, r_item.product_size,
              v_effective_quantity, v_rule_amount, v_effective_quantity * v_rule_amount,
              'full_payment', v_event_status, v_movement_date,
              CASE WHEN v_event_status = 'available' THEN now() ELSE NULL END,
              jsonb_build_object('total_due', v_total_due, 'total_paid', v_total_paid,
                'original_quantity_sold', r_item.quantity_sold,
                'quantity_adjusted', r_item.quantity_adjusted_total,
                'effective_quantity_sold', v_effective_quantity,
                'original_amount_due', r_item.amount_due,
                'amount_adjusted', r_item.amount_adjusted_total,
                'effective_amount_due', GREATEST(r_item.amount_due - r_item.amount_adjusted_total, 0))
            ) ON CONFLICT (source_type, source_item_id)
              WHERE source_item_id IS NOT NULL AND source_type <> 'adjustment' DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;

    PERFORM public._sync_prospect_origin_commission_event(
      v_partner_id, p_movement_id, r_item.id,
      'COMODATO-' || left(p_movement_id::TEXT, 8), 'comodato', v_product_key,
      r_item.product_name, r_item.product_variant, r_item.product_size,
      v_effective_quantity, v_event_status, v_movement_date,
      jsonb_build_object(
        'movement_id', p_movement_id, 'movement_item_id', r_item.id,
        'total_due', v_total_due, 'total_paid', v_total_paid,
        'original_quantity_sold', r_item.quantity_sold,
        'quantity_adjusted', r_item.quantity_adjusted_total,
        'effective_quantity_sold', v_effective_quantity,
        'effective_amount_due', GREATEST(r_item.amount_due - r_item.amount_adjusted_total, 0)
      )
    );
  END LOOP;

  FOR r_item IN
    SELECT event.source_item_id
    FROM public.commission_events AS event
    WHERE event.source_type = 'prospect_origin_sale'
      AND event.source_id = p_movement_id
      AND event.metadata->>'commercial_scheme' = 'comodato'
      AND NOT EXISTS (
        SELECT 1
        FROM public.commercial_partner_movement_items AS item
        WHERE item.id = event.source_item_id
          AND item.movement_id = p_movement_id
          AND COALESCE(item.quantity_sold, 0) > 0
      )
  LOOP
    PERFORM public._sync_prospect_origin_commission_event(
      v_partner_id, p_movement_id, r_item.source_item_id,
      'COMODATO-' || left(p_movement_id::TEXT, 8), 'comodato',
      NULL, NULL, NULL, NULL, 0, v_event_status, v_movement_date,
      jsonb_build_object('removed_from_movement', TRUE)
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_wholesale_commissions_for_order(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partner_id UUID;
  v_seller_id UUID;
  v_order_status TEXT;
  v_order_date DATE;
  v_order_folio TEXT;
  v_total_due NUMERIC := 0;
  v_total_paid NUMERIC := 0;
  v_event_status TEXT;
  v_product_key TEXT;
  v_rule_id UUID;
  v_rule_amount NUMERIC;
  v_valid_seller BOOLEAN := FALSE;
  r_item RECORD;
BEGIN
  SELECT orders.partner_id, partner.assigned_to, lower(trim(orders.order_status)),
         orders.order_date, orders.order_folio
  INTO v_partner_id, v_seller_id, v_order_status, v_order_date, v_order_folio
  FROM public.wholesale_orders AS orders
  JOIN public.commercial_partners AS partner ON partner.id = orders.partner_id
  WHERE orders.id = p_order_id;

  IF NOT FOUND THEN
    UPDATE public.commission_events SET status = 'cancelled', cancelled_at = now(),
      cancellation_reason = 'La orden de mayoreo de origen ya no existe'
    WHERE source_type = 'wholesale_sale' AND source_id = p_order_id
      AND status IN ('pending', 'available');
    PERFORM public._cancel_prospect_origin_commissions(
      p_order_id, 'mayoreo', 'La orden de mayoreo de origen ya no existe');
    RETURN;
  END IF;

  IF v_order_status NOT IN ('delivered', 'completed') THEN
    UPDATE public.commission_events SET status = 'cancelled', cancelled_at = now(),
      cancellation_reason = 'La orden dejó de estar entregada o completada'
    WHERE source_type = 'wholesale_sale' AND source_id = p_order_id
      AND status IN ('pending', 'available');
    PERFORM public._cancel_prospect_origin_commissions(
      p_order_id, 'mayoreo', 'La orden dejó de estar entregada o completada');
    RETURN;
  END IF;

  v_valid_seller := v_seller_id IS NOT NULL AND public.is_valid_commission_seller(v_seller_id);
  IF NOT v_valid_seller THEN
    PERFORM public.log_commission_sync_issue(
      'partner_without_seller', v_partner_id, v_seller_id, 'wholesale_order',
      p_order_id, NULL,
      'La orden no puede generar la comisión operativa porque el socio no tiene un vendedor activo asignado.',
      jsonb_build_object('order_folio', v_order_folio, 'order_status', v_order_status));
  END IF;

  SELECT COALESCE(SUM(COALESCE(item.subtotal, item.quantity * item.unit_price)), 0)
  INTO v_total_due FROM public.wholesale_order_items AS item
  WHERE item.wholesale_order_id = p_order_id;
  SELECT COALESCE(SUM(payment.amount), 0) INTO v_total_paid
  FROM public.wholesale_payments AS payment
  WHERE payment.wholesale_order_id = p_order_id
    AND lower(trim(payment.status)) IN ('completed', 'paid');
  v_event_status := CASE WHEN v_total_due > 0 AND v_total_paid + 0.005 >= v_total_due
    THEN 'available' ELSE 'pending' END;

  FOR r_item IN
    SELECT item.id, item.product_code, item.product_name, item.product_variant,
      item.product_size, item.quantity, item.unit_price,
      COALESCE(item.subtotal, item.quantity * item.unit_price) AS subtotal
    FROM public.wholesale_order_items AS item
    WHERE item.wholesale_order_id = p_order_id AND COALESCE(item.quantity, 0) > 0
  LOOP
    v_product_key := public.commission_product_key(r_item.product_name, r_item.product_variant);

    IF v_product_key IS NULL THEN
      PERFORM public.log_commission_sync_issue(
        'product_without_rule', v_partner_id, v_seller_id,
        'wholesale_order', p_order_id, r_item.id,
        'No se pudo identificar el producto de mayoreo para calcular su comisión.',
        jsonb_build_object(
          'product_code', r_item.product_code,
          'product_name', r_item.product_name,
          'product_variant', r_item.product_variant,
          'product_size', r_item.product_size
        )
      );
    END IF;

    IF v_valid_seller AND v_product_key IS NOT NULL THEN
      v_rule_id := NULL;
      v_rule_amount := NULL;
      SELECT rule.id, rule.commission_amount INTO v_rule_id, v_rule_amount
      FROM public.commission_rules AS rule
      WHERE rule.scheme = 'mayoreo' AND rule.product_key = v_product_key AND rule.active
        AND rule.valid_from <= v_order_date
        AND (rule.valid_to IS NULL OR rule.valid_to >= v_order_date)
      ORDER BY rule.valid_from DESC LIMIT 1;

      IF v_rule_id IS NULL THEN
        PERFORM public.log_commission_sync_issue(
          'product_without_rule', v_partner_id, v_seller_id,
          'wholesale_order', p_order_id, r_item.id,
          'No existe una regla vigente para este producto de mayoreo.',
          jsonb_build_object('product_key', v_product_key, 'order_date', v_order_date)
        );
      ELSE
        INSERT INTO public.commission_events (
          seller_id, partner_id, source_type, source_id, source_item_id, source_folio,
          rule_id, product_key, product_name, product_variant, product_size, quantity,
          unit_commission, commission_amount, release_condition, status, earned_at,
          available_at, metadata
        ) VALUES (
          v_seller_id, v_partner_id, 'wholesale_sale', p_order_id, r_item.id,
          COALESCE(v_order_folio, 'MAYOREO-' || left(p_order_id::TEXT, 8)),
          v_rule_id, v_product_key, r_item.product_name, r_item.product_variant,
          r_item.product_size, r_item.quantity, v_rule_amount,
          r_item.quantity * v_rule_amount, 'full_payment', v_event_status,
          v_order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
          CASE WHEN v_event_status = 'available' THEN now() ELSE NULL END,
          jsonb_build_object('product_code', r_item.product_code, 'order_total', v_total_due,
            'order_paid', v_total_paid, 'item_subtotal', r_item.subtotal)
        )
        ON CONFLICT (source_type, source_item_id)
          WHERE source_item_id IS NOT NULL AND source_type <> 'adjustment'
        DO UPDATE SET
          rule_id = EXCLUDED.rule_id,
          product_key = EXCLUDED.product_key,
          product_name = EXCLUDED.product_name,
          product_variant = EXCLUDED.product_variant,
          product_size = EXCLUDED.product_size,
          quantity = CASE WHEN commission_events.status = 'paid' THEN commission_events.quantity ELSE EXCLUDED.quantity END,
          unit_commission = CASE WHEN commission_events.status = 'paid' THEN commission_events.unit_commission ELSE EXCLUDED.unit_commission END,
          commission_amount = CASE WHEN commission_events.status = 'paid' THEN commission_events.commission_amount ELSE EXCLUDED.commission_amount END,
          status = CASE WHEN commission_events.status = 'paid' THEN 'paid' ELSE EXCLUDED.status END,
          available_at = CASE
            WHEN commission_events.status = 'paid' THEN commission_events.available_at
            WHEN EXCLUDED.status = 'available' THEN COALESCE(commission_events.available_at, now())
            ELSE NULL
          END,
          cancelled_at = NULL,
          cancellation_reason = NULL,
          metadata = EXCLUDED.metadata,
          updated_at = now();

        UPDATE public.commission_sync_issues
        SET status = 'resolved', resolved_at = now()
        WHERE status = 'open'
          AND source_item_id = r_item.id
          AND issue_type IN ('product_without_rule', 'invalid_quantity');
      END IF;
    END IF;

    PERFORM public._sync_prospect_origin_commission_event(
      v_partner_id, p_order_id, r_item.id,
      COALESCE(v_order_folio, 'MAYOREO-' || left(p_order_id::TEXT, 8)),
      'mayoreo', v_product_key, r_item.product_name, r_item.product_variant,
      r_item.product_size, r_item.quantity, v_event_status,
      v_order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
      jsonb_build_object(
        'wholesale_order_id', p_order_id, 'wholesale_order_item_id', r_item.id,
        'product_code', r_item.product_code, 'order_total', v_total_due,
        'order_paid', v_total_paid, 'item_subtotal', r_item.subtotal
      )
    );
  END LOOP;

  UPDATE public.commission_events AS event
  SET status = 'cancelled', cancelled_at = now(),
      cancellation_reason = 'El producto dejó de formar parte de la orden'
  WHERE event.source_type = 'wholesale_sale' AND event.source_id = p_order_id
    AND event.status IN ('pending', 'available')
    AND NOT EXISTS (
      SELECT 1 FROM public.wholesale_order_items AS item
      WHERE item.id = event.source_item_id AND item.wholesale_order_id = p_order_id
        AND COALESCE(item.quantity, 0) > 0
    );

  FOR r_item IN
    SELECT event.source_item_id
    FROM public.commission_events AS event
    WHERE event.source_type = 'prospect_origin_sale'
      AND event.source_id = p_order_id
      AND event.metadata->>'commercial_scheme' = 'mayoreo'
      AND NOT EXISTS (
        SELECT 1 FROM public.wholesale_order_items AS item
        WHERE item.id = event.source_item_id AND item.wholesale_order_id = p_order_id
          AND COALESCE(item.quantity, 0) > 0
      )
  LOOP
    PERFORM public._sync_prospect_origin_commission_event(
      v_partner_id, p_order_id, r_item.source_item_id,
      COALESCE(v_order_folio, 'MAYOREO-' || left(p_order_id::TEXT, 8)),
      'mayoreo', NULL, NULL, NULL, NULL, 0, v_event_status,
      v_order_date::TIMESTAMP AT TIME ZONE 'America/Mexico_City',
      jsonb_build_object('removed_from_order', TRUE)
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.commission_settlement_candidate_events(
  p_seller_id UUID,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS TABLE(event_id UUID, earned_at TIMESTAMPTZ, earned_local_date DATE, allocatable_amount NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT event.id, event.earned_at,
    (event.earned_at AT TIME ZONE 'America/Mexico_City')::DATE,
    balance.allocatable_amount
  FROM public.v_commission_events_effective AS event
  JOIN public.v_commission_event_payment_balances AS balance
    ON balance.commission_event_id = event.id
  JOIN public.user_profiles AS seller ON seller.id = event.seller_id
  WHERE event.seller_id = p_seller_id
    AND seller.is_active
    AND seller.role IN ('socios_comerciales', 'vendedora')
    AND event.status = 'available'
    AND abs(balance.allocatable_amount) > 0.005
    AND (event.earned_at AT TIME ZONE 'America/Mexico_City')::DATE
      BETWEEN p_period_start AND p_period_end
    AND (
      seller.role = 'socios_comerciales'
      OR (
        seller.role = 'vendedora'
        AND event.source_type IN (
          'prospect_conversion_bonus', 'pos_sale', 'prospect_origin_sale'
        )
      )
    )
  ORDER BY event.earned_at, event.id;
$$;

REVOKE ALL ON FUNCTION public.commission_settlement_candidate_events(UUID, DATE, DATE)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.v_commissions_available_for_payment
WITH (security_invoker = true)
AS
WITH eligible_events AS (
  SELECT event.seller_id, event.id, event.available_at, balance.allocatable_amount
  FROM public.v_commission_events_effective AS event
  JOIN public.v_commission_event_payment_balances AS balance
    ON balance.commission_event_id = event.id
  JOIN public.user_profiles AS profile ON profile.id = event.seller_id
  WHERE event.status = 'available'
    AND abs(balance.allocatable_amount) > 0.005
    AND profile.is_active
    AND (
      profile.role = 'socios_comerciales'
      OR (
        profile.role = 'vendedora'
        AND event.source_type IN (
          'prospect_conversion_bonus', 'pos_sale', 'prospect_origin_sale'
        )
      )
    )
), totals AS (
  SELECT seller_id, count(*)::INTEGER AS available_events,
    COALESCE(sum(allocatable_amount), 0)::NUMERIC AS available_amount,
    min(available_at) AS oldest_available_at, max(available_at) AS latest_available_at
  FROM eligible_events GROUP BY seller_id
), drafts AS (
  SELECT seller_id, (array_agg(id ORDER BY created_at, id))[1] AS draft_settlement_id
  FROM public.commission_settlements WHERE status = 'draft' GROUP BY seller_id
)
SELECT profile.id AS seller_id,
  COALESCE(totals.available_events, 0) AS available_events,
  COALESCE(totals.available_amount, 0::NUMERIC) AS available_amount,
  totals.oldest_available_at, totals.latest_available_at,
  COALESCE(totals.available_events, 0) AS available_event_count,
  drafts.draft_settlement_id IS NOT NULL AS has_draft_settlement,
  drafts.draft_settlement_id
FROM public.user_profiles AS profile
LEFT JOIN totals ON totals.seller_id = profile.id
LEFT JOIN drafts ON drafts.seller_id = profile.id
WHERE profile.is_active AND profile.role IN ('socios_comerciales', 'vendedora');

CREATE OR REPLACE VIEW public.v_seller_commission_monthly_summary
WITH (security_invoker = true)
AS
SELECT
  event.seller_id,
  date_trunc('month', event.earned_at AT TIME ZONE 'America/Mexico_City')::DATE AS month_start,
  COALESCE(sum(event.commission_amount) FILTER (WHERE event.status <> 'cancelled'), 0)::NUMERIC AS generated_total,
  COALESCE(sum(event.commission_amount) FILTER (WHERE event.status = 'pending'), 0)::NUMERIC AS pending_total,
  COALESCE(sum(balance.remaining_amount) FILTER (WHERE event.status = 'available'), 0)::NUMERIC AS available_total,
  COALESCE(sum(balance.paid_amount) FILTER (WHERE event.status <> 'cancelled'), 0)::NUMERIC AS paid_total,
  COALESCE(sum(event.quantity) FILTER (WHERE event.source_type = 'comodato_sale' AND event.status <> 'cancelled'), 0)::NUMERIC AS comodato_units,
  COALESCE(sum(event.quantity) FILTER (WHERE event.source_type = 'wholesale_sale' AND event.status <> 'cancelled'), 0)::NUMERIC AS wholesale_units,
  count(*) FILTER (WHERE event.source_type = 'conversion_bonus' AND event.status <> 'cancelled')::INTEGER AS conversion_count,
  count(DISTINCT event.partner_id) FILTER (WHERE event.status <> 'cancelled' AND event.partner_id IS NOT NULL)::INTEGER AS partners_count,
  count(*) FILTER (WHERE event.status <> 'cancelled')::INTEGER AS events_count,
  COALESCE(sum(event.quantity) FILTER (WHERE event.source_type = 'piece_sale' AND event.status <> 'cancelled'), 0)::NUMERIC AS piece_sale_units,
  COALESCE(sum(event.quantity) FILTER (WHERE event.source_type = 'pos_sale' AND event.status <> 'cancelled'), 0)::NUMERIC AS pos_units,
  COALESCE(sum(event.quantity) FILTER (WHERE event.source_type = 'prospect_origin_sale' AND event.status <> 'cancelled'), 0)::NUMERIC AS prospect_origin_units
FROM public.v_commission_events_effective AS event
JOIN public.v_commission_event_payment_balances AS balance
  ON balance.commission_event_id = event.id
GROUP BY event.seller_id,
  date_trunc('month', event.earned_at AT TIME ZONE 'America/Mexico_City')::DATE;

DROP POLICY IF EXISTS commission_events_authorized_read ON public.commission_events;
CREATE POLICY commission_events_authorized_read
ON public.commission_events FOR SELECT TO authenticated
USING (
  public.current_commercial_role() = 'admin'
  OR (public.current_commercial_role() = 'socios_comerciales' AND seller_id = auth.uid())
  OR (
    public.current_commercial_role() = 'vendedora'
    AND seller_id = auth.uid()
    AND source_type IN ('prospect_conversion_bonus', 'pos_sale', 'prospect_origin_sale')
  )
);

DROP POLICY IF EXISTS commission_settlement_items_authorized_read
  ON public.commission_settlement_items;
CREATE POLICY commission_settlement_items_authorized_read
ON public.commission_settlement_items FOR SELECT TO authenticated
USING (
  public.current_commercial_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.commission_settlements AS settlement
    JOIN public.commission_events AS event
      ON event.id = commission_settlement_items.commission_event_id
    WHERE settlement.id = commission_settlement_items.settlement_id
      AND settlement.seller_id = auth.uid()
      AND (
        public.current_commercial_role() = 'socios_comerciales'
        OR (
          public.current_commercial_role() = 'vendedora'
          AND event.source_type IN (
            'prospect_conversion_bonus', 'pos_sale', 'prospect_origin_sale'
          )
        )
      )
  )
);

REVOKE ALL ON FUNCTION public._commission_event_has_economic_lock(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._cancel_prospect_origin_commissions(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._sync_prospect_origin_commission_event(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, TEXT, TIMESTAMPTZ, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_commercial_prospect_conversion_attribution()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_prospect_bonus_from_conversion()
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.v_commissions_available_for_payment TO authenticated;
GRANT SELECT ON public.v_seller_commission_monthly_summary TO authenticated;

COMMIT;
