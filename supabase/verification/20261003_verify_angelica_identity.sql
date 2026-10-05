BEGIN;
SET TRANSACTION READ ONLY;

WITH expected AS (
  SELECT
    'b5fe98b7-d5ff-457e-8176-ed66a13af84b'::UUID AS user_id,
    'angelicagut@catcorn.com.mx'::TEXT AS email,
    'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101'::UUID AS chipitlan_id,
    'e7d54d51-57b3-4aae-9cf5-09aa7ce00202'::UUID AS aurrera_id
), identity_checks AS (
  SELECT
    count(*) FILTER (
      WHERE auth_user.id = expected.user_id
        AND lower(auth_user.email) = expected.email
        AND profile.id = expected.user_id
        AND profile.full_name = 'Angelica Gutierrez'
        AND profile.commercial_alias = 'ANGELICA'
        AND profile.role = 'vendedora'
        AND profile.is_active
    ) = 1 AS identity_alias_uuid_and_role_are_exact,
    NOT EXISTS (
      SELECT 1
      FROM auth.users AS other_auth_user
      WHERE lower(other_auth_user.email) = expected.email
        AND other_auth_user.id <> expected.user_id
    ) AS auth_email_belongs_only_to_expected_uuid,
    NOT EXISTS (
      SELECT 1
      FROM public.user_profiles AS other_profile
      WHERE other_profile.id <> expected.user_id
        AND upper(btrim(COALESCE(other_profile.commercial_alias, ''))) = 'ANGELICA'
    ) AS commercial_alias_belongs_only_to_expected_uuid
  FROM expected
  LEFT JOIN auth.users AS auth_user ON auth_user.id = expected.user_id
  LEFT JOIN public.user_profiles AS profile ON profile.id = auth_user.id
  GROUP BY expected.user_id, expected.email
), branch_checks AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM public.branches AS branch
      WHERE branch.id = expected.chipitlan_id
        AND branch.code = 'chipitlan_01'
        AND branch.active
    ) AS chipitlan_branch_is_exact_and_active,
    EXISTS (
      SELECT 1
      FROM public.user_branch_access AS access
      WHERE access.user_id = expected.user_id
        AND access.branch_id = expected.chipitlan_id
        AND access.active
    ) AS chipitlan_access_is_active,
    EXISTS (
      SELECT 1
      FROM public.branches AS branch
      WHERE branch.id = expected.aurrera_id
        AND branch.code = 'aurrera_la_luna_02'
        AND branch.active
    ) AS aurrera_branch_is_exact_and_active,
    NOT EXISTS (
      SELECT 1
      FROM public.user_branch_access AS access
      WHERE access.user_id = expected.user_id
        AND access.branch_id = expected.aurrera_id
        AND access.active
    ) AS aurrera_access_is_absent,
    NOT EXISTS (
      SELECT 1
      FROM public.user_branch_access AS access
      WHERE access.user_id = expected.user_id
        AND access.branch_id <> expected.chipitlan_id
        AND access.active
    ) AS no_other_active_branch_access
  FROM expected
), expected_rates(scheme, product_key, commission_type, amount, currency, valid_from) AS (
  VALUES
    ('vendedora_pos', 'michi_clasico', 'per_unit', 2.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('vendedora_pos', 'michi_sabores', 'per_unit', 2.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('vendedora_pos', 'caramelo_michi', 'per_unit', 2.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('vendedora_pos', 'gato_mayor_clasico', 'per_unit', 5.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('vendedora_pos', 'gato_mayor_sabores', 'per_unit', 5.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('vendedora_pos', 'caramelo_gato_mayor', 'per_unit', 5.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('vendedora_pos', 'jefe_felino_clasico', 'per_unit', 10.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('vendedora_pos', 'jefe_felino_sabores', 'per_unit', 10.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('prospect_origin', 'michi_clasico', 'per_unit', 2.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('prospect_origin', 'michi_sabores', 'per_unit', 2.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('prospect_origin', 'caramelo_michi', 'per_unit', 2.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('prospect_origin', 'gato_mayor_clasico', 'per_unit', 5.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('prospect_origin', 'gato_mayor_sabores', 'per_unit', 5.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('prospect_origin', 'caramelo_gato_mayor', 'per_unit', 5.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('prospect_origin', 'jefe_felino_clasico', 'per_unit', 10.00::NUMERIC, 'MXN', DATE '2026-09-30'),
    ('prospect_origin', 'jefe_felino_sabores', 'per_unit', 10.00::NUMERIC, 'MXN', DATE '2026-09-30')
), actual_rates AS (
  SELECT
    rule.scheme,
    rule.product_key,
    rule.commission_type,
    rule.commission_amount AS amount,
    rule.currency,
    rule.valid_from
  FROM public.commission_rules AS rule
  WHERE rule.scheme IN ('vendedora_pos', 'prospect_origin')
    AND rule.valid_from = DATE '2026-09-30'
    AND rule.active
), rate_checks AS (
  SELECT
    count(*) = 16
      AND NOT EXISTS (SELECT * FROM expected_rates EXCEPT SELECT * FROM actual_rates)
      AND NOT EXISTS (SELECT * FROM actual_rates EXCEPT SELECT * FROM expected_rates)
      AS seller_rates_are_exact
  FROM actual_rates
), bonus_checks AS (
  SELECT
    count(*) FILTER (
      WHERE rule.scheme = 'prospect_conversion'
        AND rule.product_key = 'first_paid_comodato_settlement'
        AND rule.commission_type = 'fixed_bonus'
        AND rule.commission_amount = 50.00
        AND rule.currency = 'MXN'
        AND rule.valid_from = DATE '2026-09-29'
        AND rule.active
    ) = 1 AS conversion_bonus_is_exactly_50_mxn
  FROM public.commission_rules AS rule
  WHERE rule.scheme = 'prospect_conversion'
    AND rule.product_key = 'first_paid_comodato_settlement'
    AND rule.valid_from = DATE '2026-09-29'
), function_definitions AS (
  SELECT
    max(lower(pg_get_functiondef(proc_row.oid))) FILTER (
      WHERE proc_row.proname = 'is_valid_prospect_bonus_recipient'
    ) AS bonus_recipient_definition,
    max(lower(pg_get_functiondef(proc_row.oid))) FILTER (
      WHERE proc_row.proname = 'commission_settlement_candidate_events'
    ) AS settlement_candidate_definition
  FROM pg_proc AS proc_row
  JOIN pg_namespace AS namespace_row ON namespace_row.oid = proc_row.pronamespace
  WHERE namespace_row.nspname = 'public'
    AND proc_row.proname IN (
      'is_valid_prospect_bonus_recipient',
      'commission_settlement_candidate_events'
    )
), permission_checks AS (
  SELECT
    to_regprocedure('public.user_has_branch_access(uuid)') IS NOT NULL
      AS branch_access_guard_still_exists,
    bonus_recipient_definition LIKE '%profile.role = ''vendedora''%'
      AND bonus_recipient_definition LIKE '%profile.is_active%'
      AS prospect_bonus_eligibility_remains_role_based,
    settlement_candidate_definition LIKE '%seller.role = ''vendedora''%'
      AND settlement_candidate_definition LIKE '%''prospect_conversion_bonus''%'
      AND settlement_candidate_definition LIKE '%''pos_sale''%'
      AND settlement_candidate_definition LIKE '%''prospect_origin_sale''%'
      AND settlement_candidate_definition LIKE '%seller.role = ''socios_comerciales''%'
      AS settlement_restrictions_and_partner_access_are_preserved
  FROM function_definitions
), checks AS (
  SELECT
    identity_checks.*,
    branch_checks.*,
    rate_checks.*,
    bonus_checks.*,
    permission_checks.*
  FROM identity_checks
  CROSS JOIN branch_checks
  CROSS JOIN rate_checks
  CROSS JOIN bonus_checks
  CROSS JOIN permission_checks
), serialized AS (
  SELECT to_jsonb(checks) AS values
  FROM checks
)
SELECT jsonb_build_object(
  'all_checks_passed', NOT EXISTS (
    SELECT 1
    FROM jsonb_each_text(serialized.values) AS check_row
    WHERE check_row.value IS DISTINCT FROM 'true'
  ),
  'checks', serialized.values,
  'historical_attribution_evidence', jsonb_build_object(
    'sales_rows_for_uuid', (
      SELECT count(*) FROM public.sales AS sale WHERE sale.cashier_id = expected.user_id
    ),
    'prospect_conversion_rows_for_uuid', (
      SELECT count(*)
      FROM public.commercial_prospect_conversions AS conversion
      WHERE conversion.originator_user_id = expected.user_id
    ),
    'commission_event_rows_for_uuid', (
      SELECT count(*)
      FROM public.commission_events AS event
      WHERE event.seller_id = expected.user_id
    )
  ),
  'read_only_scope',
    'The verifier is transaction-read-only and the migration updates only full_name, commercial_alias and updated_at for the exact profile UUID.'
) AS verification
FROM serialized
CROSS JOIN expected;

ROLLBACK;
