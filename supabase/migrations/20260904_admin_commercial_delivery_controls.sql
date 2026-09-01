-- Audited administrator-only controls for pending labelled B2B deliveries.
-- Apply after 20260903_commercial_delivery_scan_codes.sql.

BEGIN;

ALTER TABLE public.commercial_delivery_units
  ADD COLUMN IF NOT EXISTS void_reason TEXT NULL;

ALTER TABLE public.commercial_delivery_audit_events
  DROP CONSTRAINT IF EXISTS commercial_delivery_audit_events_event_type_check;
ALTER TABLE public.commercial_delivery_audit_events
  ADD CONSTRAINT commercial_delivery_audit_events_event_type_check
  CHECK (event_type IN (
    'generated', 'printed', 'reprinted', 'scanned', 'released', 'spoiled',
    'returned_good', 'voided', 'replaced', 'spoilage_exception',
    'admin_delivery_force_released', 'admin_delivery_cancelled'
  ));

-- The normal scanned -> released transition remains unchanged. The two added
-- branches are reachable only by an authenticated active administrator; RLS
-- continues to deny all direct writes to commercial_delivery_units.
CREATE OR REPLACE FUNCTION public._commercial_delivery_unit_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_type TEXT;
  v_source UUID;
  v_status TEXT;
  v_admin BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Commercial delivery units cannot be deleted';
  END IF;

  v_type := NEW.source_type;
  v_source := COALESCE(NEW.movement_id, NEW.wholesale_order_id);
  v_status := public._commercial_delivery_source_status(v_type, v_source);

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'generated' OR v_status <> 'pending_release' OR NEW.scan_code !~ '^[0-9]{16}$' THEN
      RAISE EXCEPTION 'New units require a valid scan_code and a pending release';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.barcode_value IS DISTINCT FROM OLD.barcode_value
    OR NEW.scan_code IS DISTINCT FROM OLD.scan_code
    OR NEW.source_type IS DISTINCT FROM OLD.source_type
    OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
    OR NEW.movement_id IS DISTINCT FROM OLD.movement_id
    OR NEW.wholesale_order_id IS DISTINCT FROM OLD.wholesale_order_id
    OR NEW.source_item_id IS DISTINCT FROM OLD.source_item_id
    OR NEW.product_id IS DISTINCT FROM OLD.product_id
    OR NEW.product_lot_id IS DISTINCT FROM OLD.product_lot_id
    OR NEW.product_code IS DISTINCT FROM OLD.product_code
    OR NEW.product_name IS DISTINCT FROM OLD.product_name
    OR NEW.product_variant IS DISTINCT FROM OLD.product_variant
    OR NEW.product_size IS DISTINCT FROM OLD.product_size
    OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
    OR NEW.unit_cost IS DISTINCT FROM OLD.unit_cost THEN
    RAISE EXCEPTION 'Delivery unit identity and financial snapshot are immutable';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles AS profile
    WHERE profile.id = auth.uid() AND profile.role = 'admin' AND profile.is_active
  ) INTO v_admin;

  IF OLD.status = 'generated' AND NEW.status = 'printed' AND NEW.print_count = OLD.print_count + 1 THEN
    NULL;
  ELSIF OLD.status = 'printed' AND NEW.status = 'printed'
    AND NEW.print_count = OLD.print_count + 1
    AND NULLIF(BTRIM(NEW.last_reprint_reason), '') IS NOT NULL THEN
    NULL;
  ELSIF OLD.status = 'printed' AND NEW.status = 'scanned' THEN
    NULL;
  ELSIF OLD.status = 'scanned' AND NEW.status = 'released'
    AND v_status = 'pending_release'
    AND public._commercial_delivery_units_ready_for_release(v_type, v_source) THEN
    NULL;
  ELSIF OLD.status IN ('generated', 'printed', 'scanned') AND NEW.status = 'released'
    AND v_status = 'pending_release'
    AND v_admin
    AND NEW.released_at IS NOT NULL
    AND NEW.released_by = auth.uid()
    AND NEW.print_count > 0 THEN
    NULL;
  ELSIF OLD.status IN ('generated', 'printed') AND NEW.status = 'replaced'
    AND NEW.replaced_by_unit_id IS NOT NULL THEN
    NULL;
  ELSIF OLD.status IN ('generated', 'printed', 'scanned') AND NEW.status = 'voided'
    AND v_status = 'cancelled'
    AND v_admin
    AND NEW.voided_at IS NOT NULL
    AND NEW.voided_by = auth.uid() THEN
    NULL;
  ELSIF OLD.status = 'released' AND NEW.status = 'spoiled'
    AND NEW.spoilage_movement_id IS NOT NULL THEN
    NULL;
  ELSIF OLD.status = 'released' AND NEW.status = 'returned_good'
    AND NEW.returned_good_at IS NOT NULL
    AND NEW.returned_good_by IS NOT NULL
    AND NEW.return_movement_id IS NOT NULL THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Invalid delivery-unit transition from % to %', OLD.status, NEW.status;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Retain the existing source-transition protections and also make the
-- cancellation payment/consequence checks effective for every caller, not
-- only for the administrator RPCs below.
CREATE OR REPLACE FUNCTION public._commercial_delivery_comodato_source_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE v_id UUID; v_old_status TEXT; v_new_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.movement_type = 'delivery' AND NEW.status = 'completed' THEN
      RAISE EXCEPTION 'All labelled bags must be released before delivery';
    END IF;
    RETURN NEW;
  END IF;
  v_id := OLD.id;
  v_old_status := OLD.status::TEXT;
  IF NOT EXISTS (SELECT 1 FROM public.commercial_delivery_units AS unit WHERE unit.movement_id = v_id) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A labelled delivery cannot be deleted'; END IF;
  v_new_status := NEW.status::TEXT;
  IF v_old_status = 'pending_release' AND v_new_status = 'completed'
    AND public._commercial_delivery_source_can_release('comodato', v_id) THEN
    RETURN NEW;
  END IF;
  IF v_old_status = 'pending_release' AND v_new_status = 'cancelled'
    AND NOT EXISTS (
      SELECT 1 FROM public.commercial_delivery_units AS unit
      WHERE unit.movement_id = v_id AND unit.status IN ('released', 'spoiled', 'returned_good')
    )
    AND NOT EXISTS (SELECT 1 FROM public.commercial_partner_payments AS payment WHERE payment.movement_id = v_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.commercial_partner_movement_items AS item
      WHERE item.movement_id = v_id
        AND (COALESCE(item.quantity_sold, 0) > 0 OR COALESCE(item.quantity_withdrawn, 0) > 0 OR COALESCE(item.quantity_spoiled, 0) > 0)
    ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A labelled delivery cannot be edited outside its verified transition';
END;
$$;

CREATE OR REPLACE FUNCTION public._commercial_delivery_wholesale_source_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE v_id UUID; v_old_status TEXT; v_new_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.order_status = 'delivered' THEN
      RAISE EXCEPTION 'All labelled bags must be released before delivery';
    END IF;
    RETURN NEW;
  END IF;
  v_id := OLD.id;
  v_old_status := OLD.order_status::TEXT;
  IF NOT EXISTS (SELECT 1 FROM public.commercial_delivery_units AS unit WHERE unit.wholesale_order_id = v_id) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A labelled delivery cannot be deleted'; END IF;
  v_new_status := NEW.order_status::TEXT;
  IF v_old_status = 'pending_release' AND v_new_status IN ('delivered', 'completed')
    AND public._commercial_delivery_source_can_release('mayoreo', v_id) THEN
    RETURN NEW;
  END IF;
  IF v_old_status = 'pending_release' AND v_new_status = 'cancelled'
    AND NOT EXISTS (
      SELECT 1 FROM public.commercial_delivery_units AS unit
      WHERE unit.wholesale_order_id = v_id AND unit.status IN ('released', 'spoiled', 'returned_good')
    )
    AND NOT EXISTS (SELECT 1 FROM public.wholesale_payments AS payment WHERE payment.wholesale_order_id = v_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A labelled delivery cannot be edited outside its verified transition';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_force_release_commercial_delivery(
  p_source_type TEXT,
  p_source_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_type TEXT := LOWER(BTRIM(p_source_type));
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_actor UUID;
  v_partner UUID;
  v_status TEXT;
  v_now TIMESTAMPTZ := now();
  v_total_units INTEGER;
  v_total_active INTEGER;
  v_previously_scanned INTEGER;
  v_bypassed INTEGER;
  v_unprinted INTEGER;
  v_invalid INTEGER;
  v_released INTEGER;
  v_hours INTEGER;
  v_final_status TEXT;
BEGIN
  IF v_type NOT IN ('comodato', 'mayoreo') THEN
    RAISE EXCEPTION 'source_type must be comodato or mayoreo';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'An administrator reason of at least 10 characters is required';
  END IF;

  IF v_type = 'comodato' THEN
    SELECT movement.partner_id, movement.status::TEXT
      INTO v_partner, v_status
    FROM public.commercial_partner_movements AS movement
    WHERE movement.id = p_source_id
    FOR UPDATE;
  ELSE
    SELECT orders.partner_id, orders.order_status::TEXT, COALESCE(orders.payment_terms_hours, 72)
      INTO v_partner, v_status, v_hours
    FROM public.wholesale_orders AS orders
    WHERE orders.id = p_source_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commercial delivery source not found';
  END IF;
  v_actor := public._commercial_delivery_actor(v_partner, true);
  IF v_status <> 'pending_release' THEN
    RAISE EXCEPTION 'Only a pending_release delivery can be released administratively';
  END IF;

  PERFORM 1
  FROM public.commercial_delivery_units AS unit
  WHERE unit.source_type = v_type
    AND (unit.movement_id = p_source_id OR unit.wholesale_order_id = p_source_id)
  FOR UPDATE;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE unit.status IN ('generated', 'printed', 'scanned')),
    COUNT(*) FILTER (WHERE unit.status = 'scanned'),
    COUNT(*) FILTER (WHERE unit.status IN ('generated', 'printed')),
    COUNT(*) FILTER (WHERE unit.status IN ('generated', 'printed', 'scanned') AND unit.print_count <= 0),
    COUNT(*) FILTER (
      WHERE unit.status IN ('released', 'spoiled', 'returned_good', 'voided')
        OR (unit.status = 'replaced' AND (
          unit.replaced_by_unit_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.commercial_delivery_units AS successor
            WHERE successor.id = unit.replaced_by_unit_id
          )
        ))
    )
  INTO v_total_units, v_total_active, v_previously_scanned, v_bypassed, v_unprinted, v_invalid
  FROM public.commercial_delivery_units AS unit
  WHERE unit.source_type = v_type
    AND (unit.movement_id = p_source_id OR unit.wholesale_order_id = p_source_id);

  IF v_total_active = 0 THEN
    RAISE EXCEPTION 'The delivery has no active labelled units to release';
  END IF;
  IF v_unprinted > 0 THEN
    RAISE EXCEPTION 'Every active delivery label must be printed before administrative release';
  END IF;
  IF v_invalid > 0 THEN
    RAISE EXCEPTION 'The delivery has released, terminal, or unresolved replacement units';
  END IF;

  UPDATE public.commercial_delivery_units AS unit
  SET status = 'released', released_at = v_now, released_by = v_actor
  WHERE unit.source_type = v_type
    AND (unit.movement_id = p_source_id OR unit.wholesale_order_id = p_source_id)
    AND unit.status IN ('generated', 'printed', 'scanned');
  GET DIAGNOSTICS v_released = ROW_COUNT;

  IF v_type = 'comodato' THEN
    UPDATE public.commercial_partner_movements
    SET status = 'completed', released_at = v_now,
      movement_date = (v_now AT TIME ZONE 'America/Mexico_City')::DATE
    WHERE id = p_source_id;
    v_final_status := 'completed';
  ELSE
    UPDATE public.wholesale_orders
    SET order_status = 'delivered', released_at = v_now,
      delivery_date = (v_now AT TIME ZONE 'America/Mexico_City')::DATE,
      payment_due_at = v_now + make_interval(hours => v_hours)
    WHERE id = p_source_id;
    v_final_status := 'delivered';
  END IF;

  PERFORM public._commercial_delivery_audit(
    'admin_delivery_force_released',
    v_partner,
    CASE WHEN v_type = 'comodato' THEN p_source_id ELSE NULL END,
    CASE WHEN v_type = 'mayoreo' THEN p_source_id ELSE NULL END,
    NULL,
    v_reason,
    jsonb_build_object(
      'source_type', v_type,
      'source_id', p_source_id,
      'total_units', v_total_units,
      'previously_scanned_units', v_previously_scanned,
      'bypassed_units', v_bypassed,
      'released_at', v_now
    )
  );

  RETURN jsonb_build_object(
    'source_id', p_source_id,
    'source_type', v_type,
    'released_units', v_released,
    'previously_scanned_units', v_previously_scanned,
    'bypassed_units', v_bypassed,
    'released_at', v_now,
    'final_status', v_final_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_commercial_delivery(
  p_source_type TEXT,
  p_source_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_type TEXT := LOWER(BTRIM(p_source_type));
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_actor UUID;
  v_partner UUID;
  v_status TEXT;
  v_now TIMESTAMPTZ := now();
  v_total_units INTEGER;
  v_total_active INTEGER;
  v_blocked INTEGER;
  v_voided INTEGER;
  v_previous_states JSONB;
BEGIN
  IF v_type NOT IN ('comodato', 'mayoreo') THEN
    RAISE EXCEPTION 'source_type must be comodato or mayoreo';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'An administrator reason of at least 10 characters is required';
  END IF;

  IF v_type = 'comodato' THEN
    SELECT movement.partner_id, movement.status::TEXT
      INTO v_partner, v_status
    FROM public.commercial_partner_movements AS movement
    WHERE movement.id = p_source_id
    FOR UPDATE;
  ELSE
    SELECT orders.partner_id, orders.order_status::TEXT
      INTO v_partner, v_status
    FROM public.wholesale_orders AS orders
    WHERE orders.id = p_source_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commercial delivery source not found';
  END IF;
  v_actor := public._commercial_delivery_actor(v_partner, true);
  IF v_status <> 'pending_release' THEN
    RAISE EXCEPTION 'Only a pending_release delivery can be cancelled';
  END IF;

  PERFORM 1
  FROM public.commercial_delivery_units AS unit
  WHERE unit.source_type = v_type
    AND (unit.movement_id = p_source_id OR unit.wholesale_order_id = p_source_id)
  FOR UPDATE;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE unit.status IN ('generated', 'printed', 'scanned')),
    COUNT(*) FILTER (WHERE unit.status IN ('released', 'spoiled', 'returned_good'))
  INTO v_total_units, v_total_active, v_blocked
  FROM public.commercial_delivery_units AS unit
  WHERE unit.source_type = v_type
    AND (unit.movement_id = p_source_id OR unit.wholesale_order_id = p_source_id);

  IF v_total_active = 0 THEN
    RAISE EXCEPTION 'The delivery has no active labelled units to cancel';
  END IF;
  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'A delivery with released, spoiled, or returned units cannot be cancelled';
  END IF;

  IF v_type = 'comodato' THEN
    IF EXISTS (SELECT 1 FROM public.commercial_partner_payments AS payment WHERE payment.movement_id = p_source_id)
      OR EXISTS (
        SELECT 1 FROM public.commercial_partner_movement_items AS item
        WHERE item.movement_id = p_source_id
          AND (COALESCE(item.quantity_sold, 0) > 0 OR COALESCE(item.quantity_withdrawn, 0) > 0 OR COALESCE(item.quantity_spoiled, 0) > 0)
      ) THEN
      RAISE EXCEPTION 'A delivery with payments or downstream inventory consequences cannot be cancelled';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.wholesale_payments AS payment WHERE payment.wholesale_order_id = p_source_id) THEN
    RAISE EXCEPTION 'A delivery with payments cannot be cancelled';
  END IF;

  SELECT COALESCE(jsonb_object_agg(state.status, state.count), '{}'::JSONB)
  INTO v_previous_states
  FROM (
    SELECT unit.status, COUNT(*)::INTEGER AS count
    FROM public.commercial_delivery_units AS unit
    WHERE unit.source_type = v_type
      AND (unit.movement_id = p_source_id OR unit.wholesale_order_id = p_source_id)
    GROUP BY unit.status
  ) AS state;

  -- Source guards permit pending_release -> cancelled only when no released
  -- consequence exists; the unit guard then permits the audited void transition.
  IF v_type = 'comodato' THEN
    UPDATE public.commercial_partner_movements SET status = 'cancelled' WHERE id = p_source_id;
  ELSE
    UPDATE public.wholesale_orders SET order_status = 'cancelled', payment_due_at = NULL WHERE id = p_source_id;
  END IF;

  UPDATE public.commercial_delivery_units AS unit
  SET status = 'voided', voided_at = v_now, voided_by = v_actor, void_reason = v_reason
  WHERE unit.source_type = v_type
    AND (unit.movement_id = p_source_id OR unit.wholesale_order_id = p_source_id)
    AND unit.status IN ('generated', 'printed', 'scanned');
  GET DIAGNOSTICS v_voided = ROW_COUNT;

  PERFORM public._commercial_delivery_audit(
    'admin_delivery_cancelled',
    v_partner,
    CASE WHEN v_type = 'comodato' THEN p_source_id ELSE NULL END,
    CASE WHEN v_type = 'mayoreo' THEN p_source_id ELSE NULL END,
    NULL,
    v_reason,
    jsonb_build_object(
      'source_type', v_type,
      'source_id', p_source_id,
      'total_units', v_total_units,
      'previous_states', v_previous_states,
      'cancelled_at', v_now
    )
  );

  RETURN jsonb_build_object(
    'source_id', p_source_id,
    'source_type', v_type,
    'voided_units', v_voided,
    'cancelled_at', v_now,
    'final_status', 'cancelled'
  );
END;
$$;

REVOKE ALL ON FUNCTION public._commercial_delivery_audit(TEXT, UUID, UUID, UUID, UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_force_release_commercial_delivery(TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_cancel_commercial_delivery(TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_force_release_commercial_delivery(TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_commercial_delivery(TEXT, UUID, TEXT) TO authenticated;

COMMIT;
