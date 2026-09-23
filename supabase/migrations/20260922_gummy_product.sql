BEGIN;

-- Gomitas de Grenetina is a global catalog product. It has no branch_id,
-- and production consumes only the global bulk-gummy raw material.

DO $$
BEGIN
  IF to_regclass('public.products') IS NULL
     OR to_regclass('public.raw_materials') IS NULL
     OR to_regclass('public.user_profiles') IS NULL THEN
    RAISE EXCEPTION
      'products, raw_materials and user_profiles are required before installing Gomitas de Grenetina';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name IN (
        'id', 'name', 'size', 'price', 'active', 'flavor', 'grams',
        'sku_code', 'barcode_value'
      )
    GROUP BY table_schema, table_name
    HAVING count(*) = 9
  ) THEN
    RAISE EXCEPTION
      'products is missing one of id, name, size, price, active, flavor, grams, sku_code or barcode_value';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'raw_materials'
      AND column_name IN ('id', 'name', 'current_stock', 'unit', 'updated_at')
    GROUP BY table_schema, table_name
    HAVING count(*) = 5
  ) THEN
    RAISE EXCEPTION
      'raw_materials is missing one of id, name, current_stock, unit or updated_at';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name IN ('id', 'is_active')
    GROUP BY table_schema, table_name
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION
      'user_profiles.id and user_profiles.is_active are required for gummy production';
  END IF;
END;
$$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC;

ALTER TABLE public.raw_materials
  ADD COLUMN IF NOT EXISTS material_code TEXT;

-- Prevent concurrent catalog changes while identities are checked and created.
LOCK TABLE public.products IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.raw_materials IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_product_id UUID;
  v_product_count INTEGER;
  v_barcode_count INTEGER;
  v_material_id UUID;
  v_material_count INTEGER;
  v_material_name TEXT;
  v_material_code TEXT;
  v_material_unit TEXT;
  v_existing_name TEXT;
  v_existing_size TEXT;
  v_existing_flavor TEXT;
  v_existing_grams NUMERIC;
  v_existing_barcode TEXT;
BEGIN
  SELECT count(*)
  INTO v_product_count
  FROM public.products
  WHERE sku_code = 'GOMIX90';

  IF v_product_count > 1 THEN
    RAISE EXCEPTION 'SKU GOMIX90 is assigned to more than one product';
  END IF;

  SELECT count(*)
  INTO v_barcode_count
  FROM public.products
  WHERE barcode_value = '7500000000190';

  IF v_barcode_count > 1 THEN
    RAISE EXCEPTION 'Barcode 7500000000190 is assigned to more than one product';
  END IF;

  IF v_product_count = 1 THEN
    SELECT id, name, size, flavor, grams, barcode_value
    INTO v_product_id, v_existing_name, v_existing_size, v_existing_flavor,
         v_existing_grams, v_existing_barcode
    FROM public.products
    WHERE sku_code = 'GOMIX90';

    IF v_existing_name IS DISTINCT FROM 'Gomitas de Grenetina Mix'
       OR v_existing_size IS DISTINCT FROM '90 g'
       OR v_existing_flavor IS DISTINCT FROM 'GOMITAS'
       OR v_existing_grams IS DISTINCT FROM 90
       OR v_existing_barcode IS DISTINCT FROM '7500000000190' THEN
      RAISE EXCEPTION
        'SKU GOMIX90 already belongs to a different product identity; no catalog row was changed';
    END IF;

    UPDATE public.products
    SET price = 18.00,
        active = TRUE,
        unit_cost = 7.20
    WHERE id = v_product_id;
  ELSIF v_barcode_count = 1 THEN
    RAISE EXCEPTION
      'Barcode 7500000000190 already belongs to a product other than SKU GOMIX90';
  ELSE
    INSERT INTO public.products (
      name, size, price, active, flavor, grams, sku_code, barcode_value, unit_cost
    )
    VALUES (
      'Gomitas de Grenetina Mix', '90 g', 18.00, TRUE, 'GOMITAS', 90,
      'GOMIX90', '7500000000190', 7.20
    )
    RETURNING id INTO v_product_id;
  END IF;

  -- Optional display columns are updated only if they exist. Dynamic SQL keeps
  -- this migration valid in installations where those columns are absent.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
      AND column_name = 'is_active'
  ) THEN
    EXECUTE 'UPDATE public.products SET is_active = TRUE WHERE id = $1'
      USING v_product_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
      AND column_name = 'product_name'
  ) THEN
    EXECUTE 'UPDATE public.products SET product_name = $1 WHERE id = $2'
      USING 'Gomitas de Grenetina Mix', v_product_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
      AND column_name = 'category'
  ) THEN
    EXECUTE 'UPDATE public.products SET category = $1 WHERE id = $2'
      USING 'GOMITAS', v_product_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
      AND column_name = 'product_variant'
  ) THEN
    EXECUTE 'UPDATE public.products SET product_variant = $1 WHERE id = $2'
      USING 'Mix', v_product_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
      AND column_name = 'weight_grams'
  ) THEN
    EXECUTE 'UPDATE public.products SET weight_grams = $1 WHERE id = $2'
      USING 90, v_product_id;
  END IF;

  SELECT count(*)
  INTO v_material_count
  FROM public.raw_materials
  WHERE material_code = 'GOMITAS-GREN-01'
     OR lower(btrim(name)) = lower('Gomitas de grenetina a granel');

  IF v_material_count > 1 THEN
    RAISE EXCEPTION
      'More than one raw material matches GOMITAS-GREN-01 or Gomitas de grenetina a granel';
  END IF;

  IF v_material_count = 1 THEN
    SELECT id, name, material_code, unit
    INTO v_material_id, v_material_name, v_material_code, v_material_unit
    FROM public.raw_materials
    WHERE material_code = 'GOMITAS-GREN-01'
       OR lower(btrim(name)) = lower('Gomitas de grenetina a granel');

    IF lower(btrim(v_material_name)) IS DISTINCT FROM
       lower('Gomitas de grenetina a granel') THEN
      RAISE EXCEPTION
        'Material code GOMITAS-GREN-01 already belongs to a different raw material; no row was changed';
    END IF;

    IF v_material_code IS NOT NULL
       AND v_material_code IS DISTINCT FROM 'GOMITAS-GREN-01' THEN
      RAISE EXCEPTION
        'Gomitas de grenetina a granel already has material code "%"; no row was changed',
        v_material_code;
    END IF;

    IF lower(btrim(v_material_unit)) IS DISTINCT FROM 'g' THEN
      RAISE EXCEPTION
        'Existing gummy raw material % uses unit "%"; it must already be grams (g). No stock or unit was changed',
        v_material_id, v_material_unit;
    END IF;

    UPDATE public.raw_materials
    SET material_code = 'GOMITAS-GREN-01'
    WHERE id = v_material_id;
  ELSE
    INSERT INTO public.raw_materials (material_code, name, unit, current_stock)
    VALUES ('GOMITAS-GREN-01', 'Gomitas de grenetina a granel', 'g', 0)
    RETURNING id INTO v_material_id;
  END IF;
END;
$$;

-- These partial indexes protect the exact identities introduced here without
-- imposing new uniqueness rules on unrelated legacy catalog rows.
CREATE UNIQUE INDEX IF NOT EXISTS products_gomix90_sku_unique
  ON public.products (sku_code)
  WHERE sku_code = 'GOMIX90';

CREATE UNIQUE INDEX IF NOT EXISTS products_gomix90_ean13_unique
  ON public.products (barcode_value)
  WHERE barcode_value = '7500000000190';

CREATE UNIQUE INDEX IF NOT EXISTS raw_materials_gomitas_gren_01_code_unique
  ON public.raw_materials (material_code)
  WHERE material_code = 'GOMITAS-GREN-01';

-- IF NOT EXISTS is name-based. Verify that a pre-existing index with one of
-- these names was not silently accepted with a different definition.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index AS idx
    WHERE idx.indexrelid = 'public.products_gomix90_sku_unique'::REGCLASS
      AND idx.indrelid = 'public.products'::REGCLASS
      AND idx.indisvalid
      AND idx.indisunique
      AND idx.indnkeyatts = 1
      AND pg_get_indexdef(idx.indexrelid, 1, TRUE) = 'sku_code'
      AND pg_get_expr(idx.indpred, idx.indrelid) ILIKE '%sku_code%'
      AND pg_get_expr(idx.indpred, idx.indrelid) LIKE '%GOMIX90%'
  ) THEN
    RAISE EXCEPTION
      'products_gomix90_sku_unique exists with an unexpected definition';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index AS idx
    WHERE idx.indexrelid = 'public.products_gomix90_ean13_unique'::REGCLASS
      AND idx.indrelid = 'public.products'::REGCLASS
      AND idx.indisvalid
      AND idx.indisunique
      AND idx.indnkeyatts = 1
      AND pg_get_indexdef(idx.indexrelid, 1, TRUE) = 'barcode_value'
      AND pg_get_expr(idx.indpred, idx.indrelid) ILIKE '%barcode_value%'
      AND pg_get_expr(idx.indpred, idx.indrelid) LIKE '%7500000000190%'
  ) THEN
    RAISE EXCEPTION
      'products_gomix90_ean13_unique exists with an unexpected definition';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index AS idx
    WHERE idx.indexrelid =
          'public.raw_materials_gomitas_gren_01_code_unique'::REGCLASS
      AND idx.indrelid = 'public.raw_materials'::REGCLASS
      AND idx.indisvalid
      AND idx.indisunique
      AND idx.indnkeyatts = 1
      AND pg_get_indexdef(idx.indexrelid, 1, TRUE) = 'material_code'
      AND pg_get_expr(idx.indpred, idx.indrelid) ILIKE '%material_code%'
      AND pg_get_expr(idx.indpred, idx.indrelid) LIKE '%GOMITAS-GREN-01%'
  ) THEN
    RAISE EXCEPTION
      'raw_materials_gomitas_gren_01_code_unique exists with an unexpected definition';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.gummy_product_recipes (
  product_id UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE RESTRICT,
  raw_material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
  grams_per_unit NUMERIC NOT NULL CHECK (grams_per_unit > 0),
  raw_material_cost_per_kg NUMERIC NOT NULL CHECK (raw_material_cost_per_kg >= 0),
  unit_cost NUMERIC NOT NULL CHECK (unit_cost >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gummy_product_recipes_unit_cost_matches_recipe
    CHECK (
      unit_cost = round(
        (grams_per_unit / 1000.0) * raw_material_cost_per_kg,
        4
      )
    )
);

CREATE TABLE IF NOT EXISTS public.gummy_production_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  raw_material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
  units_produced INTEGER NOT NULL CHECK (units_produced > 0),
  grams_consumed NUMERIC NOT NULL CHECK (grams_consumed > 0),
  unit_cost NUMERIC NOT NULL CHECK (unit_cost >= 0),
  produced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  produced_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS gummy_production_runs_product_produced_at_idx
  ON public.gummy_production_runs (product_id, produced_at DESC);

CREATE INDEX IF NOT EXISTS gummy_production_runs_raw_material_produced_at_idx
  ON public.gummy_production_runs (raw_material_id, produced_at DESC);

DO $$
DECLARE
  v_product_id UUID;
  v_material_id UUID;
BEGIN
  SELECT id
  INTO v_product_id
  FROM public.products
  WHERE sku_code = 'GOMIX90';

  SELECT id
  INTO v_material_id
  FROM public.raw_materials
  WHERE material_code = 'GOMITAS-GREN-01';

  IF v_product_id IS NULL OR v_material_id IS NULL THEN
    RAISE EXCEPTION
      'GOMIX90 and its gram-based raw material must exist before creating the recipe';
  END IF;

  INSERT INTO public.gummy_product_recipes (
    product_id,
    raw_material_id,
    grams_per_unit,
    raw_material_cost_per_kg,
    unit_cost,
    active
  )
  VALUES (v_product_id, v_material_id, 90, 80.00, 7.20, TRUE)
  ON CONFLICT (product_id) DO UPDATE
  SET raw_material_id = EXCLUDED.raw_material_id,
      grams_per_unit = EXCLUDED.grams_per_unit,
      raw_material_cost_per_kg = EXCLUDED.raw_material_cost_per_kg,
      unit_cost = EXCLUDED.unit_cost,
      active = TRUE,
      updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.record_gummy_production(
  p_units INTEGER,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_product_id UUID;
  v_raw_material_id UUID;
  v_grams_per_unit NUMERIC;
  v_unit_cost NUMERIC;
  v_grams_consumed NUMERIC;
  v_stock_before NUMERIC;
  v_material_unit TEXT;
  v_run_id UUID;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.user_profiles AS profile
    WHERE profile.id = v_actor
      AND coalesce(profile.is_active, FALSE)
  ) THEN
    RAISE EXCEPTION
      'An active authenticated user is required to record gummy production';
  END IF;

  IF p_units IS NULL OR p_units <= 0 THEN
    RAISE EXCEPTION 'The number of gummy bags must be greater than zero';
  END IF;

  SELECT
    recipe.product_id,
    recipe.raw_material_id,
    recipe.grams_per_unit,
    recipe.unit_cost,
    material.current_stock,
    material.unit
  INTO
    v_product_id,
    v_raw_material_id,
    v_grams_per_unit,
    v_unit_cost,
    v_stock_before,
    v_material_unit
  FROM public.gummy_product_recipes AS recipe
  JOIN public.products AS product
    ON product.id = recipe.product_id
  JOIN public.raw_materials AS material
    ON material.id = recipe.raw_material_id
  WHERE product.sku_code = 'GOMIX90'
    AND product.active
    AND recipe.active
  FOR UPDATE OF material;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The active GOMIX90 gummy recipe is not configured';
  END IF;

  IF lower(btrim(v_material_unit)) IS DISTINCT FROM 'g' THEN
    RAISE EXCEPTION
      'Gomitas de grenetina a granel must be measured in grams, found %',
      v_material_unit;
  END IF;

  v_grams_consumed := v_grams_per_unit * p_units;

  IF coalesce(v_stock_before, 0) < v_grams_consumed THEN
    RAISE EXCEPTION
      'Insufficient Gomitas de grenetina a granel stock. Available: % g, required: % g',
      coalesce(v_stock_before, 0), v_grams_consumed;
  END IF;

  UPDATE public.raw_materials
  SET current_stock = current_stock - v_grams_consumed,
      updated_at = now()
  WHERE id = v_raw_material_id;

  INSERT INTO public.gummy_production_runs (
    product_id,
    raw_material_id,
    units_produced,
    grams_consumed,
    unit_cost,
    produced_by,
    notes
  )
  VALUES (
    v_product_id,
    v_raw_material_id,
    p_units,
    v_grams_consumed,
    v_unit_cost,
    v_actor,
    nullif(btrim(p_notes), '')
  )
  RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'production_run_id', v_run_id,
    'product_id', v_product_id,
    'units_produced', p_units,
    'grams_consumed', v_grams_consumed,
    'raw_material_stock_remaining', v_stock_before - v_grams_consumed,
    'unit_cost', v_unit_cost
  );
END;
$$;

ALTER TABLE public.gummy_product_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gummy_production_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.gummy_product_recipes
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gummy_production_runs
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.gummy_product_recipes TO authenticated;
GRANT SELECT ON TABLE public.gummy_production_runs TO authenticated;

REVOKE ALL ON FUNCTION public.record_gummy_production(INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_gummy_production(INTEGER, TEXT)
  TO authenticated;

DROP POLICY IF EXISTS gummy_product_recipes_authenticated_select
  ON public.gummy_product_recipes;
CREATE POLICY gummy_product_recipes_authenticated_select
  ON public.gummy_product_recipes
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS gummy_production_runs_authenticated_select
  ON public.gummy_production_runs;
CREATE POLICY gummy_production_runs_authenticated_select
  ON public.gummy_production_runs
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

NOTIFY pgrst, 'reload schema';

COMMIT;
