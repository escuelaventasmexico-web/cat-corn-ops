-- Read-only verifier for 20261001_official_product_combos.sql.

WITH expected_combo(sku_code, product_name, price, barcode_value, commission_sku) AS (
  VALUES
    ('COMBO-KIARA'::TEXT, 'Combo Kiara'::TEXT, 85.00::NUMERIC, '7500000000237'::TEXT, 'SLGM180'::TEXT),
    ('COMBO-BETO'::TEXT, 'Combo Beto'::TEXT, 105.00::NUMERIC, '7500000000244'::TEXT, 'SLJF240'::TEXT),
    ('COMBO-MARCELO'::TEXT, 'Combo Marcelo'::TEXT, 95.00::NUMERIC, '7500000000251'::TEXT, 'SBGM180'::TEXT),
    ('COMBO-RAMON'::TEXT, 'Combo Ramón'::TEXT, 115.00::NUMERIC, '7500000000268'::TEXT, 'SBJF240'::TEXT),
    ('COMBO-MAURICIA'::TEXT, 'Combo Mauricia'::TEXT, 125.00::NUMERIC, '7500000000275'::TEXT, 'CAGM180'::TEXT)
),
expected_beverage(sku_code, product_name, price, barcode_value) AS (
  VALUES
    ('AGUA-FRAMBUESA-NEGRA'::TEXT, 'Agua gaseosa Frambuesa Negra'::TEXT, 35.00::NUMERIC, '7500000000206'::TEXT),
    ('AGUA-MANGO-NARANJA'::TEXT, 'Agua gaseosa Mango Naranja'::TEXT, 35.00::NUMERIC, '7500000000213'::TEXT),
    ('AGUA-FRESA-KIWI'::TEXT, 'Agua gaseosa Fresa Kiwi'::TEXT, 35.00::NUMERIC, '7500000000220'::TEXT)
),
expected_fixed(combo_sku, component_sku) AS (
  VALUES
    ('COMBO-KIARA'::TEXT, 'SLGM180'::TEXT),
    ('COMBO-KIARA'::TEXT, 'GOMIX90'::TEXT),
    ('COMBO-BETO'::TEXT, 'SLJF240'::TEXT),
    ('COMBO-BETO'::TEXT, 'GOMIX90'::TEXT),
    ('COMBO-MARCELO'::TEXT, 'SBGM180'::TEXT),
    ('COMBO-MARCELO'::TEXT, 'GOMIX90'::TEXT),
    ('COMBO-RAMON'::TEXT, 'SBJF240'::TEXT),
    ('COMBO-RAMON'::TEXT, 'GOMIX90'::TEXT),
    ('COMBO-MAURICIA'::TEXT, 'CAGM180'::TEXT),
    ('COMBO-MAURICIA'::TEXT, 'GOMIX90'::TEXT)
),
target_product_rows AS (
  SELECT
    product.id,
    upper(product.sku_code) AS sku_code,
    coalesce(nullif(trim(product.product_name), ''), product.name) AS product_name,
    product.price,
    product.barcode_value,
    product.active,
    product.flavor
  FROM public.products AS product
  WHERE upper(coalesce(product.sku_code, '')) IN (
    SELECT sku_code FROM expected_combo
    UNION ALL
    SELECT sku_code FROM expected_beverage
  )
),
actual_fixed AS (
  SELECT
    upper(combo_product.sku_code) AS combo_sku,
    upper(component_product.sku_code) AS component_sku,
    component.quantity_per_combo
  FROM public.product_combo_components AS component
  JOIN public.products AS combo_product
    ON combo_product.id = component.combo_product_id
  JOIN public.products AS component_product
    ON component_product.id = component.component_product_id
  WHERE component.component_type = 'fixed'
    AND upper(combo_product.sku_code) IN (SELECT sku_code FROM expected_combo)
),
callable_proc AS MATERIALIZED (
  SELECT proc_row.*
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.prokind IN ('f', 'p')
),
function_defs AS (
  SELECT
    proc_row.proname,
    pg_get_function_identity_arguments(proc_row.oid) AS identity_arguments,
    lower(pg_get_functiondef(proc_row.oid)) AS definition,
    proc_row.prosecdef,
    proc_row.proconfig,
    has_function_privilege('anon', proc_row.oid, 'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated', proc_row.oid, 'EXECUTE') AS authenticated_execute
  FROM callable_proc AS proc_row
  WHERE proc_row.proname IN (
    'get_product_combo_catalog',
    'capture_sale_item_combo_components',
    'protect_sale_item_combo_components',
    'normalize_combo_catalog_identity',
    'is_valid_ean13',
    'sync_pos_commission_for_sale_item',
    'refund_sale',
    'sync_pos_commissions_for_refund',
    'create_pos_sale_with_combos'
  )
),
catalog_checks AS (
  SELECT
    'five_required_combo_products'::TEXT AS check_name,
    count(target.id) = 5
      AND count(DISTINCT target.sku_code) = 5
      AND bool_and(coalesce(
        target.product_name = expected.product_name
        AND target.price = expected.price
        AND target.barcode_value = expected.barcode_value
        AND coalesce(target.active, FALSE)
        AND upper(target.flavor) = 'COMBOS'
      , FALSE)) AS passed,
    'The five required SKUs exist exactly once with their approved identity and price; unrelated future combos are allowed.'::TEXT AS detail
  FROM expected_combo AS expected
  LEFT JOIN target_product_rows AS target ON target.sku_code = expected.sku_code

  UNION ALL

  SELECT
    'three_required_beverages',
    count(target.id) = 3
      AND count(DISTINCT target.sku_code) = 3
      AND bool_and(coalesce(
        target.product_name = expected.product_name
        AND target.price = expected.price
        AND target.barcode_value = expected.barcode_value
        AND coalesce(target.active, FALSE)
        AND upper(target.flavor) = 'BEBIDAS'
      , FALSE)),
    'The three Agua gaseosa products exist exactly once and remain individually sellable at $35.'
  FROM expected_beverage AS expected
  LEFT JOIN target_product_rows AS target ON target.sku_code = expected.sku_code

  UNION ALL

  SELECT
    'ean13_valid_and_collision_free',
    count(*) = 8
      AND bool_and(public.is_valid_ean13(target.barcode_value))
      AND count(DISTINCT target.barcode_value) = 8
      AND NOT EXISTS (
        SELECT 1
        FROM public.products AS product
        WHERE product.barcode_value IN (
          SELECT barcode_value FROM expected_combo
          UNION ALL
          SELECT barcode_value FROM expected_beverage
        )
        GROUP BY product.barcode_value
        HAVING count(*) <> 1
      ),
    'Every requested barcode is valid EAN-13 and identifies exactly one product.'
  FROM target_product_rows AS target
),
definition_checks AS (
  SELECT
    'combo_commission_references'::TEXT AS check_name,
    count(combo.product_id) = 5
      AND count(DISTINCT combo.product_id) = 5
      AND bool_and(coalesce(
        upper(combo_product.sku_code) = expected.sku_code
        AND upper(commission_product.sku_code) = expected.commission_sku
        AND coalesce(combo.active, FALSE)
      , FALSE)) AS passed,
    'Each combo points to exactly its popcorn product as the commission reference.'::TEXT AS detail
  FROM expected_combo AS expected
  LEFT JOIN public.products AS combo_product
    ON upper(combo_product.sku_code) = expected.sku_code
  LEFT JOIN public.product_combos AS combo
    ON combo.product_id = combo_product.id
  LEFT JOIN public.products AS commission_product
    ON commission_product.id = combo.commission_product_id

  UNION ALL

  SELECT
    'exact_fixed_components',
    count(*) = 10
      AND bool_and(actual.quantity_per_combo = 1)
      AND NOT EXISTS (
        SELECT expected.combo_sku, expected.component_sku FROM expected_fixed AS expected
        EXCEPT
        SELECT actual.combo_sku, actual.component_sku FROM actual_fixed AS actual
      )
      AND NOT EXISTS (
        SELECT actual.combo_sku, actual.component_sku FROM actual_fixed AS actual
        EXCEPT
        SELECT expected.combo_sku, expected.component_sku FROM expected_fixed AS expected
      ),
    'Every required combo has exactly one approved popcorn and one GOMIX90 fixed component.'
  FROM actual_fixed AS actual

  UNION ALL

  SELECT
    'one_required_beverage_choice_per_combo',
    count(*) = 5
      AND count(DISTINCT choice.combo_product_id) = 5
      AND bool_and(
        choice.quantity_per_combo = 1
        AND choice.min_selections = 1
        AND choice.max_selections = 1
        AND option_count.total_option_count = 3
        AND option_count.approved_option_count = 3
      ),
    'Every required combo has one mandatory beverage group with the three approved options.'
  FROM public.product_combo_components AS choice
  JOIN public.products AS combo_product ON combo_product.id = choice.combo_product_id
  CROSS JOIN LATERAL (
    SELECT
      count(*) AS total_option_count,
      count(*) FILTER (
        WHERE upper(option_product.sku_code) IN (SELECT sku_code FROM expected_beverage)
      ) AS approved_option_count
    FROM public.product_combo_component_options AS option_row
    JOIN public.products AS option_product ON option_product.id = option_row.product_id
    WHERE option_row.component_id = choice.id
      AND option_row.active
  ) AS option_count
  WHERE choice.component_type = 'choice'
    AND choice.option_group = 'beverage'
    AND upper(combo_product.sku_code) IN (SELECT sku_code FROM expected_combo)
),
snapshot_checks AS (
  SELECT
    'snapshot_schema_is_complete'::TEXT AS check_name,
    (
      SELECT count(*) = 11
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'sale_item_combo_components'
        AND column_row.column_name IN (
          'sale_item_id', 'combo_product_id', 'component_product_id',
          'component_type', 'quantity_per_combo', 'quantity_total',
          'component_name', 'component_sku', 'observed_unit_price',
          'selected_option_group', 'created_at'
        )
    )
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'sale_items'
        AND column_row.column_name = 'selected_beverage_product_id'
        AND column_row.udt_name = 'uuid'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.sale_items'::REGCLASS
        AND constraint_row.conname = 'sale_items_selected_beverage_product_id_fkey'
        AND constraint_row.contype = 'f'
        AND pg_get_constraintdef(constraint_row.oid, TRUE)
          ILIKE '%selected_beverage_product_id%REFERENCES products(id)%'
    ) AS passed,
    'The sale item carries one UUID beverage selection and snapshots retain every required observed value.'::TEXT AS detail

  UNION ALL

  SELECT
    'snapshot_table_is_append_only'::TEXT AS check_name,
    to_regclass('public.sale_item_combo_components') IS NOT NULL
      AND has_table_privilege('authenticated', 'public.sale_item_combo_components', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.sale_item_combo_components', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.sale_item_combo_components', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.sale_item_combo_components', 'DELETE')
      AND NOT has_table_privilege('anon', 'public.sale_item_combo_components', 'SELECT')
      AND EXISTS (
        SELECT 1
        FROM pg_trigger AS trigger_row
        JOIN pg_proc AS proc_row ON proc_row.oid = trigger_row.tgfoid
        WHERE trigger_row.tgrelid = 'public.sale_item_combo_components'::REGCLASS
          AND trigger_row.tgname = 'aa_protect_sale_item_combo_components'
          AND proc_row.proname = 'protect_sale_item_combo_components'
          AND trigger_row.tgenabled <> 'D'
          AND NOT trigger_row.tgisinternal
      )
      AND EXISTS (
        SELECT 1 FROM function_defs AS function_row
        WHERE function_row.proname = 'protect_sale_item_combo_components'
          AND function_row.definition LIKE '%tg_op = ''insert''%'
          AND function_row.definition LIKE '%pg_trigger_depth() > 1%'
          AND function_row.definition LIKE '%raise exception%'
      ) AS passed,
    'Authenticated can read snapshots through RLS but cannot insert, update or delete them directly.'::TEXT AS detail

  UNION ALL

  SELECT
    'snapshot_null_safe_uniqueness',
    EXISTS (
      SELECT 1
      FROM pg_indexes AS index_row
      WHERE index_row.schemaname = 'public'
        AND index_row.tablename = 'sale_item_combo_components'
        AND index_row.indexname = 'sale_item_combo_components_null_safe_unique_idx'
        AND index_row.indexdef ILIKE '%UNIQUE INDEX%'
        AND index_row.indexdef ILIKE '%coalesce(selected_option_group%'
    ),
    'The component uniqueness index treats a NULL option group deterministically.'

  UNION ALL

  SELECT
    'server_trigger_validates_and_captures',
    EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      JOIN pg_proc AS proc_row ON proc_row.oid = trigger_row.tgfoid
      WHERE trigger_row.tgrelid = 'public.sale_items'::REGCLASS
        AND trigger_row.tgname = 'aa_capture_sale_item_combo_components'
        AND proc_row.proname = 'capture_sale_item_combo_components'
        AND trigger_row.tgenabled <> 'D'
        AND NOT trigger_row.tgisinternal
    )
    AND EXISTS (
      SELECT 1 FROM function_defs AS function_row
      WHERE function_row.proname = 'capture_sale_item_combo_components'
        AND function_row.definition LIKE '%selected_beverage_product_id%'
        AND function_row.definition LIKE '%v_selected_option_count <> 1%'
        AND function_row.definition LIKE '%official combos must use their fixed catalog price%'
        AND function_row.definition LIKE '%insert into public.sale_item_combo_components%'
        AND function_row.definition LIKE '%v_snapshot_count <> 3%'
    ),
    'An AFTER INSERT trigger validates one beverage and atomically creates exactly three snapshots.'
),
inventory_checks AS (
  SELECT
    'no_finished_goods_inventory_system'::TEXT AS check_name,
    to_regclass('public.product_component_stock') IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM function_defs AS function_row
        WHERE function_row.proname IN (
          'get_product_combo_catalog',
          'capture_sale_item_combo_components',
          'sync_pos_commission_for_sale_item'
        )
          AND (
            function_row.definition LIKE '%insert into public.product_lots%'
            OR function_row.definition LIKE '%update public.product_lots%'
            OR function_row.definition LIKE '%delete from public.product_lots%'
            OR function_row.definition LIKE '%insert into public.gummy_production_runs%'
            OR function_row.definition LIKE '%update public.gummy_production_runs%'
            OR function_row.definition LIKE '%delete from public.gummy_production_runs%'
            OR function_row.definition LIKE '%insert into public.sku_print_events%'
            OR function_row.definition LIKE '%update public.sku_print_events%'
            OR function_row.definition LIKE '%delete from public.sku_print_events%'
          )
      ),
    'This phase creates no beverage stock table and performs no inventory DML.'

  UNION ALL

  SELECT
    'no_replacement_sale_rpc',
    NOT EXISTS (
      SELECT 1 FROM function_defs AS function_row
      WHERE function_row.proname = 'create_pos_sale_with_combos'
    ),
    'The deployed sales and sale_items insert flow remains authoritative.'
),
commission_checks AS (
  SELECT
    'one_popcorn_based_commission_per_combo_line'::TEXT AS check_name,
    count(*) = 1
      AND bool_and(
        function_row.definition LIKE '%from public.product_combos as combo%'
        AND function_row.definition LIKE '%combo.commission_product_id%'
        AND function_row.definition LIKE '%v_product := v_sold_product%'
        AND function_row.definition LIKE '%coalesce(v_item.quantity, 0)::numeric * v_unit_commission%'
        AND function_row.definition LIKE '%source_type = ''pos_sale'' and event.source_item_id = v_item.id%'
        AND function_row.definition LIKE '%on conflict do nothing%'
        AND function_row.definition NOT LIKE '%gomix90%'
        AND function_row.definition NOT LIKE '%selected_beverage_product_id%'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_indexes AS index_row
        WHERE index_row.schemaname = 'public'
          AND index_row.tablename = 'commission_events'
          AND index_row.indexdef ILIKE '%UNIQUE INDEX%'
          AND index_row.indexdef ILIKE '%(source_type, source_item_id)%'
          AND index_row.indexdef ILIKE '%source_item_id IS NOT NULL%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.commission_events AS event
        JOIN public.sale_items AS item ON item.id = event.source_item_id
        JOIN public.product_combos AS combo ON combo.product_id = item.product_id
        WHERE event.source_type = 'pos_sale'
        GROUP BY event.source_item_id
        HAVING count(*) > 1
      ) AS passed,
    'The existing single-event POS path swaps only the tariff product for official combos.'::TEXT AS detail
  FROM function_defs AS function_row
  WHERE function_row.proname = 'sync_pos_commission_for_sale_item'

  UNION ALL

  SELECT
    'normal_pos_commissions_preserved',
    count(*) = 1
      AND bool_and(
        function_row.definition LIKE '%v_profile.role = ''socios_comerciales''%'
        AND function_row.definition LIKE '%v_scheme := ''venta_pieza''%'
        AND function_row.definition LIKE '%commission_program_eligibility_snapshots%'
        AND function_row.definition LIKE '%v_scheme := ''vendedora_pos''%'
        AND function_row.definition LIKE '%v_profile.role = ''vendedora'' and v_profile.is_active%'
        AND function_row.definition LIKE '%if v_product.id is null then%v_product := v_sold_product%'
      ),
    'Gerardo, Bianca eligibility snapshots and the normal-product fallback remain in the same function.'
  FROM function_defs AS function_row
  WHERE function_row.proname = 'sync_pos_commission_for_sale_item'

  UNION ALL

  SELECT
    'refund_commission_path_has_no_inventory_restore',
    count(*) >= 1
      AND bool_and(
        function_row.definition NOT LIKE '%product_lots%'
        AND function_row.definition NOT LIKE '%gummy_production_runs%'
        AND function_row.definition NOT LIKE '%sku_print_events%'
        AND function_row.definition NOT LIKE '%sale_item_combo_components%'
      ),
    'The existing refund path remains the only cancellation mechanism and does not restore nonexistent combo inventory.'
  FROM function_defs AS function_row
  WHERE function_row.proname IN ('refund_sale', 'sync_pos_commissions_for_refund')
),
security_checks AS (
  SELECT
    'catalog_rls_and_permissions'::TEXT AS check_name,
    bool_and(class_row.relrowsecurity)
      AND has_table_privilege('authenticated', 'public.product_combos', 'SELECT')
      AND has_table_privilege('authenticated', 'public.product_combo_components', 'SELECT')
      AND has_table_privilege('authenticated', 'public.product_combo_component_options', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.product_combos', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.product_combos', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.product_combos', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.product_combo_components', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.product_combo_components', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.product_combo_components', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.product_combo_component_options', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.product_combo_component_options', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.product_combo_component_options', 'DELETE')
      AND NOT has_table_privilege('anon', 'public.product_combos', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.product_combo_components', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.product_combo_component_options', 'SELECT')
      AND (
        SELECT count(*) = 3
        FROM pg_policies AS policy_row
        WHERE policy_row.schemaname = 'public'
          AND policy_row.policyname IN (
            'product_combos_authenticated_select',
            'product_combo_components_authenticated_select',
            'product_combo_options_authenticated_select'
          )
          AND policy_row.roles @> ARRAY['authenticated']::NAME[]
          AND policy_row.cmd = 'SELECT'
      ) AS passed,
    'Authenticated can read the combo catalog; catalog writes remain administrative and anon has no access.'::TEXT AS detail
  FROM pg_class AS class_row
  WHERE class_row.oid IN (
    'public.product_combos'::REGCLASS,
    'public.product_combo_components'::REGCLASS,
    'public.product_combo_component_options'::REGCLASS,
    'public.sale_item_combo_components'::REGCLASS
  )

  UNION ALL

  SELECT
    'internal_functions_not_executable',
    count(*) = 4
      AND bool_and(NOT function_row.anon_execute AND NOT function_row.authenticated_execute),
    'Snapshot trigger and catalog-helper functions cannot be invoked directly by anon or authenticated.'
  FROM function_defs AS function_row
  WHERE function_row.proname IN (
    'capture_sale_item_combo_components',
    'protect_sale_item_combo_components',
    'normalize_combo_catalog_identity',
    'is_valid_ean13'
  )

  UNION ALL

  SELECT
    'catalog_rpc_authenticated_only',
    count(*) = 1
      AND bool_and(
        NOT function_row.anon_execute
        AND function_row.authenticated_execute
        AND NOT function_row.prosecdef
      ),
    'The read-only catalog RPC runs with caller permissions and is unavailable to anon.'
  FROM function_defs AS function_row
  WHERE function_row.proname = 'get_product_combo_catalog'

  UNION ALL

  SELECT
    'snapshot_reads_remain_branch_scoped',
    EXISTS (
      SELECT 1
      FROM pg_policies AS policy_row
      WHERE policy_row.schemaname = 'public'
        AND policy_row.tablename = 'sale_item_combo_components'
        AND policy_row.policyname = 'sale_item_combo_components_branch_select'
        AND policy_row.roles @> ARRAY['authenticated']::NAME[]
        AND policy_row.qual ILIKE '%user_has_branch_access%'
    ),
    'Snapshot visibility follows the parent sale branch and existing branch access rules.'
),
promotion_checks AS (
  SELECT
    'database_preserves_conventional_promotions'::TEXT AS check_name,
    EXISTS (
      SELECT 1 FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'sale_items'
        AND column_row.column_name = 'discount_amount'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'sale_items'
        AND column_row.column_name = 'discount_reason'
    )
    AND EXISTS (
      SELECT 1 FROM function_defs AS function_row
      WHERE function_row.proname = 'capture_sale_item_combo_components'
        AND function_row.definition LIKE '%new.discount_amount%'
        AND function_row.definition LIKE '%new.discount_reason%'
    ) AS passed,
    'Existing discount fields remain intact; only official combo lines are rejected when discounted.'::TEXT AS detail
),
checks AS (
  SELECT * FROM catalog_checks
  UNION ALL SELECT * FROM definition_checks
  UNION ALL SELECT * FROM snapshot_checks
  UNION ALL SELECT * FROM inventory_checks
  UNION ALL SELECT * FROM commission_checks
  UNION ALL SELECT * FROM security_checks
  UNION ALL SELECT * FROM promotion_checks
)
SELECT
  check_name,
  coalesce(passed, FALSE) AS passed,
  detail,
  bool_and(coalesce(passed, FALSE)) OVER () AS all_checks_passed
FROM checks
ORDER BY check_name;
