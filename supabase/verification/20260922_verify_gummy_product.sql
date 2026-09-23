-- Read-only verifier for 20260922_gummy_product_corrected.sql.
-- Run only after the migration. It returns exactly one JSONB document.

WITH expected AS (
  SELECT
    'GOMIX90'::TEXT AS sku_code,
    '7500000000190'::TEXT AS barcode_value,
    'Gomitas de Grenetina Mix'::TEXT AS product_name,
    'Gomitas de grenetina a granel'::TEXT AS material_name,
    'GOMITAS-GREN-01'::TEXT AS material_code,
    90::NUMERIC AS grams_per_unit,
    80.00::NUMERIC AS material_cost_per_kg,
    7.20::NUMERIC AS unit_cost,
    18.00::NUMERIC AS sale_price
),
objects AS (
  SELECT
    to_regclass('public.gummy_product_recipes') IS NOT NULL
      AS recipe_table_exists,
    to_regclass('public.gummy_production_runs') IS NOT NULL
      AS runs_table_exists,
    to_regprocedure('public.record_gummy_production(integer,text)') IS NOT NULL
      AS production_rpc_exists
),
catalog_counts AS (
  SELECT
    count(*) FILTER (WHERE sku_code = 'GOMIX90') = 1
      AS sku_has_one_row,
    count(*) FILTER (WHERE barcode_value = '7500000000190') = 1
      AS barcode_has_one_row
  FROM public.products
),
product_facts AS (
  SELECT
    count(*) = 1 AS exactly_one_product,
    bool_and(
      product.name = expected.product_name
      AND product.size = '90 g'
      AND product.price = expected.sale_price
      AND product.active
      AND product.flavor = 'GOMITAS'
      AND product.grams = expected.grams_per_unit
      AND product.barcode_value = expected.barcode_value
      AND product.unit_cost = expected.unit_cost
      AND (
        NOT (to_jsonb(product) ? 'is_active')
        OR coalesce((to_jsonb(product) ->> 'is_active')::BOOLEAN, FALSE)
      )
      AND (
        NOT (to_jsonb(product) ? 'product_name')
        OR to_jsonb(product) ->> 'product_name' = expected.product_name
      )
      AND (
        NOT (to_jsonb(product) ? 'category')
        OR to_jsonb(product) ->> 'category' = 'GOMITAS'
      )
      AND (
        NOT (to_jsonb(product) ? 'product_variant')
        OR to_jsonb(product) ->> 'product_variant' = 'Mix'
      )
      AND (
        NOT (to_jsonb(product) ? 'weight_grams')
        OR (to_jsonb(product) ->> 'weight_grams')::NUMERIC
           = expected.grams_per_unit
      )
    ) AS product_values_match
  FROM public.products AS product
  CROSS JOIN expected
  WHERE product.sku_code = expected.sku_code
),
material_facts AS (
  SELECT
    count(*) = 1 AS exactly_one_material,
    bool_and(material.name = expected.material_name)
      AS material_name_matches,
    bool_and(lower(btrim(material.unit)) = 'g')
      AS material_unit_is_grams
  FROM public.raw_materials AS material
  CROSS JOIN expected
  WHERE material.material_code = expected.material_code
),
recipe_facts AS (
  SELECT
    count(*) = 1 AS exactly_one_recipe,
    bool_and(
      recipe.grams_per_unit = expected.grams_per_unit
      AND recipe.raw_material_cost_per_kg = expected.material_cost_per_kg
      AND recipe.unit_cost = expected.unit_cost
      AND recipe.active
      AND product.sku_code = expected.sku_code
      AND material.material_code = expected.material_code
    ) AS recipe_values_match
  FROM public.gummy_product_recipes AS recipe
  JOIN public.products AS product
    ON product.id = recipe.product_id
  JOIN public.raw_materials AS material
    ON material.id = recipe.raw_material_id
  CROSS JOIN expected
),
index_facts AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_index AS idx
      WHERE idx.indrelid = 'public.products'::REGCLASS
        AND idx.indisvalid
        AND idx.indisunique
        AND idx.indnkeyatts = 1
        AND pg_get_indexdef(idx.indexrelid, 1, TRUE) = 'sku_code'
        AND (
          idx.indpred IS NULL
          OR (
            pg_get_expr(idx.indpred, idx.indrelid) ILIKE '%sku_code%'
            AND pg_get_expr(idx.indpred, idx.indrelid) LIKE '%GOMIX90%'
          )
        )
    ) AS sku_unique_index_exists,
    EXISTS (
      SELECT 1
      FROM pg_index AS idx
      WHERE idx.indrelid = 'public.products'::REGCLASS
        AND idx.indisvalid
        AND idx.indisunique
        AND idx.indnkeyatts = 1
        AND pg_get_indexdef(idx.indexrelid, 1, TRUE) = 'barcode_value'
        AND (
          idx.indpred IS NULL
          OR (
            pg_get_expr(idx.indpred, idx.indrelid) ILIKE '%barcode_value%'
            AND pg_get_expr(idx.indpred, idx.indrelid) LIKE '%7500000000190%'
          )
        )
    ) AS barcode_unique_index_exists,
    EXISTS (
      SELECT 1
      FROM pg_index AS idx
      WHERE idx.indrelid = 'public.raw_materials'::REGCLASS
        AND idx.indisvalid
        AND idx.indisunique
        AND idx.indnkeyatts = 1
        AND pg_get_indexdef(idx.indexrelid, 1, TRUE) = 'material_code'
        AND (
          idx.indpred IS NULL
          OR (
            pg_get_expr(idx.indpred, idx.indrelid) ILIKE '%material_code%'
            AND pg_get_expr(idx.indpred, idx.indrelid) LIKE '%GOMITAS-GREN-01%'
          )
        )
    ) AS material_code_unique_index_exists
),
function_rows AS (
  SELECT
    proc.oid,
    proc.prosecdef,
    proc.proconfig,
    pg_get_function_identity_arguments(proc.oid) AS identity_arguments,
    lower(pg_get_functiondef(proc.oid)) AS function_definition,
    NOT EXISTS (
      SELECT 1
      FROM aclexplode(
        coalesce(proc.proacl, acldefault('f', proc.proowner))
      ) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) AS public_execute_revoked
  FROM pg_proc AS proc
  JOIN pg_namespace AS namespace
    ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'record_gummy_production'
),
function_facts AS (
  SELECT
    count(*) = 1 AS single_rpc_overload,
    bool_and(
      function_row.identity_arguments = 'p_units integer, p_notes text'
    ) AS exact_rpc_signature,
    bool_and(function_row.prosecdef) AS security_definer,
    bool_and(
      coalesce(function_row.proconfig, ARRAY[]::TEXT[])
        @> ARRAY['search_path=public, pg_temp']
    ) AS safe_search_path,
    bool_and(
      function_row.public_execute_revoked
      AND NOT has_function_privilege('anon', function_row.oid, 'EXECUTE')
      AND has_function_privilege(
        'authenticated', function_row.oid, 'EXECUTE'
      )
    ) AS restricted_execute,
    bool_and(
      position(
        'v_actor uuid := auth.uid()'
        IN function_row.function_definition
      ) > 0
    ) AS derives_actor_from_auth,
    bool_and(
      position(
        'coalesce(profile.is_active, false)'
        IN function_row.function_definition
      ) > 0
    ) AS requires_active_profile,
    bool_and(
      position(
        'for update of material'
        IN function_row.function_definition
      ) > 0
    ) AS locks_material_row,
    bool_and(
      position(
        'coalesce(v_stock_before, 0) < v_grams_consumed'
        IN function_row.function_definition
      ) > 0
    ) AS rejects_insufficient_stock,
    bool_and(
      position(
        'v_grams_consumed := v_grams_per_unit * p_units'
        IN function_row.function_definition
      ) > 0
    ) AS consumes_recipe_grams_per_unit,
    bool_and(
      position(
        'current_stock = current_stock - v_grams_consumed'
        IN function_row.function_definition
      ) > 0
    ) AS debits_raw_material_once,
    bool_and(
      position(
        'lower(btrim(v_material_unit)) is distinct from ''g'''
        IN function_row.function_definition
      ) > 0
    ) AS enforces_grams_unit,
    bool_and(
      position(
        'insert into public.gummy_production_runs'
        IN function_row.function_definition
      ) > 0
    ) AS records_production_run,
    bool_and(
      position('product_lots' IN function_row.function_definition) = 0
      AND position('sale_items' IN function_row.function_definition) = 0
      AND position('sales' IN function_row.function_definition) = 0
    ) AS no_finished_goods_or_sale_debit
  FROM function_rows AS function_row
),
security_facts AS (
  SELECT
    coalesce(
      (
        SELECT relrowsecurity
        FROM pg_class
        WHERE oid = 'public.gummy_product_recipes'::REGCLASS
      ),
      FALSE
    ) AS recipes_rls,
    coalesce(
      (
        SELECT relrowsecurity
        FROM pg_class
        WHERE oid = 'public.gummy_production_runs'::REGCLASS
      ),
      FALSE
    ) AS runs_rls,
    has_table_privilege(
      'authenticated', 'public.gummy_product_recipes', 'SELECT'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.gummy_product_recipes', 'INSERT'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.gummy_product_recipes', 'UPDATE'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.gummy_product_recipes', 'DELETE'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.gummy_product_recipes', 'TRUNCATE'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.gummy_product_recipes', 'REFERENCES'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.gummy_product_recipes', 'TRIGGER'
    ) AS recipes_select_only,
    has_table_privilege(
      'authenticated', 'public.gummy_production_runs', 'SELECT'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.gummy_production_runs', 'INSERT'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.gummy_production_runs', 'UPDATE'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.gummy_production_runs', 'DELETE'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.gummy_production_runs', 'TRUNCATE'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.gummy_production_runs', 'REFERENCES'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.gummy_production_runs', 'TRIGGER'
    ) AS runs_select_only,
    NOT EXISTS (
      SELECT 1
      FROM pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename IN (
          'gummy_product_recipes', 'gummy_production_runs'
        )
        AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ) AS no_write_policies,
    EXISTS (
      SELECT 1
      FROM pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = 'gummy_product_recipes'
        AND policy.policyname = 'gummy_product_recipes_authenticated_select'
        AND policy.cmd = 'SELECT'
    ) AS recipe_select_policy,
    EXISTS (
      SELECT 1
      FROM pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = 'gummy_production_runs'
        AND policy.policyname = 'gummy_production_runs_authenticated_select'
        AND policy.cmd = 'SELECT'
    ) AS runs_select_policy
),
scope_facts AS (
  SELECT NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'branch_id'
      AND table_name IN (
        'gummy_product_recipes', 'gummy_production_runs'
      )
  ) AS product_and_material_scope_remain_global
),
checks AS (
  SELECT
    objects.*,
    coalesce(product_facts.exactly_one_product, FALSE)
      AS exactly_one_product,
    coalesce(product_facts.product_values_match, FALSE)
      AS product_values_match,
    coalesce(catalog_counts.sku_has_one_row, FALSE)
      AS sku_has_one_row,
    coalesce(catalog_counts.barcode_has_one_row, FALSE)
      AS barcode_has_one_row,
    coalesce(material_facts.exactly_one_material, FALSE)
      AS exactly_one_material,
    coalesce(material_facts.material_name_matches, FALSE)
      AS material_name_matches,
    coalesce(material_facts.material_unit_is_grams, FALSE)
      AS material_unit_is_grams,
    coalesce(recipe_facts.exactly_one_recipe, FALSE)
      AS exactly_one_recipe,
    coalesce(recipe_facts.recipe_values_match, FALSE)
      AS recipe_values_match,
    index_facts.*,
    coalesce(function_facts.single_rpc_overload, FALSE)
      AS single_rpc_overload,
    coalesce(function_facts.exact_rpc_signature, FALSE)
      AS exact_rpc_signature,
    coalesce(function_facts.security_definer, FALSE)
      AS security_definer,
    coalesce(function_facts.safe_search_path, FALSE)
      AS safe_search_path,
    coalesce(function_facts.restricted_execute, FALSE)
      AS restricted_execute,
    coalesce(function_facts.derives_actor_from_auth, FALSE)
      AS derives_actor_from_auth,
    coalesce(function_facts.requires_active_profile, FALSE)
      AS requires_active_profile,
    coalesce(function_facts.locks_material_row, FALSE)
      AS locks_material_row,
    coalesce(function_facts.rejects_insufficient_stock, FALSE)
      AS rejects_insufficient_stock,
    coalesce(function_facts.consumes_recipe_grams_per_unit, FALSE)
      AS consumes_recipe_grams_per_unit,
    coalesce(function_facts.debits_raw_material_once, FALSE)
      AS debits_raw_material_once,
    coalesce(function_facts.enforces_grams_unit, FALSE)
      AS enforces_grams_unit,
    coalesce(function_facts.records_production_run, FALSE)
      AS records_production_run,
    coalesce(function_facts.no_finished_goods_or_sale_debit, FALSE)
      AS no_finished_goods_or_sale_debit,
    security_facts.*,
    scope_facts.*
  FROM objects
  CROSS JOIN catalog_counts
  CROSS JOIN product_facts
  CROSS JOIN material_facts
  CROSS JOIN recipe_facts
  CROSS JOIN index_facts
  CROSS JOIN function_facts
  CROSS JOIN security_facts
  CROSS JOIN scope_facts
)
SELECT to_jsonb(checks)
  || jsonb_build_object(
    'all_checks_passed',
    recipe_table_exists
    AND runs_table_exists
    AND production_rpc_exists
    AND exactly_one_product
    AND product_values_match
    AND sku_has_one_row
    AND barcode_has_one_row
    AND exactly_one_material
    AND material_name_matches
    AND material_unit_is_grams
    AND exactly_one_recipe
    AND recipe_values_match
    AND sku_unique_index_exists
    AND barcode_unique_index_exists
    AND material_code_unique_index_exists
    AND single_rpc_overload
    AND exact_rpc_signature
    AND security_definer
    AND safe_search_path
    AND restricted_execute
    AND derives_actor_from_auth
    AND requires_active_profile
    AND locks_material_row
    AND rejects_insufficient_stock
    AND consumes_recipe_grams_per_unit
    AND debits_raw_material_once
    AND enforces_grams_unit
    AND records_production_run
    AND no_finished_goods_or_sale_debit
    AND recipes_rls
    AND runs_rls
    AND recipes_select_only
    AND runs_select_only
    AND no_write_policies
    AND recipe_select_policy
    AND runs_select_policy
    AND product_and_material_scope_remain_global
  ) AS verification
FROM checks;
