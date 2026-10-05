-- Read-only structural and deployment verifier for Chipitlán cash inventory controls.
WITH function_definitions AS (
  SELECT
    lower(coalesce(pg_get_functiondef(to_regprocedure('public.open_cash_register_with_inventory_for_branch(uuid,numeric,numeric,numeric,text)')), '')) AS open_with_counts,
    lower(coalesce(pg_get_functiondef(to_regprocedure('public.close_cash_register_with_inventory_for_branch(uuid,uuid,numeric,numeric,numeric,text)')), '')) AS close_with_counts,
    lower(coalesce(pg_get_functiondef(to_regprocedure('public.open_cash_register_session_for_branch(uuid,numeric,uuid,text)')), '')) AS legacy_open,
    lower(coalesce(pg_get_functiondef(to_regprocedure('public.close_cash_register_session_for_branch(uuid,uuid,numeric,uuid,text)')), '')) AS legacy_close,
    lower(coalesce(pg_get_functiondef(to_regprocedure('public.assign_open_cash_session_to_sale()')), '')) AS sale_guard,
    lower(coalesce(pg_get_functiondef(to_regprocedure('public.snapshot_sale_item_cost()')), '')) AS cost_snapshot,
    lower(coalesce(pg_get_functiondef(to_regprocedure('public.get_cash_inventory_history_admin()')), '')) AS history_admin,
    lower(coalesce(pg_get_functiondef(to_regprocedure('public.get_admin_operational_alerts(boolean)')), '')) AS alerts_admin
),
checks AS (
  SELECT jsonb_build_object(
    'five_required_tables_exist', (
      SELECT count(*) = 5
      FROM (VALUES
        ('branch_cash_control_settings'),
        ('cash_inventory_counts'),
        ('cash_session_close_summaries'),
        ('admin_operational_alerts'),
        ('admin_operational_alert_reads')
      ) AS expected(name)
      WHERE to_regclass('public.' || expected.name) IS NOT NULL
    ),
    'all_control_tables_have_rls', (
      SELECT count(*) = 5 AND bool_and(class.relrowsecurity)
      FROM pg_class AS class
      WHERE class.oid IN (
        'public.branch_cash_control_settings'::regclass,
        'public.cash_inventory_counts'::regclass,
        'public.cash_session_close_summaries'::regclass,
        'public.admin_operational_alerts'::regclass,
        'public.admin_operational_alert_reads'::regclass
      )
    ),
    'select_policies_are_admin_scoped', (
      SELECT count(*) = 5
        AND count(*) FILTER (
          WHERE tablename <> 'admin_operational_alert_reads'
            AND lower(coalesce(qual, '')) LIKE '%current_user_is_active_admin%'
        ) = 4
        AND count(*) FILTER (
          WHERE tablename = 'admin_operational_alert_reads'
            AND lower(coalesce(qual, '')) LIKE '%auth.uid()%'
            AND lower(coalesce(qual, '')) LIKE '%current_user_is_active_admin%'
        ) = 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN (
          'branch_cash_control_settings',
          'cash_inventory_counts',
          'cash_session_close_summaries',
          'admin_operational_alerts',
          'admin_operational_alert_reads'
        )
    ),
    'control_tables_are_not_readable_by_public_or_anon', NOT EXISTS (
      SELECT 1
      FROM pg_class AS class
      CROSS JOIN LATERAL aclexplode(coalesce(class.relacl, acldefault('r', class.relowner))) AS acl
      WHERE class.oid IN (
        'public.branch_cash_control_settings'::regclass,
        'public.cash_inventory_counts'::regclass,
        'public.cash_session_close_summaries'::regclass,
        'public.admin_operational_alerts'::regclass,
        'public.admin_operational_alert_reads'::regclass
      )
        AND acl.privilege_type = 'SELECT'
        AND acl.grantee IN (0, 'anon'::regrole::oid)
    ),
    'chipitlan_identity_is_exact', EXISTS (
      SELECT 1 FROM public.branches
      WHERE id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::uuid
        AND code = 'chipitlan_01'
    ),
    'material_identities_are_exact', EXISTS (
      SELECT 1 FROM public.raw_materials
      WHERE id = 'c0f9cc2d-1057-40c1-94b0-615471b118d6'::uuid
        AND lower(btrim(unit)) = 'g'
    ) AND EXISTS (
      SELECT 1 FROM public.raw_materials
      WHERE id = '35c434ec-8876-4757-bb91-b241e8002878'::uuid
        AND lower(btrim(unit)) = 'ml'
    ),
    'only_chipitlan_is_configured_active', (
      SELECT count(*) = 1
        AND bool_and(branch_id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::uuid)
      FROM public.branch_cash_control_settings
      WHERE active
    ),
    'chipitlan_setting_uses_exact_materials', EXISTS (
      SELECT 1 FROM public.branch_cash_control_settings
      WHERE branch_id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::uuid
        AND active
        AND require_opening_inventory_count
        AND require_closing_inventory_count
        AND corn_raw_material_id = 'c0f9cc2d-1057-40c1-94b0-615471b118d6'::uuid
        AND oil_raw_material_id = '35c434ec-8876-4757-bb91-b241e8002878'::uuid
    ),
    'aurrera_is_not_configured', NOT EXISTS (
      SELECT 1 FROM public.branch_cash_control_settings
      WHERE branch_id = 'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::uuid AND active
    ),
    'required_fks_exist', (
      SELECT count(*) >= 8
      FROM pg_constraint
      WHERE contype = 'f'
        AND conrelid IN (
          'public.branch_cash_control_settings'::regclass,
          'public.cash_inventory_counts'::regclass,
          'public.cash_session_close_summaries'::regclass,
          'public.admin_operational_alerts'::regclass,
          'public.admin_operational_alert_reads'::regclass
        )
    ),
    'phase_and_unique_constraints_exist', EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.cash_inventory_counts'::regclass
        AND contype = 'c' AND lower(pg_get_constraintdef(oid)) LIKE '%opening%closing%'
    ) AND EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.cash_inventory_counts'::regclass
        AND contype = 'u'
        AND lower(pg_get_constraintdef(oid)) LIKE '%cash_session_id%phase%raw_material_id%'
    ),
    'supporting_indexes_exist', (
      SELECT count(*) >= 5 FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'cash_register_sessions_id_branch_unique_idx',
          'cash_inventory_counts_branch_counted_at_idx',
          'cash_inventory_counts_counted_by_idx',
          'cash_session_close_summaries_branch_closed_at_idx',
          'admin_operational_alerts_created_at_idx'
        )
    ),
    'new_rpc_signatures_are_exact_and_unique',
      to_regprocedure('public.open_cash_register_with_inventory_for_branch(uuid,numeric,numeric,numeric,text)') IS NOT NULL
      AND to_regprocedure('public.close_cash_register_with_inventory_for_branch(uuid,uuid,numeric,numeric,numeric,text)') IS NOT NULL
      AND to_regprocedure('public.get_cash_inventory_session_state(uuid,uuid)') IS NOT NULL
      AND to_regprocedure('public.get_cash_inventory_history_admin()') IS NOT NULL
      AND to_regprocedure('public.get_admin_operational_alerts(boolean)') IS NOT NULL
      AND to_regprocedure('public.acknowledge_admin_operational_alert(uuid)') IS NOT NULL
      AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'open_cash_register_with_inventory_for_branch') = 1
      AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'close_cash_register_with_inventory_for_branch') = 1
      AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_cash_inventory_session_state') = 1
      AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_cash_inventory_history_admin') = 1
      AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_admin_operational_alerts') = 1
      AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'acknowledge_admin_operational_alert') = 1,
    'new_exposed_rpcs_are_security_definer_with_safe_path', (
      SELECT count(*) = 6
        AND bool_and(proc.prosecdef)
        AND bool_and(proc.proconfig @> ARRAY['search_path=public, pg_temp'])
      FROM pg_proc AS proc
      WHERE proc.oid IN (
        to_regprocedure('public.open_cash_register_with_inventory_for_branch(uuid,numeric,numeric,numeric,text)'),
        to_regprocedure('public.close_cash_register_with_inventory_for_branch(uuid,uuid,numeric,numeric,numeric,text)'),
        to_regprocedure('public.get_cash_inventory_session_state(uuid,uuid)'),
        to_regprocedure('public.get_cash_inventory_history_admin()'),
        to_regprocedure('public.get_admin_operational_alerts(boolean)'),
        to_regprocedure('public.acknowledge_admin_operational_alert(uuid)')
      )
    ),
    'rpc_execute_grants_are_minimal', NOT EXISTS (
      SELECT 1
      FROM pg_proc AS proc
      CROSS JOIN LATERAL aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) AS acl
      WHERE proc.oid IN (
        to_regprocedure('public.open_cash_register_with_inventory_for_branch(uuid,numeric,numeric,numeric,text)'),
        to_regprocedure('public.close_cash_register_with_inventory_for_branch(uuid,uuid,numeric,numeric,numeric,text)'),
        to_regprocedure('public.get_cash_inventory_session_state(uuid,uuid)'),
        to_regprocedure('public.get_cash_inventory_history_admin()'),
        to_regprocedure('public.get_admin_operational_alerts(boolean)'),
        to_regprocedure('public.acknowledge_admin_operational_alert(uuid)')
      )
        AND acl.privilege_type = 'EXECUTE'
        AND acl.grantee IN (0, 'anon'::regrole::oid)
    ) AND (
      SELECT count(*) = 6
      FROM pg_proc AS proc
      WHERE proc.oid IN (
        to_regprocedure('public.open_cash_register_with_inventory_for_branch(uuid,numeric,numeric,numeric,text)'),
        to_regprocedure('public.close_cash_register_with_inventory_for_branch(uuid,uuid,numeric,numeric,numeric,text)'),
        to_regprocedure('public.get_cash_inventory_session_state(uuid,uuid)'),
        to_regprocedure('public.get_cash_inventory_history_admin()'),
        to_regprocedure('public.get_admin_operational_alerts(boolean)'),
        to_regprocedure('public.acknowledge_admin_operational_alert(uuid)')
      ) AND has_function_privilege('authenticated', proc.oid, 'EXECUTE')
    ),
    'legacy_rpcs_block_controlled_branches',
      definitions.legacy_open LIKE '%branch_cash_control_settings%requires inventory counts%'
      AND definitions.legacy_close LIKE '%branch_cash_control_settings%requires inventory counts%',
    'legacy_open_contract_is_preserved', EXISTS (
      SELECT 1
      FROM pg_proc AS proc
      WHERE proc.oid = to_regprocedure('public.open_cash_register_session_for_branch(uuid,numeric,uuid,text)')
        AND proc.prorettype = 'public.cash_register_sessions'::regtype
        AND lower(pg_get_function_arguments(proc.oid)) LIKE '%p_opening_cash numeric default 0%'
        AND lower(pg_get_function_arguments(proc.oid)) LIKE '%p_opened_by uuid default null%'
        AND lower(pg_get_function_arguments(proc.oid)) LIKE '%p_notes text default null%'
        AND definitions.legacy_open LIKE '%pg_advisory_xact_lock%'
        AND definitions.legacy_open LIKE '%status = ''open''%'
        AND definitions.legacy_open LIKE '%closed_at is null%'
    ),
    'aurrera_legacy_contract_remains',
      definitions.legacy_open LIKE '%insert into public.cash_register_sessions%'
      AND definitions.legacy_close LIKE '%update public.cash_register_sessions%'
      AND definitions.legacy_open LIKE '%user_has_branch_access%'
      AND definitions.legacy_close LIKE '%user_has_branch_access%',
    'opening_is_atomic_in_one_rpc',
      definitions.open_with_counts LIKE '%insert into public.cash_register_sessions%'
      AND definitions.open_with_counts LIKE '%insert into public.cash_inventory_counts%'
      AND definitions.open_with_counts LIKE '%insert into public.admin_operational_alerts%'
      AND definitions.open_with_counts LIKE '%pg_advisory_xact_lock%'
      AND definitions.open_with_counts LIKE '%status = ''open''%'
      AND definitions.open_with_counts LIKE '%closed_at is null%'
      AND definitions.open_with_counts LIKE '%p_corn_kg * 1000%'
      AND definitions.open_with_counts LIKE '%p_oil_liters * 1000%',
    'closing_is_atomic_in_one_rpc',
      definitions.close_with_counts LIKE '%for update%'
      AND definitions.close_with_counts LIKE '%insert into public.cash_inventory_counts%'
      AND definitions.close_with_counts LIKE '%insert into public.cash_session_close_summaries%'
      AND definitions.close_with_counts LIKE '%update public.cash_register_sessions%'
      AND definitions.close_with_counts LIKE '%insert into public.admin_operational_alerts%',
    'closing_snapshot_has_required_categories',
      definitions.close_with_counts LIKE '%discount_total%'
      AND definitions.close_with_counts LIKE '%promotion_sale_count%'
      AND definitions.close_with_counts LIKE '%generic_sales_total%'
      AND definitions.close_with_counts LIKE '%known_cost_total%'
      AND definitions.close_with_counts LIKE '%amount_without_known_cost%'
      AND definitions.close_with_counts LIKE '%refunded_sales%'
      AND definitions.close_with_counts LIKE '%combo_components%',
    'counts_and_summaries_are_immutable', EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.cash_inventory_counts'::regclass
        AND tgname = 'protect_cash_inventory_counts' AND NOT tgisinternal
        AND (tgtype & 1) = 1
        AND (tgtype & 2) = 2
        AND (tgtype & 16) = 16
        AND (tgtype & 8) = 8
        AND (tgtype & 4) = 0
    ) AND EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.cash_session_close_summaries'::regclass
        AND tgname = 'protect_cash_close_summaries' AND NOT tgisinternal
        AND (tgtype & 1) = 1
        AND (tgtype & 2) = 2
        AND (tgtype & 16) = 16
        AND (tgtype & 8) = 8
        AND (tgtype & 4) = 0
    ) AND EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.admin_operational_alerts'::regclass
        AND tgname = 'protect_admin_operational_alerts' AND NOT tgisinternal
        AND (tgtype & 1) = 1
        AND (tgtype & 2) = 2
        AND (tgtype & 16) = 16
        AND (tgtype & 8) = 8
        AND (tgtype & 4) = 0
    ),
    'alerts_are_persistent_and_read_per_admin', EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.admin_operational_alerts'::regclass
        AND contype = 'u'
        AND lower(pg_get_constraintdef(oid)) LIKE '%cash_session_id%alert_type%'
    ) AND EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.admin_operational_alert_reads'::regclass
        AND contype = 'p'
        AND lower(pg_get_constraintdef(oid)) LIKE '%alert_id%admin_user_id%'
    ),
    'global_admin_readers_require_active_admin',
      definitions.history_admin LIKE '%current_user_is_active_admin%'
      AND definitions.alerts_admin LIKE '%current_user_is_active_admin%',
    'no_direct_client_writes', NOT EXISTS (
      SELECT 1
      FROM pg_class AS class
      CROSS JOIN LATERAL aclexplode(coalesce(class.relacl, acldefault('r', class.relowner))) AS acl
      WHERE class.oid IN (
        'public.cash_inventory_counts'::regclass,
        'public.cash_session_close_summaries'::regclass,
        'public.admin_operational_alerts'::regclass,
        'public.admin_operational_alert_reads'::regclass
      )
        AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
        AND acl.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    ),
    'internal_trigger_functions_are_not_directly_executable', NOT EXISTS (
      SELECT 1
      FROM pg_proc AS proc
      CROSS JOIN LATERAL aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) AS acl
      WHERE proc.oid IN (
        to_regprocedure('public._validate_cash_inventory_count_value(numeric,text)'),
        to_regprocedure('public._protect_cash_inventory_counts()'),
        to_regprocedure('public._protect_cash_close_summaries()'),
        to_regprocedure('public._protect_admin_operational_alerts()'),
        to_regprocedure('public.snapshot_sale_item_cost()'),
        to_regprocedure('public.assign_open_cash_session_to_sale()')
      )
        AND acl.privilege_type = 'EXECUTE'
        AND acl.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    ),
    'chipitlan_pos_and_delivery_are_guarded',
      definitions.sale_guard LIKE '%v_origin = ''order''%'
      AND definitions.sale_guard LIKE '%v_origin = ''delivery'' and v_controlled%'
      AND definitions.sale_guard LIKE '%cash_inventory_counts%'
      AND definitions.sale_guard LIKE '%phase = ''opening''%'
      AND definitions.sale_guard LIKE '%status = ''open''%'
      AND definitions.sale_guard LIKE '%closed_at is null%'
      AND definitions.sale_guard LIKE '%cash_session_id is null%',
    'sale_guard_trigger_contract_is_exact', EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.sales'::regclass
        AND tgname = 'trg_assign_open_cash_session_to_sale'
        AND tgfoid = to_regprocedure('public.assign_open_cash_session_to_sale()')
        AND NOT tgisinternal
        AND (tgtype & 1) = 1
        AND (tgtype & 2) = 2
        AND (tgtype & 4) = 4
        AND (tgtype & 16) = 16
        AND (tgtype & 8) = 0
    ),
    'orders_remain_out_of_scope', definitions.sale_guard LIKE '%v_origin = ''order''%return new%',
    'cost_snapshot_columns_exist_without_backfill_default', (
      SELECT count(*) = 3 AND bool_and(column_default IS NULL)
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sale_items'
        AND column_name IN ('observed_unit_cost', 'observed_total_cost', 'cost_source')
    ),
    'new_sale_cost_snapshot_is_installed', EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.sale_items'::regclass
        AND tgname = 'aa_snapshot_sale_item_cost' AND NOT tgisinternal
        AND (tgtype & 1) = 1
        AND (tgtype & 2) = 2
        AND (tgtype & 4) = 4
        AND (tgtype & 16) = 16
        AND (tgtype & 8) = 0
    ) AND definitions.cost_snapshot LIKE '%product_unit_cost%'
      AND definitions.cost_snapshot LIKE '%combo_components%'
      AND definitions.cost_snapshot LIKE '%cost_source := ''generic''%'
      AND definitions.cost_snapshot LIKE '%cost_source := ''missing''%'
      AND regexp_replace(definitions.cost_snapshot, '[[:space:]]', '', 'g') NOT LIKE '%coalesce(product.unit_cost,0)%'
      AND regexp_replace(definitions.cost_snapshot, '[[:space:]]', '', 'g') NOT LIKE '%coalesce(component.unit_cost,0)%'
      AND regexp_replace(definitions.cost_snapshot, '[[:space:]]', '', 'g') NOT LIKE '%coalesce(v_unit_cost,0)%'
      AND regexp_replace(definitions.cost_snapshot, '[[:space:]]', '', 'g') NOT LIKE '%coalesce(unit_cost,0)%',
    'raw_material_stock_is_never_changed',
      definitions.open_with_counts NOT LIKE '%update public.raw_materials%'
      AND definitions.close_with_counts NOT LIKE '%update public.raw_materials%'
      AND definitions.sale_guard NOT LIKE '%update public.raw_materials%',
    'chipitlan_has_no_open_session', NOT EXISTS (
      SELECT 1 FROM public.cash_register_sessions
      WHERE branch_id = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::uuid
        AND status = 'open'
        AND closed_at IS NULL
    )
  ) AS value
  FROM function_definitions AS definitions
),
result AS (
  SELECT checks.value,
    (SELECT bool_and(entry.value::text::boolean) FROM jsonb_each(checks.value) AS entry) AS all_checks_passed
  FROM checks
)
SELECT jsonb_build_object(
  'all_checks_passed', result.all_checks_passed,
  'checks', result.value
) AS verification
FROM result;
