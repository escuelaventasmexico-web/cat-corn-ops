-- Read-only structural verifier for 20260929_commercial_prospects.sql.
-- It returns exactly one JSONB row and does not impersonate application users.
-- Manual tests intentionally excluded from this verifier:
-- 1. Submit two concurrent creates with the same normalized phone; only one may commit.
-- 2. Submit two concurrent conversions for one prospect; exactly one partner/conversion may exist.
-- 3. Pay a qualifying settlement partially, then fully; the bonus must move pending -> available.
-- 4. Adjust the first settlement to zero before reserving the bonus; the next valid settlement wins.
-- 5. Repeat the adjustment after reserving/paying the bonus; values stay unchanged and an issue is logged.

WITH relation_checks AS (
  SELECT
    to_regclass('public.commercial_prospects') IS NOT NULL AS prospects_table_exists,
    to_regclass('public.commercial_prospect_interactions') IS NOT NULL AS interactions_table_exists,
    to_regclass('public.commercial_prospect_conversions') IS NOT NULL AS conversions_table_exists,
    to_regclass('public.v_commercial_prospect_details') IS NOT NULL AS detail_view_exists,
    to_regclass('public.v_commercial_partner_directory') IS NOT NULL AS directory_view_exists,
    to_regclass('public.v_commercial_prospect_bonus_movements') IS NOT NULL AS bonus_view_exists
), column_checks AS (
  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'commercial_alias'
    ) AS commercial_alias_exists,
    NOT EXISTS (
      SELECT required.column_name
      FROM unnest(ARRAY[
        'business_name', 'business_type', 'phone', 'address', 'location_reference',
        'contact_name', 'sells_snacks', 'status', 'latest_result', 'next_follow_up_at',
        'proposed_visit_at', 'general_notes', 'created_by', 'originator_user_id',
        'assigned_to', 'origin_channel', 'converted_by', 'converted_at',
        'commercial_partner_id', 'created_at', 'updated_at'
      ]) AS required(column_name)
      WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns AS column_row
        WHERE column_row.table_schema = 'public'
          AND column_row.table_name = 'commercial_prospects'
          AND column_row.column_name = required.column_name
      )
    ) AS prospect_columns_complete,
    NOT EXISTS (
      SELECT required.column_name
      FROM unnest(ARRAY[
        'prospect_id', 'occurred_at', 'performed_by', 'result', 'notes',
        'next_follow_up_at', 'proposed_visit_at', 'created_at'
      ]) AS required(column_name)
      WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns AS column_row
        WHERE column_row.table_schema = 'public'
          AND column_row.table_name = 'commercial_prospect_interactions'
          AND column_row.column_name = required.column_name
      )
    ) AS interaction_columns_complete
), identity_checks AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM auth.users AS auth_user
      JOIN public.user_profiles AS profile ON profile.id = auth_user.id
      WHERE auth_user.id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
        AND lower(auth_user.email) = 'angelicagut@catcorn.com.mx'
        AND profile.full_name = 'Angelica Gutierrez'
        AND profile.role = 'vendedora'
        AND profile.is_active
        AND profile.commercial_alias = 'ANGELICA'
    ) AS angelica_identity_and_alias_match
), constraint_checks AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.commercial_prospects'::REGCLASS
        AND constraint_row.conname = 'commercial_prospects_visit_requires_address'
        AND constraint_row.contype = 'c'
    ) AS visit_requires_address,
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.commercial_prospects'::REGCLASS
        AND constraint_row.conname = 'commercial_prospects_conversion_consistent'
        AND constraint_row.contype = 'c'
    ) AS conversion_is_consistent,
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.commercial_prospect_conversions'::REGCLASS
        AND constraint_row.contype = 'u'
        AND pg_get_constraintdef(constraint_row.oid, true) ILIKE '%prospect_id%'
    ) AS one_conversion_per_prospect,
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.commercial_prospect_conversions'::REGCLASS
        AND constraint_row.contype = 'u'
        AND pg_get_constraintdef(constraint_row.oid, true) ILIKE '%commercial_partner_id%'
    ) AS one_conversion_per_partner,
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.commission_events'::REGCLASS
        AND constraint_row.conname = 'commission_events_source_type_check'
        AND pg_get_constraintdef(constraint_row.oid, true) ILIKE '%prospect_conversion_bonus%'
    ) AS commission_source_type_extended,
    EXISTS (
      SELECT 1 FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.commission_rules'::REGCLASS
        AND constraint_row.conname = 'commission_rules_scheme_check'
        AND pg_get_constraintdef(constraint_row.oid, true) ILIKE '%prospect_conversion%'
    ) AS commission_scheme_extended,
    count(*) FILTER (
      WHERE constraint_row.conrelid = 'public.commercial_prospects'::REGCLASS
        AND constraint_row.contype = 'f'
    ) = 5 AS prospect_foreign_keys_complete,
    count(*) FILTER (
      WHERE constraint_row.conrelid = 'public.commercial_prospect_interactions'::REGCLASS
        AND constraint_row.contype = 'f'
    ) = 2 AS interaction_foreign_keys_complete,
    count(*) FILTER (
      WHERE constraint_row.conrelid = 'public.commercial_prospect_conversions'::REGCLASS
        AND constraint_row.contype = 'f'
    ) = 5 AS conversion_foreign_keys_complete
  FROM pg_constraint AS constraint_row
), function_rows AS (
  SELECT
    proc_row.oid,
    proc_row.proname,
    pg_get_function_identity_arguments(proc_row.oid) AS identity_arguments,
    proc_row.prosecdef,
    COALESCE(array_to_string(proc_row.proconfig, ','), '') AS configuration,
    lower(pg_get_functiondef(proc_row.oid)) AS definition,
    NOT has_function_privilege('anon', proc_row.oid, 'EXECUTE') AS anon_execute_revoked,
    NOT EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(proc_row.proacl, acldefault('f', proc_row.proowner))) AS acl_row
      WHERE acl_row.grantee = 0 AND acl_row.privilege_type = 'EXECUTE'
    ) AS public_execute_revoked
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.proname IN (
      'commercial_prospect_duplicate_warnings',
      'create_commercial_prospect',
      'update_commercial_prospect',
      'append_commercial_prospect_interaction',
      'convert_commercial_prospect',
      'export_commercial_prospects',
      'is_valid_prospect_bonus_recipient',
      'sync_prospect_conversion_bonus',
      'create_commission_settlement',
      'can_access_commercial_partners'
    )
), function_checks AS (
  SELECT
    count(*) = 10 AS required_functions_exist,
    bool_and(prosecdef) AS required_functions_are_security_definer,
    bool_and(configuration ILIKE '%search_path=public%') AS search_paths_are_fixed,
    bool_and(anon_execute_revoked AND public_execute_revoked) AS public_and_anon_execute_revoked,
    bool_or(
      proname = 'create_commercial_prospect'
      AND definition LIKE '%commercial_prospect_duplicate_warnings%'
      AND definition LIKE '%pg_advisory_xact_lock%'
    ) AS create_rechecks_duplicates,
    bool_or(
      proname = 'convert_commercial_prospect'
      AND definition LIKE '%for update%'
      AND definition LIKE '%commercial_prospect_conversions%'
      AND definition LIKE '%partner_model%comodato%'
    ) AS conversion_is_atomic,
    bool_or(
      proname = 'sync_prospect_conversion_bonus'
      AND definition LIKE '%get_comodato_movement_pending_balance%'
      AND definition LIKE '%prospect_conversion_bonus%'
      AND definition LIKE '%reserved%paid%'
    ) AS bonus_sync_uses_paid_balance_and_protection,
    bool_or(
      proname = 'create_commission_settlement'
      AND definition LIKE '%vendedora%'
      AND definition LIKE '%prospect_conversion_bonus%'
    ) AS settlements_limit_vendedora_to_bonus
  FROM function_rows
), legacy_function_checks AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_proc AS proc_row
      JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
      WHERE namespace_row.nspname = 'public'
        AND proc_row.proname = 'is_valid_commission_seller'
        AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%socios_comerciales%'
        AND lower(pg_get_functiondef(proc_row.oid)) NOT LIKE '%vendedora%'
    ) AS normal_commission_seller_remains_socios_only,
    EXISTS (
      SELECT 1
      FROM pg_proc AS proc_row
      JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
      WHERE namespace_row.nspname = 'public'
        AND proc_row.proname = 'sync_comodato_commissions_for_movement'
        AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%is_valid_commission_seller%'
        AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%comodato_sale%'
    ) AS gerardo_normal_comodato_commissions_remain_enabled,
    EXISTS (
      SELECT 1
      FROM pg_proc AS proc_row
      JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
      WHERE namespace_row.nspname = 'public'
        AND proc_row.proname = 'sync_conversion_bonus_for_partner'
        AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%conversion_bonus%'
        AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%wholesale%'
        AND lower(pg_get_functiondef(proc_row.oid)) NOT LIKE '%prospect_conversion_bonus%'
    ) AS existing_conversion_bonus_meaning_is_unchanged,
    EXISTS (
      SELECT 1
      FROM pg_proc AS proc_row
      JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
      WHERE namespace_row.nspname = 'public'
        AND proc_row.proname = 'is_valid_prospect_bonus_recipient'
        AND lower(pg_get_functiondef(proc_row.oid)) LIKE '%role = ''vendedora''%'
        AND lower(pg_get_functiondef(proc_row.oid)) NOT LIKE '%socios_comerciales%'
    ) AS prospect_bonus_recipient_is_vendedora_only
), rls_checks AS (
  SELECT
    bool_and(class_row.relrowsecurity) AS required_rls_enabled,
    NOT EXISTS (
      SELECT 1
      FROM pg_policies AS policy_row
      WHERE policy_row.schemaname = 'public'
        AND policy_row.tablename IN (
          'commercial_prospects', 'commercial_prospect_interactions',
          'commercial_prospect_conversions', 'commercial_partners',
          'commercial_partner_movements', 'commercial_partner_movement_items',
          'commercial_partner_payments', 'wholesale_orders',
          'wholesale_order_items', 'wholesale_payments'
        )
        AND (
          regexp_replace(lower(COALESCE(policy_row.qual, '')), '[()[:space:]]', '', 'g') = 'true'
          OR regexp_replace(lower(COALESCE(policy_row.with_check, '')), '[()[:space:]]', '', 'g') = 'true'
        )
    ) AS no_open_b2b_policies,
    EXISTS (
      SELECT 1 FROM pg_policies AS policy_row
      WHERE policy_row.schemaname = 'public'
        AND policy_row.tablename = 'commercial_prospects'
        AND policy_row.cmd = 'SELECT'
        AND lower(COALESCE(policy_row.qual, '')) LIKE '%originator_user_id%auth.uid%'
        AND lower(COALESCE(policy_row.qual, '')) LIKE '%assigned_to%auth.uid%'
    ) AS vendedora_prospect_scope_present,
    NOT EXISTS (
      SELECT 1 FROM pg_policies AS policy_row
      WHERE policy_row.schemaname = 'public'
        AND policy_row.tablename = 'commercial_prospect_interactions'
        AND policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ) AS interaction_direct_writes_blocked,
    EXISTS (
      SELECT 1 FROM pg_policies AS policy_row
      WHERE policy_row.schemaname = 'public'
        AND policy_row.tablename = 'commission_events'
        AND policy_row.cmd = 'SELECT'
        AND lower(COALESCE(policy_row.qual, '')) LIKE '%vendedora%'
        AND lower(COALESCE(policy_row.qual, '')) LIKE '%prospect_conversion_bonus%'
    ) AS vendedora_commission_scope_present,
    NOT has_table_privilege('authenticated', 'public.commercial_prospects', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.commercial_prospects', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.commercial_prospects', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.commercial_prospect_interactions', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.commercial_prospect_interactions', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.commercial_prospect_interactions', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.commercial_prospect_conversions', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.commercial_prospect_conversions', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.commercial_prospect_conversions', 'DELETE')
        AS prospect_direct_writes_are_revoked,
    NOT has_table_privilege('anon', 'public.commercial_prospects', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.commercial_prospect_interactions', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.commercial_prospect_conversions', 'SELECT')
        AS prospect_anon_access_is_revoked
  FROM pg_class AS class_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = class_row.relnamespace
  WHERE namespace_row.nspname = 'public'
    AND class_row.relname IN (
      'commercial_prospects', 'commercial_prospect_interactions',
      'commercial_prospect_conversions', 'commercial_partners',
      'commercial_partner_movements', 'commercial_partner_movement_items',
      'commercial_partner_payments', 'wholesale_orders',
      'wholesale_order_items', 'wholesale_payments', 'commission_events',
      'commission_settlements', 'commission_settlement_items'
    )
), bonus_checks AS (
  SELECT
    EXISTS (
      SELECT 1 FROM public.commission_rules AS rule
      WHERE rule.scheme = 'prospect_conversion'
        AND rule.product_key = 'first_paid_comodato_settlement'
        AND rule.commission_type = 'fixed_bonus'
        AND rule.commission_amount = 50.00
        AND rule.currency = 'MXN'
        AND rule.valid_from = DATE '2026-09-29'
        AND rule.active
    ) AS exact_bonus_rule_exists,
    EXISTS (
      SELECT 1 FROM pg_indexes AS index_row
      WHERE index_row.schemaname = 'public'
        AND index_row.indexname = 'uq_commission_prospect_conversion_partner'
        AND index_row.indexdef ILIKE '%unique%partner_id%source_type%prospect_conversion_bonus%'
    ) AS bonus_is_unique_per_partner,
    count(*) FILTER (
      WHERE trigger_row.tgname IN (
        'sync_prospect_bonus_from_movement',
        'sync_prospect_bonus_from_item',
        'sync_prospect_bonus_from_payment'
      ) AND NOT trigger_row.tgisinternal
    ) = 3 AS all_bonus_sync_triggers_exist,
    NOT EXISTS (
      SELECT 1
      FROM public.commission_events AS event
      LEFT JOIN public.commercial_prospect_conversions AS conversion
        ON conversion.id = event.source_item_id
       AND conversion.commercial_partner_id = event.partner_id
      WHERE event.source_type = 'prospect_conversion_bonus'
        AND (
          conversion.id IS NULL
          OR conversion.converted_at < TIMESTAMPTZ '2026-09-29 00:00:00-06'
          OR event.earned_at < conversion.converted_at
        )
    ) AS no_retroactive_or_orphan_prospect_bonuses
  FROM pg_trigger AS trigger_row
), trigger_and_index_checks AS (
  SELECT
    count(*) FILTER (
      WHERE trigger_row.tgname IN (
        'protect_commercial_prospect_attribution',
        'reject_commercial_prospect_interaction_update',
        'reject_commercial_prospect_interaction_delete'
      ) AND NOT trigger_row.tgisinternal
    ) = 3 AS immutable_origin_and_append_only_triggers_exist,
    EXISTS (
      SELECT 1 FROM pg_indexes AS index_row
      WHERE index_row.schemaname = 'public'
        AND index_row.indexname = 'commercial_prospects_phone_idx'
    )
    AND EXISTS (
      SELECT 1 FROM pg_indexes AS index_row
      WHERE index_row.schemaname = 'public'
        AND index_row.indexname = 'commercial_prospects_name_location_idx'
    )
    AND EXISTS (
      SELECT 1 FROM pg_indexes AS index_row
      WHERE index_row.schemaname = 'public'
        AND index_row.indexname = 'commercial_prospect_interactions_history_idx'
    ) AS prospect_indexes_exist
  FROM pg_trigger AS trigger_row
), view_checks AS (
  SELECT bool_and(
    COALESCE(class_row.reloptions, ARRAY[]::TEXT[]) @> ARRAY['security_invoker=true']
  ) AS sensitive_views_are_security_invoker
  FROM pg_class AS class_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = class_row.relnamespace
  WHERE namespace_row.nspname = 'public'
    AND class_row.relkind = 'v'
    AND (
      class_row.relname LIKE 'v_b2b_%'
      OR class_row.relname LIKE 'v_commission_%'
      OR class_row.relname LIKE 'v_commissions_%'
      OR class_row.relname LIKE 'v_seller_commission_%'
      OR class_row.relname LIKE 'v_commercial_partner_%'
      OR class_row.relname LIKE 'v_commercial_prospect_%'
    )
), all_checks AS (
  SELECT
    to_jsonb(relation_checks) ||
    to_jsonb(column_checks) ||
    to_jsonb(identity_checks) ||
    to_jsonb(constraint_checks) ||
    to_jsonb(function_checks) ||
    to_jsonb(legacy_function_checks) ||
    to_jsonb(rls_checks) ||
    to_jsonb(bonus_checks) ||
    to_jsonb(trigger_and_index_checks) ||
    to_jsonb(view_checks) AS checks
  FROM relation_checks, column_checks, identity_checks, constraint_checks,
       function_checks, legacy_function_checks, rls_checks, bonus_checks,
       trigger_and_index_checks, view_checks
)
SELECT jsonb_build_object(
  'all_checks_passed', NOT EXISTS (
    SELECT 1
    FROM jsonb_each_text(all_checks.checks) AS check_row
    WHERE check_row.value IS DISTINCT FROM 'true'
  ),
  'checks', all_checks.checks,
  'note', 'Read-only structural verification; execute role-specific behavior with real authenticated sessions.'
) AS verification
FROM all_checks;
