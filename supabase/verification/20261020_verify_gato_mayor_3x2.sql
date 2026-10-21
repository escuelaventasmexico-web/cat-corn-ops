-- READ ONLY. Run only after the migration has been reviewed and applied.
WITH checks AS (
  SELECT 'rpc_exists' AS check_name,
         to_regprocedure('public.create_gato_mayor_3x2_pos_sale(uuid,uuid,uuid,text,uuid,numeric,text,numeric,numeric,numeric,uuid,jsonb,jsonb)') IS NOT NULL AS passed
  UNION ALL SELECT 'groups_table', to_regclass('public.pos_promotion_groups') IS NOT NULL
  UNION ALL SELECT 'checkout_table', to_regclass('public.pos_promotion_checkouts') IS NOT NULL
  UNION ALL SELECT 'sale_item_group_column', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sale_items' AND column_name = 'promotion_group_id'
  )
  UNION ALL SELECT 'three_catalog_skus', (
    SELECT count(*) = 3 FROM public.products
    WHERE upper(sku_code) IN ('SLGM180', 'SBGM180', 'CAGM180') AND active
  )
  UNION ALL SELECT 'two_fixed_rules', (
    SELECT count(*) = 2 FROM public.commission_rules
    WHERE scheme IN ('vendedora_pos', 'venta_pieza')
      AND product_key = 'gato_mayor_3x2' AND commission_type = 'fixed_bonus'
      AND commission_amount = 5 AND active AND valid_from = DATE '2026-10-20'
  )
  UNION ALL SELECT 'no_item_in_two_groups', NOT EXISTS (
    SELECT promotion_group_id FROM public.sale_items
    WHERE promotion_group_id IS NOT NULL GROUP BY id HAVING count(DISTINCT promotion_group_id) > 1
  )
  UNION ALL SELECT 'one_event_per_group', NOT EXISTS (
    SELECT promo_group.id
    FROM public.pos_promotion_groups AS promo_group
    LEFT JOIN public.commission_events AS event
      ON event.source_type = 'pos_sale' AND event.source_item_id = promo_group.id
    GROUP BY promo_group.id HAVING count(event.id) > 1
  )
  UNION ALL SELECT 'every_group_has_three_units', NOT EXISTS (
    SELECT promo_group.id
    FROM public.pos_promotion_groups AS promo_group
    LEFT JOIN public.sale_items AS item ON item.promotion_group_id = promo_group.id
    GROUP BY promo_group.id HAVING COALESCE(sum(item.quantity), 0) <> 3
  )
  UNION ALL SELECT 'promo_event_is_fixed_five', NOT EXISTS (
    SELECT 1 FROM public.commission_events AS event
    JOIN public.pos_promotion_groups AS promo_group ON promo_group.id = event.source_item_id
    WHERE event.source_type IS DISTINCT FROM 'pos_sale'
       OR event.product_key IS DISTINCT FROM 'gato_mayor_3x2'
       OR event.quantity IS DISTINCT FROM 1::NUMERIC
       OR event.unit_commission IS DISTINCT FROM 5::NUMERIC
       OR event.commission_amount IS DISTINCT FROM 5::NUMERIC
  )
  UNION ALL SELECT 'no_group_item_commissions', NOT EXISTS (
    SELECT 1 FROM public.sale_items AS item
    JOIN public.commission_events AS event
      ON event.source_type = 'pos_sale' AND event.source_item_id = item.id
    WHERE item.promotion_group_id IS NOT NULL
  )
  UNION ALL SELECT 'promo_cost_snapshots_complete', NOT EXISTS (
    SELECT 1 FROM public.sale_items
    WHERE promotion_group_id IS NOT NULL
      AND (observed_unit_cost IS NULL OR observed_total_cost IS NULL OR cost_source IS NULL)
  )
)
SELECT *, bool_and(passed) OVER () AS all_checks_passed FROM checks ORDER BY check_name;
