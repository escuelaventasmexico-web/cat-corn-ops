-- Historical cost and explicit B2B mapping for Caramelo Michi 90 g.
-- Apply only after 20260829_b2b_waste_costs_and_product_mapping.sql.

BEGIN;

DO $$
DECLARE
  v_product_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_product_count
  FROM public.products
  WHERE sku_code = 'CAMCH90';

  IF v_product_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one CAMCH90 product, found %', v_product_count;
  END IF;

  UPDATE public.products
  SET unit_cost = 5.8515,
      bag_sku = 'CEL-20x30',
      packaging_material_code = 'CEL-20x30'
  WHERE sku_code = 'CAMCH90';
END;
$$;

WITH camch_product AS (
  SELECT id
  FROM public.products
  WHERE sku_code = 'CAMCH90'
),
requested_mapping AS (
  SELECT
    source_catalog,
    'CARAMELO_MICHI_90'::TEXT AS source_product_code,
    'Caramelo Michi'::TEXT AS source_product_name,
    'Caramelo'::TEXT AS source_variant,
    '90 gr'::TEXT AS source_size,
    id AS product_id
  FROM camch_product
  CROSS JOIN (VALUES ('comodato'::TEXT), ('mayoreo'::TEXT)) AS catalog(source_catalog)
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
  source_catalog,
  source_product_code,
  source_product_name,
  source_variant,
  source_size,
  product_id,
  TRUE,
  DATE '-infinity',
  NULL
FROM requested_mapping
ON CONFLICT (source_catalog, source_product_code, valid_from)
DO UPDATE SET
  source_product_name = EXCLUDED.source_product_name,
  source_variant = EXCLUDED.source_variant,
  source_size = EXCLUDED.source_size,
  product_id = EXCLUDED.product_id,
  active = TRUE,
  valid_to = NULL;

UPDATE public.wholesale_price_catalog AS catalog
SET product_id = product.id
FROM public.products AS product
WHERE catalog.product_code = 'CARAMELO_MICHI_90'
  AND product.sku_code = 'CAMCH90';

DO $$
DECLARE
  v_mapping_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_mapping_count
  FROM public.b2b_product_mappings AS mapping
  JOIN public.products AS product ON product.id = mapping.product_id
  WHERE mapping.source_catalog IN ('comodato', 'mayoreo')
    AND mapping.source_product_code = 'CARAMELO_MICHI_90'
    AND mapping.source_product_name = 'Caramelo Michi'
    AND mapping.source_variant = 'Caramelo'
    AND mapping.source_size = '90 gr'
    AND mapping.active
    AND mapping.valid_to IS NULL
    AND product.sku_code = 'CAMCH90';

  IF v_mapping_count <> 2 THEN
    RAISE EXCEPTION
      'Expected two active CARAMELO_MICHI_90 mappings to CAMCH90, found %', v_mapping_count;
  END IF;
END;
$$;

COMMIT;
