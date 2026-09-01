-- Short numeric scan codes and raster-label compatibility for commercial deliveries.
-- Apply after 20260902_fix_commercial_delivery_status_guards.sql.

BEGIN;

ALTER TABLE public.commercial_delivery_units
  ADD COLUMN scan_code TEXT NULL;

-- The code is derived from cryptographically random bytes. Decimal characters
-- are retained from a long random hex value, so no sequence or UUID fragment
-- is exposed on the physical label.
CREATE OR REPLACE FUNCTION public._commercial_delivery_generate_scan_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_code TEXT;
BEGIN
  LOOP
    v_code := SUBSTRING(
      REGEXP_REPLACE(REPLACE(gen_random_uuid()::TEXT, '-', ''), '[a-f]', '', 'g')
      FROM 1 FOR 16
    );
    IF v_code ~ '^[0-9]{16}$'
      AND NOT EXISTS (
        SELECT 1
        FROM public.commercial_delivery_units AS unit
        WHERE unit.scan_code = v_code
      ) THEN
      RETURN v_code;
    END IF;
  END LOOP;
END;
$$;

-- Existing rows need a one-time, narrow transition from NULL to their new
-- immutable code. All ordinary identity and state protections remain active.
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
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Commercial delivery units cannot be deleted';
  END IF;

  v_type := NEW.source_type;
  v_source := COALESCE(NEW.movement_id, NEW.wholesale_order_id);
  v_status := public._commercial_delivery_source_status(v_type, v_source);

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'generated' OR v_status <> 'pending_release' THEN
      RAISE EXCEPTION 'New units must belong to a pending release';
    END IF;
    IF NEW.scan_code IS NOT NULL AND NEW.scan_code !~ '^[0-9]{16}$' THEN
      RAISE EXCEPTION 'scan_code must contain exactly 16 digits';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.barcode_value IS DISTINCT FROM OLD.barcode_value
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

  IF NEW.scan_code IS DISTINCT FROM OLD.scan_code THEN
    IF OLD.scan_code IS NULL
      AND NEW.scan_code ~ '^[0-9]{16}$'
      AND NEW.status IS NOT DISTINCT FROM OLD.status
      AND NEW.printed_at IS NOT DISTINCT FROM OLD.printed_at
      AND NEW.printed_by IS NOT DISTINCT FROM OLD.printed_by
      AND NEW.scanned_at IS NOT DISTINCT FROM OLD.scanned_at
      AND NEW.scanned_by IS NOT DISTINCT FROM OLD.scanned_by
      AND NEW.released_at IS NOT DISTINCT FROM OLD.released_at
      AND NEW.released_by IS NOT DISTINCT FROM OLD.released_by
      AND NEW.spoiled_at IS NOT DISTINCT FROM OLD.spoiled_at
      AND NEW.spoiled_by IS NOT DISTINCT FROM OLD.spoiled_by
      AND NEW.returned_good_at IS NOT DISTINCT FROM OLD.returned_good_at
      AND NEW.returned_good_by IS NOT DISTINCT FROM OLD.returned_good_by
      AND NEW.return_movement_id IS NOT DISTINCT FROM OLD.return_movement_id
      AND NEW.spoilage_movement_id IS NOT DISTINCT FROM OLD.spoilage_movement_id
      AND NEW.voided_at IS NOT DISTINCT FROM OLD.voided_at
      AND NEW.voided_by IS NOT DISTINCT FROM OLD.voided_by
      AND NEW.print_count IS NOT DISTINCT FROM OLD.print_count
      AND NEW.last_reprint_reason IS NOT DISTINCT FROM OLD.last_reprint_reason
      AND NEW.replaces_unit_id IS NOT DISTINCT FROM OLD.replaces_unit_id
      AND NEW.replaced_by_unit_id IS NOT DISTINCT FROM OLD.replaced_by_unit_id THEN
      NEW.updated_at := now();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'scan_code is immutable after creation';
  END IF;

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
  ELSIF OLD.status IN ('generated', 'printed') AND NEW.status = 'replaced'
    AND NEW.replaced_by_unit_id IS NOT NULL THEN
    NULL;
  ELSIF OLD.status IN ('generated', 'printed') AND NEW.status = 'voided'
    AND v_status = 'cancelled' THEN
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

-- UNIQUE permits existing NULLs during the backfill and is intentionally in
-- place before generation starts, so a collision raises unique_violation and
-- is retried below.
ALTER TABLE public.commercial_delivery_units
  ADD CONSTRAINT commercial_delivery_units_scan_code_format_check
    CHECK (scan_code ~ '^[0-9]{16}$'),
  ADD CONSTRAINT commercial_delivery_units_scan_code_key UNIQUE (scan_code);

DO $$
DECLARE
  v_unit_id UUID;
  v_scan_code TEXT;
  v_attempt INTEGER;
BEGIN
  FOR v_unit_id IN
    SELECT id
    FROM public.commercial_delivery_units
    WHERE scan_code IS NULL
    ORDER BY id
    FOR UPDATE
  LOOP
    v_attempt := 0;
    LOOP
      v_attempt := v_attempt + 1;
      IF v_attempt > 20 THEN
        RAISE EXCEPTION 'Could not generate a unique scan_code for delivery unit %', v_unit_id;
      END IF;
      v_scan_code := public._commercial_delivery_generate_scan_code();
      BEGIN
        UPDATE public.commercial_delivery_units
        SET scan_code = v_scan_code
        WHERE id = v_unit_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- The unique constraint is added after this one-time backfill. This
        -- branch protects a concurrent deployment that already added it.
        NULL;
      END;
    END LOOP;
  END LOOP;
END;
$$;

ALTER TABLE public.commercial_delivery_units
  ALTER COLUMN scan_code SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.commercial_delivery_units
    WHERE scan_code IS NULL
      OR scan_code !~ '^[0-9]{16}$'
  ) THEN
    RAISE EXCEPTION 'Every commercial delivery unit must have a valid 16-digit scan_code';
  END IF;

  IF EXISTS (
    SELECT scan_code
    FROM public.commercial_delivery_units
    GROUP BY scan_code
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate commercial delivery scan_code detected';
  END IF;

END;
$$;

-- Trigger names execute alphabetically in PostgreSQL. The 00 prefix makes
-- this assignment run before commercial_delivery_unit_guard validates INSERTs.
-- A client-supplied value is intentionally overwritten; scan codes are issued
-- only by the database and remain immutable after insertion.
CREATE OR REPLACE FUNCTION public._commercial_delivery_assign_scan_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  NEW.scan_code := public._commercial_delivery_generate_scan_code();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "00_commercial_delivery_scan_code_before_insert"
  BEFORE INSERT ON public.commercial_delivery_units
  FOR EACH ROW
  EXECUTE FUNCTION public._commercial_delivery_assign_scan_code();

-- New units retry their INSERT if (and only if) the unique scan-code
-- constraint detects a collision. The constraint remains the final authority.
CREATE OR REPLACE FUNCTION public._commercial_delivery_insert_unit(
  p_source_type TEXT,
  p_partner_id UUID,
  p_movement_id UUID,
  p_wholesale_order_id UUID,
  p_source_item_id UUID,
  p_product_id UUID,
  p_product_lot_id UUID,
  p_product_code TEXT,
  p_product_name TEXT,
  p_product_variant TEXT,
  p_product_size TEXT,
  p_unit_price NUMERIC,
  p_unit_cost NUMERIC,
  p_generated_by UUID,
  p_replaces_unit_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_unit_id UUID;
  v_attempt INTEGER := 0;
  v_constraint_name TEXT;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 20 THEN
      RAISE EXCEPTION 'Could not allocate a unique delivery scan_code';
    END IF;
    BEGIN
      INSERT INTO public.commercial_delivery_units (
        barcode_value, source_type, partner_id, movement_id,
        wholesale_order_id, source_item_id, product_id, product_lot_id,
        product_code, product_name, product_variant, product_size, unit_price,
        unit_cost, generated_by, replaces_unit_id
      ) VALUES (
        'CCU1-' || REPLACE(gen_random_uuid()::TEXT, '-', ''),
        p_source_type, p_partner_id, p_movement_id, p_wholesale_order_id,
        p_source_item_id, p_product_id, p_product_lot_id, p_product_code,
        p_product_name, p_product_variant, p_product_size, p_unit_price,
        p_unit_cost, p_generated_by, p_replaces_unit_id
      ) RETURNING id INTO v_unit_id;
      RETURN v_unit_id;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
      IF v_constraint_name NOT IN ('commercial_delivery_units_scan_code_key', 'commercial_delivery_units_barcode_value_key') THEN
        RAISE;
      END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._commercial_delivery_generate_scan_code() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._commercial_delivery_assign_scan_code() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._commercial_delivery_insert_unit(TEXT,UUID,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,UUID,UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_comodato_delivery_with_units(
  p_partner_id UUID,
  p_movement_date DATE,
  p_next_visit_date DATE,
  p_next_visit_reason TEXT,
  p_notes TEXT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_movement UUID;
  v_item JSONB;
  v_item_id UUID;
  v_product JSONB;
  v_product_id UUID;
  v_qty INTEGER;
  v_i INTEGER;
  v_unit UUID;
  v_lot UUID;
  v_code TEXT;
  v_name TEXT;
  v_variant TEXT;
  v_size TEXT;
  v_cost NUMERIC;
BEGIN
  v_actor := public._commercial_delivery_actor(p_partner_id);
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;
  INSERT INTO public.commercial_partner_movements (
    partner_id, movement_type, movement_date, next_visit_date,
    next_visit_reason, notes, status
  ) VALUES (
    p_partner_id, 'delivery', COALESCE(p_movement_date, (now() AT TIME ZONE 'America/Mexico_City')::DATE),
    p_next_visit_date, NULLIF(BTRIM(p_next_visit_reason), ''), NULLIF(BTRIM(p_notes), ''), 'pending_release'
  ) RETURNING id INTO v_movement;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity_delivered')::INTEGER;
    IF v_qty IS NULL OR v_qty < 1 OR (v_item->>'quantity_delivered')::NUMERIC <> v_qty THEN
      RAISE EXCEPTION 'Delivery quantities must be positive whole bags';
    END IF;
    v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
    SELECT to_jsonb(product) INTO v_product FROM public.products AS product WHERE product.id = v_product_id;
    IF v_product IS NULL THEN RAISE EXCEPTION 'Every delivery item requires one real product_id'; END IF;
    v_code := NULLIF(v_product->>'sku_code', '');
    v_name := COALESCE(NULLIF(v_product->>'product_name', ''), NULLIF(v_product->>'name', ''));
    v_variant := COALESCE(NULLIF(v_product->>'product_variant', ''), NULLIF(v_product->>'category', ''), NULLIF(v_product->>'flavor', ''));
    v_size := COALESCE(NULLIF(v_product->>'product_size', ''), NULLIF(v_product->>'size_label', ''), NULLIF(v_product->>'size', ''), CASE WHEN NULLIF(v_product->>'weight_grams', '') IS NOT NULL THEN (v_product->>'weight_grams') || ' gr' WHEN NULLIF(v_product->>'grams', '') IS NOT NULL THEN (v_product->>'grams') || ' gr' END);
    v_cost := NULLIF(v_product->>'unit_cost', '')::NUMERIC;
    IF v_code IS NULL OR v_name IS NULL THEN RAISE EXCEPTION 'The selected product must have SKU and presentation data'; END IF;
    v_lot := NULLIF(v_item->>'product_lot_id', '')::UUID;
    IF v_lot IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.product_lots WHERE id = v_lot AND product_id = v_product_id) THEN
      RAISE EXCEPTION 'The selected lot does not belong to the selected product';
    END IF;
    INSERT INTO public.commercial_partner_movement_items (
      movement_id, partner_id, product_id, product_name, product_variant, product_size,
      quantity_delivered, quantity_sold, quantity_withdrawn, quantity_spoiled,
      quantity_adjusted, price_to_catcorn, suggested_retail_price, amount_due, notes
    ) VALUES (
      v_movement, p_partner_id, v_product_id, v_name, v_variant, v_size, v_qty,
      0, 0, 0, 0, COALESCE((v_item->>'price_to_catcorn')::NUMERIC, 0),
      COALESCE((v_item->>'suggested_retail_price')::NUMERIC, 0), 0,
      NULLIF(BTRIM(v_item->>'notes'), '')
    ) RETURNING id INTO v_item_id;
    FOR v_i IN 1..v_qty LOOP
      v_unit := public._commercial_delivery_insert_unit(
        'comodato', p_partner_id, v_movement, NULL, v_item_id, v_product_id,
        v_lot, v_code, v_name, v_variant, v_size,
        COALESCE((v_item->>'price_to_catcorn')::NUMERIC, 0), v_cost, v_actor
      );
      PERFORM public._commercial_delivery_audit('generated', p_partner_id, v_movement, NULL, v_unit, NULL, jsonb_build_object('source_item_id', v_item_id));
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('movement_id', v_movement, 'status', 'pending_release', 'units_generated', (SELECT count(*) FROM public.commercial_delivery_units WHERE movement_id = v_movement));
END;
$$;

CREATE OR REPLACE FUNCTION public.create_wholesale_order_with_units(
  p_partner_id UUID,
  p_order_date DATE,
  p_notes TEXT,
  p_items JSONB,
  p_payment_terms_hours INTEGER DEFAULT 72
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_order UUID;
  v_order_date DATE;
  v_item JSONB;
  v_item_id UUID;
  v_product JSONB;
  v_product_id UUID;
  v_qty INTEGER;
  v_i INTEGER;
  v_unit UUID;
  v_lot UUID;
  v_code TEXT;
  v_name TEXT;
  v_variant TEXT;
  v_size TEXT;
  v_cost NUMERIC;
BEGIN
  v_actor := public._commercial_delivery_actor(p_partner_id);
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'At least one item is required'; END IF;
  IF COALESCE(p_payment_terms_hours, 72) < 1 THEN RAISE EXCEPTION 'Payment terms must be positive'; END IF;
  v_order_date := COALESCE(p_order_date, (now() AT TIME ZONE 'America/Mexico_City')::DATE);
  INSERT INTO public.wholesale_orders (partner_id, order_date, delivery_date, payment_terms_hours, minimum_order_pieces, order_status, payment_due_at, notes)
  VALUES (p_partner_id, v_order_date, v_order_date, COALESCE(p_payment_terms_hours, 72), 10, 'pending_release', NULL, NULLIF(BTRIM(p_notes), ''))
  RETURNING id INTO v_order;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::INTEGER;
    IF v_qty IS NULL OR v_qty < 1 OR (v_item->>'quantity')::NUMERIC <> v_qty THEN RAISE EXCEPTION 'Order quantities must be positive whole bags'; END IF;
    v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
    SELECT to_jsonb(product) INTO v_product FROM public.products AS product WHERE product.id = v_product_id;
    IF v_product IS NULL THEN RAISE EXCEPTION 'Every order item requires one real product_id'; END IF;
    v_code := NULLIF(v_product->>'sku_code', '');
    v_name := COALESCE(NULLIF(v_product->>'product_name', ''), NULLIF(v_product->>'name', ''));
    v_variant := COALESCE(NULLIF(v_product->>'product_variant', ''), NULLIF(v_product->>'category', ''), NULLIF(v_product->>'flavor', ''));
    v_size := COALESCE(NULLIF(v_product->>'product_size', ''), NULLIF(v_product->>'size_label', ''), NULLIF(v_product->>'size', ''), CASE WHEN NULLIF(v_product->>'weight_grams', '') IS NOT NULL THEN (v_product->>'weight_grams') || ' gr' WHEN NULLIF(v_product->>'grams', '') IS NOT NULL THEN (v_product->>'grams') || ' gr' END);
    v_cost := NULLIF(v_product->>'unit_cost', '')::NUMERIC;
    IF v_code IS NULL OR v_name IS NULL THEN RAISE EXCEPTION 'The selected product must have SKU and presentation data'; END IF;
    v_lot := NULLIF(v_item->>'product_lot_id', '')::UUID;
    IF v_lot IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.product_lots WHERE id = v_lot AND product_id = v_product_id) THEN RAISE EXCEPTION 'The selected lot does not belong to the selected product'; END IF;
    INSERT INTO public.wholesale_order_items (wholesale_order_id, partner_id, product_code, product_name, product_variant, product_size, quantity, unit_price)
    VALUES (v_order, p_partner_id, v_code, v_name, v_variant, v_size, v_qty, COALESCE((v_item->>'unit_price')::NUMERIC, 0))
    RETURNING id INTO v_item_id;
    FOR v_i IN 1..v_qty LOOP
      v_unit := public._commercial_delivery_insert_unit(
        'mayoreo', p_partner_id, NULL, v_order, v_item_id, v_product_id, v_lot,
        v_code, v_name, v_variant, v_size, COALESCE((v_item->>'unit_price')::NUMERIC, 0), v_cost, v_actor
      );
      PERFORM public._commercial_delivery_audit('generated', p_partner_id, NULL, v_order, v_unit, NULL, jsonb_build_object('source_item_id', v_item_id));
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('wholesale_order_id', v_order, 'status', 'pending_release', 'units_generated', (SELECT count(*) FROM public.commercial_delivery_units WHERE wholesale_order_id = v_order));
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_commercial_delivery_unit_for_release(p_barcode_value TEXT, p_partner_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE v_actor UUID; v_unit public.commercial_delivery_units%ROWTYPE; v_now TIMESTAMPTZ := now(); v_total INTEGER; v_scanned INTEGER; v_hours INTEGER;
BEGIN
  IF COALESCE(BTRIM(p_barcode_value), '') !~ '^[0-9]{16}$' THEN
    RAISE EXCEPTION 'El código de etiqueta debe contener exactamente 16 dígitos';
  END IF;
  v_actor := public._commercial_delivery_actor(p_partner_id);
  SELECT * INTO v_unit FROM public.commercial_delivery_units
  WHERE scan_code = BTRIM(p_barcode_value)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown delivery label'; END IF;
  IF v_unit.partner_id <> p_partner_id THEN RAISE EXCEPTION 'This label belongs to another partner'; END IF;
  IF v_unit.status <> 'printed' THEN RAISE EXCEPTION 'Label is not ready for release (%)', v_unit.status; END IF;
  IF public._commercial_delivery_source_status(v_unit.source_type, COALESCE(v_unit.movement_id, v_unit.wholesale_order_id)) <> 'pending_release' THEN RAISE EXCEPTION 'The label source is not pending release'; END IF;
  IF v_unit.source_type = 'comodato' THEN PERFORM 1 FROM public.commercial_partner_movements WHERE id = v_unit.movement_id FOR UPDATE; ELSE PERFORM 1 FROM public.wholesale_orders WHERE id = v_unit.wholesale_order_id FOR UPDATE; END IF;
  UPDATE public.commercial_delivery_units SET status = 'scanned', scanned_at = v_now, scanned_by = v_actor WHERE id = v_unit.id;
  PERFORM public._commercial_delivery_audit('scanned', v_unit.partner_id, v_unit.movement_id, v_unit.wholesale_order_id, v_unit.id, NULL, '{}'::JSONB);
  SELECT COUNT(*) FILTER (WHERE status IN ('generated', 'printed', 'scanned', 'released')), COUNT(*) FILTER (WHERE status IN ('scanned', 'released'))
  INTO v_total, v_scanned FROM public.commercial_delivery_units
  WHERE source_type = v_unit.source_type AND ((v_unit.source_type = 'comodato' AND movement_id = v_unit.movement_id) OR (v_unit.source_type = 'mayoreo' AND wholesale_order_id = v_unit.wholesale_order_id));
  IF v_total = v_scanned AND public._commercial_delivery_units_ready_for_release(v_unit.source_type, COALESCE(v_unit.movement_id, v_unit.wholesale_order_id)) THEN
    UPDATE public.commercial_delivery_units SET status = 'released', released_at = v_now, released_by = v_actor
    WHERE source_type = v_unit.source_type AND ((v_unit.source_type = 'comodato' AND movement_id = v_unit.movement_id) OR (v_unit.source_type = 'mayoreo' AND wholesale_order_id = v_unit.wholesale_order_id)) AND status = 'scanned';
    IF v_unit.source_type = 'comodato' THEN
      UPDATE public.commercial_partner_movements SET status = 'completed', released_at = v_now, movement_date = (v_now AT TIME ZONE 'America/Mexico_City')::DATE WHERE id = v_unit.movement_id;
      PERFORM public._commercial_delivery_audit('released', v_unit.partner_id, v_unit.movement_id, NULL, NULL, NULL, jsonb_build_object('released_units', v_total));
    ELSE
      SELECT COALESCE(payment_terms_hours, 72) INTO v_hours FROM public.wholesale_orders WHERE id = v_unit.wholesale_order_id FOR UPDATE;
      UPDATE public.wholesale_orders SET order_status = 'delivered', released_at = v_now, delivery_date = (v_now AT TIME ZONE 'America/Mexico_City')::DATE, payment_due_at = v_now + make_interval(hours => v_hours) WHERE id = v_unit.wholesale_order_id;
      PERFORM public._commercial_delivery_audit('released', v_unit.partner_id, NULL, v_unit.wholesale_order_id, NULL, NULL, jsonb_build_object('released_units', v_total));
    END IF;
    RETURN jsonb_build_object('released', true, 'scanned', v_total, 'total', v_total, 'released_at', v_now);
  END IF;
  RETURN jsonb_build_object('released', false, 'scanned', v_scanned, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_partner_spoilage_by_barcode(p_barcode_value TEXT, p_partner_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE v_actor UUID; v_unit public.commercial_delivery_units%ROWTYPE; v_movement UUID; v_item UUID;
BEGIN
  IF COALESCE(BTRIM(p_barcode_value), '') !~ '^[0-9]{16}$' THEN
    RAISE EXCEPTION 'El código de etiqueta debe contener exactamente 16 dígitos';
  END IF;
  v_actor := public._commercial_delivery_actor(p_partner_id);
  SELECT * INTO v_unit FROM public.commercial_delivery_units
  WHERE scan_code = BTRIM(p_barcode_value)
  FOR UPDATE;
  IF NOT FOUND OR v_unit.partner_id <> p_partner_id THEN RAISE EXCEPTION 'Delivery label does not belong to this partner'; END IF;
  IF v_unit.source_type <> 'comodato' OR v_unit.status <> 'released' THEN RAISE EXCEPTION 'Only released comodato units can be spoiled'; END IF;
  INSERT INTO public.commercial_partner_movements(partner_id, movement_type, movement_date, status, notes)
  VALUES (p_partner_id, 'spoilage', (now() AT TIME ZONE 'America/Mexico_City')::DATE, 'completed', NULLIF(BTRIM(p_reason), '')) RETURNING id INTO v_movement;
  INSERT INTO public.commercial_partner_movement_items(movement_id, partner_id, product_id, product_name, product_variant, product_size, quantity_delivered, quantity_sold, quantity_withdrawn, quantity_spoiled, quantity_adjusted, price_to_catcorn, suggested_retail_price, amount_due, notes)
  VALUES (v_movement, p_partner_id, v_unit.product_id, v_unit.product_name, v_unit.product_variant, v_unit.product_size, 0, 0, 0, 1, 0, v_unit.unit_price, 0, 0, NULLIF(BTRIM(p_reason), '')) RETURNING id INTO v_item;
  UPDATE public.commercial_delivery_units SET status = 'spoiled', spoiled_at = now(), spoiled_by = v_actor, spoilage_movement_id = v_movement WHERE id = v_unit.id;
  PERFORM public._commercial_delivery_audit('spoiled', p_partner_id, v_movement, NULL, v_unit.id, p_reason, jsonb_build_object('source_item_id', v_unit.source_item_id, 'spoilage_item_id', v_item));
  RETURN jsonb_build_object('delivery_unit_id', v_unit.id, 'movement_id', v_movement, 'product_name', v_unit.product_name, 'released_at', v_unit.released_at, 'unit_cost', v_unit.unit_cost);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_partner_return_by_barcode(p_barcode_value TEXT, p_partner_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE v_actor UUID; v_unit public.commercial_delivery_units%ROWTYPE; v_returned public.commercial_delivery_units%ROWTYPE; v_movement UUID; v_item UUID;
BEGIN
  IF COALESCE(BTRIM(p_barcode_value), '') !~ '^[0-9]{16}$' THEN
    RAISE EXCEPTION 'El código de etiqueta debe contener exactamente 16 dígitos';
  END IF;
  v_actor := public._commercial_delivery_actor(p_partner_id);
  SELECT * INTO v_unit FROM public.commercial_delivery_units
  WHERE scan_code = BTRIM(p_barcode_value)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Etiqueta de entrega desconocida'; END IF;
  IF v_unit.partner_id <> p_partner_id THEN RAISE EXCEPTION 'Esta etiqueta pertenece a otro socio'; END IF;
  IF v_unit.source_type = 'mayoreo' THEN RAISE EXCEPTION 'Esta etiqueta corresponde a un pedido de Mayoreo y no puede retirarse por este flujo'; END IF;
  IF v_unit.source_type <> 'comodato' THEN RAISE EXCEPTION 'Esta etiqueta no corresponde a una entrega de Comodato'; END IF;
  IF v_unit.status <> 'released' THEN
    CASE v_unit.status
      WHEN 'returned_good' THEN RAISE EXCEPTION 'Esta etiqueta ya fue retirada en buen estado';
      WHEN 'spoiled' THEN RAISE EXCEPTION 'Esta etiqueta ya fue registrada como merma';
      WHEN 'voided' THEN RAISE EXCEPTION 'Esta etiqueta fue anulada';
      WHEN 'replaced' THEN RAISE EXCEPTION 'Esta etiqueta fue reemplazada';
      ELSE RAISE EXCEPTION 'Sólo una etiqueta liberada puede retirarse (%)', v_unit.status;
    END CASE;
  END IF;
  INSERT INTO public.commercial_partner_movements(partner_id, movement_type, movement_date, status, notes)
  VALUES (p_partner_id, 'withdrawal', (now() AT TIME ZONE 'America/Mexico_City')::DATE, 'completed', NULLIF(BTRIM(p_reason), '')) RETURNING id INTO v_movement;
  INSERT INTO public.commercial_partner_movement_items(movement_id, partner_id, product_id, product_name, product_variant, product_size, quantity_delivered, quantity_sold, quantity_withdrawn, quantity_spoiled, quantity_adjusted, price_to_catcorn, suggested_retail_price, amount_due, notes)
  VALUES (v_movement, p_partner_id, v_unit.product_id, v_unit.product_name, v_unit.product_variant, v_unit.product_size, 0, 0, 1, 0, 0, v_unit.unit_price, 0, 0, NULLIF(BTRIM(p_reason), '')) RETURNING id INTO v_item;
  UPDATE public.commercial_delivery_units SET status = 'returned_good', returned_good_at = now(), returned_good_by = v_actor, return_movement_id = v_movement WHERE id = v_unit.id RETURNING * INTO v_returned;
  PERFORM public._commercial_delivery_audit('returned_good', p_partner_id, v_movement, NULL, v_unit.id, p_reason, jsonb_build_object('return_item_id', v_item, 'source_item_id', v_unit.source_item_id));
  RETURN jsonb_build_object('delivery_unit', to_jsonb(v_returned), 'product', jsonb_build_object('id', v_unit.product_id, 'code', v_unit.product_code, 'name', v_unit.product_name, 'variant', v_unit.product_variant, 'size', v_unit.product_size, 'price_to_catcorn', v_unit.unit_price), 'movement_id', v_movement, 'status', 'returned_good');
END;
$$;

CREATE OR REPLACE FUNCTION public.void_or_replace_commercial_delivery_unit(p_unit_id UUID, p_reason TEXT, p_replace BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE v_actor UUID; v_unit public.commercial_delivery_units%ROWTYPE; v_new UUID; v_status TEXT;
BEGIN
  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO v_unit FROM public.commercial_delivery_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery unit not found'; END IF;
  v_actor := public._commercial_delivery_actor(v_unit.partner_id, true);
  IF v_unit.status NOT IN ('generated', 'printed') THEN RAISE EXCEPTION 'Only unreleased units can be replaced or voided'; END IF;
  v_status := public._commercial_delivery_source_status(v_unit.source_type, COALESCE(v_unit.movement_id, v_unit.wholesale_order_id));
  IF v_status = 'pending_release' AND NOT p_replace THEN RAISE EXCEPTION 'A pending delivery unit must be replaced'; END IF;
  IF v_status <> 'cancelled' AND NOT p_replace THEN RAISE EXCEPTION 'Only a fully cancelled source can void a unit'; END IF;
  IF p_replace THEN
    v_new := public._commercial_delivery_insert_unit(v_unit.source_type, v_unit.partner_id, v_unit.movement_id, v_unit.wholesale_order_id, v_unit.source_item_id, v_unit.product_id, v_unit.product_lot_id, v_unit.product_code, v_unit.product_name, v_unit.product_variant, v_unit.product_size, v_unit.unit_price, v_unit.unit_cost, v_actor, v_unit.id);
    UPDATE public.commercial_delivery_units SET status = 'replaced', voided_at = now(), voided_by = v_actor, replaced_by_unit_id = v_new WHERE id = v_unit.id;
    PERFORM public._commercial_delivery_audit('replaced', v_unit.partner_id, v_unit.movement_id, v_unit.wholesale_order_id, v_unit.id, p_reason, jsonb_build_object('replacement_unit_id', v_new));
  ELSE
    UPDATE public.commercial_delivery_units SET status = 'voided', voided_at = now(), voided_by = v_actor WHERE id = v_unit.id;
    PERFORM public._commercial_delivery_audit('voided', v_unit.partner_id, v_unit.movement_id, v_unit.wholesale_order_id, v_unit.id, p_reason, '{}'::JSONB);
  END IF;
  RETURN jsonb_build_object('voided_unit_id', v_unit.id, 'replacement_unit_id', v_new);
END;
$$;

-- Final guard: scan_code is now non-null and immutable for every unit.
CREATE OR REPLACE FUNCTION public._commercial_delivery_unit_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE v_type TEXT; v_source UUID; v_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Commercial delivery units cannot be deleted'; END IF;
  v_type := NEW.source_type; v_source := COALESCE(NEW.movement_id, NEW.wholesale_order_id); v_status := public._commercial_delivery_source_status(v_type, v_source);
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'generated' OR v_status <> 'pending_release' OR NEW.scan_code !~ '^[0-9]{16}$' THEN RAISE EXCEPTION 'New units require a valid scan_code and a pending release'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.barcode_value IS DISTINCT FROM OLD.barcode_value OR NEW.scan_code IS DISTINCT FROM OLD.scan_code OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.partner_id IS DISTINCT FROM OLD.partner_id OR NEW.movement_id IS DISTINCT FROM OLD.movement_id OR NEW.wholesale_order_id IS DISTINCT FROM OLD.wholesale_order_id OR NEW.source_item_id IS DISTINCT FROM OLD.source_item_id OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.product_lot_id IS DISTINCT FROM OLD.product_lot_id OR NEW.product_code IS DISTINCT FROM OLD.product_code OR NEW.product_name IS DISTINCT FROM OLD.product_name OR NEW.product_variant IS DISTINCT FROM OLD.product_variant OR NEW.product_size IS DISTINCT FROM OLD.product_size OR NEW.unit_price IS DISTINCT FROM OLD.unit_price OR NEW.unit_cost IS DISTINCT FROM OLD.unit_cost THEN RAISE EXCEPTION 'Delivery unit identity and financial snapshot are immutable'; END IF;
  IF OLD.status = 'generated' AND NEW.status = 'printed' AND NEW.print_count = OLD.print_count + 1 THEN NULL;
  ELSIF OLD.status = 'printed' AND NEW.status = 'printed' AND NEW.print_count = OLD.print_count + 1 AND NULLIF(BTRIM(NEW.last_reprint_reason), '') IS NOT NULL THEN NULL;
  ELSIF OLD.status = 'printed' AND NEW.status = 'scanned' THEN NULL;
  ELSIF OLD.status = 'scanned' AND NEW.status = 'released' AND v_status = 'pending_release' AND public._commercial_delivery_units_ready_for_release(v_type, v_source) THEN NULL;
  ELSIF OLD.status IN ('generated', 'printed') AND NEW.status = 'replaced' AND NEW.replaced_by_unit_id IS NOT NULL THEN NULL;
  ELSIF OLD.status IN ('generated', 'printed') AND NEW.status = 'voided' AND v_status = 'cancelled' THEN NULL;
  ELSIF OLD.status = 'released' AND NEW.status = 'spoiled' AND NEW.spoilage_movement_id IS NOT NULL THEN NULL;
  ELSIF OLD.status = 'released' AND NEW.status = 'returned_good' AND NEW.returned_good_at IS NOT NULL AND NEW.returned_good_by IS NOT NULL AND NEW.return_movement_id IS NOT NULL THEN NULL;
  ELSE RAISE EXCEPTION 'Invalid delivery-unit transition from % to %', OLD.status, NEW.status;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMIT;
