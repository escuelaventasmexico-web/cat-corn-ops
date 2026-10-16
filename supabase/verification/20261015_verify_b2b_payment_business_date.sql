WITH
expected_columns AS (
  SELECT *
  FROM (VALUES
    ('commercial_partner_payments'::TEXT),
    ('wholesale_payments'),
    ('seller_piece_payments'),
    ('partner_payment_verification_requests')
  ) AS expected(table_name)
),
column_checks AS (
  SELECT
    expected.table_name,
    columns.data_type = 'date' AS is_date,
    columns.is_nullable = 'YES' AS preserves_legacy_nulls
  FROM expected_columns AS expected
  LEFT JOIN information_schema.columns AS columns
    ON columns.table_schema = 'public'
   AND columns.table_name = expected.table_name
   AND columns.column_name = 'business_date'
),
function_contract AS (
  SELECT
    procedure.prosecdef AS security_definer,
    procedure.provolatile = 'i' AS immutable,
    LOWER(pg_get_functiondef(procedure.oid)) AS definition
  FROM pg_proc AS procedure
  WHERE procedure.oid = TO_REGPROCEDURE(
    'public.resolve_b2b_payment_business_date(timestamp with time zone,timestamp with time zone,date)'
  )
),
view_contract AS (
  SELECT
    view_class.reloptions,
    pg_get_viewdef(view_class.oid, TRUE) AS definition
  FROM pg_class AS view_class
  JOIN pg_namespace AS namespace ON namespace.oid = view_class.relnamespace
  WHERE namespace.nspname = 'public'
    AND view_class.relname = 'v_b2b_confirmed_payments'
    AND view_class.relkind = 'v'
),
trigger_contract AS (
  SELECT trigger_row.tgname, table_class.relname AS table_name,
    pg_get_triggerdef(trigger_row.oid, TRUE) AS definition
  FROM pg_trigger AS trigger_row
  JOIN pg_class AS table_class ON table_class.oid = trigger_row.tgrelid
  JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
  WHERE namespace.nspname = 'public'
    AND NOT trigger_row.tgisinternal
    AND trigger_row.tgname IN (
      'trg_set_b2b_verification_business_date',
      'trg_sync_approved_b2b_payment_business_date',
      'trg_set_comodato_payment_business_date',
      'trg_set_wholesale_payment_business_date',
      'trg_set_piece_payment_business_date'
    )
),
write_function_contract AS (
  SELECT procedure.proname, LOWER(pg_get_functiondef(procedure.oid)) AS definition
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname IN (
      'set_b2b_verification_business_date',
      'set_b2b_payment_business_date',
      'sync_approved_b2b_payment_business_date'
    )
),
report_contract AS (
  SELECT procedure.proname, LOWER(pg_get_functiondef(procedure.oid)) AS definition
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname IN (
      'get_b2b_monthly_collections_report',
      'get_b2b_monthly_analysis'
    )
    AND pg_get_function_identity_arguments(procedure.oid) = 'p_month_start date, p_month_end date'
),
synthetic_cases AS (
  SELECT *
  FROM (VALUES
    ('real_timestamp_before_mexico_midnight'::TEXT, '2026-09-27 04:47:35.936237+00'::TIMESTAMPTZ, '2026-09-27 04:47:35.936237+00'::TIMESTAMPTZ, NULL::DATE, '2026-09-26'::DATE),
    ('utc_today_defect_after_23_mexico', '2026-10-15 00:00:00+00', '2026-10-15 05:17:23.897986+00', NULL, '2026-10-14'),
    ('utc_midnight_same_mexico_day', '2026-10-15 00:00:00+00', '2026-10-15 23:08:35.617451+00', NULL, '2026-10-15'),
    ('effective_yesterday_selected_today', '2026-10-14 00:00:00+00', '2026-10-15 20:00:00+00', NULL, '2026-10-14'),
    ('before_18_mexico', '2026-10-15 17:59:00+00', '2026-10-15 17:59:00+00', NULL, '2026-10-15'),
    ('after_18_mexico', '2026-10-16 01:00:00+00', '2026-10-16 01:00:00+00', NULL, '2026-10-15'),
    ('month_end', '2026-11-01 05:59:59+00', '2026-11-01 05:59:59+00', NULL, '2026-10-31'),
    ('next_month', '2026-11-01 06:00:00+00', '2026-11-01 06:00:00+00', NULL, '2026-11-01'),
    ('explicit_date_wins', '2026-10-16 01:00:00+00', '2026-10-16 01:00:00+00', '2026-10-13', '2026-10-13')
  ) AS test_case(name, payment_date, created_at, business_date, expected_date)
),
synthetic_results AS (
  SELECT
    test_case.*,
    public.resolve_b2b_payment_business_date(
      test_case.payment_date,
      test_case.created_at,
      test_case.business_date
    ) AS actual_date
  FROM synthetic_cases AS test_case
),
known_expected AS (
  SELECT *
  FROM (VALUES
    ('comodato'::TEXT, '3210c59b-d444-4649-931e-e309db77a8b1'::UUID, 180::NUMERIC, '2026-09-26'::DATE),
    ('comodato', 'e44cc49d-0f75-44b0-bff3-cf89419d86a4'::UUID, 180::NUMERIC, '2026-10-14'::DATE),
    ('mayoreo', '8a10b09a-fcf7-4151-8fa7-441f68e2d0a0'::UUID, 345::NUMERIC, '2026-10-15'::DATE)
  ) AS expected(source_type, payment_id, amount, business_date)
),
known_results AS (
  SELECT
    expected.source_type,
    expected.payment_id,
    expected.amount AS expected_amount,
    payment.amount AS actual_amount,
    expected.business_date AS expected_business_date,
    payment.business_date AS actual_business_date,
    payment.id IS NOT NULL
      AND payment.amount = expected.amount
      AND payment.business_date = expected.business_date AS passed
  FROM known_expected AS expected
  LEFT JOIN public.v_b2b_confirmed_payments AS payment
    ON payment.source_type = expected.source_type
   AND payment.id = expected.payment_id
),
base_confirmed AS (
  SELECT 'comodato'::TEXT AS source_type, id, amount
  FROM public.commercial_partner_payments
  WHERE status IN ('completed', 'paid')
  UNION ALL
  SELECT 'mayoreo', id, amount
  FROM public.wholesale_payments
  WHERE status IN ('completed', 'paid')
  UNION ALL
  SELECT 'venta_pieza', id, amount
  FROM public.seller_piece_payments
  WHERE status = 'completed'
),
coverage AS (
  SELECT
    (SELECT COUNT(*) FROM base_confirmed) AS base_count,
    (SELECT COUNT(*) FROM public.v_b2b_confirmed_payments) AS view_count,
    (SELECT COALESCE(SUM(amount), 0) FROM base_confirmed) AS base_total,
    (SELECT COALESCE(SUM(amount), 0) FROM public.v_b2b_confirmed_payments) AS view_total
),
daily_reconciliation AS (
  SELECT NOT EXISTS (
    SELECT grouped.business_date
    FROM (
      SELECT business_date, SUM(amount) AS total
      FROM public.v_b2b_confirmed_payments
      GROUP BY business_date
    ) AS grouped
    WHERE grouped.total IS DISTINCT FROM (
      SELECT COALESCE(SUM(detail.amount), 0)
      FROM public.v_b2b_confirmed_payments AS detail
      WHERE detail.business_date = grouped.business_date
    )
  ) AS passed
),
ambiguous_legacy AS (
  SELECT payment.source_type, payment.id, payment.payment_date,
    payment.created_at, payment.business_date AS inferred_business_date,
    'UTC midnight matched UTC creation day; Mexico creation date was inferred'::TEXT AS reason
  FROM public.v_b2b_confirmed_payments AS payment
  WHERE payment.payment_date = DATE_TRUNC('day', payment.payment_date AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND (payment.payment_date AT TIME ZONE 'UTC')::DATE = (payment.created_at AT TIME ZONE 'UTC')::DATE
    AND (payment.payment_date AT TIME ZONE 'UTC')::DATE
      IS DISTINCT FROM (payment.created_at AT TIME ZONE 'America/Mexico_City')::DATE
    AND CASE payment.source_type
      WHEN 'comodato' THEN (SELECT source.business_date IS NULL FROM public.commercial_partner_payments AS source WHERE source.id = payment.id)
      WHEN 'mayoreo' THEN (SELECT source.business_date IS NULL FROM public.wholesale_payments AS source WHERE source.id = payment.id)
      ELSE (SELECT source.business_date IS NULL FROM public.seller_piece_payments AS source WHERE source.id = payment.id)
    END
),
checks AS (
  SELECT
    COALESCE((SELECT COUNT(*) = 4 AND BOOL_AND(is_date AND preserves_legacy_nulls) FROM column_checks), FALSE)
      AS canonical_columns_exist_without_forced_backfill,
    COALESCE((SELECT immutable AND NOT security_definer FROM function_contract), FALSE)
      AS resolver_is_immutable_and_not_privileged,
    COALESCE((SELECT 'security_invoker=true' = ANY(reloptions) FROM view_contract), FALSE)
      AS canonical_view_is_security_invoker,
    COALESCE((SELECT POSITION('resolve_b2b_payment_business_date' IN LOWER(definition)) > 0 FROM view_contract), FALSE)
      AS canonical_view_uses_resolver,
    COALESCE((SELECT COUNT(*) = 5 FROM trigger_contract), FALSE) AS all_write_path_triggers_exist,
    COALESCE((
      SELECT COUNT(*) = 3
        AND BOOL_AND(POSITION('business_date' IN definition) > 0)
        AND BOOL_OR(
          proname = 'sync_approved_b2b_payment_business_date'
          AND POSITION('commercial_partner_payments' IN definition) > 0
          AND POSITION('wholesale_payments' IN definition) > 0
          AND POSITION('seller_piece_payments' IN definition) > 0
          AND POSITION('old.status::text = ''approved''' IN definition) > 0
          AND POSITION('old.business_date is not distinct from new.business_date' IN definition) > 0
          AND POSITION('old.approved_payment_id is not distinct from new.approved_payment_id' IN definition) > 0
        )
      FROM write_function_contract
    ), FALSE) AS admin_and_ordinary_approvals_copy_business_date,
    COALESCE((SELECT COUNT(*) = 2
       AND BOOL_AND(POSITION('resolve_b2b_payment_business_date' IN definition) > 0)
       AND BOOL_AND(POSITION('payment.payment_date at time zone ''america/mexico_city''' IN definition) = 0)
       AND BOOL_AND(POSITION('payment.payment_date at time zone ''utc''' IN definition) = 0)
     FROM report_contract), FALSE) AS monthly_reports_use_canonical_date,
    COALESCE((SELECT BOOL_AND(actual_date = expected_date) FROM synthetic_results), FALSE)
      AS synthetic_timezone_cases_pass,
    COALESCE((SELECT COUNT(*) = 3 AND BOOL_AND(passed) FROM known_results), FALSE)
      AS known_payments_are_on_expected_dates,
    COALESCE((SELECT base_count = view_count AND base_total = view_total FROM coverage), FALSE)
      AS confirmed_and_partial_payments_are_preserved_once,
    NOT EXISTS (
      SELECT source_type, id
      FROM public.v_b2b_confirmed_payments
      GROUP BY source_type, id
      HAVING COUNT(*) > 1
    ) AS no_duplicate_payments,
    NOT EXISTS (
      SELECT 1
      FROM public.v_b2b_confirmed_payments AS canonical
      JOIN public.commercial_partner_payments AS source ON source.id = canonical.id
      WHERE canonical.source_type = 'comodato'
        AND source.status NOT IN ('completed', 'paid')
      UNION ALL
      SELECT 1
      FROM public.v_b2b_confirmed_payments AS canonical
      JOIN public.wholesale_payments AS source ON source.id = canonical.id
      WHERE canonical.source_type = 'mayoreo'
        AND source.status NOT IN ('completed', 'paid')
      UNION ALL
      SELECT 1
      FROM public.v_b2b_confirmed_payments AS canonical
      JOIN public.seller_piece_payments AS source ON source.id = canonical.id
      WHERE canonical.source_type = 'venta_pieza'
        AND source.status <> 'completed'
    ) AS pending_and_cancelled_are_excluded,
    COALESCE((SELECT passed FROM daily_reconciliation), FALSE) AS daily_totals_equal_detail
)
SELECT JSONB_BUILD_OBJECT(
  'all_checks_passed',
    canonical_columns_exist_without_forced_backfill
    AND resolver_is_immutable_and_not_privileged
    AND canonical_view_is_security_invoker
    AND canonical_view_uses_resolver
    AND all_write_path_triggers_exist
    AND admin_and_ordinary_approvals_copy_business_date
    AND monthly_reports_use_canonical_date
    AND synthetic_timezone_cases_pass
    AND known_payments_are_on_expected_dates
    AND confirmed_and_partial_payments_are_preserved_once
    AND no_duplicate_payments
    AND pending_and_cancelled_are_excluded
    AND daily_totals_equal_detail,
  'checks', TO_JSONB(checks),
  'known_payments', (
    SELECT JSONB_AGG(TO_JSONB(known_results) ORDER BY expected_business_date, source_type)
    FROM known_results
  ),
  'synthetic_cases', (
    SELECT JSONB_AGG(TO_JSONB(synthetic_results) ORDER BY name)
    FROM synthetic_results
  ),
  'ambiguous_legacy_count', (SELECT COUNT(*) FROM ambiguous_legacy),
  'ambiguous_legacy_rows', COALESCE((
    SELECT JSONB_AGG(TO_JSONB(ambiguous_legacy) ORDER BY created_at, source_type, id)
    FROM ambiguous_legacy
  ), '[]'::JSONB),
  'coverage', (SELECT TO_JSONB(coverage) FROM coverage)
)
FROM checks;
