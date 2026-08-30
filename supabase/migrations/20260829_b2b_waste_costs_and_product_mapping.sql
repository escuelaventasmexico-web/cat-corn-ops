-- Minimal B2B waste-cost correction.
-- Apply only after 20260828_b2b_product_analytics.sql.
-- This migration is intentionally created for separate review/execution.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Canonical cost settings. The deployed repository does not version an
--    app_settings table, so create the deployed-compatible shape when absent
--    and fail explicitly when an incompatible pre-existing shape is found.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value_numeric NUMERIC,
  value_text TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_settings_key_key
  ON public.app_settings(key);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'app_settings' AND column_name = 'key'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'app_settings' AND column_name = 'value_numeric'
  ) THEN
    RAISE EXCEPTION
      'public.app_settings exists but is incompatible: required columns are key and value_numeric';
  END IF;
END;
$$;

INSERT INTO public.app_settings (key, value_numeric)
VALUES
  ('cost_per_gram_salada', 0.02627178),
  ('cost_per_gram_sabores', 0.03319876),
  ('cost_per_gram_caramelo', 0.04723870)
ON CONFLICT (key) DO UPDATE
SET value_numeric = EXCLUDED.value_numeric,
    updated_at = NOW();

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'app_settings'
      AND policyname = 'Authenticated users can read app settings'
  ) THEN
    CREATE POLICY "Authenticated users can read app settings"
      ON public.app_settings
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Seven reviewed finished-product costs. CAMCH90 is deliberately absent.
-- ---------------------------------------------------------------------------

UPDATE public.products AS product
SET unit_cost = expected.unit_cost
FROM (VALUES
  ('SLMCH90'::TEXT, 2.9345::NUMERIC),
  ('SLGM180', 5.3989),
  ('SLJF240', 7.1052),
  ('SBMCH90', 3.5579),
  ('SBGM180', 6.6458),
  ('SBJF240', 8.7677),
  ('CAGM180', 10.1030)
) AS expected(sku_code, unit_cost)
WHERE product.sku_code = expected.sku_code;

DO $$
DECLARE
  v_matching_products INTEGER;
  v_correct_costs INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_matching_products
  FROM public.products
  WHERE sku_code IN (
    'SLMCH90', 'SLGM180', 'SLJF240',
    'SBMCH90', 'SBGM180', 'SBJF240',
    'CAGM180'
  );

  SELECT COUNT(*)
  INTO v_correct_costs
  FROM public.products AS product
  JOIN (VALUES
    ('SLMCH90'::TEXT, 2.9345::NUMERIC),
    ('SLGM180', 5.3989),
    ('SLJF240', 7.1052),
    ('SBMCH90', 3.5579),
    ('SBGM180', 6.6458),
    ('SBJF240', 8.7677),
    ('CAGM180', 10.1030)
  ) AS expected(sku_code, unit_cost)
    ON expected.sku_code = product.sku_code
   AND product.unit_cost = expected.unit_cost;

  IF v_matching_products <> 7 OR v_correct_costs <> 7 THEN
    RAISE EXCEPTION
      'Expected exactly seven reviewed SKUs with their requested unit costs; found %, correct %',
      v_matching_products,
      v_correct_costs;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Correct packaging for CAGM180. No cost column is added to raw_materials.
--    STU-17x25 is never selected or changed.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_columns TEXT := 'material_code, name, unit, current_stock';
  v_values TEXT := quote_literal('STU-20x30') || ', '
    || quote_literal('Bolsa stand-up 20 x 30') || ', '
    || quote_literal('pza') || ', 70';
  v_matching_rows INTEGER;
BEGIN
  IF TO_REGCLASS('public.raw_materials') IS NULL THEN
    RAISE EXCEPTION 'public.raw_materials does not exist';
  END IF;

  IF (SELECT relkind FROM pg_class WHERE oid = 'public.raw_materials'::REGCLASS) NOT IN ('r', 'p') THEN
    RAISE EXCEPTION 'public.raw_materials is not an updatable table';
  END IF;

  ALTER TABLE public.raw_materials
    ADD COLUMN IF NOT EXISTS material_code TEXT;

  CREATE UNIQUE INDEX IF NOT EXISTS raw_materials_material_code_key
    ON public.raw_materials(material_code)
    WHERE material_code IS NOT NULL;

  SELECT COUNT(*)
  INTO v_matching_rows
  FROM public.raw_materials
  WHERE material_code = 'STU-20x30'
     OR LOWER(BTRIM(name)) = LOWER('Bolsa stand-up 20 x 30');

  IF v_matching_rows > 1 THEN
    RAISE EXCEPTION
      'Multiple raw_materials rows could represent STU-20x30; migration stopped without choosing one';
  END IF;

  UPDATE public.raw_materials
  SET material_code = 'STU-20x30',
      name = 'Bolsa stand-up 20 x 30',
      unit = 'pza',
      current_stock = 70
  WHERE material_code = 'STU-20x30'
     OR LOWER(BTRIM(name)) = LOWER('Bolsa stand-up 20 x 30');

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'raw_materials'
        AND column_name = 'minimum_stock'
    ) THEN
      v_columns := v_columns || ', minimum_stock';
      v_values := v_values || ', 0';
    ELSIF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'raw_materials'
        AND column_name = 'min_stock'
    ) THEN
      v_columns := v_columns || ', min_stock';
      v_values := v_values || ', 0';
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'raw_materials'
        AND column_name = 'category'
    ) THEN
      v_columns := v_columns || ', category';
      v_values := v_values || ', ' || quote_literal('Empaque');
    END IF;

    EXECUTE FORMAT(
      'INSERT INTO public.raw_materials (%s) VALUES (%s)',
      v_columns,
      v_values
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'raw_materials'
      AND column_name = 'category'
  ) THEN
    UPDATE public.raw_materials
    SET category = 'Empaque'
    WHERE material_code = 'STU-20x30';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'raw_materials'
      AND column_name = 'updated_at'
  ) THEN
    UPDATE public.raw_materials
    SET updated_at = NOW()
    WHERE material_code = 'STU-20x30';
  END IF;
END;
$$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS bag_sku TEXT;

UPDATE public.products
SET bag_sku = 'STU-20x30',
    packaging_material_code = 'STU-20x30'
WHERE sku_code = 'CAGM180';

-- ---------------------------------------------------------------------------
-- 4. Explicit, versioned B2B-to-products mapping. Historical facts remain
--    untouched; name fields are stored here only as an explicit legacy key.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.b2b_product_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_catalog TEXT NOT NULL
    CHECK (source_catalog IN ('comodato', 'mayoreo')),
  source_product_code TEXT NOT NULL,
  source_product_name TEXT NOT NULL,
  source_variant TEXT NOT NULL,
  source_size TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from DATE NOT NULL DEFAULT DATE '-infinity',
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  UNIQUE (source_catalog, source_product_code, valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS b2b_product_mappings_active_code_key
  ON public.b2b_product_mappings(source_catalog, source_product_code)
  WHERE active AND valid_to IS NULL;

CREATE INDEX IF NOT EXISTS b2b_product_mappings_product_id_idx
  ON public.b2b_product_mappings(product_id);

ALTER TABLE public.b2b_product_mappings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'b2b_product_mappings'
      AND policyname = 'Authenticated users can read B2B product mappings'
  ) THEN
    CREATE POLICY "Authenticated users can read B2B product mappings"
      ON public.b2b_product_mappings
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END;
$$;

WITH requested_mapping(
  source_product_code,
  source_product_name,
  source_variant,
  source_size,
  target_sku
) AS (
  VALUES
    ('MICHI_CLASICO_90', 'Michi', 'Clásico', '90 gr', 'SLMCH90'),
    ('MICHI_SABORES_90', 'Michi', 'Sabores', '90 gr', 'SBMCH90'),
    ('GATO_MAYOR_CLASICO_180', 'Gato Mayor', 'Clásico', '180 gr', 'SLGM180'),
    ('GATO_MAYOR_SABORES_180', 'Gato Mayor', 'Sabores', '180 gr', 'SBGM180'),
    ('JEFE_FELINO_CLASICO_240', 'Jefe Felino', 'Clásico', '240 gr', 'SLJF240'),
    ('JEFE_FELINO_SABORES_240', 'Jefe Felino', 'Sabores', '240 gr', 'SBJF240'),
    ('CARAMELO_GATO_MAYOR_180', 'Caramelo Gato Mayor', 'Caramelo', '180 gr', 'CAGM180')
),
mapping_for_both_catalogs AS (
  SELECT
    source_catalog,
    requested.*
  FROM requested_mapping AS requested
  CROSS JOIN (VALUES ('comodato'::TEXT), ('mayoreo'::TEXT)) AS catalogs(source_catalog)
)
INSERT INTO public.b2b_product_mappings (
  source_catalog,
  source_product_code,
  source_product_name,
  source_variant,
  source_size,
  product_id,
  active,
  valid_from,
  valid_to
)
SELECT
  requested.source_catalog,
  requested.source_product_code,
  requested.source_product_name,
  requested.source_variant,
  requested.source_size,
  product.id,
  TRUE,
  DATE '-infinity',
  NULL
FROM mapping_for_both_catalogs AS requested
JOIN public.products AS product
  ON product.sku_code = requested.target_sku
ON CONFLICT (source_catalog, source_product_code, valid_from)
DO UPDATE SET
  source_product_name = EXCLUDED.source_product_name,
  source_variant = EXCLUDED.source_variant,
  source_size = EXCLUDED.source_size,
  product_id = EXCLUDED.product_id,
  active = TRUE,
  valid_to = NULL;

DO $$
DECLARE
  v_mapping_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_mapping_count
  FROM public.b2b_product_mappings
  WHERE active
    AND valid_to IS NULL
    AND source_product_code IN (
      'MICHI_CLASICO_90',
      'MICHI_SABORES_90',
      'GATO_MAYOR_CLASICO_180',
      'GATO_MAYOR_SABORES_180',
      'JEFE_FELINO_CLASICO_240',
      'JEFE_FELINO_SABORES_240',
      'CARAMELO_GATO_MAYOR_180'
    );

  IF v_mapping_count <> 14 THEN
    RAISE EXCEPTION
      'Expected 14 active mappings (seven for each source catalog), found %',
      v_mapping_count;
  END IF;
END;
$$;

-- Add product_id only when wholesale_price_catalog is a real table. If it is
-- a view, the explicit mapping table remains the authoritative relationship.
DO $$
DECLARE
  v_relkind "char";
  v_product_id_is_uuid BOOLEAN;
BEGIN
  SELECT relation.relkind
  INTO v_relkind
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'wholesale_price_catalog';

  IF v_relkind IN ('r', 'p') THEN
    ALTER TABLE public.wholesale_price_catalog
      ADD COLUMN IF NOT EXISTS product_id UUID;

    SELECT data_type = 'uuid'
    INTO v_product_id_is_uuid
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wholesale_price_catalog'
      AND column_name = 'product_id';

    IF NOT COALESCE(v_product_id_is_uuid, false) THEN
      RAISE NOTICE
        'wholesale_price_catalog.product_id is not UUID; explicit b2b_product_mappings remains authoritative';
      RETURN;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.wholesale_price_catalog'::REGCLASS
        AND conname = 'wholesale_price_catalog_product_id_fkey'
    ) THEN
      ALTER TABLE public.wholesale_price_catalog
        ADD CONSTRAINT wholesale_price_catalog_product_id_fkey
        FOREIGN KEY (product_id)
        REFERENCES public.products(id)
        ON DELETE RESTRICT;
    END IF;

    UPDATE public.wholesale_price_catalog AS wholesale
    SET product_id = mapping.product_id
    FROM public.b2b_product_mappings AS mapping
    WHERE mapping.source_catalog = 'mayoreo'
      AND mapping.active
      AND mapping.valid_to IS NULL
      AND mapping.source_product_code = wholesale.product_code;
  END IF;
END;
$$;

-- The CREATE OR REPLACE FUNCTION definition follows. It preserves the
-- applied report metrics and FIFO implementation while replacing product
-- candidate resolution with public.b2b_product_mappings.
CREATE OR REPLACE FUNCTION public.get_b2b_product_analytics(
  p_start_date TIMESTAMPTZ,
  p_end_date_exclusive TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_start_date IS NULL OR p_end_date_exclusive IS NULL THEN
    RAISE EXCEPTION 'Both period boundaries are required';
  END IF;

  IF p_end_date_exclusive <= p_start_date THEN
    RAISE EXCEPTION 'p_end_date_exclusive must be greater than p_start_date';
  END IF;

  WITH
  params AS (
    SELECT
      (p_start_date AT TIME ZONE 'America/Mexico_City')::DATE AS start_date,
      (p_end_date_exclusive AT TIME ZONE 'America/Mexico_City')::DATE AS end_date_exclusive,
      (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::DATE AS as_of_date
  ),
  product_catalog AS (
    SELECT
      p.id,
      NULLIF(TO_JSONB(p)->>'sku_code', '') AS sku_code,
      COALESCE(NULLIF(TO_JSONB(p)->>'product_name', ''), NULLIF(TO_JSONB(p)->>'name', '')) AS product_name,
      COALESCE(
        NULLIF(TO_JSONB(p)->>'product_variant', ''),
        NULLIF(TO_JSONB(p)->>'category', ''),
        NULLIF(TO_JSONB(p)->>'flavor', '')
      ) AS product_variant,
      COALESCE(
        NULLIF(TO_JSONB(p)->>'product_size', ''),
        NULLIF(TO_JSONB(p)->>'size_label', ''),
        NULLIF(TO_JSONB(p)->>'size', ''),
        CASE
          WHEN NULLIF(TO_JSONB(p)->>'weight_grams', '') IS NOT NULL
            THEN (TO_JSONB(p)->>'weight_grams') || ' gr'
          WHEN NULLIF(TO_JSONB(p)->>'grams', '') IS NOT NULL
            THEN (TO_JSONB(p)->>'grams') || ' gr'
        END
      ) AS product_size,
      p.unit_cost::NUMERIC AS unit_cost,
      public.normalize_b2b_product_identity_text(
        COALESCE(NULLIF(TO_JSONB(p)->>'product_name', ''), NULLIF(TO_JSONB(p)->>'name', ''))
      ) AS normalized_name,
      public.normalize_b2b_product_identity_text(
        COALESCE(
          NULLIF(TO_JSONB(p)->>'product_variant', ''),
          NULLIF(TO_JSONB(p)->>'category', ''),
          NULLIF(TO_JSONB(p)->>'flavor', '')
        )
      ) AS normalized_variant,
      public.normalize_b2b_product_identity_text(
        COALESCE(
          NULLIF(TO_JSONB(p)->>'product_size', ''),
          NULLIF(TO_JSONB(p)->>'size_label', ''),
          NULLIF(TO_JSONB(p)->>'size', ''),
          CASE
            WHEN NULLIF(TO_JSONB(p)->>'weight_grams', '') IS NOT NULL
              THEN (TO_JSONB(p)->>'weight_grams') || ' gr'
            WHEN NULLIF(TO_JSONB(p)->>'grams', '') IS NOT NULL
              THEN (TO_JSONB(p)->>'grams') || ' gr'
          END
        )
      ) AS normalized_size,
      public.normalize_b2b_product_identity_text(TO_JSONB(p)->>'sku_code') AS normalized_sku
    FROM public.products AS p
  ),
  item_facts AS (
    SELECT
      'comodato'::TEXT AS source_type,
      cpm.id::TEXT AS source_id,
      cpmi.id::TEXT AS source_item_id,
      cpm.partner_id,
      COALESCE(NULLIF(cp.business_name, ''), NULLIF(cp.responsible_name, ''), cpm.partner_id::TEXT) AS partner_name,
      cpm.movement_type::TEXT AS operation_type,
      cpm.status::TEXT AS operation_status,
      cpm.movement_date::DATE AS business_date,
      cpm.created_at,
      NULLIF(TO_JSONB(cpmi)->>'product_id', '') AS historical_product_id,
      NULLIF(TO_JSONB(cpmi)->>'product_code', '') AS product_code,
      cpmi.product_name,
      cpmi.product_variant,
      cpmi.product_size,
      public.normalize_b2b_product_identity_text(cpmi.product_name) AS normalized_name,
      public.normalize_b2b_product_identity_text(cpmi.product_variant) AS normalized_variant,
      public.normalize_b2b_product_identity_text(cpmi.product_size) AS normalized_size,
      public.normalize_b2b_product_identity_text(TO_JSONB(cpmi)->>'product_code') AS normalized_sku,
      COALESCE(cpmi.quantity_delivered, 0)::NUMERIC AS quantity_delivered,
      COALESCE(cpmi.quantity_sold, 0)::NUMERIC AS quantity_sold,
      COALESCE(cpmi.quantity_withdrawn, 0)::NUMERIC AS quantity_withdrawn,
      COALESCE(cpmi.quantity_spoiled, 0)::NUMERIC AS quantity_spoiled,
      COALESCE(NULLIF(TO_JSONB(cpmi)->>'quantity_adjusted', '')::NUMERIC, 0) AS quantity_adjusted,
      COALESCE(cpmi.price_to_catcorn, 0)::NUMERIC AS unit_price,
      COALESCE(cpmi.amount_due, 0)::NUMERIC AS recorded_amount,
      cpmi.spoilage_absorbed_by::TEXT,
      cpmi.notes
    FROM public.commercial_partner_movements AS cpm
    JOIN public.commercial_partner_movement_items AS cpmi
      ON cpmi.movement_id = cpm.id
    LEFT JOIN public.commercial_partners AS cp
      ON cp.id = cpm.partner_id

    UNION ALL

    SELECT
      'mayoreo'::TEXT,
      wo.id::TEXT,
      woi.id::TEXT,
      wo.partner_id,
      COALESCE(NULLIF(cp.business_name, ''), NULLIF(cp.responsible_name, ''), wo.partner_id::TEXT),
      'wholesale_order'::TEXT,
      wo.order_status::TEXT,
      wo.delivery_date::DATE,
      wo.created_at,
      NULLIF(TO_JSONB(woi)->>'product_id', ''),
      NULLIF(woi.product_code, ''),
      woi.product_name,
      woi.product_variant,
      woi.product_size,
      public.normalize_b2b_product_identity_text(woi.product_name),
      public.normalize_b2b_product_identity_text(woi.product_variant),
      public.normalize_b2b_product_identity_text(woi.product_size),
      public.normalize_b2b_product_identity_text(woi.product_code),
      0::NUMERIC,
      COALESCE(woi.quantity, 0)::NUMERIC,
      0::NUMERIC,
      0::NUMERIC,
      0::NUMERIC,
      COALESCE(woi.unit_price, 0)::NUMERIC,
      COALESCE(
        NULLIF(TO_JSONB(woi)->>'subtotal', '')::NUMERIC,
        COALESCE(woi.quantity, 0)::NUMERIC * COALESCE(woi.unit_price, 0)::NUMERIC
      ),
      NULL::TEXT,
      woi.notes
    FROM public.wholesale_orders AS wo
    JOIN public.wholesale_order_items AS woi
      ON woi.wholesale_order_id = wo.id
    LEFT JOIN public.commercial_partners AS cp
      ON cp.id = wo.partner_id
  ),
  explicit_product_mappings AS (
    SELECT
      f.source_type,
      f.source_item_id,
      mapping.product_id
    FROM item_facts AS f
    JOIN public.b2b_product_mappings AS mapping
      ON mapping.source_catalog = f.source_type
     AND mapping.active
     AND COALESCE(f.business_date, f.created_at::DATE, CURRENT_DATE) >= mapping.valid_from
     AND (
       mapping.valid_to IS NULL
       OR COALESCE(f.business_date, f.created_at::DATE, CURRENT_DATE) < mapping.valid_to
     )
     AND (
       (
         f.product_code IS NOT NULL
         AND f.normalized_sku <> ''
         AND f.normalized_sku =
           public.normalize_b2b_product_identity_text(mapping.source_product_code)
       )
       OR (
         f.normalized_name =
           public.normalize_b2b_product_identity_text(mapping.source_product_name)
         AND f.normalized_variant =
           public.normalize_b2b_product_identity_text(mapping.source_variant)
         AND f.normalized_size =
           public.normalize_b2b_product_identity_text(mapping.source_size)
       )
     )
  ),
  product_candidates AS (
    SELECT
      f.source_type,
      f.source_item_id,
      pc.id AS catalog_product_id,
      pc.unit_cost,
      CASE
        WHEN f.historical_product_id IS NOT NULL
         AND f.historical_product_id = pc.id::TEXT THEN 1
        WHEN explicit.product_id = pc.id THEN 2
        WHEN f.product_code IS NOT NULL
         AND f.normalized_sku <> ''
         AND f.normalized_sku = pc.normalized_sku THEN 3
      END AS match_priority
    FROM item_facts AS f
    LEFT JOIN explicit_product_mappings AS explicit
      ON explicit.source_type = f.source_type
     AND explicit.source_item_id = f.source_item_id
    JOIN product_catalog AS pc
      ON (
        f.historical_product_id IS NOT NULL
        AND f.historical_product_id = pc.id::TEXT
      ) OR (
        explicit.product_id = pc.id
      ) OR (
        f.product_code IS NOT NULL
        AND f.normalized_sku <> ''
        AND f.normalized_sku = pc.normalized_sku
      )
  ),
  candidate_priorities AS (
    SELECT
      source_type,
      source_item_id,
      MIN(match_priority) AS best_priority
    FROM product_candidates
    GROUP BY source_type, source_item_id
  ),
  candidate_results AS (
    SELECT
      pc.source_type,
      pc.source_item_id,
      COUNT(*) AS candidate_count,
      (ARRAY_AGG(pc.catalog_product_id ORDER BY pc.catalog_product_id::TEXT))[1] AS catalog_product_id,
      MIN(pc.unit_cost) AS unit_cost,
      MIN(pc.match_priority) AS match_priority
    FROM product_candidates AS pc
    JOIN candidate_priorities AS priority
      ON priority.source_type = pc.source_type
     AND priority.source_item_id = pc.source_item_id
     AND priority.best_priority = pc.match_priority
    GROUP BY pc.source_type, pc.source_item_id
  ),
  mapped_facts AS (
    SELECT
      f.*,
      CASE WHEN cr.candidate_count = 1 THEN cr.catalog_product_id END AS catalog_product_id,
      CASE WHEN cr.candidate_count = 1 THEN cr.unit_cost END AS current_unit_cost,
      COALESCE(cr.candidate_count, 0)::INTEGER AS candidate_count,
      CASE
        WHEN cr.candidate_count > 1 THEN 'ambiguous'
        WHEN cr.candidate_count IS NULL THEN 'unmapped'
        WHEN cr.unit_cost IS NULL THEN 'missing_unit_cost'
        ELSE 'mapped'
      END AS cost_mapping_status,
      CASE
        WHEN cr.candidate_count = 1 THEN 'product:' || cr.catalog_product_id::TEXT
        ELSE 'snapshot:' || f.normalized_name || '|' || f.normalized_variant || '|' || f.normalized_size
      END AS product_key
    FROM item_facts AS f
    LEFT JOIN candidate_results AS cr
      ON cr.source_type = f.source_type
     AND cr.source_item_id = f.source_item_id
  ),
  period_sales AS (
    SELECT
      mf.*,
      mf.quantity_sold AS units,
      CASE
        WHEN mf.source_type = 'comodato' AND mf.recorded_amount = 0
          THEN mf.quantity_sold * mf.unit_price
        ELSE mf.recorded_amount
      END AS amount
    FROM mapped_facts AS mf
    CROSS JOIN params AS period
    WHERE mf.quantity_sold > 0
      AND mf.business_date >= period.start_date
      AND mf.business_date < period.end_date_exclusive
      AND (
        (
          mf.source_type = 'comodato'
          AND mf.operation_status = 'completed'
          AND public.normalize_b2b_product_identity_text(mf.operation_type)
            IN ('settlement', 'liquidacion', 'liquidation')
        )
        OR (
          mf.source_type = 'mayoreo'
          AND mf.operation_status = 'delivered'
        )
      )
  ),
  period_resolutions AS (
    SELECT mf.*
    FROM mapped_facts AS mf
    CROSS JOIN params AS period
    WHERE mf.source_type = 'comodato'
      AND mf.operation_status = 'completed'
      AND mf.business_date >= period.start_date
      AND mf.business_date < period.end_date_exclusive
      AND (mf.quantity_sold + mf.quantity_withdrawn + mf.quantity_spoiled) > 0
  ),
  period_spoilage AS (
    SELECT
      pr.*,
      CASE
        WHEN pr.cost_mapping_status = 'mapped'
          THEN pr.quantity_spoiled * pr.current_unit_cost
      END AS estimated_waste_cost
    FROM period_resolutions AS pr
    WHERE pr.quantity_spoiled > 0
  ),
  inventory_deliveries AS (
    SELECT
      mf.partner_id,
      mf.partner_name,
      mf.product_key,
      mf.product_name,
      mf.product_variant,
      mf.product_size,
      mf.source_item_id AS delivery_item_id,
      mf.business_date AS delivery_date,
      mf.created_at,
      mf.quantity_delivered AS quantity,
      mf.current_unit_cost,
      mf.cost_mapping_status,
      COALESCE(
        SUM(mf.quantity_delivered) OVER (
          PARTITION BY mf.partner_id, mf.product_key
          ORDER BY mf.business_date, mf.created_at, mf.source_item_id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ),
        0
      ) AS range_start,
      SUM(mf.quantity_delivered) OVER (
        PARTITION BY mf.partner_id, mf.product_key
        ORDER BY mf.business_date, mf.created_at, mf.source_item_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS range_end
    FROM mapped_facts AS mf
    CROSS JOIN params AS period
    WHERE mf.source_type = 'comodato'
      AND mf.operation_status = 'completed'
      AND mf.business_date <= period.as_of_date
      AND mf.quantity_delivered > 0
  ),
  inventory_resolution_events AS (
    SELECT
      mf.partner_id,
      mf.partner_name,
      mf.product_key,
      mf.source_item_id AS resolution_item_id,
      mf.business_date AS resolution_date,
      mf.created_at,
      resolved.resolution_type,
      resolved.type_order,
      resolved.quantity
    FROM mapped_facts AS mf
    CROSS JOIN params AS period
    CROSS JOIN LATERAL (
      VALUES
        ('sold'::TEXT, 1, mf.quantity_sold),
        ('withdrawn'::TEXT, 2, mf.quantity_withdrawn),
        ('spoiled'::TEXT, 3, mf.quantity_spoiled)
    ) AS resolved(resolution_type, type_order, quantity)
    WHERE mf.source_type = 'comodato'
      AND mf.operation_status = 'completed'
      AND mf.business_date <= period.as_of_date
      AND resolved.quantity > 0
  ),
  inventory_resolutions AS (
    SELECT
      event.*,
      COALESCE(
        SUM(event.quantity) OVER (
          PARTITION BY event.partner_id, event.product_key
          ORDER BY event.resolution_date, event.created_at, event.resolution_item_id, event.type_order
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ),
        0
      ) AS range_start,
      SUM(event.quantity) OVER (
        PARTITION BY event.partner_id, event.product_key
        ORDER BY event.resolution_date, event.created_at, event.resolution_item_id, event.type_order
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS range_end
    FROM inventory_resolution_events AS event
  ),
  fifo_allocations AS (
    SELECT
      resolution.partner_id,
      resolution.partner_name,
      resolution.product_key,
      delivery.product_name,
      delivery.product_variant,
      delivery.product_size,
      delivery.delivery_item_id,
      delivery.delivery_date,
      resolution.resolution_item_id,
      resolution.resolution_date,
      resolution.resolution_type,
      GREATEST(
        0,
        LEAST(delivery.range_end, resolution.range_end)
          - GREATEST(delivery.range_start, resolution.range_start)
      ) AS allocated_units
    FROM inventory_deliveries AS delivery
    JOIN inventory_resolutions AS resolution
      ON resolution.partner_id = delivery.partner_id
     AND resolution.product_key = delivery.product_key
     AND delivery.range_start < resolution.range_end
     AND resolution.range_start < delivery.range_end
     AND (
       delivery.delivery_date,
       COALESCE(delivery.created_at, '-infinity'),
       delivery.delivery_item_id
     ) <= (
       resolution.resolution_date,
       COALESCE(resolution.created_at, '-infinity'),
       resolution.resolution_item_id
     )
  ),
  inventory_events AS (
    SELECT
      mf.partner_id,
      mf.partner_name,
      mf.product_key,
      mf.business_date,
      mf.created_at,
      mf.source_item_id,
      0 AS event_order,
      mf.quantity_delivered AS delta
    FROM mapped_facts AS mf
    WHERE mf.source_type = 'comodato'
      AND mf.operation_status = 'completed'
      AND mf.quantity_delivered > 0

    UNION ALL

    SELECT
      mf.partner_id,
      mf.partner_name,
      mf.product_key,
      mf.business_date,
      mf.created_at,
      mf.source_item_id,
      1,
      -(mf.quantity_sold + mf.quantity_withdrawn + mf.quantity_spoiled)
    FROM mapped_facts AS mf
    WHERE mf.source_type = 'comodato'
      AND mf.operation_status = 'completed'
      AND (mf.quantity_sold + mf.quantity_withdrawn + mf.quantity_spoiled) > 0
  ),
  running_inventory AS (
    SELECT
      event.*,
      SUM(event.delta) OVER (
        PARTITION BY event.partner_id, event.product_key
        ORDER BY event.business_date, event.created_at, event.event_order, event.source_item_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_balance
    FROM inventory_events AS event
  ),
  fifo_groups AS (
    SELECT
      partner_id,
      MAX(partner_name) AS partner_name,
      product_key,
      MIN(running_balance) AS minimum_running_balance,
      SUM(delta) AS final_balance
    FROM running_inventory
    GROUP BY partner_id, product_key
  ),
  period_sale_allocations AS (
    SELECT
      allocation.*,
      GREATEST(allocation.resolution_date - allocation.delivery_date, 0) AS elapsed_days
    FROM fifo_allocations AS allocation
    CROSS JOIN params AS period
    WHERE allocation.resolution_type = 'sold'
      AND allocation.allocated_units > 0
      AND allocation.resolution_date >= period.start_date
      AND allocation.resolution_date < period.end_date_exclusive
  ),
  product_allocation_running AS (
    SELECT
      allocation.*,
      SUM(allocation.allocated_units) OVER (
        PARTITION BY allocation.product_key
        ORDER BY allocation.elapsed_days, allocation.resolution_date, allocation.resolution_item_id
      ) AS cumulative_units,
      SUM(allocation.allocated_units) OVER (
        PARTITION BY allocation.product_key
      ) AS total_units
    FROM period_sale_allocations AS allocation
  ),
  product_liquidation_times AS (
    SELECT
      allocation.product_key,
      MAX(allocation.product_name) AS product_name,
      MAX(allocation.product_variant) AS product_variant,
      MAX(allocation.product_size) AS product_size,
      SUM(allocation.allocated_units) AS sold_units_with_fifo,
      ROUND(
        SUM(allocation.elapsed_days * allocation.allocated_units)
          / NULLIF(SUM(allocation.allocated_units), 0),
        2
      ) AS weighted_average_days,
      MIN(allocation.elapsed_days) FILTER (
        WHERE allocation.cumulative_units >= allocation.total_units / 2.0
      ) AS weighted_median_days
    FROM product_allocation_running AS allocation
    GROUP BY allocation.product_key
  ),
  overall_allocation_running AS (
    SELECT
      allocation.*,
      SUM(allocation.allocated_units) OVER (
        ORDER BY allocation.elapsed_days, allocation.resolution_date, allocation.resolution_item_id
      ) AS cumulative_units,
      SUM(allocation.allocated_units) OVER () AS total_units
    FROM period_sale_allocations AS allocation
  ),
  overall_liquidation_time AS (
    SELECT
      ROUND(
        SUM(elapsed_days * allocated_units) / NULLIF(SUM(allocated_units), 0),
        2
      ) AS weighted_average_days,
      MIN(elapsed_days) FILTER (
        WHERE cumulative_units >= total_units / 2.0
      ) AS weighted_median_days
    FROM overall_allocation_running
  ),
  delivery_consumption AS (
    SELECT
      delivery_item_id,
      COALESCE(SUM(allocated_units), 0) AS consumed_units
    FROM fifo_allocations
    GROUP BY delivery_item_id
  ),
  open_delivery_lots AS (
    SELECT
      delivery.*,
      GREATEST(delivery.quantity - COALESCE(consumption.consumed_units, 0), 0) AS open_units
    FROM inventory_deliveries AS delivery
    LEFT JOIN delivery_consumption AS consumption
      ON consumption.delivery_item_id = delivery.delivery_item_id
    WHERE GREATEST(delivery.quantity - COALESCE(consumption.consumed_units, 0), 0) > 0
  ),
  slow_inventory_rows AS (
    SELECT
      lot.partner_id,
      MAX(lot.partner_name) AS partner_name,
      lot.product_key,
      MAX(lot.product_name) AS product_name,
      MAX(lot.product_variant) AS product_variant,
      MAX(lot.product_size) AS product_size,
      SUM(lot.open_units) AS units_in_possession,
      MIN(lot.delivery_date) AS oldest_delivery_date,
      GREATEST(period.as_of_date - MIN(lot.delivery_date), 0) AS age_days,
      CASE
        WHEN GREATEST(period.as_of_date - MIN(lot.delivery_date), 0) <= 15 THEN '0-15'
        WHEN GREATEST(period.as_of_date - MIN(lot.delivery_date), 0) <= 30 THEN '16-30'
        WHEN GREATEST(period.as_of_date - MIN(lot.delivery_date), 0) <= 45 THEN '31-45'
        ELSE '46+'
      END AS age_bucket,
      CASE WHEN BOOL_AND(lot.cost_mapping_status = 'mapped') THEN MAX(lot.current_unit_cost) END AS current_unit_cost,
      CASE
        WHEN BOOL_AND(lot.cost_mapping_status = 'mapped')
          THEN SUM(lot.open_units * lot.current_unit_cost)
      END AS estimated_inventory_cost,
      CASE
        WHEN BOOL_AND(lot.cost_mapping_status = 'mapped') THEN 'mapped'
        WHEN BOOL_OR(lot.cost_mapping_status = 'ambiguous') THEN 'ambiguous'
        WHEN BOOL_OR(lot.cost_mapping_status = 'missing_unit_cost') THEN 'missing_unit_cost'
        ELSE 'unmapped'
      END AS cost_mapping_status
    FROM open_delivery_lots AS lot
    CROSS JOIN params AS period
    GROUP BY lot.partner_id, lot.product_key, period.as_of_date
  ),
  sales_by_product AS (
    SELECT
      product_key,
      MAX(product_name) AS product_name,
      MAX(product_variant) AS product_variant,
      MAX(product_size) AS product_size,
      SUM(units) AS units_sold,
      SUM(amount) AS generated_revenue,
      COUNT(DISTINCT partner_id) AS distinct_partners,
      COALESCE(SUM(units) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_units,
      COALESCE(SUM(amount) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_revenue,
      COALESCE(SUM(units) FILTER (WHERE source_type = 'mayoreo'), 0) AS wholesale_units,
      COALESCE(SUM(amount) FILTER (WHERE source_type = 'mayoreo'), 0) AS wholesale_revenue
    FROM period_sales
    GROUP BY product_key
  ),
  spoilage_by_product AS (
    SELECT
      product_key,
      MAX(product_name) AS product_name,
      MAX(product_variant) AS product_variant,
      MAX(product_size) AS product_size,
      SUM(quantity_spoiled) AS spoiled_units,
      CASE
        WHEN BOOL_AND(estimated_waste_cost IS NOT NULL)
          THEN SUM(estimated_waste_cost)
      END AS estimated_waste_cost,
      CASE
        WHEN BOOL_AND(cost_mapping_status = 'mapped') THEN 'mapped'
        WHEN BOOL_OR(cost_mapping_status = 'ambiguous') THEN 'ambiguous'
        WHEN BOOL_OR(cost_mapping_status = 'missing_unit_cost') THEN 'missing_unit_cost'
        ELSE 'unmapped'
      END AS cost_mapping_status
    FROM period_spoilage
    GROUP BY product_key
  ),
  all_product_keys AS (
    SELECT product_key FROM sales_by_product
    UNION
    SELECT product_key FROM spoilage_by_product
  ),
  product_rows AS (
    SELECT
      key.product_key,
      COALESCE(sales.product_name, spoilage.product_name) AS product_name,
      COALESCE(sales.product_variant, spoilage.product_variant) AS product_variant,
      COALESCE(sales.product_size, spoilage.product_size) AS product_size,
      COALESCE(sales.units_sold, 0) AS units_sold,
      COALESCE(sales.generated_revenue, 0) AS generated_revenue,
      COALESCE(sales.distinct_partners, 0) AS distinct_partners,
      COALESCE(sales.comodato_units, 0) AS comodato_units,
      COALESCE(sales.comodato_revenue, 0) AS comodato_revenue,
      COALESCE(sales.wholesale_units, 0) AS wholesale_units,
      COALESCE(sales.wholesale_revenue, 0) AS wholesale_revenue,
      times.weighted_average_days AS weighted_average_liquidation_days,
      times.weighted_median_days AS weighted_median_liquidation_days,
      COALESCE(spoilage.spoiled_units, 0) AS spoiled_units,
      spoilage.estimated_waste_cost,
      COALESCE(spoilage.cost_mapping_status, 'not_applicable') AS cost_mapping_status
    FROM all_product_keys AS key
    LEFT JOIN sales_by_product AS sales USING (product_key)
    LEFT JOIN spoilage_by_product AS spoilage USING (product_key)
    LEFT JOIN product_liquidation_times AS times USING (product_key)
  ),
  spoilage_partner_rows AS (
    SELECT
      resolution.partner_id,
      MAX(resolution.partner_name) AS partner_name,
      SUM(resolution.quantity_spoiled) AS spoiled_units,
      CASE
        WHEN BOOL_AND(
          resolution.quantity_spoiled = 0
          OR (resolution.cost_mapping_status = 'mapped' AND resolution.current_unit_cost IS NOT NULL)
        ) THEN SUM(resolution.quantity_spoiled * resolution.current_unit_cost)
      END AS estimated_waste_cost,
      SUM(resolution.quantity_sold) AS sold_units,
      SUM(resolution.quantity_withdrawn) AS withdrawn_units,
      SUM(
        resolution.quantity_sold
        + resolution.quantity_withdrawn
        + resolution.quantity_spoiled
      ) AS resolved_units,
      ROUND(
        SUM(resolution.quantity_spoiled)
          / NULLIF(SUM(
            resolution.quantity_sold
            + resolution.quantity_withdrawn
            + resolution.quantity_spoiled
          ), 0),
        6
      ) AS spoilage_rate,
      CASE
        WHEN COUNT(DISTINCT resolution.spoilage_absorbed_by) FILTER (
          WHERE resolution.quantity_spoiled > 0 AND resolution.spoilage_absorbed_by IS NOT NULL
        ) = 1 THEN MAX(resolution.spoilage_absorbed_by) FILTER (WHERE resolution.quantity_spoiled > 0)
        WHEN COUNT(DISTINCT resolution.spoilage_absorbed_by) FILTER (
          WHERE resolution.quantity_spoiled > 0 AND resolution.spoilage_absorbed_by IS NOT NULL
        ) > 1 THEN 'mixed'
        ELSE 'not_recorded'
      END AS cost_responsibility,
      COUNT(*) FILTER (
        WHERE resolution.quantity_spoiled > 0
          AND (resolution.cost_mapping_status <> 'mapped' OR resolution.current_unit_cost IS NULL)
      ) AS unavailable_cost_rows
    FROM period_resolutions AS resolution
    GROUP BY resolution.partner_id
    HAVING SUM(resolution.quantity_spoiled) > 0
  ),
  top_product AS (
    SELECT
      product_name,
      product_variant,
      product_size,
      units_sold,
      generated_revenue
    FROM product_rows
    ORDER BY units_sold DESC, generated_revenue DESC, product_name
    LIMIT 1
  ),
  top_spoilage_partner AS (
    SELECT
      partner_id,
      partner_name,
      spoiled_units,
      resolved_units,
      spoilage_rate,
      estimated_waste_cost,
      cost_responsibility
    FROM spoilage_partner_rows
    ORDER BY spoiled_units DESC, resolved_units DESC, partner_name
    LIMIT 1
  ),
  relevant_period_facts AS (
    SELECT mf.*
    FROM mapped_facts AS mf
    CROSS JOIN params AS period
    WHERE mf.business_date >= period.start_date
      AND mf.business_date < period.end_date_exclusive
      AND (
        (mf.source_type = 'comodato' AND mf.operation_status = 'completed')
        OR (mf.source_type = 'mayoreo' AND mf.operation_status = 'delivered')
      )
      AND (
        mf.quantity_sold > 0
        OR mf.quantity_spoiled > 0
        OR mf.quantity_withdrawn > 0
        OR mf.quantity_delivered > 0
      )
  ),
  quality_fact_candidates AS (
    SELECT *
    FROM relevant_period_facts

    UNION ALL

    SELECT mf.*
    FROM mapped_facts AS mf
    JOIN open_delivery_lots AS lot
      ON lot.delivery_item_id = mf.source_item_id
     AND lot.partner_id = mf.partner_id
     AND lot.product_key = mf.product_key
    WHERE mf.source_type = 'comodato'
  ),
  quality_facts AS (
    SELECT DISTINCT ON (source_type, source_item_id) *
    FROM quality_fact_candidates
    ORDER BY source_type, source_item_id, business_date, created_at
  ),
  amount_errors AS (
    SELECT
      source_type,
      source_id,
      source_item_id,
      partner_id,
      partner_name,
      product_name,
      product_variant,
      product_size,
      quantity_sold * unit_price AS expected_amount,
      recorded_amount AS actual_amount,
      recorded_amount - (quantity_sold * unit_price) AS difference
    FROM relevant_period_facts
    WHERE quantity_sold > 0
      AND ABS(recorded_amount - (quantity_sold * unit_price)) > 0.01
  ),
  orders_without_items AS (
    SELECT
      wo.id AS source_id,
      wo.partner_id,
      COALESCE(NULLIF(cp.business_name, ''), NULLIF(cp.responsible_name, ''), wo.partner_id::TEXT) AS partner_name,
      wo.delivery_date,
      wo.order_status
    FROM public.wholesale_orders AS wo
    LEFT JOIN public.wholesale_order_items AS woi
      ON woi.wholesale_order_id = wo.id
    LEFT JOIN public.commercial_partners AS cp
      ON cp.id = wo.partner_id
    CROSS JOIN params AS period
    WHERE wo.order_status = 'delivered'
      AND wo.delivery_date::DATE >= period.start_date
      AND wo.delivery_date::DATE < period.end_date_exclusive
    GROUP BY wo.id, wo.partner_id, cp.business_name, cp.responsible_name, wo.delivery_date, wo.order_status
    HAVING COUNT(woi.id) = 0
  ),
  summary_values AS (
    SELECT
      COALESCE(SUM(units), 0) AS units_sold,
      COALESCE(SUM(amount), 0) AS generated_revenue,
      COUNT(DISTINCT partner_id) AS distinct_partners,
      COALESCE(SUM(units) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_units,
      COALESCE(SUM(amount) FILTER (WHERE source_type = 'comodato'), 0) AS comodato_revenue,
      COALESCE(SUM(units) FILTER (WHERE source_type = 'mayoreo'), 0) AS wholesale_units,
      COALESCE(SUM(amount) FILTER (WHERE source_type = 'mayoreo'), 0) AS wholesale_revenue
    FROM period_sales
  ),
  spoilage_summary AS (
    SELECT
      COALESCE(SUM(quantity_spoiled), 0) AS spoilage_units,
      CASE
        WHEN COUNT(*) = 0 THEN 0::NUMERIC
        WHEN BOOL_AND(estimated_waste_cost IS NOT NULL) THEN SUM(estimated_waste_cost)
      END AS estimated_waste_cost
    FROM period_spoilage
  )
  SELECT JSONB_BUILD_OBJECT(
    'period', JSONB_BUILD_OBJECT(
      'start_at', p_start_date,
      'end_at_exclusive', p_end_date_exclusive,
      'timezone', 'America/Mexico_City'
    ),
    'summary', JSONB_BUILD_OBJECT(
      'units_sold', summary.units_sold,
      'generated_revenue', summary.generated_revenue,
      'distinct_partners', summary.distinct_partners,
      'comodato_units', summary.comodato_units,
      'comodato_revenue', summary.comodato_revenue,
      'wholesale_units', summary.wholesale_units,
      'wholesale_revenue', summary.wholesale_revenue,
      'spoilage_units', spoilage.spoilage_units,
      'estimated_waste_cost', spoilage.estimated_waste_cost,
      'open_inventory_units', COALESCE((SELECT SUM(units_in_possession) FROM slow_inventory_rows), 0),
      'weighted_average_liquidation_days', liquidation.weighted_average_days,
      'weighted_median_liquidation_days', liquidation.weighted_median_days,
      'top_product', (SELECT TO_JSONB(x) FROM top_product AS x),
      'top_spoilage_partner', (SELECT TO_JSONB(x) FROM top_spoilage_partner AS x)
    ),
    'products', COALESCE(
      (SELECT JSONB_AGG(TO_JSONB(x) ORDER BY units_sold DESC, generated_revenue DESC) FROM product_rows AS x),
      '[]'::JSONB
    ),
    'spoilage_by_partner', COALESCE(
      (SELECT JSONB_AGG(TO_JSONB(x) ORDER BY spoiled_units DESC, partner_name) FROM spoilage_partner_rows AS x),
      '[]'::JSONB
    ),
    'liquidation_time_by_product', COALESCE(
      (SELECT JSONB_AGG(TO_JSONB(x) ORDER BY sold_units_with_fifo DESC) FROM product_liquidation_times AS x),
      '[]'::JSONB
    ),
    'slow_inventory', COALESCE(
      (SELECT JSONB_AGG(TO_JSONB(x) ORDER BY age_days DESC, partner_name, product_name) FROM slow_inventory_rows AS x),
      '[]'::JSONB
    ),
    'data_quality', JSONB_BUILD_OBJECT(
      'unmapped_products', JSONB_BUILD_OBJECT(
        'count', (SELECT COUNT(*) FROM quality_facts WHERE cost_mapping_status = 'unmapped'),
        'rows', COALESCE((
          SELECT JSONB_AGG(TO_JSONB(x)) FROM (
            SELECT source_type, source_id, source_item_id, partner_id, partner_name,
              product_name, product_variant, product_size, product_code, historical_product_id AS product_id
            FROM quality_facts WHERE cost_mapping_status = 'unmapped'
          ) AS x
        ), '[]'::JSONB)
      ),
      'ambiguous_products', JSONB_BUILD_OBJECT(
        'count', (SELECT COUNT(*) FROM quality_facts WHERE cost_mapping_status = 'ambiguous'),
        'rows', COALESCE((
          SELECT JSONB_AGG(TO_JSONB(x)) FROM (
            SELECT source_type, source_id, source_item_id, partner_id, partner_name,
              product_name, product_variant, product_size, product_code,
              historical_product_id AS product_id, candidate_count
            FROM quality_facts WHERE cost_mapping_status = 'ambiguous'
          ) AS x
        ), '[]'::JSONB)
      ),
      'rows_without_product_id', JSONB_BUILD_OBJECT(
        'count', (SELECT COUNT(*) FROM quality_facts WHERE historical_product_id IS NULL),
        'rows', COALESCE((
          SELECT JSONB_AGG(TO_JSONB(x)) FROM (
            SELECT source_type, source_id, source_item_id, partner_id, partner_name,
              product_name, product_variant, product_size, product_code
            FROM quality_facts WHERE historical_product_id IS NULL
          ) AS x
        ), '[]'::JSONB)
      ),
      'rows_without_product_code', JSONB_BUILD_OBJECT(
        'count', (SELECT COUNT(*) FROM quality_facts WHERE product_code IS NULL),
        'rows', COALESCE((
          SELECT JSONB_AGG(TO_JSONB(x)) FROM (
            SELECT source_type, source_id, source_item_id, partner_id, partner_name,
              product_name, product_variant, product_size, historical_product_id AS product_id
            FROM quality_facts WHERE product_code IS NULL
          ) AS x
        ), '[]'::JSONB)
      ),
      'fifo_impossible_groups', JSONB_BUILD_OBJECT(
        'count', (SELECT COUNT(*) FROM fifo_groups WHERE minimum_running_balance < 0),
        'rows', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM fifo_groups AS x WHERE minimum_running_balance < 0), '[]'::JSONB)
      ),
      'negative_inventory_groups', JSONB_BUILD_OBJECT(
        'count', (SELECT COUNT(*) FROM fifo_groups WHERE final_balance < 0),
        'rows', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM fifo_groups AS x WHERE final_balance < 0), '[]'::JSONB)
      ),
      'amount_reconciliation_errors', JSONB_BUILD_OBJECT(
        'count', (SELECT COUNT(*) FROM amount_errors),
        'rows', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM amount_errors AS x), '[]'::JSONB)
      ),
      'orders_without_items', JSONB_BUILD_OBJECT(
        'count', (SELECT COUNT(*) FROM orders_without_items),
        'rows', COALESCE((SELECT JSONB_AGG(TO_JSONB(x)) FROM orders_without_items AS x), '[]'::JSONB)
      ),
      'rows_without_unit_cost', JSONB_BUILD_OBJECT(
        'count', (SELECT COUNT(*) FROM quality_facts WHERE cost_mapping_status = 'missing_unit_cost'),
        'rows', COALESCE((
          SELECT JSONB_AGG(TO_JSONB(x)) FROM (
            SELECT source_type, source_id, source_item_id, partner_id, partner_name,
              product_name, product_variant, product_size, product_code,
              historical_product_id AS product_id, catalog_product_id
            FROM quality_facts WHERE cost_mapping_status = 'missing_unit_cost'
          ) AS x
        ), '[]'::JSONB)
      )
    )
  )
  INTO v_result
  FROM summary_values AS summary
  CROSS JOIN spoilage_summary AS spoilage
  CROSS JOIN overall_liquidation_time AS liquidation;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_b2b_product_analytics(TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Returns one reconciled B2B product analytics JSON object for an exclusive-end period. Slow inventory is current, while sales/spoilage/liquidation metrics honor the period.';

GRANT EXECUTE ON FUNCTION public.get_b2b_product_analytics(TIMESTAMPTZ, TIMESTAMPTZ)
TO authenticated;

COMMIT;
