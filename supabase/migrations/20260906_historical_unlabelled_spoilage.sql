-- Historical, unlabelled Comodato spoilage. This migration does not alter
-- barcode/unit workflows or infer a catalog product from legacy text.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_partner_historical_unlabelled_stock(
  p_partner_id UUID
)
RETURNS TABLE (
  product_name TEXT,
  product_variant TEXT,
  product_size TEXT,
  available_quantity INTEGER,
  historical_price_to_catcorn NUMERIC,
  historical_suggested_retail_price NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
BEGIN
  -- This is an administrator-only read of the same partner stock that the
  -- exception can affect; it deliberately returns no catalog identity.
  v_actor := public._commercial_delivery_actor(p_partner_id, true);

  RETURN QUERY
  WITH historical_deliveries AS (
    SELECT
      NULLIF(BTRIM(item.product_name), '') AS product_name,
      NULLIF(BTRIM(item.product_variant), '') AS product_variant,
      NULLIF(BTRIM(item.product_size), '') AS product_size,
      COALESCE(item.quantity_delivered, 0)::INTEGER AS quantity_delivered,
      item.price_to_catcorn::NUMERIC AS price_to_catcorn,
      item.suggested_retail_price::NUMERIC AS suggested_retail_price
    FROM public.commercial_partner_movements AS movement
    JOIN public.commercial_partner_movement_items AS item ON item.movement_id = movement.id
    WHERE movement.partner_id = p_partner_id
      AND movement.movement_type = 'delivery'
      AND movement.status = 'completed'
      AND COALESCE(item.quantity_delivered, 0) > 0
      -- A labelled source item is never available through this exception.
      AND NOT EXISTS (
        SELECT 1 FROM public.commercial_delivery_units AS unit
        WHERE unit.source_item_id = item.id
      )
  ),
  identities AS (
    SELECT product_name, product_variant, product_size,
      SUM(quantity_delivered)::INTEGER AS delivered_quantity,
      (ARRAY_AGG(price_to_catcorn ORDER BY price_to_catcorn DESC NULLS LAST))[1] AS price_to_catcorn,
      (ARRAY_AGG(suggested_retail_price ORDER BY suggested_retail_price DESC NULLS LAST))[1] AS suggested_retail_price
    FROM historical_deliveries
    GROUP BY product_name, product_variant, product_size
  ),
  unlabelled_resolutions AS (
    SELECT
      NULLIF(BTRIM(item.product_name), '') AS product_name,
      NULLIF(BTRIM(item.product_variant), '') AS product_variant,
      NULLIF(BTRIM(item.product_size), '') AS product_size,
      SUM(COALESCE(item.quantity_sold, 0) + COALESCE(item.quantity_withdrawn, 0) + COALESCE(item.quantity_spoiled, 0))::INTEGER AS resolved_quantity
    FROM public.commercial_partner_movements AS movement
    JOIN public.commercial_partner_movement_items AS item ON item.movement_id = movement.id
    WHERE movement.partner_id = p_partner_id
      AND movement.status = 'completed'
      AND movement.movement_type IN ('settlement', 'withdrawal', 'spoilage')
      -- Barcode actions create an audit event with a delivery unit. They must
      -- never reduce the independent historical/unlabelled pool.
      AND NOT EXISTS (
        SELECT 1 FROM public.commercial_delivery_audit_events AS audit
        WHERE audit.movement_id = movement.id
          AND audit.delivery_unit_id IS NOT NULL
      )
    GROUP BY
      NULLIF(BTRIM(item.product_name), ''),
      NULLIF(BTRIM(item.product_variant), ''),
      NULLIF(BTRIM(item.product_size), '')
  )
  SELECT
    identity.product_name,
    identity.product_variant,
    identity.product_size,
    GREATEST(identity.delivered_quantity - COALESCE(resolution.resolved_quantity, 0), 0)::INTEGER,
    identity.price_to_catcorn,
    identity.suggested_retail_price
  FROM identities AS identity
  LEFT JOIN unlabelled_resolutions AS resolution
    ON resolution.product_name IS NOT DISTINCT FROM identity.product_name
   AND resolution.product_variant IS NOT DISTINCT FROM identity.product_variant
   AND resolution.product_size IS NOT DISTINCT FROM identity.product_size
  WHERE identity.delivered_quantity - COALESCE(resolution.resolved_quantity, 0) > 0
  ORDER BY identity.product_name, identity.product_variant, identity.product_size;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_partner_spoilage_historical_exception(
  p_partner_id UUID,
  p_identity JSONB,
  p_quantity INTEGER,
  p_reason TEXT,
  p_movement_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_name TEXT := NULLIF(BTRIM(p_identity->>'product_name'), '');
  v_variant TEXT := NULLIF(BTRIM(p_identity->>'product_variant'), '');
  v_size TEXT := NULLIF(BTRIM(p_identity->>'product_size'), '');
  v_price NUMERIC;
  v_suggested_price NUMERIC;
  v_available INTEGER;
  v_movement UUID;
  v_item UUID;
  v_lock_key TEXT;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad de merma histórica debe ser un entero positivo';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'La excepción histórica requiere la identidad del producto';
  END IF;
  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'La excepción histórica requiere un motivo';
  END IF;

  v_actor := public._commercial_delivery_actor(p_partner_id, true);
  -- Serializes concurrent changes for this partner and exact historical
  -- snapshot. Hash collisions only serialize extra work; they cannot merge data.
  v_lock_key := p_partner_id::TEXT || '|' || v_name || '|' || COALESCE(v_variant, '') || '|' || COALESCE(v_size, '');
  PERFORM pg_advisory_xact_lock(hashtext(v_lock_key));

  SELECT
    stock.available_quantity,
    stock.historical_price_to_catcorn,
    stock.historical_suggested_retail_price
  INTO v_available, v_price, v_suggested_price
  FROM public.get_partner_historical_unlabelled_stock(p_partner_id) AS stock
  WHERE stock.product_name IS NOT DISTINCT FROM v_name
    AND stock.product_variant IS NOT DISTINCT FROM v_variant
    AND stock.product_size IS NOT DISTINCT FROM v_size;

  IF COALESCE(v_available, 0) < p_quantity THEN
    RAISE EXCEPTION 'La cantidad solicitada (%) excede el saldo histórico sin etiqueta disponible (%)', p_quantity, COALESCE(v_available, 0);
  END IF;

  INSERT INTO public.commercial_partner_movements (
    partner_id, movement_type, movement_date, status, notes
  ) VALUES (
    p_partner_id, 'spoilage', COALESCE(p_movement_date, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::DATE), 'completed', NULLIF(BTRIM(p_reason), '')
  ) RETURNING id INTO v_movement;

  -- product_id remains NULL intentionally: this preserves the historical
  -- snapshot and does not claim a catalog mapping that has not been verified.
  INSERT INTO public.commercial_partner_movement_items (
    movement_id, partner_id, product_id, product_name, product_variant, product_size,
    quantity_delivered, quantity_sold, quantity_withdrawn, quantity_spoiled,
    quantity_adjusted, price_to_catcorn, suggested_retail_price, amount_due, notes
  ) VALUES (
    v_movement, p_partner_id, NULL, v_name, v_variant, v_size,
    0, 0, 0, p_quantity, 0, COALESCE(v_price, 0), COALESCE(v_suggested_price, 0), 0, NULLIF(BTRIM(p_reason), '')
  ) RETURNING id INTO v_item;

  PERFORM public._commercial_delivery_audit(
    'spoilage_exception', p_partner_id, v_movement, NULL, NULL, p_reason,
    JSONB_BUILD_OBJECT(
      'historical_or_unlabelled', true,
      'historical_unlabelled_spoilage', true,
      'quantity', p_quantity,
      'product_name', v_name,
      'product_variant', v_variant,
      'product_size', v_size,
      'spoilage_item_id', v_item,
      'actor_id', v_actor
    )
  );

  RETURN JSONB_BUILD_OBJECT(
    'movement_id', v_movement,
    'movement_item_id', v_item,
    'quantity_spoiled', p_quantity,
    'remaining_historical_quantity', v_available - p_quantity,
    'exception', true,
    'historical_unlabelled', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_partner_historical_unlabelled_stock(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_partner_spoilage_historical_exception(UUID, JSONB, INTEGER, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_historical_unlabelled_stock(UUID), public.register_partner_spoilage_historical_exception(UUID, JSONB, INTEGER, TEXT, DATE) TO authenticated;

COMMIT;
