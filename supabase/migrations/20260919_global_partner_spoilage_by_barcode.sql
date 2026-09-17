BEGIN;

-- Global label resolution for the Comodato spoilage modal. The barcode is the
-- only client-supplied identity; partner, source, product and status are read
-- from the immutable commercial_delivery_units snapshot.
CREATE OR REPLACE FUNCTION public.resolve_commercial_delivery_unit_by_barcode(
  p_barcode TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_scan_code TEXT := regexp_replace(COALESCE(p_barcode, ''), '[[:space:]]+', '', 'g');
  v_unit public.commercial_delivery_units%ROWTYPE;
  v_partner public.commercial_partners%ROWTYPE;
BEGIN
  IF v_scan_code !~ '^[0-9]{16}$' THEN
    RAISE EXCEPTION 'El código de etiqueta debe contener exactamente 16 dígitos';
  END IF;

  SELECT * INTO v_unit
  FROM public.commercial_delivery_units AS unit
  WHERE unit.scan_code = v_scan_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etiqueta de entrega desconocida';
  END IF;

  -- Retains the established authenticated-user and partner-assignment guard.
  PERFORM public._commercial_delivery_actor(v_unit.partner_id);

  SELECT * INTO v_partner
  FROM public.commercial_partners AS partner
  WHERE partner.id = v_unit.partner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el socio de la etiqueta';
  END IF;

  RETURN jsonb_build_object(
    'unit_id', v_unit.id,
    'partner_id', v_unit.partner_id,
    'partner_name', COALESCE(NULLIF(BTRIM(v_partner.business_name), ''), NULLIF(BTRIM(v_partner.responsible_name), ''), v_unit.partner_id::TEXT),
    'partner_folio', v_partner.folio,
    'source_type', v_unit.source_type,
    'movement_id', v_unit.movement_id,
    'wholesale_order_id', v_unit.wholesale_order_id,
    'product_id', v_unit.product_id,
    'product_name', v_unit.product_name,
    'product_variant', v_unit.product_variant,
    'product_size', v_unit.product_size,
    'scan_code', v_unit.scan_code,
    'status', v_unit.status,
    'released_at', v_unit.released_at,
    'generated_at', v_unit.generated_at,
    'eligible_for_operational_spoilage', v_unit.source_type = 'comodato' AND v_unit.status = 'released'
  );
END;
$$;

-- This deliberately has no partner argument. The partner and all commercial
-- identity are derived again after locking the scanned unit, so a modal opened
-- from a different partner cannot debit that partner by mistake.
CREATE OR REPLACE FUNCTION public.register_global_partner_spoilage_by_barcode(
  p_barcode TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_scan_code TEXT := regexp_replace(COALESCE(p_barcode, ''), '[[:space:]]+', '', 'g');
  v_actor UUID;
  v_unit public.commercial_delivery_units%ROWTYPE;
  v_partner public.commercial_partners%ROWTYPE;
  v_movement UUID;
  v_item UUID;
BEGIN
  IF v_scan_code !~ '^[0-9]{16}$' THEN
    RAISE EXCEPTION 'El código de etiqueta debe contener exactamente 16 dígitos';
  END IF;

  SELECT * INTO v_unit
  FROM public.commercial_delivery_units AS unit
  WHERE unit.scan_code = v_scan_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etiqueta de entrega desconocida';
  END IF;

  -- The existing role/assignment guard is evaluated for the detected partner,
  -- never for a partner id submitted by the browser.
  v_actor := public._commercial_delivery_actor(v_unit.partner_id);

  IF v_unit.source_type = 'mayoreo' THEN
    RAISE EXCEPTION 'Esta etiqueta corresponde a Mayoreo; no puede registrarse como merma de Comodato';
  END IF;
  IF v_unit.source_type <> 'comodato' THEN
    RAISE EXCEPTION 'Esta etiqueta no corresponde a una entrega de Comodato';
  END IF;
  IF v_unit.spoilage_movement_id IS NOT NULL OR v_unit.status = 'spoiled' THEN
    RAISE EXCEPTION 'Esta etiqueta ya fue registrada como merma';
  END IF;
  IF v_unit.status <> 'released' THEN
    CASE v_unit.status
      WHEN 'returned_good' THEN RAISE EXCEPTION 'Esta etiqueta ya fue devuelta en buen estado';
      WHEN 'voided' THEN RAISE EXCEPTION 'Esta etiqueta fue anulada';
      WHEN 'replaced' THEN RAISE EXCEPTION 'Esta etiqueta fue reemplazada';
      WHEN 'generated', 'printed', 'scanned' THEN RAISE EXCEPTION 'Esta etiqueta todavía no está liberada para registrar merma';
      ELSE RAISE EXCEPTION 'Sólo una etiqueta liberada puede registrarse como merma (%)', v_unit.status;
    END CASE;
  END IF;

  SELECT * INTO v_partner
  FROM public.commercial_partners AS partner
  WHERE partner.id = v_unit.partner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el socio de la etiqueta';
  END IF;

  INSERT INTO public.commercial_partner_movements (
    partner_id, movement_type, movement_date, status, notes
  ) VALUES (
    v_unit.partner_id,
    'spoilage',
    (now() AT TIME ZONE 'America/Mexico_City')::DATE,
    'completed',
    NULLIF(BTRIM(p_reason), '')
  )
  RETURNING id INTO v_movement;

  INSERT INTO public.commercial_partner_movement_items (
    movement_id, partner_id, product_id, product_name, product_variant,
    product_size, quantity_delivered, quantity_sold, quantity_withdrawn,
    quantity_spoiled, quantity_adjusted, price_to_catcorn,
    suggested_retail_price, amount_due, notes
  ) VALUES (
    v_movement, v_unit.partner_id, v_unit.product_id, v_unit.product_name,
    v_unit.product_variant, v_unit.product_size, 0, 0, 0, 1, 0,
    v_unit.unit_price, 0, 0, NULLIF(BTRIM(p_reason), '')
  )
  RETURNING id INTO v_item;

  -- The row lock plus this released -> spoiled transition makes a repeated or
  -- concurrent request reject before it can create a second inventory effect.
  UPDATE public.commercial_delivery_units AS unit
  SET status = 'spoiled',
      spoiled_at = now(),
      spoiled_by = v_actor,
      spoilage_movement_id = v_movement
  WHERE unit.id = v_unit.id;

  PERFORM public._commercial_delivery_audit(
    'spoiled',
    v_unit.partner_id,
    v_movement,
    NULL,
    v_unit.id,
    p_reason,
    jsonb_build_object(
      'source_item_id', v_unit.source_item_id,
      'spoilage_item_id', v_item,
      'resolved_server_side', true,
      'scan_code', v_unit.scan_code
    )
  );

  RETURN jsonb_build_object(
    'unit_id', v_unit.id,
    'movement_id', v_movement,
    'movement_item_id', v_item,
    'partner_id', v_unit.partner_id,
    'partner_name', COALESCE(NULLIF(BTRIM(v_partner.business_name), ''), NULLIF(BTRIM(v_partner.responsible_name), ''), v_unit.partner_id::TEXT),
    'partner_folio', v_partner.folio,
    'source_type', v_unit.source_type,
    'product_name', v_unit.product_name,
    'product_variant', v_unit.product_variant,
    'product_size', v_unit.product_size,
    'released_at', v_unit.released_at,
    'status', 'spoiled'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_commercial_delivery_unit_by_barcode(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.register_global_partner_spoilage_by_barcode(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_commercial_delivery_unit_by_barcode(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_global_partner_spoilage_by_barcode(TEXT, TEXT) TO authenticated;

COMMIT;
