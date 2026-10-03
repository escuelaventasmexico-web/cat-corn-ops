BEGIN;

DO $$
DECLARE
  v_definition TEXT;
  v_required_sku TEXT;
  v_expected_key TEXT;
  v_actual_key TEXT;
  v_count INTEGER;
BEGIN
  IF to_regclass('public.products') IS NULL
     OR to_regclass('public.sales') IS NULL
     OR to_regclass('public.sale_items') IS NULL
     OR to_regclass('public.user_profiles') IS NULL
     OR to_regclass('public.commission_events') IS NULL
     OR to_regclass('public.commission_program_eligibility_snapshots') IS NULL THEN
    RAISE EXCEPTION 'Required POS and commission tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = 'products'
      AND column_row.column_name IN (
        'id', 'name', 'product_name', 'size', 'price', 'active', 'flavor',
        'grams', 'sku_code', 'barcode_value'
      )
    GROUP BY column_row.table_schema, column_row.table_name
    HAVING count(*) = 10
  ) THEN
    RAISE EXCEPTION 'products is missing a required catalog column';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = 'sale_items'
      AND column_row.column_name IN (
        'id', 'sale_id', 'product_id', 'product_name', 'is_generic',
        'quantity', 'price', 'discount_amount', 'discount_reason'
      )
    GROUP BY column_row.table_schema, column_row.table_name
    HAVING count(*) = 9
  ) THEN
    RAISE EXCEPTION 'sale_items is missing a required POS column';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = 'sales'
      AND column_row.column_name IN ('id', 'branch_id', 'cashier_id', 'created_at', 'sale_origin', 'is_refunded')
    GROUP BY column_row.table_schema, column_row.table_name
    HAVING count(*) = 6
  ) THEN
    RAISE EXCEPTION 'sales is missing a required branch or commission column';
  END IF;

  IF to_regprocedure('public.commission_product_key(text,text)') IS NULL
     OR to_regprocedure('public.get_commission_rule_id(text,text,date)') IS NULL
     OR to_regprocedure('public.get_commission_rule_amount(text,text,date)') IS NULL
     OR to_regprocedure('public.sync_pos_commission_for_sale_item(uuid)') IS NULL
     OR to_regprocedure('public.user_has_branch_access(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required POS commission functions are missing';
  END IF;

  SELECT pg_get_functiondef(proc_row.oid)
    INTO v_definition
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.proname = 'sync_pos_commission_for_sale_item'
    AND proc_row.prokind = 'f'
    AND pg_get_function_result(proc_row.oid) = 'uuid'
    AND pg_get_function_identity_arguments(proc_row.oid) = 'p_sale_item_id uuid';

  IF v_definition IS NULL
     OR v_definition NOT ILIKE '%commission_program_eligibility_snapshots%'
     OR v_definition NOT ILIKE '%vendedora_pos%'
     OR v_definition NOT ILIKE '%socios_comerciales%'
     OR v_definition NOT ILIKE '%venta_pieza%'
     OR v_definition NOT ILIKE '%source_type = ''pos_sale''%'
     OR v_definition NOT ILIKE '%ON CONFLICT DO NOTHING%' THEN
    RAISE EXCEPTION 'The complete expected POS commission definition is not deployed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_row
    JOIN pg_proc AS proc_row ON proc_row.oid = trigger_row.tgfoid
    WHERE trigger_row.tgrelid = 'public.sale_items'::REGCLASS
      AND NOT trigger_row.tgisinternal
      AND proc_row.proname = 'trg_sync_pos_commission_after_item'
  ) THEN
    RAISE EXCEPTION 'The deployed POS commission wrapper trigger is missing';
  END IF;

  FOR v_required_sku, v_expected_key IN
    SELECT expected.sku_code, expected.product_key
    FROM (VALUES
      ('SLGM180'::TEXT, 'gato_mayor_clasico'::TEXT),
      ('SLJF240'::TEXT, 'jefe_felino_clasico'::TEXT),
      ('SBGM180'::TEXT, 'gato_mayor_sabores'::TEXT),
      ('SBJF240'::TEXT, 'jefe_felino_sabores'::TEXT),
      ('CAGM180'::TEXT, 'caramelo_gato_mayor'::TEXT),
      ('GOMIX90'::TEXT, NULL::TEXT)
    ) AS expected(sku_code, product_key)
  LOOP
    SELECT count(*) INTO v_count
    FROM public.products AS product
    WHERE upper(coalesce(product.sku_code, '')) = v_required_sku;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Required base SKU % must identify exactly one product; found %',
        v_required_sku, v_count;
    END IF;

    IF v_expected_key IS NOT NULL THEN
      SELECT public.commission_product_key(
        coalesce(nullif(trim(product.product_name), ''), product.name),
        product.flavor
      )
      INTO v_actual_key
      FROM public.products AS product
      WHERE upper(product.sku_code) = v_required_sku;

      IF v_actual_key IS DISTINCT FROM v_expected_key THEN
        RAISE EXCEPTION 'Base SKU % resolves to commission key %, expected %',
          v_required_sku, v_actual_key, v_expected_key;
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_combo_catalog_identity(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT regexp_replace(
    translate(
      lower(coalesce(p_value, '')),
      'áéíóúüñÁÉÍÓÚÜÑ',
      'aeiouunAEIOUUN'
    ),
    '[^a-z0-9]+',
    '',
    'g'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_valid_ean13(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_value ~ '^[0-9]{13}$' THEN
      (
        (
          SELECT sum(
            substring(p_value FROM position_row FOR 1)::INTEGER
            * CASE WHEN position_row % 2 = 0 THEN 3 ELSE 1 END
          )
          FROM generate_series(1, 12) AS positions(position_row)
        ) + substring(p_value FROM 13 FOR 1)::INTEGER
      ) % 10 = 0
    ELSE FALSE
  END;
$$;

REVOKE ALL ON FUNCTION public.normalize_combo_catalog_identity(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_valid_ean13(TEXT) FROM PUBLIC, anon, authenticated;

LOCK TABLE public.products IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_spec RECORD;
  v_product_id UUID;
  v_match_count INTEGER;
  v_existing_sku TEXT;
  v_existing_barcode TEXT;
  v_existing_name TEXT;
  v_existing_product_name TEXT;
BEGIN
  FOR v_spec IN
    SELECT *
    FROM (VALUES
      ('Agua gaseosa Frambuesa Negra'::TEXT, 'Bebida'::TEXT, 35.00::NUMERIC, 'BEBIDAS'::TEXT, 0::INTEGER, 'AGUA-FRAMBUESA-NEGRA'::TEXT, '7500000000206'::TEXT),
      ('Agua gaseosa Mango Naranja'::TEXT, 'Bebida'::TEXT, 35.00::NUMERIC, 'BEBIDAS'::TEXT, 0::INTEGER, 'AGUA-MANGO-NARANJA'::TEXT, '7500000000213'::TEXT),
      ('Agua gaseosa Fresa Kiwi'::TEXT, 'Bebida'::TEXT, 35.00::NUMERIC, 'BEBIDAS'::TEXT, 0::INTEGER, 'AGUA-FRESA-KIWI'::TEXT, '7500000000220'::TEXT),
      ('Combo Kiara'::TEXT, 'Combo'::TEXT, 85.00::NUMERIC, 'COMBOS'::TEXT, 0::INTEGER, 'COMBO-KIARA'::TEXT, '7500000000237'::TEXT),
      ('Combo Beto'::TEXT, 'Combo'::TEXT, 105.00::NUMERIC, 'COMBOS'::TEXT, 0::INTEGER, 'COMBO-BETO'::TEXT, '7500000000244'::TEXT),
      ('Combo Marcelo'::TEXT, 'Combo'::TEXT, 95.00::NUMERIC, 'COMBOS'::TEXT, 0::INTEGER, 'COMBO-MARCELO'::TEXT, '7500000000251'::TEXT),
      ('Combo Ramón'::TEXT, 'Combo'::TEXT, 115.00::NUMERIC, 'COMBOS'::TEXT, 0::INTEGER, 'COMBO-RAMON'::TEXT, '7500000000268'::TEXT),
      ('Combo Mauricia'::TEXT, 'Combo'::TEXT, 125.00::NUMERIC, 'COMBOS'::TEXT, 0::INTEGER, 'COMBO-MAURICIA'::TEXT, '7500000000275'::TEXT)
    ) AS requested(name, size, price, flavor, grams, sku_code, barcode_value)
  LOOP
    IF NOT public.is_valid_ean13(v_spec.barcode_value) THEN
      RAISE EXCEPTION 'Configured barcode % is not valid EAN-13', v_spec.barcode_value;
    END IF;

    SELECT count(DISTINCT product.id)
      INTO v_match_count
    FROM public.products AS product
    WHERE upper(coalesce(product.sku_code, '')) = v_spec.sku_code
       OR product.barcode_value = v_spec.barcode_value
       OR public.normalize_combo_catalog_identity(product.name)
          = public.normalize_combo_catalog_identity(v_spec.name)
       OR public.normalize_combo_catalog_identity(product.product_name)
          = public.normalize_combo_catalog_identity(v_spec.name)
       OR (
         v_spec.sku_code LIKE 'AGUA-%'
         AND (
           regexp_replace(
             public.normalize_combo_catalog_identity(product.name),
             '^(aguagaseosa|agua)',
             ''
           ) = regexp_replace(
             public.normalize_combo_catalog_identity(v_spec.name),
             '^(aguagaseosa|agua)',
             ''
           )
           OR regexp_replace(
             public.normalize_combo_catalog_identity(product.product_name),
             '^(aguagaseosa|agua)',
             ''
           ) = regexp_replace(
             public.normalize_combo_catalog_identity(v_spec.name),
             '^(aguagaseosa|agua)',
             ''
           )
         )
       );

    IF v_match_count > 1 THEN
      RAISE EXCEPTION 'Catalog identity collision for %, SKU %, barcode %',
        v_spec.name, v_spec.sku_code, v_spec.barcode_value;
    END IF;

    IF v_match_count = 1 THEN
      SELECT
        product.id,
        product.sku_code,
        product.barcode_value,
        product.name,
        product.product_name
        INTO
          v_product_id,
          v_existing_sku,
          v_existing_barcode,
          v_existing_name,
          v_existing_product_name
      FROM public.products AS product
      WHERE upper(coalesce(product.sku_code, '')) = v_spec.sku_code
         OR product.barcode_value = v_spec.barcode_value
         OR public.normalize_combo_catalog_identity(product.name)
            = public.normalize_combo_catalog_identity(v_spec.name)
         OR public.normalize_combo_catalog_identity(product.product_name)
            = public.normalize_combo_catalog_identity(v_spec.name)
         OR (
           v_spec.sku_code LIKE 'AGUA-%'
           AND (
             regexp_replace(
               public.normalize_combo_catalog_identity(product.name),
               '^(aguagaseosa|agua)',
               ''
             ) = regexp_replace(
               public.normalize_combo_catalog_identity(v_spec.name),
               '^(aguagaseosa|agua)',
               ''
             )
             OR regexp_replace(
               public.normalize_combo_catalog_identity(product.product_name),
               '^(aguagaseosa|agua)',
               ''
             ) = regexp_replace(
               public.normalize_combo_catalog_identity(v_spec.name),
               '^(aguagaseosa|agua)',
               ''
             )
           )
         )
      LIMIT 1;

      IF NOT (
           public.normalize_combo_catalog_identity(v_existing_name)
             = public.normalize_combo_catalog_identity(v_spec.name)
           OR public.normalize_combo_catalog_identity(v_existing_product_name)
             = public.normalize_combo_catalog_identity(v_spec.name)
           OR (
             v_spec.sku_code LIKE 'AGUA-%'
             AND (
               regexp_replace(
                 public.normalize_combo_catalog_identity(v_existing_name),
                 '^(aguagaseosa|agua)',
                 ''
               ) = regexp_replace(
                 public.normalize_combo_catalog_identity(v_spec.name),
                 '^(aguagaseosa|agua)',
                 ''
               )
               OR regexp_replace(
                 public.normalize_combo_catalog_identity(v_existing_product_name),
                 '^(aguagaseosa|agua)',
                 ''
               ) = regexp_replace(
                 public.normalize_combo_catalog_identity(v_spec.name),
                 '^(aguagaseosa|agua)',
                 ''
               )
             )
           )
         )
         OR (v_existing_sku IS NOT NULL AND upper(v_existing_sku) <> v_spec.sku_code)
         OR (v_existing_barcode IS NOT NULL AND v_existing_barcode <> v_spec.barcode_value) THEN
        RAISE EXCEPTION 'SKU or barcode for % belongs to another product identity', v_spec.name;
      END IF;

      UPDATE public.products
      SET name = v_spec.name,
          size = v_spec.size,
          price = v_spec.price,
          active = TRUE,
          flavor = v_spec.flavor,
          grams = v_spec.grams,
          sku_code = v_spec.sku_code,
          barcode_value = v_spec.barcode_value
      WHERE id = v_product_id;
    ELSE
      INSERT INTO public.products (
        name, size, price, active, flavor, grams, sku_code, barcode_value
      ) VALUES (
        v_spec.name, v_spec.size, v_spec.price, TRUE, v_spec.flavor,
        v_spec.grams, v_spec.sku_code, v_spec.barcode_value
      )
      RETURNING id INTO v_product_id;
    END IF;

    UPDATE public.products
    SET product_name = v_spec.name
    WHERE id = v_product_id;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'products'
        AND column_row.column_name = 'is_active'
    ) THEN
      EXECUTE 'UPDATE public.products SET is_active = TRUE WHERE id = $1'
        USING v_product_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'products'
        AND column_row.column_name = 'category'
    ) THEN
      EXECUTE 'UPDATE public.products SET category = $1 WHERE id = $2'
        USING v_spec.flavor, v_product_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'products'
        AND column_row.column_name = 'product_variant'
    ) THEN
      EXECUTE 'UPDATE public.products SET product_variant = $1 WHERE id = $2'
        USING v_spec.flavor, v_product_id;
    END IF;
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS products_official_combo_sku_unique_idx
  ON public.products ((upper(sku_code)))
  WHERE upper(sku_code) IN (
    'AGUA-FRAMBUESA-NEGRA', 'AGUA-MANGO-NARANJA', 'AGUA-FRESA-KIWI',
    'COMBO-KIARA', 'COMBO-BETO', 'COMBO-MARCELO', 'COMBO-RAMON',
    'COMBO-MAURICIA'
  );

CREATE UNIQUE INDEX IF NOT EXISTS products_official_combo_barcode_unique_idx
  ON public.products (barcode_value)
  WHERE barcode_value IN (
    '7500000000206', '7500000000213', '7500000000220',
    '7500000000237', '7500000000244', '7500000000251',
    '7500000000268', '7500000000275'
  );

CREATE TABLE IF NOT EXISTS public.product_combos (
  product_id UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE RESTRICT,
  commission_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (product_id <> commission_product_id)
);

CREATE TABLE IF NOT EXISTS public.product_combo_components (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  combo_product_id UUID NOT NULL REFERENCES public.product_combos(product_id) ON DELETE CASCADE,
  component_product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  component_type TEXT NOT NULL CHECK (component_type IN ('fixed', 'choice')),
  option_group TEXT,
  quantity_per_combo INTEGER NOT NULL CHECK (quantity_per_combo > 0),
  min_selections INTEGER,
  max_selections INTEGER,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (
      component_type = 'fixed'
      AND component_product_id IS NOT NULL
      AND option_group IS NULL
      AND min_selections IS NULL
      AND max_selections IS NULL
    )
    OR
    (
      component_type = 'choice'
      AND component_product_id IS NULL
      AND nullif(btrim(option_group), '') IS NOT NULL
      AND min_selections = 1
      AND max_selections = 1
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS product_combo_fixed_component_unique_idx
  ON public.product_combo_components (combo_product_id, component_product_id)
  WHERE component_type = 'fixed';

CREATE UNIQUE INDEX IF NOT EXISTS product_combo_option_group_unique_idx
  ON public.product_combo_components (combo_product_id, option_group)
  WHERE component_type = 'choice';

CREATE TABLE IF NOT EXISTS public.product_combo_component_options (
  component_id UUID NOT NULL REFERENCES public.product_combo_components(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (component_id, product_id)
);

INSERT INTO public.product_combos (product_id, commission_product_id, active)
SELECT combo_product.id, commission_product.id, TRUE
FROM (VALUES
  ('COMBO-KIARA'::TEXT, 'SLGM180'::TEXT),
  ('COMBO-BETO'::TEXT, 'SLJF240'::TEXT),
  ('COMBO-MARCELO'::TEXT, 'SBGM180'::TEXT),
  ('COMBO-RAMON'::TEXT, 'SBJF240'::TEXT),
  ('COMBO-MAURICIA'::TEXT, 'CAGM180'::TEXT)
) AS requested(combo_sku, commission_sku)
JOIN public.products AS combo_product
  ON upper(combo_product.sku_code) = requested.combo_sku
JOIN public.products AS commission_product
  ON upper(commission_product.sku_code) = requested.commission_sku
ON CONFLICT (product_id) DO UPDATE
SET commission_product_id = EXCLUDED.commission_product_id,
    active = TRUE,
    updated_at = now();

DELETE FROM public.product_combo_components AS component
USING public.products AS combo_product
WHERE component.combo_product_id = combo_product.id
  AND upper(combo_product.sku_code) IN (
    'COMBO-KIARA', 'COMBO-BETO', 'COMBO-MARCELO', 'COMBO-RAMON',
    'COMBO-MAURICIA'
  );

INSERT INTO public.product_combo_components (
  combo_product_id, component_product_id, component_type,
  quantity_per_combo, display_order
)
SELECT combo_product.id, component_product.id, 'fixed', 1, requested.display_order
FROM (VALUES
  ('COMBO-KIARA'::TEXT, 'SLGM180'::TEXT, 10),
  ('COMBO-KIARA'::TEXT, 'GOMIX90'::TEXT, 30),
  ('COMBO-BETO'::TEXT, 'SLJF240'::TEXT, 10),
  ('COMBO-BETO'::TEXT, 'GOMIX90'::TEXT, 30),
  ('COMBO-MARCELO'::TEXT, 'SBGM180'::TEXT, 10),
  ('COMBO-MARCELO'::TEXT, 'GOMIX90'::TEXT, 30),
  ('COMBO-RAMON'::TEXT, 'SBJF240'::TEXT, 10),
  ('COMBO-RAMON'::TEXT, 'GOMIX90'::TEXT, 30),
  ('COMBO-MAURICIA'::TEXT, 'CAGM180'::TEXT, 10),
  ('COMBO-MAURICIA'::TEXT, 'GOMIX90'::TEXT, 30)
) AS requested(combo_sku, component_sku, display_order)
JOIN public.products AS combo_product
  ON upper(combo_product.sku_code) = requested.combo_sku
JOIN public.products AS component_product
  ON upper(component_product.sku_code) = requested.component_sku;

INSERT INTO public.product_combo_components (
  combo_product_id, component_type, option_group, quantity_per_combo,
  min_selections, max_selections, display_order
)
SELECT combo_product.id, 'choice', 'beverage', 1, 1, 1, 20
FROM public.products AS combo_product
WHERE upper(combo_product.sku_code) IN (
  'COMBO-KIARA', 'COMBO-BETO', 'COMBO-MARCELO', 'COMBO-RAMON',
  'COMBO-MAURICIA'
);

INSERT INTO public.product_combo_component_options (
  component_id, product_id, active, display_order
)
SELECT choice.id, beverage.id, TRUE, beverage_order.display_order
FROM public.product_combo_components AS choice
CROSS JOIN (VALUES
  ('AGUA-FRAMBUESA-NEGRA'::TEXT, 10),
  ('AGUA-MANGO-NARANJA'::TEXT, 20),
  ('AGUA-FRESA-KIWI'::TEXT, 30)
) AS beverage_order(sku_code, display_order)
JOIN public.products AS beverage
  ON upper(beverage.sku_code) = beverage_order.sku_code
WHERE choice.component_type = 'choice'
  AND choice.option_group = 'beverage';

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS selected_beverage_product_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.sale_items'::REGCLASS
      AND constraint_row.conname = 'sale_items_selected_beverage_product_id_fkey'
  ) THEN
    ALTER TABLE public.sale_items
      ADD CONSTRAINT sale_items_selected_beverage_product_id_fkey
      FOREIGN KEY (selected_beverage_product_id)
      REFERENCES public.products(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.sale_item_combo_components (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_item_id UUID NOT NULL REFERENCES public.sale_items(id) ON DELETE RESTRICT,
  combo_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  component_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  component_type TEXT NOT NULL CHECK (component_type IN ('fixed', 'selected_option')),
  quantity_per_combo INTEGER NOT NULL CHECK (quantity_per_combo > 0),
  quantity_total INTEGER NOT NULL CHECK (quantity_total > 0),
  component_name TEXT NOT NULL CHECK (btrim(component_name) <> ''),
  component_sku TEXT NOT NULL CHECK (btrim(component_sku) <> ''),
  observed_unit_price NUMERIC NOT NULL CHECK (observed_unit_price >= 0),
  selected_option_group TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (component_type = 'fixed' AND selected_option_group IS NULL)
    OR
    (component_type = 'selected_option' AND nullif(btrim(selected_option_group), '') IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS sale_item_combo_components_null_safe_unique_idx
  ON public.sale_item_combo_components (
    sale_item_id,
    component_product_id,
    (coalesce(selected_option_group, ''))
  );

CREATE OR REPLACE FUNCTION public.protect_sale_item_combo_components()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND current_setting('catcorn.combo_snapshot_write', TRUE) = 'on'
     AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Combo component snapshots are append-only and trigger-managed';
END;
$$;

DROP TRIGGER IF EXISTS aa_protect_sale_item_combo_components
  ON public.sale_item_combo_components;
CREATE TRIGGER aa_protect_sale_item_combo_components
  BEFORE INSERT OR UPDATE OR DELETE ON public.sale_item_combo_components
  FOR EACH ROW EXECUTE FUNCTION public.protect_sale_item_combo_components();

CREATE OR REPLACE FUNCTION public.capture_sale_item_combo_components()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_combo public.product_combos%ROWTYPE;
  v_combo_active BOOLEAN;
  v_combo_price NUMERIC;
  v_selected_option_count INTEGER;
  v_snapshot_count INTEGER;
BEGIN
  SELECT combo.*
    INTO v_combo
  FROM public.product_combos AS combo
  WHERE combo.product_id = NEW.product_id;

  IF NOT FOUND THEN
    IF NEW.selected_beverage_product_id IS NOT NULL THEN
      RAISE EXCEPTION 'A beverage selection is valid only for an official combo';
    END IF;
    RETURN NEW;
  END IF;

  SELECT product.active, product.price INTO v_combo_active, v_combo_price
  FROM public.products AS product
  WHERE product.id = v_combo.product_id;

  IF COALESCE(NEW.is_generic, FALSE) OR NEW.product_id IS NULL THEN
    RAISE EXCEPTION 'An official combo must reference its catalog product';
  END IF;

  IF NOT coalesce(v_combo.active, FALSE)
     OR NOT coalesce(v_combo_active, FALSE) THEN
    RAISE EXCEPTION 'The selected official combo is inactive';
  END IF;

  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'An official combo requires a positive quantity';
  END IF;

  IF NEW.price IS DISTINCT FROM v_combo_price
     OR coalesce(NEW.discount_amount, 0) <> 0
     OR NEW.discount_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Official combos must use their fixed catalog price without line discounts';
  END IF;

  IF NEW.selected_beverage_product_id IS NULL THEN
    RAISE EXCEPTION 'Select exactly one Agua gaseosa for the official combo';
  END IF;

  SELECT count(*)
    INTO v_selected_option_count
  FROM public.product_combo_components AS choice
  JOIN public.product_combo_component_options AS option_row
    ON option_row.component_id = choice.id
  JOIN public.products AS beverage
    ON beverage.id = option_row.product_id
  WHERE choice.combo_product_id = NEW.product_id
    AND choice.component_type = 'choice'
    AND choice.option_group = 'beverage'
    AND choice.min_selections = 1
    AND choice.max_selections = 1
    AND option_row.product_id = NEW.selected_beverage_product_id
    AND option_row.active
    AND coalesce(beverage.active, FALSE);

  IF v_selected_option_count <> 1 THEN
    RAISE EXCEPTION 'The selected beverage is not a valid active option for this combo';
  END IF;

  IF (
    SELECT count(*)
    FROM public.product_combo_components AS component
    JOIN public.products AS component_product
      ON component_product.id = component.component_product_id
    WHERE component.combo_product_id = NEW.product_id
      AND component.component_type = 'fixed'
      AND coalesce(component_product.active, FALSE)
  ) <> 2 THEN
    RAISE EXCEPTION 'The official combo must have exactly two active fixed components';
  END IF;

  PERFORM set_config('catcorn.combo_snapshot_write', 'on', TRUE);

  INSERT INTO public.sale_item_combo_components (
    sale_item_id, combo_product_id, component_product_id, component_type,
    quantity_per_combo, quantity_total, component_name, component_sku,
    observed_unit_price, selected_option_group
  )
  SELECT
    NEW.id, NEW.product_id, component_product.id, 'fixed',
    component.quantity_per_combo,
    component.quantity_per_combo * NEW.quantity,
    coalesce(nullif(trim(component_product.product_name), ''), component_product.name),
    component_product.sku_code,
    component_product.price,
    NULL
  FROM public.product_combo_components AS component
  JOIN public.products AS component_product
    ON component_product.id = component.component_product_id
  WHERE component.combo_product_id = NEW.product_id
    AND component.component_type = 'fixed'
  ORDER BY component.display_order, component.id;

  INSERT INTO public.sale_item_combo_components (
    sale_item_id, combo_product_id, component_product_id, component_type,
    quantity_per_combo, quantity_total, component_name, component_sku,
    observed_unit_price, selected_option_group
  )
  SELECT
    NEW.id, NEW.product_id, beverage.id, 'selected_option',
    choice.quantity_per_combo,
    choice.quantity_per_combo * NEW.quantity,
    coalesce(nullif(trim(beverage.product_name), ''), beverage.name),
    beverage.sku_code,
    beverage.price,
    choice.option_group
  FROM public.product_combo_components AS choice
  JOIN public.product_combo_component_options AS option_row
    ON option_row.component_id = choice.id
   AND option_row.product_id = NEW.selected_beverage_product_id
  JOIN public.products AS beverage
    ON beverage.id = option_row.product_id
  WHERE choice.combo_product_id = NEW.product_id
    AND choice.component_type = 'choice'
    AND choice.option_group = 'beverage';

  PERFORM set_config('catcorn.combo_snapshot_write', 'off', TRUE);

  SELECT count(*) INTO v_snapshot_count
  FROM public.sale_item_combo_components AS snapshot
  WHERE snapshot.sale_item_id = NEW.id;

  IF v_snapshot_count <> 3 THEN
    RAISE EXCEPTION 'An official combo sale item must create exactly three component snapshots';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_capture_sale_item_combo_components
  ON public.sale_items;
CREATE TRIGGER aa_capture_sale_item_combo_components
  AFTER INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.capture_sale_item_combo_components();

CREATE OR REPLACE FUNCTION public.get_product_combo_catalog()
RETURNS TABLE (
  product_id UUID,
  name TEXT,
  sku_code TEXT,
  barcode_value TEXT,
  price NUMERIC,
  active BOOLEAN,
  commission_product_id UUID,
  fixed_components JSONB,
  option_groups JSONB
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    combo.product_id,
    coalesce(nullif(trim(combo_product.product_name), ''), combo_product.name),
    combo_product.sku_code,
    combo_product.barcode_value,
    combo_product.price,
    combo.active AND coalesce(combo_product.active, FALSE),
    combo.commission_product_id,
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'product_id', component_product.id,
            'name', coalesce(nullif(trim(component_product.product_name), ''), component_product.name),
            'sku_code', component_product.sku_code,
            'quantity', component.quantity_per_combo,
            'active', coalesce(component_product.active, FALSE)
          )
          ORDER BY component.display_order, component.id
        )
        FROM public.product_combo_components AS component
        JOIN public.products AS component_product
          ON component_product.id = component.component_product_id
        WHERE component.combo_product_id = combo.product_id
          AND component.component_type = 'fixed'
      ),
      '[]'::JSONB
    ),
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'key', choice.option_group,
            'quantity', choice.quantity_per_combo,
            'min_selections', choice.min_selections,
            'max_selections', choice.max_selections,
            'options', coalesce(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'product_id', option_product.id,
                    'name', coalesce(nullif(trim(option_product.product_name), ''), option_product.name),
                    'sku_code', option_product.sku_code,
                    'quantity', choice.quantity_per_combo,
                    'active', option_row.active AND coalesce(option_product.active, FALSE)
                  )
                  ORDER BY option_row.display_order, option_product.id
                )
                FROM public.product_combo_component_options AS option_row
                JOIN public.products AS option_product
                  ON option_product.id = option_row.product_id
                WHERE option_row.component_id = choice.id
              ),
              '[]'::JSONB
            )
          )
          ORDER BY choice.display_order, choice.id
        )
        FROM public.product_combo_components AS choice
        WHERE choice.combo_product_id = combo.product_id
          AND choice.component_type = 'choice'
      ),
      '[]'::JSONB
    )
  FROM public.product_combos AS combo
  JOIN public.products AS combo_product ON combo_product.id = combo.product_id
  ORDER BY combo_product.name, combo.product_id;
$$;

ALTER TABLE public.product_combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_combo_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_combo_component_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_item_combo_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_combos_authenticated_select ON public.product_combos;
CREATE POLICY product_combos_authenticated_select
  ON public.product_combos FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS product_combo_components_authenticated_select ON public.product_combo_components;
CREATE POLICY product_combo_components_authenticated_select
  ON public.product_combo_components FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS product_combo_options_authenticated_select ON public.product_combo_component_options;
CREATE POLICY product_combo_options_authenticated_select
  ON public.product_combo_component_options FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS sale_item_combo_components_branch_select ON public.sale_item_combo_components;
CREATE POLICY sale_item_combo_components_branch_select
  ON public.sale_item_combo_components
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sale_items AS item
      JOIN public.sales AS sale ON sale.id = item.sale_id
      WHERE item.id = sale_item_combo_components.sale_item_id
        AND public.user_has_branch_access(sale.branch_id)
    )
  );

REVOKE ALL ON TABLE public.product_combos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.product_combo_components FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.product_combo_component_options FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sale_item_combo_components FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.product_combos TO authenticated;
GRANT SELECT ON TABLE public.product_combo_components TO authenticated;
GRANT SELECT ON TABLE public.product_combo_component_options TO authenticated;
GRANT SELECT ON TABLE public.sale_item_combo_components TO authenticated;

REVOKE ALL ON FUNCTION public.protect_sale_item_combo_components() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_sale_item_combo_components() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_product_combo_catalog() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_combo_catalog() TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_pos_commission_for_sale_item(p_sale_item_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.sale_items%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_sold_product public.products%ROWTYPE;
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
  v_is_official_combo BOOLEAN := FALSE;
  v_snapshot_metadata JSONB;
  v_event_metadata JSONB;
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

  SELECT product.* INTO v_sold_product
  FROM public.products AS product WHERE product.id = v_item.product_id;
  IF v_sold_product.id IS NULL THEN
    RAISE WARNING
      'POS commission: product_id % no encontrado para sale_item %',
      v_item.product_id, p_sale_item_id;
    RETURN NULL;
  END IF;

  SELECT commission_product.* INTO v_product
  FROM public.product_combos AS combo
  JOIN public.products AS commission_product
    ON commission_product.id = combo.commission_product_id
  WHERE combo.product_id = v_item.product_id
    AND combo.active;

  IF v_product.id IS NULL THEN
    v_product := v_sold_product;
  ELSE
    v_is_official_combo := TRUE;
  END IF;

  v_product_name := COALESCE(NULLIF(trim(COALESCE(v_product.product_name, '')), ''), v_product.name);
  v_product_key := public.commission_product_key(v_product_name, v_product.flavor);
  v_business_date := (v_sale.created_at AT TIME ZONE 'America/Mexico_City')::DATE;

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
      v_snapshot_metadata := jsonb_build_object(
        'product_key', v_product_key,
        'business_date', v_business_date
      );
      IF v_is_official_combo THEN
        v_snapshot_metadata := v_snapshot_metadata || jsonb_build_object(
          'official_combo', TRUE,
          'combo_product_id', v_sold_product.id,
          'commission_product_id', v_product.id
        );
      END IF;

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
        v_snapshot_metadata
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

  v_event_metadata := jsonb_build_object(
    'channel', 'pos', 'cashier_id', v_sale.cashier_id, 'sale_id', v_sale.id,
    'sale_item_id', v_item.id, 'product_id', v_item.product_id,
    'commission_scheme', v_scheme, 'business_date', v_business_date
  );
  IF v_is_official_combo THEN
    v_event_metadata := v_event_metadata || jsonb_build_object(
      'official_combo', TRUE,
      'combo_product_id', v_sold_product.id,
      'combo_product_sku', v_sold_product.sku_code,
      'commission_product_id', v_product.id,
      'commission_product_sku', v_product.sku_code
    );
  END IF;

  INSERT INTO public.commission_events (
    seller_id, partner_id, source_type, source_id, source_item_id, rule_id,
    product_key, product_name, product_variant, product_size, quantity,
    unit_commission, commission_amount, release_condition, status, earned_at,
    available_at, metadata
  ) VALUES (
    v_sale.cashier_id, NULL, 'pos_sale', v_sale.id, v_item.id, v_rule_id,
    v_product_key, v_product_name, v_product.flavor, v_product.size, v_item.quantity,
    v_unit_commission, v_commission_amount, 'full_payment', 'available',
    v_sale.created_at, v_sale.created_at, v_event_metadata
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

COMMENT ON TABLE public.product_combos IS
  'Official sellable combos and their single popcorn commission reference.';
COMMENT ON TABLE public.sale_item_combo_components IS
  'Immutable component snapshots generated atomically after an official combo sale item is inserted.';
COMMENT ON COLUMN public.sale_items.selected_beverage_product_id IS
  'Required server-validated beverage selection when product_id identifies an official combo.';

COMMIT;
