BEGIN;

-- GOMIX90 consumes its raw material when production is recorded through
-- record_gummy_production. Printing its label must therefore register only the
-- label event; it must never debit the bulk-gummy raw material a second time.

DO $$
BEGIN
  IF to_regprocedure('public.print_sku_labels(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION
      'public.print_sku_labels(uuid, integer) must exist before applying this migration';
  END IF;

  IF to_regclass('public.products') IS NULL
     OR to_regclass('public.product_recipe_items') IS NULL
     OR to_regclass('public.raw_materials') IS NULL
     OR to_regclass('public.sku_print_events') IS NULL
     OR to_regclass('public.sku_print_event_items') IS NULL
     OR to_regclass('public.gummy_production_runs') IS NULL THEN
    RAISE EXCEPTION
      'products, product_recipe_items, raw_materials, sku_print_events, sku_print_event_items and gummy_production_runs are required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.products
    WHERE sku_code = 'GOMIX90'
      AND barcode_value = '7500000000190'
      AND active
  ) THEN
    RAISE EXCEPTION
      'The active GOMIX90 product with barcode 7500000000190 is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.product_recipe_items AS recipe_item
    JOIN public.products AS product
      ON product.id = recipe_item.product_id
    WHERE product.sku_code = 'GOMIX90'
  ) THEN
    RAISE EXCEPTION
      'GOMIX90 must not have a conventional product_recipe_items recipe because production already consumes its raw material';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.print_sku_labels(
  p_product_id UUID,
  p_units INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product RECORD;
  v_event_id UUID;
  v_shortages JSONB;
  v_has_recipe BOOLEAN;
  v_unit_cost NUMERIC;
  v_total_cost NUMERIC;
  v_gummy_units_produced BIGINT;
  v_gummy_units_already_printed BIGINT;
  v_available_to_print BIGINT;
BEGIN
  IF p_units IS NULL OR p_units <= 0 THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'message', 'La cantidad a imprimir debe ser mayor a 0.'
    );
  END IF;

  SELECT
    product.id,
    product.name,
    product.sku_code,
    product.barcode_value,
    product.unit_cost,
    product.active
  INTO v_product
  FROM public.products AS product
  WHERE product.id = p_product_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'message', 'Producto no encontrado.'
    );
  END IF;

  IF coalesce(v_product.active, FALSE) = FALSE THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'message', 'El producto está inactivo.'
    );
  END IF;

  IF v_product.sku_code IS NULL OR v_product.barcode_value IS NULL THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'message', 'El producto no tiene SKU o barcode configurado.'
    );
  END IF;

  -- GOMIX90 is produced through record_gummy_production. Serialize label
  -- reservations for this product, then compare production against prior
  -- first-print events. Reprints made by the UI do not call this RPC and do not
  -- consume another produced unit.
  IF v_product.sku_code = 'GOMIX90' THEN
    PERFORM 1
    FROM public.products AS product
    WHERE product.id = p_product_id
    FOR UPDATE;

    SELECT coalesce(sum(run.units_produced), 0)
    INTO v_gummy_units_produced
    FROM public.gummy_production_runs AS run
    WHERE run.product_id = p_product_id;

    SELECT coalesce(sum(print_event.units_printed), 0)
    INTO v_gummy_units_already_printed
    FROM public.sku_print_events AS print_event
    WHERE print_event.product_id = p_product_id;

    v_available_to_print := greatest(
      v_gummy_units_produced - v_gummy_units_already_printed,
      0
    );

    IF p_units > v_available_to_print THEN
      RETURN jsonb_build_object(
        'ok', FALSE,
        'message', format(
          'Sólo hay %s bolsa(s) de gomitas producida(s) pendiente(s) de etiquetar.',
          v_available_to_print
        ),
        'units_available_to_print', v_available_to_print,
        'units_requested', p_units
      );
    END IF;

    v_unit_cost := v_product.unit_cost;
    v_total_cost := CASE
      WHEN v_unit_cost IS NULL THEN NULL
      ELSE round((v_unit_cost * p_units)::NUMERIC, 2)
    END;

    INSERT INTO public.sku_print_events (
      product_id,
      units_printed,
      sku_code,
      barcode_value,
      unit_cost_snapshot,
      total_cost_snapshot
    )
    VALUES (
      v_product.id,
      p_units,
      v_product.sku_code,
      v_product.barcode_value,
      v_unit_cost,
      v_total_cost
    )
    RETURNING id INTO v_event_id;

    RETURN jsonb_build_object(
      'ok', TRUE,
      'message', 'Impresión de gomitas registrada sin descontar materia prima nuevamente.',
      'print_event_id', v_event_id,
      'product_id', v_product.id,
      'product_name', v_product.name,
      'sku_code', v_product.sku_code,
      'barcode_value', v_product.barcode_value,
      'units_printed', p_units,
      'units_available_to_print', v_available_to_print - p_units,
      'unit_cost_snapshot', v_unit_cost,
      'total_cost_snapshot', v_total_cost
    );
  END IF;

  -- Existing behavior for every conventional product remains unchanged.
  SELECT EXISTS (
    SELECT 1
    FROM public.product_recipe_items AS recipe_item
    WHERE recipe_item.product_id = p_product_id
  )
  INTO v_has_recipe;

  IF NOT v_has_recipe THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'message', 'El producto no tiene receta configurada.'
    );
  END IF;

  PERFORM 1
  FROM public.raw_materials AS material
  JOIN public.product_recipe_items AS recipe_item
    ON recipe_item.raw_material_id = material.id
  WHERE recipe_item.product_id = p_product_id
  ORDER BY material.id
  FOR UPDATE OF material;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'raw_material_id', shortage.raw_material_id,
        'material_name', shortage.material_name,
        'unit', shortage.unit,
        'required_qty', shortage.required_qty,
        'available_qty', shortage.available_qty,
        'missing_qty', shortage.missing_qty
      )
      ORDER BY shortage.material_name
    ),
    '[]'::JSONB
  )
  INTO v_shortages
  FROM (
    SELECT
      material.id AS raw_material_id,
      material.name AS material_name,
      material.unit,
      round((recipe_item.qty_per_unit * p_units)::NUMERIC, 4) AS required_qty,
      round(material.current_stock::NUMERIC, 4) AS available_qty,
      round(
        ((recipe_item.qty_per_unit * p_units) - material.current_stock)::NUMERIC,
        4
      ) AS missing_qty
    FROM public.product_recipe_items AS recipe_item
    JOIN public.raw_materials AS material
      ON material.id = recipe_item.raw_material_id
    WHERE recipe_item.product_id = p_product_id
      AND material.current_stock < (recipe_item.qty_per_unit * p_units)
  ) AS shortage;

  IF jsonb_array_length(v_shortages) > 0 THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'message', 'Inventario insuficiente para imprimir.',
      'shortages', v_shortages
    );
  END IF;

  v_unit_cost := v_product.unit_cost;
  v_total_cost := CASE
    WHEN v_unit_cost IS NULL THEN NULL
    ELSE round((v_unit_cost * p_units)::NUMERIC, 2)
  END;

  INSERT INTO public.sku_print_events (
    product_id,
    units_printed,
    sku_code,
    barcode_value,
    unit_cost_snapshot,
    total_cost_snapshot
  )
  VALUES (
    v_product.id,
    p_units,
    v_product.sku_code,
    v_product.barcode_value,
    v_unit_cost,
    v_total_cost
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.sku_print_event_items (
    print_event_id,
    raw_material_id,
    qty_consumed,
    unit_snapshot,
    material_name_snapshot
  )
  SELECT
    v_event_id,
    material.id,
    round((recipe_item.qty_per_unit * p_units)::NUMERIC, 4),
    material.unit,
    material.name
  FROM public.product_recipe_items AS recipe_item
  JOIN public.raw_materials AS material
    ON material.id = recipe_item.raw_material_id
  WHERE recipe_item.product_id = p_product_id;

  UPDATE public.raw_materials AS material
  SET
    current_stock = material.current_stock - consumption.qty_to_discount,
    updated_at = now()
  FROM (
    SELECT
      recipe_item.raw_material_id,
      round(sum(recipe_item.qty_per_unit * p_units)::NUMERIC, 4)
        AS qty_to_discount
    FROM public.product_recipe_items AS recipe_item
    WHERE recipe_item.product_id = p_product_id
    GROUP BY recipe_item.raw_material_id
  ) AS consumption
  WHERE material.id = consumption.raw_material_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'message', 'Impresión registrada y stock descontado correctamente.',
    'print_event_id', v_event_id,
    'product_id', v_product.id,
    'product_name', v_product.name,
    'sku_code', v_product.sku_code,
    'barcode_value', v_product.barcode_value,
    'units_printed', p_units,
    'unit_cost_snapshot', v_unit_cost,
    'total_cost_snapshot', v_total_cost
  );
END;
$$;

REVOKE ALL ON FUNCTION public.print_sku_labels(UUID, INTEGER)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.print_sku_labels(UUID, INTEGER)
TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
