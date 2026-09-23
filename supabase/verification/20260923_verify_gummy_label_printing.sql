-- Read-only verifier for 20260923_fix_gummy_label_printing.sql.
-- Run only after the migration. It returns exactly one JSONB document.

WITH function_rows AS (
  SELECT
    procedure.oid,
    procedure.prosecdef,
    procedure.proconfig,
    pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
    lower(pg_get_functiondef(procedure.oid)) AS function_definition,
    NOT EXISTS (
      SELECT 1
      FROM aclexplode(
        coalesce(procedure.proacl, acldefault('f', procedure.proowner))
      ) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) AS public_execute_revoked
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'print_sku_labels'
),
function_facts AS (
  SELECT
    count(*) = 1 AS single_rpc_overload,
    coalesce(bool_and(
      function_row.identity_arguments = 'p_product_id uuid, p_units integer'
    ), FALSE) AS exact_rpc_signature,
    coalesce(bool_and(function_row.prosecdef), FALSE) AS security_definer,
    coalesce(bool_and(
      coalesce(function_row.proconfig, ARRAY[]::TEXT[])
        @> ARRAY['search_path=public, pg_temp']
    ), FALSE) AS safe_search_path,
    coalesce(bool_and(
      function_row.public_execute_revoked
      AND NOT has_function_privilege('anon', function_row.oid, 'EXECUTE')
      AND has_function_privilege(
        'authenticated', function_row.oid, 'EXECUTE'
      )
    ), FALSE) AS restricted_execute,
    coalesce(bool_and(
      position(
        'if v_product.sku_code = ''gomix90'' then'
        IN function_row.function_definition
      ) > 0
    ), FALSE) AS has_gomix90_branch,
    coalesce(bool_and(
      position(
        'from public.gummy_production_runs as run'
        IN function_row.function_definition
      ) > 0
    ), FALSE) AS counts_gummy_production,
    coalesce(bool_and(
      position(
        'from public.sku_print_events as print_event'
        IN function_row.function_definition
      ) > 0
    ), FALSE) AS counts_prior_label_events,
    coalesce(bool_and(
      position(
        'if p_units > v_available_to_print then'
        IN function_row.function_definition
      ) > 0
    ), FALSE) AS rejects_unproduced_labels,
    coalesce(bool_and(
      position(
        '''message'', ''impresión de gomitas registrada sin descontar materia prima nuevamente.'''
        IN function_row.function_definition
      ) > 0
    ), FALSE) AS gummy_branch_avoids_second_debit,
    coalesce(bool_and(
      position(
        'from public.product_recipe_items as recipe_item'
        IN function_row.function_definition
      ) > position(
        'if v_product.sku_code = ''gomix90'' then'
        IN function_row.function_definition
      )
    ), FALSE) AS conventional_recipe_check_follows_gummy_branch,
    coalesce(bool_and(
      position(
        'insert into public.sku_print_event_items'
        IN function_row.function_definition
      ) > 0
      AND position(
        'update public.raw_materials as material'
        IN function_row.function_definition
      ) > 0
    ), FALSE) AS conventional_product_flow_preserved
  FROM function_rows AS function_row
),
catalog_facts AS (
  SELECT
    count(*) = 1 AS exactly_one_gomix90_product,
    coalesce(bool_and(
      product.barcode_value = '7500000000190'
      AND product.active
    ), FALSE) AS gomix90_identity_matches
  FROM public.products AS product
  WHERE product.sku_code = 'GOMIX90'
),
recipe_facts AS (
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.product_recipe_items AS recipe_item
    JOIN public.products AS product
      ON product.id = recipe_item.product_id
    WHERE product.sku_code = 'GOMIX90'
  ) AS no_conventional_gummy_recipe
),
balance_facts AS (
  SELECT
    coalesce(production.units_produced, 0) AS gummy_units_produced,
    coalesce(printing.units_printed, 0) AS gummy_units_printed,
    greatest(
      coalesce(production.units_produced, 0)
        - coalesce(printing.units_printed, 0),
      0
    ) AS gummy_units_available_to_print,
    coalesce(printing.units_printed, 0)
      <= coalesce(production.units_produced, 0)
      AS printed_units_do_not_exceed_production
  FROM (
    SELECT coalesce(sum(run.units_produced), 0) AS units_produced
    FROM public.gummy_production_runs AS run
    JOIN public.products AS product
      ON product.id = run.product_id
    WHERE product.sku_code = 'GOMIX90'
  ) AS production
  CROSS JOIN (
    SELECT coalesce(sum(print_event.units_printed), 0) AS units_printed
    FROM public.sku_print_events AS print_event
    JOIN public.products AS product
      ON product.id = print_event.product_id
    WHERE product.sku_code = 'GOMIX90'
  ) AS printing
),
checks AS (
  SELECT
    function_facts.*,
    catalog_facts.*,
    recipe_facts.*,
    balance_facts.*
  FROM function_facts
  CROSS JOIN catalog_facts
  CROSS JOIN recipe_facts
  CROSS JOIN balance_facts
)
SELECT to_jsonb(checks)
  || jsonb_build_object(
    'all_checks_passed',
    single_rpc_overload
    AND exact_rpc_signature
    AND security_definer
    AND safe_search_path
    AND restricted_execute
    AND has_gomix90_branch
    AND counts_gummy_production
    AND counts_prior_label_events
    AND rejects_unproduced_labels
    AND gummy_branch_avoids_second_debit
    AND conventional_recipe_check_follows_gummy_branch
    AND conventional_product_flow_preserved
    AND exactly_one_gomix90_product
    AND gomix90_identity_matches
    AND no_conventional_gummy_recipe
    AND printed_units_do_not_exceed_production
  ) AS verification
FROM checks;
