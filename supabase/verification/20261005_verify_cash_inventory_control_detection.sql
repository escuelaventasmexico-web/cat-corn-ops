-- Read-only verifier for branch cash-inventory control discovery.
WITH rpc AS (
  SELECT
    function_row.oid,
    function_row.prosecdef,
    function_row.proconfig,
    lower(pg_get_functiondef(function_row.oid)) AS definition
  FROM pg_proc AS function_row
  WHERE function_row.oid =
    to_regprocedure('public.get_cash_inventory_control_for_branch(uuid)')
),
legacy AS (
  SELECT
    lower(coalesce(pg_get_functiondef(
      to_regprocedure('public.open_cash_register_session_for_branch(uuid,numeric,uuid,text)')
    ), '')) AS open_definition,
    lower(coalesce(pg_get_functiondef(
      to_regprocedure('public.close_cash_register_session_for_branch(uuid,uuid,numeric,uuid,text)')
    ), '')) AS close_definition
),
checks AS (
  SELECT JSONB_BUILD_OBJECT(
    'rpc_exists_once_with_exact_signature',
      to_regprocedure('public.get_cash_inventory_control_for_branch(uuid)') IS NOT NULL
      AND (
        SELECT COUNT(*) = 1
        FROM pg_proc
        WHERE pronamespace = 'public'::REGNAMESPACE
          AND proname = 'get_cash_inventory_control_for_branch'
      )
      AND EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = to_regprocedure('public.get_cash_inventory_control_for_branch(uuid)')
          AND prorettype = 'jsonb'::REGTYPE
      ),
    'rpc_is_security_definer_with_safe_path',
      COALESCE((SELECT prosecdef FROM rpc), FALSE)
      AND COALESCE((SELECT proconfig @> ARRAY['search_path=public, pg_temp'] FROM rpc), FALSE),
    'rpc_execute_permissions_are_exact',
      has_function_privilege(
        'authenticated',
        to_regprocedure('public.get_cash_inventory_control_for_branch(uuid)'),
        'EXECUTE'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM rpc
        CROSS JOIN LATERAL aclexplode(
          COALESCE(
            (SELECT proacl FROM pg_proc WHERE oid = rpc.oid),
            acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = rpc.oid))
          )
        ) AS permission
        WHERE permission.privilege_type = 'EXECUTE'
          AND permission.grantee IN (0, 'anon'::REGROLE::OID)
      ),
    'rpc_requires_authenticated_active_profile',
      COALESCE((SELECT definition LIKE '%auth.uid()%' FROM rpc), FALSE)
      AND COALESCE((SELECT definition LIKE '%user_profiles%' FROM rpc), FALSE)
      AND COALESCE((SELECT definition LIKE '%profile.is_active%' FROM rpc), FALSE),
    'rpc_requires_active_branch_and_scoped_access',
      COALESCE((SELECT definition LIKE '%branch.active%' FROM rpc), FALSE)
      AND COALESCE((SELECT definition LIKE '%current_user_is_active_admin()%' FROM rpc), FALSE)
      AND COALESCE((SELECT definition LIKE '%user_has_branch_access(p_branch_id)%' FROM rpc), FALSE),
    'rpc_returns_only_safe_contract_fields',
      COALESCE((SELECT definition LIKE '%''branch_id''%' FROM rpc), FALSE)
      AND COALESCE((SELECT definition LIKE '%''control_enabled''%' FROM rpc), FALSE)
      AND COALESCE((SELECT definition LIKE '%''requires_opening_counts''%' FROM rpc), FALSE)
      AND COALESCE((SELECT definition LIKE '%''requires_closing_counts''%' FROM rpc), FALSE)
      AND COALESCE((SELECT definition LIKE '%''corn_label''%' FROM rpc), FALSE)
      AND COALESCE((SELECT definition LIKE '%''corn_unit''%' FROM rpc), FALSE)
      AND COALESCE((SELECT definition LIKE '%''oil_label''%' FROM rpc), FALSE)
      AND COALESCE((SELECT definition LIKE '%''oil_unit''%' FROM rpc), FALSE)
      AND COALESCE((SELECT definition NOT LIKE '%corn_raw_material_id%' FROM rpc), FALSE)
      AND COALESCE((SELECT definition NOT LIKE '%oil_raw_material_id%' FROM rpc), FALSE),
    'configuration_table_remains_admin_only',
      (SELECT relrowsecurity FROM pg_class
       WHERE oid = 'public.branch_cash_control_settings'::REGCLASS)
      AND NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'branch_cash_control_settings'
          AND (
            cmd <> 'SELECT'
            OR NOT (roles @> ARRAY['authenticated'::NAME])
            OR lower(COALESCE(qual, '')) NOT LIKE '%current_user_is_active_admin()%'
          )
      )
      AND (
        SELECT COUNT(*) = 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'branch_cash_control_settings'
      ),
    'chipitlan_contract_is_controlled', EXISTS (
      SELECT 1
      FROM public.branches AS branch
      JOIN public.branch_cash_control_settings AS setting
        ON setting.branch_id = branch.id
      WHERE branch.id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID
        AND branch.code = 'chipitlan_01'
        AND branch.active
        AND setting.active
        AND setting.require_opening_inventory_count
        AND setting.require_closing_inventory_count
    ),
    'aurrera_contract_remains_legacy', EXISTS (
      SELECT 1
      FROM public.branches AS branch
      WHERE branch.id = 'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID
        AND branch.code = 'aurrera_la_luna_02'
        AND branch.active
        AND NOT EXISTS (
          SELECT 1
          FROM public.branch_cash_control_settings AS setting
          WHERE setting.branch_id = branch.id
            AND setting.active
        )
    ),
    'legacy_rpcs_still_block_controlled_branches',
      legacy.open_definition LIKE '%branch_cash_control_settings%requires inventory counts%'
      AND legacy.close_definition LIKE '%branch_cash_control_settings%requires inventory counts%',
    'controlled_rpc_signatures_are_unchanged',
      to_regprocedure(
        'public.open_cash_register_with_inventory_for_branch(uuid,numeric,numeric,numeric,text)'
      ) IS NOT NULL
      AND to_regprocedure(
        'public.close_cash_register_with_inventory_for_branch(uuid,uuid,numeric,numeric,numeric,text)'
      ) IS NOT NULL
      AND (
        SELECT COUNT(*) = 1 FROM pg_proc
        WHERE pronamespace = 'public'::REGNAMESPACE
          AND proname = 'open_cash_register_with_inventory_for_branch'
      )
      AND (
        SELECT COUNT(*) = 1 FROM pg_proc
        WHERE pronamespace = 'public'::REGNAMESPACE
          AND proname = 'close_cash_register_with_inventory_for_branch'
      ),
    'correction_does_not_change_raw_material_stock',
      COALESCE((SELECT definition NOT LIKE '%raw_materials%' FROM rpc), FALSE)
  ) AS value
  FROM legacy
),
result AS (
  SELECT
    checks.value,
    (
      SELECT BOOL_AND(entry.value::TEXT::BOOLEAN)
      FROM JSONB_EACH(checks.value) AS entry
    ) AS all_checks_passed
  FROM checks
)
SELECT JSONB_BUILD_OBJECT(
  'all_checks_passed', result.all_checks_passed,
  'checks', result.value
) AS verification
FROM result;
