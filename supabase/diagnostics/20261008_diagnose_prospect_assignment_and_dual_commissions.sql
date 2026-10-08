BEGIN;

SET TRANSACTION READ ONLY;

WITH
target_function_names(function_name) AS (
  VALUES
    ('commission_settlement_candidate_events'),
    ('get_commission_settlement_preview'),
    ('create_commission_settlement'),
    ('sync_prospect_conversion_bonus'),
    ('sync_comodato_commissions_for_movement'),
    ('_sync_prospect_origin_commission_event'),
    ('sync_pos_commission_for_sale_item'),
    ('sync_wholesale_commissions_for_order'),
    ('convert_commercial_prospect'),
    ('get_commission_rule_amount')
),
related_tables(table_name) AS (
  VALUES
    ('commission_events'),
    ('commission_settlements'),
    ('commission_settlement_items'),
    ('commercial_prospects'),
    ('commercial_prospect_interactions'),
    ('commercial_prospect_conversions'),
    ('commercial_partners')
),
base_functions AS MATERIALIZED (
  SELECT
    proc_row.oid,
    namespace_row.nspname AS schema_name,
    proc_row.proname AS function_name,
    pg_get_function_identity_arguments(proc_row.oid) AS identity_arguments,
    pg_get_function_result(proc_row.oid) AS result_type,
    proc_row.prosecdef AS security_definer,
    proc_row.provolatile AS volatility,
    proc_row.prokind AS function_kind,
    COALESCE(proc_row.proconfig, ARRAY[]::TEXT[]) AS configuration,
    pg_get_functiondef(proc_row.oid) AS definition
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.prokind IN ('f', 'p')
),
related_triggers AS MATERIALIZED (
  SELECT
    trigger_row.oid,
    trigger_row.tgname AS trigger_name,
    namespace_row.nspname AS table_schema,
    class_row.relname AS table_name,
    CASE trigger_row.tgenabled
      WHEN 'O' THEN 'enabled'
      WHEN 'D' THEN 'disabled'
      WHEN 'R' THEN 'replica'
      WHEN 'A' THEN 'always'
      ELSE trigger_row.tgenabled::TEXT
    END AS enabled,
    concat_ws(', ',
      CASE WHEN (trigger_row.tgtype & 4) = 4 THEN 'INSERT' END,
      CASE WHEN (trigger_row.tgtype & 8) = 8 THEN 'DELETE' END,
      CASE WHEN (trigger_row.tgtype & 16) = 16 THEN 'UPDATE' END,
      CASE WHEN (trigger_row.tgtype & 32) = 32 THEN 'TRUNCATE' END
    ) AS events,
    CASE WHEN (trigger_row.tgtype & 2) = 2 THEN 'BEFORE'
      WHEN (trigger_row.tgtype & 64) = 64 THEN 'INSTEAD OF'
      ELSE 'AFTER'
    END AS timing,
    CASE WHEN (trigger_row.tgtype & 1) = 1 THEN 'ROW' ELSE 'STATEMENT' END AS level,
    pg_get_triggerdef(trigger_row.oid, TRUE) AS trigger_definition,
    trigger_function.proname AS trigger_function,
    pg_get_function_identity_arguments(trigger_function.oid) AS trigger_function_arguments,
    pg_get_functiondef(trigger_function.oid) AS trigger_function_definition
  FROM pg_trigger AS trigger_row
  JOIN pg_class AS class_row
    ON class_row.oid = trigger_row.tgrelid
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = class_row.relnamespace
  JOIN pg_proc AS trigger_function
    ON trigger_function.oid = trigger_row.tgfoid
  WHERE namespace_row.nspname = 'public'
    AND NOT trigger_row.tgisinternal
    AND class_row.relname IN (
      'commercial_partner_payments',
      'commercial_partner_movements',
      'commercial_partner_movement_items',
      'commercial_prospects',
      'commercial_prospect_conversions',
      'commission_events'
    )
),
payment_trigger_dependencies AS MATERIALIZED (
  SELECT DISTINCT function_row.function_name
  FROM base_functions AS function_row
  JOIN related_triggers AS trigger_row
    ON trigger_row.trigger_name = 'trg_sync_comodato_payment'
   AND (
     lower(trigger_row.trigger_function_definition)
       LIKE '%public.' || lower(function_row.function_name) || '(%'
     OR lower(trigger_row.trigger_function_definition)
       LIKE '%perform ' || lower(function_row.function_name) || '(%'
   )
),
catalog_functions AS MATERIALIZED (
  SELECT
    function_row.*,
    CASE
      WHEN target.function_name IS NOT NULL THEN 'required_contract'
      WHEN payment_trigger.trigger_function IS NOT NULL THEN 'payment_trigger_dependency'
      WHEN payment_dependency.function_name IS NOT NULL THEN 'payment_trigger_called_function'
      WHEN lower(function_row.definition) LIKE '%commercial_prospects%'
        THEN 'commercial_prospect_reader_or_writer'
      WHEN lower(function_row.definition) LIKE '%commercial_partners%'
        THEN 'commercial_partner_directory_candidate'
      ELSE 'related'
    END AS diagnostic_role,
    has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
      AS authenticated_can_execute,
    has_function_privilege('anon', function_row.oid, 'EXECUTE')
      AS anon_can_execute,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee', CASE WHEN acl_row.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END,
          'grantor', grantor.rolname,
          'privilege', acl_row.privilege_type,
          'grantable', acl_row.is_grantable
        )
        ORDER BY CASE WHEN acl_row.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END,
          acl_row.privilege_type
      )
      FROM aclexplode(
        COALESCE(
          (SELECT proc_row.proacl FROM pg_proc AS proc_row WHERE proc_row.oid = function_row.oid),
          acldefault('f', (SELECT proc_row.proowner FROM pg_proc AS proc_row WHERE proc_row.oid = function_row.oid))
        )
      ) AS acl_row
      LEFT JOIN pg_roles AS grantee ON grantee.oid = acl_row.grantee
      LEFT JOIN pg_roles AS grantor ON grantor.oid = acl_row.grantor
    ), '[]'::JSONB) AS permissions
  FROM base_functions AS function_row
  LEFT JOIN target_function_names AS target
    ON target.function_name = function_row.function_name
  LEFT JOIN (
    SELECT DISTINCT trigger_function
    FROM related_triggers
    WHERE trigger_name = 'trg_sync_comodato_payment'
  ) AS payment_trigger
    ON payment_trigger.trigger_function = function_row.function_name
  LEFT JOIN payment_trigger_dependencies AS payment_dependency
    ON payment_dependency.function_name = function_row.function_name
  WHERE target.function_name IS NOT NULL
    OR payment_trigger.trigger_function IS NOT NULL
    OR payment_dependency.function_name IS NOT NULL
    OR (
      lower(function_row.definition) LIKE '%commercial_prospects%'
      AND (
        lower(function_row.function_name) LIKE '%list%'
        OR lower(function_row.function_name) LIKE '%get%'
        OR lower(function_row.function_name) LIKE '%directory%'
        OR lower(function_row.function_name) LIKE '%prospect%'
      )
    )
    OR (
      lower(function_row.definition) LIKE '%commercial_partners%'
      AND (
        lower(function_row.function_name) LIKE '%list%'
        OR lower(function_row.function_name) LIKE '%get%'
        OR lower(function_row.function_name) LIKE '%directory%'
        OR lower(function_row.function_name) LIKE '%partner%'
      )
    )
),
relevant_views AS MATERIALIZED (
  SELECT
    namespace_row.nspname AS schema_name,
    class_row.relname AS view_name,
    CASE class_row.relkind WHEN 'm' THEN 'materialized_view' ELSE 'view' END AS view_kind,
    COALESCE(class_row.reloptions, ARRAY[]::TEXT[]) AS options,
    pg_get_viewdef(class_row.oid, TRUE) AS definition,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee', grant_row.grantee,
          'privilege', grant_row.privilege_type,
          'grantable', grant_row.is_grantable
        )
        ORDER BY grant_row.grantee, grant_row.privilege_type
      )
      FROM information_schema.role_table_grants AS grant_row
      WHERE grant_row.table_schema = namespace_row.nspname
        AND grant_row.table_name = class_row.relname
    ), '[]'::JSONB) AS permissions
  FROM pg_class AS class_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = class_row.relnamespace
  WHERE namespace_row.nspname = 'public'
    AND class_row.relkind IN ('v', 'm')
    AND (
      class_row.relname IN (
        'v_commission_events_effective',
        'v_commission_event_payment_balances',
        'v_commissions_available_for_payment',
        'v_commercial_prospect_bonus_movements',
        'v_commercial_prospect_details'
      )
      OR class_row.relname ILIKE '%commission%'
      OR class_row.relname ILIKE '%prospect%'
      OR class_row.relname ILIKE '%commercial_partner%'
      OR lower(pg_get_viewdef(class_row.oid, TRUE)) LIKE '%commercial_prospects%'
      OR lower(pg_get_viewdef(class_row.oid, TRUE)) LIKE '%commercial_partners%'
    )
),
table_security AS MATERIALIZED (
  SELECT
    namespace_row.nspname AS schema_name,
    class_row.relname AS table_name,
    class_row.relrowsecurity AS rls_enabled,
    class_row.relforcerowsecurity AS force_rls
  FROM pg_class AS class_row
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = class_row.relnamespace
  JOIN related_tables AS requested ON requested.table_name = class_row.relname
  WHERE namespace_row.nspname = 'public'
    AND class_row.relkind IN ('r', 'p')
),
effective_policies AS MATERIALIZED (
  SELECT
    policy_row.schemaname AS schema_name,
    policy_row.tablename AS table_name,
    policy_row.policyname AS policy_name,
    policy_row.permissive,
    to_jsonb(policy_row.roles) AS roles,
    policy_row.cmd,
    policy_row.qual,
    policy_row.with_check
  FROM pg_policies AS policy_row
  JOIN related_tables AS requested ON requested.table_name = policy_row.tablename
  WHERE policy_row.schemaname = 'public'
),
table_permissions AS MATERIALIZED (
  SELECT
    grant_row.table_schema AS schema_name,
    grant_row.table_name,
    grant_row.grantee,
    grant_row.privilege_type,
    grant_row.is_grantable
  FROM information_schema.role_table_grants AS grant_row
  JOIN related_tables AS requested ON requested.table_name = grant_row.table_name
  WHERE grant_row.table_schema = 'public'
),
commission_event_constraints AS MATERIALIZED (
  SELECT
    constraint_row.conname AS constraint_name,
    CASE constraint_row.contype
      WHEN 'p' THEN 'primary_key'
      WHEN 'u' THEN 'unique'
      WHEN 'f' THEN 'foreign_key'
      WHEN 'c' THEN 'check'
      WHEN 'x' THEN 'exclusion'
      ELSE constraint_row.contype::TEXT
    END AS constraint_type,
    pg_get_constraintdef(constraint_row.oid, TRUE) AS definition
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = to_regclass('public.commission_events')
),
commission_event_indexes AS MATERIALIZED (
  SELECT
    index_row.indexname AS index_name,
    index_row.indexdef AS definition,
    index_row.indexdef ILIKE '%UNIQUE%' AS is_unique,
    index_row.indexdef ILIKE '%seller_id%' AS uses_seller_id,
    index_row.indexdef ILIKE '%source_type%' AS uses_source_type,
    index_row.indexdef ILIKE '%source_id%' AS uses_source_id,
    index_row.indexdef ILIKE '%source_item_id%' AS uses_source_item_id,
    index_row.indexdef ILIKE '%partner_id%' AS uses_partner_id
  FROM pg_indexes AS index_row
  WHERE index_row.schemaname = 'public'
    AND index_row.tablename = 'commission_events'
),
active_rules AS MATERIALIZED (
  SELECT
    rule.id,
    rule.scheme,
    rule.product_key,
    rule.product_name,
    rule.commission_amount,
    rule.valid_from,
    rule.valid_to,
    rule.active
  FROM public.commission_rules AS rule
  WHERE rule.scheme IN ('comodato', 'vendedora_pos', 'prospect_origin', 'prospect_conversion')
    AND rule.active
),
overlapping_rules AS MATERIALIZED (
  SELECT
    first_rule.scheme,
    first_rule.product_key,
    first_rule.id AS first_rule_id,
    second_rule.id AS second_rule_id,
    first_rule.valid_from AS first_valid_from,
    first_rule.valid_to AS first_valid_to,
    second_rule.valid_from AS second_valid_from,
    second_rule.valid_to AS second_valid_to
  FROM active_rules AS first_rule
  JOIN active_rules AS second_rule
    ON second_rule.scheme = first_rule.scheme
   AND second_rule.product_key = first_rule.product_key
   AND second_rule.id > first_rule.id
   AND daterange(first_rule.valid_from, COALESCE(first_rule.valid_to, 'infinity'::DATE), '[]')
       && daterange(second_rule.valid_from, COALESCE(second_rule.valid_to, 'infinity'::DATE), '[]')
),
angelica_identity AS MATERIALIZED (
  SELECT
    profile.id,
    profile.role,
    profile.is_active,
    profile.commercial_alias,
    profile.full_name AS name,
    auth_user.email AS authenticated_email
  FROM public.user_profiles AS profile
  LEFT JOIN auth.users AS auth_user ON auth_user.id = profile.id
  WHERE profile.id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
),
gerardo_identity AS MATERIALIZED (
  SELECT profile.id, profile.commercial_alias, profile.full_name
  FROM public.user_profiles AS profile
  WHERE profile.role = 'socios_comerciales'
    AND profile.is_active
    AND (
      upper(COALESCE(profile.commercial_alias, '')) = 'GERARDO'
      OR lower(COALESCE(profile.full_name, '')) LIKE '%gerardo%'
    )
  ORDER BY
    CASE WHEN upper(COALESCE(profile.commercial_alias, '')) = 'GERARDO' THEN 0 ELSE 1 END,
    profile.id
  LIMIT 1
),
casa_ajusco_prospects AS MATERIALIZED (
  SELECT
    prospect.id AS prospect_id,
    prospect.business_name,
    prospect.status,
    prospect.originator_user_id,
    COALESCE(originator.commercial_alias, originator.full_name) AS originator_alias,
    prospect.assigned_to,
    COALESCE(assignee.commercial_alias, assignee.full_name) AS assigned_alias,
    prospect.commercial_partner_id,
    prospect.converted_at
  FROM public.commercial_prospects AS prospect
  LEFT JOIN public.user_profiles AS originator ON originator.id = prospect.originator_user_id
  LEFT JOIN public.user_profiles AS assignee ON assignee.id = prospect.assigned_to
  WHERE translate(lower(trim(prospect.business_name)), 'áéíóúüñ', 'aeiouun')
    LIKE '%jardin de eventos casa ajusco%'
),
casa_ajusco_conversions AS MATERIALIZED (
  SELECT
    conversion.id AS conversion_id,
    conversion.prospect_id,
    conversion.commercial_partner_id,
    conversion.originator_user_id,
    conversion.responsible_seller_id,
    conversion.converted_by,
    conversion.converted_at
  FROM public.commercial_prospect_conversions AS conversion
  JOIN casa_ajusco_prospects AS prospect ON prospect.prospect_id = conversion.prospect_id
),
casa_ajusco_partners AS MATERIALIZED (
  SELECT partner.id, partner.business_name, partner.assigned_to, partner.partner_model, partner.status
  FROM public.commercial_partners AS partner
  WHERE translate(lower(trim(partner.business_name)), 'áéíóúüñ', 'aeiouun')
    LIKE '%jardin de eventos casa ajusco%'
),
angelica_event_summary AS MATERIALIZED (
  SELECT
    event.source_type,
    event.status,
    balance.payment_status,
    count(*)::INTEGER AS event_count,
    COALESCE(sum(event.commission_amount), 0)::NUMERIC AS commission_amount,
    COALESCE(sum(balance.paid_amount), 0)::NUMERIC AS paid_amount,
    COALESCE(sum(balance.reserved_amount), 0)::NUMERIC AS reserved_amount,
    COALESCE(sum(balance.allocatable_amount), 0)::NUMERIC AS available_amount
  FROM public.commission_events AS event
  LEFT JOIN public.v_commission_event_payment_balances AS balance
    ON balance.commission_event_id = event.id
  WHERE event.seller_id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
    AND event.source_type IN ('prospect_conversion_bonus', 'prospect_origin_sale', 'pos_sale')
  GROUP BY event.source_type, event.status, balance.payment_status
),
function_definitions AS MATERIALIZED (
  SELECT
    string_agg(lower(definition), E'\n') FILTER (
      WHERE function_name = 'commission_settlement_candidate_events'
    ) AS candidate_definition,
    string_agg(lower(definition), E'\n') FILTER (
      WHERE function_name = 'sync_prospect_conversion_bonus'
    ) AS bonus_definition,
    string_agg(lower(definition), E'\n') FILTER (
      WHERE function_name = 'sync_comodato_commissions_for_movement'
    ) AS comodato_definition,
    string_agg(lower(definition), E'\n') FILTER (
      WHERE function_name = '_sync_prospect_origin_commission_event'
    ) AS origin_definition,
    string_agg(lower(definition), E'\n') FILTER (
      WHERE function_name = 'convert_commercial_prospect'
    ) AS conversion_definition
  FROM catalog_functions
),
policy_facts AS MATERIALIZED (
  SELECT
    COALESCE(bool_or(
      table_name = 'commission_events'
      AND cmd IN ('SELECT', 'ALL')
      AND (roles ? 'authenticated' OR roles ? 'public')
      AND lower(COALESCE(qual, '')) LIKE '%auth.uid()%'
      AND lower(COALESCE(qual, '')) LIKE '%seller_id%'
      AND lower(COALESCE(qual, '')) LIKE '%vendedora%'
      AND lower(COALESCE(qual, '')) LIKE '%prospect_origin_sale%'
    ), FALSE) AS vendedora_can_read_own_origin_events,
    COALESCE(bool_or(
      table_name = 'commercial_prospects'
      AND cmd IN ('SELECT', 'ALL')
      AND (roles ? 'authenticated' OR roles ? 'public')
      AND (
        lower(COALESCE(qual, '')) LIKE '%socios_comerciales%'
        OR (
          lower(COALESCE(qual, '')) LIKE '%auth.uid()%'
          AND lower(COALESCE(qual, '')) LIKE '%assigned_to%'
        )
      )
    ), FALSE) AS assigned_seller_can_read_prospects
  FROM effective_policies
),
trigger_facts AS MATERIALIZED (
  SELECT
    count(*) FILTER (WHERE trigger_name = 'trg_sync_comodato_payment') = 1
      AS payment_trigger_exists,
    COALESCE(bool_or(
      trigger_name = 'trg_sync_comodato_payment'
      AND lower(trigger_function_definition) LIKE '%sync_comodato_commissions_for_movement%'
    ), FALSE) AS payment_trigger_syncs_comodato_commissions,
    COALESCE(bool_or(
      table_name = 'commercial_prospect_conversions'
      AND lower(trigger_function_definition) LIKE '%originator_user_id is distinct from old.originator_user_id%'
      AND lower(trigger_function_definition) LIKE '%prospect_id is distinct from old.prospect_id%'
      AND lower(trigger_function_definition) LIKE '%commercial_partner_id is distinct from old.commercial_partner_id%'
    ), FALSE) AS conversion_attribution_is_immutable
  FROM related_triggers
),
rate_facts AS MATERIALIZED (
  SELECT
    COALESCE(bool_and(
      CASE
        WHEN rule.scheme <> 'prospect_origin' THEN TRUE
        WHEN rule.product_key LIKE '%jefe_felino%' THEN rule.commission_amount = 10
        WHEN rule.product_key LIKE '%gato_mayor%' THEN rule.commission_amount = 5
        WHEN rule.product_key LIKE '%michi%' THEN rule.commission_amount = 2
        ELSE FALSE
      END
    ) FILTER (WHERE rule.scheme = 'prospect_origin'), FALSE)
    AND count(*) FILTER (
      WHERE rule.scheme = 'prospect_origin'
        AND rule.product_key LIKE '%michi%'
        AND rule.product_key NOT LIKE '%gato_mayor%'
        AND rule.commission_amount = 2
    ) > 0
    AND count(*) FILTER (
      WHERE rule.scheme = 'prospect_origin'
        AND rule.product_key LIKE '%gato_mayor%'
        AND rule.commission_amount = 5
    ) > 0
    AND count(*) FILTER (
      WHERE rule.scheme = 'prospect_origin'
        AND rule.product_key LIKE '%jefe_felino%'
        AND rule.commission_amount = 10
    ) > 0 AS angelica_origin_rates_are_2_5_10,
    COALESCE(bool_and(
      CASE
        WHEN rule.scheme <> 'comodato' THEN TRUE
        WHEN rule.product_key LIKE '%jefe_felino%' THEN rule.commission_amount = 15
        WHEN rule.product_key LIKE '%gato_mayor%' THEN rule.commission_amount = 10
        WHEN rule.product_key LIKE '%michi%' THEN rule.commission_amount = 5
        ELSE FALSE
      END
    ) FILTER (WHERE rule.scheme = 'comodato'), FALSE)
    AND count(*) FILTER (
      WHERE rule.scheme = 'comodato'
        AND rule.product_key LIKE '%michi%'
        AND rule.product_key NOT LIKE '%gato_mayor%'
        AND rule.commission_amount = 5
    ) > 0
    AND count(*) FILTER (
      WHERE rule.scheme = 'comodato'
        AND rule.product_key LIKE '%gato_mayor%'
        AND rule.commission_amount = 10
    ) > 0
    AND count(*) FILTER (
      WHERE rule.scheme = 'comodato'
        AND rule.product_key LIKE '%jefe_felino%'
        AND rule.commission_amount = 15
    ) > 0 AS gerardo_rates_are_5_10_15,
    count(*) FILTER (
      WHERE rule.scheme = 'prospect_conversion'
        AND rule.commission_amount = 50
    ) = 1 AS conversion_bonus_is_50
  FROM active_rules AS rule
),
evaluations AS MATERIALIZED (
  SELECT
    COALESCE((
      SELECT identity.id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID
        AND identity.role = 'vendedora'
        AND identity.is_active
        AND upper(COALESCE(identity.commercial_alias, '')) = 'ANGELICA'
        AND lower(COALESCE(identity.name, '')) = 'angelica gutierrez'
        AND lower(COALESCE(identity.authenticated_email, '')) = 'angelicagut@catcorn.com.mx'
      FROM angelica_identity AS identity
    ), FALSE) AS angelica_identity_matches,
    rate.angelica_origin_rates_are_2_5_10,
    rate.gerardo_rates_are_5_10_15,
    rate.conversion_bonus_is_50,
    COALESCE(definition.candidate_definition LIKE '%prospect_origin_sale%', FALSE)
      AS settlement_candidates_include_prospect_origin_sale,
    COALESCE(definition.candidate_definition LIKE '%pos_sale%', FALSE)
      AS settlement_candidates_include_pos_sale,
    COALESCE(definition.candidate_definition LIKE '%prospect_conversion_bonus%', FALSE)
      AS settlement_candidates_include_conversion_bonus,
    policy.vendedora_can_read_own_origin_events,
    policy.vendedora_can_read_own_origin_events
      AND COALESCE(definition.candidate_definition LIKE '%prospect_origin_sale%', FALSE)
      AND COALESCE(definition.candidate_definition LIKE '%pos_sale%', FALSE)
      AND COALESCE(definition.candidate_definition LIKE '%prospect_conversion_bonus%', FALSE)
      AS vendedora_can_settle_all_allowed_sources,
    trigger.payment_trigger_exists,
    trigger.payment_trigger_syncs_comodato_commissions,
    COALESCE(
      definition.comodato_definition LIKE '%''comodato_sale''%'
      AND definition.comodato_definition LIKE '%_sync_prospect_origin_commission_event%'
      AND definition.origin_definition LIKE '%''prospect_origin_sale''%'
      AND EXISTS (
        SELECT 1
        FROM commission_event_indexes AS index_row
        WHERE index_row.is_unique
          AND index_row.uses_source_type
          AND index_row.uses_source_item_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM commission_event_indexes AS index_row
        WHERE index_row.is_unique
          AND index_row.uses_source_item_id
          AND NOT index_row.uses_source_type
      ),
      FALSE
    ) AS dual_commissions_can_coexist,
    trigger.conversion_attribution_is_immutable,
    COALESCE((
      SELECT count(*) = 1
        AND bool_and(prospect.originator_user_id = 'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID)
      FROM casa_ajusco_prospects AS prospect
    ), FALSE) AS casa_ajusco_origin_is_angelica,
    COALESCE((
      SELECT count(*) = 1
        AND bool_and(prospect.assigned_to = gerardo.id)
      FROM casa_ajusco_prospects AS prospect
      CROSS JOIN gerardo_identity AS gerardo
    ), FALSE) AS casa_ajusco_assigned_to_gerardo,
    policy.assigned_seller_can_read_prospects
      AS casa_ajusco_visibility_contract_allows_gerardo,
    COALESCE((
      SELECT
        CASE
          WHEN count(*) = 0 THEN NULL
          WHEN bool_and(prospect.commercial_partner_id IS NULL)
            THEN EXISTS (SELECT 1 FROM casa_ajusco_partners)
          ELSE TRUE
        END
      FROM casa_ajusco_prospects AS prospect
    ), FALSE) AS legacy_partner_directory_includes_new_prospects,
    CASE
      WHEN definition.bonus_definition IS NULL THEN NULL
      WHEN definition.bonus_definition LIKE '%if%pending_balance%> 0.005%return%'
        AND definition.bonus_definition NOT LIKE '%''pending''%v_conversion.converted_at%'
        THEN TRUE
      ELSE FALSE
    END AS bonus_created_only_at_first_valid_paid_cut
  FROM function_definitions AS definition
  CROSS JOIN policy_facts AS policy
  CROSS JOIN trigger_facts AS trigger
  CROSS JOIN rate_facts AS rate
),
safe_evaluation AS MATERIALIZED (
  SELECT
    evaluation.*,
    COALESCE(
      evaluation.angelica_identity_matches
      AND evaluation.angelica_origin_rates_are_2_5_10
      AND evaluation.gerardo_rates_are_5_10_15
      AND evaluation.conversion_bonus_is_50
      AND evaluation.payment_trigger_exists
      AND evaluation.payment_trigger_syncs_comodato_commissions
      AND evaluation.dual_commissions_can_coexist
      AND evaluation.conversion_attribution_is_immutable
      AND (SELECT count(*) FROM overlapping_rules) = 0
      AND (SELECT count(*) FROM target_function_names) = (
        SELECT count(DISTINCT function_name)
        FROM catalog_functions
        WHERE diagnostic_role = 'required_contract'
      ),
      FALSE
    ) AS deployed_contract_is_safe_to_correct
  FROM evaluations AS evaluation
),
unsafe_reasons AS MATERIALIZED (
  SELECT COALESCE(jsonb_agg(reason ORDER BY reason), '[]'::JSONB) AS reasons
  FROM (
    SELECT reason
    FROM safe_evaluation AS evaluation
    CROSS JOIN LATERAL (
      VALUES
        (CASE WHEN NOT evaluation.angelica_identity_matches THEN 'Angelica identity does not match the required UUID, active role, alias, name, and Auth email.' END),
        (CASE WHEN NOT evaluation.angelica_origin_rates_are_2_5_10 THEN 'Active prospect_origin rates are missing or differ from 2/5/10.' END),
        (CASE WHEN NOT evaluation.gerardo_rates_are_5_10_15 THEN 'Active Comodato rates are missing or differ from 5/10/15.' END),
        (CASE WHEN NOT evaluation.conversion_bonus_is_50 THEN 'The active conversion bonus is missing, duplicated, or differs from 50.' END),
        (CASE WHEN NOT evaluation.settlement_candidates_include_prospect_origin_sale THEN 'Settlement candidates exclude prospect_origin_sale.' END),
        (CASE WHEN NOT evaluation.settlement_candidates_include_pos_sale THEN 'Settlement candidates exclude pos_sale.' END),
        (CASE WHEN NOT evaluation.settlement_candidates_include_conversion_bonus THEN 'Settlement candidates exclude prospect_conversion_bonus.' END),
        (CASE WHEN NOT evaluation.vendedora_can_read_own_origin_events THEN 'Effective commission_events policies do not explicitly allow a vendedora to read her own prospect_origin_sale events.' END),
        (CASE WHEN NOT evaluation.vendedora_can_settle_all_allowed_sources THEN 'The combined policy and candidate-function contract does not prove that a vendedora can settle all three allowed source types.' END),
        (CASE WHEN NOT evaluation.payment_trigger_exists THEN 'The canonical trg_sync_comodato_payment trigger does not exist exactly once.' END),
        (CASE WHEN NOT evaluation.payment_trigger_syncs_comodato_commissions THEN 'The canonical payment trigger does not call the Comodato commission synchronizer.' END),
        (CASE WHEN NOT evaluation.dual_commissions_can_coexist THEN 'The deployed synchronizers or unique indexes do not prove safe coexistence of both source types.' END),
        (CASE WHEN NOT evaluation.conversion_attribution_is_immutable THEN 'Immutable conversion attribution is not proven by an effective trigger.' END),
        (CASE WHEN NOT evaluation.casa_ajusco_origin_is_angelica THEN 'Casa Ajusco was not found exactly once with Angelica as originator.' END),
        (CASE WHEN NOT evaluation.casa_ajusco_assigned_to_gerardo THEN 'Casa Ajusco was not found exactly once assigned to the resolved Gerardo profile.' END),
        (CASE WHEN NOT evaluation.casa_ajusco_visibility_contract_allows_gerardo THEN 'The effective commercial_prospects policies do not prove assigned-prospect visibility for Gerardo.' END),
        (CASE WHEN NOT evaluation.legacy_partner_directory_includes_new_prospects THEN 'The legacy commercial_partners directory does not prove inclusion of an unconverted prospect.' END),
        (CASE WHEN evaluation.bonus_created_only_at_first_valid_paid_cut IS DISTINCT FROM TRUE THEN 'The deployed bonus function does not prove that insertion waits for the first fully paid valid cut.' END),
        (CASE WHEN (SELECT count(*) FROM overlapping_rules) > 0 THEN 'Active commission rules overlap for the same scheme and product key.' END),
        (CASE WHEN NOT evaluation.deployed_contract_is_safe_to_correct THEN 'One or more prerequisite contract checks are absent or contradictory.' END)
    ) AS reason_row(reason)
    WHERE reason IS NOT NULL
  ) AS failed
),
recommended_scope AS MATERIALIZED (
  SELECT jsonb_build_object(
    'frontend_only_is_sufficient',
      evaluation.casa_ajusco_visibility_contract_allows_gerardo
        AND evaluation.legacy_partner_directory_includes_new_prospects,
    'frontend_partner_directory_observation',
      'pages/CommercialPartners.tsx reads commercial_partners only; pages/CommercialProspects.tsx reads v_commercial_prospect_details.',
    'prospect_rls_or_rpc_correction_needed',
      NOT evaluation.casa_ajusco_visibility_contract_allows_gerardo,
    'partner_directory_union_or_secondary_query_needed',
      NOT COALESCE(evaluation.legacy_partner_directory_includes_new_prospects, FALSE),
    'settlement_candidate_correction_needed',
      NOT evaluation.settlement_candidates_include_prospect_origin_sale
        OR NOT evaluation.settlement_candidates_include_pos_sale
        OR NOT evaluation.settlement_candidates_include_conversion_bonus,
    'commission_event_policy_correction_needed',
      NOT evaluation.vendedora_can_read_own_origin_events,
    'bonus_timing_correction_needed',
      evaluation.bonus_created_only_at_first_valid_paid_cut IS DISTINCT FROM TRUE,
    'objects_a_future_migration_may_need_to_replace',
      jsonb_strip_nulls(jsonb_build_object(
        'commission_settlement_candidate_events', CASE
          WHEN NOT evaluation.vendedora_can_settle_all_allowed_sources THEN TRUE END,
        'commission_events_policies', CASE
          WHEN NOT evaluation.vendedora_can_read_own_origin_events THEN TRUE END,
        'commercial_prospects_policies_or_reader_rpc', CASE
          WHEN NOT evaluation.casa_ajusco_visibility_contract_allows_gerardo THEN TRUE END,
        'sync_prospect_conversion_bonus', CASE
          WHEN evaluation.bonus_created_only_at_first_valid_paid_cut IS DISTINCT FROM TRUE THEN TRUE END,
        'commercial_partner_directory_frontend', CASE
          WHEN NOT COALESCE(evaluation.legacy_partner_directory_includes_new_prospects, FALSE) THEN TRUE END
      )),
    'safe_to_prepare_correction', evaluation.deployed_contract_is_safe_to_correct
  ) AS scope
  FROM safe_evaluation AS evaluation
)
SELECT jsonb_build_object(
  'diagnostic', jsonb_build_object(
    'generated_at', statement_timestamp(),
    'transaction_read_only', current_setting('transaction_read_only')::BOOLEAN,
    'frontend_contract', jsonb_build_object(
      'commercial_partners_page_source', 'public.commercial_partners',
      'commercial_prospects_page_source', 'public.v_commercial_prospect_details',
      'pages_are_separate', TRUE
    ),
    'functions', COALESCE((
      SELECT jsonb_agg(to_jsonb(function_row) - 'oid' ORDER BY function_name, identity_arguments)
      FROM catalog_functions AS function_row
    ), '[]'::JSONB),
    'triggers', COALESCE((
      SELECT jsonb_agg(to_jsonb(trigger_row) - 'oid' ORDER BY table_name, trigger_name)
      FROM related_triggers AS trigger_row
    ), '[]'::JSONB),
    'views', COALESCE((
      SELECT jsonb_agg(to_jsonb(view_row) ORDER BY view_name)
      FROM relevant_views AS view_row
    ), '[]'::JSONB),
    'table_security', COALESCE((
      SELECT jsonb_agg(to_jsonb(security_row) ORDER BY table_name)
      FROM table_security AS security_row
    ), '[]'::JSONB),
    'policies', COALESCE((
      SELECT jsonb_agg(to_jsonb(policy_row) ORDER BY table_name, policy_name)
      FROM effective_policies AS policy_row
    ), '[]'::JSONB),
    'table_permissions', COALESCE((
      SELECT jsonb_agg(to_jsonb(permission_row) ORDER BY table_name, grantee, privilege_type)
      FROM table_permissions AS permission_row
    ), '[]'::JSONB),
    'commission_event_constraints', COALESCE((
      SELECT jsonb_agg(to_jsonb(constraint_row) ORDER BY constraint_name)
      FROM commission_event_constraints AS constraint_row
    ), '[]'::JSONB),
    'commission_event_indexes', COALESCE((
      SELECT jsonb_agg(to_jsonb(index_row) ORDER BY index_name)
      FROM commission_event_indexes AS index_row
    ), '[]'::JSONB),
    'active_commission_rules', COALESCE((
      SELECT jsonb_agg(to_jsonb(rule_row) ORDER BY scheme, product_key, valid_from, id)
      FROM active_rules AS rule_row
    ), '[]'::JSONB),
    'overlapping_active_rules', COALESCE((
      SELECT jsonb_agg(to_jsonb(overlap_row) ORDER BY scheme, product_key, first_rule_id)
      FROM overlapping_rules AS overlap_row
    ), '[]'::JSONB),
    'angelica_identity', COALESCE((
      SELECT to_jsonb(identity_row) FROM angelica_identity AS identity_row
    ), 'null'::JSONB),
    'function_contract_inventory', jsonb_build_object(
      'expected_names', (
        SELECT jsonb_agg(function_name ORDER BY function_name)
        FROM target_function_names
      ),
      'missing_names', COALESCE((
        SELECT jsonb_agg(target.function_name ORDER BY target.function_name)
        FROM target_function_names AS target
        WHERE NOT EXISTS (
          SELECT 1
          FROM catalog_functions AS function_row
          WHERE function_row.function_name = target.function_name
        )
      ), '[]'::JSONB)
    ),
    'casa_ajusco', jsonb_build_object(
      'prospects', COALESCE((
        SELECT jsonb_agg(to_jsonb(prospect_row) ORDER BY prospect_id)
        FROM casa_ajusco_prospects AS prospect_row
      ), '[]'::JSONB),
      'conversions', COALESCE((
        SELECT jsonb_agg(to_jsonb(conversion_row) ORDER BY conversion_id)
        FROM casa_ajusco_conversions AS conversion_row
      ), '[]'::JSONB),
      'matching_commercial_partners', COALESCE((
        SELECT jsonb_agg(to_jsonb(partner_row) ORDER BY id)
        FROM casa_ajusco_partners AS partner_row
      ), '[]'::JSONB),
      'prospect_count', (SELECT count(*) FROM casa_ajusco_prospects),
      'conversion_count', (SELECT count(*) FROM casa_ajusco_conversions),
      'partner_count', (SELECT count(*) FROM casa_ajusco_partners),
      'state_checks', jsonb_build_object(
        'exactly_one_prospect_found', (SELECT count(*) = 1 FROM casa_ajusco_prospects),
        'has_conversion_row', (SELECT count(*) > 0 FROM casa_ajusco_conversions),
        'has_commercial_partner_reference', COALESCE((
          SELECT bool_or(commercial_partner_id IS NOT NULL)
          FROM casa_ajusco_prospects
        ), FALSE),
        'conversion_state_is_consistent', COALESCE((
          SELECT count(*) = 1 AND bool_and(
            (prospect.commercial_partner_id IS NULL
              AND prospect.converted_at IS NULL
              AND (SELECT count(*) FROM casa_ajusco_conversions) = 0)
            OR
            (prospect.commercial_partner_id IS NOT NULL
              AND prospect.converted_at IS NOT NULL
              AND (SELECT count(*) FROM casa_ajusco_conversions) = 1)
          )
          FROM casa_ajusco_prospects AS prospect
        ), FALSE),
        'has_no_duplicate_conversion', (SELECT count(*) <= 1 FROM casa_ajusco_conversions),
        'has_no_duplicate_partner', (SELECT count(*) <= 1 FROM casa_ajusco_partners)
      )
    ),
    'angelica_commission_totals', COALESCE((
      SELECT jsonb_agg(to_jsonb(summary_row) ORDER BY source_type, status, payment_status)
      FROM angelica_event_summary AS summary_row
    ), '[]'::JSONB),
    'evaluations', (SELECT to_jsonb(evaluation_row) FROM safe_evaluation AS evaluation_row),
    'unsafe_reason', (SELECT reasons FROM unsafe_reasons),
    'recommended_correction_scope', (SELECT scope FROM recommended_scope)
  )
) AS result;

ROLLBACK;
